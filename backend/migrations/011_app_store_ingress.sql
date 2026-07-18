BEGIN;

CREATE TABLE app_store_account_bindings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    app_account_token UUID NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE app_store_events
    DROP CONSTRAINT app_store_events_user_id_fkey,
    ADD CONSTRAINT app_store_events_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

CREATE TABLE app_store_notification_inbox (
    app_store_event_id TEXT PRIMARY KEY,
    original_transaction_id TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    app_account_token UUID,
    notification_type TEXT NOT NULL,
    environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
    normalized_event_json JSONB NOT NULL,
    signed_payload_sha256 CHAR(64) NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processing_state TEXT NOT NULL CHECK (processing_state IN ('pending', 'applied', 'failed')),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    processed_at TIMESTAMPTZ,
    failure_code TEXT
);

CREATE INDEX app_store_notification_inbox_identity_idx
    ON app_store_notification_inbox (original_transaction_id, app_account_token, received_at)
    WHERE processing_state = 'pending';

COMMIT;
