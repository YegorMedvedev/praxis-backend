# 03 Per-user completion state and progress summary

- **Milestone:** Case library & detail
- **Screens covered:** Library (completed badge on cards, progress bar "2 of 7 cases completed, 29%"), Case detail (completed badge, "Practice again" CTA)
- **Depends on:** backend/signup-login/06; backend/case-library/01, 02 embed the fields defined here
- **Type:** BE

## Description
Defines how a user's case completion is stored conceptually and exposed. A case is completed when one of the user's sessions for it ends, whether the therapist ended it or the patient did; feedback is not required (conventions.md). Completion is written only by the server, inside the session-end operation defined in chat-simulation/01 (`PATCH /sessions/{id}` to `ENDED_BY_THERAPIST`, or the patient ending the session, FR-7/FR-8 there). This feature defines the read side: per-case fields and a progress summary.

## Scope
**In scope:** the `completed`/`completed_at` fields on cases, `GET /me/case-progress`, the rule for when completion is recorded and what it survives.
**Out of scope:** the session endpoints (chat-simulation/01), the session resource, feedback, any client-writable completion endpoint (none exists by design).

## APIs
Auth: bearer (signup-login/06); all responses `Cache-Control: no-store`.

### Fields on cases (used by `GET /cases`, `GET /cases/{id}`)
- `completed` (boolean): true when the caller has at least one completed session for the case.
- `completed_at` (RFC 3339 UTC or `null`): time of the caller's **first** completion; never changes afterwards.

### `GET /me/case-progress`
Returns the caller's progress over the whole catalog, independent of any library filter.
- 200 body `CaseProgress`: `completed_count` (integer >= 0), `total_count` (integer >= 0, number of cases visible to the caller per 01 NFR-5). Percentage is computed by the client (rounded to nearest integer; 0 when `total_count` is 0).
- Invariant: `completed_count <= total_count`; only cases currently visible count.
- Errors: 401, 403, 429, 5xx per 06. No 404 (a user with no completions gets `0` of `total_count`).

### Completion write contract (not an endpoint of this milestone)
Per chat-simulation/01 FR-6 and NFR-2, completion is recorded in the same atomic operation that moves a session to `ENDED_BY_THERAPIST` (`PATCH /sessions/{id}`) or `ENDED_BY_PATIENT`, idempotently, with no client call. Clients have no endpoint to set or clear completion.

## Functional requirements
- FR-1: The system shall mark a case completed for a user when a session for that case ends, regardless of who ended it and regardless of whether feedback is submitted or skipped.
- FR-2: Recording completion shall be idempotent: repeated session ends for the same case keep `completed: true` and the original `completed_at`.
- FR-3: A session that has not ended (in progress, or discarded by leave/restart) shall not mark the case completed (chat-simulation/01 FR-6).
- FR-4: Once completed, a case shall stay completed when the user starts, restarts, discards or ends further sessions for it, when the session is discarded, and when the transcript is deleted by the 90-day retention; only a manual erasure by the operator removes it (chat-simulation/01 FR-6).
- FR-5: The system shall expose no client endpoint that sets or clears completion.
- FR-6: `GET /me/case-progress` shall return `completed_count` and `total_count` as defined, for the caller only.
- FR-7: `completed_count` shall equal the number of `GET /cases` items (unfiltered) with `completed: true`.
- FR-8: After a session ends, a subsequent `GET /cases`, `GET /cases/{id}` and `GET /me/case-progress` shall reflect the completion (read-your-writes for the same user; no stale cache, hence `no-store`).
- FR-10: Completion of a case no longer visible in the catalog shall not be counted in `completed_count`.

## Non-functional requirements
- NFR-2: Consistency: completion becomes visible to reads no later than the response to the session-ending request returns (FR-8).
- NFR-3: Privacy: completion state is personal data of the user; it is never exposed to other users. Logs never contain it linked to user identifiers beyond `flow_id`.
- NFR-4: Rate limiting per signup-login/06 FR-10.
- NFR-5: Concurrent session ends for the same case by the same user shall produce exactly one `completed_at`.

## Acceptance criteria
- AC-1: Given a new user, When `GET /me/case-progress`, Then `completed_count: 0`, `total_count` = catalog size (verifies FR-6).
- AC-2: Given a session ended by the therapist, When cases are read, Then that case has `completed: true` and a `completed_at` (verifies FR-1, FR-8).
- AC-3: Given a session ended by the patient with feedback skipped, Then the case is completed (verifies FR-1).
- AC-4: Given a session still in progress or discarded by restart, Then the case is not completed (verifies FR-3).
- AC-5: Given a completed case, When another session for it ends later, Then `completed_at` is unchanged (verifies FR-2, FR-4).
- AC-6: Given 2 completed of 7 cases, Then `completed_count: 2`, `total_count: 7`, and the client shows 29% (verifies FR-6, FR-7).
- AC-7: Given the progress summary is requested while the library list is filtered, Then the counts are unchanged by filters (verifies FR-6).
- AC-8: Given a user's transcript expired after 90 days, or the ended session was discarded, Then the case remains completed (verifies FR-4).
- AC-10: Given two concurrent ends for the same case, Then one `completed_at` exists (verifies NFR-5).
- AC-11: Given any `PUT`, `POST`, `PATCH` or `DELETE` on `/me/case-progress`, or on any completion sub-resource of `/cases/{id}`, Then 405 with an `Allow` header listing only the supported methods (`GET` for `/me/case-progress`) (verifies FR-5).
- AC-12: Given a case removed from the catalog that the user had completed, Then `completed_count` excludes it (verifies FR-10).
- AC-13: Given user A completes a case, Then user B's reads are unaffected (verifies NFR-3).
- AC-15: Given a session end returned 200, When `GET /cases` and `GET /me/case-progress` are called immediately after, Then both reflect the completion (verifies NFR-2).
- AC-16: Given a user exceeds the signup-login/06 limit on `GET /me/case-progress`, Then 429 `rate-limited` with `Retry-After` (verifies NFR-4).

## Open questions (prerequisites and external questions only)
- PQ-1: GDPR lawful basis and retention wording for the completion record, which outlives transcripts (kept until a manual erasure, chat-simulation/01 FR-6). Legal review needed.

## Decisions recorded
`completed_count` is derived from the catalog size at read time. No per-case session count or last-practiced time. Rate limit per signup-login/06.
