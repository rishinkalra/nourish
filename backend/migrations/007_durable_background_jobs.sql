BEGIN;

CREATE TABLE background_jobs (
    id UUID PRIMARY KEY,
    job_type TEXT NOT NULL CHECK (job_type IN (
        'plan.generate', 'account.export', 'account.delete', 'entitlement.reconcile'
    )),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    idempotency_key TEXT,
    state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'dead')),
    payload_json JSONB NOT NULL,
    result_json JSONB,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_at TIMESTAMPTZ,
    locked_until TIMESTAMPTZ,
    worker_id TEXT,
    last_error_code TEXT,
    last_error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    UNIQUE (job_type, idempotency_key),
    CHECK ((state = 'running') = (locked_until IS NOT NULL AND worker_id IS NOT NULL))
);

CREATE INDEX background_jobs_claim_idx
    ON background_jobs (available_at, created_at)
    WHERE state = 'queued';

CREATE INDEX background_jobs_expired_lease_idx
    ON background_jobs (locked_until)
    WHERE state = 'running';

CREATE INDEX background_jobs_user_created_idx
    ON background_jobs (user_id, created_at DESC);

COMMIT;
