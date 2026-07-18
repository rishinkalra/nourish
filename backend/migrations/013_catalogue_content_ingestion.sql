BEGIN;

ALTER TABLE recipe_version_ingredients
    ADD COLUMN canonical_name_snapshot text,
    ADD COLUMN category_snapshot text,
    ADD COLUMN allergen_ids_snapshot text[];

UPDATE recipe_version_ingredients item
   SET canonical_name_snapshot = ingredient.canonical_name,
       category_snapshot = ingredient.category,
       allergen_ids_snapshot = ingredient.allergen_ids
  FROM ingredients ingredient
 WHERE ingredient.id = item.ingredient_id;

ALTER TABLE recipe_version_ingredients
    ALTER COLUMN canonical_name_snapshot SET NOT NULL,
    ALTER COLUMN category_snapshot SET NOT NULL,
    ALTER COLUMN allergen_ids_snapshot SET NOT NULL;

CREATE TABLE catalogue_content_audit_logs (
    id uuid PRIMARY KEY,
    actor_id text NOT NULL,
    action text NOT NULL,
    entity_type text NOT NULL CHECK (entity_type IN ('ingredient', 'nutrient_record')),
    entity_id text NOT NULL,
    content_json jsonb NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION prevent_published_nutrient_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM recipe_version_nutrient_evidence evidence
          JOIN recipe_versions version ON version.id = evidence.recipe_version_id
         WHERE evidence.ingredient_nutrient_id = OLD.id
           AND version.workflow_state = 'published'
    ) THEN
        RAISE EXCEPTION 'nutrient evidence referenced by a published recipe is immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER ingredient_nutrients_immutable_when_published
BEFORE UPDATE OR DELETE ON ingredient_nutrients
FOR EACH ROW EXECUTE FUNCTION prevent_published_nutrient_evidence_mutation();

CREATE OR REPLACE FUNCTION prevent_published_nutrient_source_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM ingredient_nutrients nutrient
          JOIN recipe_version_nutrient_evidence evidence ON evidence.ingredient_nutrient_id = nutrient.id
          JOIN recipe_versions version ON version.id = evidence.recipe_version_id
         WHERE nutrient.source_id = OLD.id
           AND version.workflow_state = 'published'
    ) THEN
        RAISE EXCEPTION 'nutrient source referenced by a published recipe is immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER nutrient_sources_immutable_when_published
BEFORE UPDATE OR DELETE ON nutrient_sources
FOR EACH ROW EXECUTE FUNCTION prevent_published_nutrient_source_mutation();

COMMIT;
