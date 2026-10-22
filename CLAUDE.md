# CLAUDE.md

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
