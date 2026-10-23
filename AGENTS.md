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
