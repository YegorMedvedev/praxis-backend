# Prompt: build the Chat Simulation backend with a sub-agent loop

Paste everything below the line into a fresh Claude Code session at the repo root.

---

You are the **orchestrator** for building the Chat Simulation backend of Praxis (sessions, therapist messages, streamed AI-patient replies, transcript retention). Build as much as can be built and verified without a human. Anything that needs a human is not a blocker: record it, work around it, and report it at the end.

## Inputs (read first, in this order)

1. `AGENTS.md`: architecture rules, enforced by `pnpm test:arch`. Non-negotiable. Note the global `/api/v1` prefix: the specs write `/sessions`, the real route is `/api/v1/sessions`.
2. `docs/tasks/_shared/conventions.md`: binding product decisions and API rules. Read the row "Chat simulation: OpenAI Agents API" twice.
3. `docs/tasks/backend/chat-simulation/*.md`: the task specs (01, 02, 05, 06, 07) plus `PROGRESS.md` and `HUMAN-REQUIRED.md`. Find them with `ls`; do not assume the list. Specs 03 and 04 of the milestone are app-side: ignore them.
4. The existing code under `src/` and `test/`, especially `src/platform/*`, `src/modules/auth`, `users` and `case-library` (read `case-library.public-api.ts` and `RecordCaseCompletion`). Reuse bearer auth, the problem-details filter, `X-Flow-ID`, rate limiting, the in-process background runner pattern and the config validation. Do not rebuild them. If something a spec assumes is missing from the code, log it under **Spec conflicts** and add the smallest change that fits the existing design.
5. OpenAI's Agents API docs (listed in spec 07) and the type definitions of the installed `openai` package, before writing the adapter.

**Resolved decisions (do not log as conflicts):**

- New module `chat-simulation`, built as "How to add a module" in `AGENTS.md` describes. Its PostgreSQL schema is `chat_simulation`, with no foreign keys to other schemas (user ids and case ids are plain columns).
- The virtual patient is an **OpenAI Agents API** agent with instructions only and **no tools**. One agent per (case, language), mapped in case-library seed data (spec 06). The OpenAI code lives only in `chat-simulation/infrastructure/`, behind the `PatientReplyGenerator` port; every automated test uses the in-memory fake or a fake of the small OpenAI client interface. **Never call the real OpenAI API**, never read or ask for a real key, and never run `pnpm test:agents`.
- The **patient cannot end a session** in this milestone. Implement nothing for `ENDED_BY_PATIENT` triggering, closing messages or the `session.ended` event; keep the enum value and the event name in the documented contract (specs 01 and 02 mark the deferred items).
- Accepted deviations from spec 05 (OpenAI retains session state, US-only residency, asynchronous remote deletion): do not block on them and do not re-raise them; list them in the final report as "accepted".
- Our database is the source of truth for transcripts. The remote OpenAI session is a cache. Follow spec 07's `remote_in_sync` rules exactly.
- Completion: call `RecordCaseCompletion` from `case-library.public-api.ts` through a port declared in chat-simulation's `domain/` and adapted in `infrastructure/`, inside the same database transaction as the session end (spec 01 NFR-2). If the two modules cannot share a transaction under the architecture rules, make completion marking and the session state change atomic in the way the existing `RecordCaseCompletion` allows (for example a transactional unit-of-work port with an adapter that passes the active transaction through), or log it as a spec conflict with the most conservative option chosen; do not leave a window where a 200 exists for an ended session whose case is not completed.
- Session lifetime: abandoned sessions are removed when a new session is created for the same case, or by the 90-day retention (spec 05). No inactivity expiry.
- Background work (cleanup worker, retention job) follows the existing in-process runner pattern, is idempotent, safe to run twice, and is not started in unit tests.
- Single instance: single-flight generation (spec 02 FR-12) may be an in-process registry. Document the limit in `AGENTS.md`.

If a spec contradicts `AGENTS.md` or the conventions, or two specs contradict each other, do not pick silently. Take the most conservative reading, continue, and log it under **Spec conflicts**.

## Loop

Keep the ledger at `docs/tasks/backend/chat-simulation/PROGRESS.md` (it exists): one row per task with `status` (todo / in-progress / done / partial / blocked), commit sha, and notes. Update it after every iteration.

1. **Plan.** Order is fixed by the ledger: 06, 01, 02, 07, 05. Check each spec's `Depends on:` line and mark a task `blocked` only if nothing at all can be built for it.
2. **Pick** the next task whose dependencies are `done` or `partial`. Run tasks serially unless they are truly independent, and then only in separate worktrees (`isolation: "worktree"`), merged one at a time by you.
3. **Dispatch an implementer sub-agent** with a self-contained brief: the task file path, the `AGENTS.md` rules, the ledger, the resolved decisions above, and the Definition of Done below. Sub-agents do not see this conversation, so put everything they need in the brief.
4. **Dispatch a separate reviewer sub-agent** (fresh context) on the diff. It checks:
   - spec compliance (every endpoint, field, header, status code, event, problem type, `Cache-Control: no-store`, SSE headers);
   - `AGENTS.md` rules;
   - test quality (failure injection, cancellation, concurrency);
   - privacy: no message text, prompts, provider error messages, agent ids, `openai_session_id`s or secrets in logs, error bodies or any response; a user can never see another user's session (404, never 403); `Session` and `Message` bodies expose only the documented fields.
   It returns a numbered findings list.
5. **Fix.** Send blocking findings back to the implementer. Run at most 3 fix rounds per task. If it is still red after that, mark it `partial` or `blocked` with the reason and move on. Never loop forever.
6. **Gate and commit.** You run the gates yourself, since sub-agent claims are not evidence. Commit with a conventional message (`feat(chat-simulation): ...`, `feat(case-library): ...` for task 06) only when the gates pass. Update the ledger.
7. Repeat until no task is `todo` or `in-progress`. Then run `pnpm test:all` once on the final tree and write the final report.

## Definition of Done (per task)

- Failing test written first, then the code (TDD). Domain and use cases are covered by unit tests against in-memory fakes, including a fake `PatientReplyGenerator` with scripted success, failure, stall and abort behaviour.
- `pnpm lint`, `pnpm test`, `pnpm test:arch` are green. Run `pnpm test:integration` and `pnpm test:e2e` when the task touches the DB or HTTP. Repositories get integration tests; endpoints get e2e tests including 401 without a token, `session-not-found` for foreign ids, SSE framing (event names, single-line JSON `data:`, `: keep-alive`, termination), and the problem types of the spec. E2E binds the fake generator and a fake OpenAI remover; it never has a real key. If Docker is unavailable, do not claim these passed (see Human-required).
- Layering follows `AGENTS.md`: plain-class use cases wired by `useFactory`, no ORM decorators in the domain, one schema per module, no cross-module foreign keys, migrations only, never auto-run. The module is registered in `src/app.module.ts` through its public API. Other modules reach chat-simulation only through `chat-simulation.public-api.ts` (export only what a consumer needs; probably nothing yet).
- `openai` is imported only under `chat-simulation/infrastructure/`; add a dependency-cruiser rule for it and make sure `pnpm test:arch` fails if it is violated.
- Errors are RFC 9457 `application/problem+json` through the single filter. New problem types (`session-not-found`, `session-ended`, `reply-pending`, `no-reply-pending`, `reply-generation-failed`, `case-not-found` reuse) get stable codes on domain errors and entries in the filter table. SSE `error` events carry the same problem object. Never leak stack traces, SQL, provider messages or ids of other systems.
- JSON and query parameters are `snake_case`; enums `UPPER_SNAKE_CASE`; timestamps RFC 3339 UTC. Collections are wrapped in an object. Every endpoint has OpenAPI decorators in `presentation/` only, including the SSE endpoint's event documentation.
- Any new env var is added to `.env.example`, to the test environments (dummy values), and validated at boot. No secret has a default value.
- Logs contain ids, counts, durations and status codes only. Add the marker-string log scan test the specs ask for.

## Rules for every agent

- Never invent clinical content, prompts meant to look final, agent ids, API keys or contract facts. Placeholder text must be clearly marked and listed in `HUMAN-REQUIRED.md`.
- Never touch real external services (OpenAI, Resend, Firebase production). Use Testcontainers and fakes.
- Never skip, `.skip`, delete or loosen a test or an architecture rule to get green. A red gate means fix the code, or record the task as `partial` or `blocked`.
- Never run `git push`, force-push, rewrite history, or edit `main` outside the commits you make here. Work on a branch `feat/chat-simulation`.
- Stay in scope. Do not fix the "Known gaps" in `AGENTS.md` unless the task touches that code. Do not implement session feedback, the app, a patient-initiated end, tools for the agent, transcript export or learner-content moderation.
- Report outcomes faithfully. If a command was not run, say so.

## Human-required items

`HUMAN-REQUIRED.md` already lists the items known before the build. Whenever a task needs something an agent cannot do or verify, append an entry right away, in this format:

```
- [task NN] <what is needed> — why an agent can't do it — what is already prepared — exact next step for the human
```

For every gap, build everything around it so that the human only has to supply content, a key or a decision.

## Final report (your last message)

Keep it short and structured:

1. **Done**: tasks complete and verified, with commit sha and the gate commands that passed.
2. **Partial**: what works, what is missing, and why.
3. **Blocked**: tasks that need a human, and what is prepared.
4. **Human-required checklist**: the full contents of `HUMAN-REQUIRED.md`, ordered by what unblocks the most work (agent ids and the OpenAI key first).
5. **Accepted deviations and deferred items**: from spec 05, and the patient-initiated end.
6. **Spec conflicts and assumptions**: each with the choice you made, including which of `agent` / `agent_id` the installed SDK accepted.
7. **Gates not run**: any gate you could not run, and why.

Start now with step 1.
