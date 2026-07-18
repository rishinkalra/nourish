BEGIN;

CREATE TABLE analytics_measurement_consents (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    enabled boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE analytics_events (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_name text NOT NULL CHECK (event_name IN (
        'app_opened', 'onboarding_started', 'eligibility_completed', 'onboarding_step_completed',
        'onboarding_completed', 'plan_generation_started', 'plan_generation_succeeded',
        'plan_generation_failed', 'plan_preview_viewed', 'plan_adopted', 'meal_detail_viewed',
        'swap_list_viewed', 'meal_swapped', 'meal_status_changed', 'grocery_list_opened',
        'grocery_item_changed', 'prep_plan_opened', 'recipe_feedback_submitted',
        'weekly_review_completed', 'paywall_viewed', 'trial_started', 'purchase_completed',
        'subscription_state_changed', 'notification_opened', 'account_export_requested',
        'account_deletion_requested'
    )),
    event_source text NOT NULL CHECK (event_source IN ('client', 'server')),
    schema_version text NOT NULL CHECK (schema_version = '1'),
    dedupe_sha256 char(64) NOT NULL,
    occurred_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    properties_json jsonb NOT NULL,
    UNIQUE (user_id, event_name, dedupe_sha256),
    CHECK (expires_at > received_at),
    CHECK (occurred_at >= received_at - interval '7 days'),
    CHECK (occurred_at <= received_at + interval '5 minutes'),
    CHECK (octet_length(properties_json::text) <= 4096),
    CHECK (
        event_source = 'server' OR event_name IN (
            'app_opened', 'onboarding_started', 'eligibility_completed',
            'onboarding_step_completed', 'onboarding_completed', 'plan_preview_viewed',
            'meal_detail_viewed', 'swap_list_viewed', 'grocery_list_opened',
            'prep_plan_opened', 'paywall_viewed', 'notification_opened'
        )
    )
);

CREATE INDEX analytics_events_name_time_idx ON analytics_events (event_name, occurred_at DESC);
CREATE INDEX analytics_events_user_time_idx ON analytics_events (user_id, occurred_at DESC);
CREATE INDEX analytics_events_retention_idx ON analytics_events (expires_at, id);

COMMIT;
