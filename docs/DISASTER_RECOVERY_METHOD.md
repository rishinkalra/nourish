# Disaster recovery method

## Proposed launch objectives

- PostgreSQL and account/product state: proposed RPO 15 minutes, proposed RTO 4 hours.
- Application image and configuration: proposed RPO 0 (immutable source/image), proposed RTO 1 hour.
- Private exports: recreate when safe; customer exports expire after seven days and administrator exports after 24 hours. Their deletion guarantees must not be weakened by backup retention.
- Generated recipe images and reviewed catalogue media: proposed RPO 24 hours, proposed RTO 8 hours, subject to the final storage provider's versioning and replication policy.

These objectives are intentionally marked proposed. The accountable business/security owner must approve them against customer harm, cost, provider capability, and legal obligations before launch.

## Restore order

1. Declare the incident, freeze deployments, stop workers, record timestamps, correlation IDs, image and schema versions.
2. Restore PostgreSQL into an isolated database at the selected point in time; never overwrite the only available copy first.
3. Verify checksum migrations, row-count/control totals, account boundaries, entitlement snapshots, queued/dead jobs, and catalogue active-version pointers.
4. Restore or reconnect private object storage and verify application-level authenticated decryption, key-ring availability, exact object binding, expiry, and no public access.
5. Deploy the known image, run migrations only if required, then readiness, external smoke, controlled authentication, export/deletion, plan generation, subscription reconciliation, and concurrency checks.
6. Reopen traffic gradually; resume workers only after writes are safe. Record actual recovery point/time and all deviations.

## Executable local rehearsal

`scripts/local-stack restore-test` creates a compressed dump of only `nourish_local`, restores it into the isolated temporary database `nourish_restore_check`, verifies migration and recipe control totals, requires at least migration 028, then always deletes the temporary restore and dump. It refuses no remote target because it executes only inside the fixed local Compose database service.

The local exercise verifies that the current schema is dump/restore compatible. The launch gate remains open until the selected managed provider's encrypted backup, point-in-time restore, failover, access controls, key recovery, object-store recovery/expiry, measured RPO/RTO, and incident communications are exercised and approved.
