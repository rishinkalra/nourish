# Feature-flag method

## Purpose and authority

Feature flags provide a server-owned way to stage or stop product behavior without publishing a new binary. The Control Room limits flag visibility and mutation to `security_admin`; the existing local development key can exercise the workflow only in the private local environment.

## Evaluation contract

Authenticated `GET /v1/feature-flags?appVersion={semanticVersion}` evaluates every configured flag for the current internal user. A response includes the stable flag key, boolean decision, value only when enabled, configuration version, decision reason, evaluation time, and contract version.

The order is fixed:

1. Emergency disable always returns off.
2. A normally disabled flag returns off.
3. Minimum and maximum semantic app-version bounds are enforced.
4. An exact internal-user allowlist entry returns on.
5. Everyone else is evaluated against the percentage rollout.

An allowlist bypasses percentage only. It never bypasses emergency disable or app-version boundaries.

## Stable percentage rollout

The service computes SHA-256 over `flag-key:internal-user-id`, converts the first 32 bits into one of 10,000 buckets, and expresses the result from `0.00` to `99.99`. A user is included when that stable bucket is below the configured whole-number percentage. This avoids request-to-request flicker and does not require storing an assignment row.

## Configuration and concurrency

`POST /admin/v1/flags` creates or updates a flag with:

- a stable lowercase key and human-readable description;
- enabled and emergency-disabled states;
- a whole-number rollout from 0 to 100;
- optional minimum and maximum semantic app versions;
- at most 500 bounded internal user IDs;
- a JSON value smaller than 16 KB; and
- a required 12–500 character reason.

Updates require `expectedVersion`. The PostgreSQL transaction locks the current row, rejects a stale version with `CONFLICT`, writes the next version, and appends the audit receipt before commit. Flag keys are immutable through the Control Room editor.

## Audit and emergency behavior

Audit entries distinguish `created`, `updated`, `emergency_disabled`, and `emergency_restored`. Each stores the flag/version, accountable actor, reason, before/after SHA-256 evidence, correlation ID, and timestamp. The database blocks audit update or deletion with an append-only trigger.

Emergency disable is data, not a separate client convention: it is evaluated first on the server and causes the client value to be withheld. Restoring from an emergency creates another explicit version and receipt.

## Native bootstrap and safe fallback

After authentication, the iOS app requests the evaluated contract with its installed marketing version. It refreshes again whenever the app becomes active. Decisions are scoped to the authenticated internal user and only compiled keys can affect UI behavior; unknown server keys are ignored.

The protected cache is partitioned by a SHA-256 user reference and exact app version. It uses iOS complete-until-first-unlock file protection and is accepted for at most 15 minutes. A missing, stale, future-dated, cross-user, cross-version, unsupported-contract, duplicated, or invalid-version decision resolves to the compiled default, which is off. An `emergency_disabled` reason also forces off defensively even if an inconsistent payload says enabled. Signing out clears all in-memory decisions before another account can enter.

The first consumed key is `weekly_insights`. When enabled, the reviewed active-week screen adds a completion/planned-meal/intentional-leftover summary. The existing experience is unchanged when the flag is absent or unavailable.

## Verification

Controlled-data checks cover allowlist/version ordering, deterministic buckets, 0% rollout, emergency precedence, optimistic-write conflicts, reasoned audit, security-admin route authorization, authenticated HTTP evaluation, and transactional PostgreSQL save/audit. Native checks cover compiled-off defaults, emergency fail-closed handling, duplicate rejection, cache TTL, user/app-version partitioning, and the typed consumer route. Migration guards verify the targeting fields and append-only audit trigger. The complete iOS application target compiles successfully for the iPhone Simulator.

## Remaining production validation

- Run migration, concurrent-edit, and cache-propagation tests against managed PostgreSQL.
- Add refresh success/failure/age observability without logging user identity or flag values.
- Validate the maximum emergency-propagation window against the production caching/CDN design before using flags for release-critical safety behavior.
- Require dual-control review for high-impact flags if the production security policy calls for it.
- Establish flag ownership, expiry dates, stale-flag cleanup, and periodic allowlist review.
