# 06 Authenticated API foundation

- **Milestone:** Sign-up & Log-in
- **Screens covered:** none directly (serves all screens that call the API; first consumer is the post-login bootstrap of Sign up / Log in)
- **Depends on:** backend/signup-login/01 (Firebase project)
- **Type:** BE

## Description
Builds the API plumbing every later feature relies on: verification of the Firebase ID token (JWT) sent as `Authorization: Bearer`, a uniform `application/problem+json` error format with stable `type` values, request tracing via `X-Flow-ID`, a single rate limit, and the first resource, `/me` (the caller's profile). The app calls `GET /me` after every sign-in and on every cold start; sign-up calls `PUT /me` to create the profile. The API never returns user-facing text; clients map `type` to i18n keys.

## Scope
**In scope:** bearer-token verification, problem types (registry below), `X-Flow-ID`, rate limiting, `GET /me`, `PUT /me`, logging rules.
**Decided:** the client reads the current Terms/Privacy versions from build configuration (no public endpoint); re-acceptance on a version change is out of scope.
**Out of scope:** profile editing (`PATCH /me`), language on the profile, email verification, account deletion (`DELETE /me`, handled manually by an emailed request), cleanup of profile-less auth accounts (manual), auth user creation (done by the client SDK against Firebase Auth), cases/chat/feedback endpoints.

## APIs
All endpoints require `Authorization: Bearer <Firebase ID token>`. There are **no public endpoints**. The API description declares one security scheme, `bearerAuth` (OpenAPI `type: http`, `scheme: bearer`, `bearerFormat: JWT`), applied globally. Access is owner-only (a caller can only reach its own resources); there are no OAuth scopes. All JSON bodies are `snake_case`. All responses carry `X-Flow-ID`. Responses to `/me` carry `Cache-Control: no-store`.

### `GET /me`
Returns the caller's profile.
- 200 body (`Me`): `id` (opaque string; equals the Firebase uid, the token `sub` claim), `name` (string), `email` (string, taken from the verified token, not from client input), `consent` (object: `terms_version`, `privacy_version`, `accepted_at` RFC 3339 UTC), `created_at`, `updated_at` (RFC 3339 UTC).
- Errors: 401 `unauthenticated` | `token-expired`; 403 `account-disabled`; 404 `profile-not-found` (valid token, no profile yet); 429 `rate-limited`; 5xx `internal-error` | `service-unavailable`.

### `PUT /me`
Creates the caller's profile, or replaces it if it exists. Idempotent. Used by sign-up (02) and by bootstrap repair (03).
- Request: `Content-Type: application/json`; `name` (string, required; server trims; after trimming length MUST be >= 2 and <= 100); `consent` (object `{terms_version, privacy_version}`, required when the profile is created, optional afterwards; the server sets `accepted_at` to the time of receipt; a changed version pair re-records acceptance). Unknown and read-only properties (`id`, `email`, `created_at`, `updated_at`) are ignored (tolerant reader). Maximum body size 8 KiB.
- 201 + `Location: /me` when created (400 `invalid-request`, `consent` `REQUIRED`, if `consent` is absent); 200 when it already existed. Body: `Me`.
- Errors: 400 `invalid-request` (with `invalid_params`), 401, 403, 413/415 `invalid-request`, 429, 5xx as above.

### Problem format
`Content-Type: application/problem+json` (RFC 9457) with members `type` (relative URI reference `/problems/<name>`, stable), `title` (English, developer-facing only), `status`, `detail` (developer-facing, never contains tokens or personal data), `flow_id`. `invalid-request` adds `invalid_params`: array of `{ "name": "<property or parameter>", "reason": "<code>" }`.

| `type` | Status | Meaning | Client i18n key |
|---|---|---|---|
| `/problems/unauthenticated` | 401 | Authorization header missing, malformed, wrong issuer/audience, bad signature | none (client signs out after one refresh retry, see app/signup-login/01 FR-9) |
| `/problems/token-expired` | 401 | Token valid but expired | none (client refreshes and retries once) |
| `/problems/account-disabled` | 403 | Auth user is disabled | `errors.accountDisabled` |
| `/problems/profile-not-found` | 404 | Authenticated, no profile | none (client repairs, see 03 FR-8) |
| `/problems/invalid-request` | 400 (also 405 with `Allow`, 413, 415) | Body/query/header invalid | `errors.generic` |
| `/problems/rate-limited` | 429 | Limit exceeded; `Retry-After` header (seconds) | `errors.tooManyRequests` |
| `/problems/internal-error` | 500 | Unexpected failure | `errors.generic` |
| `/problems/service-unavailable` | 503 | Dependency down | `errors.generic` |
| (no HTTP response) | n/a | Client offline / timeout | `errors.network` |

401 responses include `WWW-Authenticate: Bearer`.

### `invalid_params` reasons (master list)
Other specs reference this list; a new reason is added here first. Unknown request properties and query parameters are ignored, not rejected; validation of known properties is strict.

| Reason | Meaning |
|---|---|
| `REQUIRED` | Required property/parameter is missing |
| `TOO_SHORT` | String shorter than the minimum (after trimming where the spec says so) |
| `TOO_LONG` | String longer than the maximum |
| `INVALID_TYPE` | Wrong JSON type |
| `INVALID_VALUE` | Right type, value not allowed (e.g. not in an enum) |
| `UNKNOWN_VERSION` | Consent document version not recognised |
| `OUT_OF_RANGE` | Integer outside its allowed range (e.g. rating not in 1-5) |

### Problem type registry
`type` is `/problems/<name>`. The owner file defines the semantics; other specs reference, never redefine, a type.

| Name | Status | Owner file |
|---|---|---|
| `unauthenticated`, `token-expired`, `account-disabled`, `profile-not-found`, `invalid-request`, `rate-limited`, `internal-error`, `service-unavailable` | see table above | signup-login/06 |
| `case-not-found` | 404 | case-library/02-case-detail-api.md |
| `session-not-found` | 404 | chat-simulation/01-session-lifecycle-api.md |
| `session-ended` | 409 | chat-simulation/01-session-lifecycle-api.md |
| `reply-pending` | 409 | chat-simulation/02-patient-message-exchange-streaming.md |
| `no-reply-pending` | 409 | chat-simulation/02-patient-message-exchange-streaming.md |
| `reply-generation-failed` | 502 | chat-simulation/02-patient-message-exchange-streaming.md |
| `session-not-ended` | 409 | session-feedback/02-feedback-submission-api.md |

### Cross-cutting rules
`/me` is kept as the singleton resource of the authenticated caller (a justified exception to the Zalando guidance against pseudo-identifiers); its sub-resource is `/me/case-progress` (case-library). An unsupported method returns 405 with `Allow`; an oversized body 413; an unsupported `Content-Type` 415; all as `invalid-request`.

## Functional requirements
- FR-1: The system shall verify every request's bearer token locally as a Firebase ID token of the Praxis Firebase project, against Google's published signing keys: signature (RS256, key id `kid`), issuer `https://securetoken.google.com/<project id>`, audience = the Firebase project id, expiry, and a non-empty `sub`. Keys shall be cached per their `Cache-Control` max-age and refetched on an unknown key id.
- FR-2: The system shall respond 401 `unauthenticated` for a missing, malformed, wrong-issuer/audience or badly signed token, and 401 `token-expired` for an otherwise valid expired token.
- FR-3: The system shall respond 403 `account-disabled` for a disabled auth user no later than the window in NFR-2 (it takes effect when the already-issued ID token expires and the client's refresh fails).
- FR-4: The system shall expose `GET /me` returning the `Me` resource, and 404 `profile-not-found` when the caller has no profile.
- FR-5: The system shall expose `PUT /me` that creates the profile (201) or replaces it (200), validating `name`; repeating an identical request shall return 200 with an unchanged resource.
- FR-6: The system shall derive `id` and `email` of `Me` from the verified token, never from request input.
- FR-7: The system shall store consent only as the version pair plus a server-set timestamp, and shall reject a `consent` whose versions it does not recognise with 400 `invalid-request` (`UNKNOWN_VERSION`).
- FR-8: The system shall return every error as `application/problem+json` using only the types in the registry, and shall never return user-facing text.
- FR-9: The system shall accept an optional `X-Flow-ID` request header (1-128 chars of `[A-Za-z0-9._-]`); if absent or invalid it shall generate a new one; it shall echo it in the `X-Flow-ID` response header and the problem `flow_id` member.
- FR-10: The system shall rate-limit all endpoints with one global limit of 60 requests/min/user (by client IP for requests that fail authentication), responding 429 `rate-limited` with `Retry-After`.
- FR-11: The system shall serve the API only over HTTPS and shall document every endpoint as authenticated (none is public).

## Non-functional requirements
- NFR-1: Logs are structured, include `flow_id`, HTTP method, route template, status and latency, and never contain passwords, ID tokens, or the `name`/`email` values.
- NFR-2: A disabled user, or a user whose password was reset elsewhere, is rejected no later than 60 minutes after the change (the Firebase ID token lifetime of 1 hour); no per-request revocation check is required. The device that completed a password reset signs itself out immediately (app/signup-login/05 FR-13).
- NFR-3: Error responses for 401 reveal no reason beyond the `type`.
- NFR-4: Token verification does not depend on a per-request call to Firebase Auth.

## Acceptance criteria
- AC-1: Given a valid token and an existing profile, When `GET /me` is called, Then 200 with `id,name,email,consent,created_at,updated_at` and `Cache-Control: no-store` (verifies FR-1, FR-4, FR-6).
- AC-2: Given no Authorization header, When `GET /me` is called, Then 401 `unauthenticated` with `WWW-Authenticate: Bearer` (verifies FR-2, FR-8).
- AC-3: Given a token signed for a different Firebase project, When any endpoint is called, Then 401 `unauthenticated` (verifies FR-1, FR-2).
- AC-4: Given an expired but otherwise valid token, When any endpoint is called, Then 401 `token-expired` (verifies FR-2).
- AC-5: Given a valid token whose user has been disabled for longer than the NFR-2 window, When `GET /me` is called, Then 403 `account-disabled` (verifies FR-3, NFR-2).
- AC-6: Given a valid token with no profile, When `GET /me` is called, Then 404 `profile-not-found` (verifies FR-4).
- AC-7: Given no profile, When `PUT /me` with `{"name":"  Elena  ","consent":{"terms_version":"T1","privacy_version":"P1"}}`, Then 201, `Location: /me`, `name` is `Elena`, `email` equals the token's email, `consent.accepted_at` is set by the server (verifies FR-5, FR-6, FR-7).
- AC-8: Given no profile, When `PUT /me` without `consent`, Then 400 `invalid-request` with `consent` `REQUIRED`; with unknown versions, Then `UNKNOWN_VERSION` (verifies FR-5, FR-7).
- AC-9: Given a profile exists, When the same `PUT /me` is repeated, Then 200 and the body is identical to the first response (verifies FR-5).
- AC-10: Given `{"name":"A","consent":{...}}`, `{}`, or a 101-character name, When `PUT /me`, Then 400 `invalid-request` with `invalid_params` naming `name` (`TOO_SHORT`, `REQUIRED`, `TOO_LONG`) (verifies FR-5, FR-8).
- AC-11: Given `{"name":"Elena","consent":{...},"email":"x@y.z","id":"other","foo":1}`, When `PUT /me`, Then the response is as for a valid body and `email`, `id` are unaffected by the extra properties (verifies FR-5, FR-6).
- AC-12: Given `X-Flow-ID: abc-123`, When any request is made, Then the response header and (on error) `flow_id` equal `abc-123`; given no/invalid header, Then a generated value is returned (verifies FR-9).
- AC-13: Given a user exceeds the limit, When another request is made, Then 429 `rate-limited` with a numeric `Retry-After` (verifies FR-10).
- AC-14: Given any request, When logs are inspected, Then no token, password, name or email values appear and `flow_id` is present (verifies NFR-1).
- AC-15: Given `Content-Type: text/plain`, When `PUT /me`, Then 415 `invalid-request`; given an unsupported method such as `POST /me`, Then 405 with `Allow: GET, PUT`; given a body over 8 KiB, Then 413 (verifies FR-8).
- AC-16: Given a missing token, an expired token and a bad-signature token, When `GET /me` is called, Then the 401 bodies differ only in `type` (verifies NFR-3).

## Open questions
- Verify at implementation: the signing-key source for Firebase ID tokens (Google's published certificates for `securetoken@system.gserviceaccount.com`) and its cache lifetime; that disabling a user or a password reset revokes refresh tokens so access ends within the 1-hour ID token lifetime.
- API metadata ownership for the OpenAPI description and Firebase service-account credential custody for the backend: owner to be provided; do not invent.
