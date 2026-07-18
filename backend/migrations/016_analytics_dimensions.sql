BEGIN;

CREATE TABLE user_analytics_dimensions (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    first_app_version text NOT NULL DEFAULT 'unknown' CHECK (length(first_app_version) BETWEEN 1 AND 80),
    latest_app_version text NOT NULL DEFAULT 'unknown' CHECK (length(latest_app_version) BETWEEN 1 AND 80),
    acquisition_source text NOT NULL DEFAULT 'unknown' CHECK (length(acquisition_source) BETWEEN 1 AND 80),
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX user_analytics_dimensions_version_idx ON user_analytics_dimensions (latest_app_version);
CREATE INDEX user_analytics_dimensions_acquisition_idx ON user_analytics_dimensions (acquisition_source);

COMMIT;
