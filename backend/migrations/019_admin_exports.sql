BEGIN;

CREATE TABLE admin_export_requests (
    id uuid PRIMARY KEY,
    export_type text NOT NULL CHECK (export_type IN ('kpis', 'cohorts', 'support_account')),
    data_scope text NOT NULL CHECK (data_scope IN ('aggregate', 'user')),
    status text NOT NULL CHECK (status IN ('ready', 'expired', 'failed')),
    requested_by text NOT NULL CHECK (length(trim(requested_by)) > 0),
    reason text,
    filters_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    subject_sha256 char(64),
    filename text NOT NULL,
    object_key text NOT NULL UNIQUE,
    content_sha256 char(64) NOT NULL,
    row_count integer NOT NULL CHECK (row_count >= 0),
    idempotency_key text NOT NULL,
    requested_at timestamptz NOT NULL,
    ready_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    delivered_at timestamptz,
    failure_code text,
    UNIQUE (requested_by, idempotency_key),
    CHECK (expires_at > ready_at),
    CHECK (data_scope <> 'user' OR (reason IS NOT NULL AND length(trim(reason)) BETWEEN 12 AND 500)),
    CHECK (data_scope <> 'user' OR subject_sha256 IS NOT NULL)
);

CREATE INDEX admin_export_requests_actor_time_idx
    ON admin_export_requests (requested_by, requested_at DESC);

CREATE TABLE admin_export_audit_logs (
    id uuid PRIMARY KEY,
    export_id uuid NOT NULL REFERENCES admin_export_requests(id) ON DELETE RESTRICT,
    export_type text NOT NULL,
    data_scope text NOT NULL,
    actor_reference text NOT NULL,
    action text NOT NULL CHECK (action IN ('created', 'delivered', 'expired', 'failed')),
    reason text,
    correlation_id text,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    CHECK (data_scope <> 'user' OR (reason IS NOT NULL AND length(trim(reason)) BETWEEN 12 AND 500))
);

CREATE INDEX admin_export_audit_export_time_idx
    ON admin_export_audit_logs (export_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_admin_export_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'admin export audit is append-only';
END;
$$;

CREATE TRIGGER admin_export_audit_append_only
BEFORE UPDATE OR DELETE ON admin_export_audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_admin_export_audit_mutation();

COMMIT;
