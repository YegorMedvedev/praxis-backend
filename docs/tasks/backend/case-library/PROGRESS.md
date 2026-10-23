# Case Library backend: progress ledger

Order: 03 first (domain, completion port, progress), then 01 (list), then 02 (detail). Serial execution on branch `feat/case-library`.

| Task | Status | Commit | Notes |
|---|---|---|---|
| 03 completion-and-progress (module scaffold, domain, completion use case + public API, `GET /me/case-progress`, migration, seed) | done | 9a56308 | lint/test/arch/integration/e2e green (orchestrator-run, Node 24, Ryuk off). 1 review, 0 blocking. Unmet: spec AC-16 (per-user 429; only global per-IP limiter applies; see HUMAN-REQUIRED). Non-blocking follow-ups: length/NUL guard in RecordCaseCompletion; assert no-store on 401/405 in e2e. |
| 01 case-catalog-api (`GET /cases`) | todo | | |
| 02 case-detail-api (`GET /cases/{case_id}`, `case-not-found`) | todo | | |

## Spec conflicts and assumptions (running list)

- Specs write `/cases`, `/me/case-progress`; the real routes are `/api/v1/cases`, `/api/v1/me/case-progress` (global prefix).
- 02 and 03 refer to "visible per 01 NFR-5", but 01 has no NFR-5. Conservative reading: a case is *visible* iff it has complete content in both `en` and `ru` (01 NFR-2, FR-6).
