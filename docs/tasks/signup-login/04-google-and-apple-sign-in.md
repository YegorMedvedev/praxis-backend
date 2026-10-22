# 04 Google and Apple sign-in

- **Milestone:** Sign-up & Log-in
- **Screens covered:** `sign_up.png` and `log_in.png` (the "or continue with" Google / Apple row)
- **Depends on:** 01, 03, 06
- **Type:** BE + App

## Description
Lets a user sign up or log in with their Google or Apple account through Supabase Auth: Google on iOS, Android and web; Apple on iOS and web (hidden on Android). The same buttons appear on Sign up and Log in and behave identically: an unknown identity creates a new account and profile, a known one logs in, and an identity whose verified email already belongs to a password account is linked to that account. It replaces `mockAuthService.signInWithProvider`.

## Scope
**In scope:** provider flows per platform, first-time profile creation, cancel/failure states, brand assets, loading/locking behaviour.
**Out of scope:** email/password flows (02, 03), unlinking providers, the account deletion flow itself and the Change password screen (account-settings milestone; this feature defines the constraints it relies on, FR-13, FR-14).

## APIs
Uses `GET /me` and `PUT /me` (06). Supabase Auth operations: `signInWithIdToken` with the provider ID token (native Google on iOS/Android, native Apple on iOS), and `signInWithOAuth` (browser redirect) on web; `updateUser` to store the Apple name.

## Functional requirements
- FR-1: Sign up and Log in shall each show a Google button under "or continue with" on iOS, Android and web, and an Apple button on iOS and web only. On Android the Apple button is not rendered and the Google button takes the full row width.
- FR-2: Tapping a button shall start that provider's authentication: on iOS Apple uses the native system sheet; Google uses the native Google flow on iOS and Android and the app passes the resulting ID token to Supabase `signInWithIdToken`; Apple on iOS passes the native Apple ID token the same way; on web both use `signInWithOAuth` (browser redirect, returning to the app's web origin where the session is detected, 01 FR-5).
- FR-3: While a provider flow runs, the tapped button shall show a loading state, the other social button, the form button and all inputs shall be disabled, and repeated taps shall not start a second flow.
- FR-4: If the user cancels or closes the provider UI, the app shall show `errors.socialCancelled` below the social row in the non-error (calm) state, defined objectively as: the notice text uses the muted/ink-muted text colour token, not the `danger` token, and is not exposed with the `alert` accessibility role, keep the form values, and re-enable all controls. No account state changes.
- FR-5: If the provider flow fails because the device is offline show `errors.network`; for `over_request_rate_limit` / 429 show `errors.tooManyRequests`; for a banned account (`user_banned`) show `errors.accountDisabled`; any other failure shows `errors.generic`; all as the social notice, which clears on the next user action.
- FR-6: On success the app shall call `GET /me`. If it returns 404 `profile-not-found`, the app shall complete the profile per 03 FR-8 with the provider-supplied name (Apple: the name from the first authorization; Google: the Google display name) and consent. From Sign up, consent was already accepted (02 FR-14) and is sent directly; from Log in, a new identity gets the consent step of 03 FR-8 before `PUT /me`, and declining deletes the auth account created by the provider sign-in through the backend (`DELETE /me`, 03 FR-16; applies to any user without a profile): the user returns to Welcome and no profile is ever created. If the deletion fails, 03 FR-16 applies (pending marker, retry at next launch or on reconnection). On success the app enters the signed-in state and replaces the route with the Library.
- FR-7: For Apple (native), the app shall save the credential's full name to the user's metadata (`user_metadata.name`, via `updateUser`) immediately after sign-in when Apple provides it at first authorization, because Apple returns it only once and the web OAuth flow does not expose it. For Google the name comes from the Google profile.
- FR-8: When the provider supplies no usable name (fewer than 2 characters after trim), the app shall follow the fallback in 03 FR-8 (required Name field in the consent/complete-profile step).
- FR-9: There shall be one Supabase user per email address, relying on Supabase's automatic linking of identities that share an email. When a Google or Apple sign-in returns an email that already belongs to a password account, the result shall be the same user (same `Me.id`), the existing profile and consent are reused unchanged (no consent step, name not overwritten), and the user lands in the Library. Subsequent email/password log-in with the original password shall continue to work except as described in FR-15.
- FR-13: The auth module shall report the user's sign-in methods so that Change password is hidden for users with no password provider (`hasPasswordProvider`, 01 FR-16) and shown for password users, including social users linked to a password account.
- FR-15: Accepted product behaviours: linking a provider identity to a password account whose email is unconfirmed, where Supabase removes other unconfirmed identities from that user (the account's password may stop working; risk accepted by the product owner); Apple private-relay emails create a separate account; completing forgot-password on a social-only account may add a password sign-in method, after which Change password appears (FR-13).
- FR-14: For Apple users, the backend shall hold the Apple Team ID, key and client identifiers needed to revoke the Apple token at account deletion (never in the client), and the account-settings deletion flow (`DELETE /me`, also for a declined-consent user) shall revoke the Apple token before the auth user is deleted. The way the app obtains the authorization material is not defined by Supabase's documentation and is a verify-at-implementation item.
- FR-10: The native Apple flow shall use a nonce: the hashed nonce is sent to Apple and the raw nonce is passed to Supabase `signInWithIdToken`, to prevent replay. The native Google flow shall pass a nonce if the chosen library supports it (Supabase validates nonces by default; verify at implementation).
- FR-11: The Google and Apple buttons shall use the official provider brand assets and guidelines, replacing the placeholder "G"/"A" marks, with accessible labels `common.continueWithGoogle` / `common.continueWithApple`.
- FR-12: Provider-specific configuration (Google OAuth client IDs per platform, Apple Services ID/Team ID/key, redirect/authorised domains, bundle IDs; values are prerequisites) shall be set in environment configuration, never hard-coded secrets in the client; the Apple signing key and the web client secret live only in the Supabase project / backend.

## Non-functional requirements
- NFR-1: After the provider returns, sign-in plus profile bootstrap completes <= 3 s p95 on 4G.
- NFR-2: No provider tokens (ID tokens, authorization codes, nonce) are logged or persisted outside the Supabase session storage (01 FR-4/FR-5).
- NFR-3 (verified by review, not by an automated test): Compliance with the App Store rule that Sign in with Apple is offered whenever a third-party login is offered on iOS (satisfied by FR-1; Android hides it by product decision).
- NFR-4: Messages exist in `en.json` and `ru.json`; buttons keep touch target >= 44 px and meet provider brand sizing rules.
- NFR-5: GDPR data minimisation: only name and email are read from the provider; no additional scopes (contacts, birthdate, etc.) are requested.

## Acceptance criteria
- AC-1: Given a new Google identity on Sign up, When the user completes Google sign-in, Then a Supabase user and profile exist and the Library is shown (verifies FR-2, FR-6).
- AC-2: Given the same Google identity, When it is used on Log in, Then the same account opens and `PUT /me` is not called (verifies FR-6, FR-9).
- AC-3: Given a new Apple identity on iOS that shares its name, Then the profile name equals that name and `user_metadata.name` was saved right after sign-in (verifies FR-6, FR-7).
- AC-4: Given an Apple identity that hides its email, Then sign-in succeeds with the relay email and (since the relay email matches no existing account) creates a separate account (verifies FR-6, FR-9).
- AC-5: Given the user closes the Google sheet, Then the text of `errors.socialCancelled` (EN and RU) is shown below the social row with the muted text colour token (not `danger`) and without the `alert` role, controls are re-enabled, no session exists (verifies FR-4).
- AC-22: Given the repository and build configuration, When searched, Then Google client IDs, Apple Services ID/Team ID/key references and authorised domains come from environment configuration per environment and none is hard-coded in source (verifies FR-12).
- AC-23: Given an existing unverified password account, When the same email signs in with Google, Then the same `Me.id` results and the app shows no error even if the old password then stops working; given an Apple relay email, Then a separate account is created; given a social-only user completes forgot-password, Then the flow succeeds and `hasPasswordProvider` becomes true if Supabase adds the `email` identity (verifies FR-15).
- AC-6: Given the user cancels the Apple sheet (iOS), Then same as AC-5 (verifies FR-4).
- AC-7: Given offline, When a social button is tapped, Then `errors.network` appears under the social row (verifies FR-5).
- AC-8: Given a provider flow in progress, Then the other buttons and inputs are disabled and a second tap starts nothing (verifies FR-3).
- AC-9: Given web, When Google or Apple is tapped, Then the browser redirects to the provider and back, a session is detected on return, and the user is signed in (verifies FR-2).
- AC-10: Given a Google account whose verified email already has an email/password account, When the user signs in with Google, Then the same `Me.id` and profile are returned, no new profile or consent step occurs, and the user can still log in with the password (verifies FR-9).
- AC-17: Given Android, Then the Apple button is absent on Sign up and Log in and Google fills the row; given iOS and web, both buttons are present (verifies FR-1).
- AC-18: Given a new Google identity on Log in, When provider auth succeeds, Then the consent step appears before `PUT /me`; declining calls `DELETE /me`, the auth user no longer exists (re-signing in with the same Google identity later shows the consent step again as a new account) and no profile exists (verifies FR-6).
- AC-21: Given declining and the `DELETE /me` call fails, Then the pending-deletion marker is set, deletion is retried at next launch, and no `PUT /me` is ever sent (verifies FR-6, 03 FR-16).
- AC-19: Given a social-only user, Then `hasPasswordProvider` is false and Change password is hidden in Account; given a user with a password (including a linked Google user), Then it is shown (verifies FR-13).
- AC-20: Given production, Then the backend holds the Apple key configuration for token revocation and the client build contains none of it (verifies FR-14).
- AC-11: Given the provider returns no name, Then the 03 FR-8 name fallback is applied and no empty profile name is stored (verifies FR-8).
- AC-12: Given a banned Supabase user, Then `errors.accountDisabled` and no session (verifies FR-5).
- AC-13: Given the native Apple request, When inspected, Then a hashed nonce goes to Apple and the raw nonce to `signInWithIdToken` (verifies FR-10).
- AC-14: Given production builds, When buttons are inspected, Then official brand assets are used, not the "G"/"A" placeholders (verifies FR-11).
- AC-15: Given a provider sign-in, When logs are inspected, Then no provider tokens or email appear (verifies NFR-2).
- AC-16: Given requested provider scopes, Then they are limited to name and email (verifies NFR-5).

## App integration notes
Replace `mockAuthService.signInWithProvider(provider)`; keep `SocialProvider = 'google' | 'apple'`, the `social_cancelled` error code, and the `useAuthForm.social` notice tone logic (`calm` for cancellations). Remove mock behaviour (Apple cancels, Google returns `Alex Carter`). Native Google/Apple modules require a development build (01 FR-15); web uses the OAuth redirect.

## Design additions needed (not in `docs/screens/`)
- Sign up / Log in on Android: single full-width Google button.
- Official Google and Apple button artwork (replace placeholder marks).
- Consent step for new social identities on Log in (shared with 03).

## Open questions
None beyond the external items under "Prerequisites and external questions".

## Prerequisites and external questions
(Prerequisites are not yet provided and must not be invented.)
- Apple Developer account, Services ID, Team ID, signing key; Google Cloud OAuth client IDs per platform; web authorised domains (depend on 05's action domain).
- Verify at implementation (fact only): with "Confirm email" disabled, whether password accounts count as confirmed, which decides whether Supabase's unconfirmed-identity removal applies at all.
- Verify at implementation: native Google nonce handling with the chosen library versus Supabase's default nonce validation ("skip nonce check" must stay off unless the product owner approves); the Google client IDs list (web client ID first) and Android SHA-1 fingerprints per build.
- Operational prerequisite: the Apple web OAuth client secret (derived from the Apple key) expires every 6 months. Owner: the product owner. Rotation is manual with a calendar reminder; no automation in the MVP. Native-only Apple needs no OAuth secret.
- Verify at implementation: how Apple token revocation at deletion is done with Supabase (not covered by Supabase's Apple guide) and how the authorization code reaches the backend.
- Verify at implementation: `hasPasswordProvider` from the user's identities after a recovery on a social-only account.
