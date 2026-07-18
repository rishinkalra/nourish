BEGIN;

ALTER TABLE subscriptions
    ADD COLUMN original_transaction_id text,
    ADD COLUMN app_account_token uuid,
    ADD COLUMN last_reconciled_at timestamptz,
    ADD COLUMN reconciliation_attempt_count integer NOT NULL DEFAULT 0 CHECK (reconciliation_attempt_count >= 0),
    ADD COLUMN last_reconciliation_error_code text;

ALTER TABLE app_store_events
    ADD COLUMN original_transaction_id text,
    ADD COLUMN transaction_id text,
    ADD COLUMN app_account_token uuid;

ALTER TABLE subscriptions
    DROP CONSTRAINT subscriptions_reconciliation_status_check,
    ADD CONSTRAINT subscriptions_reconciliation_status_check
        CHECK (reconciliation_status IN ('current', 'pending', 'delayed', 'mismatch'));

CREATE UNIQUE INDEX subscriptions_original_transaction_idx
    ON subscriptions (original_transaction_id)
    WHERE original_transaction_id IS NOT NULL;

DROP INDEX subscriptions_reconciliation_idx;
CREATE INDEX subscriptions_reconciliation_idx
    ON subscriptions (next_reconciliation_at, user_id)
    WHERE original_transaction_id IS NOT NULL
      AND environment IN ('sandbox', 'production');

COMMIT;
