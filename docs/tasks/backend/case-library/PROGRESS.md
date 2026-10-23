# Case Library backend: progress ledger

Order: 03 first (domain, completion port, progress), then 01 (list), then 02 (detail). Serial execution on branch `feat/case-library`.

| Task | Status | Commit | Notes |
|---|---|---|---|
| 03 completion-and-progress (module scaffold, domain, completion use case + public API, `GET /me/case-progress`, migration, seed) | done | 9a56308 | lint/test/arch/integration/e2e green (orchestrator-run, Node 24, Ryuk off). 1 review, 0 blocking. Unmet: spec AC-16 (per-user 429; only global per-IP limiter applies; see HUMAN-REQUIRED). Non-blocking follow-ups: length/NUL guard in RecordCaseCompletion; assert no-store on 401/405 in e2e. |
| 01 case-catalog-api (`GET /cases`) | done | 9da263c | Implemented with 02 in one commit. test:all green (orchestrator-run). Unmet: per-user 429 (global per-IP limiter only; HUMAN-REQUIRED); p95 latency not measured. |
| 02 case-detail-api (`GET /cases/{case_id}`, `case-not-found`) | done | 9da263c | See 01. Undecodable percent-escape ids (`/cases/%E0%A4%A`) are mapped to 404 `case-not-found` by a path-scoped rule in the problem filter; such a path is 404 even without a token (router fails before auth). |

## Spec conflicts and assumptions (running list)

- Specs write `/cases`, `/me/case-progress`; the real routes are `/api/v1/cases`, `/api/v1/me/case-progress` (global prefix).
- 02 and 03 refer to "visible per 01 NFR-5", but 01 has no NFR-5. Conservative reading: a case is *visible* iff it has complete content in both `en` and `ru` (01 NFR-2, FR-6).
- Undecodable percent-escapes in `/cases/{id}` fail in Express routing before guards/405; handled in `problem-details.filter.ts` by path regex (documented limitation: 404 instead of 401/405 for that path shape).
- `RecordCaseCompletion` stores completions without checking the catalog (needed for FR-4/FR-10); reads filter by visibility. chat-simulation must validate the case.
