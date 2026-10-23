# Chat Simulation backend: progress ledger

Order (serial, branch `feat/chat-simulation`): 06 (case-to-agent mapping, case-library side) -> 01 (sessions) -> 02 (messages and streaming, against the fake generator) -> 07 (OpenAI adapter and remote-session cleanup) -> 05 (retention job and privacy checks).

Specs 03 and 04 of this milestone are app-side and are not part of this ledger.

| Task | Status | Commit | Notes |
|---|---|---|---|
| 06 case-patient-agent-mapping | done | 4373cbc | lint/test/arch/integration/e2e green. Seed also rejects an id for a language with no content. Real agent ids still human-required. |
| 01 session-lifecycle-api (includes cleanup queue + worker with a fake remover) | done | 277f0b3 | Patient-ended parts (FR-5, AC-8) deferred by decision. |
| 02 patient-message-exchange-streaming (fake generator only) | done | f66d852 | `session.ended`, FR-6, AC-7 deferred; AC-12 moved to 07/HUMAN-REQUIRED. |
| 07 openai-agents-reply-generator | todo | | Contract tests against a fake client only; no real OpenAI calls by agents. |
| 05 transcript-privacy-and-retention | todo | | Accepted deviations: OpenAI retention, US-only residency. |

## Spec conflicts and assumptions (running list)

- Routes are written without the global `/api/v1` prefix in the specs; the real routes carry it.
- 01 FR-5, AC-8 and 02 FR-6, AC-7 (patient ends the session) are deferred: the agent has no tools. The `ENDED_BY_PATIENT` enum value and the `session.ended` event name stay in the contract.
- 05 FR-10, NFR-5 and AC-12 are accepted deviations (OpenAI Agents API keeps session state, US-only residency).
- 01: the `messages` table (with identity `seq` for stable ordering) is created in the 01 migration so session `stats` are real and discard cascades; task 02 builds its repository on it and may add columns in a later migration. `openai_session_id` and `remote_in_sync` (07) are also in the 01 migration, as 07 itself suggests.
- 01: account-disabled (FR-9, AC-12) is enforced for every route by the existing token verifier / auth guard, so there is no session-specific check and no session-specific e2e test (the Firebase emulator cannot disable users in a way the verifier sees before token expiry, see AGENTS.md password-reset/auth notes).
- 01: `Location` carries the real prefixed path (`/api/v1/sessions/{id}`). `DELETE` of a non-decodable path id is a 204 (filter special case), GET/PATCH of one is `session-not-found`.
- 01: the cleanup worker's remover is a clearly named placeholder (`UnconfiguredRemoteSessionRemover`) and the generation canceller a no-op until tasks 07 and 02; the problem types `reply-pending`, `no-reply-pending` and `reply-generation-failed` are added by task 02, not 01.
- 01: cross-module atomicity uses an ambient `AsyncLocalStorage` transaction (`platform/database/transaction-context.ts`); case-library's completion repository was changed to join it.
- 01 NFR-1 asks for the session id in request logs; the shared request logger logs the route template only, so the session id is deliberately NOT logged (privacy-conservative).
- An unauthenticated `DELETE /sessions/<undecodable id>` answers 204 (router-level error handled in the filter, same as the case-id precedent) rather than 401; it reveals nothing.
- Test gaps accepted for 01 (review, non-blocking): no concurrent DELETE-vs-PATCH / create-vs-end test, no failure injected inside `deletions.enqueue`, no test that the ambient tx context does not outlive a failed unit of work, and no sessions-route test for 403 `account-disabled`.
- Task 07 MUST replace the `UnconfiguredRemoteSessionRemover` binding and `TypeOrmSessionRepository.save` must be used under `lockOwned` (or column-specific updates) when 07 writes `openai_session_id` / `remote_in_sync`. Task 02 must bind a real `SessionGenerationCanceller`.
- Do not start background work inside `UnitOfWork.run`: it would inherit the ambient transaction manager.
- 02: FR-6, AC-7 (`session.ended`), and AC-12 (moved to 07/HUMAN-REQUIRED) are not implemented. The `session.ended` event name is documented in OpenAPI as reserved.
- 02: the `PatientReplyGenerator` port yields `remote-session` / `text` / `completed` chunks. The APPLICATION layer persists `openai_session_id` (before forwarding any later text), sets `remote_in_sync=false` before each generation and back to true only when the reply is stored, and queues a replaced remote session for deletion (via the 01 queue). Spec 07 describes the adapter doing this (FR-3, AC-1, AC-4, AC-5, AC-6); task 07 should instead yield `remote-session` (before the first text; a new id on recovery) and honour the abort signal (abort the stream, best-effort `input.cancel`), and assert those chunks in its contract tests. This keeps the adapter free of persistence and covers crash/restart mid-reply (the flag is false from the start of every generation).
- 02: the port request carries `history` (stored messages BEFORE the pending one, not including it) and `pending` (the therapist message, or null for the opening). On `remoteInSync=false` or a null `openaiSessionId` with messages present the adapter must start a new remote session and replay `history` + `pending` (spec 07 Recovery).
- 02: when a session is ended or discarded mid-stream the stream closes with NO terminal event (spec AC-13: "terminates without `reply.completed`"), which clients treat as interrupted. A stream is also closed silently if the connection drops.
- 02: the 15 s limits are enforced by the application layer: "no progress" means no text delta (not a `remote-session` chunk); keep-alive is sent when nothing was written for 15 s. The `REPLY_TIMINGS` provider exists so e2e can shorten them.
- 02: therapist text length is counted in Unicode code points (not UTF-16 units), after trimming; text containing NUL is `invalid-request` (`INVALID_VALUE`) because PostgreSQL cannot store it; a patient reply that is whitespace-only, contains NUL, or does not end with the `completed` marker fails as `reply-generation-failed`.
- 02: a client disconnect after the reply was committed but before `reply.completed` is delivered leaves a stored patient message the client has not seen; the client reconciles with `GET .../messages` (and `patient-replies` then answers `no-reply-pending`).
- 02: the stream log line includes the session id (NFR-3), unlike the request logger (01 decision); it is an opaque id and the session is known to exist.
- 02: AC-15 "server restart mid-reply" is covered by design (nothing is stored before completion, asserted in e2e by reading `GET .../messages` mid-generation), not by restarting the process. AC-16 needs a deployed proxy chain (HUMAN-REQUIRED); e2e asserts `X-Accel-Buffering: no` and that the first delta is flushed before generation ends.
- 02 review gap from 01 closed: integration test that the ambient transaction context does not outlive a failed unit of work.

- 02: spec FR-7 sets both the idle time-out and the keep-alive interval to 15 s, so a stall would fail at the same instant a keep-alive is due. Resolved conservatively: idle time-out 15 s, keep-alive 10 s (still "<= 15 s intervals", AC-10), so a keep-alive always precedes a time-out; `DEFAULT_REPLY_TIMINGS` is tested for that ratio.
- 02: the claim distinguishes `finish()` (normal end, signal NOT aborted, so a task-07 adapter sees no spurious abort/cancel after `completed`) from `release()` (aborts). The slot is freed before an `error` event is handed to the consumer. A remote session announced by a chunk that was never consumed (abort/time-out/persist failure) is queued for deletion in its own unit of work. The SSE writer gives up on a client that does not drain within 15 s (destroys the response, which cancels the reply).
