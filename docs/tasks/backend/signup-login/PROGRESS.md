# Sign-up & Log-in backend: progress ledger

Order follows each spec's `Depends on:`. Serial execution (01 → 06 → 05); 05 needs the auth/http plumbing from 06.

| Task | Status | Commit | Notes |
|---|---|---|---|
| 01 firebase-project-setup | partial | f922591 | Console work is human-only (see HUMAN-REQUIRED.md). Code side done: Firebase env config + validation, emulator/production guard. Console work blocked on human. Reviewed by orchestrator directly (config-only diff). Docker tests need `TESTCONTAINERS_RYUK_DISABLED=true` and Node 24 (dependency-cruiser rejects Node 25) on this machine. |
| 06 authenticated-api-foundation | todo | | Depends on 01. Token verification, problem types, X-Flow-ID, rate limit, GET/PUT /me. |
| 05 reset-email-and-action-domain-setup | todo | | Depends on 01. Console/DNS work is human-only. Code side: mailer port, Resend adapter, fake, reset-link use case + endpoint. |
