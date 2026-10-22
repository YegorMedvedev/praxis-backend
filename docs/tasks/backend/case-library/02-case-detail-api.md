# 02 Case detail API

- **Milestone:** Case library & detail
- **Screens covered:** Case detail (data source, including its content note and completed badge)
- **Depends on:** backend/case-library/01 (`CaseSummary`), 03 (completion fields), backend/signup-login/06
- **Type:** BE

## Description
Exposes one case with everything the detail screen shows before a session starts: scenario summary, virtual patient name and age, optional content note, plus the fields of the library card. The detail never reveals the case's twist or the patient's hidden background; those are internal to the chat simulation (chat-simulation milestone). The same resource is reused by the chat milestone to show the patient's name in the chat header.

## Scope
**In scope:** `GET /cases/{case_id}`, `CaseDetail` shape, localization, not-found behaviour.
**Out of scope:** list (01), completion rules (03), session creation (chat-simulation milestone), content authoring.

## APIs
Auth: bearer (signup-login/06). Same headers and problem format as 01.

### `GET /cases/{case_id}`
- Path: `case_id` opaque string.
- 200 body `CaseDetail` = every `CaseSummary` field (01) plus:
  - `scenario` (string, localized; context only, 3-4 sentences)
  - `patient` object: `name` (string, localized), `age` (integer)
  - `content_note` (string, localized, or `null`). When non-null it is the complete sentence(s) to display, including its own lead-in.
- Headers: `Content-Language`, `Vary: Accept-Language`, `Cache-Control: no-store`, `X-Flow-ID`.
- Errors: 404 `/problems/case-not-found` (new; unknown id, or id of a case not visible per 01 NFR-5); 401, 403, 429, 5xx per 06. A malformed id is also 404 `case-not-found` (never 400, so ids stay opaque).
- `case-not-found` client i18n: the app shows the dedicated not-found state (`caseDetail.notFoundTitle/Body`), not a generic message.

## Functional requirements
- FR-1: The system shall expose `GET /cases/{case_id}` returning `CaseDetail` for any visible case.
- FR-2: The system shall return `title`, `teaser`, `scenario`, `patient.name` and `content_note` in the language chosen by `Accept-Language` under the rule in 01.
- FR-3: `content_note` shall be `null` when the case has no sensitive-content note; it shall be non-null for every case involving suicidal ideation, harm to others or trauma (content-team responsibility).
- FR-4: The response shall not contain the case's twist, the patient's hidden background, system/persona prompts, evaluation criteria or any field not listed above.
- FR-5: The `CaseSummary` fields in `CaseDetail` shall be identical in value to those returned by `GET /cases` for the same user and language.
- FR-6: An unknown, malformed or hidden `case_id` shall return 404 `case-not-found`.
- FR-7: `completed`/`completed_at` shall reflect the caller only (03).
- FR-8: The system shall expose no write method on `/cases/{case_id}` (405).
- FR-9: Unknown query parameters shall be ignored. Authorization is the Firebase ID token (bearer) only (no OAuth scopes).

## Non-functional requirements
- NFR-1: p95 latency <= 500 ms.
- NFR-2: Logs follow 01 NFR-3; neither case text nor the patient name is logged.
- NFR-3: Patient names in the API are fictional and never represent a real person (privacy/EU AI Act transparency; content-team responsibility).
- NFR-4: `case-not-found` (404, `/problems/case-not-found`) is **owned by the case-library milestone** (defined in this spec) with the format of 06. chat-simulation/01 references it for `POST /sessions` (client key `errors.caseNotFound`); it is not redefined there.
- NFR-5: Rate limiting per signup-login/06 FR-10.

## Acceptance criteria
- AC-1: Given a visible case and `Accept-Language: en`, When `GET /cases/{id}`, Then 200 with all `CaseDetail` fields in English (verifies FR-1, FR-2).
- AC-2: Given `ru`, Then `title`, `teaser`, `scenario`, `patient.name`, `content_note` are Russian and `age` is unchanged (verifies FR-2).
- AC-3: Given a case without a content note, Then `content_note` is `null` (verifies FR-3).
- AC-4: Given any case, When the body is inspected, Then only the documented keys exist (verifies FR-4).
- AC-5: Given the same user and language, When comparing `GET /cases` item and `GET /cases/{id}` for one case, Then shared fields are equal (verifies FR-5).
- AC-6: Given `GET /cases/does-not-exist` or an id with illegal characters, Then 404 `/problems/case-not-found` (verifies FR-6, NFR-4).
- AC-7: Given user A completed the case and B did not, Then `completed` is true for A and false for B (verifies FR-7).
- AC-8: Given `PUT /cases/{id}`, Then 405 with an `Allow: GET` header (verifies FR-8).
- AC-9: Given no token, Then 401 per 06 (verifies FR-1).
- AC-10: Given p95 measurement under normal load, Then <= 500 ms (verifies NFR-1).
- AC-14: Given `GET /cases/{id}?foo=bar`, Then the response equals the one without `foo` (verifies FR-9).
- AC-11: Given any request, When logs are inspected, Then neither case text nor the patient name appears and `flow_id` is present (verifies NFR-2).
- AC-12: Given the shipped case content, When reviewed by the content team, Then every patient name is fictional (verified by review, NFR-3).
- AC-13: Given a user exceeds the 06 limit on `GET /cases/{id}`, Then 429 `rate-limited` with `Retry-After` (verifies NFR-5).

## Open questions (prerequisites and external questions only)
- PQ-1: Real case content (scenarios, patient names and ages, content notes) is not provided; the content team must supply them in `en` and `ru`.

## Decisions recorded
`content_note` is a full sentence including its lead-in; notes are required for cases involving suicidal ideation, harm to others or trauma. `patient.age` is required. No further patient fields until the chat milestone asks for them.
