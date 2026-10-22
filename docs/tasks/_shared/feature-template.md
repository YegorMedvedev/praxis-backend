# <NN> <Feature name>

- **Milestone:** <milestone>
- **Screens covered:** <list, matching docs/screens/*.png>
- **Depends on:** <feature files, or "none">
- **Type:** BE | App | BE + App

## Description
2-4 sentences: what this feature builds and why, written for an AI agent with no other context.

## Scope
**In scope:** ...
**Out of scope:** ...

## APIs
For each endpoint: `METHOD /path`, auth requirement, request fields, response fields, status codes, problem types.
Write "None" if the feature has no API surface.

## Functional requirements
Numbered `FR-1`, `FR-2`, ... Each is a single, testable statement ("The system shall ...").

## Non-functional requirements
Numbered `NFR-1`, ... Performance, security, privacy, accessibility, i18n, reliability, observability, with measurable targets where possible.

## Acceptance criteria
Numbered `AC-1`, ... in Given / When / Then form. Each AC references the FR/NFR it verifies (e.g. "verifies FR-2").
Cover the happy path, each error state in the screen designs, and offline/edge cases.

## App integration notes
Which mock/service seam is replaced, and what must not change in screen code. Omit for BE-only features.

## Open questions
Anything the author could not resolve from the code, designs or `conventions.md`. Do not guess; list it here.
