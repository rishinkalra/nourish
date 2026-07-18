BEGIN;

ALTER TABLE weekly_plans
    ADD COLUMN supersedes_weekly_plan_id uuid REFERENCES weekly_plans(id);

CREATE TABLE plan_swap_mutations (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_weekly_plan_id uuid NOT NULL REFERENCES weekly_plans(id) ON DELETE RESTRICT,
    result_weekly_plan_id uuid NOT NULL UNIQUE REFERENCES weekly_plans(id) ON DELETE RESTRICT,
    source_plan_item_id uuid NOT NULL REFERENCES plan_items(id) ON DELETE RESTRICT,
    replacement_recipe_version_id uuid NOT NULL REFERENCES recipe_versions(id) ON DELETE RESTRICT,
    idempotency_key text NOT NULL,
    diagnostics_json jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, idempotency_key)
);

CREATE TABLE grocery_lists (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    weekly_plan_id uuid NOT NULL UNIQUE REFERENCES weekly_plans(id) ON DELETE RESTRICT,
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE grocery_items (
    id uuid PRIMARY KEY,
    grocery_list_id uuid NOT NULL REFERENCES grocery_lists(id) ON DELETE CASCADE,
    ingredient_id text NOT NULL REFERENCES ingredients(id),
    display_name_snapshot text NOT NULL,
    category_snapshot text NOT NULL,
    required_grams numeric(12,4) NOT NULL CHECK (required_grams > 0),
    household_quantities_json jsonb NOT NULL,
    user_adjusted_grams numeric(12,4) CHECK (user_adjusted_grams > 0),
    disposition text NOT NULL DEFAULT 'needed' CHECK (disposition IN ('needed', 'checked', 'already_have')),
    changed_by_swap boolean NOT NULL DEFAULT false,
    newly_added_by_swap boolean NOT NULL DEFAULT false,
    UNIQUE (grocery_list_id, ingredient_id)
);

CREATE TABLE prep_tasks (
    id uuid PRIMARY KEY,
    weekly_plan_id uuid NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
    local_date date NOT NULL,
    title text NOT NULL,
    active_minutes integer NOT NULL CHECK (active_minutes >= 0),
    storage_note text NOT NULL,
    reuse_note text NOT NULL,
    source_plan_item_ids uuid[] NOT NULL,
    is_complete boolean NOT NULL DEFAULT false
);

CREATE INDEX prep_tasks_plan_date_idx ON prep_tasks (weekly_plan_id, local_date);

CREATE TABLE plan_item_operational_states (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_item_id uuid NOT NULL REFERENCES plan_items(id) ON DELETE CASCADE,
    completion_state text NOT NULL CHECK (completion_state IN ('planned', 'completed', 'skipped', 'replaced_outside_app', 'moved')),
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, plan_item_id)
);

CREATE TABLE weekly_loop_mutation_journal (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    weekly_plan_id uuid NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
    mutation_id text NOT NULL,
    base_revision integer NOT NULL CHECK (base_revision > 0),
    resulting_revision integer NOT NULL CHECK (resulting_revision = base_revision + 1),
    mutation_json jsonb NOT NULL,
    client_created_at timestamptz NOT NULL,
    acknowledged_at timestamptz,
    UNIQUE (user_id, mutation_id)
);

COMMIT;
