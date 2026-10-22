# 01 Firebase project setup

- **Milestone:** Sign-up & Log-in
- **Screens covered:** none (foundation for all auth screens)
- **Depends on:** none
- **Type:** BE (platform configuration, no code)

## Description
Creates and configures the Firebase project(s) that the Praxis app and API authenticate against: email/password sign-in only, EU data location, authorized domains. The API verifies tokens of this project (backend/signup-login/06); the app connects to it (app/signup-login/01). This task produces the project identifiers and the web config values both sides need.

## Scope
**In scope:** development and production Firebase projects, the Email/Password provider, EU data location, authorized domains, password policy, token lifetime facts the API relies on, handing over the web config values.
**Out of scope:** the reset email template and action domain (backend/signup-login/05), social providers, email verification, client code, API code.

## APIs
None. Firebase console / Identity Platform configuration only.

## Functional requirements
- FR-1: The Firebase project shall be configured as follows: Email/Password provider enabled (email verification is not required or offered), anonymous sign-in disabled, the app's web origin on the authorized domains list, and Firebase "email enumeration protection" off (sign-up reports `auth/email-already-in-use`, app/signup-login/02 NFR-6). The minimum password length is enforced client-side (8) plus Firebase's own policy. ID tokens live 1 hour (fixed by Firebase), which satisfies the 60-minute revocation window of backend/signup-login/06 NFR-2.
- FR-2: The Firebase project shall use an EU data location (binding, GDPR). Firebase Auth region selection requires upgrading to Identity Platform (open item below).
- FR-3: Separate development and production projects shall exist; production keys are not usable from development builds.
- FR-4: The public Firebase web config (API key, auth domain, project id, app id) per environment shall be handed to the app team as build configuration. No service-account key is placed in the app or its build configuration; the API's service-account credential, if one is needed, is held only by the backend.

## Non-functional requirements
- NFR-1: A disabled user, or a user whose password was reset elsewhere, loses API access within 60 minutes (refresh tokens are revoked by Firebase on password reset and disabling).

## Acceptance criteria
- AC-1: Given the Firebase console, When settings are reviewed, Then Email/Password is enabled, anonymous sign-in is off, enumeration protection is off, the web origin is an authorized domain and the project data location is in the EU (verifies FR-1, FR-2).
- AC-2: Given the development and production projects, When their configs are compared, Then they differ and the production config is not present in development build configuration (verifies FR-3).
- AC-3: Given the repository and build configuration, When searched, Then only the public Firebase web config exists client-side and no service-account key (verifies FR-4).
- AC-4: Given a user disabled in the console, When the user's ID token expires and refresh is attempted, Then refresh fails with `auth/user-disabled` within 60 minutes (verifies NFR-1).

## Open questions
- Prerequisites not yet provided (do not invent): project owners and plan, the EU data location choice (and whether the Identity Platform upgrade is accepted), the web origin.
