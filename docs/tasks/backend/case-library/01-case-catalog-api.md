# 01 Case catalog API

- **Milestone:** Case library & detail
- **Screens covered:** Library, Library filters, Library loading, Library no results, Library error (data source for all five)
- **Depends on:** backend/signup-login/06 (bearer auth, problem format, `X-Flow-ID`, rate limiting); backend/case-library/03 (defines the per-user `completed` fields that this resource embeds)
- **Type:** BE

## Description
Exposes the read-only catalog of practice cases as a localized list. Each item holds what a library card needs (title, teaser, level, category, avatar style) plus the caller's completion state. Case content is curated by the product team and cannot be changed through the API. The whole catalog is returned in one response (no pagination); the app filters by level and category locally. This feature defines the **`CaseSummary`** resource shape that other milestones reuse.

## Scope
**In scope:** `GET /cases`, the `CaseSummary` shape, localization by `Accept-Language`.
**Out of scope:** case detail fields (02), completion semantics and progress summary (03), any create/update/delete endpoint for cases, how content is authored/loaded, pagination, server-side filtering, search, sorting options.

## APIs
Auth: `Authorization: Bearer <Firebase ID token>` (signup-login/06 FR-1). Common headers, problem format and 401/403/429/5xx types are those of signup-login/06. Client sends `Accept-Language` and `X-Flow-ID` (signup-login/01 FR-7).

### `GET /cases`
Lists the cases visible to the caller. No query parameters (unknown ones are ignored).

200 response (`application/json`):
```json
{ "items": [ CaseSummary ] }
```
- `CaseSummary` fields: `id` (opaque string, stable), `title` (string, localized), `teaser` (string, localized), `level` (`EASY` \| `MEDIUM` \| `HARD` \| `EXTREME`), `category` (`SUICIDAL_IDEATION` \| `HARM_TO_OTHERS` \| `TRAUMA_DISCLOSURE` \| `SUBSTANCE_USE` \| `BOUNDARY_TESTING`), `avatar` (`LONG_HAIR` \| `SHORT_HAIR` \| `HAIR_UP` \| `OLDER_GREY`), `completed` (boolean, per-user, see 03), `completed_at` (RFC 3339 UTC or `null`, see 03).
- Headers: `Content-Language` (`en` or `ru`), `Vary: Accept-Language`, `Cache-Control: no-store` (response contains per-user state), `X-Flow-ID`.
- Order: curated by the product team, stable, identical across requests, languages and users.
- An empty catalog is `200` with `"items": []`, never 404.

Errors: 401 / 403 / 429 / 5xx per signup-login/06.

Language rule: `Accept-Language` `ru` -> Russian, `en` -> English; absent or any other value -> English. The API never returns user-facing error text.

## Functional requirements
- FR-1: The system shall expose `GET /cases` returning all catalog cases for an authenticated caller as `{items}`.
- FR-2: Each item shall contain exactly the `CaseSummary` fields above and no field that reveals a case's hidden twist, patient persona instructions or scoring (see 02 FR-4).
- FR-3: The system shall return `title` and `teaser` in the language selected by `Accept-Language` per the language rule, and set `Content-Language` accordingly. Enum values (`level`, `category`, `avatar`) are language-independent; display labels are client-side i18n.
- FR-4: `completed` and `completed_at` shall reflect the authenticated caller only (03); two users shall never see each other's state.
- FR-5: The API shall expose no endpoint to create, modify or delete cases; the `id` of a case shall remain stable across content edits and languages.
- FR-6: A case without content in the requested language shall not be returned (NFR-2).

## Non-functional requirements
- NFR-1: Logs include `flow_id`, route template, status and latency; they never include the `Authorization` value.
- NFR-2: Content for every case exists in both `en` and `ru` before the case is visible.
- NFR-3: The endpoint is documented as authenticated (signup-login/06 FR-11).

## Acceptance criteria
- AC-1: Given a signed-in user and N cases, When `GET /cases`, Then 200 with all N items in the stable order, each with the `CaseSummary` fields (verifies FR-1, FR-2).
- AC-2: Given `Accept-Language: ru`, When listing, Then `title`/`teaser` are Russian and `Content-Language: ru`; given `en` or no header, Then English; `level`, `category` and `avatar` values are identical in both languages (verifies FR-3, NFR-2).
- AC-3: Given user A completed case X and user B did not, When each lists, Then X shows `completed: true` for A and `false` for B (verifies FR-4).
- AC-4: Given no/invalid/expired token, When listing, Then 401 `unauthenticated`/`token-expired` per signup-login/06 (verifies FR-1).
- AC-5: Given any response body, When inspected, Then it contains no field outside `CaseSummary` (no twist or persona) (verifies FR-2).
- AC-6: Given `POST`, `PUT`, `PATCH` or `DELETE` on `/cases` or `/cases/{id}`, Then 405 with an `Allow: GET` header (verifies FR-5).
- AC-7: Given `GET /cases?foo=bar`, When listing, Then the response equals the one without `foo` (verifies FR-1).
- AC-8: Given any request, When logs are inspected, Then `flow_id`, route template, status and latency are present and the `Authorization` value is absent (verifies NFR-1).

## Open questions
- PQ-1: Real case content, patient names and ids are not provided; ids are opaque, and the mock slugs (`the-quiet-goodbye`) are not a contract.
- PQ-2: API metadata ownership (`x-audience`, `x-api-id`, contact) is not answered; it is a prerequisite and is not invented here.

## Decisions recorded
Five categories are final, and the app owns the filter options, labels and filtering. Catalog order is curated and identical in both languages. A case lacking a translation is hidden. Missing/unsupported `Accept-Language` gives English. `GET /cases` has no `total`.
