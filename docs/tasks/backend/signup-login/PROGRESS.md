# Sign-up & Log-in backend: progress ledger

Order follows each spec's `Depends on:`. Serial execution (01 → 06 → 05); 05 needs the auth/http plumbing from 06.

| Task | Status | Commit | Notes |
|---|---|---|---|
| 01 firebase-project-setup | partial | f922591 | Console work is human-only (see HUMAN-REQUIRED.md). Code side done: Firebase env config + validation, emulator/production guard. Console work blocked on human. Reviewed by orchestrator directly (config-only diff). Docker tests need `TESTCONTAINERS_RYUK_DISABLED=true` and Node 24 (dependency-cruiser rejects Node 25) on this machine. |
| 06a platform plumbing (part of 06) | done | a42a0f0 | Problem types, X-Flow-ID, Firebase token verification (emulator e2e), rate limit, logging, bearerAuth. 1 review + 1 fix round.
| 06b /me (part of 06) | done | (pending) | `users` module, GET/PUT /me, consent versions config, ValidationPipe now 400 invalid-request + invalid_params. 1 review + 1 fix round. Email not persisted (taken from token). 403 incomplete-identity for tokens without email is an assumption. |
| 05 reset-email-and-action-domain-setup | todo | | Depends on 01. Console/DNS work is human-only. Code side: mailer port, Resend adapter, fake, reset-link use case + endpoint. |

## Spec conflicts and assumptions (running list)

- Route prefix: spec 06 says `/me`; AGENTS.md and existing code use `/api/v1`. Kept `/api/v1/me` (conventions forbid URL versioning but AGENTS.md lists the prefix as a known gap; not touched).
- Problem body: AGENTS.md sample has `instance`; spec 06 has `flow_id`/`invalid_params`. Emit all; legacy types kept.
- `account-disabled` 403: spec forbids per-request revocation checks (NFR-2/4), so the API only has the type; disabled users fail at client token refresh.
- FR-1 "refetch on unknown kid": firebase-admin caches by max-age only; deviation documented.
- Swagger docs are disabled in production (spec: no public endpoints).
- Rate limiter is in-memory, per instance.
- Password-reset endpoint request/response shape is not specified in any spec (task 05 only specifies a mailer); assumption to be logged under task 05.
