BEGIN;

ALTER TABLE recipe_generation_runs
    ADD COLUMN decision_actor text,
    ADD COLUMN decision_reason text,
    ADD COLUMN imported_recipe_version_id uuid REFERENCES recipe_versions(id),
    ADD COLUMN decided_at timestamptz,
    ADD CONSTRAINT recipe_generation_terminal_decision_check CHECK (
        (
            status = 'imported'
            AND decision_actor IS NOT NULL
            AND imported_recipe_version_id IS NOT NULL
            AND decided_at IS NOT NULL
        )
        OR (
            status = 'discarded'
            AND decision_actor IS NOT NULL
            AND decision_reason IS NOT NULL
            AND length(decision_reason) BETWEEN 12 AND 500
            AND decided_at IS NOT NULL
        )
        OR status NOT IN ('imported', 'discarded')
    );

CREATE TABLE recipe_generation_decisions (
    id uuid PRIMARY KEY,
    generation_id uuid NOT NULL UNIQUE REFERENCES recipe_generation_runs(id) ON DELETE RESTRICT,
    action text NOT NULL CHECK (action IN ('imported', 'discarded')),
    actor_id text NOT NULL,
    reason text,
    recipe_version_id uuid REFERENCES recipe_versions(id) ON DELETE RESTRICT,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (action = 'imported' AND recipe_version_id IS NOT NULL AND reason IS NULL)
        OR
        (action = 'discarded' AND recipe_version_id IS NULL AND length(reason) BETWEEN 12 AND 500)
    )
);

CREATE INDEX recipe_generation_decisions_occurred_idx
    ON recipe_generation_decisions (occurred_at DESC);

COMMIT;
