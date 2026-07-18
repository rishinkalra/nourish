BEGIN;

CREATE TYPE catalogue_source_status AS ENUM ('proposed', 'verified', 'retired');
CREATE TYPE source_license_status AS ENUM ('unknown', 'evaluation_only', 'approved_for_production', 'expired', 'prohibited');
CREATE TYPE recipe_version_state AS ENUM ('draft', 'in_review', 'rejected', 'published', 'archived');

CREATE TABLE ingredients (
    id text PRIMARY KEY,
    canonical_name text NOT NULL,
    aliases text[] NOT NULL DEFAULT '{}',
    category text NOT NULL,
    compatible_diets text[] NOT NULL,
    allergen_ids text[] NOT NULL DEFAULT '{}',
    source_status catalogue_source_status NOT NULL DEFAULT 'proposed',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ingredient_unit_conversions (
    ingredient_id text NOT NULL REFERENCES ingredients(id),
    household_unit text NOT NULL,
    household_quantity numeric(12,4) NOT NULL CHECK (household_quantity > 0),
    grams numeric(12,4) NOT NULL CHECK (grams > 0),
    PRIMARY KEY (ingredient_id, household_unit, household_quantity)
);

CREATE TABLE nutrient_sources (
    id uuid PRIMARY KEY,
    provider text NOT NULL,
    dataset text NOT NULL,
    dataset_version text NOT NULL,
    source_record_id text NOT NULL,
    source_url text,
    license_status source_license_status NOT NULL,
    retrieved_at timestamptz NOT NULL,
    UNIQUE (provider, dataset, dataset_version, source_record_id)
);

CREATE TABLE ingredient_nutrients (
    id uuid PRIMARY KEY,
    ingredient_id text NOT NULL REFERENCES ingredients(id),
    source_id uuid NOT NULL REFERENCES nutrient_sources(id),
    calories_per_100g numeric(12,4) NOT NULL CHECK (calories_per_100g >= 0),
    protein_g_per_100g numeric(12,4) NOT NULL CHECK (protein_g_per_100g >= 0),
    carbohydrate_g_per_100g numeric(12,4) NOT NULL CHECK (carbohydrate_g_per_100g >= 0),
    fat_g_per_100g numeric(12,4) NOT NULL CHECK (fat_g_per_100g >= 0),
    fibre_g_per_100g numeric(12,4) NOT NULL CHECK (fibre_g_per_100g >= 0),
    confidence text NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
    effective_from timestamptz NOT NULL,
    effective_until timestamptz,
    reviewed_by uuid,
    reviewed_at timestamptz,
    CHECK (effective_until IS NULL OR effective_until > effective_from),
    CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL))
);

CREATE TABLE recipes (
    id text PRIMARY KEY,
    locale_identifier text NOT NULL,
    cuisine text NOT NULL,
    eligible_slots text[] NOT NULL,
    active_preparation_minutes integer NOT NULL CHECK (active_preparation_minutes >= 0),
    total_minutes integer NOT NULL CHECK (total_minutes >= active_preparation_minutes),
    equipment text[] NOT NULL DEFAULT '{}',
    cost_band text NOT NULL,
    lifecycle_status text NOT NULL CHECK (lifecycle_status IN ('active', 'archived')),
    current_published_version_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recipe_versions (
    id uuid PRIMARY KEY,
    recipe_id text NOT NULL REFERENCES recipes(id),
    version integer NOT NULL CHECK (version > 0),
    display_name text NOT NULL,
    servings numeric(12,4) NOT NULL CHECK (servings > 0),
    serving_size_grams numeric(12,4) NOT NULL CHECK (serving_size_grams > 0),
    calories_per_serving numeric(12,4) NOT NULL CHECK (calories_per_serving > 0),
    protein_g_per_serving numeric(12,4) NOT NULL CHECK (protein_g_per_serving >= 0),
    carbohydrate_g_per_serving numeric(12,4) NOT NULL CHECK (carbohydrate_g_per_serving >= 0),
    fat_g_per_serving numeric(12,4) NOT NULL CHECK (fat_g_per_serving >= 0),
    fibre_g_per_serving numeric(12,4) NOT NULL CHECK (fibre_g_per_serving >= 0),
    diet_type text NOT NULL,
    declared_allergen_ids text[] NOT NULL DEFAULT '{}',
    dominant_ingredient_ids text[] NOT NULL,
    tags text[] NOT NULL DEFAULT '{}',
    nutrition_calculation_version text NOT NULL,
    workflow_state recipe_version_state NOT NULL DEFAULT 'draft',
    authored_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    submitted_at timestamptz,
    reviewed_by uuid,
    reviewed_at timestamptz,
    published_at timestamptz,
    rejection_reason text,
    UNIQUE (recipe_id, version)
);

ALTER TABLE recipes
    ADD CONSTRAINT recipes_current_published_version_fk
    FOREIGN KEY (current_published_version_id) REFERENCES recipe_versions(id);

CREATE TABLE recipe_version_ingredients (
    recipe_version_id uuid NOT NULL REFERENCES recipe_versions(id),
    position integer NOT NULL CHECK (position >= 0),
    ingredient_id text NOT NULL REFERENCES ingredients(id),
    household_quantity numeric(12,4) NOT NULL CHECK (household_quantity > 0),
    household_unit text NOT NULL,
    grams numeric(12,4) NOT NULL CHECK (grams > 0),
    PRIMARY KEY (recipe_version_id, position)
);

CREATE TABLE recipe_version_steps (
    recipe_version_id uuid NOT NULL REFERENCES recipe_versions(id),
    position integer NOT NULL CHECK (position >= 0),
    instruction text NOT NULL CHECK (length(trim(instruction)) > 0),
    PRIMARY KEY (recipe_version_id, position)
);

CREATE TABLE recipe_version_nutrient_evidence (
    recipe_version_id uuid NOT NULL REFERENCES recipe_versions(id),
    ingredient_nutrient_id uuid NOT NULL REFERENCES ingredient_nutrients(id),
    PRIMARY KEY (recipe_version_id, ingredient_nutrient_id)
);

CREATE TABLE catalogue_audit_logs (
    id uuid PRIMARY KEY,
    actor_id uuid NOT NULL,
    action text NOT NULL,
    recipe_version_id uuid REFERENCES recipe_versions(id),
    reason text,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION prevent_published_recipe_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.workflow_state = 'published' THEN
        RAISE EXCEPTION 'published recipe versions are immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER recipe_versions_immutable_when_published
BEFORE UPDATE OR DELETE ON recipe_versions
FOR EACH ROW EXECUTE FUNCTION prevent_published_recipe_version_mutation();

COMMIT;
