# Chat Simulation backend: progress ledger

Order (serial, branch `feat/chat-simulation`): 06 (case-to-agent mapping, case-library side) -> 01 (sessions) -> 02 (messages and streaming, against the fake generator) -> 07 (OpenAI adapter and remote-session cleanup) -> 05 (retention job and privacy checks).

Specs 03 and 04 of this milestone are app-side and are not part of this ledger.

| Task | Status | Commit | Notes |
|---|---|---|---|
| 06 case-patient-agent-mapping | done | 4373cbc | lint/test/arch/integration/e2e green. Seed also rejects an id for a language with no content. Real agent ids still human-required. |
| 01 session-lifecycle-api (includes cleanup queue + worker with a fake remover) | done | PENDING | Patient-ended parts (FR-5, AC-8) deferred by decision. |
| 02 patient-message-exchange-streaming (fake generator only) | todo | | `session.ended`, FR-6, AC-7 deferred; AC-12 moved to 07/HUMAN-REQUIRED. |
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
