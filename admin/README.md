# Nourish Control Room

The private dashboard is available at `http://127.0.0.1:4173/admin/` when the workspace is served from its root.

Choose **Open demo workspace** to inspect the complete responsive review experience without changing data. To connect it to the local API, start the backend with `NOURISH_ADMIN_KEY` set, enter the same key and a reviewer ID in the access screen, and keep the default `NOURISH_ADMIN_ORIGIN=http://127.0.0.1:4173` or configure an exact alternate origin.

The dashboard currently provides:

- an owner-insights home with formula-bound KPIs and freshness timestamps;
- date, timezone, subscription, app-version, acquisition, diet, population-cohort, and cohort-grouping filters;
- an activation funnel, weekly cohorts, small-group suppression, and an accessible cohort table alternative;
- operator-only exact-match user lookup by internal ID or verified email with a required support reason;
- a minimized read-only account summary, found/not-found access receipts, and no impersonation controls;
- security-admin feature-flag inventory and versioned editor with percentage rollout, semantic app-version bounds, internal-user allowlists, JSON values, and emergency disable;
- deterministic evaluation-order guidance, optimistic edit protection, and reasoned append-only flag history;
- authorized KPI and cohort CSV exports that inherit the current insight filters and suppression rules;
- security-admin account exports with exact identity, minimized fields, separate creation/download reasons, 24-hour expiry, and auditable delivery;
- an open draft/review/rejected catalogue queue;
- recipe, serving, ingredient, gram, method, and nutrition inspection;
- nutrient source, dataset version, licence, confidence, and reviewer evidence;
- reviewer-confirmed ingredient, diet, allergen, and multi-unit conversion entry;
- immutable per-100 g nutrient entry with source identity, licence, confidence, and effective dates;
- JSON prefill for licensed-source mapping without bypassing human review or server validation;
- a reloadable verified-ingredient and nutrient-evidence library;
- operator-only plan-run search and detail with exact generator/scoring/rule versions;
- candidate-pool and hard-rejection funnels, typed failures, correlation IDs, duration, and lease/retry evidence;
- a curated operations projection that excludes profile snapshots and raw deterministic seeds;
- operator-only subscription case search with preserved-access, renewal, mismatch, delay, and pending state;
- privacy-safe Apple identity references, mixed Apple/Nourish timelines, and durable retry evidence;
- reason-required verified retry actions that cannot manually grant or revoke entitlement access;
- automated publication-gate results;
- separate-reviewer approval and reason-required rejection;
- combined content-ingestion and recipe-workflow activity;
- responsive desktop and phone layouts;
- a development access boundary that keeps the admin key in tab memory only.

The backend also supports production-shaped workforce identity exchange with mandatory MFA evidence, eight-hour hash-only bearer sessions, persisted role grants, revocation, and correlation-aware append-only access audit. The development key is not a production authentication system; the chosen identity provider/verifier and company sign-in UI still need configuration. User impersonation is deliberately absent. See `../docs/ADMIN_SECURITY_METHOD.md` and `../docs/USER_SUPPORT_METHOD.md`.
