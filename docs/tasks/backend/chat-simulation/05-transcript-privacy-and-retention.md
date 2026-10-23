# 05 Transcript retention and privacy

- **Milestone:** Chat simulation
- **Screens covered:** none (transcript handling behind all four chat screens)
- **Depends on:** backend/chat-simulation/01, 02, 07 (the OpenAI session cleanup queue and worker from 01 FR-10 / 07 are reused here)
- **Type:** BE

> **Accepted deviations (product owner, 2026-10-23; see `_shared/conventions.md` "Chat simulation: OpenAI Agents API"):** the patient is played by an OpenAI Agents API agent. That API (a) retains session state at OpenAI and does **not** support zero data retention, (b) currently offers data residency in the United States only, and (c) keeps the transcript in the remote session until the session is deleted, with physical cleanup asynchronous. The product owner knowingly accepts that this does not meet FR-10 (no-retention contract), NFR-5 (EU/EEA) and AC-12 as originally written. Do not treat them as blockers and do not re-raise them as spec conflicts; implement the mitigations below and list the deviations in the final report as "accepted".

> Educational issue-spotting only, not legal advice. GDPR points are signposts, not assessments. EU AI Act points are in app/chat-simulation/05 (disclosure) and the open question below.

## Description
Fixes how chat transcripts are retained, deleted, kept out of logs and protected, and how the AI patient is processed by third parties. The FR numbers are kept from the original combined spec because other specs reference them (FR-1 to FR-5, FR-12, FR-13, FR-15 are in app/chat-simulation/05).

## Scope
**In scope:** transcript retention (90 days), deletion on discard, manual erasure on request, content-free logging, third-party processing requirements at product level, human access to transcripts.
**Out of scope:** the legal assessment itself, Terms/Privacy Policy text, data export, learner-content moderation policy, model training (excluded by conventions), the AI notice (app).

## APIs
None new. Behaviour attaches to `DELETE /sessions/{id}` (backend/chat-simulation/01) and the retention rule below. Erasure of a whole user is a manual operational process (a user emails a request); it is not an API or app feature.

## Functional requirements
- FR-6: The system shall delete the transcript (all messages) of every session no later than 90 days after the session's `created_at` (the retention clock starts at session creation), or earlier on discard; after deletion the whole session resource, including its stats, is no longer retrievable (404 `session-not-found`). Case completion is not affected (01 FR-8).
- FR-7: The system shall make `DELETE /sessions/{id}` unretrievable through the API at once and erase the transcript from all persistent stores within 30 days of the deletion (including backups). For the remote OpenAI session this means: deletion is requested through the cleanup queue (01 FR-10) and retried until OpenAI confirms; OpenAI's own backups and asynchronous physical cleanup are outside our control (accepted deviation).
- FR-8: A user's sessions and transcripts shall be erasable on request by the operator (manual process, outside the app and API); the erasure shall cover backups within 30 days. The operator procedure must also enqueue deletion of every remote OpenAI session of the user. Provide a documented script or SQL runbook (`docs/runbooks/` or the README) that deletes the user's sessions and enqueues their `openai_session_id`s; there is still no API for it.
- FR-18: The retention job (FR-6) shall, for every session it deletes, enqueue the session's `openai_session_id` in the same transaction as the deletion, so the remote transcript is deleted no later than the next worker run after the local one. A reconciliation step is out of scope; leaked remote sessions (for example from a crash between creating the remote session and persisting its id) are listed as a known gap: the adapter must persist `openai_session_id` immediately when it is received, before streaming text.
- FR-9: The system shall not write message text, patient replies, prompts or draft text to logs, traces, metrics or error reports; only ids, counts, durations and status codes are allowed. (The client rule is in app/chat-simulation/05 FR-9.)
- FR-10: The system shall not use transcripts for training or evaluation of models, and shall not share them outside the processors required to deliver the reply (conventions). The only processor is OpenAI. The original requirement that the processor be contractually bound not to retain the text is **an accepted deviation** (see the note at the top): OpenAI retains session state. The prohibition on training use stays a requirement on the backend (we never export transcripts for training) and should be confirmed against the OpenAI terms by the product owner (HUMAN-REQUIRED).
- FR-11: The system shall restrict human access to transcripts to a defined, logged purpose (OQ-5); until defined, no support or analytics tooling shall expose transcript text.
- FR-14: The learner's own messages shall not be treated differently from patient messages for retention, deletion, logging and access (same rules).
- FR-16 (decided, MVP): The system and the app shall not detect, block, flag, escalate or show resources for the learner's own content (including expressions of personal distress or abusive content); the AI keeps playing the patient and replies in character, with no extra UI. The Terms of Service and Privacy Policy shall state that Praxis is a training tool, not a mental-health or crisis service (release prerequisite).
- FR-17 (decided, MVP): A learner's GDPR right of access to their transcripts is handled manually through a support email address named in the Privacy Policy; there is no in-app request and no export API. The support email address is a release prerequisite (not provided; not invented here).

## Non-functional requirements
- NFR-1: Retention enforcement runs at least daily; no transcript exists in any store more than 90 days + 24 hours after `created_at` (verified by audit query/report).
- NFR-2: After a manual erasure request is completed, no sessions or messages for that user exist in any persistent store (verified by the operator).
- NFR-3: A log scan of a full test run (all four chat flows, both languages) finds none of the test messages' text.
- NFR-4: Transport over HTTPS only; transcripts encrypted at rest (product-level requirement; mechanism is a backend choice).
- NFR-5: Processing and storage location is in the EU/EEA, or the legal basis for transfer is documented (OQ-3). **Accepted deviation:** the OpenAI Agents API offers US-only data residency; no EU option is claimed. The legal basis for the transfer is still undocumented (HUMAN-REQUIRED); the backend's own database location is a deployment choice.

## Acceptance criteria
- AC-6: Given a session created 91 days ago, When the retention job has run, Then `GET /sessions/{id}` returns 404 and the case is still completed (FR-6, NFR-1).
- AC-7: Given `DELETE /sessions/{id}`, When the audit runs 30 days after the deletion, Then the messages exist nowhere (FR-7).
- AC-8: Given a user with 5 sessions, When the operator performs the manual erasure, Then all sessions return 404 and the operator's query shows zero records for the user (FR-8, NFR-2).
- AC-9: Given all chat flows are run with unique marker strings, When backend logs and traces are searched, Then no marker appears (FR-9, NFR-3).
- AC-12 (**revised**): Given a vendor/processor review, Then the product owner has recorded that OpenAI retains session state (accepted deviation) and confirmed the no-training-use terms (FR-10). This is a documentation item (HUMAN-REQUIRED), not an automated test, and no longer blocks the build.
- AC-18: Given the retention job runs with a session older than 90 days that has an `openai_session_id`, When it completes, Then the session and messages are gone, a queue row for the remote session exists from the same commit, and the worker (with a fake OpenAI client) deletes it (FR-6, FR-18).
- AC-19: Given the operator runbook is followed for a user with sessions, Then no session rows remain and the user's remote session ids are in the queue (FR-8).
- AC-13: Given the learner's own message, When retention and deletion are tested, Then it is deleted with the rest of the session (FR-14).
- AC-15: Given the support and analytics tools in use, When a user with a known test transcript is searched, Then no tool exposes message text, and any granted transcript access is recorded with who, when and purpose once OQ-5 is decided (FR-11).
- AC-16: Given a learner message expressing personal distress (e.g. "I feel hopeless myself"), When it is sent, Then the patient replies in character as for any message, and no banner, resource, block or flag appears in the app or on the backend (FR-16).
- AC-17: Given the Privacy Policy, When reviewed, Then it names the support email address for access requests, and the API exposes no transcript export (FR-17).

## Open questions (prerequisites and external questions only)
- OQ-3: Partly answered: the LLM processor is OpenAI (Agents API), accepted with retention and US-only residency. Still open: the DPA, the legal basis for the international transfer, and the hosting provider for our own database.
- OQ-5: Who (support, clinical reviewers, engineers) may read transcripts, for what purpose, with what audit trail. Not decided.

Prerequisites (must exist before release): the processor contracts of OQ-3; the support email address for access requests (FR-17); Privacy Policy and Terms stating retention, processors and that Praxis is a training tool and not a mental-health or crisis service (FR-16), owned by the product owner.
