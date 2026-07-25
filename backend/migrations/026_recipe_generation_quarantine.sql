BEGIN;

ALTER TABLE background_jobs
    DROP CONSTRAINT background_jobs_job_type_check;

ALTER TABLE background_jobs
    ADD CONSTRAINT background_jobs_job_type_check CHECK (job_type IN (
        'plan.generate', 'account.export', 'account.delete', 'entitlement.reconcile',
        'notification.plan-ready', 'recipe.generate'
    ));

CREATE TABLE recipe_generation_runs (
    id uuid PRIMARY KEY,
    requested_by text NOT NULL,
    idempotency_key text NOT NULL,
    status text NOT NULL CHECK (status IN ('queued', 'running', 'awaiting_review', 'failed', 'imported', 'discarded')),
    brief_json jsonb NOT NULL,
    output_json jsonb,
    image_object_key text,
    text_model text,
    image_model text,
    prompt_version text,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    UNIQUE (requested_by, idempotency_key),
    CHECK (
        status <> 'awaiting_review'
        OR (
            output_json IS NOT NULL
            AND image_object_key IS NOT NULL
            AND text_model IS NOT NULL
            AND image_model IS NOT NULL
            AND prompt_version IS NOT NULL
            AND completed_at IS NOT NULL
        )
    )
);

CREATE INDEX recipe_generation_runs_review_queue_idx
    ON recipe_generation_runs (created_at DESC)
    WHERE status = 'awaiting_review';

COMMIT;
