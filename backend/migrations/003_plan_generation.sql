BEGIN;

CREATE TYPE plan_job_state AS ENUM ('queued', 'generating', 'succeeded', 'rejected', 'failed');

CREATE TABLE plan_jobs (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idempotency_key text NOT NULL,
    state plan_job_state NOT NULL DEFAULT 'queued',
    week_start date NOT NULL,
    time_zone_identifier text NOT NULL,
    trigger text NOT NULL,
    regeneration_reason text,
    generator_version text NOT NULL,
    scoring_version text NOT NULL,
    rule_version text NOT NULL,
    deterministic_seed_sha256 char(64) NOT NULL,
    candidate_pool_size integer,
    diagnostics_json jsonb,
    error_category text,
    retryable boolean,
    correlation_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    UNIQUE (user_id, idempotency_key)
);

CREATE INDEX plan_jobs_user_created_idx ON plan_jobs (user_id, created_at DESC);
CREATE INDEX plan_jobs_failure_idx ON plan_jobs (error_category, created_at DESC) WHERE state IN ('rejected', 'failed');

CREATE TABLE weekly_plans (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_job_id uuid NOT NULL UNIQUE REFERENCES plan_jobs(id),
    week_start date NOT NULL,
    week_end date NOT NULL,
    time_zone_identifier text NOT NULL,
    profile_revision integer NOT NULL CHECK (profile_revision > 0),
    target_snapshot_json jsonb NOT NULL,
    generator_version text NOT NULL,
    scoring_version text NOT NULL,
    rule_version text NOT NULL,
    diagnostics_json jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (week_end = week_start + 6)
);

CREATE INDEX weekly_plans_user_week_idx ON weekly_plans (user_id, week_start DESC);

CREATE TABLE plan_items (
    id uuid PRIMARY KEY,
    weekly_plan_id uuid NOT NULL REFERENCES weekly_plans(id) ON DELETE RESTRICT,
    local_date date NOT NULL,
    slot text NOT NULL CHECK (slot IN ('breakfast', 'lunch', 'dinner', 'snack')),
    recipe_id text NOT NULL REFERENCES recipes(id),
    recipe_version_id uuid NOT NULL REFERENCES recipe_versions(id),
    recipe_snapshot_json jsonb NOT NULL,
    serving_multiplier numeric(12,4) NOT NULL CHECK (serving_multiplier > 0),
    serving_quantity_grams numeric(12,4) NOT NULL CHECK (serving_quantity_grams > 0),
    nutrition_snapshot_json jsonb NOT NULL,
    leftover_relationship_json jsonb NOT NULL,
    locked_from_plan_item_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (weekly_plan_id, local_date, slot)
);

CREATE INDEX plan_items_plan_date_idx ON plan_items (weekly_plan_id, local_date, slot);

CREATE TABLE plan_adoptions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    weekly_plan_id uuid NOT NULL REFERENCES weekly_plans(id) ON DELETE RESTRICT,
    adopted_at timestamptz NOT NULL DEFAULT now(),
    superseded_at timestamptz,
    CHECK (superseded_at IS NULL OR superseded_at > adopted_at)
);

CREATE UNIQUE INDEX plan_adoptions_one_active_week_idx
ON plan_adoptions (user_id, weekly_plan_id)
WHERE superseded_at IS NULL;

CREATE OR REPLACE FUNCTION prevent_materialized_plan_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'materialized plans and plan items are immutable';
END;
$$;

CREATE TRIGGER weekly_plans_are_immutable
BEFORE UPDATE OR DELETE ON weekly_plans
FOR EACH ROW EXECUTE FUNCTION prevent_materialized_plan_mutation();

CREATE TRIGGER plan_items_are_immutable
BEFORE UPDATE OR DELETE ON plan_items
FOR EACH ROW EXECUTE FUNCTION prevent_materialized_plan_mutation();

COMMIT;
