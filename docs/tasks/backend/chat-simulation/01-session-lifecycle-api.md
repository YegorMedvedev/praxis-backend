# 01 Session lifecycle API

- **Milestone:** Chat simulation
- **Screens covered:** Chat, Chat session (options sheet), Chat patient ended (lifecycle only; UI is in 03)
- **Depends on:** backend/signup-login/06 (authenticated API foundation: bearer auth, problem format, `X-Flow-ID`, rate limiting)
- **Type:** BE

## Description
Defines the **session** resource: one practice conversation between one learner and the virtual patient of one case, in one language. The API creates a session, returns it, ends it (by the therapist), discards it (leave or restart), and records when the patient ends it (signalled through the stream in 02). A session is **not resumable after an app restart**: the app keeps the session id in memory only. When a session ends, the case becomes **completed** for the learner, server-side. The session-summary and feedback milestones rely on the `Session` shape and `stats` defined here.

## Scope
**In scope:** `Session` resource, states and transitions, create / get / end / discard, one-session-per-case rule, completion side effect, transcript retention hooks (rules in 05).
**Out of scope:** messages and streaming (02), screen behaviour (03), feedback (session-feedback milestone), case content and listing (case-library), idempotency keys, inactivity expiry (an abandoned session is removed when a new session is created for the same case, or by the 90-day retention).

## APIs
All endpoints: `Authorization: Bearer <Firebase ID token>`, `X-Flow-ID` per signup-login/06. Responses carry `Cache-Control: no-store`. A session belonging to another user is reported as 404 `session-not-found` (no enumeration). Shared problem types are reused from signup-login/06.

### `Session` resource
| Field | Type | Notes |
|---|---|---|
| `id` | string | opaque |
| `case_id` | string | the case being practised |
| `language` | string | `en` or `ru` (lowercase locale codes). Fixed for the session lifetime. |
| `status` | enum | `IN_PROGRESS`, `ENDED_BY_THERAPIST`, `ENDED_BY_PATIENT` |
| `created_at` | RFC 3339 UTC | |
| `ended_at` | RFC 3339 UTC or `null` | `null` while `IN_PROGRESS`. For `ENDED_BY_THERAPIST`: the time the PATCH was committed. For `ENDED_BY_PATIENT`: the time the patient's closing message was committed, which is before the stream finishes. |
| `stats` | object | `therapist_message_count` (int), `patient_message_count` (int), `duration_seconds` (int >= 0, `null` while `IN_PROGRESS`, else `ended_at - created_at` in whole seconds, rounded down), `ended_by` (`THERAPIST` \| `PATIENT` \| `null`) |

`GET /sessions/{id}` is the **single source of summary data** (there is no separate summary endpoint; see session-feedback/01). For an ended session all `stats` fields are non-null (`patient_message_count` includes the patient's closing message) and the body is identical on repeated calls. Counts include stored (completed) messages only.

State transitions: `IN_PROGRESS -> ENDED_BY_THERAPIST` (PATCH below), `IN_PROGRESS -> ENDED_BY_PATIENT` (stream event `session.ended`, see 02). Ended states are terminal. Discard removes the session (it is not a state).

### `POST /sessions`
Creates a session for a case and discards every other session of this user for the same case, in any status (FR-3).
- Request (`application/json`): `case_id` (string, required), `language` (`en` \| `ru`, required). Unknown properties are ignored.
- 201 + `Location: /sessions/{id}`, body `Session` (`status: IN_PROGRESS`, no messages yet; the patient's opening message is fetched through the stream in 02).
- Errors: 400 `invalid-request` (`REQUIRED`, `INVALID_TYPE`, `INVALID_VALUE`); 401; 403 `account-disabled`; 404 `case-not-found` (owned by case-library/02); 429; 5xx.

### `GET /sessions/{session_id}`
- 200 `Session`. Errors: 401; 404 `session-not-found` (unknown, not owned, discarded or deleted); 429; 5xx.

### `PATCH /sessions/{session_id}`
Ends the session as the therapist. Idempotent.
- Request (`application/json`): body `{ "status": "ENDED_BY_THERAPIST" }` (the only accepted `status` value; any other value: 400 `invalid-request`).
- 200 `Session`: from `IN_PROGRESS` (transition happens, `ended_at` set) and when already `ENDED_BY_THERAPIST` (unchanged).
- Errors: 401; 404 `session-not-found`; 409 `session-ended` (session is already `ENDED_BY_PATIENT`; the client then GETs the session and treats it as ended by the patient); 429; 5xx.

### `DELETE /sessions/{session_id}`
Discards the session and its transcript (leave screen, restart). Idempotent.
- 204 when deleted; 204 also when it no longer exists or belongs to another user. Works for any status. Does **not** undo case completion (FR-6).
- Errors: 401; 429; 5xx.

### Problem types owned by this feature
| `type` | Status | Meaning | Client i18n key |
|---|---|---|---|
| `/problems/session-not-found` | 404 | unknown, not owned, discarded (by DELETE, restart, practice again or a new session for the case) or deleted by retention; identical in all cases; applies equally to ended sessions | `chat.error.sessionGone` in chat; `sessionSummary.unavailable*` on the summary/feedback screens |
| `/problems/session-ended` | 409 | operation needs `IN_PROGRESS` | none (client reconciles by GET) |

## Functional requirements
- FR-1: The system shall create a session with status `IN_PROGRESS` for an existing case, storing the `language` given at creation; the language shall not change afterwards.
- FR-2: The system shall expose the states `IN_PROGRESS`, `ENDED_BY_THERAPIST`, `ENDED_BY_PATIENT` only; an ended session shall never return to `IN_PROGRESS`.
- FR-3: When a session is created, the system shall discard every other session of the same user and case, in any status, including ended ones, even if feedback was not sent (product-owner decision). Case completion is unaffected (FR-6).
- FR-4: The system shall end a session on `PATCH` with `ENDED_BY_THERAPIST`, set `ended_at`, and, if a patient reply is being generated, cancel it and not store any partial reply (see 02). `PATCH` is idempotent for an already `ENDED_BY_THERAPIST` session and answers 409 `session-ended` for an `ENDED_BY_PATIENT` session.
- FR-5: The system shall move a session to `ENDED_BY_PATIENT` in the same operation that commits the patient's closing message (02), setting `ended_at` to that commit time, before the stream delivers `reply.completed` and `session.ended`; so a client that reads the session after any stream failure sees the ended state.
- FR-6: The system shall mark the case completed for the user atomically with the move of a session to `ENDED_BY_THERAPIST` or `ENDED_BY_PATIENT`, without any client call; the mark is idempotent and survives discard of the session and deletion of the transcript (05). It shall not be set when an `IN_PROGRESS` session is discarded.
- FR-7: The system shall return `stats` on every `Session`, with message counts equal to the number of stored messages per role and `duration_seconds` per the table.
- FR-8: The system shall make `DELETE` remove the session so that it and its messages are no longer retrievable through any endpoint after the response, including ended sessions (`GET /sessions/{id}`, the summary data and feedback then return 404 `session-not-found`, session-feedback/01 FR-4).
- FR-9: The system shall report sessions of other users as `session-not-found`, never as 403, and shall reject creating a session when the user's account is disabled (`account-disabled`).

## Non-functional requirements
- NFR-1: Logs include `flow_id`, method, route template, status, latency, session id; never message text, names or emails.
- NFR-2: Completion marking (FR-6) is atomic with the state change: no response of 200 exists for an ended session whose case is not completed.
- NFR-3: The API returns no user-facing text; problem types are stable. Rate limiting follows signup-login/06.

## Acceptance criteria
- AC-1: Given a valid token and case, When `POST /sessions {case_id, language:"ru"}`, Then 201, `Location`, `status: IN_PROGRESS`, `language: ru`, `ended_at: null`, `stats.duration_seconds: null` (FR-1, FR-7).
- AC-2: Given an unknown `case_id`, When `POST /sessions`, Then 404 `case-not-found`; given `language:"de"`, Then 400 with `invalid_params` `language` `INVALID_VALUE` (FR-1).
- AC-3: Given a session A for case X in any status (including ended), When a new session B is created for X, Then B is `IN_PROGRESS`, `GET` of A returns 404 `session-not-found`, and the case stays completed if A had ended (FR-3, FR-6).
- AC-4: Given an `IN_PROGRESS` session, When `PATCH {status:"ENDED_BY_THERAPIST"}`, Then 200 with that status, `ended_at` set, `stats.ended_by: THERAPIST`, `duration_seconds` an integer, and the case is completed for the user (FR-2, FR-4, FR-6).
- AC-5: Given an `ENDED_BY_THERAPIST` session, When the same PATCH is repeated, Then 200 with an identical body; given an `ENDED_BY_PATIENT` session, Then 409 `session-ended` (FR-4).
- AC-6: Given `PATCH {status:"IN_PROGRESS"}` or `{status:"ENDED_BY_PATIENT"}`, When sent, Then 400 `invalid-request` (FR-2).
- AC-7: Given a patient reply is being streamed, When PATCH ends the session, Then the stream terminates, no partial patient message is stored, and `patient_message_count` excludes it (FR-4, FR-7; with 02).
- AC-8: Given the patient ended the session (02 `session.ended`), When `GET /sessions/{id}`, Then `status: ENDED_BY_PATIENT`, `stats.ended_by: PATIENT`, `ended_at` is the closing-message commit time, `patient_message_count` includes it, and the case is completed, even while the stream is still delivering (FR-5, FR-6).
- AC-9: Given an `IN_PROGRESS` session, When it is deleted, Then 204, GET returns 404, and the case is not completed; given an ended session whose case is completed, Then the case stays completed (FR-6, FR-8).
- AC-10: Given a repeated DELETE, a DELETE of a foreign id, or a GET/PATCH of another user's id, Then DELETE returns 204 with no information about existence and GET/PATCH return 404 `session-not-found` (FR-8, FR-9).
- AC-11: Given a session with 3 therapist and 3 patient messages ended after 125.7 s, When GET, Then counts are 3 and 3 and `duration_seconds` is 125; repeated GETs of an ended session return identical bodies (FR-7).
- AC-12: Given a disabled account, When `POST /sessions`, Then 403 `account-disabled` (FR-9).
- AC-13: Given a session end is committed, When the case is read in the same instant (including under concurrent ends and an injected failure between the two writes), Then no ended session exists whose case is not completed (NFR-2).
- AC-14: Given any request, When logs are inspected, Then no message text appears and a `flow_id` is present (NFR-1).

## Open questions
- None.
