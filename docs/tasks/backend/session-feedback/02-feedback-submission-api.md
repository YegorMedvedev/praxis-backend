# 02 Feedback submission API

- **Milestone:** Session end & feedback
- **Screens covered:** Feedback `feedback.png`, Feedback sent `feedback_sent.png` (data only; UI in 04)
- **Depends on:** backend/signup-login/06; backend/session-feedback/01 (owns `session-not-ended`); backend/chat-simulation/01 (`Session`, `session-not-found`, discard)
- **Type:** BE

## Description
Stores the learner's optional post-session feedback: a realism rating, a preparedness rating (both 1-5) and an optional comment, attached to one ended session. Feedback is optional and skippable: skipping sends nothing, and feedback never affects whether the case is completed. The comment is free text about a sensitive simulation and must be treated as personal data. The latest submission for a session replaces any earlier one (last write wins).

## Scope
**In scope:** `PUT /sessions/{session_id}/feedback`, validation, privacy rules for the comment.
**Out of scope:** reading feedback back to the learner, any admin/analytics view of feedback, using feedback to change cases or models, a "skipped" record (skipping creates no data), conflict detection between submissions.

## APIs
Authenticated. Conventions as in `signup-login/06`.

### `PUT /sessions/{session_id}/feedback`
Creates or replaces the feedback of a session. One feedback per session; a repeat replaces it, so retries are safe without an `Idempotency-Key`.
- Request (`application/json`; unknown properties are ignored; validation of the known properties is strict):
  - `realism_rating` (integer 1-5, required)
  - `preparedness_rating` (integer 1-5, required)
  - `comment` (string, optional; trimmed by the server; empty after trimming is stored as absent; max 1000 characters after trimming, counted as Unicode code points)
- 201 + `Location: /sessions/{session_id}/feedback` when created; 200 when it replaced an existing feedback. Body (`Feedback`): `session_id`, `realism_rating`, `preparedness_rating`, `comment` (omitted when absent), `created_at`. `Cache-Control: no-store`.
- Errors: 400 `invalid-request` (with `invalid_params`); 413/415 `invalid-request` (body over 8 KiB; media type not `application/json`); 401; 403 `account-disabled`; 404 `session-not-found` (includes a session discarded by restart, practice again or `DELETE`, and one past retention); 409 `session-not-ended`; 429 `rate-limited`; 5xx.

`invalid_params[].reason` values are the master list in `signup-login/06` (including `OUT_OF_RANGE`). `session-not-found` is owned by `chat-simulation/01`; `session-not-ended` by 01 of this milestone.

## Functional requirements
- FR-1: The system shall expose `PUT /sessions/{session_id}/feedback` accepting `realism_rating`, `preparedness_rating` and optional `comment`.
- FR-2: The system shall reject with 400 `invalid-request` a missing rating (`REQUIRED`), a non-integer (`INVALID_TYPE`), an integer outside 1-5 (`OUT_OF_RANGE`), a comment over 1000 characters (`TOO_LONG`), and a non-string comment (`INVALID_TYPE`), naming each offending property in `invalid_params`. A `comment` of only whitespace is treated as absent.
- FR-3: The system shall accept feedback only for a session in `ENDED_BY_THERAPIST` or `ENDED_BY_PATIENT` owned by the caller; otherwise 409 `session-not-ended` or 404 `session-not-found`. Once an ended session is discarded (restart, a new session started for the same case, `DELETE`) or deleted by retention, feedback for it is no longer possible: 404, identical for foreign, discarded or unknown sessions. Feedback already stored is not deleted by session discard or transcript retention.
- FR-4: The system shall store at most one feedback per session. The first valid request returns 201; any later valid request replaces the stored feedback and returns 200 (`created_at` is kept from the first submission).
- FR-5: Submitting feedback shall not change the session state or the case's completed status, and no endpoint shall require feedback to have been submitted. Skipping creates no server-side record.
- FR-6: The system shall never write the `comment` value to logs, traces, error responses (`detail`), metrics labels or crash reports, and shall not use feedback or comments for model training.

## Non-functional requirements
- NFR-1: Logs include `flow_id`, method, route template, status, latency; never the comment value.
- NFR-2: The comment is stored and transmitted only over HTTPS. Feedback is retained until the operator erases it on request (independent of the 90-day transcript retention, `chat-simulation/05`).
- NFR-3: Rate limiting per `signup-login/06`; the API returns no user-facing text.

## Acceptance criteria
- AC-1: Given an ended session with no feedback, When `PUT` with `{"realism_rating":4,"preparedness_rating":3,"comment":"  What worked  "}`, Then 201, `Location` set, `comment` is `What worked` (verifies FR-1, FR-4).
- AC-2: Given feedback exists, When `PUT` with different ratings, Then 200, the stored values are the new ones and `created_at` is the original (verifies FR-4).
- AC-3: Given `{}`, `{"realism_rating":0,"preparedness_rating":6}`, `{"realism_rating":"4","preparedness_rating":4}`, and a 1001-code-point comment, When `PUT`, Then 400 `invalid-request` with `invalid_params` using `REQUIRED`, `OUT_OF_RANGE`, `INVALID_TYPE`, `TOO_LONG` respectively; a comment of exactly 1000 code points (including Cyrillic and emoji) gives 201; `comment` `"   "` gives 201 without a `comment` in the response; an unknown property or client-sent `created_at` is ignored (verifies FR-2).
- AC-4: Given an `IN_PROGRESS` session, When `PUT`, Then 409 `session-not-ended` (verifies FR-3).
- AC-5: Given another user's session, a random id, and an ended session discarded by restart, When `PUT`, Then identical 404 `session-not-found`; given feedback was stored and the session is later discarded, Then the feedback is not removed by the discard (verifies FR-3).
- AC-6: Given feedback was submitted, When the case completion and the session state are read, Then they are identical to their values before submission; given the learner skipped, Then no feedback exists (verifies FR-5).
- AC-7: Given a request with comment `SECRET-MARKER-123`, When all logs and error payloads (including a forced 400/500) are searched, Then the marker never appears (verifies FR-6, NFR-1).
- AC-8: Given `Content-Type: text/plain` or a body over 8 KiB, When `PUT`, Then 415 and 413 respectively, both `invalid-request` (verifies NFR-3).
- AC-9 (review): the data-flow documentation shows feedback and comments are not sent to any training or fine-tuning pipeline (verifies FR-6).

## Open questions
- OQ-1: Purpose, lawful basis and privacy-notice wording for collecting feedback and comments (the screen says "Your feedback helps make these cases more realistic"). Needs legal input; not defined in conventions.md.
