# 03 Email/password log-in and session persistence

- **Milestone:** Sign-up & Log-in
- **Screens covered:** `welcome.png`, `log_in.png`
- **Depends on:** 01, 06
- **Type:** BE + App

## Description
Returning users log in with email and password; the app restores the session at cold start without asking again; route guards send signed-out users to Welcome and signed-in users to the Library. This feature replaces the AsyncStorage-persisted mock in `src/features/session/store.ts` with a session derived from the Supabase auth state plus `GET /me`. It also covers the Welcome screen.

## Scope
**In scope:** Welcome screen behaviour, log-in form, session restore, bootstrap via `GET /me`, profile repair, route guarding, offline behaviour.
**Out of scope:** sign-up (02), social (04), forgot password (05), log out UI and change password (account-settings milestone; they call `signOut()` from 01).

## APIs
Uses `GET /me` (06) after every sign-in and every cold start with a persisted user; `PUT /me` for repair (FR-8). Problem types handled: `profile-not-found`, `account-disabled`, `unauthenticated`, `token-expired`, `rate-limited`, `service-unavailable`, `internal-error`.

## Functional requirements
- FR-1: The Welcome screen shall show the logo, the EN/RU language switcher, illustration, title, subtitle, a primary "Create account" button (opens Sign up) and a secondary "Log in" button (opens Log in); it is shown only to signed-out users.
- FR-2: The Log in screen shall show Email and Password fields, show/hide password toggle, a "Forgot password?" link (opens 05), a "Log in" button, Google and Apple buttons (04), a back button, and a footer link "Create an account" that replaces the screen with Sign up.
- FR-3: The system shall validate Email as in 02 FR-3 and Password only for presence (`validation.passwordRequired`); no password-rule hints are shown on log-in. Error timing, focus and busy-lock behaviour are as in 02 FR-5 and FR-7.
- FR-4: On valid submit the app shall sign in with Supabase Auth (`signInWithPassword`) using the trimmed email and untouched password, then call `GET /me`; on 200 it shall enter the signed-in state and replace the route with the Library.
- FR-5: A wrong password, unknown email or malformed credential shall show `errors.invalidCredentials` as the form notice with identical wording and timing characteristics, so existence of the account is not revealed; offline shows `errors.network`; `over_request_rate_limit` / `over_email_send_rate_limit` / 429 shows `errors.tooManyRequests`; a disabled account shows `errors.accountDisabled`; anything else `errors.generic`. The password field value is kept; the notice clears on edit.
- FR-6: The app shall not enter the signed-in state until `GET /me` succeeds or FR-8 completes, except as allowed by FR-10.
- FR-7: The app shall keep the splash screen up until the auth state has left `loading` (existing behaviour in `src/app/_layout.tsx`), and a persisted user shall be restored on iOS, Android and web without any user action.
- FR-8: When `GET /me` returns 404 `profile-not-found` (sign-up interrupted, 02 FR-10, or first social sign-in, 04), the app shall complete the profile with `PUT /me` carrying `name` (`user_metadata.name` when at least 2 characters after trimming) and `consent`. Consent is never assumed: it is sent only if the user accepted it in the current app run (02 FR-14); otherwise the app shall show a consent step (the Terms/Privacy line from 02 FR-14, with a required Name field (min 2 characters after trimming) when no usable name exists; this is the decided fallback for a missing name) and call `PUT /me` after acceptance. If the user dismisses or declines the step, the app shall delete that user's auth account through the backend (FR-16), whatever the sign-in method, and no profile is ever created for it.
- FR-14: After a successful `GET /me`, if `Me.language` is `en` or `ru` the app shall switch to it and store it as the device language; if `null` the app shall keep the device-derived language (Russian locale -> `ru`, otherwise `en`) or the Welcome selection, and shall not write a language to the profile on its own (writes belong to account-settings).
- FR-16: Declining consent shall delete the auth account for any user without a profile (new social user or interrupted email sign-up). The client cannot delete its own Supabase Auth user, so the app calls `DELETE /me` (06, owned by account-settings/06), which the backend shall accept for a caller with no profile and which then removes the auth user (no profile data exists to erase); a fresh sign-in has just happened, so the recent-login rule is met. On 204 the app signs out locally and returns to Welcome. `PUT /me` is never called for a declined user. If the deletion call fails (offline, error), the app shall not enter the signed-in state, shall persist a non-secret local "pending account deletion" marker (no credentials), shall show the mapped error (`errors.network` or `errors.generic`), and shall retry `DELETE /me` at the next app launch and when connectivity returns, before any other auth action; while the marker is set no profile call is made. When the retry succeeds the marker is cleared. The retry at a later launch needs no fresh sign-in (a no-profile caller is exempt from the recent-sign-in rule, account-settings/06 FR-20) and is not answered with 403 `recent-login-required`. If the retry gets 401 (session no longer usable), the app signs out locally, clears the marker, and the leftover profile-less auth account is removed by the server-side cleanup in 06 FR-17.
- FR-15: The session user shall carry `id`, `name`, `email`, `email_verified`, `language` from `GET /me` for use by Account.
- FR-9: The session shall end (signed-out state, Welcome) only on a definitive failure per 01 FR-9, or on explicit log out. Network errors, 429, 5xx and 503 shall not end it.
- FR-10: When the app starts offline (or `GET /me` is unreachable) and a persisted Supabase session exists, the app shall enter the signed-in state using the name (`user_metadata.name`) and email from the stored session, and shall fetch `GET /me` once connectivity returns.
- FR-11: The session store shall no longer persist the user profile in AsyncStorage; the legacy key `praxis.session` shall be deleted on first start of the new version.
- FR-12: Route guards shall remain as in `src/app/_layout.tsx`: auth screens signed-out only, app screens signed-in only, `set-new-password` and `password-updated` reachable in both states.
- FR-13: Changing the language switcher on Welcome shall take effect immediately and persist on the device (existing behaviour; no account exists yet).

## Non-functional requirements
- NFR-1: Log-in (Supabase sign-in + `GET /me`) completes in <= 2.5 s at p95 on 4G.
- NFR-2: Cold start with a persisted session reaches the Library without showing any auth screen (no flash), <= 1.5 s to leave the splash at p95 (excluding fonts).
- NFR-3: Response time and message for unknown-email and wrong-password differ by no observable UI distinction (same key, same layout).
- NFR-4: Logs never include email, password or tokens; they include flow ID and error code.
- NFR-5: Messages and labels exist in `en.json` and `ru.json`; touch targets >= 44 px; errors are announced to assistive tech.
- NFR-6: Brute-force protection comes from Supabase Auth's built-in rate limits plus 06 rate limits.

## Acceptance criteria
- AC-1: Given a registered user, When valid credentials are submitted, Then `GET /me` returns 200 and the Library is shown (verifies FR-4, FR-6).
- AC-2: Given empty fields, When submit, Then `validation.emailRequired` and `validation.passwordRequired` show, focus is on Email, no request is sent (verifies FR-3).
- AC-3: Given Email "elena@", Then `validation.emailInvalid` (verifies FR-3).
- AC-4: Given a wrong password for an existing email and, separately, an unregistered email, Then both show `errors.invalidCredentials` (verifies FR-5, NFR-3).
- AC-5: Given offline, When submit, Then `errors.network`, values kept, button re-enabled (verifies FR-5).
- AC-6: Given Supabase Auth answers 429 (`over_request_rate_limit`), Then `errors.tooManyRequests` (verifies FR-5, NFR-6).
- AC-7: Given a banned user (`user_banned`), Then `errors.accountDisabled` and no session is established (verifies FR-5, FR-9).
- AC-8: Given a signed-in user force-quits and relaunches the app, Then the Library appears directly with no auth screen flash (verifies FR-7, NFR-2).
- AC-9: Given a signed-in user on web reloads the page, Then they remain signed in (verifies FR-7).
- AC-10: Given a persisted user and no connectivity at launch, Then the Library is shown with the stored name and the session is not ended (verifies FR-9, FR-10).
- AC-11: Given a valid Supabase user without a profile (`GET /me` 404), `user_metadata.name` "Elena" and consent accepted in this app run, Then `PUT /me` is called with that name and consent and the Library is shown (verifies FR-8).
- AC-19: Given a user without a profile and no consent in this run (app restarted after an interrupted sign-up), Then the consent step is shown and no `PUT /me` is sent until accepted; declining it calls `DELETE /me`, the auth user no longer exists afterwards (signing in again fails with `invalid_credentials`), the app returns to Welcome, and no profile was ever created (verifies FR-8, FR-16).
- AC-23: Given declining consent and the `DELETE /me` call fails offline, Then the app does not enter the signed-in state, `errors.network` is shown, the pending marker persists across restart, and at next launch (or on reconnection) `DELETE /me` is retried and succeeds; at no point is `PUT /me` called (verifies FR-16).
- AC-24: Given the pending marker is set and the user restarts online, Then `DELETE /me` completes before any auth screen action and the marker is cleared; the same email can later be used to sign up again (verifies FR-16).
- AC-20: Given `Me.language` is `ru` on a device currently in `en`, When log-in completes, Then the app switches to Russian and keeps it after restart (verifies FR-14).
- AC-21: Given `Me.language` is `null` on a Russian-locale device, Then the app stays Russian and no language write occurs (verifies FR-14).
- AC-22: Given the session user after log-in, Then it includes `email_verified` and `language` (verifies FR-15).
- AC-12: Given the API returns 401 twice on bootstrap, Then the session ends and Welcome is shown (verifies FR-9, 01 FR-9).
- AC-13: Given `GET /me` returns 503, Then the session is retained and the user is not signed out (verifies FR-9).
- AC-14: Given the previous app version left `praxis.session` in AsyncStorage, When the new version starts, Then the key is removed and not used to authenticate (verifies FR-11).
- AC-15: Given a signed-in user manually opens `/log-in` (web URL), Then they are redirected to the Library; given a signed-out user opens `/library`, Then Welcome (verifies FR-12).
- AC-16: Given Welcome, When "Create account" / "Log in" tapped, Then Sign up / Log in open; When "Forgot password?" tapped on Log in, Then Forgot password opens (verifies FR-1, FR-2).
- AC-17: Given Welcome and RU selected, Then all Welcome texts show in Russian and persist after restart (verifies FR-13).
- AC-18: Given a Log in submit, When logs are inspected, Then no email, password or token appears (verifies NFR-4).

## Design additions needed (not in `docs/screens/`)
- Consent step shown to a signed-in user without a profile (Terms/Privacy line, optional name field, accept and cancel actions), EN and RU.

## App integration notes
Replace `mockAuthService.logIn`. Replace the AsyncStorage logic in `src/features/session/store.ts`: keep the exports consumed by screens (`useSession`, `status`, `user`, `signOut`, `updateUser`, `getInitials`) but derive `status` from the auth-state observable in 01, set `user` from `GET /me` (name/email), and let `updateUser` update memory only (the server write belongs to account-settings). `useAuthForm` should stop calling `signIn(user)` directly. Remove `SESSION_STORAGE_KEY` usage except for the one-time cleanup (FR-11). Remove magic mock values.

## Open questions
None beyond the external items under "Prerequisites and external questions".

## Prerequisites and external questions
- Design for the consent / complete-profile step (consent line, Name field, accept and decline actions) is missing (see Design additions).
- Decided assumptions recorded here: sessions persist until log out or revocation (no "remember me", no inactivity timeout); offline cold start enters the app with the name stored in the cached session; concurrent multi-device login is allowed; the Welcome language selection is not written to `Me.language` at sign-up.
- Verify at implementation: the Supabase client's behaviour on cold start with an expired access token and no network (session retained, `INITIAL_SESSION` timing), which FR-10 and NFR-2 rely on.
- Verify at implementation: `DELETE /me` for a caller without a profile must also revoke an Apple token when the declined identity is Apple (04 FR-14); how the authorization code is carried to the backend is an account-settings/06 matter and is not defined here.
