BEGIN;

ALTER TABLE recipe_versions
    ALTER COLUMN authored_by TYPE text USING authored_by::text,
    ALTER COLUMN reviewed_by TYPE text USING reviewed_by::text,
    ADD COLUMN recipe_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN content_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE ingredient_nutrients
    ALTER COLUMN reviewed_by TYPE text USING reviewed_by::text;

ALTER TABLE catalogue_audit_logs
    ALTER COLUMN actor_id TYPE text USING actor_id::text;

CREATE UNIQUE INDEX recipe_versions_one_open_version_idx
    ON recipe_versions (recipe_id)
    WHERE workflow_state IN ('draft', 'in_review', 'rejected');

CREATE OR REPLACE FUNCTION prevent_published_recipe_version_child_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    target_version_id uuid;
    target_state recipe_version_state;
BEGIN
    target_version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.recipe_version_id ELSE NEW.recipe_version_id END;
    SELECT workflow_state INTO target_state FROM recipe_versions WHERE id = target_version_id;
    IF target_state = 'published' THEN
        RAISE EXCEPTION 'published recipe version children are immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER recipe_version_ingredients_immutable_when_published
BEFORE INSERT OR UPDATE OR DELETE ON recipe_version_ingredients
FOR EACH ROW EXECUTE FUNCTION prevent_published_recipe_version_child_mutation();

CREATE TRIGGER recipe_version_steps_immutable_when_published
BEFORE INSERT OR UPDATE OR DELETE ON recipe_version_steps
FOR EACH ROW EXECUTE FUNCTION prevent_published_recipe_version_child_mutation();

CREATE TRIGGER recipe_version_evidence_immutable_when_published
BEFORE INSERT OR UPDATE OR DELETE ON recipe_version_nutrient_evidence
FOR EACH ROW EXECUTE FUNCTION prevent_published_recipe_version_child_mutation();

COMMIT;
