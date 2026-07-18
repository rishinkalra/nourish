BEGIN;

CREATE TABLE subscription_operation_events (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action text NOT NULL CHECK (action IN ('retry_verified_check')),
    reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 10 AND 500),
    actor_id text NOT NULL CHECK (length(trim(actor_id)) > 0),
    correlation_id text NOT NULL CHECK (length(trim(correlation_id)) > 0),
    before_status text NOT NULL CHECK (before_status IN ('delayed', 'mismatch')),
    after_status text NOT NULL CHECK (after_status = 'pending'),
    background_job_id uuid NOT NULL REFERENCES background_jobs(id),
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subscription_operation_events_user_time_idx
    ON subscription_operation_events (user_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_subscription_operation_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'subscription operation events are append-only';
END;
$$;

CREATE TRIGGER subscription_operation_events_append_only
BEFORE UPDATE OR DELETE ON subscription_operation_events
FOR EACH ROW EXECUTE FUNCTION prevent_subscription_operation_event_mutation();

COMMIT;
