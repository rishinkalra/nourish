# Export retention and physical deletion

## Retention contract

Administrator CSV exports are downloadable for 24 hours. Customer portable JSON exports are retained for seven days after generation. The API enforces those logical expiry times even if storage cleanup is temporarily delayed.

The durable worker scans both export classes every minute in bounded batches. It selects only expired rows that still reference an object and removes one exact object at a time. Successful cleanup sets the request to `expired`, clears its private object key, records `physically_deleted_at`, and appends system-owned audit evidence.

## Namespace and crash safety

Scheduled expiry cleanup never issues a broad prefix deletion. Administrator keys must exactly match `admin-exports/{export UUID}/export.csv`; customer keys must exactly match `account-exports/{64-character subject hash}/{export UUID}.json`. A malformed or cross-namespace key is rejected before the object store is called. Separate account erasure intentionally uses the validated `account-exports/{subject hash}/` prefix and the S3 adapter paginates every matching object before deletion completes.

Exact deletion is idempotent. If the worker stops after deleting bytes but before committing database evidence, the next scan repeats the same exact-file deletion and completes the conditional update. Concurrent scans cannot create two successful purge receipts because the database update requires the original key to still be present.

## Audit and failure behavior

Administrator cleanup uses the existing append-only export audit with the accountable system actor `system:export-retention`. Customer cleanup uses a separate append-only retention audit. Customer audit links become anonymous if the account and its export request are later erased, so operational evidence cannot block account deletion or retain the customer relationship.

Storage errors leave the object key in place for retry, mark the request logically expired, increment a purge-attempt counter, and store only a controlled failure code. Audit rows never contain object keys, object content, email, internal user ID, or profile/meal data.

## Verification and remaining gates

Executable checks cover exact deletion, customer and administrator retention, parameterized conditional updates, successful and failed audit receipts, corrupt-key rejection before storage access, retryable storage failure, append-only database controls, scheduled execution, and compatibility with account erasure. The full backend regression suite also covers export creation, delivery, authentication, planning, subscriptions, and privacy workers.

Production still requires migration and concurrency validation against managed PostgreSQL and a live private bucket, least-privilege workload identity and bucket policy, KMS and replica/backup-expiry policy, cleanup-failure alerting, approved retention periods, and expiring signed customer delivery/status.
