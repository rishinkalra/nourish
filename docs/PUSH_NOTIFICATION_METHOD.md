# Push notification method

## Current scope

The first server-originated notification is `plan_ready`. It is sent only after the durable worker has materialized a complete reviewed seven-day plan. The notification opens `nourish://open/plan`, which routes to Plan Studio so the user can review and explicitly adopt the plan.

Local shopping, prep, meal, weekly-review, and next-plan reminders remain device-scheduled. Trial-ending and operational export/deletion/security messages remain future templates.

## Device registration

- iOS asks for notification permission only through the existing reminder controls.
- After permission is granted, the app registers with APNs and receives the device-specific token.
- The token type redacts its description and debug description.
- The app sends it only over the authenticated `POST /v1/push-registrations` route.
- The server derives the user from the bearer session; the client cannot select a user ID or bundle topic.
- Re-registering the same app/environment token moves it to the current authenticated account, preventing notifications from following a previous account on a shared device.
- Sign-out calls `DELETE /v1/push-registrations` before revoking the session.
- Account deletion cascades every saved device registration.

The durable table uses only a SHA-256 token value for lookup and uniqueness. The retrievable APNs token is never returned by an API, exposed to administration, included in analytics, or written to logs. Managed PostgreSQL encryption-at-rest and transport TLS remain deployment requirements.

## Delivery

Successful plan materialization and notification enqueue occur in the same PostgreSQL transaction. Notification work is independent from the authoritative plan job, so an Apple outage cannot turn a valid plan into a failed plan.

The leased worker sends an HTTP/2 alert using APNs token authentication:

- sandbox registrations use `api.sandbox.push.apple.com`;
- production registrations use `api.push.apple.com`;
- the configured bundle ID is the APNs topic;
- the payload contains only display copy, a template ID, and the Plan Studio deep-link;
- `apns-collapse-id` is stable per plan job to reduce duplicate alerts during retries;
- APNs invalid-token responses deactivate the registration;
- retryable Apple failures use the existing bounded leased-job retry behavior.

APNs delivery is disabled unless `NOURISH_APNS_ENABLED=true`. When enabled, the worker fails closed unless team ID, key ID, private `.p8` key, and bundle topic are valid. Signing credentials belong only on the worker.

## Remaining live validation

The ordinary Debug configuration intentionally has no `aps-environment` entitlement so a Personal Development Team can continue to install and test the local app. `NourishApp.Debug.entitlements` remains the explicit development-push entitlement and `NourishApp.Release.entitlements` remains the required production entitlement. A sandbox-capable paid-team build can select the development entitlement with the Xcode build-setting override `CODE_SIGN_ENTITLEMENTS=NourishApp/NourishApp.Debug.entitlements`.

1. Obtain approval to use an Apple Developer Program team where the user has Certificates, Identifiers & Profiles access.
2. Enable Push Notifications for the `com.projectnourish.app` App ID and regenerate the development/distribution signing profiles.
3. Create a restricted APNs signing key and store it as a worker-only staging secret.
4. Build with the development-push entitlement, install on a physical device, and grant notification permission.
5. Confirm registration, background plan generation, one collapsed alert, foreground presentation, and Plan Studio routing.
6. Sign out, authenticate as a different account on the same phone, and confirm the prior account cannot notify that token.
7. Exercise invalid-token retirement and retry behavior against staging logs and database evidence without logging raw tokens.
