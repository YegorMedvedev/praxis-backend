# 05 Forgot and reset password

- **Milestone:** Sign-up & Log-in
- **Screens covered:** `forgot_password.png`, `check_your_inbox.png`, `set_new_password.png`, `password_updated.png`, plus the expired/invalid-link state of Set new password (implemented in `src/app/set-new-password.tsx`, no PNG)
- **Depends on:** 01, 03
- **Type:** BE + App (Supabase Auth configuration + app)

## Description
A user who forgot their password requests a reset email, opens the emailed link on the same or another device, sets a new password and sees a success screen. It uses the Supabase Auth recovery-email flow and works on mobile via a deep link (universal/app link) and on web. The email link points at the Praxis app/web page carrying a one-time recovery `token_hash`; the token is only redeemed when the user submits the new password. It replaces `requestPasswordReset` and `resetPassword` in the mock service.

## Scope
**In scope:** the four screens and the invalid-link state, reset email configuration (EN/RU content, link target, lifetime), deep-link/web routing of the link, resend, error states, the `/verify-email` landing route (FR-20).
**Out of scope:** change password for signed-in users (account-settings milestone), the Account verify-email prompt (02 FR-15; only its emailed link handling is here, FR-20).

## APIs
No Praxis API endpoints. Supabase Auth operations used by the client: `resetPasswordForEmail(email, { redirectTo })`, `verifyOtp({ type: 'recovery', token_hash })`, `updateUser({ password })`, `signOut({ scope: 'global' })`. The recovery email template links to `<action domain>/set-new-password?token_hash=<hash>&type=recovery` (action domain: see Prerequisites). `/set-new-password?token_hash=<hash>&type=recovery` is the app/web route. The `redirectTo` base must be on the Supabase redirect allow list (01 FR-1).

## Functional requirements
- FR-1: The Forgot password screen shall show the lock icon, title, subtitle, an Email field, a "Send reset link" button and a back button.
- FR-2: The system shall validate Email on submit as in 02 FR-3; invalid input shows `validation.emailRequired` / `validation.emailInvalid` and sends nothing.
- FR-3: On valid submit the app shall call `resetPasswordForEmail` for the trimmed email and navigate to Check your inbox passing the email.
- FR-4: The app shall navigate to Check your inbox for any well-formed email, whether or not an account exists, with identical UI and no distinguishing message (no account enumeration; Supabase's `resetPasswordForEmail` does not reveal whether an account exists and sends no email for an unknown address).
- FR-5: While the request runs the button shall show loading and the field shall be non-editable; repeated taps shall not send a second request.
- FR-6: If the request fails because offline show `errors.network`; for rate limiting (`over_email_send_rate_limit`, `over_request_rate_limit`, 429) `errors.tooManyRequests`; anything else `errors.generic`; as an alert under the button; the email stays and the notice clears on edit.
- FR-7: Check your inbox shall show the email in bold within `checkInbox.body`, the validity text of FR-9, "Open email app" (opens the default mail app; if none can be opened show `checkInbox.noMailApp` for 3.5 s), a resend control, and "Back to log in" (replaces route with Log in). If no email is available (screen opened directly) it shall show `checkInbox.bodyNoEmail` and no resend control. On web "Open email app" shall open a `mailto:` link.
- FR-8: Resend shall be disabled for 60 s after each successful request, showing `checkInbox.resendIn` with an m:ss countdown; afterwards it shows `checkInbox.resend`. A successful resend shows `checkInbox.resent` for 3.5 s and restarts the countdown; a failed resend shows the mapped error key from FR-6 for 3.5 s and does not restart it.
- FR-9: The validity text on Check your inbox shall state the configured lifetime of the recovery link, never a hard-coded one: the key `checkInbox.validity` takes a `{{duration}}` value formatted for the app language (for example "1 hour" or "30 minutes"), replacing `checkInbox.validity_one/_other`. The app reads the lifetime from environment configuration that must equal the Supabase recovery-link (email OTP) expiration setting; the two shall be changed together. The "30 minutes" in `check_your_inbox.png` is an example value only.
- FR-10: The reset email shall be sent in the app language (EN or RU) at request time with Praxis-branded subject and body, containing a single link to the action domain (the `set-new-password` link described under APIs), sent through the project's custom SMTP, and shall not include the user's password or any personal data other than the recipient address. How the language reaches the email (one template per language, per-user metadata, or an email hook) is a verify-at-implementation item.
- FR-11: Opening the link on mobile with the app installed shall open the app at Set new password with `token_hash` and `type` (universal link on iOS, app link on Android); with the app not installed, or on desktop, it shall open the web app's Set new password route.
- FR-12: Set new password shall show New password and Confirm new password fields, a show/hide toggle on the first field, a live checklist (`setNewPassword.ruleMinLength`, `ruleLetterAndNumber`, `ruleMatch`) and an "Update password" button that is disabled until all three rules are met. Rules are the same as 02 FR-4 (letter and digit, Unicode-aware).
- FR-13: On submit the app shall (1) redeem the recovery token with `verifyOtp` (`type: 'recovery'`), (2) call `updateUser({ password })` on the resulting recovery session, (3) sign out with global scope so every refresh token of the user is revoked, clear local credentials on this device immediately, and (4) replace the route with Password updated. Other devices' sessions end within the 60-minute revocation window (06 NFR-3). Because the link itself does not redeem the token, link-preview scanners cannot consume it.
- FR-14: If the link is missing `token_hash`, has an unsupported `type`, or `verifyOtp` reports it invalid, expired or already used (`otp_expired`), the screen shall show the invalid state (`setNewPassword.invalidTitle`, `invalidBody`) with a "Request a new link" button (`setNewPassword.requestNewLink`) that replaces the route with Forgot password. Offline on submit shows `errors.network` in the form (not the invalid state) and keeps the entered values; other failures show `errors.generic`.
- FR-15: Password complexity is enforced client-side (FR-12) and by the project minimum length (01 FR-1); if Supabase nevertheless rejects the new password (`weak_password`, `same_password`), the form shall show `errors.generic`.
- FR-16: Password updated shall show the check icon, title, subtitle and a "Log in" button that replaces the route with Log in; swipe-back into the spent reset form shall be disabled.
- FR-17: Set new password and Password updated shall be reachable in signed-in and signed-out states (existing guards). The temporary recovery session created in FR-13 shall not make the app enter the signed-in state or trigger the signed-in route redirect.
- FR-18: A used token shall not be reusable: a second attempt with the same link shows the invalid state.
- FR-19: The `token_hash` shall be removed from the visible URL/route history after being read where the platform allows (web: replace the history entry); the app keeps it in memory until submit.
- FR-20: This feature owns the `/verify-email` route and the handling of verification email links (the Account prompt that triggers the email is owned by account-settings/04). With "Confirm email" decided OFF (01 FR-1, 02), verification is optional and driven from Account; if the verify-at-implementation facts in 02 allow it, a verification email link (`token_hash`, `type`) shall open the app (mobile) or web at `/verify-email`, redeem it with `verifyOtp`, and show a success or an invalid/expired state with a way back (to Account if signed in, else to Log in). Design needed (see below).
- FR-21: If `verifyOtp` succeeded but `updateUser` failed (offline or other error), the app shall keep the recovery session in memory and retry only `updateUser` on the next submit, without redeeming the token again; leaving the screen discards it.

## Non-functional requirements
- NFR-1: Security: no account enumeration in UI, timing-observable behaviour or messages (FR-4); the `token_hash` is never logged or sent to analytics.
- NFR-2: Delivery: the reset email arrives within 60 s at p95 and is sent from a domain with SPF/DKIM/DMARC alignment (see Prerequisites); the default Supabase email service is not acceptable for production (custom SMTP, 01 FR-1).
- NFR-3: i18n: all screen strings exist in `en.json`/`ru.json`; the reset email exists in EN and RU; Cyrillic renders correctly in the email.
- NFR-4: Accessibility: touch targets >= 44 px, errors and resend feedback are announced via live regions, checklist items expose met/unmet state not by colour alone.
- NFR-5: Reliability: deep links open correctly on iOS 16+, current Android, and desktop/mobile browsers.
- NFR-6: Resend throttling: the 60 s countdown is client-side; Supabase Auth and API rate limits enforce the real ceiling.
- NFR-7: After a reset, other devices lose API access within 60 minutes (06 NFR-3): refresh tokens are revoked by FR-13(3) and existing access tokens expire within the configured lifetime.

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
- AC-10: Given the reset email requested in each app language, Then the body is in that language with a working link to the action domain, sent via the custom SMTP (verifies FR-10, NFR-3).
- AC-11: Given the app is installed on iOS and Android, When the link is tapped in the mail client, Then the app opens at Set new password with the `token_hash` (verifies FR-11, NFR-5).
- AC-12: Given the app is not installed or on desktop, When the link is opened, Then the web Set new password page loads (verifies FR-11).
- AC-13: Given Set new password with password "abc", Then "At least 8 characters" is unmet and the button is disabled (verifies FR-12).
- AC-14: Given passwords "пароль123" in both fields, Then all three rules are met and the button is enabled (verifies FR-12).
- AC-15: Given mismatching confirm field, Then "Both fields match" is unmet and the button is disabled (verifies FR-12).
- AC-16: Given a valid link and valid passwords, When submitted, Then Password updated is shown, and the user can log in with the new password and not the old (verifies FR-13, FR-16).
- AC-17: Given an expired link, When the user submits, Then the invalid state with "Request a new link" appears; tapping it opens Forgot password (verifies FR-14).
- AC-18: Given a link already used, Then the invalid state appears (verifies FR-18, FR-14).
- AC-19: Given Set new password opened without `token_hash`, Then the invalid state is shown immediately (verifies FR-14).
- AC-20: Given offline on submit, Then `errors.network` in the form, values kept, invalid state not shown (verifies FR-14).
- AC-21: Given a signed-in user completes a reset from a link, Then on success the local session ends immediately (secure storage cleared) and "Log in" on Password updated opens Log in rather than redirecting to the Library (verifies FR-13, FR-16, FR-17).
- AC-22: Given Password updated, Then swipe-back to the reset form is not possible (verifies FR-16).
- AC-23: Given Check your inbox in EN and RU, Then the text uses `checkInbox.validity` with a duration equal to the Supabase recovery-link expiration setting, the old minute-based keys are removed, no duration is hard-coded in source, and a link used after the stated period is invalid (verifies FR-9).
- AC-24: Given the reset flow, When logs and analytics are inspected, Then no `token_hash` or email appears (verifies NFR-1).
- AC-25: Given the web route after reading the token, Then the `token_hash` is not in the current history entry's URL (verifies FR-19).
- AC-26: Given the user is signed in on device B, When a reset is completed on device A, Then device B's session refresh fails and its API calls are rejected, and it returns to Welcome within 60 minutes (verifies NFR-7, FR-13).
- AC-27: Given a verification email link (if the verification mechanism is available per 02), When opened with the app installed / not installed, Then the app or web `/verify-email` redeems it and shows success; an expired link shows the invalid state (verifies FR-20).
- AC-28: Given the Forgot password screen is opened in EN and RU, Then the lock icon, title, subtitle, Email field, "Send reset link" button and back button are present (verifies FR-1).
- AC-29: Given a valid email is submitted, While the request runs, Then the button shows its loading state, the Email field is not editable, and a second tap on the button or Enter sends no second request (exactly one `resetPasswordForEmail` request is observed) (verifies FR-5).
- AC-30: Given Supabase rejects the new password as weak or same as the old (simulated), When "Update password" is submitted, Then `errors.generic` is shown in the form and the link is not shown as invalid (verifies FR-15).
- AC-31: Given Supabase answers 429 to the reset request, Then `errors.tooManyRequests` is shown under the button (verifies FR-6).
- AC-32: Given `verifyOtp` succeeded and `updateUser` fails offline, When the user submits again online, Then only `updateUser` is sent, the token is not redeemed twice, and Password updated is shown (verifies FR-21).
- AC-33: Given a recovery in progress on a signed-out device, Then the app never shows the Library or the signed-in redirect before Password updated (verifies FR-17).

## App integration notes
Replace `requestPasswordReset({ email })` and `resetPassword({ token, newPassword })` in `src/services/auth.ts` (new input `{ tokenHash, newPassword }`). Rename the route parameter `token` to `token_hash` (plus `type`) in `src/app/set-new-password.tsx` and the documented deep link from `praxisapp://set-new-password?token=` to the universal/app link form (the `praxisapp` scheme in `app.json` may stay as a fallback). Screens `forgot-password.tsx`, `check-inbox.tsx`, `password-updated.tsx` keep their code; `VALIDITY_MINUTES` / `checkInbox.validity_*` in `check-inbox.tsx` and the locale files are replaced per FR-9; add a `verify-email` route (FR-20). Remove mock magic values (`expired` token, `offline@example.com`).

**Decided assumptions:** the recovery token is redeemed on submit (and a missing token shows the invalid state at once), not on open; the email is passed to Check your inbox as a route parameter.

## Design additions needed (not in `docs/screens/`)
- Check your inbox: the validity line shows the configured duration, not necessarily "30 minutes" (`check_your_inbox.png` shows an example), EN and RU.
- Verify email landing screen (success and invalid/expired states), EN and RU.

## Open questions
None beyond the external items under "Prerequisites and external questions".

## Prerequisites and external questions
(Prerequisites are not yet provided and must not be invented.)
- Action domain for reset/verification links, with `apple-app-site-association` and `assetlinks.json` hosting.
- Custom SMTP sender address/domain with SPF/DKIM/DMARC, and EN/RU reset (and verification) email copy and branding.
- The configured recovery-link lifetime value (a project setting to be chosen) and the final RU/EN formatting of the duration in `checkInbox.validity`.
- Verify at implementation: that `verifyOtp` with `type: 'recovery'` and `token_hash` works from the client SDK for a link opened on a different device than the request (the PKCE alternative needs the same device), that an expired or used token yields `otp_expired`, and the Supabase recovery-link lifetime setting name, default and limits.
- Verify at implementation: that `signOut({ scope: 'global' })` revokes all refresh tokens of the user, and whether a password change by `updateUser` also ends other sessions by itself (project setting).
- Verify at implementation: how the email language is chosen (separate templates per language are not confirmed as a Supabase feature; options are one bilingual template, per-user metadata, or a Send Email hook).
- Verify at implementation: whether an earlier recovery link stays valid after a resend, the minimum interval Supabase enforces between reset emails per address, and `setNewPassword.invalidBody` wording ("work once").
