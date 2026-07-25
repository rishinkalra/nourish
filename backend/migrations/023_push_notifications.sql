BEGIN;

ALTER TABLE background_jobs
    DROP CONSTRAINT background_jobs_job_type_check;

ALTER TABLE background_jobs
    ADD CONSTRAINT background_jobs_job_type_check CHECK (job_type IN (
        'plan.generate', 'account.export', 'account.delete', 'entitlement.reconcile',
        'notification.plan-ready'
    ));

CREATE TABLE push_device_registrations (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_sha256 char(64) NOT NULL,
    device_token text NOT NULL,
    environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
    app_bundle_id text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    last_registered_at timestamptz NOT NULL,
    deactivated_at timestamptz,
    deactivation_reason text,
    UNIQUE (token_sha256, environment, app_bundle_id),
    CHECK (token_sha256 = lower(token_sha256)),
    CHECK (device_token = lower(device_token)),
    CHECK (device_token ~ '^[0-9a-f]+$'),
    CHECK (length(device_token) BETWEEN 32 AND 512),
    CHECK (length(device_token) % 2 = 0),
    CHECK (app_bundle_id ~ '^[A-Za-z0-9][A-Za-z0-9.-]{2,254}$'),
    CHECK ((active AND deactivated_at IS NULL AND deactivation_reason IS NULL)
        OR (NOT active AND deactivated_at IS NOT NULL))
);

CREATE INDEX push_device_registrations_user_active_idx
    ON push_device_registrations (user_id, last_registered_at DESC)
    WHERE active;

COMMIT;
