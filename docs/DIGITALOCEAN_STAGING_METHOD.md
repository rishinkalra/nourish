# DigitalOcean staging method

## Intended topology

`.do/app.staging.yaml` is a fail-closed template for a Bangalore staging deployment. It defines one public API component, one background worker, one pre-deploy migration job, and a binding to an existing managed PostgreSQL cluster. It does not create or submit anything by itself.

Use these regional placements:

- App Platform: `blr`;
- managed PostgreSQL: `BLR1`, attached to the app as a trusted source; and
- Spaces Standard Storage: `BLR1`, private and without CDN.

The template uses the managed database's private bindable URL, runs checksum-verified migrations before a deployment becomes live, checks `/readyz` for release health, checks `/healthz` for process liveness, and gives the worker time to release leased work on termination.

## Required manual replacements

The checked-in file remains a secret-free template. `npm run digitalocean:preflight` renders every `CHANGE_ME` value from environment input, validates the production API and worker configuration, and prints only a non-secret summary. Supply:

1. `NOURISH_DO_GITHUB_REPOSITORY`: GitHub `owner/repository` for all components.
2. `NOURISH_DO_POSTGRES_CLUSTER`: existing managed PostgreSQL cluster name.
3. `NOURISH_DO_SPACE_NAME`: private Spaces bucket name.
4. `NOURISH_DO_NUTRITION_VERSION`: exact reviewed nutrition-calculation version.
5. `NOURISH_DO_CONTROL_ROOM_ORIGIN`: HTTPS Control Room staging origin.
6. `NOURISH_DO_ENCRYPTION_ACTIVE_KEY_ID` and `NOURISH_DO_ENCRYPTION_KEYS`: active ID and one-line JSON key ring.
7. `NOURISH_DO_API_SPACES_ACCESS_KEY_ID` / `NOURISH_DO_API_SPACES_SECRET_ACCESS_KEY`: bucket-read API identity.
8. `NOURISH_DO_WORKER_SPACES_ACCESS_KEY_ID` / `NOURISH_DO_WORKER_SPACES_SECRET_ACCESS_KEY`: distinct bucket-read/write/delete worker identity.

The checked-in staging template keeps APNs delivery disabled until Apple configuration is ready. To validate plan-ready delivery, add `NOURISH_APNS_TEAM_ID`, `NOURISH_APNS_KEY_ID`, and the `.p8` value as worker-only secrets, then change the worker's `NOURISH_APNS_ENABLED` to `true`. Keep `NOURISH_APNS_BUNDLE_ID=com.projectnourish.app`. Never attach the APNs signing key to the public API component.

Generate a new 256-bit application key using `openssl rand -base64 32`. Supply a one-line secret such as `{"staging-2026-07":"<base64 value>"}`; never commit the value. The renderer applies the identical key ring and active key ID to the API and worker. By default it validates entirely in memory. When a file is needed for DigitalOcean validation, pass `--output /private/tmp/nourish-staging.yaml`; it refuses to write secret-bearing output inside the project and creates the external file with owner-only permissions. Remove that temporary file immediately after submission.

## Spaces controls

Create a Standard Storage Space in `BLR1`. Keep file listing private, do not enable the CDN, and do not make any object public. Create separate limited access keys:

- API key: read access to this bucket only;
- worker key: read/write/delete access to this bucket only.

The AWS SDK compatibility configuration is intentionally `region=us-east-1`, endpoint `https://blr1.digitaloceanspaces.com`, virtual-hosted addressing, and provider SSE `none`. DigitalOcean uses the endpoint to select the actual storage region. Nourish encrypts every private object before upload with AES-256-GCM, authenticating both ciphertext and the exact object key.

Do not enable bucket versioning for staging until version-aware privacy deletion is implemented and verified. With versioning enabled, a normal delete can leave older object versions behind. Configure access logs into a separate restricted logging bucket, and ensure lifecycle rules never retain customer exports beyond the documented deletion contract.

## Database controls

Provision managed PostgreSQL separately rather than an App Platform development database. Require TLS, backups, point-in-time recovery, and an app trusted-source rule. Before use, perform an isolated restore drill and capture the evidence. The migration job uses `${nourish-postgres.DATABASE_PRIVATE_URL}` and must be the only mechanism that mutates schema during deployment.

## Pre-submission gates

Before allowing any billable submission, run `scripts/verify_release_candidate.sh --staging` from the project root. It executes the complete local release gate and the non-secret DigitalOcean preflight. Then:

1. Confirm the release gate and preflight succeed; the in-memory rendered spec must contain no unresolved placeholder.
2. Confirm the target is the staging DigitalOcean team and project.
3. Write a temporary rendered spec outside the workspace and validate it in DigitalOcean without creating the app.
4. Confirm both Spaces keys are limited to the one staging bucket.
5. Confirm the encryption JSON contains a valid base64-encoded 32-byte key and is marked secret.
6. Confirm the database backup and restore evidence is current.
7. Review the estimated monthly cost and billing alerts with the account owner.

## First deployment sequence

1. Submit the reviewed spec with automatic deployment disabled.
2. Confirm the pre-deploy migration succeeds.
3. Confirm the API passes `/readyz` and `/healthz` and the worker remains stable.
4. Run `npm run staging:smoke` from outside DigitalOcean.
5. Create a controlled customer export and administrator export; verify stored bytes contain no plaintext, authorized delivery works, and retention cleanup deletes the exact objects.
6. Run a controlled plan job and confirm terminal state, retry evidence, and Control Room visibility.
7. Point a non-production iOS build at the staging API and complete authentication, onboarding, plan generation, adoption, swap, groceries, prep, feedback, export, and deletion acceptance journeys.
8. With APNs enabled, grant notification permission on a physical sandbox device, generate a plan while the app is not foregrounded, verify one collapsed plan-ready alert opens Plan Studio, then sign out and confirm the former account receives no later notification.

## Rotation and recovery

To rotate application encryption, add a new named key to the JSON ring and change the active key ID in the same API/worker deployment. New writes use the new key; retained older keys continue to decrypt existing objects. Remove an old key only after every object and any authorized replica using it has expired or been deleted and that absence has been verified.

If an application key is lost, provider access alone cannot recover the encrypted objects. Keep encrypted, access-controlled recovery copies of the key material outside the application environment, with documented custodians and a tested recovery procedure. Never log the key ring, decrypted exports, Spaces secrets, or database URL.
