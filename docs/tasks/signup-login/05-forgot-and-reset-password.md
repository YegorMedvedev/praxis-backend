# 05 Forgot and reset password

- **Milestone:** Sign-up & Log-in
- **Screens covered:** `forgot_password.png`, `check_your_inbox.png`, `set_new_password.png`, `password_updated.png`, plus the expired/invalid-link state of Set new password (implemented in `src/app/set-new-password.tsx`, no PNG)
- **Depends on:** 01, 03
- **Type:** BE + App (Firebase Auth configuration + app)

## Description
A user who forgot their password requests a reset email, opens the emailed link on the same or another device, sets a new password and sees a success screen. It uses the Firebase Auth password-reset email and works on mobile via a deep link (universal/app link) and on web. The email link is a Firebase action link carrying a one-time `oobCode` and pointing at the custom action URL `<web origin>/auth-action` (the `/auth-action` route dispatches on `mode`: `resetPassword` -> Set new password, `verifyEmail` -> `/verify-email`); the code is only consumed when the user submits the new password. There is no recovery session. It replaces `requestPasswordReset` and `resetPassword` in the mock service.

## Scope
**In scope:** the four screens and the invalid-link state, reset email configuration (EN/RU content, link target, lifetime), deep-link/web routing of the link, resend, error states, the `/verify-email` landing route (FR-20).
**Out of scope:** change password for signed-in users (account-settings milestone), the Account verify-email prompt (02 FR-15; only its emailed link handling is here, FR-20).

## APIs
No Praxis API endpoints. Firebase Auth operations used by the client: `sendPasswordResetEmail(email)`, `confirmPasswordReset(oobCode, newPassword)`, `checkActionCode` / `applyActionCode` (verify-email, FR-20), `signOut`. The reset email template links to `<web origin>/auth-action?mode=resetPassword&oobCode=<code>&lang=<lang>` (custom action URL set in the Firebase console, see Prerequisites); `/auth-action` forwards to the app/web route `/set-new-password?oobCode=<code>`. The web origin must be on the Firebase authorized domains (01 FR-1).

## Functional requirements
- FR-1: The Forgot password screen shall show the lock icon, title, subtitle, an Email field, a "Send reset link" button and a back button.
- FR-2: The system shall validate Email on submit as in 02 FR-3; invalid input shows `validation.emailRequired` / `validation.emailInvalid` and sends nothing.
- FR-3: On valid submit the app shall call `resetPasswordForEmail` for the trimmed email and navigate to Check your inbox passing the email.
- FR-4: The app shall navigate to Check your inbox for any well-formed email, whether or not an account exists, with identical UI and no distinguishing message (no account enumeration; the app swallows `auth/user-not-found` from `sendPasswordResetEmail` and treats it as success, and Firebase email enumeration protection should stay consistent with FR-4 of 02 NFR-6).
- FR-5: While the request runs the button shall show loading and the field shall be non-editable; repeated taps shall not send a second request.
- FR-6: If the request fails because offline show `errors.network`; for rate limiting (`auth/too-many-requests`, `auth/quota-exceeded`, 429) `errors.tooManyRequests`; anything else `errors.generic`; as an alert under the button; the email stays and the notice clears on edit.
- FR-7: Check your inbox shall show the email in bold within `checkInbox.body`, the validity text of FR-9, "Open email app" (opens the default mail app; if none can be opened show `checkInbox.noMailApp` for 3.5 s), a resend control, and "Back to log in" (replaces route with Log in). If no email is available (screen opened directly) it shall show `checkInbox.bodyNoEmail` and no resend control. On web "Open email app" shall open a `mailto:` link.
- FR-8: Resend shall be disabled for 60 s after each successful request, showing `checkInbox.resendIn` with an m:ss countdown; afterwards it shows `checkInbox.resend`. A successful resend shows `checkInbox.resent` for 3.5 s and restarts the countdown; a failed resend shows the mapped error key from FR-6 for 3.5 s and does not restart it.
- FR-9: The validity text on Check your inbox shall state the lifetime of the reset link as a constant: Firebase fixes it at 1 hour and it is not configurable, so the copy constant is 60 min. The key `checkInbox.validity` takes a `{{duration}}` value formatted for the app language (for example "1 hour"), replacing `checkInbox.validity_one/_other`. If Firebase ever changes the lifetime, the constant is changed together with it. The "30 minutes" in `check_your_inbox.png` is an example value only.
- FR-10: The reset email shall be sent in the app language (EN or RU) at request time with Praxis-branded subject and body, containing a single link to the custom action URL (the `auth-action` link described under APIs), and shall not include the user's password or any personal data other than the recipient address. The language is selected through the Auth instance `languageCode` set to the app language before the request (Firebase uses the matching console template language; the template text for EN and RU is a prerequisite).
- FR-11: Opening the link on mobile with the app installed shall open the app at `/auth-action` and on to Set new password with `oobCode` (universal link on iOS, app link on Android); with the app not installed, or on desktop, it shall open the web app's `/auth-action` route and on to Set new password.
- FR-12: Set new password shall show New password and Confirm new password fields, a show/hide toggle on the first field, a live checklist (`setNewPassword.ruleMinLength`, `ruleLetterAndNumber`, `ruleMatch`) and an "Update password" button that is disabled until all three rules are met. Rules are the same as 02 FR-4 (letter and digit, Unicode-aware).
- FR-13: On submit the app shall (1) call `confirmPasswordReset(oobCode, newPassword)`, which verifies and consumes the code and sets the password in one call, (2) sign out locally and clear local credentials on this device immediately (Firebase revokes the user's refresh tokens on password reset), and (3) replace the route with Password updated. Other devices' sessions end within the 60-minute revocation window (06 NFR-3). Because the link itself does not consume the code, link-preview scanners cannot consume it.
- FR-14: If the link is missing `oobCode`, has an unsupported `mode`, or `confirmPasswordReset` reports it invalid, expired or already used (`auth/invalid-action-code`, `auth/expired-action-code`), the screen shall show the invalid state (`setNewPassword.invalidTitle`, `invalidBody`) with a "Request a new link" button (`setNewPassword.requestNewLink`) that replaces the route with Forgot password. Offline on submit shows `errors.network` in the form (not the invalid state) and keeps the entered values; other failures show `errors.generic`.
- FR-15: Password complexity is enforced client-side (FR-12) and by the project minimum policy (01 FR-1); if Firebase nevertheless rejects the new password (`auth/weak-password`), the form shall show `errors.generic`. A failed call (offline, weak password) leaves the code valid, so the same `oobCode` can be submitted again.
- FR-16: Password updated shall show the check icon, title, subtitle and a "Log in" button that replaces the route with Log in; swipe-back into the spent reset form shall be disabled.
- FR-17: Set new password and Password updated shall be reachable in signed-in and signed-out states (existing guards). n/a with Firebase: the "temporary recovery session" part of this requirement; Firebase creates no recovery session, so the reset never makes the app enter the signed-in state.
- FR-18: A used token shall not be reusable: a second attempt with the same link shows the invalid state.
- FR-19: The `oobCode` shall be removed from the visible URL/route history after being read where the platform allows (web: replace the history entry); the app keeps it in memory until submit.
- FR-20: This feature owns the `/verify-email` route and the handling of verification email links (the Account prompt that triggers the email is owned by account-settings/04). Verification is optional and driven from Account; a verification email link (`<web origin>/auth-action?mode=verifyEmail&oobCode=...`) shall open the app (mobile) or web at `/verify-email`, redeem it with `checkActionCode` + `applyActionCode`, and show a success or an invalid/expired state with a way back (to Account if signed in, else to Log in). When the signed-in user is the link's account, the user is reloaded so `emailVerified` refreshes. Design needed (see below).
- FR-21: n/a with Firebase: there is no separate redeem-then-update sequence (`confirmPasswordReset` is a single call that leaves the code valid on failure), so no recovery session is kept in memory; FR-15 covers the retry.

## Non-functional requirements
- NFR-1: Security: no account enumeration in UI, timing-observable behaviour or messages (FR-4); the `oobCode` is never logged or sent to analytics.
- NFR-2: Delivery: the reset email arrives within 60 s at p95 and is sent from a domain with SPF/DKIM/DMARC alignment (see Prerequisites); the Firebase default sender is acceptable for development only.
- NFR-3: i18n: all screen strings exist in `en.json`/`ru.json`; the reset email exists in EN and RU; Cyrillic renders correctly in the email.
- NFR-4: Accessibility: touch targets >= 44 px, errors and resend feedback are announced via live regions, checklist items expose met/unmet state not by colour alone.
- NFR-5: Reliability: deep links open correctly on iOS 16+, current Android, and desktop/mobile browsers.
- NFR-6: Resend throttling: the 60 s countdown is client-side; Firebase Auth and API rate limits enforce the real ceiling.
- NFR-7: After a reset, other devices lose API access within 60 minutes (06 NFR-3): refresh tokens are revoked by Firebase on password reset and existing ID tokens expire within 1 hour.

## Acceptance criteria
- AC-1: Given an existing account, When a valid email is submitted on Forgot password, Then a reset email is sent and Check your inbox shows that email (verifies FR-3, FR-7).
- AC-2: Given an unregistered email, Then the app shows the same Check your inbox and no email is sent (verifies FR-4, NFR-1).
- AC-3: Given invalid or empty email, Then `validation.emailInvalid` / `validation.emailRequired` and no request (verifies FR-2).
- AC-4: Given offline, When "Send reset link" is tapped, Then `errors.network` is shown, the email is kept (verifies FR-6).
- AC-5: Given Check your inbox, Then the resend control shows `checkInbox.resendIn` counting from 1:00 down to 0:00 and then becomes `checkInbox.resend` (verifies FR-8).
- AC-6: Given the countdown has finished, When resend is tapped, Then a new email is sent, `checkInbox.resent` appears for 3.5 s, the countdown restarts (verifies FR-8).
- AC-7: Given resend fails offline, Then `errors.network` shows for 3.5 s and the resend control remains available (verifies FR-8, FR-6).
- AC-8: Given no mail app is available, When "Open email app" is tapped, Then `checkInbox.noMailApp` is shown (verifies FR-7).
- AC-9: Given "Back to log in", Then Log in replaces the screen (verifies FR-7).
- AC-10: Given the reset email requested in each app language, Then the body is in that language with a working link to the custom action URL (verifies FR-10, NFR-3).
- AC-11: Given the app is installed on iOS and Android, When the link is tapped in the mail client, Then the app opens and reaches Set new password with the `oobCode` (verifies FR-11, NFR-5).
- AC-12: Given the app is not installed or on desktop, When the link is opened, Then the web Set new password page loads (verifies FR-11).
- AC-13: Given Set new password with password "abc", Then "At least 8 characters" is unmet and the button is disabled (verifies FR-12).
- AC-14: Given passwords "пароль123" in both fields, Then all three rules are met and the button is enabled (verifies FR-12).
- AC-15: Given mismatching confirm field, Then "Both fields match" is unmet and the button is disabled (verifies FR-12).
- AC-16: Given a valid link and valid passwords, When submitted, Then Password updated is shown, and the user can log in with the new password and not the old (verifies FR-13, FR-16).
- AC-17: Given an expired link, When the user submits, Then the invalid state with "Request a new link" appears; tapping it opens Forgot password (verifies FR-14).
- AC-18: Given a link already used, Then the invalid state appears (verifies FR-18, FR-14).
- AC-19: Given Set new password opened without `oobCode`, Then the invalid state is shown immediately (verifies FR-14).
- AC-20: Given offline on submit, Then `errors.network` in the form, values kept, invalid state not shown (verifies FR-14).
- AC-21: Given a signed-in user completes a reset from a link, Then on success the local session ends immediately (secure storage cleared) and "Log in" on Password updated opens Log in rather than redirecting to the Library (verifies FR-13, FR-16, FR-17).
- AC-22: Given Password updated, Then swipe-back to the reset form is not possible (verifies FR-16).
- AC-23: Given Check your inbox in EN and RU, Then the text uses `checkInbox.validity` with a duration of 60 minutes / 1 hour, the old minute-based keys are removed, and a link used after 1 hour is invalid (verifies FR-9).
- AC-24: Given the reset flow, When logs and analytics are inspected, Then no `oobCode` or email appears (verifies NFR-1).
- AC-25: Given the web route after reading the code, Then the `oobCode` is not in the current history entry's URL (verifies FR-19).
- AC-26: Given the user is signed in on device B, When a reset is completed on device A, Then device B's session refresh fails and its API calls are rejected, and it returns to Welcome within 60 minutes (verifies NFR-7, FR-13).
- AC-27: Given a verification email link, When opened with the app installed / not installed, Then the app or web `/verify-email` redeems it and shows success; an expired link shows the invalid state (verifies FR-20).
- AC-28: Given the Forgot password screen is opened in EN and RU, Then the lock icon, title, subtitle, Email field, "Send reset link" button and back button are present (verifies FR-1).
- AC-29: Given a valid email is submitted, While the request runs, Then the button shows its loading state, the Email field is not editable, and a second tap on the button or Enter sends no second request (exactly one `sendPasswordResetEmail` request is observed) (verifies FR-5).
- AC-30: Given Firebase rejects the new password as weak (simulated), When "Update password" is submitted, Then `errors.generic` is shown in the form and the link is not shown as invalid (verifies FR-15).
- AC-31: Given Firebase answers `auth/too-many-requests` to the reset request, Then `errors.tooManyRequests` is shown under the button (verifies FR-6).
- AC-32: n/a with Firebase (FR-21): given `confirmPasswordReset` fails offline, When the user submits again online with the same `oobCode`, Then it is sent again and Password updated is shown (verifies FR-15).
- AC-33: Given a reset in progress on a signed-out device, Then the app never shows the Library or the signed-in redirect before Password updated (verifies FR-17).

## App integration notes
Replace `requestPasswordReset({ email })` and `resetPassword({ token, newPassword })` in `src/services/auth.ts` (new input `{ oobCode, newPassword }`). The `/auth-action` route (`src/app/auth-action.tsx`) is the landing for all Firebase email action links and forwards to `set-new-password` (param `oobCode`) or `verify-email`; the documented deep link `praxisapp://set-new-password?token=` is replaced by the universal/app link form (the `praxisapp` scheme in `app.json` may stay as a fallback). Screens `forgot-password.tsx`, `check-inbox.tsx`, `password-updated.tsx` keep their code; `VALIDITY_MINUTES` / `checkInbox.validity_*` in `check-inbox.tsx` and the locale files are replaced per FR-9; add a `verify-email` route (FR-20). Remove mock magic values (`expired` token, `offline@example.com`).

**Decided assumptions:** the reset code is consumed on submit (and a missing code shows the invalid state at once), not on open; the email is passed to Check your inbox as a route parameter.

## Design additions needed (not in `docs/screens/`)
- Check your inbox: the validity line shows the configured duration, not necessarily "30 minutes" (`check_your_inbox.png` shows an example), EN and RU.
- Verify email landing screen (success and invalid/expired states), EN and RU.

## Open questions
None beyond the external items under "Prerequisites and external questions".

## Prerequisites and external questions
(Prerequisites are not yet provided and must not be invented.)
- Action domain (web origin) for the custom action URL `<web origin>/auth-action`, with `apple-app-site-association` and `assetlinks.json` hosting; it must be on the Firebase authorized domains.
- Firebase console steps: set the password-reset and verify-email template language(s) and EN/RU copy and branding, set the custom action URL, and configure the sender address/domain with SPF/DKIM/DMARC (values supplied by the owner).
- Final RU/EN formatting of the duration in `checkInbox.validity` (the lifetime itself is fixed at 1 hour by Firebase).
- Verify at implementation: that `confirmPasswordReset` works for a link opened on a different device than the request, and that an expired or used code yields `auth/expired-action-code` / `auth/invalid-action-code`.
- Verify at implementation: that Firebase revokes all refresh tokens of the user on password reset (other devices fail their next ID token refresh).
- Verify at implementation: how the email language is chosen (Auth `languageCode` against the console template language, and the `lang` parameter carried to the action URL).
- Verify at implementation: whether an earlier reset link stays valid after a resend, the minimum interval Firebase enforces between reset emails per address, and `setNewPassword.invalidBody` wording ("work once").
