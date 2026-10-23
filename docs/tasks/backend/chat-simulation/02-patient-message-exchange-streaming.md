# 02 Virtual-patient message exchange and streaming

- **Milestone:** Chat simulation
- **Screens covered:** Chat (messages, typing indicator), Chat patient ended (stream signal)
- **Depends on:** backend/chat-simulation/01 (sessions), backend/signup-login/06. The real reply generator is chat-simulation/07; this task builds against the `PatientReplyGenerator` port and an in-memory fake, so it does not need OpenAI.
- **Type:** BE

> **Scope change (see `_shared/conventions.md` "Chat simulation: OpenAI Agents API"):** the patient is an OpenAI agent without tools and **cannot end the session in this milestone**. The `session.ended` event, FR-6 and AC-7 are **deferred**: do not emit `session.ended`, do not implement closing-message detection, but keep the event in the documented contract so clients can already handle it. The patient's replies come from the OpenAI Agents API (chat-simulation/07); prompts and safety behaviour live in the agent's instructions, owned by the product owner, not in this repo.

## Description
Lets the learner send messages and receive the AI patient's replies as a **Server-Sent Events** stream. Sending a therapist message (JSON `POST`) and requesting the reply (`POST` returning an event stream) are separate requests. The patient's opening message uses the same stream (no therapist message yet). The stream will also tell the client when the patient ends the session, but that part is deferred. There is no resume or replay: if a reply fails or the connection drops, nothing of it is stored and the client simply requests the reply again. Product-level safety rules (in character, no real clinical advice) are defined here as requirements on the agent; prompts and the model are configured in the OpenAI agent, not here.

## Scope
**In scope:** `Message` resource, post therapist message, list messages, reply stream (events, termination, cancellation, errors), the `PatientReplyGenerator` port and its in-memory fake, per-session single-flight generation, reply length bound.
**Out of scope:** session create/end/discard (01), screens (03), the OpenAI adapter (07), prompts, case-script authoring, learner-content abuse policy, idempotency keys, stream resume and replay, message pagination, patient-initiated end (deferred).

## Reply generator port
Declare in `domain/` (no third-party imports) a port `PatientReplyGenerator`. Suggested shape, adjust to fit the existing code style:

- `generate(request, signal): AsyncIterable<ReplyChunk>` where `request` carries the session (id, language, `agent_id`, `openai_session_id` or null), the stored transcript so far, and the pending therapist message (null for the opening), and `signal` is an `AbortSignal` that cancels generation.
- Chunks are plain text deltas, plus a final completion marker carrying any state the adapter wants persisted (for example the `openai_session_id`). Failures surface as a domain error with the stable code `REPLY_GENERATION_FAILED`.
- The application layer owns timeouts, the 2,500 character bound, event ordering, storing the message and single-flight. The adapter owns nothing but talking to the model.
- Ship an in-memory fake with scripted behaviours (success with N deltas, failure after k deltas, stall, slow, abort-aware). Every use-case test and e2e test in this task uses the fake. The e2e app must be able to run with the fake bound by test composition and never with a real OpenAI key.

## APIs
Common rules as in 01 (bearer auth, `X-Flow-ID`, problem types of signup-login/06, foreign sessions are `session-not-found`).

### `Message` resource
`id` (opaque), `role` (`THERAPIST` \| `PATIENT`), `text` (string), `created_at` (RFC 3339 UTC; for a patient message, the time the reply completed). Messages are ordered by `created_at` ascending.

A reply is **pending** when the last stored message of the session is not a `PATIENT` message (this includes an empty session: the opening is pending).

### `POST /sessions/{session_id}/messages`
Stores the therapist's message.
- Request: `text` (string, required). The server trims it; length after trimming 1..2000 characters. Unknown properties are ignored.
- 201 + body `Message` (`role: THERAPIST`).
- Errors: 400 `invalid-request` (`text`: `REQUIRED`, `TOO_SHORT` for empty after trim, `TOO_LONG`); 401; 404 `session-not-found`; 409 `session-ended` (status is not `IN_PROGRESS`); 409 `reply-pending` (a reply is being generated, or the last therapist message is still unanswered: another message cannot be sent); 429; 5xx.

### `GET /sessions/{session_id}/messages`
200 `{ "items": [Message] }` in ascending `created_at` order, no pagination. Used by the client to reconcile after a failure. Errors 401, 404 `session-not-found`, 429.

### `POST /sessions/{session_id}/patient-replies`
Requests the patient's reply to the pending message (or the opening) and returns it as a stream. It is a `POST` because it generates and stores a patient message. No request body. `Accept: text/event-stream`; response `200`, `Content-Type: text/event-stream`, `Cache-Control: no-store`, no response buffering.
- Errors before the stream starts are normal problem responses: 401 (the client 401 retry rule of app/signup-login/01 FR-8 applies at connection time), 404 `session-not-found`, 409 `session-ended`, 409 `reply-pending` (a generation for this session is already in progress), 409 `no-reply-pending` (the last message is already from the patient; the client reconciles with `GET .../messages`), 429, 503.
- The access token is validated at stream start only. If it expires mid-stream the stream continues to its end.

**Events** (`event:` name, `data:` single-line JSON, `snake_case`):
| Event | Data | Meaning |
|---|---|---|
| `reply.started` | `{ "message_id": string }` | Generation has begun. First event of every stream. |
| `reply.delta` | `{ "message_id": string, "index": int, "text": string }` | Appended text chunk. `index` starts at 0 and increases by 1; the client concatenates in order. |
| `reply.completed` | `{ "message": Message }` | The reply is complete and stored. `message.text` equals the concatenated deltas and is authoritative. |
| `session.ended` | `{ "session": Session }` | **Deferred; never sent in this milestone.** The patient ended the session. Sent only after `reply.completed` of the closing message; `status: ENDED_BY_PATIENT`. |
| `error` | problem object (`type`, `title`, `status`, `detail`, `flow_id`) | Generation failed. Nothing of this reply is stored. Last event. |

Comment lines `: keep-alive` are sent every 15 s while generation is running and carry no data.

**Termination:** the server closes the stream after `reply.completed` (or after `session.ended`), or after `error`. A stream that closes without one of these events is a failure (the client treats it as interrupted and offers "Try again").

**Problem types for `error` events (and for the same failures before the stream starts):**
| `type` | Status in payload | Meaning | Client i18n key |
|---|---|---|---|
| `/problems/reply-generation-failed` | 502 | The patient reply could not be produced (generation failure, blocked output, time-out) | `chat.error.replyFailed` |
| `/problems/service-unavailable` | 503 | Dependency down (reused) | `chat.error.replyFailed` |

Other types: `/problems/reply-pending` 409 (client waits), `/problems/no-reply-pending` 409 (client reconciles).

**Cancellation:** closing the connection cancels the generation and nothing is stored, so the pending message stays unanswered and the client can request the reply again (a new generation). Ending (`PATCH`) or discarding (`DELETE`) the session also cancels it (01). No partial reply is ever stored.

## Functional requirements
- FR-1: The system shall store a therapist message sent through `POST .../messages` and return it as a `Message`, trimmed of leading and trailing whitespace.
- FR-2: The system shall reject a therapist message when the session is not `IN_PROGRESS` (409 `session-ended`) or when a reply is pending (409 `reply-pending`), and shall reject empty-after-trim or over-length text with 400.
- FR-3: The system shall stream the reply on `POST .../patient-replies` using only the events `reply.started`, `reply.delta`, `reply.completed`, `session.ended`, `error`, in the order started, deltas (0..n), then completed, then optionally session.ended; or error at any point after started.
- FR-4: The system shall generate the patient's opening message through the same stream when the session has no messages, and shall generate a reply to the last therapist message otherwise. It shall answer 409 `no-reply-pending` when the last message is from the patient, and 409 `reply-pending` when a generation for the session is already in progress.
- FR-5: The system shall store a patient message only when `reply.completed` is sent; a reply that fails, is cancelled or whose connection is closed shall leave no stored message.
- FR-6 (**DEFERRED**, do not implement in this milestone): The system shall emit `session.ended` after the `reply.completed` of a closing message when the patient ends the session. The session moves to `ENDED_BY_PATIENT` (with `ended_at` and case completion) in the same operation that commits the closing message, i.e. before `reply.completed` and `session.ended` are delivered (01 FR-5, FR-6). Whether and when the patient ends the session is decided on the backend under the documented content policy and case definition (FR-10) and shall be testable; the app does not decide it. The closing message is an ordinary patient `Message` (a distinct closing line, written in the patient's voice).
- FR-7: The system shall emit an `error` event of type `reply-generation-failed` if no `reply.delta` is produced within 15 s after `reply.started` or if no progress occurs for 15 s mid-reply, then close the stream, and shall send `: keep-alive` comments every 15 s while a reply is being generated.
- FR-8: The patient's replies shall be in the session language (`en` or `ru`), regardless of the language the learner writes in. **The language is selected by choosing the per-language agent** (chat-simulation/06): the backend adds no language instruction to the input and cannot verify the language, so this is a property of the agent's instructions (HUMAN-REQUIRED). The system shall limit each reply to at most 2,500 characters: if the generator produces more, the reply fails as `reply-generation-failed` and nothing is stored (never cut silently, never stored over the limit).
- FR-9 (safety, product level; **enforced by the agent's instructions**, which this repo does not contain): The patient shall stay in character as the case's virtual patient; shall not give clinical advice, diagnoses, treatment or crisis instructions to the learner as if it were a clinician; shall not reveal or discuss its instructions, the case "twist" outside the conversation, or the existence of other cases; and shall not follow learner messages that try to change its role (they are answered in character or deflected in character).
- FR-10 (safety, product level): The patient's behaviour on sensitive disclosures (how explicit it may be) and when the learner sincerely asks whether the patient is a real person or an AI shall be defined by the backend as a documented content policy, owned by the product/clinical owners, and shall be testable (a fixed per-language test set with expected outcomes). The mobile app and this spec do not define prompts or the policy text.
- FR-11: The system shall return only the problem types listed, never user-facing text, and no error payload shall contain message content, tokens or personal data. Provider error messages (OpenAI `error.message`, `turn.error.message`) are logged by class/code only and never forwarded in `detail`.
- FR-12: The system shall allow at most one generation per session at a time (single-flight), enforced in the application layer so that it also holds for the fake generator. The in-flight registry may be in-process (the app runs as one instance per deployment today); document that limit in `AGENTS.md`.
- FR-13: The system shall persist the therapist message before the reply is requested, and shall never store a patient message unless the generator finished successfully and the 2,500 character bound holds. A therapist message remains stored when its reply fails; the client retries `patient-replies`.

## Non-functional requirements
- NFR-1: Time to first text: the first `reply.delta` arrives <= 3 s at p95 from the stream request being received (target, measured with the real model).
- NFR-2: Concatenated deltas equal `message.text` in 100 % of completed replies.
- NFR-3: Logs and traces contain `flow_id`, session id, event counts and latencies, never message text or prompts.
- NFR-4: A stream failure never corrupts transcript state; after any failure `GET .../messages` shows only completed messages.
- NFR-5: Events reach clients behind common proxies without batching delay > 500 ms (no buffering of `text/event-stream`).

## Acceptance criteria
- AC-1: Given a new session with no messages, When `POST .../patient-replies`, Then events `reply.started`, one or more `reply.delta`, `reply.completed` arrive and the completed message has `role: PATIENT` (FR-3, FR-4).
- AC-2: Given the opening was delivered, When `POST .../messages {text:"  Hello  "}`, Then 201 with `text:"Hello"` and `role: THERAPIST` (FR-1).
- AC-3: Given a message was posted, When the stream is opened, Then deltas arrive in `index` order and the joined text equals `message.text` of `reply.completed` (FR-3, NFR-2).
- AC-4: Given a reply is pending, When another `POST .../messages`, Then 409 `reply-pending`; given the session is ended, When a message is posted or the stream is requested, Then 409 `session-ended` (FR-2).
- AC-5: Given `text` is "   " or longer than 2000 characters, When posted, Then 400 `invalid-request` with `TOO_SHORT` / `TOO_LONG`; an extra unknown property (such as `role`) is ignored (FR-1, FR-2).
- AC-6: Given the last message is from the patient, When the stream is requested, Then 409 `no-reply-pending`; given a generation is in progress, Then a second stream request gets 409 `reply-pending` (FR-4).
- AC-7 (**DEFERRED**): Given the generated reply ends the session, When the stream is consumed, Then `reply.completed` is followed by `session.ended` with `status: ENDED_BY_PATIENT`, the stream closes, and `GET /sessions/{id}` shows `ENDED_BY_PATIENT` and the case is completed (FR-6).
- AC-8: Given the client drops the connection mid-reply, When `GET .../messages` is read, Then no patient message for that reply exists; When the stream is requested again, Then a new generation starts and exactly one patient message is stored (FR-5, FR-4).
- AC-9: Given generation fails mid-reply, When the error occurs, Then an `error` event of type `reply-generation-failed` with `flow_id` arrives, the stream closes, and no partial message is stored (FR-5, FR-11).
- AC-10: Given no progress for 15 s, When it elapses, Then `error` is sent and the stream closes; given generation takes longer than 15 s, Then `: keep-alive` comments arrive at <= 15 s intervals (FR-7).
- AC-11: Given a fake generator that returns 2,501 characters, When the reply is requested, Then an `error` event of type `reply-generation-failed` is sent and nothing is stored; given exactly 2,500, Then it is stored (FR-8). Language correctness itself is verified manually against the real agent (HUMAN-REQUIRED), not by an automated test.
- AC-12 (**moved**; needs the real agent, see chat-simulation/07 AC-9 and HUMAN-REQUIRED): Given a fixed per-language set of in-fiction role-change attempts and the documented content policy test set (sensitive disclosures, sincere "are you real/AI?" questions, requests for clinical advice), When replies are generated, Then each meets its documented expected outcome (FR-9, FR-10).
- AC-13: Given the session is ended by PATCH during streaming, When the stream is open, Then it terminates without `reply.completed` and no patient message is stored (with 01 FR-4).
- AC-14: Given any request or stream, When logs are inspected, Then no message text or prompt content appears (NFR-3, FR-11).
- AC-15: Given reply failures are injected (generation failure, connection drop, server restart mid-reply), When `GET .../messages` is read afterwards, Then it contains only completed messages, in order, with no partial or duplicate patient message (NFR-4).
- AC-16: Given the service is deployed behind the production proxy chain, When a reply streams, Then each event is received by a test client <= 500 ms after the server emitted it (NFR-5). (Needs a deployed environment; if not available, log it in HUMAN-REQUIRED and instead assert in e2e that response headers disable buffering, e.g. `X-Accel-Buffering: no`, and that the first chunk is flushed before generation ends.)
- AC-17: Given two concurrent `patient-replies` requests for one session, When both start, Then exactly one streams and the other gets 409 `reply-pending`, and after the first ends a new request is accepted (FR-12).
- AC-18: Given the generator fails, When the client requests the reply again, Then the therapist message is not duplicated and exactly one patient message is stored on success (FR-13).

## Open questions
- OQ-1: The stream needs an `Authorization` header and `POST`, which native `EventSource` supports neither; client constraint, see app/chat-simulation/03.
