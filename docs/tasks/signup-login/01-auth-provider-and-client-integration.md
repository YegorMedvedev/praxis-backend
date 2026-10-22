# 01 Auth provider and client integration

- **Milestone:** Sign-up & Log-in
- **Screens covered:** none directly (foundation for all seven screens)
- **Depends on:** none
- **Type:** BE + App

## Description
Sets up Supabase Auth for Praxis and the client-side auth layer in the Expo app: `@supabase/supabase-js` initialisation on iOS, Android and web, session persistence in secure storage, access-token refresh, attaching the access token to API calls, and the replacement of the mock `AuthService` internals. Every other feature in this milestone builds on it. History note: this replaces an earlier Firebase decision; Firebase is no longer used anywhere.

## Scope
**In scope:** Supabase project configuration (providers, email settings, signing keys, token lifetime, redirect URLs, region), client initialisation, session storage and refresh, API client bearer attachment, auth-state observation, error-code normalisation shared by 02-05.
**Out of scope:** the sign-up/log-in/reset flows themselves (02-05), backend token verification (06), account deletion and change-password (account-settings milestone).

## APIs
None (consumes Supabase Auth; consumes 06 for bearer-protected calls).

## Functional requirements
- FR-1: The Supabase project shall be configured as follows: Email provider enabled with "Confirm email" disabled (decided: verification is not required to use the app; required project setting), minimum password length 8, Google and Apple providers enabled, anonymous sign-ins disabled, automatic linking of identities with the same email left at the Supabase behaviour (04 FR-9), asymmetric JWT signing keys in use (06 FR-1), access-token lifetime set to no more than 60 minutes (default 1 hour), custom SMTP configured for auth emails, and the app's redirect URLs (web origin and mobile deep-link/universal-link URLs) on the redirect allow list.
- FR-2: The project shall be created in an EU region (binding, GDPR).
- FR-3: The app shall use `@supabase/supabase-js`, created once in one shared module that implements the `AuthService` contract in `src/services/auth.ts`; screens shall keep importing only `auth` from that module. The module reads the Supabase project URL and the publishable (anon) key from environment-specific build configuration; no service-role key or other secret exists in the client or its build configuration.
- FR-4: On iOS and Android, the client shall be configured with a custom storage adapter that persists the session (access and refresh token) following Supabase's recommended Expo pattern: the session is stored encrypted, the encryption key is kept in secure storage (iOS Keychain / Android Keystore-backed, e.g. `expo-secure-store`), and the encrypted session blob may live in AsyncStorage because it exceeds the secure-store value limit (accepted MVP exception, limited to that encrypted blob). Access and refresh tokens in plain text in AsyncStorage or any unencrypted file remain forbidden; the key is never stored outside secure storage. The client is also configured with `persistSession` and `autoRefreshToken` enabled and URL session detection disabled.
- FR-5: On web, the client shall use the library's default browser persistence with `autoRefreshToken` enabled and URL session detection enabled (needed for the OAuth redirect, 04); this is the documented exception to FR-4.
- FR-6: On iOS and Android the app shall start auto-refresh when the app is foregrounded and stop it when backgrounded (Supabase React Native guidance, verify at implementation), and shall run a single client instance so refresh-token rotation is not raced.
- FR-7: The API client shall send `Authorization: Bearer <access token>` on every request to the Praxis API, obtained from the current Supabase session, plus `X-Flow-ID` (a new random value per user action, reused across retries of it) and `Accept-Language` (`en` or `ru`).
- FR-8: When the API answers 401 `token-expired` or 401 `unauthenticated`, the API client shall force a session refresh and retry the request exactly once.
- FR-9: If the retry in FR-8 also returns 401, or the Supabase client reports a definitive session failure (refresh token invalid, already used, or not found; session expired; user banned; user not found), the app shall end the local session (sign out locally, clear the stored session and key, return to Welcome). A network failure shall never end the session.
- FR-10: The app shall expose an auth-state observable (`loading` | `signedIn` | `signedOut`) driven by the Supabase auth-state events (`INITIAL_SESSION`, `SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`, `USER_UPDATED`, `PASSWORD_RECOVERY`); it stays `loading` until the initial session has been restored or ruled out. The listener shall be registered immediately after the client is created.
- FR-11: The app shall expose `signOut()` that signs out of Supabase (local scope) and clears all locally stored credentials; account-settings uses it for "Log out".
- FR-12: The app shall normalise Supabase Auth errors into `AuthError` codes via the table below; unmapped codes map to `unknown`.
- FR-13: The new keys `errors.tooManyRequests` and `errors.accountDisabled` shall be added to `en.json` and `ru.json` (copy: see external questions).
- FR-14: The app language (`en`/`ru`) shall be made available to the auth emails (see 05 FR-10), so that auth emails are sent in the language of the app at request time.
- FR-15: Email/password sign-in and the web OAuth flow shall work in Expo Go and web; the development build (EAS) is required only for native Google and Apple sign-in modules (04), with per-environment native configuration supplied through build configuration.
- FR-16: The auth module shall expose whether the signed-in user has a password sign-in method (`hasPasswordProvider`), derived from the user's identities (an `email` identity), for use by account-settings (see 04 FR-13).

Error mapping (FR-12). Codes are Supabase Auth error codes (`error.code`), plus transport failures:

| Supabase error | `AuthErrorCode` | i18n key |
|---|---|---|
| `user_already_exists`, `email_exists` | `email_taken` | `errors.emailTaken` |
| `invalid_credentials` | `invalid_credentials` | `errors.invalidCredentials` |
| `otp_expired`, `flow_state_expired` (recovery token invalid, expired or already used) | `reset_link_invalid` | `errors.resetLinkInvalid` |
| User cancels Google/Apple native UI or denies the web OAuth consent (provider cancel codes, OAuth `access_denied`) | `social_cancelled` | `errors.socialCancelled` |
| Fetch failure, `AuthRetryableFetchError`, timeout | `network` | `errors.network` |
| `over_request_rate_limit`, `over_email_send_rate_limit`, HTTP 429 | `too_many_requests` (new) | `errors.tooManyRequests` (new) |
| `user_banned` | `account_disabled` (new) | `errors.accountDisabled` (new) |
| `weak_password`, `same_password`, `validation_failed`, `email_not_confirmed`, `provider_email_needs_verification` | `unknown` (client validation should catch the first three; the last two indicate misconfiguration) | `errors.generic` |
| anything else | `unknown` | `errors.generic` |

## Non-functional requirements
- NFR-1: No access token, refresh token, password or recovery token (`token_hash`) appears in logs, analytics, crash reports or user-visible URLs.
- NFR-2: Cold-start restoration of a persisted session leaves `loading` in <= 1.5 s at p95 on a mid-range device, without awaiting a network call when the stored access token is still valid.
- NFR-3: An API call made with an access token that expired while the app was backgrounded succeeds transparently (FR-8) with no user-visible error.
- NFR-4: Separate Supabase projects exist for development and production at minimum (see external questions); production keys are not usable from a development build.
- NFR-5: Revocation: access tokens are valid until expiry (configured <= 60 minutes, FR-1) and refresh tokens are single-use with rotation; a banned user or a signed-out-everywhere user loses access when the access token expires and the refresh fails, i.e. within the 60-minute window of 06 NFR-3.
- NFR-6: Expo SDK 58 compatibility: implementers must check the SDK 58 docs for the matching versions of `expo-secure-store` and the native Google/Apple modules.

## Acceptance criteria
- AC-1: Given a fresh install, When the app starts, Then the client initialises on iOS, Android and web without errors and the state resolves to `signedOut` (verifies FR-3, FR-10).
- AC-2: Given a signed-in iOS/Android user, When storage is inspected, Then the encryption key is in secure storage, the only session data in AsyncStorage is the encrypted blob, and no access or refresh token appears in plain text in any storage or log (verifies FR-4, NFR-1).
- AC-3: Given a signed-in web user, When the page is reloaded, Then the user remains signed in (verifies FR-5).
- AC-4: Given an access token that expired in the background, When the app makes an API call, Then a refreshed token is used and the call succeeds with no UI error (verifies FR-6, FR-8, NFR-3).
- AC-5: Given the API returns 401 twice for one action, When the app handles it, Then the session ends and Welcome is shown (verifies FR-8, FR-9).
- AC-6: Given the device is offline, When an API call or session refresh fails, Then the session is retained and `errors.network` is shown where an error is surfaced (verifies FR-9, FR-12).
- AC-7: Given each Supabase error in the FR-12 table, When it is thrown, Then `AuthError` has the stated code and `messageKey`, and both locale files contain the key (verifies FR-12, FR-13).
- AC-8: Given any API request, When inspected, Then it carries `Authorization`, `X-Flow-ID`, `Accept-Language` (verifies FR-7).
- AC-9: Given the user is banned in Supabase, When the app next refreshes the session, Then the session ends, and a following sign-in attempt shows `errors.accountDisabled` (verifies FR-9, FR-12).
- AC-10: Given the Supabase dashboard, When settings are reviewed, Then Email (Confirm email off, min password length 8), Google, Apple are enabled, anonymous sign-ins are off, asymmetric signing keys are active, access-token lifetime is <= 60 minutes, custom SMTP is set, redirect URLs are listed, and the project region is in the EU (verifies FR-1, FR-2).
- AC-11: Given the repository and build configuration, When searched, Then only the project URL and publishable key exist client-side, in environment-specific config, and no service-role key (verifies FR-3).
- AC-12: Given the app language is `ru`, When an auth email is requested, Then the email is in Russian (verifies FR-14; mechanism per 05 FR-10).
- AC-13: Given a signed-in user, When `signOut()` is called, Then no session blob or key remains in AsyncStorage or secure storage and state is `signedOut` (verifies FR-11).
- AC-14: Given Expo Go, When email/password sign-in is used, Then it works; given a development build, Then native Google and Apple sign-in work (verifies FR-15).
- AC-15: Given a user with only Google/Apple identities, Then `hasPasswordProvider` is false; given a password user, true; given a Google user linked to a password identity, true (verifies FR-16).
- AC-16: Given the app is backgrounded and foregrounded on iOS/Android, Then auto-refresh stops and restarts and no refresh runs while backgrounded; given two parallel API calls at expiry, Then exactly one refresh request is sent (verifies FR-6).
- AC-17: Given a sign-in, sign-out and token refresh, Then the auth-state observable emits the matching states and the app state follows (verifies FR-10).

## App integration notes
Replaces `mockAuthService` in `src/services/auth.ts`; extend `AuthErrorCode` / `MESSAGE_KEYS` with `too_many_requests` and `account_disabled`. Replaces AsyncStorage persistence in `src/features/session/store.ts` (see 03). Screens must not import the Supabase client directly. `resetPassword` input changes from `{ token, newPassword }` to `{ tokenHash, newPassword }` (05).

## Open questions
None beyond the external items under "Prerequisites and external questions".

## Prerequisites and external questions
(Prerequisites are not yet provided and must not be invented.)
- Supabase projects/environments (dev/production at minimum) and their owners, plan, and the EU region selection (binding prerequisite).
- Custom SMTP provider and sender domain for auth emails; Apple and Google developer accounts (see 04).
- Final EN/RU copy for `errors.tooManyRequests` and `errors.accountDisabled`.
- Verify at implementation: that the Supabase client keeps the stored session on network failures during refresh (does not sign out), exact error codes for refresh failures (`refresh_token_not_found`, `refresh_token_already_used`, `session_not_found`, `session_expired`), and the exact `AuthError` shapes for transport failures.
- Verify at implementation: auto-refresh and AppState handling and the `detectSessionInUrl` settings per current Supabase React Native guidance.
- Verify at implementation: that the Supabase Auth setting for minimum password length is available on the chosen plan.
