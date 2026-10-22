# 01 Auth provider and client integration

- **Milestone:** Sign-up & Log-in
- **Screens covered:** none directly (foundation for all seven screens)
- **Depends on:** none
- **Type:** BE + App

## Description
Sets up Firebase Auth for Praxis and the client-side auth layer in the Expo app: Firebase JS SDK (`firebase`) initialisation on iOS, Android and web, session persistence in encrypted storage, ID-token refresh, attaching the ID token to API calls, and the replacement of the mock `AuthService` internals. Every other feature in this milestone builds on it.

## Scope
**In scope:** Firebase project configuration (providers, authorized domains, email template language, custom action URL, data location), client initialisation, session storage and refresh, API client bearer attachment, auth-state observation, error-code normalisation shared by 02-05.
**Out of scope:** the sign-up/log-in/reset flows themselves (02-05), backend token verification (06), account deletion and change-password (account-settings milestone).

## APIs
None (consumes Firebase Auth; consumes 06 for bearer-protected calls).

## Functional requirements
- FR-1: The Firebase project shall be configured as follows: Email/Password provider enabled (email verification is not required to use the app; no sign-in gate on verification), Google and Apple providers enabled, anonymous sign-in disabled, the console setting "Link accounts that use the same email" selected (04 FR-9), the app's web origin on the authorized domains list, the password-reset and verify-email templates set to a custom action URL `<web origin>/auth-action` (05), and the email template language/sender configured. The minimum password length is enforced client-side (8, 02 FR-4) plus Firebase's own policy. ID tokens live 1 hour (fixed by Firebase), which satisfies the 60-minute revocation window.
- FR-2: The Firebase project shall use an EU data location (binding, GDPR).
- FR-3: The app shall use the Firebase JS SDK (`firebase`), initialised once in `src/services/firebase.ts`, with the `AuthService` contract implemented in `src/services/auth.ts`; screens shall keep importing only `auth` from that module. The module reads the Firebase web config (API key, auth domain, project id, app id) from environment-specific build configuration; these values are public identifiers and no service-account key or other secret exists in the client or its build configuration.
- FR-4: On iOS and Android, the client shall be initialised (`initializeAuth`) with a custom Firebase persistence that stores the session encrypted: the AES key is kept in secure storage (iOS Keychain / Android Keystore-backed, `expo-secure-store`), and the encrypted session blob lives in AsyncStorage because it exceeds the secure-store value limit (accepted MVP exception, limited to that encrypted blob). Access/ID and refresh tokens in plain text in AsyncStorage or any unencrypted file remain forbidden; the key is never stored outside secure storage.
- FR-5: On web, the client shall use Firebase's default browser persistence (`getAuth`); the OAuth popup (redirect fallback when the popup is blocked) is handled by the SDK (04). This is the documented exception to FR-4.
- FR-6: Firebase refreshes ID tokens on demand (`getIdToken`), so no foreground/background auto-refresh wiring is needed; the app shall run a single Firebase Auth instance so persistence is not raced.
- FR-7: The API client shall send `Authorization: Bearer <Firebase ID token>` on every request to the Praxis API, obtained from the current user (`getIdToken`), plus `X-Flow-ID` (a new random value per user action, reused across retries of it) and `Accept-Language` (`en` or `ru`).
- FR-8: When the API answers 401 `token-expired` or 401 `unauthenticated`, the API client shall force an ID token refresh (`getIdToken(true)`) and retry the request exactly once.
- FR-9: If the retry in FR-8 also returns 401, or Firebase reports a definitive session failure (`auth/user-token-expired`, `auth/user-disabled`, `auth/user-not-found`, `auth/invalid-user-token`), the app shall end the local session (sign out locally, clear the stored session and key, return to Welcome). A network failure shall never end the session.
- FR-10: The app shall expose an auth-state observable (`loading` | `signedIn` | `signedOut`) driven by Firebase `onAuthStateChanged` / `onIdTokenChanged` (surfaced by `subscribeAuthState` as `INITIAL_SESSION`, `SIGNED_IN`, `SIGNED_OUT`); it stays `loading` until the initial session has been restored or ruled out. The listener shall be registered immediately after the client is created.
- FR-11: The app shall expose `signOut()` that signs out of Firebase and clears all locally stored credentials; account-settings uses it for "Log out".
- FR-12: The app shall normalise Firebase Auth errors into `AuthError` codes via the table below; unmapped codes map to `unknown`.
- FR-13: The new keys `errors.tooManyRequests` and `errors.accountDisabled` shall be added to `en.json` and `ru.json` (copy: see external questions).
- FR-14: The app language (`en`/`ru`) shall be made available to the auth emails (see 05 FR-10), so that auth emails are sent in the language of the app at request time (via the Auth instance `languageCode`).
- FR-15: Email/password sign-in and the web OAuth flow shall work in Expo Go and web; the development build (EAS) is required only for native Google and Apple sign-in modules (04), with per-environment native configuration supplied through build configuration.
- FR-16: The auth module shall expose whether the signed-in user has a password sign-in method (`hasPasswordProvider`), derived from the user's `providerData` (an `password` provider), for use by account-settings (see 04 FR-13).

Error mapping (FR-12). Codes are Firebase Auth error codes (`error.code`), plus transport failures:

| Firebase error | `AuthErrorCode` | i18n key |
|---|---|---|
| `auth/email-already-in-use` | `email_taken` | `errors.emailTaken` |
| `auth/invalid-credential`, `auth/invalid-login-credentials`, `auth/wrong-password`, `auth/user-not-found`, `auth/invalid-email` | `invalid_credentials` | `errors.invalidCredentials` |
| `auth/expired-action-code`, `auth/invalid-action-code` (reset/verify link invalid, expired or already used) | `reset_link_invalid` | `errors.resetLinkInvalid` |
| User cancels Google/Apple native UI or closes the web popup (`auth/popup-closed-by-user`, `auth/cancelled-popup-request`, `auth/user-cancelled`, provider cancel codes) | `social_cancelled` | `errors.socialCancelled` |
| `auth/network-request-failed`, `auth/timeout`, fetch failure | `network` | `errors.network` |
| `auth/too-many-requests`, `auth/quota-exceeded`, HTTP 429 | `too_many_requests` (new) | `errors.tooManyRequests` (new) |
| `auth/user-disabled` | `account_disabled` (new) | `errors.accountDisabled` (new) |
| `auth/weak-password`, `auth/operation-not-allowed`, `auth/account-exists-with-different-credential` | `unknown` (client validation should catch weak passwords; the others indicate misconfiguration, e.g. account linking not enabled) | `errors.generic` |
| anything else | `unknown` | `errors.generic` |

## Non-functional requirements
- NFR-1: No ID token, refresh token, password or action code (`oobCode`) appears in logs, analytics, crash reports or user-visible URLs beyond the landing URL itself (the `/auth-action` URL is stripped from the address bar/history after reading).
- NFR-2: Cold-start restoration of a persisted session leaves `loading` in <= 1.5 s at p95 on a mid-range device, without awaiting a network call when the stored ID token is still valid.
- NFR-3: An API call made with an ID token that expired while the app was backgrounded succeeds transparently (FR-8) with no user-visible error.
- NFR-4: Separate Firebase projects exist for development and production at minimum (see external questions); production keys are not usable from a development build.
- NFR-5: Revocation: ID tokens are valid until expiry (1 hour, fixed by Firebase) and refresh tokens are revoked by Firebase on password reset or disabling; a disabled user or a user whose refresh tokens were revoked loses access when the ID token expires and the refresh fails, i.e. within the 60-minute window of 06 NFR-3.
- NFR-6: Expo SDK 58 compatibility: implementers must check the SDK 58 docs for the matching versions of `expo-secure-store` and the native Google/Apple modules.

## Acceptance criteria
- AC-1: Given a fresh install, When the app starts, Then the client initialises on iOS, Android and web without errors and the state resolves to `signedOut` (verifies FR-3, FR-10).
- AC-2: Given a signed-in iOS/Android user, When storage is inspected, Then the encryption key is in secure storage, the only session data in AsyncStorage is the encrypted blob, and no ID or refresh token appears in plain text in any storage or log (verifies FR-4, NFR-1).
- AC-3: Given a signed-in web user, When the page is reloaded, Then the user remains signed in (verifies FR-5).
- AC-4: Given an ID token that expired in the background, When the app makes an API call, Then a refreshed token is used and the call succeeds with no UI error (verifies FR-6, FR-8, NFR-3).
- AC-5: Given the API returns 401 twice for one action, When the app handles it, Then the session ends and Welcome is shown (verifies FR-8, FR-9).
- AC-6: Given the device is offline, When an API call or session refresh fails, Then the session is retained and `errors.network` is shown where an error is surfaced (verifies FR-9, FR-12).
- AC-7: Given each Firebase error in the FR-12 table, When it is thrown, Then `AuthError` has the stated code and `messageKey`, and both locale files contain the key (verifies FR-12, FR-13).
- AC-8: Given any API request, When inspected, Then it carries `Authorization`, `X-Flow-ID`, `Accept-Language` (verifies FR-7).
- AC-9: Given the user is disabled in the Firebase console, When the app next refreshes the ID token, Then the session ends, and a following sign-in attempt shows `errors.accountDisabled` (verifies FR-9, FR-12).
- AC-10: Given the Firebase console, When settings are reviewed, Then Email/Password, Google, Apple are enabled, anonymous sign-in is off, "Link accounts that use the same email" is selected, the web origin is an authorized domain, the email templates use the custom action URL `<web origin>/auth-action`, and the project data location is in the EU (verifies FR-1, FR-2).
- AC-11: Given the repository and build configuration, When searched, Then only the public Firebase web config exists client-side, in environment-specific config, and no service-account key (verifies FR-3).
- AC-12: Given the app language is `ru`, When an auth email is requested, Then the email is in Russian (verifies FR-14; mechanism per 05 FR-10).
- AC-13: Given a signed-in user, When `signOut()` is called, Then no session blob or key remains in AsyncStorage or secure storage and state is `signedOut` (verifies FR-11).
- AC-14: Given Expo Go, When email/password sign-in is used, Then it works; given a development build, Then native Google and Apple sign-in work (verifies FR-15).
- AC-15: Given a user with only Google/Apple identities, Then `hasPasswordProvider` is false; given a password user, true; given a Google user linked to a password identity, true (verifies FR-16).
- AC-16: Given two parallel API calls at ID token expiry, Then the app obtains a refreshed token without error and without signing the user out; given a single Auth instance, Then persistence is not raced (verifies FR-6).
- AC-17: Given a sign-in, sign-out and token refresh, Then the auth-state observable emits the matching states and the app state follows (verifies FR-10).

## App integration notes
Replaces `mockAuthService` in `src/services/auth.ts`; extend `AuthErrorCode` / `MESSAGE_KEYS` with `too_many_requests` and `account_disabled`. Replaces AsyncStorage persistence in `src/features/session/store.ts` (see 03). Screens must not import the Firebase client directly. `resetPassword` input changes from `{ token, newPassword }` to `{ oobCode, newPassword }` (05).

## Open questions
None beyond the external items under "Prerequisites and external questions".

## Prerequisites and external questions
(Prerequisites are not yet provided and must not be invented.)
- Firebase projects/environments (dev/production at minimum) and their owners, plan, and the EU data location selection (binding prerequisite).
- Console steps (values supplied by the owner): enable the Email/Password, Google and Apple providers; select "Link accounts that use the same email"; add authorized domains; set the email template language and the custom action URL (`<web origin>/auth-action`); email sender domain for auth emails; Apple and Google developer accounts (see 04).
- Final EN/RU copy for `errors.tooManyRequests` and `errors.accountDisabled`.
- Verify at implementation: that the Firebase client keeps the stored session on network failures during refresh (does not sign out), the exact error codes for refresh failures (`auth/user-token-expired`, `auth/invalid-user-token`), and the exact error shapes for transport failures.
- Verify at implementation: the custom encrypted persistence still matches the Firebase SDK's `Persistence` internals after SDK upgrades.
- Verify at implementation: Firebase's server-side password policy options on the chosen plan, if a stricter minimum than the client rule is wanted.
