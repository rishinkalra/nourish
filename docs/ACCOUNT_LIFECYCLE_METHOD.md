# Account and entitlement lifecycle

## Trust boundary

The iOS app never grants subscription access from a local StoreKit result. It can synchronize purchase history and open Apple's subscription-management sheet, but access is rendered from `GET /v1/entitlement`. Device-verified transaction JWS values are sent to the authenticated server for independent verification and app-account-token binding. The server accepts entitlement changes only from that verified transaction boundary, the App Store Server API, or App Store Server Notifications V2. Event IDs are deduplicated.

The official Apple server-library adapter verifies transaction, notification, and renewal JWS values against configured trust roots, bundle/application/environment claims, a subscription product allowlist, and durable account/original-transaction identity before calling the account service. Production Apple credentials, products, App Store Connect delivery, and real sandbox lifecycle fixtures still need configuration and staging validation.

## Entitlement state machine

The server represents active, trial, grace or billing retry, expired, revoked or refunded, upgraded, downgraded, and unknown. Access is allowed for active, trial, grace/billing retry, upgraded, and downgraded states. Unknown defaults to no access and `notConfigured` verification rather than pretending a local StoreKit result is authoritative.

Each verified snapshot records product, environment, renewal/period context, last verification time, next reconciliation time, source event, and reconciliation status. A transient reconciliation failure changes only the reconciliation status and retry time; it deliberately retains the previous state and access. This prevents an outage or missed notification from permanently revoking legitimate access.

## Export

The authenticated export request requires an idempotency key. The iOS store retains that key across an uncertain network response and removes it only after a receipt is confirmed, making retries safe. The current receipt is `queued` and visible in settings. The durable worker assembles a versioned credential-free portable JSON document, writes it through an encrypted S3-compatible private object-store boundary, and assigns a seven-day expiry. Scheduled retention cleanup physically deletes the exact object after expiry and records append-only evidence. Account deletion paginates and removes the complete safe account-export prefix before relational erasure completes. Production still needs approved live bucket policy/workload identity, expiring signed delivery, a visible status/completion channel, and physical/replica retention validation.

## Deletion

Deletion requires an authenticated request, an idempotency key, and the exact `DELETE` acknowledgement. On acceptance, the backend disables the account and revokes every session before returning the queued receipt. The native app then cancels scheduled Nourish notifications, clears protected weekly-loop and profile data, discards retained plan-generation state and Keychain credentials, and restarts onboarding.

The screen explicitly says that deleting the Nourish account does not cancel an App Store subscription; cancellation remains Apple-managed. The durable deletion worker removes prior private exports and transactionally erases user-owned relational history. Production still needs processor-by-processor erasure, approved legal-retention exceptions, downstream completion audit, and visible final status.

## Support and legal boundary

Support diagnostics are off by default and included only after confirmation. They contain app version/build, operating-system version, and build channel—never email, internal user ID, profile answers, meal history, or tokens. In-app legal text is an accurate product summary, not launch-ready counsel copy. Processor list, retention periods, cross-border basis, grievance/support contacts, pricing/trial terms, governing law, and final public URLs remain release decisions.
