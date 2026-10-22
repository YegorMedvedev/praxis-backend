# 05 Transcript retention and privacy

- **Milestone:** Chat simulation
- **Screens covered:** none (transcript handling behind all four chat screens)
- **Depends on:** backend/chat-simulation/01, 02
- **Type:** BE

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
- FR-7: The system shall make `DELETE /sessions/{id}` unretrievable through the API at once and erase the transcript from all persistent stores within 30 days of the deletion (including backups).
- FR-8: A user's sessions and transcripts shall be erasable on request by the operator (manual process, outside the app and API); the erasure shall cover backups within 30 days.
- FR-9: The system shall not write message text, patient replies, prompts or draft text to logs, traces, metrics or error reports; only ids, counts, durations and status codes are allowed. (The client rule is in app/chat-simulation/05 FR-9.)
- FR-10: The system shall not use transcripts for training or evaluation of models, and shall not share them outside the processors required to deliver the reply (conventions); any third-party processor shall be contractually bound not to retain the text beyond processing nor use it for training (OQ-3).
- FR-11: The system shall restrict human access to transcripts to a defined, logged purpose (OQ-5); until defined, no support or analytics tooling shall expose transcript text.
- FR-14: The learner's own messages shall not be treated differently from patient messages for retention, deletion, logging and access (same rules).
- FR-16 (decided, MVP): The system and the app shall not detect, block, flag, escalate or show resources for the learner's own content (including expressions of personal distress or abusive content); the AI keeps playing the patient and replies in character, with no extra UI. The Terms of Service and Privacy Policy shall state that Praxis is a training tool, not a mental-health or crisis service (release prerequisite).
- FR-17 (decided, MVP): A learner's GDPR right of access to their transcripts is handled manually through a support email address named in the Privacy Policy; there is no in-app request and no export API. The support email address is a release prerequisite (not provided; not invented here).

## Non-functional requirements
- NFR-1: Retention enforcement runs at least daily; no transcript exists in any store more than 90 days + 24 hours after `created_at` (verified by audit query/report).
- NFR-2: After a manual erasure request is completed, no sessions or messages for that user exist in any persistent store (verified by the operator).
- NFR-3: A log scan of a full test run (all four chat flows, both languages) finds none of the test messages' text.
- NFR-4: Transport over HTTPS only; transcripts encrypted at rest (product-level requirement; mechanism is a backend choice).
- NFR-5: Processing and storage location is in the EU/EEA, or the legal basis for transfer is documented (OQ-3).

## Acceptance criteria
- AC-6: Given a session created 91 days ago, When the retention job has run, Then `GET /sessions/{id}` returns 404 and the case is still completed (FR-6, NFR-1).
- AC-7: Given `DELETE /sessions/{id}`, When the audit runs 30 days after the deletion, Then the messages exist nowhere (FR-7).
- AC-8: Given a user with 5 sessions, When the operator performs the manual erasure, Then all sessions return 404 and the operator's query shows zero records for the user (FR-8, NFR-2).
- AC-9: Given all chat flows are run with unique marker strings, When backend logs and traces are searched, Then no marker appears (FR-9, NFR-3).
- AC-12: Given a vendor/processor review, Then written terms show no retention and no training use (FR-10); a missing contract blocks release.
- AC-13: Given the learner's own message, When retention and deletion are tested, Then it is deleted with the rest of the session (FR-14).
- AC-15: Given the support and analytics tools in use, When a user with a known test transcript is searched, Then no tool exposes message text, and any granted transcript access is recorded with who, when and purpose once OQ-5 is decided (FR-11).
- AC-16: Given a learner message expressing personal distress (e.g. "I feel hopeless myself"), When it is sent, Then the patient replies in character as for any message, and no banner, resource, block or flag appears in the app or on the backend (FR-16).
- AC-17: Given the Privacy Policy, When reviewed, Then it names the support email address for access requests, and the API exposes no transcript export (FR-17).

## Open questions (prerequisites and external questions only)
- OQ-3: Which third-party processors (LLM/hosting) are used, their contracts (DPA, no retention, no training), and data location; not stated in conventions. Also whether international transfers occur.
- OQ-5: Who (support, clinical reviewers, engineers) may read transcripts, for what purpose, with what audit trail. Not decided.

Prerequisites (must exist before release): the processor contracts of OQ-3; the support email address for access requests (FR-17); Privacy Policy and Terms stating retention, processors and that Praxis is a training tool and not a mental-health or crisis service (FR-16), owned by the product owner.
