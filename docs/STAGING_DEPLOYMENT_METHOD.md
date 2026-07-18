# Staging deployment method

## Purpose and boundary

This is the provider-neutral release path for the Nourish API and background worker. The same locked container image runs the API, worker, configuration check, and one-time migration command. PostgreSQL migrations are a separate release step; production startup cannot silently migrate or fall back to memory.

`compose.staging.yml` is a staging harness, not the final production topology. API and worker use the same private S3-compatible bucket and can therefore run as separate services without a shared filesystem. Production still requires approved bucket access policy, encryption, lifecycle/backup-expiry validation, expiring delivery, and downstream deletion handling.

## What startup now guarantees

With `NODE_ENV=production`, API and worker startup fails before accepting work unless:

- durable `DATABASE_URL` is present and `DATABASE_REQUIRE_TLS=true`;
- automatic production migrations are disabled;
- authenticated application-level encryption over private S3-compatible object storage is configured, with optional provider encryption as a second layer, or a staging-only filesystem exception is explicitly acknowledged;
- eligible planner locales and current nutrition-calculation versions are explicitly allowlisted;
- the development `NOURISH_ADMIN_KEY` is absent; and
- ports, connection-pool bounds, and analytics retention are valid.

Development magic-link tokens are never printed in production. The configuration check returns only booleans and non-secret runtime metadata.

## Prerequisites

Before creating a staging release:

1. Provision an isolated managed PostgreSQL database with TLS, encryption at rest, automated backups, point-in-time recovery, and a tested restore path.
2. Restrict database network access to the migration job, API, worker, and approved operators.
3. Create a private S3-compatible bucket with public access blocked, TLS-only access, least-privilege API/worker identity, access logging, and a documented region. API and worker must use the same bucket and prefix. Application-level AES-256-GCM encryption is mandatory; enable compatible provider encryption as defense in depth when available.
4. Create secret-manager entries for the database URL, the named application-encryption key ring, and, when workload identity is unavailable, standard AWS SDK credentials. Do not commit `.env.staging`, encryption keys, or static credentials.
5. Select the reviewed catalogue locale and exact current nutrition-calculation version. They must match published recipe snapshots.
6. Enable structured log capture, uptime checks for `/healthz` and `/readyz`, and alerts for API/worker restarts, readiness failure, dead jobs, and database saturation.
7. Configure lifecycle/backup handling so it does not undermine Nourish's explicit 24-hour administrator-export and seven-day customer-export deletion process. Validate physical and replicated-copy expiry with the selected provider.

## Build and configuration check

Copy `backend/.env.staging.example` to the ignored `backend/.env.staging`, then replace every `CHANGE_ME` through the deployment secret mechanism. Build the image from `backend/Dockerfile`; `package-lock.json` fixes the complete Node dependency graph.

The locked production dependency graph passed a reproducibility dry run and reported zero known npm vulnerabilities on 2026-07-18. Repeat the audit in CI for every release; this point-in-time result is not a substitute for continuous dependency scanning, code review, secret scanning, or signed images.

Run both non-secret configuration checks against the release image:

```sh
docker compose -f compose.staging.yml run --rm -e NOURISH_PROCESS_TYPE=api api node src/config-check-cli.mjs
docker compose -f compose.staging.yml run --rm -e NOURISH_PROCESS_TYPE=worker worker node src/config-check-cli.mjs
```

Each command must return a single JSON line with `status: "ok"`, durable database and S3 private storage configured, TLS required, and automatic migrations false. It never returns the database URL, bucket name, endpoint, key identifier, or credentials.

## Release order

1. Record the image identifier and retain the previously healthy image for application rollback.
2. Confirm a recent database backup and point-in-time recovery window.
3. Run the checksum-verified migration job once:

   ```sh
   docker compose -f compose.staging.yml --profile release run --rm migrate
   ```

4. Start or roll the API, then wait for `/readyz` to confirm PostgreSQL.
5. Start or roll the worker with a graceful termination window long enough to release leased jobs.
6. Run the automated smoke check from outside the service network:

   ```sh
   NOURISH_STAGING_BASE_URL=https://staging-api.example.com npm run staging:smoke
   ```

7. Verify a controlled export writes to the private bucket, can be delivered only through its authorized API boundary, and is physically deleted by the retention worker. Confirm bucket access logs contain no object content or credentials.
8. Verify a controlled background job reaches a terminal state and that retry/lease evidence appears in the Control Room.
9. Only after production email or Apple identity verification is configured, run the authenticated onboarding/profile/plan journey. Do not treat health/readiness alone as user-journey approval.

## Smoke contract

`npm run staging:smoke` checks both endpoints over the configured public base URL:

- `/healthz` must return HTTP 200 and `status: "ok"`;
- `/readyz` must return HTTP 200, `status: "ready"`, a healthy persistence dependency, and a current checksum-verified schema;
- both responses must be JSON, non-cacheable, and correlation identified.

This confirms process and database readiness only. It does not validate licensed content, authentication delivery, Apple services, jobs, backups, accessibility, or product correctness.

## Rollback and recovery

- If startup or smoke checks fail before traffic, stop the new API/worker and restore the prior image.
- Database migrations are forward-only and checksum protected. Never edit an applied migration or attempt an ad-hoc reverse migration. If a schema change causes failure, deploy a reviewed forward repair migration or restore into an isolated recovery database before deciding on point-in-time recovery.
- Stop workers before database recovery so leased jobs cannot write to a recovering database.
- After any restore, run migrations, `/readyz`, the smoke check, a controlled job, and reconciliation checks before reopening traffic.
- Record the correlation IDs, image identifier, migration output, decision owner, timing, and recovery evidence in the incident record.

## Gates still blocking production

The DigitalOcean-specific, still non-provisioning specialization is documented in `DIGITALOCEAN_STAGING_METHOD.md` and `.do/app.staging.yaml`. The staging foundation does not make the full product production-ready. The following remain release blockers:

- production email delivery and distributed abuse controls, or a configured server-side Sign in with Apple verifier;
- selected workforce identity provider, company sign-in UI, MFA assertion verification, provisioning operations, and alerting;
- licensed and qualified-reviewed recipe/nutrient content at launch scale;
- production bucket policy/workload identity, expiring delivery, physical and backup deletion validation;
- live Apple products, credentials, notification delivery, and sandbox lifecycle evidence;
- live PostgreSQL migration, concurrency, failover, restore, and performance validation;
- monitoring vendor, structured telemetry, alert thresholds, incident ownership, and on-call runbooks;
- approved calorie estimator, policies, legal/support destinations, translations, device accessibility review, and beta acceptance thresholds.

Until those gates are closed, staging is an engineering validation environment and must not receive public production traffic.
