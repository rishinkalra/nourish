BEGIN;

CREATE TABLE support_access_audit_logs (
    id uuid PRIMARY KEY,
    actor_reference text NOT NULL CHECK (length(trim(actor_reference)) > 0),
    action text NOT NULL CHECK (action IN ('user.lookup', 'user.view')),
    lookup_type text NOT NULL CHECK (lookup_type IN ('internal_id', 'verified_email')),
    lookup_value_sha256 char(64) NOT NULL,
    matched_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    matched_user_id_sha256 char(64),
    outcome text NOT NULL CHECK (outcome IN ('found', 'not_found')),
    reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 12 AND 500),
    correlation_id text,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX support_access_audit_actor_time_idx
    ON support_access_audit_logs (actor_reference, occurred_at DESC);

CREATE INDEX support_access_audit_subject_time_idx
    ON support_access_audit_logs (matched_user_id_sha256, occurred_at DESC)
    WHERE matched_user_id_sha256 IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_support_access_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'support access audit is append-only';
END;
$$;

CREATE TRIGGER support_access_audit_append_only
BEFORE UPDATE OR DELETE ON support_access_audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_support_access_audit_mutation();

COMMIT;
