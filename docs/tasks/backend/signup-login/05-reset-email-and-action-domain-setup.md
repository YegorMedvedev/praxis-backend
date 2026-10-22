# 05 Reset email and action domain setup

> **Amended by product owner:** reset emails are sent by **Resend**, not by Firebase's built-in mailer. Read "Firebase template" below as "Resend email built by the backend": the EN/RU content, sender/domain authentication (SPF, DKIM, DMARC on the Resend-verified domain) and the `<web origin>/auth-action` link requirements still apply. The Firebase console template and Firebase-default-sender statements do not. Config is in `AGENTS.md` ("Password reset configuration"). This task now includes code (a mailer port with a Resend adapter, plus a fake for tests).

- **Milestone:** Sign-up & Log-in
- **Screens covered:** none (the emailed link opens the screens in app/signup-login/05)
- **Depends on:** backend/signup-login/01 (Firebase project)
- **Type:** BE (platform configuration, no code)

## Description
Configures the Firebase Auth password-reset email so the app's reset flow (app/signup-login/05) works end to end: EN and RU template content, a verified sender domain, and the custom action URL `<web origin>/auth-action` that the emailed link points to. The app sets the request language (`languageCode`); this task owns everything on the Firebase side.

## Scope
**In scope:** reset email template (EN, RU), sender address and domain authentication, custom action URL, authorized domain.
**Out of scope:** the app screens and routing of the link (app/signup-login/05), verification and other email templates (not offered), hosting of the web app and of `apple-app-site-association` / `assetlinks.json` (app deployment).

## APIs
None. Firebase console / Identity Platform configuration only.

## Functional requirements
- FR-1: The password-reset template shall exist in English and Russian with Praxis-branded subject and body, containing a single link built from the custom action URL `<web origin>/auth-action` (carrying `mode=resetPassword`, `oobCode` and `lang`), and shall not include the user's password or any personal data other than the recipient address. Cyrillic shall render correctly.
- FR-2: The custom action URL shall be set to `<web origin>/auth-action`, and the web origin shall be on the Firebase authorized domains list.
- FR-3: The email shall be sent from a Praxis sender address on a domain with SPF, DKIM and DMARC alignment. The Firebase default sender is acceptable for development only.
- FR-4: The reset link lifetime is fixed by Firebase at 1 hour; the app copy constant is 60 minutes (app/signup-login/05 FR-9). No change is made here.

## Non-functional requirements
- NFR-1: The reset email arrives within 60 s at p95.
- NFR-2: Separate development and production configurations exist; production sender and action domain are not used in development.

## Acceptance criteria
- AC-1: Given a reset requested with `languageCode` `en` and with `ru`, Then the received email is in that language with a working link to `<web origin>/auth-action?mode=resetPassword&oobCode=...` (verifies FR-1, FR-2).
- AC-2: Given the email headers of a production send, Then SPF, DKIM and DMARC pass (verifies FR-3).
- AC-3: Given the Firebase console, When reviewed, Then the custom action URL and authorized domain are set as in FR-2 (verifies FR-2).
- AC-4: Given 20 reset sends to a test mailbox, Then at least 19 arrive within 60 s (verifies NFR-1).

## Open questions
- Prerequisites not yet provided (do not invent): the web origin, the sender address and domain, final EN/RU email copy and branding, the Firebase environments.
- Verify at implementation: that the email language follows the Auth `languageCode` against the console template language, whether an earlier reset link stays valid after a resend, and the minimum interval Firebase enforces between reset emails per address.
