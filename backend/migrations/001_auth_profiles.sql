BEGIN;

CREATE TABLE users (
    id UUID PRIMARY KEY,
    verified_email TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    disabled_at TIMESTAMPTZ
);

CREATE TABLE auth_identities (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('apple', 'email')),
    provider_subject TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_subject)
);

CREATE TABLE magic_link_tokens (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL,
    token_sha256 CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX magic_link_tokens_email_created_idx ON magic_link_tokens (email, created_at DESC);

CREATE TABLE sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token_sha256 CHAR(64) NOT NULL UNIQUE,
    refresh_token_sha256 CHAR(64) NOT NULL UNIQUE,
    access_expires_at TIMESTAMPTZ NOT NULL,
    refresh_expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    replaced_by_session_id UUID REFERENCES sessions(id)
);

CREATE INDEX sessions_user_active_idx ON sessions (user_id, refresh_expires_at) WHERE revoked_at IS NULL;

CREATE TABLE profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision > 0),
    effective_scope TEXT NOT NULL CHECK (effective_scope IN ('currentAndFuturePlans', 'nextPlanOnly')),
    profile_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
