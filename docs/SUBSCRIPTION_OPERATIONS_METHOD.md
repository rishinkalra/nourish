# Subscription operations method

## Purpose and access boundary

The private Control Room helps an operator diagnose Apple subscription reconciliation without impersonating a user or manually granting or revoking access. Every list, detail, and action route requires the `operator` role; the existing explicit security-administrator override still applies.

## Case projection

Each case combines the last server-owned entitlement and access decision with product, environment, renewal, verification, reconciliation, error, and durable-job state. The timeline orders verified App Store events, notification ingress, reconciliation jobs, and operator actions so an investigator can distinguish what Apple reported from what Nourish processed.

Complete original transaction identifiers and source-event identifiers are replaced by a suffix plus SHA-256 prefix. The app-account token is returned only as SHA-256. Signed payloads, certificates, private keys, purchase credentials, and raw notification bodies are never selected or returned.

## Safe resolution action

Only `delayed` and `mismatch` cases may be queued manually. A specific 10–500 character reason and operator/correlation identity are required. PostgreSQL mode locks the subscription, changes only the reconciliation status and due time, inserts a leased `entitlement.reconcile` job, and appends immutable operation evidence in one transaction.

The action cannot write the subscription state or access decision. The last legitimate access decision remains intact until the existing Apple verifier produces a matching signed result. Pending and current cases reject duplicate or unnecessary operator retries.

## Verification and remaining gates

Executable checks cover operator authorization, list/detail projection, attention filtering, Apple/server/job timelines, identifier minimization, preserved access, reason validation, duplicate-pending rejection, and transactional job plus append-only audit creation. The responsive dashboard supplies realistic current, pending, delayed, and mismatch states.

Production still requires migration validation against managed PostgreSQL, workforce identity-provider configuration, real App Store sandbox notification/status fixtures, centralized alert links, and an agreed operational retention policy.
