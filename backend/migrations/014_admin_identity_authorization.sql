BEGIN;

CREATE TABLE admin_users (
    id uuid PRIMARY KEY,
    provider text NOT NULL,
    provider_subject text NOT NULL,
    verified_email text NOT NULL,
    display_name text NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'disabled')),
    mfa_required boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_access_at timestamptz,
    UNIQUE (provider, provider_subject),
    UNIQUE (verified_email)
);

CREATE TABLE admin_role_grants (
    admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('author', 'reviewer', 'operator', 'security_admin')),
    granted_by uuid REFERENCES admin_users(id),
    reason text NOT NULL CHECK (length(trim(reason)) > 0),
    granted_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    PRIMARY KEY (admin_user_id, role, granted_at)
);

CREATE UNIQUE INDEX admin_role_grants_one_active_idx
    ON admin_role_grants (admin_user_id, role)
    WHERE revoked_at IS NULL;

CREATE TABLE admin_sessions (
    id uuid PRIMARY KEY,
    admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    access_token_sha256 char(64) NOT NULL UNIQUE,
    identity_provider text NOT NULL,
    authentication_methods text[] NOT NULL,
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CHECK (expires_at > issued_at),
    CHECK ('mfa' = ANY(authentication_methods))
);

CREATE INDEX admin_sessions_active_idx
    ON admin_sessions (admin_user_id, expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE admin_access_audit_logs (
    id uuid PRIMARY KEY,
    admin_user_id uuid REFERENCES admin_users(id),
    actor_subject text,
    action text NOT NULL,
    route text NOT NULL,
    required_role text,
    outcome text NOT NULL CHECK (outcome IN ('granted', 'denied', 'succeeded', 'failed')),
    correlation_id text,
    detail_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_access_audit_actor_time_idx
    ON admin_access_audit_logs (admin_user_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_admin_access_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'admin access audit is append-only';
END;
$$;

CREATE TRIGGER admin_access_audit_append_only
BEFORE UPDATE OR DELETE ON admin_access_audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_admin_access_audit_mutation();

COMMIT;
