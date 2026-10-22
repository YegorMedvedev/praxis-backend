# 06 Authenticated API foundation

- **Milestone:** Sign-up & Log-in
- **Screens covered:** none directly (serves all screens that call the API; first consumer is the post-login bootstrap of Sign up / Log in / Google / Apple)
- **Depends on:** 01 (auth provider)
- **Type:** BE

## Description
Builds the API plumbing every later feature relies on: verification of the Firebase ID token (JWT) sent as `Authorization: Bearer`, a uniform `application/problem+json` error format with stable `type` values, request tracing via `X-Flow-ID`, rate limiting, and the first resource, `/me` (the caller's profile). The app calls `GET /me` after every sign-in and on every cold start to learn who the user is; sign-up calls `PUT /me` to create the profile. The API never returns user-facing text; clients map `type` to i18n keys.

## Scope
**In scope:** bearer-token verification, problem types (catalogue below), `X-Flow-ID`, rate limiting, `GET /me`, `PUT /me`, logging rules.
**Decided:** the client reads the current Terms/Privacy versions from build configuration (no public endpoint); re-acceptance on a version change is out of scope.
**Out of scope:** name/language editing UX and account deletion (account-settings milestone; it will add `PATCH /me` and `DELETE /me` on the same resource), cases/chat/feedback endpoints, auth user creation (done by the client SDK against Firebase Auth, see 02), the verify-email prompt UI (02 FR-15).

## APIs
All endpoints require `Authorization: Bearer <Firebase ID token>`. There are **no public endpoints** in this milestone. The API description declares one security scheme, `bearerAuth` (OpenAPI `type: http`, `scheme: bearer`, `bearerFormat: JWT`), applied globally (FR-11). Access is by a valid Firebase ID token with owner-only access (a caller can only reach its own resources); there are no OAuth scopes (product decision). All JSON bodies are `snake_case`. All responses carry `X-Flow-ID`. Responses to `/me` carry `Cache-Control: no-store`.

### `GET /me`
Returns the caller's profile.
- 200 body (`Me`): `id` (opaque string, stable for the account lifetime; equals the Firebase uid, the token `sub` (`user_id`) claim), `name` (string), `email` (string, taken from the verified token / auth account, not from client input), `email_verified` (boolean, from the token's `email_verified` claim (or the auth account); informational, never gates access; source subject to the external question in signup-login/02), `language` (`en` | `ru`, `null` when unset; clients fall back to the device locale when `null`; lowercase is an accepted, justified exception to the `UPPER_SNAKE_CASE` enum rule because the values mirror IETF language tags and the `Accept-Language` header; all other enums remain `UPPER_SNAKE_CASE`), `consent` (object: `terms_version`, `privacy_version`, `accepted_at` RFC 3339 UTC), `created_at`, `updated_at` (RFC 3339 UTC).
- Errors: 401 `unauthenticated` | `token-expired`; 403 `account-disabled`; 404 `profile-not-found` (valid token, no profile yet); 409 `account-deletion-in-progress` (FR-14); 429 `rate-limited`; 5xx `internal-error` | `service-unavailable`.

### `PUT /me`
Creates the caller's profile, or replaces it if it exists. Idempotent. Used by sign-up (02), by bootstrap repair (03) and by first social sign-in (04).
- Request: `Content-Type: application/json`; `name` (string, required; server trims; after trimming length MUST be >= 2, same rule as client `validateName`; maximum 100 characters after trimming, else 400 `TOO_LONG`); `consent` (object `{terms_version, privacy_version}`, required when the profile is created, optional afterwards; the server sets `accepted_at` to the time of receipt; a changed version pair re-records acceptance); `language` (`en` | `ru`, optional). Optional members that are omitted leave an existing value unchanged (documented deviation from strict PUT replacement so the account-settings milestone can set `language` independently). Unknown properties are ignored (tolerant reader) and have no effect on the response; read-only properties sent by the client (`id`, `email`, `email_verified`, `created_at`, `updated_at`) are ignored too. Maximum request body size is 8 KiB (8192 bytes), else 413 (FR-16).
- 201 + `Location: /me` when created (rejected with 400 `invalid-request`, `consent` `REQUIRED`, if `consent` is absent); 200 when it already existed. Body: `Me`.
- Errors: 400 `invalid-request` (with `invalid_params`), 401, 403, 409 `account-deletion-in-progress` (FR-14), 415 `invalid-request` (FR-10), 429, 5xx as above.

### Problem format
`Content-Type: application/problem+json` (RFC 9457) with members `type` (relative URI reference `/problems/<name>`, stable), `title` (English, developer-facing only), `status`, `detail` (developer-facing, never contains tokens or personal data), `flow_id`. `invalid-request` adds `invalid_params`: array of `{ "name": "<property or parameter>", "reason": "<code>" }`, where `reason` is one of the master list below.

| `type` | Status | Meaning | Client i18n key |
|---|---|---|---|
| `/problems/unauthenticated` | 401 | Authorization header missing, malformed, wrong issuer/audience, bad signature | none (client signs out after one refresh retry, see 01 FR-9) |
| `/problems/token-expired` | 401 | Token valid but expired | none (client refreshes and retries once) |
| `/problems/account-disabled` | 403 | Auth user is disabled | `errors.accountDisabled` (new) |
| `/problems/profile-not-found` | 404 | Authenticated, no profile | none (client repairs, see 03 FR-8) |
| `/problems/invalid-request` | 400 | Body/query/header invalid | `errors.generic` |
| `/problems/rate-limited` | 429 | Limit exceeded; `Retry-After` header (seconds) | `errors.tooManyRequests` (new) |
| `/problems/internal-error` | 500 | Unexpected failure | `errors.generic` |
| `/problems/service-unavailable` | 503 | Dependency down; `Retry-After` when known | `errors.generic` |
| (no HTTP response) | n/a | Client offline / timeout | `errors.network` |

401 responses include `WWW-Authenticate: Bearer` (with `error="invalid_token"` where a token was supplied).

### Cross-cutting rules
- **`/me` path (justified exception):** Zalando discourages `self`-style pseudo-identifiers in paths. `/me` is kept deliberately: it is the singleton resource of the authenticated caller (there is no collection of users and no other caller may address it), the identity comes only from the bearer token, and a client never needs to know its own id to call it. Its sub-resources use the same prefix, e.g. `/me/case-progress` (case-library). This exception applies to `/me` only; all other resources use identifier-based paths.
- **405:** an unsupported method on a known path returns 405 with an `Allow` header listing the supported methods, as `application/problem+json` of type `invalid-request` (no dedicated type). All milestones' endpoints follow this rule.
- **413 and 415:** a body above the documented maximum returns 413 and an unsupported `Content-Type` returns 415, both as `invalid-request` problems. No dedicated `payload-too-large` or `unsupported-media-type` types are introduced, because no spec depends on them (account-settings/01 and session-feedback/02 already expect 415/400 `invalid-request`). If a client ever needs to react differently, add the type here first.

### `invalid_params` reasons (master list)
This is the single, authoritative list. Other specs reference it and shall not redefine or extend it; a new reason is added here first. There is no `UNKNOWN_PROPERTY` reason: unknown request properties and unknown query parameters are ignored, not rejected (product decision); validation of known properties stays strict.

| Reason | Meaning |
|---|---|
| `REQUIRED` | Required property/parameter is missing |
| `TOO_SHORT` | String shorter than the minimum (after trimming where the spec says so) |
| `TOO_LONG` | String longer than the maximum |
| `INVALID_TYPE` | Wrong JSON type (e.g. string where integer expected) |
| `INVALID_VALUE` | Right type, value not allowed (e.g. not in an enum, malformed cursor) |
| `UNKNOWN_VERSION` | Consent document version not recognised |
| `TOO_SMALL` | Number below the minimum (e.g. `limit` < 1) |
| `TOO_LARGE` | Number above the maximum (e.g. `limit` > max) |
| `OUT_OF_RANGE` | Integer outside its allowed range where a range is defined (e.g. rating not in 1-5) |

### Problem type registry
Every problem type in the API. `type` is `/problems/<name>`. The owner file defines the semantics; other specs reference, never redefine, a type. This table is maintained here; owners keep their own definitions.

| Name | Status | Owner file |
|---|---|---|
| `unauthenticated` | 401 | signup-login/06 |
| `token-expired` | 401 | signup-login/06 |
| `account-disabled` | 403 | signup-login/06 |
| `profile-not-found` | 404 | signup-login/06 |
| `invalid-request` | 400; also 405 (with `Allow`), 413, 415 (see Cross-cutting rules) | signup-login/06 |
| `rate-limited` | 429 | signup-login/06 |
| `internal-error` | 500 | signup-login/06 |
| `service-unavailable` | 503 | signup-login/06 |
| `case-not-found` | 404 | case-library/02-case-detail-api.md |
| `session-not-found` | 404 | chat-simulation/01-session-lifecycle-api.md |
| `session-ended` | 409 | chat-simulation/01-session-lifecycle-api.md |
| `idempotency-key-reuse` | 422 (same `Idempotency-Key` reused with a different request) | chat-simulation/01-session-lifecycle-api.md |
| `idempotency-key-in-flight` | 409 (same `Idempotency-Key` while the first request is still being processed) | chat-simulation/01-session-lifecycle-api.md |
| `reply-pending` | 409 | chat-simulation/02-patient-message-exchange-streaming.md |
| `no-reply-pending` | 409 | chat-simulation/02-patient-message-exchange-streaming.md |
| `reply-generation-failed` | 502 | chat-simulation/02-patient-message-exchange-streaming.md |
| `session-not-ended` | 409 | session-feedback/01-session-summary-data-contract.md |
| `feedback-already-submitted` | 409 | session-feedback/02-feedback-submission-api.md |
| `recent-login-required` | 403 | account-settings/06-delete-account.md |
| `account-deletion-in-progress` | 409 | account-settings/06-delete-account.md |

### Contract relied upon from account-settings/06 (`DELETE /me`)
This milestone relies on `DELETE /me` (owned by account-settings/06) for two things, defined here at product level so the specs stay consistent:
- The client-side Firebase `deleteUser` needs a recent sign-in and cannot cover users without a profile or the Apple token revocation, so every deletion of an auth user, including a user who declined consent (03 FR-16), goes through `DELETE /me`, which uses the server-side Admin SDK.
- `DELETE /me` shall be usable by an authenticated caller who has no profile: it removes the auth user (nothing else exists to erase), answers 204, is idempotent, and never answers 404 `profile-not-found`. For Apple identities it revokes the Apple token first (04 FR-14). For a caller with no profile the recent sign-in rule is met by the sign-in that has just happened, and a retry at a later app launch (03 FR-16) is accepted without a fresh sign-in and never answers 403 `recent-login-required` (account-settings/06 FR-18 to FR-20); for a caller with a profile the 5-minute rule is unchanged; recency is read from the ID token's `auth_time` claim (verify at implementation).

## Functional requirements
- FR-1: The system shall verify every request's bearer token locally as a Firebase ID token of the Praxis Firebase project, against Google's published signing keys for Firebase ID tokens: signature (RS256, key id `kid`), issuer `https://securetoken.google.com/<project id>`, audience = the Firebase project id, expiry, `iat`/`auth_time` not in the future, and a non-empty `sub` (= uid); it shall not call Firebase Auth per request for this. Keys shall be cached no longer than their published `Cache-Control` max-age and shall be refetched on an unknown key id, so key rotation does not break verification.
- FR-2: The system shall respond 401 `unauthenticated` for a missing, malformed, wrong-issuer/audience or badly signed token, and 401 `token-expired` for an otherwise valid expired token.
- FR-3: The system shall respond 403 `account-disabled` when the token's auth user is disabled, no later than the window in NFR-3: the per-request account-state lookup of FR-14 may report it at once, and otherwise it takes effect when the already-issued ID token expires and the client's refresh fails with `auth/user-disabled`.
- FR-14: The system shall reject immediately (no 60-minute window) the token of a user whose account deletion has completed (the auth user no longer exists), with 401 `unauthenticated`, and shall never create or recreate data for that user, including via `PUT /me`. For a user whose deletion has started but not completed, every endpoint here (`GET /me`, `PUT /me`) shall answer 409 `account-deletion-in-progress` as defined in account-settings/06 (which owns that behaviour and type). This requires a per-request account-state lookup (auth user exists, not being deleted; it may also report a disabled user, FR-3). Users whose password was reset elsewhere stay under NFR-3.
- FR-4: The system shall expose `GET /me` returning the `Me` resource, and 404 `profile-not-found` when the caller has no profile.
- FR-5: The system shall expose `PUT /me` that creates the profile (201) or replaces it (200), validating `name` per the API section; repeating an identical request shall return 200 with an unchanged resource.
- FR-6: The system shall derive `id`, `email` and `email_verified` of `Me` from the verified token / auth account, never from request input.
- FR-12: The system shall not require `email_verified = true` for any endpoint.
- FR-13: The system shall store consent only as the version pair plus a server-set timestamp, and shall reject a `consent` whose versions it does not recognise with 400 `invalid-request` (`UNKNOWN_VERSION`).
- FR-7: The system shall return every error as `application/problem+json` using only the types in the catalogue, and shall never return user-facing text.
- FR-8: The system shall accept an optional `X-Flow-ID` request header (1-128 chars of `[A-Za-z0-9._-]`); if absent or invalid it shall generate a new one; it shall echo the value in the `X-Flow-ID` response header and in the problem `flow_id` member.
- FR-9: The system shall rate-limit all endpoints, keyed by authenticated user (and by client IP for requests that fail authentication), responding 429 `rate-limited` with `Retry-After`.
- FR-10: The system shall serve `GET /me` and `PUT /me` only over HTTPS and shall reject unsupported content types with 415 `invalid-request`.
- FR-11: The system shall document each endpoint as public or authenticated in its API description; any endpoint not marked public requires FR-1.
- FR-15: The system shall answer an unsupported method on any path with 405, an `Allow` header and an `invalid-request` problem.
- FR-17: Operational cleanup of profile-less accounts: the system shall delete auth users (through the Firebase Admin SDK, with a service-account credential held only by the backend) that have no profile once they are more than 24 hours old (decided grace period), so that accounts whose deletion after declined consent failed (03 FR-16), and sign-ups abandoned before a profile was created, do not retain personal data. Accounts younger than the grace period shall never be deleted (in-flight sign-ups complete via 02 FR-10). The cleanup runs at least daily, so an account is deleted between 24 and 48 hours after creation, is idempotent, and logs only the count and flow ID (no emails). It has no public or client-facing endpoint.
- FR-16: The system shall answer a request body above the documented maximum size with 413 `invalid-request`; the maximum for `PUT /me` is 8 KiB.

## Non-functional requirements
- NFR-1: p95 latency of `GET /me` and `PUT /me` <= 500 ms (excluding third-party calls).
- NFR-2: Logs are structured, include `flow_id`, HTTP method, route template, status and latency, and never contain passwords, ID tokens, or the `name`/`email` values.
- NFR-3: A disabled user, or a user whose password was reset elsewhere, is rejected no later than 60 minutes after the change (the Firebase ID token lifetime of 1 hour, 01 FR-1; Firebase revokes refresh tokens on password reset and disabling); no per-request revocation check is required for these cases (product decision). Deleted users are the single exception and are rejected immediately (FR-14). The device that completed a password reset signs itself out immediately (05 FR-13).
- NFR-4: Rate limiting uses only 429 `rate-limited` with `Retry-After`; no `X-RateLimit-*`/`RateLimit-*` headers (product decision). Limits (product-approved): 60 requests/min/user on `GET /me`; 10 requests/min/user on `PUT /me`; 30 failed-auth requests/min/IP.
- NFR-5: Error responses for 401 reveal no reason beyond the `type` (no distinction between "unknown user" and "bad signature").
- NFR-6: Availability of token verification must not depend on a per-request call to Firebase Auth (local verification against the published signing keys, FR-1); the deleted-user check of FR-14 is the only per-request lookup and is included in the NFR-1 budget.

## Acceptance criteria
- AC-1: Given a valid token and an existing profile, When `GET /me` is called, Then 200 with `id,name,email,created_at,updated_at` and `Cache-Control: no-store` (verifies FR-1, FR-4, FR-6).
- AC-2: Given no Authorization header, When `GET /me` is called, Then 401 `unauthenticated` with `WWW-Authenticate: Bearer` (verifies FR-2, FR-7).
- AC-3: Given a token signed for a different Firebase project (or an unknown key id after the key refetch), When any endpoint is called, Then 401 `unauthenticated` (verifies FR-1, FR-2).
- AC-4: Given an expired but otherwise valid token, When any endpoint is called, Then 401 `token-expired` (verifies FR-2).
- AC-5: Given a valid token whose user has been disabled for longer than the NFR-3 window, When `GET /me` is called, Then 403 `account-disabled` (verifies FR-3, NFR-3).
- AC-18: Given account deletion has completed and the user's access token has not expired, When `GET /me` or `PUT /me` is called, Then 401 `unauthenticated` and no profile exists afterwards (verifies FR-14).
- AC-19: Given deletion is in progress, When `GET /me` is called, Then 409 `account-deletion-in-progress` (verifies FR-14).
- AC-6: Given a valid token with no profile, When `GET /me` is called, Then 404 `profile-not-found` (verifies FR-4).
- AC-7: Given no profile, When `PUT /me` with `{"name":"  Elena  ","consent":{"terms_version":"T1","privacy_version":"P1"}}`, Then 201, `Location: /me`, `name` is `Elena`, `email` equals the token's email, `language` is `null`, `consent.accepted_at` is set by the server (verifies FR-5, FR-6, FR-13).
- AC-15: Given no profile, When `PUT /me` without `consent`, Then 400 `invalid-request` with `consent` `REQUIRED`; with unknown versions, Then `UNKNOWN_VERSION` (verifies FR-5, FR-13).
- AC-16: Given a profile, When `PUT /me` with `{"name":"Elena","language":"ru"}`, Then 200, `language` is `ru`, consent unchanged; `language` `"de"` gives 400 `INVALID_VALUE` (verifies FR-5).
- AC-17: Given a user whose email is unverified, When `GET /me` is called, Then 200 with `email_verified: false`; after verification and token refresh, `true`; no endpoint rejects the unverified user (verifies FR-6, FR-12).
- AC-8: Given a profile exists, When the same `PUT /me` is repeated, Then 200 and the body is identical to the first response (verifies FR-5).
- AC-9: Given `{"name":"A","consent":{...}}`, `{}`, or a 101-character name, When `PUT /me`, Then 400 `invalid-request` with `invalid_params` naming `name` (`TOO_SHORT`, `REQUIRED`, `TOO_LONG`) (verifies FR-5, FR-7).
- AC-25: Given `{"name":"Elena","consent":{...},"email":"x@y.z","id":"other","foo":1}`, When `PUT /me`, Then 201/200 as for a valid body, and `email`, `id` in the response are unaffected by the extra properties (verifies FR-5, FR-6).
- AC-10: Given `X-Flow-ID: abc-123`, When any request is made, Then the response header and (on error) `flow_id` equal `abc-123`; Given no/invalid header, Then a generated value is returned (verifies FR-8).
- AC-11: Given a user exceeds the limit on `GET /me`, When another request is made, Then 429 `rate-limited` with a numeric `Retry-After` (verifies FR-9, NFR-4).
- AC-12: Given any request, When logs are inspected, Then no token, password, name or email values appear and `flow_id` is present (verifies NFR-2).
- AC-13: Given a body with `Content-Type: text/plain`, When `PUT /me`, Then 415 `invalid-request` problem (verifies FR-10).
- AC-20: Given an unsupported method such as `POST /me`, When called with a valid token, Then 405 with `Allow: GET, PUT` (plus methods added by later milestones) and an `invalid-request` problem (verifies FR-15).
- AC-21: Given a `PUT /me` body above the documented maximum, Then 413 `invalid-request` (verifies FR-16).
- AC-22: Given the API description, When reviewed, Then every operation declares `bearerAuth` or is marked public, and no operation in this milestone is marked public (verifies FR-11).
- AC-23: Given a missing token, an expired token and a bad-signature token, When `GET /me` is called, Then the three 401 bodies differ only in `type` (`unauthenticated` or `token-expired`) and carry no further reason text, and `unauthenticated` is identical for unknown-user and bad-signature cases (verifies NFR-5).
- AC-26: Given profile-less auth users aged 25 hours and 10 hours, When the cleanup has run, Then only the 25-hour one is deleted from Firebase Auth (an account is never deleted before 24 hours and is gone by 48 hours), and a second run changes nothing (verifies FR-17).
- AC-24: Given load at the NFR-4 limits with 10% of calls from deleted users, When latency is measured, Then p95 of `GET /me` stays <= 500 ms and token verification succeeds while the deleted-user lookup is slowed in test (the request still gets a defined 401/503, never an unverified pass) (verifies NFR-6, FR-14). NFR-6 additionally is verified by design review.
- AC-14: Given load at the NFR-4 limits, When latency is measured, Then p95 <= 500 ms (verifies NFR-1).

## Open questions
None beyond the external items under "Prerequisites and external questions".

## Prerequisites and external questions
- Verify at implementation: the signing-key source for Firebase ID tokens (Google's published X.509 certificates / JWKS for `securetoken@system.gserviceaccount.com`) and its cache lifetime; expected `iss` and `aud` values; that the ID token carries the `email_verified` claim needed for `Me.email_verified`.
- Verify at implementation: that disabling a user or a password reset (05 FR-13) revokes refresh tokens so that a revoked user loses access within the 1-hour ID token lifetime.
- Verify at implementation: how the API checks that an auth user still exists / is being deleted at low latency (FR-14, NFR-6), and how "recent sign-in" is read from the ID token (`auth_time`) for `DELETE /me`.
- API metadata ownership for the OpenAPI description (`x-audience`, `x-api-id`, contact) is not provided; do not invent.
- Firebase service-account credential custody for the backend (secret management, rotation): owner to be provided.
