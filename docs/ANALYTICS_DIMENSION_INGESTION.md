# Analytics dimension ingestion

## Contract

Authenticated native clients call `POST /v1/analytics/dimensions` after session bootstrap. The request contains only the installed marketing version and a bounded acquisition source. The server derives the account from the bearer session; a client-supplied user identifier is neither required nor trusted.

The response is an idempotent receipt containing the first observed app version, latest observed app version, acquisition source, observation timestamps, and contract version. Repeating the same request is safe.

## Version and attribution rules

The first observed app version is immutable and the latest version advances on later authenticated launches. Versions must use the bounded semantic form accepted by the service.

Acquisition source is a closed taxonomy: `unknown`, `organic`, `app_store_search`, `referral`, or `paid_social`. `unknown` is the honest default. The first recognized non-unknown source wins and cannot be overwritten by later links or requests. The native app captures a source only from an explicit `acquisition_source` app-link parameter whose value is in that taxonomy.

This implementation does not infer attribution from device characteristics. Accurate App Store Search or paid-campaign attribution still requires a separately approved Apple or vendor integration and the privacy review required by the product specification.

## Privacy boundary

The ingestion request excludes email, profile answers, dietary or health fields, meal history, device advertising identifiers, fingerprints, StoreKit evidence, and client-supplied account identity. The stored source is coarse and bounded. Analytics ingestion is non-blocking: a failure never prevents authentication or normal product use.

The owner dashboard remains aggregate-only and continues to suppress small non-empty populations. This dimension record is used only to filter those aggregates; it is not exposed as a user-level analytics export.

## Native lifecycle

After an authenticated session is restored or created, the app submits its installed marketing version and locally held bounded acquisition source. A recognized attributed link is retained as first-touch installation metadata and, when signed in, triggers a best-effort refresh. Sign-out disconnects the in-memory ingestion controller, preventing cross-account completion from applying to a later session.

## Verification and remaining gates

Executable checks cover authentication, server-derived identity, forged user-ID rejection by omission, bounded input validation, first/latest-version behavior, first-known-source behavior, parameterized PostgreSQL upsert logic, database constraints, native link parsing, and exclusion of sensitive request fields. Native checks and Debug/Release simulator builds verify the integrated contract.

Production still requires live managed-PostgreSQL migration/concurrency validation, an approved attribution source if campaign-level accuracy is needed, analytics retention and deletion-policy approval, disclosure review, and reconciliation of aggregate filters against production traffic.
