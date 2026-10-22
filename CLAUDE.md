# CLAUDE.md

# Praxis backend: project context

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Freshly scaffolded NestJS 12 (TypeScript 6) starter. `src/` only contains the default `AppModule` / `AppController` / `AppService` and `main.ts`. There is no database, config, auth, or domain code yet, so extend the standard Nest module/controller/service layout as features are added.

## Commands

```bash
npm install
npm run start:dev      # watch mode
npm run build          # nest build (deletes dist/ first)
npm run start:prod     # node dist/main
npm run lint           # oxlint src/ test/  (not ESLint)
npm run format         # prettier --write on src/ and test/

npm test               # unit tests (*.spec.ts, colocated in src/)
npm run test:e2e       # e2e tests (test/*.e2e-spec.ts, config in test/jest-e2e.json)
npx jest src/app.controller.spec.ts          # single test file
npx jest -t "root"                           # single test by name
npm run test:debug     # jest --runInBand with inspector
```

## Tooling notes

- Linting uses **oxlint** (`oxlint.json`); `no-floating-promises` is a warning and `no-explicit-any` is off.
- Prettier: single quotes, trailing commas everywhere.
- `jest.config.ts` reads `paths` from `tsconfig.json` to build `moduleNameMapper`. Define path aliases in `tsconfig.json` only, not in the Jest config.
- Unit tests are matched by `.*\.spec\.ts$`; e2e tests live separately in `test/` and use their own Jest config.

Placeholder name; no final name chosen. Read this before working on the codebase.

## What it is

REST backend for Praxis, a mobile + web app where psychotherapists and counselors practice
high-stakes patient conversations (suicidal ideation, harm to others, trauma disclosure) with
an AI-played "virtual patient" built from anonymized case studies. Users are professionals
and trainees. The content is sensitive: treat privacy and safety as first-class.

The client is an Expo / React Native app (iOS, Android, web) in a separate repo. It is
currently built on mocks; this backend replaces them.

## Source of truth: the feature specs

Requirements live in the app repo under `docs/tasks/` (copy or link them here as `docs/tasks/`):

- `_shared/conventions.md`: BINDING decisions and API rules. Read first.
- `_shared/feature-template.md`: format of every spec.
- Milestones: `signup-login/`, `case-library/`, `chat-simulation/`, `session-feedback/`,
  `account-settings/`. Each file has functional requirements (FR), non-functional
  requirements (NFR), acceptance criteria (AC) and "Open questions".
- Build order: `signup-login/01` and `06` first (everything depends on them), then
  `case-library/01-03` and `chat-simulation/01-02` (can run in parallel).
- Implement to the ACs. Every AC references the FR/NFR it verifies; write tests per AC.
- If a spec is ambiguous or contradicts another, do not guess: ask, or record it in that
  file's "Open questions". Open questions marked "prerequisite" or "verify at implementation"
  are real gaps; never invent values (domains, addresses, credentials, copy).

## Decisions already made

- Auth: **Supabase Auth** (email/password, Google, Apple). The API verifies the Supabase
  access token (JWT) locally against the project's published signing keys. No OAuth scopes;
  owner-only access. Supabase project must be in the **EU region**.
- "Confirm email" is OFF. Users sign in without verifying; verification is encouraged in the app.
- API style: REST following the **Zalando RESTful API Guidelines**:
  - kebab-case plural paths, no verbs; `snake_case` JSON properties; `UPPER_SNAKE_CASE`
    enums (exception: `Me.language` is lowercase `en`/`ru`); RFC 3339 UTC timestamps (`*_at`).
  - Errors are `application/problem+json` with relative `/problems/<kebab-name>` types.
    The master registry of problem types and `invalid_params` reasons is in
    `signup-login/06`. Define each type once, in its owner file; never return user-facing text.
  - Unknown request properties and query parameters are IGNORED (tolerant reader);
    known properties are validated strictly.
  - Rate limiting: `429` with `Retry-After` only; no `X-RateLimit-*` headers.
  - `Idempotency-Key` on creating POSTs; key reuse with a different payload is 422,
    a concurrent duplicate is 409. `X-Flow-ID` for tracing; `Accept-Language` is `en` or `ru`.
  - Endpoints and their problem types are defined per spec (e.g. `/me`, `/cases`,
    `/sessions`, `/sessions/{id}/messages`, `/sessions/{id}/patient-replies`).
- AI patient replies are **streamed** (Server-Sent Events) via
  `POST /sessions/{id}/patient-replies`; a retry with the same key resumes the same reply.
  Sessions are not resumable after an app restart. Restarting discards the old session.
- A case is completed when a session ends (by either side). Completion is written
  server-side only, atomically with the session ending.
- Transcripts are kept up to 90 days from session creation, never logged, and erased within
  30 days (including backups) after the user deletes their account.
- Account deletion is a backend operation (`DELETE /me`): erase all user data, revoke the
  Apple token for Apple users, then hard-delete the auth user. It must be idempotent and work
  for a caller with no profile. A daily job deletes profile-less auth users after 24 hours.
- Case content is read-only for now. No authoring or admin APIs.

## Compliance and safety (non-negotiable)

- GDPR and the EU AI Act are in scope. The patient is an AI-simulated character and the
  app discloses it. Never present AI output as clinical advice.
- Never log passwords, tokens or transcript/feedback content. Log with the `X-Flow-ID`.
- The learner's own content is not moderated in the MVP (decided); the patient stays in character.
- The backend owns the content policy for the patient's behaviour: it must be defined and
  testable (see `chat-simulation/02`). Do not hard-code prompts into specs or logs.

## Tech stack

The specs say nothing about the language, framework, database or hosting; these are the chosen ones:

- **Framework:** NestJS 12 on TypeScript (see Commands and Tooling notes above).
- **Database:** Supabase (Postgres), EU region.
- **Auth:** Supabase Auth (see "Decisions already made").
- **Deployment:** Railway.
- **CI/CD:** GitHub (GitHub Actions) for lint, test and build checks; Railway deploys the result.

## Working rules for agents

- Write tests for every AC; run lint and tests before declaring work done.
- Keep each change scoped to one feature spec; reference the spec file in commits and PRs.
- Do not add dependencies or services the specs do not call for without asking.
- Specs are in English; user-facing strings live in the client's i18n files, not here.
