# Shared conventions (apply to every feature)

Every feature spec under `docs/tasks/` MUST comply with this file. If a feature needs to deviate, it must say so explicitly and why.

## Decisions made by the product owner

| Topic | Decision |
|---|---|
| Auth provider | **Supabase Auth** (email/password, Google, Apple). Replaces the earlier Firebase decision (Firebase is no longer used anywhere). Works on iOS, Android and web. |
| API style | REST, following the **Zalando RESTful API Guidelines** (https://opensource.zalando.com/restful-api-guidelines/). |
| Chat replies | The AI patient's replies are **streamed** to the client. |
| Session persistence | A chat session is **not resumable** after an app restart; the learner starts over. |
| Case completion | A case is completed **when a session ends**, whether ended by the therapist or by the patient. Feedback is not required. |
| Restart | Restarting **discards** the previous session and starts a new one. |
| Transcript retention | Transcripts are stored server-side for **up to 90 days**, then deleted. |
| Compliance | GDPR and the EU AI Act are in scope (see below). |
| Account | Name editing and account deletion are in scope. |
| Language | Default is derived from the device locale: Russian -> `ru`, anything else -> `en`. Only `en` and `ru` are supported. |
| Case content | Read-only for now. No authoring/admin APIs. |
| Password reset | Uses the Supabase Auth recovery-email flow; must work on mobile (deep link) and web. |

### Decisions from the Sign-up & Log-in review (binding for all milestones)

| Topic | Decision |
|---|---|
| Email verification | **Not required** to use the app. Verification status is shown/encouraged in Account (a "verify your email" prompt); needs a design addition, flag it. |
| Consent | Sign-up requires explicit acceptance of Terms and Privacy Policy (single line with links, required). Needs a design addition, flag it. Acceptance (version + timestamp) is recorded on the profile. |
| Auth client SDK | `@supabase/supabase-js` on iOS, Android and web (no custom dev build needed for email/password; Google and Apple native sign-in need native modules, so a development build is still required for those). On native the session is stored encrypted with the key in secure storage (Keychain/Keystore); the encrypted blob may live in AsyncStorage (Supabase's Expo pattern, accepted for the MVP); tokens in plain text in AsyncStorage are forbidden. |
| Apple sign-in | Hidden on Android; available on iOS and web. |
| Account linking | One account per email. A social sign-in with an email that already has a password account links to it. |
| Reset link | Lifetime is whatever the Supabase recovery link supports (configurable); the screen copy states the configured value, never a hard-coded one. The reset flow uses the Supabase recovery token (deep link on mobile, URL on web). |
| Session revocation | Up to 60 minutes' delay is acceptable for revoked/disabled users; the device that completed a password reset is signed out immediately. |
| Language on profile | `Me.language` (`en` \| `ru`, optional) is stored on the profile and synced across devices; falls back to device locale when unset. The AI patient speaks the session language, fixed at session start. |
| Social-only accounts | Change password is hidden for users with no password provider. |
| Account deletion | Deletes all user data, including transcripts and feedback, and revokes the Apple token for Apple users. |
| Technical defaults | Problem `type` URIs are relative (`/problems/<kebab-name>`); `Me.id` is the Supabase user id; password complexity is enforced client-side (and by the provider's minimum policy); rate limits as proposed in `signup-login/06`. |
| Shared API artefacts | Reuse the problem types, `Me` shape, `X-Flow-ID` rules and the client 401-refresh-retry rule defined in `docs/tasks/signup-login/06-authenticated-api-foundation.md` and `01-auth-provider-and-client-integration.md`. Do not redefine them. |
| Prerequisites (not yet provided) | Supabase projects/environments, owners, plan and **EU region selection** (required: GDPR), reset-link and email-sender domains (custom SMTP), Apple/Google developer accounts, EN/RU reset email copy. Specs list them as prerequisites, never invent them. |

## API rules (Zalando-derived; the spec author must apply them)

- Resource-oriented URLs, `kebab-case` path segments, plural nouns, no verbs (use sub-resources/state changes where needed).
- JSON properties in `snake_case`; enums in `UPPER_SNAKE_CASE`; timestamps in RFC 3339 UTC (`..._at`); IDs are opaque strings.
- Standard HTTP methods and status codes. Errors use `application/problem+json` (RFC 9457) with a stable machine-readable `type` for each error; clients map `type` to i18n keys, so the API never returns user-facing text.
- Collections: cursor-based pagination, with `items` in the response and `next` / `prev` links. Filtering via query parameters.
- Idempotency: `PUT`/`DELETE` idempotent; `POST` that creates something must support an `Idempotency-Key` header.
- Versioning: no URL versioning; use media-type versioning only if a breaking change is unavoidable. Compatible evolution is the default.
- Authentication: `Authorization: Bearer <Supabase access token (JWT)>`; the API verifies the token against the auth provider's published signing keys. Every endpoint except documented public ones requires it. Use `X-Flow-ID` for request tracing.
- Each feature that defines endpoints lists them as `METHOD /path`, with request/response fields, status codes and error types. It must NOT specify storage, queries or other backend internals.
- Streaming endpoints use Server-Sent Events (`text/event-stream`) and must document event names, payloads, termination and error events.
- Localization: the client sends `Accept-Language` (`en` or `ru`). Content that is localized (e.g. cases) is returned in that language.

## Non-functional baseline

- Performance: p95 latency for non-streaming endpoints <= 500 ms (excluding third-party calls); streaming time-to-first-event target is stated per feature.
- Security: no secrets in the client, tokens only in secure storage, rate limiting on auth-adjacent endpoints, no account enumeration.
- Accessibility and i18n: all user-facing strings come from the `en.json` / `ru.json` i18n files; new error types need keys in both.
- Observability: structured logs with the flow ID; never log passwords, tokens or transcript content.

## Privacy and compliance

- GDPR: lawful basis, data minimisation, 90-day transcript retention, right to erasure (account deletion removes all user data, including transcripts), data export is out of scope unless a feature says otherwise.
- EU AI Act: the app must disclose that the patient is an AI-simulated character (transparency). The patient is a simulation, not a real person; never present AI output as clinical advice.
- Content is sensitive (suicidal ideation, harm to others, trauma). Transcripts are never used for model training without separate consent (out of scope).

## Repo context for implementers

- App: Expo SDK 58 / React Native, Expo Router in `src/app/`, i18n in `src/i18n/`. Check docs for the matching Expo version before touching Expo APIs.
- The app currently uses mocks behind service seams: `src/services/auth.ts`, `src/features/cases/service.ts`, `src/features/chat/` (`ChatBackend`), `src/features/feedback/service.ts`, `src/features/session/store.ts`. Real implementations replace the mocks without changing screen code where possible.
- Screen designs are in `docs/screens/*.png`.
