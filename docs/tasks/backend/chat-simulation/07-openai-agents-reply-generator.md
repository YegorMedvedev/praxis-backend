# 07 OpenAI Agents reply generator

- **Milestone:** Chat simulation
- **Screens covered:** Chat (typing indicator and streamed patient text), indirectly
- **Depends on:** backend/chat-simulation/01 (session row, cleanup queue), 02 (the `PatientReplyGenerator` port and fake), 06 (agent id resolution)
- **Type:** BE

## Description
Implements the `PatientReplyGenerator` port from chat-simulation/02 with the **OpenAI Agents API** (`client.beta.agents.sessions`), and the `AgentSessionRemover` used by the cleanup worker from chat-simulation/01 FR-10. The patient is a pre-created OpenAI agent that has instructions and **no tools**; it is selected per session by the `agent_id` resolved in 06. This is the only place in the codebase that knows about OpenAI.

## Background (verified against OpenAI's docs on 2026-10-23; re-verify against the installed SDK types, the API is beta)
- The product owner's working snippet:

  ```ts
  const events = await client.beta.agents.sessions.create({
    agent: { id: 'agent_...' },
    input: 'Hello!',
    stream: true,
  });
  events.withResultCollection();
  try {
    for await (const event of events) { /* ... */ }
    const result = await events.finalResult();
    // result.output_text, result.session_id
  } finally {
    events.controller.abort();
  }
  ```

  OpenAI's configuration guide documents a saved agent as `agent_id: '...'` (optionally with an `agent` object of per-session overrides) while the snippet above uses `agent: { id }`. **Use whichever form the installed `openai` package types accept and that works; prefer the snippet's form.** Do not pass overrides: the agent's saved instructions are authoritative.
- A session is a durable remote conversation. A turn is one unit of work. Sending a message to an idle session starts a turn; sending during an active turn **steers** it (so the backend, not OpenAI, must enforce one generation at a time: 02 FR-12).
- Follow-up messages: open the event stream, then send `agent.session.input.message` through `client.beta.agents.sessions.events.create(sessionId, { events: [...] })` with an `Idempotency-Key`. Subscribe before sending. The SDK also has a `sessions.stream(sessionId, ...)` helper; read the installed types.
- Cancel the active turn with an `agent.session.input.cancel` event. Delete a session with the SDK's delete call (cleanup may continue asynchronously on OpenAI's side).
- Streams do **not** replay missed events. After a disconnect the only recovery is to read the session and its items, or to start over.
- Streaming events used: `agent.session.turn.output_text.delta` (`delta`, `item_id`, `output_index`, `content_index`), `agent.session.turn.output_text.done` (`text`, same keys), `agent.session.turn.completed` / `.failed` / `.cancelled` (`turn`, `turn.error.{code,message}`, `turn.subagent_id`), `agent.session.failed`, `agent.session.environment.failed`, and a plain `error` event. Deltas may be absent; the `done` text is authoritative. Events carry `session_id`.
- Docs: https://developers.openai.com/api/docs/guides/agents-api/overview , `.../sessions` , `.../sessions/events` , `.../sessions/manage` , `.../configuration` , and the streaming events reference under https://developers.openai.com/api/reference/resources/beta/subresources/agents/streaming-events . Read them first; they change.

## Scope
**In scope:** the `openai` dependency and client factory, config, the generator and remover adapters, event mapping, cancellation, out-of-sync recovery, error classification, a **contract test suite against a fake OpenAI client** (the SDK client behind a small interface), and an opt-in smoke test.
**Out of scope:** creating or editing agents, prompts and agent instructions, the content policy, session end by the patient (deferred), tools of any kind, webhooks, retrieving items for display (our database is the source of truth), usage/cost reporting.

## Design

### Source of truth
Our database holds the transcript. The remote session is a **cache of the conversation** that lets the agent keep context without resending everything. The session row has `openai_session_id` (nullable) and `remote_in_sync` (boolean, default true). Add both to the 01 migration/entity if 01 is already merged, otherwise coordinate in one migration.

### Reply flow
1. **Opening** (no stored messages): create a remote session with the session's `agent_id`, `environment: { type: 'none' }` (confirm this is accepted for the user's agent; see OQ-1), `stream: true`, and `input` = the opening input for the session language (constant `PATIENT_OPENING_INPUT`, one string per language, kept in a single file; placeholder text, see OQ-2). **Persist `openai_session_id` as soon as the first event carrying `session_id` arrives, before any text is forwarded.**
2. **Reply** (a pending therapist message): if `remote_in_sync` is true and `openai_session_id` is set, open the stream on that session and send the therapist's text as one `agent.session.input.message` (`input_text` content), with an idempotency key derived from the therapist message id (stable across retries of the same message).
3. **Recovery**: if `remote_in_sync` is false, or `openai_session_id` is null for a session that already has messages, **do not reuse the remote session**: enqueue the old remote session for deletion (same queue as 01 FR-10), create a new remote session, and send the whole stored transcript plus the pending message as a single input, formatted by one pure function `formatTranscriptForReplay` (role-labelled lines in chronological order; unit tested; placeholder format, see OQ-2). Persist the new `openai_session_id` and set `remote_in_sync = true` once the first event arrives.
4. Set `remote_in_sync = false` whenever a generation ends without `reply.completed` after the input was sent (failure, timeout, client disconnect, cancel). This is deliberately conservative: it guarantees no duplicate therapist message in the remote history without relying on undocumented behaviour. A later optimisation (keep the session in sync after a clean cancel) needs the spike in OQ-3 and is **not** part of this task.

### Event mapping to the port
| OpenAI event | Port behaviour |
|---|---|
| first event with `session_id` | persist `openai_session_id` (step 1) |
| `...output_text.delta` (root agent) | yield a text chunk |
| `...output_text.done` | remember the authoritative text for that part |
| `...turn.completed` (root turn: `turn.subagent_id` empty) | finish successfully; if no deltas were seen yield one chunk with the `done` text first; if deltas were seen and their concatenation differs from the `done` text, fail (never silently reconcile) |
| `...turn.failed`, `...turn.cancelled`, `agent.session.failed`, `agent.session.environment.failed`, `error`, stream ends before a root turn outcome, SDK/network/HTTP error | fail with `REPLY_GENERATION_FAILED`, class/code logged, provider message never forwarded |
| `agent.session.requires_action` | fail (the agent has no tools; this should not happen) and log the event type |
| everything else (reasoning, items, usage, subagent events) | ignored |

When the turn has several text parts, concatenate them in `(output_index, content_index)` order.

### Cancellation
When the port's `AbortSignal` fires: abort the HTTP stream (`controller.abort()`), best-effort send `agent.session.input.cancel` for the session (errors swallowed and logged by class), mark `remote_in_sync = false`. Never leave the iteration loop running after abort.

### Errors and logging
Map: 429/5xx/network/timeouts from OpenAI -> `REPLY_GENERATION_FAILED` (02 maps it to 502, or to 503 `service-unavailable` before the stream starts when the dependency is down). 401/403 from OpenAI (bad key) -> `REPLY_GENERATION_FAILED` plus a distinct log event `openai_auth_failed` so operators can alert. Log only: flow id, session id, event type counts, durations, OpenAI request id and HTTP status, error class and code. **Never** log input text, output text, replay transcripts, provider error messages or the API key (conventions and 05 FR-9). Do not enable SDK debug logging in any environment.

### Config
- `OPENAI_API_KEY`: required, secret, no default, validated at boot like the other required variables in `platform/config`, added to `.env.example` and to the test environments (a dummy value; e2e binds the fake generator and must never call OpenAI).
- Optional `OPENAI_BASE_URL` only if the SDK needs it for tests; otherwise do not add it. No per-request timeout variable: timeouts are owned by the application layer (02 FR-7). Set the SDK's own retries to 0 for streaming calls (a retry could duplicate input; retries are the client's decision via "Try again").
- Update `AGENTS.md` with an "OpenAI configuration" section in the style of the Firebase section, including the accepted trade-offs (retention, US residency, single-instance single-flight).

## Functional requirements
- FR-1: The adapter shall implement `PatientReplyGenerator` using only the OpenAI Agents API and shall live in `chat-simulation/infrastructure/`; no OpenAI type or import outside it (`pnpm test:arch` must enforce that `openai` is imported only there).
- FR-2: The adapter shall select the agent from the session's stored `agent_id` and shall not pass instructions, tools or other overrides.
- FR-3: The adapter shall implement the reply flow, recovery and `remote_in_sync` rules above.
- FR-4: The adapter shall map events per the table and stream text chunks as they arrive, without buffering the whole reply.
- FR-5: The adapter shall honour the `AbortSignal` as specified and shall not leave open streams.
- FR-6: The adapter shall persist `openai_session_id` before forwarding the first text chunk.
- FR-7: The `AgentSessionRemover` adapter shall delete a remote session by id, treat "not found" as success, and surface other failures so the worker retries.
- FR-8: No input or output text, replay transcript, provider message or secret shall appear in logs, traces, metrics or error bodies.

## Non-functional requirements
- NFR-1: Time to first text is dominated by the model; measure and log time-to-first-delta (ms) per reply. The 3 s p95 target (02 NFR-1) is checked against the real agent (HUMAN-REQUIRED), not in CI.
- NFR-2: All CI tests run against a fake of the small `OpenAiAgentsClient` interface the adapter depends on; CI never uses the network or a real key.
- NFR-3: The adapter holds no per-process state besides the SDK client.

## Acceptance criteria
- AC-1: Given a fake client emitting `delta("Hel")`, `delta("lo")`, `done("Hello")`, `turn.completed`, Then the port yields a `remote-session` chunk carrying the session id, then "Hel", "lo", and completes; the application layer (02) persists `openai_session_id` on that chunk before forwarding later text (FR-3, FR-4, FR-6).
- AC-2: Given a fake emitting only `done("Hello")` and `turn.completed`, Then one chunk "Hello" is yielded (FR-4).
- AC-3: Given deltas "Hel","lo" and `done("Hello!")`, Then the generation fails with `REPLY_GENERATION_FAILED` (FR-4).
- AC-4: Given each of `turn.failed`, `turn.cancelled`, `agent.session.failed`, `error`, a stream that ends early, an HTTP 429, an HTTP 500 and a network error, Then the generation fails with `REPLY_GENERATION_FAILED` and no provider message appears in the error or logs; `remote_in_sync` is false from the start of every generation and true only once the reply is stored, which the application layer (02) owns and tests (FR-4, FR-8).
- AC-5: Given a failed generation followed by a retry, Then the adapter creates a new remote session (announced by a `remote-session` chunk, so the application layer enqueues the old one for deletion), sends the full transcript through `formatTranscriptForReplay`, and the therapist message appears once in that input (FR-3).
- AC-6: Given `AbortSignal` fires mid-stream, Then the fake observes the stream abort and an `input.cancel` attempt, the loop ends (an abort after `completed` is ignored), and a failing cancel call does not throw; `remote_in_sync` stays false because the application layer cleared it before the generation (FR-5).
- AC-7: Given a follow-up reply with `remote_in_sync = true`, Then the fake sees the stream opened before the input event was sent, exactly one `agent.session.input.message` carrying only the pending therapist text, and a stable idempotency key per therapist message id (FR-3).
- AC-8: Given the remover with a fake that returns "not found", Then it succeeds; given a 500, Then it throws and the queue worker retries (FR-7).
- AC-9: Opt-in smoke test `pnpm test:agents` (excluded from `test:all`, skipped unless `OPENAI_API_KEY` and `SMOKE_AGENT_ID_EN` / `SMOKE_AGENT_ID_RU` are set, never run by an agent): opens a real session per language, sends two messages, asserts a non-empty streamed reply, cleans up the remote session, and prints (never asserts on) whether the reply language matches. The product owner runs it (HUMAN-REQUIRED).
- AC-10: `pnpm test:arch` fails if any file outside `chat-simulation/infrastructure/` imports `openai` (FR-1).
- AC-11: A log scan of the contract tests with unique marker strings in input and output finds none (FR-8).

## Open questions
- OQ-1: Whether the user's agent accepts `environment: { type: 'none' }` (the docs do not call it "chat only"). If the API rejects it, use the least-privileged environment the API accepts and record it in the final report.
- OQ-2: The placeholder opening input per language and the transcript replay format are prompt-like text the product owner should approve (HUMAN-REQUIRED). Implement them as clearly marked constants.
- OQ-3: Spike for later optimisation: does a cancelled or failed turn leave its input in the remote session history, and can a retry safely reuse it? Not part of this task; needs the real agent.
- OQ-4: Whether `agent` or `agent_id` is accepted by the installed SDK version; resolve by reading the SDK types, and record which was used.
