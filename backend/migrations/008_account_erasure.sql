BEGIN;

-- Plans stay immutable during normal operation. The privacy worker opts into
-- this transaction-local setting only while executing a verified erasure job.
CREATE OR REPLACE FUNCTION prevent_materialized_plan_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF current_setting('nourish.account_deletion', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'materialized plans and plan items are immutable';
END;
$$;

COMMIT;
