# Admin analytics method

## Metric contract

The private owner dashboard does not render an unnamed or undocumented number. Both operator endpoints return each KPI or funnel step with a stable identifier, label, display format, exact formula, numerator/denominator evidence where relevant, and a freshness timestamp. The Control Room repeats the formula on every KPI card and provides a consolidated definition register.

The first metrics are new accounts, onboarding completion, terminal plan-generation success, plan adoption, weekly review submission, decided-meal completion, and the current verified-access snapshot. The verified-access formula explicitly states that it is a freshness-time snapshot rather than a date-window event count.

## Filters and time boundary

The API accepts start/end local dates, an IANA timezone, subscription state, app version, acquisition source, diet type, population cohort, and cohort grouping. PostgreSQL converts the inclusive local-date window at the selected timezone before filtering events. Ranges are validated, ordered, and capped at 367 days.

Population cohorts cover all users, onboarded users, plan adopters, and verified subscribers. Cohort rows can group by registration week or first successful-plan week. App-version and acquisition filters use a bounded analytics-dimension table populated by authenticated native bootstrap. Missing or unattributed sources resolve honestly to `unknown`; first known acquisition source cannot be overwritten.

## Privacy boundary

Responses contain aggregates, definitions, filters, freshness, and privacy metadata only. They never select or return verified email, internal user ID, profile-answer payloads, allergens, body measurements, meal notes, or raw Apple evidence. Non-empty filtered populations below five are suppressed, and individual cohort rows below five are replaced with a suppression marker. No CSV or user-level export is part of this slice.

## Accessible presentation

The dashboard provides an activation funnel and cohort adoption chart. The cohort visualization has an explicit table alternative using the API-provided column definitions. Metric formulas are visible text rather than hover-only help, and filter controls have labels.

## Verification and remaining gates

Executable controlled-data checks reconcile every numerator, denominator, rate, filter, freshness field, small-group rule, and cohort conversion. PostgreSQL checks verify parameterized queries across all filters and ensure analytics SQL does not select verified email. Operator-session integration verifies both endpoints are role-gated.

Authenticated app-version/acquisition-dimension ingestion is implemented and covered by controlled checks. Production still requires managed-PostgreSQL query-plan and reconciliation testing, an approved attribution source if campaign-level accuracy is required, analytics retention policy, dashboard performance thresholds, and a full assistive-technology audit. See `ANALYTICS_DIMENSION_INGESTION.md`.
