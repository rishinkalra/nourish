BEGIN;

CREATE TYPE nutrient_provenance_kind AS ENUM ('public_domain', 'licensed', 'ai_estimated');

ALTER TABLE nutrient_sources
    ADD COLUMN provenance_kind nutrient_provenance_kind NOT NULL DEFAULT 'licensed',
    ADD COLUMN generation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE nutrient_sources
    ADD CONSTRAINT ai_nutrient_generation_metadata_required CHECK (
        provenance_kind <> 'ai_estimated'
        OR (
            jsonb_typeof(generation_metadata->'model') = 'string'
            AND length(trim(generation_metadata->>'model')) > 0
            AND jsonb_typeof(generation_metadata->'promptVersion') = 'string'
            AND length(trim(generation_metadata->>'promptVersion')) > 0
        )
    );

COMMIT;
