# Chat Simulation backend: progress ledger

Order (serial, branch `feat/chat-simulation`): 06 (case-to-agent mapping, case-library side) -> 01 (sessions) -> 02 (messages and streaming, against the fake generator) -> 07 (OpenAI adapter and remote-session cleanup) -> 05 (retention job and privacy checks).

Specs 03 and 04 of this milestone are app-side and are not part of this ledger.

| Task | Status | Commit | Notes |
|---|---|---|---|
| 06 case-patient-agent-mapping | done | 4373cbc | lint/test/arch/integration/e2e green. Seed also rejects an id for a language with no content. Real agent ids still human-required. |
| 01 session-lifecycle-api (includes cleanup queue + worker with a fake remover) | todo | | Patient-ended parts (FR-5, AC-8) deferred by decision. |
| 02 patient-message-exchange-streaming (fake generator only) | todo | | `session.ended`, FR-6, AC-7 deferred; AC-12 moved to 07/HUMAN-REQUIRED. |
| 07 openai-agents-reply-generator | todo | | Contract tests against a fake client only; no real OpenAI calls by agents. |
| 05 transcript-privacy-and-retention | todo | | Accepted deviations: OpenAI retention, US-only residency. |

## Spec conflicts and assumptions (running list)

- Routes are written without the global `/api/v1` prefix in the specs; the real routes carry it.
- 01 FR-5, AC-8 and 02 FR-6, AC-7 (patient ends the session) are deferred: the agent has no tools. The `ENDED_BY_PATIENT` enum value and the `session.ended` event name stay in the contract.
- 05 FR-10, NFR-5 and AC-12 are accepted deviations (OpenAI Agents API keeps session state, US-only residency).
