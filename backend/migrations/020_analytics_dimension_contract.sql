BEGIN;

ALTER TABLE user_analytics_dimensions
    ADD CONSTRAINT user_analytics_dimensions_first_version_format
        CHECK (first_app_version ~ '^(unknown|\d+(\.\d+){0,2}(-[0-9A-Za-z.-]+)?)$'),
    ADD CONSTRAINT user_analytics_dimensions_latest_version_format
        CHECK (latest_app_version ~ '^(unknown|\d+(\.\d+){0,2}(-[0-9A-Za-z.-]+)?)$'),
    ADD CONSTRAINT user_analytics_dimensions_acquisition_source
        CHECK (acquisition_source IN ('unknown', 'organic', 'app_store_search', 'referral', 'paid_social'));

COMMIT;
