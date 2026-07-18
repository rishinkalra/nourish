# Authorized admin export method

This slice implements PRD requirement ADM-008 and `POST /admin/v1/exports` without weakening the existing analytics or support boundaries.

## Export classes

- `kpis` and `cohorts` are aggregate exports available to operators. They use the same filters, metric formulas, freshness timestamps, and groups-below-five suppression as the owner-insights APIs.
- `support_account` is a user-level export available only to a security administrator. It accepts exactly one internal user ID or normalized verified email and requires a 12–500 character creation reason.
- The account CSV contains only the minimized support projection: identity/account state, onboarding revision state, entitlement state, high-level planning state, and privacy-request state. Profile answers, meal history, credentials, tokens, raw signed Apple data, and complete Apple identifiers are excluded.

## Creation and delivery

`POST /admin/v1/exports` requires an 8–128 character `idempotency-key`. The service builds the bounded CSV, writes it to the private object-store boundary, persists a ready request with a SHA-256 content digest, and writes a creation audit receipt. A repeated key for the same operator returns the original request.

`GET /admin/v1/exports` lists only aggregate exports, the operator's own requests, or all requests for a security administrator. Public metadata contains a short subject hash reference for account exports, never the private object key or raw lookup value.

`GET /admin/v1/exports/{id}/content` returns `text/csv`, `Cache-Control: no-store`, a controlled attachment filename, and the content digest. Account-level delivery requires a fresh 12–500 character `x-export-access-reason`; this is stored as a separate append-only delivery receipt. CSV cells are quoted and spreadsheet-formula prefixes are neutralized.

## Retention and durability

Every export expires logically 24 hours after creation. Expired requests cannot be downloaded. PostgreSQL migration `019_admin_exports.sql` stores requests and append-only audit receipts. Production CSV bytes are encrypted by Nourish with authenticated application-level encryption before they reach the configured private S3-compatible bucket and carry no-store metadata. Provider-side encryption can be enabled as an additional layer where supported; if private storage or application encryption is not configured, durable export creation fails closed with a temporary-failure response. A local filesystem adapter remains available only for development or an explicitly acknowledged staging exception.

The worker now scans expired administrator and customer exports every minute. It validates the exact protected object namespace, deletes one object rather than a broad prefix, conditionally clears the saved key, and appends `physically_deleted` or `cleanup_failed` evidence under a system actor. Live PostgreSQL/bucket integration, workload identity and bucket policy, encryption/KMS policy, replica/backup expiry, cleanup alerts, approved audit retention, and delivery monitoring remain operational validation work. See `EXPORT_RETENTION_METHOD.md`.

## Verification

`backend/test/admin-export.test.mjs` checks idempotency, aggregate formula retention, role enforcement, exact reasoned account export, minimized fields, hidden object keys, separate delivery reason, audit receipts, and HTTP CSV/no-store/attachment behavior. `backend/test/export-retention.test.mjs` checks physical deletion, namespace confinement, crash-safe conditional evidence, storage failure, migrations, and scheduling. The full backend suite also rechecks all earlier identity, profile, planning, catalogue, subscription, support, and flag behavior.
