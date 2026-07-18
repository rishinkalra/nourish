BEGIN;

ALTER TABLE account_export_requests
    ADD COLUMN physically_deleted_at timestamptz,
    ADD COLUMN purge_attempt_count integer NOT NULL DEFAULT 0 CHECK (purge_attempt_count >= 0),
    ADD COLUMN last_purge_failure_code text;

CREATE INDEX account_export_requests_retention_idx
    ON account_export_requests (expires_at, id)
    WHERE object_key IS NOT NULL AND physically_deleted_at IS NULL;

CREATE TABLE account_export_retention_audit_logs (
    id uuid PRIMARY KEY,
    export_id uuid REFERENCES account_export_requests(id) ON DELETE SET NULL,
    actor_reference text NOT NULL,
    action text NOT NULL CHECK (action IN ('physically_deleted', 'cleanup_failed')),
    failure_code text,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((action = 'cleanup_failed') = (failure_code IS NOT NULL))
);

CREATE INDEX account_export_retention_audit_time_idx
    ON account_export_retention_audit_logs (export_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_account_export_retention_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'account export retention audit is append-only';
END;
$$;

CREATE TRIGGER account_export_retention_audit_append_only
BEFORE UPDATE OR DELETE ON account_export_retention_audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_account_export_retention_audit_mutation();

ALTER TABLE admin_export_requests
    ALTER COLUMN object_key DROP NOT NULL,
    ADD COLUMN physically_deleted_at timestamptz,
    ADD COLUMN purge_attempt_count integer NOT NULL DEFAULT 0 CHECK (purge_attempt_count >= 0),
    ADD COLUMN last_purge_failure_code text;

CREATE INDEX admin_export_requests_retention_idx
    ON admin_export_requests (expires_at, id)
    WHERE object_key IS NOT NULL AND physically_deleted_at IS NULL;

ALTER TABLE admin_export_audit_logs
    DROP CONSTRAINT admin_export_audit_logs_action_check,
    ADD CONSTRAINT admin_export_audit_logs_action_check
        CHECK (action IN ('created', 'delivered', 'expired', 'failed', 'physically_deleted', 'cleanup_failed'));

COMMIT;
