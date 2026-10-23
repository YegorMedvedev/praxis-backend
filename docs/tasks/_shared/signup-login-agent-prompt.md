# Prompt: build the Sign-up & Log-in backend with a sub-agent loop

Paste everything below the line into a fresh Claude Code session at the repo root.

---

You are the **orchestrator** for building the Sign-up & Log-in backend of Praxis. Build as much as can be built and verified without a human. Anything that needs a human is not a blocker: record it, work around it, and report it at the end.

## Inputs (read first, in this order)

1. `AGENTS.md`: architecture rules, enforced by `pnpm test:arch`. Non-negotiable.
2. `docs/tasks/_shared/conventions.md`: binding product decisions and API rules.
3. `docs/tasks/backend/signup-login/*.md`: the task specs. Find them with `ls`; do not assume the list.
4. The current code under `src/` and `test/`, to see what already exists.

**Resolved decisions (do not log as conflicts):** reset emails are sent by **Resend** (backend generates the Firebase reset link and mails it; `AGENTS.md` and `conventions.md` agree, and task 05 carries an amendment note). All task specs live under `docs/tasks/backend/`.

If a spec contradicts `AGENTS.md` or the conventions, or two specs contradict each other, do not pick silently. Take the most conservative reading, continue, and log it under **Spec conflicts**.

## Loop

Keep a ledger at `docs/tasks/backend/signup-login/PROGRESS.md` with one row per task: `status` (todo / in-progress / done / partial / blocked), commit sha, and notes. Create it in step 1 and update it after every iteration.

1. **Plan.** Read all task specs and build a dependency order from each spec's `Depends on:` line. Mark tasks that are fully human-only (for example, creating a Firebase project) as `blocked` from the start. Still build the code side of them (config, env validation, ports, fakes).
2. **Pick** the next task whose dependencies are `done` or `partial`. Tasks with no dependency between them may run in parallel, but only in separate worktrees (`isolation: "worktree"`), merged one at a time by you.
3. **Dispatch an implementer sub-agent** with a self-contained brief: the task file path, the `AGENTS.md` rules, the ledger, and the Definition of Done below. Sub-agents do not see this conversation, so put everything they need in the brief.
4. **Dispatch a separate reviewer sub-agent** (fresh context) on the diff. It checks four things: spec compliance (every endpoint, status code and problem type), `AGENTS.md` rules, test quality, and privacy (no tokens, emails or PII in logs or error bodies). It returns a numbered findings list.
5. **Fix.** Send blocking findings back to the implementer. Run at most 3 fix rounds per task. If it is still red after that, mark it `partial` or `blocked` with the reason and move on. Never loop forever.
6. **Gate and commit.** You run the gates yourself, since sub-agent claims are not evidence. Commit with a conventional message (`feat(auth): ...`) only when the gates pass. Update the ledger.
7. Repeat until no task is `todo` or `in-progress`. Then run `pnpm test:all` once on the final tree and write the final report.

## Definition of Done (per task)

- Failing test written first, then the code (TDD). Domain and use cases are covered by unit tests against in-memory fakes.
- `pnpm lint`, `pnpm test`, `pnpm test:arch` are green. Run `pnpm test:integration` and `pnpm test:e2e` when the task touches the DB or HTTP. If Docker is unavailable, do not claim they passed (see Human-required).
- Layering follows `AGENTS.md`: plain-class use cases wired by `useFactory`, no ORM decorators in the domain, one schema per module, no cross-module foreign keys, migrations only, never auto-run.
- Errors are RFC 9457 `application/problem+json` through the single filter. Any new problem type has a stable code on the domain error and an entry in the filter table.
- JSON and query parameters are `snake_case`. Every endpoint has OpenAPI decorators in `presentation/` only.
- New env vars are added to `.env.example` and validated at boot. No secret has a default value.

## Rules for every agent

- Never invent credentials, project ids, domains, sender addresses or email copy. Use clearly fake placeholders in tests and `.env.example`, and log a Human-required item.
- Never touch real Firebase, Resend or other external services. Use the Firebase Auth emulator and Testcontainers for tests, and fakes for ports.
- Never skip, `.skip`, delete or loosen a test or an architecture rule to get green. A red gate means fix the code, or record the task as `partial` or `blocked`.
- Never run `git push`, force-push, rewrite history, or edit `main` outside the commits you make here. Work on a branch `feat/signup-login`.
- Stay in scope. Do not fix the "Known gaps" in `AGENTS.md` unless the task touches that code.
- Report outcomes faithfully. If a command was not run, say so.

## Human-required items

Whenever a task needs something an agent cannot do or verify, append an entry to `docs/tasks/backend/signup-login/HUMAN-REQUIRED.md` right away, in this format:

```
- [task NN] <what is needed> — why an agent can't do it — what is already prepared — exact next step for the human
```

Expect things like these (not exhaustive):

- Creating Firebase projects and environments, choosing the EU data location, enabling providers (email/password, Google, Apple), and the "link accounts with the same email" setting.
- Service-account credentials and secret values (`FIREBASE_CREDENTIALS_JSON`, `RESEND_API_KEY`), and the Resend account and sender-domain verification.
- Domain, sender and DNS verification, and the custom action URL (`<web origin>/auth-action`).
- Apple and Google developer accounts, and Apple token revocation setup.
- EN/RU email template copy, and Terms/Privacy versions.
- Anything that needs Docker when Docker is not running, or a real device, browser or network.
- Product or legal decisions the specs leave open.

For each of these, build everything around the gap (config, validation, ports, fakes, tests) so that the human only has to supply a value.

## Final report (your last message)

Keep it short and structured:

1. **Done**: tasks complete and verified, with commit sha and the gate commands that passed.
2. **Partial**: what works, what is missing, and why.
3. **Blocked**: tasks that need a human, and what is prepared.
4. **Human-required checklist**: the full contents of `HUMAN-REQUIRED.md`, ordered by what unblocks the most work.
5. **Spec conflicts and assumptions**: each with the choice you made.
6. **Gates not run**: any gate you could not run, and why.

Start now with step 1.
