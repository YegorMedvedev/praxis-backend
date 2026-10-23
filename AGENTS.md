# AGENTS.md

REST backend for Praxis, a mobile + web app where psychotherapists and counselors practice
high-stakes patient conversations (suicidal ideation, harm to others, trauma disclosure) with
an AI-played "virtual patient" built from anonymized case studies. Users are professionals
and trainees. The content is sensitive: treat privacy and safety as first-class.

The client is an Expo / React Native app (iOS, Android, web) in a separate repo. It is
currently built on mocks; this backend replaces them.

A **modular monolith** built with NestJS, following clean architecture. Read this before changing anything structural.

## Commands

| Command                                                           | What it does                                             |
| ----------------------------------------------------------------- | -------------------------------------------------------- |
| `pnpm start:dev`                                                  | Run the API in watch mode                                |
| `pnpm test`                                                       | Unit tests only                                          |
| `pnpm test:arch`                                                  | **The architecture gate.** Must pass before every commit |
| `pnpm test:integration`                                           | Repository tests against real PostgreSQL (needs Docker)  |
| `pnpm test:e2e`                                                   | Full-application HTTP tests (needs Docker)               |
| `pnpm test:all`                                                   | Everything above, in order                               |
| `pnpm lint`                                                       | oxlint, including the per-layer import rules             |
| `pnpm migration:run`                                              | Apply pending migrations                                 |
| `pnpm migration:generate src/platform/database/migrations/<Name>` | Generate a migration                                     |

pnpm only — `npm install` and `yarn` are blocked by a `preinstall` guard.
Node must be >= 24.11.0 (see `.nvmrc`).

## The shape of the codebase

    src/
      shared/      framework-free primitives. Zero third-party dependencies.
      platform/    technical cross-cutting glue: config, database, events, http
      modules/     one folder per business module

Each module has exactly four layers and one public surface:

    modules/<name>/
      domain/           entities, value objects, ports, domain events, errors
      application/      use cases (plain classes), event handlers
      infrastructure/   ORM entities, mappers, repositories, event listeners, DI modules
      presentation/     controllers, HTTP DTOs, guards
      <name>.tokens.ts  DI symbols
      <name>.module.ts  composition root
      <name>.public-api.ts   THE ONLY THING OTHER MODULES MAY IMPORT

## The rules

These are enforced by `pnpm test:arch` (dependency-cruiser). They are not style
preferences — a violation fails the build.

1. **`domain/` imports no third-party package.** Not NestJS, not TypeORM, not
   class-validator. Only `shared/` and its own module's domain.
2. **`application/` imports no framework.** Use cases are plain classes.
3. **Dependencies point inward.** `domain` and `application` never reference
   `infrastructure`, `presentation` or `platform`.
4. **`presentation/` never imports `infrastructure/`.** Controllers depend on use cases.
5. **Cross-module imports go through `<module>.public-api.ts`.** No deep imports, ever.
6. **`typeorm` appears only** in `*/infrastructure/` and `platform/database/`.
7. **No cycles.** Between files, layers or modules.
8. **`shared/` is pure.** No third-party imports at all.

### Why use cases are wired with `useFactory`

Nest's `@Injectable()` would put `@nestjs/common` inside the application layer and
break rule 2. So use cases are plain classes, and `<name>.module.ts` constructs them:

```ts
{
  provide: ProvisionUser,
  inject: [USER_REPOSITORY, ID_GENERATOR, CLOCK],
  useFactory: (users, ids, clock) => new ProvisionUser(users, ids, clock),
}
```

The framework lives in the composition root and nowhere else. This is deliberate;
do not "simplify" it by adding decorators to use cases.

### Why the module root must not import TypeORM

`<name>.module.ts` is not inside `infrastructure/`, so rule 6 applies to it.
TypeORM wiring therefore lives in `infrastructure/<name>-infrastructure.module.ts`,
which the module root imports.

## How modules talk to each other

- **Reads:** the target module publishes an interface from its `public-api.ts`. The
  consuming module declares its _own_ port in `domain/` and adapts it in
  `infrastructure/` — see `courses/infrastructure/users-author-directory.ts`. This keeps
  the consuming application layer free of any knowledge about the other module.
- **Facts:** the emitting module publishes a domain event through the
  `DomainEventPublisher` port. The consuming module listens with `@OnEvent` in an
  `infrastructure/events/` adapter that calls a plain application handler.

## API guidelines

### Standard: Zalando RESTful API Guidelines

All HTTP APIs follow the [Zalando RESTful API Guidelines](https://opensource.zalando.com/restful-api-guidelines/).
Where this document is silent, Zalando decides. In practice:

- **Resources, not actions.** Plural nouns for collections (`/courses`, `/users/{id}`);
  HTTP methods carry the verb. Use standard method semantics (safe/idempotent `GET`,
  `PUT`, `DELETE`; `POST` to create).
- **Naming.** `kebab-case` path segments, `snake_case` JSON properties and query
  parameters, `UpperCamelCase-With-Hyphens` custom headers. Path parameters are
  identifiers only.
- **Status codes.** Use the most specific standard code (`201` + `Location` on create,
  `204` for empty success, `409` for conflicts, `422`/`400` for validation, `401` vs `403`
  used correctly).
- **Collections.** Cursor-based pagination by default; never return a bare top-level JSON
  array — wrap it in an object.
- **Compatibility.** Additive changes only; never remove or repurpose a field without a
  deprecation period.
- **Documentation.** Every endpoint is described in OpenAPI (Swagger decorators live in
  `presentation/` only).

### Errors: RFC 9457 Problem Details

Every error response — domain, validation, framework (404 for unknown routes, 401, 500…)
— is `application/problem+json` per [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html)
(Zalando rule 176). No other error shape may leave the API.

    HTTP/1.1 409 Conflict
    Content-Type: application/problem+json

    {
      "type": "https://api.example/problems/conflict",
      "title": "Conflict",
      "status": 409,
      "detail": "email already registered",
      "instance": "/api/v1/users"
    }

- `type` is a stable URI identifying the problem kind; `title` is a short, constant,
  human-readable summary for that type; `status` mirrors the HTTP status; `detail` is
  specific to this occurrence; `instance` identifies the occurrence or request path.
- Clients branch on `type`, never on `title` or `detail`. Problem types are a public
  contract: adding one is additive, renaming or removing one is breaking.
- Extension members (e.g. `errors` for per-field validation failures) are allowed,
  `snake_case`, and documented in OpenAPI.
- Domain errors map via stable codes to `not-found`, `conflict`, `validation-failed`,
  `unauthenticated`, `forbidden` and `incomplete-identity`. New problem types need a stable
  code on the domain error and an entry in the filter's table.
- Never leak stack traces, SQL, internal ids or other implementation detail in any member.
- **Where it lives.** `platform/http/problem-details.filter.ts` is the single catch-all
  filter. Domain errors stay framework-free in `domain/` and carry a stable machine code;
  they know nothing about HTTP. Mapping from error to problem (status, `type`, `title`)
  happens only there. Presentation code never builds error bodies by hand.

## Firebase authentication configuration

- `FIREBASE_PROJECT_ID` is required.
- `FIREBASE_CREDENTIALS_JSON` is optional service-account JSON. When omitted,
  `firebase-admin` uses Application Default Credentials, as on Cloud Run and GKE.
- Local Firebase Auth emulator runs can set `FIREBASE_AUTH_EMULATOR_HOST` (for example,
  `127.0.0.1:9099`); the Admin SDK reads this setting directly. Because the emulator
  accepts unsigned tokens, the app refuses to boot when it is set with `NODE_ENV=production`.
- E2E tests start an isolated Firebase Auth emulator and PostgreSQL through Testcontainers.

## Password reset configuration

- `APP_BASE_URL` is required — the trusted app origin the emailed reset link points at.
  Never taken from a request's `Host` header.
- `RESEND_API_KEY` is required and secret — the Resend API credential used to send the
  branded reset email.
- `PASSWORD_RESET_EMAIL_FROM` is required — the Resend-verified sender address for reset
  emails.
- `PASSWORD_RESET_RATE_LIMIT` and `PASSWORD_RESET_RATE_WINDOW_MS` are optional, defaulting
  to `5` requests per `60000` ms, and scope rate limiting to
  `POST /api/v1/auth/password-reset` only.

## Database conventions

- **One PostgreSQL schema per module** (`users`, `courses`).
- **No foreign keys across module schemas.** A column like `courses.courses.author_id`
  points at another module's data by id only, so a module stays extractable.
- `synchronize` is permanently `false`. Schema changes are always migrations.
- Migrations are never auto-run on boot.
- Domain models never carry ORM decorators. `*.orm-entity.ts` files are separate, and
  mappers translate between them.

## How to add a module

1. `src/modules/<name>/` with the four layer folders.
2. Domain first: entities, value objects, ports, events. Write the tests first.
3. Application: use cases as plain classes, tested against in-memory fakes.
4. Infrastructure: ORM entities, mappers, repositories, and a migration creating the
   module's schema.
5. Presentation: controllers and DTOs.
6. `<name>.tokens.ts`, `<name>.module.ts`, `<name>.public-api.ts`.
7. Register the module in `src/app.module.ts` via its public API.
8. `pnpm test:all`.

## Testing

- **Unit** — colocated `*.spec.ts`. Domain and use cases against in-memory fakes. No DB.
- **Integration** — `test/integration/`. Real PostgreSQL via Testcontainers.
- **E2E** — `test/e2e/`. The whole app over HTTP.
- **Architecture** — `pnpm test:arch`.

Write the failing test first. Every task ends with all gates green.

## Known gaps against the API guidelines

These predate the guidelines above and are not yet compliant. Do not copy them; fix them
when touching the area.

- JSON properties are camelCase in the courses API; the guidelines
  require `snake_case`.
- `GET /api/v1/courses` returns a bare top-level array with no pagination.
- Routes are prefixed `/api/v1`. Zalando advises against URL versioning (prefer media type
  versioning), so decide deliberately before adding `/v2`.
- `POST /api/v1/auth/password-reset` is an action-shaped path, not a resource noun. The
  path is fixed by the frontend's existing contract; this is a deliberate exception.

## Case library

- `case-library` owns the curated, read-only case catalog and per-user completion
  (schema `case_library`). A case is **visible** only with complete content in both `en`
  and `ru`; hidden cases are excluded everywhere (lists, detail, progress counts).
- Completion is written only by the server: other modules call `RecordCaseCompletion`
  from `case-library.public-api.ts` (idempotent, first `completed_at` wins). There is no
  HTTP write endpoint. `GET /api/v1/me/case-progress` is the read side.
- Content is loaded by `pnpm seed:cases` (idempotent upsert, never auto-run, never deletes).
  The shipped seed is placeholder content only.
- Each case translation may carry a server-only patient `agent_id` (one OpenAI agent per
  case and language). Other modules look it up with `ResolvePatientAgent` from
  `case-library.public-api.ts` (`{ caseId, language }` -> `{ agentId } | null`; null for
  unknown, hidden or unconfigured). It is never in `Case`/`LocalizedCase`, any response or
  any log. The seed takes it as `agentIds?: { en?, ru? }` per case, validated up front
  (non-blank, <= 128 chars, no whitespace/control characters); an omitted id leaves the
  stored one untouched. The shipped seed has none.

## Chat simulation

- `chat-simulation` owns practice sessions (schema `chat_simulation`: `sessions`, `messages`,
  `agent_session_deletions`). No foreign keys to other schemas; user and case ids are plain
  columns. `GET/POST /api/v1/sessions`, `GET/PATCH/DELETE /api/v1/sessions/{session_id}`.
  Session ids are opaque; another user's session is `session-not-found` (404), never 403, and
  `DELETE` answers 204 whether or not the session existed.
- One session per (user, case): creating a session discards every other one for that case in the
  same transaction (advisory lock plus a unique index). Ending marks the case completed through
  `RecordCaseCompletion` (case-library public API) **in the same transaction**.
- **Cross-module atomicity.** Modules do not pass transactions around. `UnitOfWork`
  (domain port) is adapted by `TypeOrmUnitOfWork`, which opens a transaction via
  `platform/database/transaction-context.ts` (`AsyncLocalStorage`). Any TypeORM repository that
  wraps itself in `activeRepository(...)` joins the ambient transaction; case-library's
  completion repository does. Outside a unit of work they behave as before. New repositories that
  must be atomic with a session change need the same one-line wrap.
- The patient cannot end a session in this milestone: `ENDED_BY_PATIENT` exists in the contract
  and domain (a restored session in that state answers `session-ended` to `PATCH`) but nothing
  produces it.
- Server-side attributes `agent_id`, `openai_session_id`, `remote_in_sync` are never serialised
  or logged. Request logs carry the route template only (no ids, no bodies).
- **Remote cleanup.** Discarding a session (DELETE, replacement) enqueues its
  `openai_session_id` in `agent_session_deletions` in the same commit. `SessionDeletionWorker`
  (in-process, 30 s interval, single-instance, not started when `NODE_ENV=test`) calls
  `ProcessSessionDeletions`, which deletes via the `RemoteSessionRemover` port and retries with
  exponential backoff (30 s doubling, cap 1 h). It is idempotent and never blocks or fails
  session removal.
- `REMOTE_SESSION_REMOVER` is `OpenAiRemoteSessionRemover` (see "OpenAI configuration").
  The `SessionGenerationCanceller` is the in-process `GenerationRegistry` (see "Chat
  simulation: messages and reply streaming" below).

## OpenAI configuration

- The patient is a saved OpenAI **Agents API** agent (instructions only, no tools), one per
  case and language (agent ids live in case-library seed data). All OpenAI code lives in
  `chat-simulation/infrastructure/remote/` behind the `PatientReplyGenerator` and
  `RemoteSessionRemover` ports; dependency-cruiser rule 9 fails `pnpm test:arch` if any
  other file imports `openai`. The adapters depend on the small `OpenAiAgentsClient`
  interface; `sdk-openai-agents-client.ts` is its only implementation over the SDK.
- `OPENAI_API_KEY` is required at boot and secret (no default, never logged). Unit,
  integration and e2e tests use a dummy value and fakes, and never reach OpenAI. No other
  OpenAI variables exist: timeouts belong to the application layer and SDK retries are
  off (a retry could duplicate input; "Try again" is the client's decision).
- The installed `openai` SDK (see `package.json`) selects the saved agent with `agent_id`
  (its `agent` object carries per-session overrides only and has no `id`); no overrides are
  sent. The session is created with `environment: { type: 'none' }`. Follow-ups use
  `sessions.stream()`, which subscribes to events before sending the input with an
  idempotency key derived from the therapist message id.
- The adapter yields `remote-session` before the first text of a new remote session and
  honours the abort signal (closes the stream, best-effort `agent.session.input.cancel`);
  persistence of `openai_session_id` / `remote_in_sync` stays in the application layer. The
  remote session is a cache: when it is missing or out of sync, a new one is created and the
  stored transcript is replayed (`formatTranscriptForReplay`).
- `placeholder-prompts.ts` holds the PLACEHOLDER opening input and replay wording; the
  product owner must approve them (HUMAN-REQUIRED).
- Logs carry session id, event type counts, durations, time to first delta, HTTP status,
  OpenAI request id and error class only. A 401/403 from OpenAI also logs
  `openai_auth_failed`; alert on it and on `reply_generation_failed`.
- The SDK client is built with a fixed base URL, no organization/project and `logLevel:
  'off'`, so stray `OPENAI_BASE_URL`, `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID` or `OPENAI_LOG`
  variables can neither redirect the key and transcripts nor enable request-body logging.
- Known gaps: a new remote session that is aborted or fails before its first event carrying a
  session id is never tracked, so it is not queued for deletion (only provider expiry removes
  it). Delta events carry no subagent flag; the adapter learns subagent turn ids from
  `turn.*` events (the agents have no subagents, so this is defensive). A text/delta mismatch
  is detected only at `turn.completed`, after the deltas were already streamed; the stream
  then ends in an error and the client must treat the reply as failed.
- Accepted trade-offs: OpenAI retains session state (no zero data retention), US-only
  residency, remote deletion is asynchronous, and single-flight is per instance.
- `pnpm test:agents` is an opt-in smoke test against the real API (never in `test:all` or CI,
  never run by automation). It needs `OPENAI_API_KEY`, `SMOKE_AGENT_ID_EN` and/or
  `SMOKE_AGENT_ID_RU`; each language is skipped without its id. It makes billable calls,
  deletes the remote sessions it creates and prints no reply text.

## Chat simulation: retention and privacy

- **90-day retention.** Every session is deleted with its messages once `created_at + 90 days`
  has passed, in any status (the clock starts at creation). Case completion is untouched.
  `PurgeExpiredSessions` (application) deletes in batches of 200 (at most 500 per pass) with
  `FOR UPDATE SKIP LOCKED` and enqueues each `openai_session_id` in `agent_session_deletions` in
  the SAME transaction as the delete; a failing batch rolls back whole. Idempotent and safe to
  run twice. `RetentionWorker` (in-process, single instance, not started when `NODE_ENV=test`,
  never overlaps passes) runs 10 s after boot and then every 6 hours; it logs counts only
  (`retention_purge`, `retention_purge_failed` with the error class).
- **NFR-1 (nothing older than 90 d + 24 h).** A session is removed by the first pass after its
  90th day, so the worst case is one interval plus the pass duration (about 6 h), well inside 24 h.
  The startup pass means restarts do not postpone enforcement. Defence in depth: `GET`, `PATCH`,
  `GET/POST .../messages` and `.../patient-replies` already answer `session-not-found` for a
  session older than 90 days (`Session.isExpired`), even before the job has deleted it.
- **Runbook and audit:** `docs/runbooks/chat-simulation-erasure.md` (manual erasure of one user,
  retention audit, backups, transcript access). The SQL lives next to it and is run by
  integration tests. Nobody sees a stopped or failing job unless the audit query or an alert on
  `retention_purge_failed` / `remote_session_deletions_failed` / `reply_generation_failed` exists.
- No tooling exposes transcript text (FR-11) and the API has no transcript export; only
  `GET /api/v1/sessions/{session_id}/messages` returns message text, to its owner (e2e-tested).
  The learner's own messages follow the same rules as the patient's, and a distress message is
  handled like any other (no detection, no flag; tested).
- Logs never contain message text, prompts, provider messages or remote ids (e2e marker scan over
  create, message, stream, failure, end, discard, retention and cleanup, in both languages).
- Operational limits: both workers are per instance (run them on one instance only); backups
  must expire within 30 days (a deployment decision, see HUMAN-REQUIRED); a remote session
  whose id was never stored cannot be found and is only removed by OpenAI's own expiry.

## Public endpoints

Every route requires a Firebase bearer token except those marked `@Public()`
(`platform/auth/public.decorator.ts`). Today that is only
`POST /api/v1/auth/password-reset`. Its request body is `{ "email", "language"? }`
(`language` is `en` or `ru`, default `en`; an assumption, no spec defines it). It answers
`202 Accepted` with an empty body for any well-formed request and does ALL work (Firebase
link generation, Resend send) afterwards in an in-process background runner, so neither the
body nor the latency depends on whether the account exists. Link-generation or Resend
failures, a malformed link and a per-address throttle (3 per hour per SHA-256 of the
lowercased address) are all silent; only the stage and error class are logged as
`password_reset_failed`. Operational notes:

- Nobody sees an outage unless someone alerts on `password_reset_failed` log events.
- There is no Resend retry or idempotency key; work in flight is lost on a crash or restart
  (the user requests again). The runner drops work beyond 100 concurrent tasks.
- Public requests are charged to the global per-IP limit; the route has its own per-IP limit
  (`PASSWORD_RESET_RATE_LIMIT`). Both limiters, and the per-address throttle, are in memory
  and per instance, and fail closed at 10,000 keys (new keys are refused until a window
  expires; for the per-address throttle that means new addresses get no email).
- A wrong `TRUST_PROXY_HOPS` collapses all clients into one IP bucket (or lets them spoof it).
- `@Public()` placed on a class opens every handler of that class; use it on handlers only.

## Known access-control decision

- `GET /api/v1/users/:id` is currently unauthenticated and returns full user details
  (including email) by design — no guard was specified for this endpoint in the original
  plan. Don't mistake the silence for a considered access-control decision.

- Never start background work (fire-and-forget promises, event handlers) inside `UnitOfWork.run`: it inherits the ambient transaction (`platform/database/transaction-context.ts`) and would use a released query runner.

## Chat simulation: messages and reply streaming

- `chat-simulation` stores the transcript (`chat_simulation.messages`) and streams the
  virtual patient's reply as Server-Sent Events. `POST /api/v1/sessions/{id}/messages`
  stores a therapist message, `GET .../messages` lists them, and
  `POST .../patient-replies` streams the reply (events `reply.started`, `reply.delta`,
  `reply.completed`, `error`; `session.ended` is reserved and never sent). Each `data:` is
  one line of JSON; `: keep-alive` comments go out after 15 s of silence; the response
  carries `Cache-Control: no-store` and `X-Accel-Buffering: no`.
- A reply is **pending** when the last stored message is not a `PATIENT` message (an empty
  session included). A patient message is stored only when the generator completed, the
  reply is at most 2,500 characters and the session is still `IN_PROGRESS`; failure,
  time-out (15 s without text), client disconnect and ending or discarding the session
  store nothing. Errors before the stream starts are ordinary problems; afterwards they
  are an `error` event carrying the same problem object (`toProblem` in
  `platform/http/problem-details.ts`).
- **Single-flight is in process.** `GenerationRegistry` (application layer) allows one
  generation per session and doubles as the `SessionGenerationCanceller`. It works for
  ONE instance only: with several instances two replies for the same session could be
  generated at once. Scaling out needs a shared lock (for example a PostgreSQL advisory
  lock or a `generating_since` column) first. The stored-reply step re-checks the
  transcript under the session row lock, so a second reply is still never stored.
- The reply generator sits behind the `PatientReplyGenerator` port. Tests bind
  `FakePatientReplyGenerator` (`application/fakes.ts`). The production binding is
  `OpenAiPatientReplyGenerator` (see "OpenAI configuration"). The application layer, not the
  adapter, persists `openai_session_id` and `remote_in_sync` (set false before each
  generation, true only when the reply is stored) and queues a replaced remote session for
  deletion.
- Logs carry flow id, session id, event counts and timings only (`patient_reply_stream`),
  never message text, prompts or provider messages.
