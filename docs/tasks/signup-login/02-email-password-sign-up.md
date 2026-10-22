# 02 Email/password sign-up

- **Milestone:** Sign-up & Log-in
- **Screens covered:** `sign_up.png` (entered from `welcome.png` "Create account" and from the Log in footer link)
- **Depends on:** 01, 06
- **Type:** BE + App

## Description
A new therapist creates a Praxis account with name, email and password. The app signs the user up with Supabase Auth (storing the name in the user's metadata), then creates the Praxis profile via `PUT /me` and enters the signed-in app (Library). It replaces `mockAuthService.signUp`.

## Scope
**In scope:** sign-up form validation and error states, Supabase Auth user creation, profile creation, atomicity/recovery between the two steps, post-sign-up navigation.
**Out of scope:** Google/Apple sign-up (04; they reuse the consent rules in FR-14), welcome screen (03), the Account screen itself (account-settings milestone; this feature specifies the verify-email prompt it must show, FR-15).

## APIs
Uses `PUT /me` (defined in 06) with `{ "name": "<trimmed name>", "consent": { "terms_version": "...", "privacy_version": "..." } }`, bearer = the new user's access token. Expected: 201. Problem types handled: `invalid-request`, `account-disabled`, `rate-limited`, `internal-error`, `service-unavailable`, `token-expired`/`unauthenticated` (per 01 FR-8/FR-9).
Supabase Auth operations used by the client: sign up with email/password and `options.data.name`; resend the signup confirmation email (FR-15, subject to the external question on email verification).

## Functional requirements
- FR-1: The Sign up screen shall show Name, Email and Password fields, a required consent line (checkbox plus text with links to the Terms and the Privacy Policy, FR-14), a "Create account" button, Google and Apple buttons (behaviour in 04), a back button, and a footer link "Log in" that replaces the screen with Log in.
- FR-2: The system shall validate Name as: required (`validation.nameRequired`), after trimming >= 2 characters (`validation.nameTooShort`).
- FR-3: The system shall validate Email as: required (`validation.emailRequired`), after trimming matching the pattern in `src/lib/validation.ts` (`validation.emailInvalid`).
- FR-4: The system shall validate Password as: required (`validation.passwordRequired`), >= 8 characters (`validation.passwordTooShort`), containing at least one Unicode letter and one digit (`validation.passwordNeedsLetterAndNumber`). Cyrillic letters count. The password is never trimmed.
- FR-5: Field errors shall appear on submit, or on blur only after the field has been edited, and shall re-validate on each change until cleared. On submit with invalid fields, focus shall move to the first invalid field and no network call is made.
- FR-6: On valid submit the app shall trim Name and Email, sign up with Supabase Auth passing the trimmed Name as `user_metadata.name`, then (the sign-up returns a session because "Confirm email" is off, 01 FR-1) call `PUT /me` including `consent` with the current Terms and Privacy versions.
- FR-7: While any submit or social sign-in is running, the button shall show a loading state, all inputs shall be non-editable, social buttons shall be disabled, and repeated taps shall not start a second request.
- FR-8: When Supabase Auth reports the email is already registered (`user_already_exists` or `email_exists`), the app shall show `errors.emailTaken` as the error of the Email field and focus it.
- FR-9: When the call fails because the device is offline or times out, the app shall show `errors.network` as the form notice; for rate limiting (`over_request_rate_limit`, `over_email_send_rate_limit` or 429) `errors.tooManyRequests`; for any other failure `errors.generic`. Entered values shall be preserved. The notice clears when the user edits any field.
- FR-10: If the Supabase Auth user was created but `PUT /me` failed, the app shall keep the Supabase session, show the notice from FR-9, and on the next tap of "Create account" with unchanged Email retry only `PUT /me` (not a second sign-up). It shall not enter the signed-in app until `PUT /me` succeeds. If the app is closed in this state, 03 FR-8 completes the profile at next start using the name in `user_metadata`.
- FR-11: On success (201 from `PUT /me`) the app shall enter the signed-in state and replace the route with the Library.
- FR-12: The Password field shall provide the show/hide toggle (`common.showPassword` / `common.hidePassword`), use the platform new-password autofill hints, and never be logged or persisted by the app.
- FR-13: Each Supabase Auth failure shall be mapped to `AuthError` per the table in 01 FR-12.
- FR-14: Account creation shall require explicit consent: the consent checkbox is unchecked by default; submitting while unchecked shall show the error `validation.consentRequired` (new key, EN and RU) beside the checkbox, move focus to it and send nothing; tapping Google or Apple on Sign up while unchecked shall show the same error and not start the provider flow. The Terms and Privacy links open the documents in the app language. The server records acceptance (versions, timestamp) via `PUT /me` (06).
- FR-15: Email verification shall not be required to use the app. `Me.email_verified` (06) shall be exposed to the app; for a signed-in user with a password sign-in and `email_verified = false`, the Account screen shall show a "Verify your email" prompt with an action that sends the verification email (the mechanism depends on the external question on email verification) and confirms with a message; once verified (checked on return to the Account screen after forcing a session refresh and `GET /me`) the prompt disappears. Verified-by-provider accounts (Google, Apple) never show it. The Account prompt itself is owned by account-settings/04-email-verification-status.md; the emailed link and its `/verify-email` landing route are owned by signup-login/05 (FR-20).

## Non-functional requirements
- NFR-1: Sign-up (Supabase sign-up + `PUT /me`) completes in <= 3 s at p95 on a 4G connection, excluding Supabase Auth latency above 1 s.
- NFR-2: The password is sent only to Supabase Auth over TLS; the Praxis API never receives or stores it.
- NFR-3: All messages come from `en.json`/`ru.json`; layouts hold in both languages (existing keys listed in FR-2..FR-9 exist in both).
- NFR-4: Touch targets >= 44 px; each error is announced via an accessibility live region (existing `FormNotice`/`TextField` behaviour is retained).
- NFR-5: Observability: failures are logged with flow ID and error code only; no email, name or password.
- NFR-6: Sign-up discloses whether an email is registered (`errors.emailTaken`, required by the design). Abuse is limited by Supabase Auth and API rate limits (01, 06); this is an accepted deviation from the "no account enumeration" baseline (accepted as decided).

## Acceptance criteria
- AC-1: Given valid unused Name/Email/Password, When "Create account" is tapped, Then a Supabase Auth user exists, a session is held, `PUT /me` returns 201, and the Library is shown (verifies FR-6, FR-11).
- AC-2: Given all fields empty and consent unchecked, When submit is tapped, Then `validation.nameRequired`, `emailRequired`, `passwordRequired`, `consentRequired` are shown, focus is on Name, and no request is sent (verifies FR-2..FR-5, FR-14).
- AC-3: Given Name "A", When the field is blurred after typing, Then `validation.nameTooShort` is shown (verifies FR-2, FR-5).
- AC-4: Given Email "elena@", When submit, Then `validation.emailInvalid` (verifies FR-3).
- AC-5: Given Password "abc12", Then `validation.passwordTooShort`; given "abcdefgh", Then `validation.passwordNeedsLetterAndNumber`; given "пароль123", Then no password error (verifies FR-4).
- AC-6: Given an email already registered (Supabase answers `user_already_exists`), When submit, Then `errors.emailTaken` appears under Email and Email is focused; no profile is created (verifies FR-8).
- AC-7: Given the device is offline, When submit, Then `errors.network` is shown, values are kept, and the button is enabled again (verifies FR-9, FR-7).
- AC-8: Given the user taps "Create account" twice quickly, Then exactly one sign-up request is sent (verifies FR-7).
- AC-9: Given sign-up succeeded and `PUT /me` returns 503, When the user taps "Create account" again, Then no second sign-up is sent, `PUT /me` is retried, and on 201 the Library is shown (verifies FR-10).
- AC-10: Given sign-up succeeded, `PUT /me` failed and the app is killed, When the app restarts, Then 03 FR-8 creates the profile using the name stored in `user_metadata` (verifies FR-10).
- AC-11: Given Supabase Auth answers `over_request_rate_limit` (429), Then `errors.tooManyRequests` is shown (verifies FR-9, FR-13).
- AC-12: Given the user edits any field after an error notice, Then the notice disappears (verifies FR-9).
- AC-13: Given the password toggle is tapped, Then the password text is revealed/hidden with the correct accessibility label in EN and RU (verifies FR-12, NFR-3).
- AC-14: Given the footer "Log in" is tapped, Then Log in replaces Sign up (back does not return to Sign up) (verifies FR-1).
- AC-16: Given valid fields and consent unchecked, When submit, Then `validation.consentRequired` is shown, focus is on the checkbox, no Supabase Auth user is created (verifies FR-14).
- AC-17: Given consent unchecked, When Google or Apple is tapped on Sign up, Then `validation.consentRequired` is shown and no provider UI opens (verifies FR-14).
- AC-18: Given a successful sign-up, When `GET /me` is called, Then `consent.terms_version`, `privacy_version` equal the versions shown and `accepted_at` is set (verifies FR-6, FR-14).
- AC-19: Given a user without verified email, When they open Account, Then the verify prompt shows and the Library is fully usable; after the link is used and the screen is revisited, the prompt is gone (verifies FR-15).
- AC-20: Given a Google/Apple user, When Account opens, Then no verify prompt (verifies FR-15).
- AC-15: Given a sign-up, When logs are inspected, Then no email, name or password appears (verifies NFR-5, NFR-2).

## App integration notes
Replace `mockAuthService.signUp` behind `auth.signUp({ name, email, password })`; keep the `AuthUser` return and `AuthError` contract so `src/app/sign-up.tsx` and `useAuthForm` stay unchanged. `useAuthForm` currently calls the session store's `signIn(user)`; this moves to the auth-state observable (03). The magic mock values (`taken@example.com`, `offline@example.com`) are removed.

## Open questions
None beyond the external items under "Prerequisites and external questions".

## Design additions needed (not in `docs/screens/`)
- Sign up: required consent checkbox line with Terms and Privacy links, its error state, in EN and RU.
- Account: "Verify your email" prompt, its sent/confirmation state (owned by the account-settings milestone).

## Prerequisites and external questions
(Prerequisites are not yet provided and must not be invented.)
- Terms and Privacy Policy documents (EN/RU), their public URLs and version identifiers.
- The Privacy Policy must disclose that speech-to-text (dictation) audio may reach vendor servers, before sign-up consent can lawfully cover it (owned by chat-simulation/04 and /05; this feature only links the document).
- EN/RU copy for `validation.consentRequired` and the single consent line covering both documents.
- Verify at implementation: with "Confirm email" disabled, sign-up for an already-registered email returns the `user_already_exists` error (with confirmation enabled Supabase may obfuscate it); the returned session is immediate; Supabase default password policy versus the client rules.
- Decided: Supabase "Confirm email" stays OFF (required project setting, 01 FR-1), because sign-in would otherwise be blocked with `email_not_confirmed`. Verify at implementation (facts only): where `Me.email_verified` is read from with confirmation off (for example `email_confirmed_at` or provider-reported state) and whether the Account verify prompt (FR-15, account-settings/04) can be driven by it; whether `signUp` returns a session immediately.
