# 01 Session summary data contract

- **Milestone:** Session end & feedback
- **Screens covered:** Session ended (by you) `session_ended_by_you.png`, Session ended by patient `session_ended_by_patient.png` (data only; UI in 03)
- **Depends on:** backend/chat-simulation/01 (`Session` resource, `GET /sessions/{session_id}`, `stats`, completion side effect); backend/chat-simulation/05 (retention); backend/case-library/02 (`GET /cases/{id}`, `case-not-found`) and 03 (`completed` field); backend/signup-login/06
- **Type:** BE (contract only; no new endpoint)

## Description
The summary screens need no endpoint of their own. They read the `Session` resource defined in `chat-simulation/01` (`GET /sessions/{session_id}`) and the case from the cases API. This feature fixes what the summary relies on in those resources: the field mapping, rounding, the 404 behaviour, and the guarantee that the case is completed when the session is ended. It is the contract the chat-simulation and case-library implementations must satisfy and that 03/04 test against.

## Scope
**In scope:** field mapping from `Session` to the screens, duration rounding rules, error behaviour, completion and discard guarantees the summary relies on.
**Out of scope:** defining, creating, ending or deleting sessions (chat-simulation/01); retention rules (chat-simulation/05); case content (case-library); feedback (02).

## APIs
None new. Consumes (all authenticated, shared headers and problems from `signup-login/06`):
- `GET /sessions/{session_id}` (`chat-simulation/01`): 200 `Session`; 404 `session-not-found` (owned by chat-simulation/01, not redefined here); other errors per that spec.
- `GET /cases/{case_id}` (`case-library/02`): 404 `case-not-found` (owned by case-library/02, not redefined here).

### Field mapping used by the summary screens
| Screen element | Source |
|---|---|
| Variant ("by you" / "by patient") | `Session.status`: `ENDED_BY_THERAPIST` -> by you; `ENDED_BY_PATIENT` -> by patient. `stats.ended_by` (`THERAPIST` / `PATIENT`) is equal and not used separately. |
| Duration card | `stats.duration_seconds` |
| "Your messages" card | `stats.therapist_message_count` (`patient_message_count` is not displayed) |
| Patient name, avatar, case title | the case from `GET /cases/{session.case_id}` (localized by `Accept-Language`) |
| "Marked as completed" banner | implied by an ended `status` (FR-3); no field read |
| Feedback and "practice again" targets | `Session.id`, `Session.case_id` |

### Problem type owned here (added to the catalogue)
| `type` | Status | Meaning | Client i18n key |
|---|---|---|---|
| `/problems/session-not-ended` | 409 | An operation that needs an ended session (feedback, 02) was called for an `IN_PROGRESS` session | `errors.generic` |

## Functional requirements
- FR-1: For an ended session, `GET /sessions/{id}` shall return `status` of `ENDED_BY_THERAPIST` or `ENDED_BY_PATIENT`, non-null `ended_at`, and non-null integer `stats.duration_seconds`, `therapist_message_count`, `patient_message_count`, so that the screens can render without further calls about the session.
- FR-2: `GET /sessions/{id}` for an ended session shall return identical bodies on repeated calls (ended sessions are immutable).
- FR-3: When a session is `ENDED_*`, the case shall already be completed for the user (`completed: true` in case-library fields); this is written by the session-end operation itself (`chat-simulation/01` FR-6, NFR-2; `case-library/03` FR-1) and is never written by feedback.
- FR-4: `GET /sessions/{id}` shall return 404 `session-not-found` for a session that was discarded (`DELETE /sessions/{id}`, restart, or any new session started for the same case, which discards all other sessions of that user and case including ended ones even if feedback was never sent; `chat-simulation/01` FR-3), deleted by retention (`backend/chat-simulation/05` FR-6, within 90 days of `created_at`), belongs to another user, or never existed. This applies equally to ended sessions. The summary and feedback screens must handle it (03, 04).
- FR-5: The summary shall derive the minutes shown as `round(duration_seconds / 60)` with halves rounded up; for `duration_seconds < 60` the screen shall show "<1 min". `duration_seconds` is already whole seconds (`chat-simulation/01`).
- FR-6: `patient_message_count` for `ENDED_BY_PATIENT` shall include the patient's closing message (`chat-simulation/01` FR-5, `02`).
- FR-7: Ending or discarding sessions and deleting transcripts shall not revoke case completion (`chat-simulation/01` FR-6; `case-library/03` FR-4).

## Non-functional requirements
- NFR-1: Rate limits are those of signup-login/06; the summary screen makes at most one session call and one case call per load.
- NFR-2: No transcript text is needed or returned for the summary; logs never contain it.
- NFR-3: The session response is not cacheable (`Cache-Control: no-store`, per chat-simulation/01).

## Acceptance criteria
- AC-1: Given a session ended by the learner (`PATCH`), When `GET /sessions/{id}`, Then `status=ENDED_BY_THERAPIST`, `ended_at` set, integer stats, and the case reads `completed: true` (verifies FR-1, FR-3).
- AC-2: Given a session ended by the patient, When fetched, Then `status=ENDED_BY_PATIENT` and `patient_message_count` includes the closing message (verifies FR-1, FR-6).
- AC-3: Given an ended session, When fetched twice, Then bodies are identical (verifies FR-2).
- AC-4: Given `duration_seconds` 59, 60, 90 and 740, When the screen formats them, Then "<1 min", "1 min", "2 min", "12 min" (verifies FR-5).
- AC-5: Given an ended session, When it is discarded by restart, practice again or `DELETE`, Then `GET` returns 404 `session-not-found` and the case remains completed (verifies FR-4, FR-7).
- AC-6: Given an ended session older than the retention limit, When fetched after the retention job, Then 404 and the case remains completed (verifies FR-4, FR-7).
- AC-7: Given another user's session id, When fetched, Then the same 404 (verifies FR-4).
- AC-8: Given a session ended with feedback never submitted, When the case is read, Then it is completed (verifies FR-3).
- AC-9: Given an `IN_PROGRESS` session, When feedback is submitted, Then 409 `session-not-ended` (02) (verifies FR-2's immutability scope is unaffected and the problem type owned here, `session-not-ended`, which 02 FR-3 returns; verifies 02 FR-3). Local reference: FR-1 (only ended sessions carry final stats).
- AC-10: Given the summary is loaded, When the traffic is inspected, Then it contains no message text (verifies NFR-2).
- AC-11: Given the summary screen loads, When the requests are counted, Then there is exactly one `GET /sessions/{id}` and one `GET /cases/{case_id}`, (verifies NFR-1).
- AC-12: Given `GET /sessions/{id}`, When the response headers are inspected, Then `Cache-Control: no-store` is present (verifies NFR-3).

## Open questions
Decided (no longer open): `duration_seconds` runs from session `created_at` (`chat-simulation/01`); a summary is not re-viewable after the learner leaves the screen (no entry point; the data exists until discard or retention, FR-4).

### Prerequisites and external questions
None.
