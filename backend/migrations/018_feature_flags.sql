BEGIN;

CREATE TABLE feature_flags (
    id uuid PRIMARY KEY,
    key text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]{2,63}$'),
    description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 240),
    enabled boolean NOT NULL DEFAULT false,
    emergency_disabled boolean NOT NULL DEFAULT false,
    rollout_percentage smallint NOT NULL DEFAULT 0 CHECK (rollout_percentage BETWEEN 0 AND 100),
    minimum_app_version text,
    maximum_app_version text,
    allowlisted_user_ids text[] NOT NULL DEFAULT '{}',
    value_json jsonb NOT NULL DEFAULT 'null'::jsonb,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_by text NOT NULL,
    updated_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (cardinality(allowlisted_user_ids) <= 500)
);

CREATE TABLE feature_flag_audit_logs (
    id uuid PRIMARY KEY,
    flag_id uuid NOT NULL REFERENCES feature_flags(id) ON DELETE RESTRICT,
    flag_key text NOT NULL,
    flag_version integer NOT NULL CHECK (flag_version > 0),
    actor_reference text NOT NULL CHECK (length(trim(actor_reference)) > 0),
    action text NOT NULL CHECK (action IN ('created', 'updated', 'emergency_disabled', 'emergency_restored')),
    reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 12 AND 500),
    before_sha256 char(64),
    after_sha256 char(64) NOT NULL,
    correlation_id text,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX feature_flag_audit_flag_time_idx
    ON feature_flag_audit_logs (flag_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_feature_flag_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'feature flag audit is append-only';
END;
$$;

CREATE TRIGGER feature_flag_audit_append_only
BEFORE UPDATE OR DELETE ON feature_flag_audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_feature_flag_audit_mutation();

COMMIT;
