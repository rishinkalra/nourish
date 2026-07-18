BEGIN;

ALTER TABLE plan_adoptions
    ADD COLUMN activates_on date NOT NULL DEFAULT CURRENT_DATE;

CREATE INDEX plan_adoptions_user_activation_idx
ON plan_adoptions (user_id, activates_on DESC, adopted_at DESC);

CREATE TABLE meal_feedback (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_item_id uuid NOT NULL REFERENCES plan_items(id) ON DELETE CASCADE,
    recipe_id text REFERENCES recipes(id),
    rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
    reason_tags text[] NOT NULL DEFAULT '{}',
    note text CHECK (char_length(note) <= 500),
    submitted_at timestamptz NOT NULL DEFAULT now(),
    CHECK (reason_tags <@ ARRAY['taste', 'effort', 'cost', 'portion', 'ingredientAvailability']::text[])
);

CREATE INDEX meal_feedback_user_submitted_idx ON meal_feedback (user_id, submitted_at DESC);
CREATE INDEX meal_feedback_recipe_idx ON meal_feedback (recipe_id, submitted_at DESC);

CREATE TABLE weekly_plan_reviews (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    weekly_plan_id uuid NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
    completion_rate numeric(5,4) NOT NULL CHECK (completion_rate BETWEEN 0 AND 1),
    changes_requested text[] NOT NULL DEFAULT '{}',
    submitted_at timestamptz NOT NULL DEFAULT now(),
    CHECK (changes_requested <@ ARRAY['moreVariety', 'lessEffort', 'lowerCost', 'differentCuisines', 'adjustPortions']::text[])
);

CREATE INDEX weekly_plan_reviews_user_submitted_idx ON weekly_plan_reviews (user_id, submitted_at DESC);

COMMIT;
