# Prompt: build the Case Library backend with a sub-agent loop

Paste everything below the line into a fresh Claude Code session at the repo root.

---

You are the **orchestrator** for building the Case Library backend of Praxis (catalog, detail, per-user completion and progress). Build as much as can be built and verified without a human. Anything that needs a human is not a blocker: record it, work around it, and report it at the end.

## Inputs (read first, in this order)

1. `AGENTS.md`: architecture rules, enforced by `pnpm test:arch`. Non-negotiable. Note the global `/api/v1` prefix: the specs write `/cases`, the real route is `/api/v1/cases`.
2. `docs/tasks/_shared/conventions.md`: binding product decisions and API rules (language `en`/`ru`, case content is read-only, completion on session end).
3. `docs/tasks/backend/case-library/*.md`: the task specs. Find them with `ls`; do not assume the list.
4. The existing code under `src/` and `test/`, especially `src/platform/auth`, `src/platform/http` and `src/modules/auth` and `users`. The sign-up/log-in work provides bearer auth, the problem-details filter, `X-Flow-ID` and rate limiting. Reuse them. Do not rebuild or redefine them. If something a spec assumes is missing from the code, log it under **Spec conflicts** and add the smallest change that fits the existing design.
5. `docs/tasks/backend/chat-simulation/01-session-lifecycle-api.md`, read-only, to understand who will call completion. Do not implement chat-simulation.

**Resolved decisions (do not log as conflicts):**

- This is a new `case-library` module, built exactly as "How to add a module" in `AGENTS.md` describes. Its own PostgreSQL schema is `case_library`, and it has no foreign keys to the `users` schema (store the Firebase uid as a plain id column).
- The specs 01 and 03 depend on each other (01 embeds fields that 03 defines). Build the domain and the completion port first, then the endpoints.
- Completion is written only by the server and has no HTTP write endpoint. Chat-simulation is out of scope, so expose completion as a use case plus a public-API entry point (`case-library.public-api.ts`) that chat-simulation will call later. Test it with a fake caller.
- Case content is curated and read-only through the API. Loading content is not specified, so build a seed mechanism (a migration or a versioned seed file with translated `en` and `ru` content, loaded by a script, never auto-run on boot). Fill it only with clearly fake **placeholder** cases, and log a Human-required item for the real clinical content.
- The `id` of a case is opaque to the client. A malformed or unknown id is 404 `case-not-found`, never 400.

If a spec contradicts `AGENTS.md` or the conventions, or two specs contradict each other, do not pick silently. Take the most conservative reading, continue, and log it under **Spec conflicts**.

## Loop

Keep a ledger at `docs/tasks/backend/case-library/PROGRESS.md` with one row per task: `status` (todo / in-progress / done / partial / blocked), commit sha, and notes. Create it in step 1 and update it after every iteration.

1. **Plan.** Read all task specs and build a dependency order from each spec's `Depends on:` line, treating the 01↔03 link as above. Mark a task `blocked` only if nothing at all can be built for it.
2. **Pick** the next task whose dependencies are `done` or `partial`. Tasks with no dependency between them may run in parallel, but only in separate worktrees (`isolation: "worktree"`), merged one at a time by you.
3. **Dispatch an implementer sub-agent** with a self-contained brief: the task file path, the `AGENTS.md` rules, the ledger, the resolved decisions above, and the Definition of Done below. Sub-agents do not see this conversation, so put everything they need in the brief.
4. **Dispatch a separate reviewer sub-agent** (fresh context) on the diff. It checks:
   - spec compliance (every endpoint, field, header, status code and problem type, including `Content-Language`, `Vary: Accept-Language` and `Cache-Control: no-store`);
   - `AGENTS.md` rules;
   - test quality;
   - privacy (a user must never see another user's completion state, and nothing sensitive leaks into logs or error bodies).

   It also checks that the detail and list responses never expose the case's twist or the patient's hidden background. It returns a numbered findings list.
5. **Fix.** Send blocking findings back to the implementer. Run at most 3 fix rounds per task. If it is still red after that, mark it `partial` or `blocked` with the reason and move on. Never loop forever.
6. **Gate and commit.** You run the gates yourself, since sub-agent claims are not evidence. Commit with a conventional message (`feat(case-library): ...`) only when the gates pass. Update the ledger.
7. Repeat until no task is `todo` or `in-progress`. Then run `pnpm test:all` once on the final tree and write the final report.

## Definition of Done (per task)

- Failing test written first, then the code (TDD). Domain and use cases are covered by unit tests against in-memory fakes.
- `pnpm lint`, `pnpm test`, `pnpm test:arch` are green. Run `pnpm test:integration` and `pnpm test:e2e` when the task touches the DB or HTTP. Repository code gets integration tests and endpoints get e2e tests, including 401 without a token, 404 `case-not-found`, and Russian versus English output via `Accept-Language`. If Docker is unavailable, do not claim they passed (see Human-required).
- Layering follows `AGENTS.md`: plain-class use cases wired by `useFactory`, no ORM decorators in the domain, one schema per module, no cross-module foreign keys, migrations only, never auto-run. The module is registered in `src/app.module.ts` through its public API.
- Other modules reach this one only through `case-library.public-api.ts`.
- Errors are RFC 9457 `application/problem+json` through the single filter. The new problem type `case-not-found` has a stable code on the domain error and an entry in the filter table.
- JSON and query parameters are `snake_case`. Collections are wrapped in an object (`{ "items": [...] }`). Every endpoint has OpenAPI decorators in `presentation/` only.
- Any new env var is added to `.env.example` and validated at boot. No secret has a default value.

## Rules for every agent

- Never invent clinical content, case titles or patient backgrounds meant to look real. Placeholder content must be obviously fake (for example "Placeholder case 1") in both languages.
- Never touch real external services. Use Testcontainers and fakes.
- Never skip, `.skip`, delete or loosen a test or an architecture rule to get green. A red gate means fix the code, or record the task as `partial` or `blocked`.
- Never run `git push`, force-push, rewrite history, or edit `main` outside the commits you make here. Work on a branch `feat/case-library`.
- Stay in scope. Do not fix the "Known gaps" in `AGENTS.md` unless the task touches that code. Do not implement sessions, chat, feedback, or any client-writable completion endpoint.
- Report outcomes faithfully. If a command was not run, say so.

## Human-required items

Whenever a task needs something an agent cannot do or verify, append an entry to `docs/tasks/backend/case-library/HUMAN-REQUIRED.md` right away, in this format:

```
- [task NN] <what is needed> — why an agent can't do it — what is already prepared — exact next step for the human
```

Expect things like these (not exhaustive):

- The real case catalog: clinical content, EN and RU translations, level, category and avatar assignments, content notes, and clinical review and sign-off of that content.
- A decision on how real content is loaded in each environment, and who runs the seed.
- Open questions the specs list as "do not invent" (read each spec's Open questions section).
- Anything that needs Docker when Docker is not running, or a real device, browser or network.
- Wiring completion into the session-end operation, which belongs to the chat-simulation milestone.

For each of these, build everything around the gap so that the human only has to supply content or a decision.

## Final report (your last message)

Keep it short and structured:

1. **Done**: tasks complete and verified, with commit sha and the gate commands that passed.
2. **Partial**: what works, what is missing, and why.
3. **Blocked**: tasks that need a human, and what is prepared.
4. **Human-required checklist**: the full contents of `HUMAN-REQUIRED.md`, ordered by what unblocks the most work.
5. **Spec conflicts and assumptions**: each with the choice you made.
6. **Gates not run**: any gate you could not run, and why.

Start now with step 1.
