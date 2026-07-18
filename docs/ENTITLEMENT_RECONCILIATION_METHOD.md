# Entitlement reconciliation method

## Trust boundary

Nourish never changes access from a device assertion. A subscription can change only from an App Store Server Notifications V2 event or a response from Apple’s App Store Server API after its transaction and renewal JWS values pass Apple certificate-chain, bundle, environment, and application-ID verification.

The durable subscription row retains the Apple original transaction identifier and optional `appAccountToken`. The original transaction identifier is unique across Nourish accounts. Reconciliation accepts a result only when its verified original transaction, environment, and any previously bound app-account token match the saved account.

Apple documents `Get All Subscription Statuses` as the current-status endpoint for auto-renewable subscriptions and returns App Store-signed transaction and renewal information. The implementation uses Apple’s official Node server library for API authentication and signed-data verification:

- https://developer.apple.com/documentation/AppStoreServerAPI/Get-All-Subscription-Statuses
- https://developer.apple.com/documentation/appstoreserverapi/jwstransactiondecodedpayload
- https://github.com/apple/app-store-server-library-node

## Scheduling and execution

The worker scans due sandbox/production subscription rows once per minute when reconciliation is explicitly enabled. A transaction locks due rows with `SKIP LOCKED`, excludes accounts that already have a queued/running reconciliation, and inserts an idempotent leased job keyed by account and saved due time.

The leased handler reloads the subscription identity instead of trusting job payload data, extends its lease before the Apple call, verifies both signed transaction and renewal payloads, selects the strongest current matching status, and applies the normalized event through the existing atomic event/subscription transaction. A repeated Apple event refreshes the next reconciliation time without replaying an older state.

Status mapping follows Apple’s documented subscription status values: active, expired, billing retry, billing grace, and revoked. Nourish groups retry and grace into `graceOrBillingRetry`, which retains access under the existing product policy.

## Notification and transaction ingress

An authenticated `POST /v1/entitlement/app-account-token` creates or returns one durable UUID for the Nourish account. StoreKit purchase code must supply that UUID through Apple's `appAccountToken` purchase option. The restore flow sends only StoreKit-verified transaction JWS values to authenticated `POST /v1/entitlement/transactions`; the server verifies the JWS again and binds it only when its signed app-account token matches the issued account token.

App Store Connect can deliver Version 2 notifications to `POST /v1/app-store/notifications/v2`. The server verifies the outer notification JWS and the nested transaction and renewal JWS values through Apple's official library. It derives environment and subscription identity only from verified payloads and rejects products outside `NOURISH_APP_STORE_PRODUCT_IDS`. Notification UUIDs are idempotent. A durable inbox retains normalized, hash-only verified notifications that cannot yet be matched; no raw signed payload is persisted.

Account deletion cascades through account-token bindings, applied notification inbox rows, and App Store event evidence. A later initial transaction cannot replay older state over a newer already-applied notification.

## Failure behavior

Rate limits, Apple 5xx responses, Apple’s retryable 404 error codes, and retryable verification-network failures retain the last legitimate entitlement, mark reconciliation delayed, and throw back to the leased queue for bounded exponential retry. A verified identity/environment/app-account mismatch is recorded as `mismatch`, preserves the prior access decision, and schedules a later audit rather than silently granting or revoking service.

Configuration failure prevents the reconciliation worker from starting when the feature flag is enabled. Credentials, private signing keys, Apple root certificates, and signed payloads are never written to general logs or background-job payloads.

## Operator reconciliation boundary

Operator-only list and detail endpoints combine the last server access decision with privacy-safe Apple event, notification-ingress, durable-job, and operator-action evidence. Full original transaction identifiers and app-account tokens are reduced to bounded references or SHA-256 values; signed payloads and credentials are never returned.

Only a `delayed` or `mismatch` case can be manually queued for another check. The operator must give a bounded reason. PostgreSQL mode locks the subscription, moves only its reconciliation status to `pending`, enqueues an `entitlement.reconcile` job, and appends operator and correlation evidence in one transaction. This action cannot set the entitlement state or access flag; only a subsequently verified Apple result can do that.

## Deployment configuration

Set `NOURISH_APP_STORE_RECONCILIATION_ENABLED=true` only after configuring:

- `NOURISH_APP_STORE_PRIVATE_KEY_PATH`
- `NOURISH_APP_STORE_KEY_ID`
- `NOURISH_APP_STORE_ISSUER_ID`
- `NOURISH_APP_BUNDLE_ID`
- `NOURISH_APP_APPLE_ID`
- `NOURISH_APPLE_ROOT_CA_PATHS` as comma-separated certificate paths
- `NOURISH_APP_STORE_PRODUCT_IDS` as comma-separated auto-renewable subscription product identifiers

Set `NOURISH_APP_STORE_INGRESS_ENABLED=true` on the API process after the bundle, Apple app ID, root certificates, official package, and allowed product IDs are installed. Reconciliation additionally requires the private key, key ID, and issuer ID.

The workspace has no Apple credentials, App Store products, live PostgreSQL server, or installed npm dependency tree. Executable fakes verify notification/transaction/renewal verifier invocation, product allowlisting, account-token binding, early-notification routing, idempotent replay, scheduling, leasing, status selection, identity matching, retry retention, mismatch handling, and atomic persistence queries. Real sandbox notifications, certificates, credential rotation, live rate limits, App Store Connect delivery/retry, and recovery still require staging validation.
