BEGIN;

ALTER TABLE plan_jobs
    ADD COLUMN profile_revision integer NOT NULL DEFAULT 1 CHECK (profile_revision > 0),
    ADD COLUMN request_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE plan_adoptions
    ADD COLUMN idempotency_key text;

CREATE UNIQUE INDEX plan_adoptions_user_idempotency_idx
    ON plan_adoptions (user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

ALTER TABLE prep_tasks
    ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

COMMIT;
