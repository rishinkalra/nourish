BEGIN;

CREATE TABLE subscriptions (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN (
        'active', 'trial', 'graceOrBillingRetry', 'expired',
        'revokedOrRefunded', 'upgraded', 'downgraded', 'unknown'
    )),
    product_id TEXT,
    environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production', 'xcode', 'unknown')),
    period_ends_at TIMESTAMPTZ,
    will_auto_renew BOOLEAN,
    source_event_id TEXT,
    last_verified_at TIMESTAMPTZ,
    next_reconciliation_at TIMESTAMPTZ NOT NULL,
    reconciliation_status TEXT NOT NULL CHECK (reconciliation_status IN ('current', 'pending', 'delayed')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE app_store_events (
    id UUID PRIMARY KEY,
    app_store_event_id TEXT NOT NULL UNIQUE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    notification_type TEXT NOT NULL,
    environment TEXT NOT NULL,
    signed_payload_sha256 CHAR(64) NOT NULL,
    verified_at TIMESTAMPTZ NOT NULL,
    processing_state TEXT NOT NULL CHECK (processing_state IN ('received', 'applied', 'ignored', 'failed')),
    processed_at TIMESTAMPTZ,
    failure_code TEXT
);

CREATE INDEX app_store_events_user_verified_idx ON app_store_events (user_id, verified_at DESC);
CREATE INDEX subscriptions_reconciliation_idx ON subscriptions (next_reconciliation_at)
    WHERE reconciliation_status <> 'current';

CREATE TABLE account_export_requests (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'ready', 'expired', 'failed')),
    format TEXT NOT NULL DEFAULT 'json' CHECK (format IN ('json')),
    object_key TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    failure_code TEXT,
    UNIQUE (user_id, idempotency_key)
);

CREATE TABLE account_deletion_requests (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    user_subject_sha256 CHAR(64) NOT NULL,
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    reason TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    account_access_revoked_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    failure_code TEXT,
    UNIQUE (user_subject_sha256, idempotency_key),
    CHECK (reason IS NULL OR length(reason) <= 500)
);

COMMIT;
