# First-party analytics event method

## Purpose and consent boundary

Nourish implements the 26 event names in the v1.0 product specification as a closed, versioned first-party catalogue. Measurement is optional and off by default. An authenticated account must explicitly enable it through `PATCH /v1/analytics/consent` before either the app or the service may record an event. Turning the setting off records the disabled account state and prevents future client and server event collection. Analytics failure never blocks a product action.

The native switch is labelled **Share first-party product usage** under Privacy & measurement. Consent is stored server-side so server-observed plan, subscription, feedback, and privacy events follow the same choice as app-observed events. Account deletion removes the consent and event rows through database cascades. Existing events otherwise expire under the retention policy.

## Authority and catalogue

Only the following 12 events may enter through the authenticated client route:

- `app_opened`
- `onboarding_started`
- `eligibility_completed`
- `onboarding_step_completed`
- `onboarding_completed`
- `plan_preview_viewed`
- `meal_detail_viewed`
- `swap_list_viewed`
- `grocery_list_opened`
- `prep_plan_opened`
- `paywall_viewed`
- `notification_opened`

The service alone may create the remaining 14 events:

- `plan_generation_started`
- `plan_generation_succeeded`
- `plan_generation_failed`
- `plan_adopted`
- `meal_swapped`
- `meal_status_changed`
- `grocery_item_changed`
- `recipe_feedback_submitted`
- `weekly_review_completed`
- `trial_started`
- `purchase_completed`
- `subscription_state_changed`
- `account_export_requested`
- `account_deletion_requested`

This split prevents a modified app from claiming purchases, subscription changes, successful plan generation, or other authoritative outcomes.

## Ingestion contract

`POST /v1/analytics/events` authenticates the bearer session and always derives the user identity on the server. A client-supplied `userID` is ignored. Each event carries schema version `1`, a stable event identifier, an occurrence time, and only the properties defined for that exact event.

Properties are deliberately narrow: bounded tokens, bounded numbers, booleans, small token arrays, or local dates. Unknown properties and free-form strings are rejected. Event payloads are capped at 4,096 bytes, timestamps are limited to the preceding seven days and five minutes into the future, and identifiers are hashed before persistence. Receipts do not return user identity.

The contract does not accept email, profile answers, free-text feedback, meal history, advertising identifiers, device identifiers, or fingerprints. The app does not use third-party analytics SDKs in this path.

## Idempotency and retention

The service hashes the event identifier with SHA-256 and enforces uniqueness per account and event name. A safe replay returns the original event receipt with `replay: true` rather than creating a duplicate.

Retention defaults to 90 days and can be configured with `NOURISH_ANALYTICS_RETENTION_DAYS` from 1 through 400 days. Each row receives an explicit expiry timestamp. The worker deletes expired rows hourly in bounded, parameterized batches. User deletion cascades remove both consent and event data.

## Connected emitters

The catalogue, consent control, native client, memory adapter, PostgreSQL adapter, migration, route, and cleanup worker are implemented for all 26 events. The following product actions currently emit events:

- `app_opened` after authenticated opt-in and on later foreground activation;
- `onboarding_started`, `onboarding_step_completed`, `eligibility_completed`, and `onboarding_completed` while a consented account completes or restarts onboarding;
- `plan_generation_started` after a plan request is accepted;
- `plan_generation_succeeded` or `plan_generation_failed` when the synchronous planner or durable plan worker reaches a terminal outcome;
- `plan_preview_viewed` when a generated preview becomes ready;
- `plan_adopted` after successful adoption;
- `meal_detail_viewed`, `swap_list_viewed`, `grocery_list_opened`, and `prep_plan_opened` from reviewed active-plan screens;
- `meal_swapped`, `meal_status_changed`, and `grocery_item_changed` only after their authoritative weekly-state mutation succeeds;
- `recipe_feedback_submitted` and `weekly_review_completed` only after feedback is accepted by the service;
- `paywall_viewed` after the native paywall loads its actual StoreKit products;
- `trial_started`, `purchase_completed`, and `subscription_state_changed` from verified App Store transactions, Server Notifications V2, and reconciliation outcomes;
- `notification_opened` after a scheduled lifecycle reminder is opened and routed;
- `account_export_requested` after an export is accepted;
- `account_deletion_requested` before the account is disabled.

All 26 names are connected to their product action. Traceability remains `partial`, rather than `verified`, until the PostgreSQL worker, Apple sandbox lifecycle, production disclosure, retention, and downstream aggregate checks are completed on provisioned infrastructure.

Because measurement is off by default, the app intentionally does not collect a first-run onboarding funnel before the user has opted in. The onboarding emitters apply to consented accounts, including a settings-initiated onboarding restart. This avoids treating consent as retroactive or buffering pre-consent behavior.

## Verification and remaining production work

`backend/test/analytics-event.test.mjs` verifies the exact 26-name catalogue, every connected authoritative outcome, default-off consent, client/server authority, authenticated identity derivation, strict properties, idempotency, retention, PostgreSQL parameterization, migration constraints, privacy-minimized feedback, and verified Apple trial-to-active transitions. `NourishCoreChecks` verifies the native routes and the 12-event client boundary. Complete Debug and Release simulator builds verify the connected native flows.

Before production, validate terminal plan and subscription worker emission against provisioned PostgreSQL, exercise purchases/restores/trials/renewals/grace/expiry/refund in Apple sandbox, confirm the final retention/disclosure language with counsel, and validate downstream aggregate formulas without exposing event-level user rows.
