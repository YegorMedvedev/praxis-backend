# 06 Case-to-agent mapping

- **Milestone:** Chat simulation
- **Screens covered:** none (server-side configuration behind the Chat screen)
- **Depends on:** backend/case-library/01, 02, 03 (the module, `case_translations` table and seed already exist)
- **Type:** BE

## Description
Each case has one OpenAI agent per language: case 1 in `en` uses `agent_id_1`, case 1 in `ru` uses `agent_id_2`. This feature stores that mapping in case-library, loads it through the existing seed mechanism, and exposes a server-only lookup through `case-library.public-api.ts` that chat-simulation calls when a session is created. The mapping is never returned by any HTTP endpoint.

## Scope
**In scope:** a nullable `agent_id` column on `case_library.case_translations`, the migration, seed support, the lookup use case and its public-API export, tests that prove the id never leaks.
**Out of scope:** calling OpenAI (07), sessions (01), creating or editing agents (done by the product owner in OpenAI), any admin or HTTP write endpoint, validating that an id exists at OpenAI.

## APIs
None. No endpoint of case-library (`GET /cases`, `GET /cases/{case_id}`, `GET /me/case-progress`) changes shape. In particular **no response may contain `agent_id`**, and `LocalizedCase` / `CaseContent` must not gain it (they hold learner-facing text only). Keep the agent id out of the `Case` aggregate's learner-facing projection; model it as a separate server-side value.

## Server-side lookup (public API)
Export from `case-library.public-api.ts` a use case `ResolvePatientAgent` (plain class, wired with `useFactory`) and its types:

- Input: `{ caseId: string, language: Language }`.
- Output: `{ agentId: string } | null`.
- Returns `null` when the case does not exist, is **hidden** (not complete in both `en` and `ru`, same visibility rule as the catalog), or its translation for `language` has no `agent_id`. It never throws for those cases; an unknown or malformed `caseId` is simply `null`.
- Chat-simulation declares its own port in its `domain/` and adapts this export in its `infrastructure/`, as `courses/infrastructure/users-author-directory.ts` does for users. Do not import case-library internals from chat-simulation.

## Functional requirements
- FR-1: The system shall store at most one agent id per (case, language) in `case_library.case_translations.agent_id` (`varchar(128)`, nullable), added by a new migration. The migration is additive and reversible and never touches existing rows.
- FR-2: The seed (`SeedCase`) shall accept an optional `agentIds?: Partial<Record<Language, string>>` per case, kept apart from `content`. `pnpm seed:cases` shall write each provided id and shall **leave an existing `agent_id` untouched when the seed omits it** (the seed never deletes or clears data). The seed remains idempotent.
- FR-3: The seed shall reject, before touching the database, an agent id that is empty after trimming, longer than 128 characters or contains whitespace or control characters, naming the case id and language (not the value) in the error. No prefix such as `agent_` is enforced.
- FR-4: `ResolvePatientAgent` shall return the id for a visible case with a configured id for the language, and `null` otherwise (FR-1 rules above).
- FR-5: The mapping shall be language-specific: the same case with `en` and `ru` resolves to two different ids.
- FR-6: No HTTP response, log line or error body shall contain an agent id. Logs may contain case id and language.
- FR-7: The shipped placeholder seed shall contain **no** agent ids (they are real configuration, not content an agent may invent). A case without an id remains visible in the catalog and detail but cannot be practised (chat-simulation/01 FR-11).

## Non-functional requirements
- NFR-1: The lookup is a single indexed read by primary key (`case_id`, `language`); no N+1.
- NFR-2: Domain code for the lookup imports no third-party package; ORM mapping stays in `infrastructure/persistence/`, as for the existing entities.

## Acceptance criteria
- AC-1: Given the migration is applied to a database that already has case rows, Then existing rows are intact and `agent_id` is null for all of them; the migration runs down and up cleanly (FR-1). (Integration, Testcontainers.)
- AC-2: Given seed data with `agentIds: { en: 'agent_a', ru: 'agent_b' }` for a case, When the seed runs twice, Then the rows hold those ids and nothing else changes (FR-2).
- AC-3: Given a stored id and a seed that omits `agentIds` for that case, When the seed runs, Then the stored id is unchanged (FR-2).
- AC-4: Given seed data with an id of `""`, `"   "`, 129 characters, or `"a b"`, When the seed validates, Then it fails with an error naming case and language and the database is untouched (FR-3).
- AC-5: Given a visible case with ids for both languages, When `ResolvePatientAgent` runs for `en` and `ru`, Then it returns the two different ids (FR-4, FR-5).
- AC-6: Given a case missing the `ru` content (hidden) but with an id for `en`, Then the lookup returns `null` for `en` (FR-4).
- AC-7: Given a visible case with an id for `en` only, Then `ru` returns `null` (FR-4).
- AC-8: Given an unknown or malformed case id, Then the lookup returns `null` and does not throw (FR-4).
- AC-9: Given configured ids, When `GET /api/v1/cases` and `GET /api/v1/cases/{id}` are called in both languages, Then the serialized bodies do not contain the id string or the key `agent_id` (FR-6). (E2E.)
- AC-10: `pnpm test:arch` passes: case-library `domain/` and `application/` import nothing third-party; chat-simulation reaches the lookup only through the public API (NFR-2).

## Open questions
- OQ-1: Where the real agent ids come from and who commits them. Proposed: the product owner provides a table (case id, language, agent id) and a developer fills `agentIds` in `case-seed.data.ts`; ids are identifiers, not secrets, but confirm they may live in the repo (HUMAN-REQUIRED). Until then no case is practisable in any environment.
- OQ-2: Whether a case that has no agent in one language should be hidden from that language's catalog instead of staying visible but not practisable. This task keeps the catalog independent of chat readiness; revisit if the app shows a dead "Start" button.
