# Sign-up & Log-in backend: progress ledger

Order follows each spec's `Depends on:`. Serial execution (01 → 06 → 05); 05 needs the auth/http plumbing from 06.

| Task | Status | Commit | Notes |
|---|---|---|---|
| 01 firebase-project-setup | partial | f922591 | Console work is human-only (see HUMAN-REQUIRED.md). Code side done: Firebase env config + validation, emulator/production guard. Console work blocked on human. Reviewed by orchestrator directly (config-only diff). Docker tests need `TESTCONTAINERS_RYUK_DISABLED=true` and Node 24 (dependency-cruiser rejects Node 25) on this machine. |
| 06a platform plumbing (part of 06) | done | a42a0f0 | Problem types, X-Flow-ID, Firebase token verification (emulator e2e), rate limit, logging, bearerAuth. 1 review + 1 fix round.
| 06b /me (part of 06) | done | 8bd3d5e | `users` module, GET/PUT /me, consent versions config, ValidationPipe now 400 invalid-request + invalid_params. 1 review + 1 fix round. Email not persisted (taken from token). 403 incomplete-identity for tokens without email is an assumption. |
| 05 reset-email-and-action-domain-setup | partial | 39f9e8b | Depends on 01. Console/DNS work is human-only. Code side done: mailer port, Resend adapter, fake, reset-link use case + endpoint (1 review + 1 fix round). Console/DNS/Resend account/copy blocked on human. |

## Spec conflicts and assumptions (running list)

- Route prefix: spec 06 says `/me`; AGENTS.md and existing code use `/api/v1`. Kept `/api/v1/me` (conventions forbid URL versioning but AGENTS.md lists the prefix as a known gap; not touched).
- Problem body: AGENTS.md sample has `instance`; spec 06 has `flow_id`/`invalid_params`. Emit all; legacy types kept.
- `account-disabled` 403: spec forbids per-request revocation checks (NFR-2/4), so the API only has the type; disabled users fail at client token refresh.
- FR-1 "refetch on unknown kid": firebase-admin caches by max-age only; deviation documented.
- Swagger docs are disabled in production (spec: no public endpoints).
- Rate limiter is in-memory, per instance.
- Password-reset endpoint request/response shape is not specified in any spec (task 05 only specifies a mailer); assumption to be logged under task 05.
- Task 05 (code side): `POST /api/v1/auth/password-reset` is PUBLIC (`@Public()` in `platform/auth`). This conflicts with spec 06 "no public endpoints"; AGENTS.md defines the endpoint, so it wins. The public route is still charged to the global per-IP limit and has its own limit (`PASSWORD_RESET_RATE_LIMIT`/`_WINDOW_MS`, default 5 per 60 s per IP). Swagger marks it `security: []`.
- Task 05: request/response shape is an ASSUMPTION (no spec defines it): body `{ "email": string (valid, <=254), "language": "en"|"ru" (optional, default "en") }`; response always `202` with empty body and `Cache-Control: no-store`; invalid body is `400 invalid-request` with `invalid_params` (REQUIRED / INVALID_TYPE / INVALID_VALUE / TOO_LONG).
- Task 05: enumeration policy. Unknown address, Firebase link-generation failure (any non-"user not found" error) and Resend failure all give the same silent `202`; only the stage and error class name are logged (`password_reset_failed`). Trade-off: a real outage is invisible to the caller (monitor the log event). The whole use case runs in a background runner after the 202, so response timing does not reveal account existence. A silent per-address throttle (3 per hour, hashed key) also never produces a 429.
- Task 05: the app link is rebuilt as `<APP_BASE_URL>/auth-action?mode=resetPassword&oobCode=<code>&lang=<en|ru>` from the `oobCode` of the Firebase-generated link; the Firebase host is never emailed. `APP_BASE_URL` must be a bare http(s) origin (https in production).
- Task 05: Resend is called through plain `fetch` (injectable `HttpClient`), no new dependency. The `PasswordResetLinkGenerator` port takes only the email (language is irrelevant to the link; the email language comes from the request).
- Task 05: the Firebase Auth emulator supports `generatePasswordResetLink` (verified by e2e with the real emulator); only the mailer is faked in e2e.
- Task 05: email copy (EN/RU) is clearly marked placeholder text; real copy and branding come from the product owner.

