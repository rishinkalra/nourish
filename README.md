# Project Nourish

A mobile-first interactive prototype, a running native SwiftUI application, and an executable authentication/profile service for the consumer experience described in the Project Nourish product specification.

## Open it

This prototype has no dependencies or build step. Open `index.html` directly, or serve the folder with any small local web server.

## Domain

FamilyChef is the customer-facing app and web brand and uses the owned `familychef.in` domain family. The public site is `www.familychef.in`, the production API is `api.familychef.in`, and the privileged Control Room is `control.familychef.in`; staging uses separate `api-staging` and `control-staging` hosts. See `docs/FAMILYCHEF_DOMAIN_CONFIGURATION.md` for branding, DNS, email and universal-link sequencing. The internal project names, iOS bundle identifier and interim `nourish://` callback are intentionally unchanged.

## Included in this first slice

- Replayable seven-step onboarding covering wellness eligibility, account choice, goal/target, diet and allergens, cuisines, cooking constraints, leftovers, and final confirmation
- Today dashboard with calorie and macro context
- Seven-day plan with day switching
- Safe meal-swap sheet with validated alternatives
- Visible variety diagnostics and labelled intentional leftovers
- Grocery checklist with live progress
- Guided preparation checklist
- Plan-preference sheet for target, diet, and cooking rhythm
- Standalone planner variety rules with automated tests
- Responsive phone and desktop layouts
- Reduced-motion and semantic accessibility basics

All nutrition numbers and meals are illustrative prototype content. Production data must come from reviewed, structured recipe and nutrition records.

## What this is—and is not

This is now a working native application foundation, not only a screen prototype. It includes tested domain rules, durable local onboarding, a local HTTP authentication/profile/catalogue/planning service, real email-link session exchange, Keychain restoration, iOS API clients, versioned recipe review, native Plan Studio generation/review/adoption, locked regeneration and immutable history, scheduled weekly renewal, meal/weekly feedback, normalized grocery/prep derivation, atomic safe swaps, protected local-first weekly-loop synchronization, and account/entitlement lifecycle controls.

It is not yet production-ready. PostgreSQL runtime adapters now cover consumer and administrator identity, profiles, durable recipe author/review/publication, verified StoreKit/App Store notification ingress and scheduled Apple status reconciliation, asynchronous plan generation/history/adoption, account-bound plan-ready push delivery, immutable confirmed swaps with compatible weekly-state preservation, feedback, grocery/prep/meal state, privacy requests, controlled admin exports, scheduled physical export cleanup, and leased workers. Memory mode remains the local development default, while production startup now rejects ephemeral persistence and unsafe configuration. A locked container, separate migration job, schema-aware readiness, encrypted S3-compatible private storage, staging harness, smoke check, and deployment/recovery method define the next live-validation step. Live database/bucket policy and backup-retention validation, production email, workforce identity-provider configuration, approved StoreKit/APNs credentials and sandbox validation, licensed professionally reviewed nutrition data and ingestion, and physical-device background validation remain.

## Run the native iOS app

Open `ios/NourishApp/NourishApp.xcodeproj` in Xcode and run the `NourishApp` scheme on an iPhone Simulator. The application target is backed by the local Swift package, which contains shared profile models, onboarding validation, variety and safety rules, typed API contracts, a seven-step SwiftUI onboarding flow, and connected Today, Week, Groceries, Prep, recipe-detail, meal-status, and swap-comparison screens.

Completed onboarding profiles persist with iOS file protection and synchronize through the authenticated profile API without blocking offline use. Adopted reviewed plans restore into a separate protected per-user cache and drive Today, Week, Groceries, Prep, recipe, meal-status, and safe-swap screens. Grocery, meal-status, prep, and profile changes save locally first, replay in order, retry on foreground activation and registered iOS Background App Refresh, and expose conflict/review state. Authenticated feature flags use compiled-off defaults, a short protected account/app-version cache, foreground refresh, and defensive emergency-off behavior; `weekly_insights` gates the first gradual native experience. Authenticated bootstrap records first/latest app version and a coarse first-known acquisition source without sending client identity or behavioral data. Optional first-party product measurement is separately default-off, account-consented, and limited to the strict 26-event PRD catalogue. Authorized devices also register an account-bound APNs token so completed background plans can open directly in Plan Studio; live Apple credentials and sandbox delivery still require configuration. A clearly labelled local preview remains when no adopted plan is available; live Apple products and production email delivery require configuration.

The application has been compiled, installed, and launched successfully on the iOS 26.5 iPhone 17 Pro Simulator. See `ios/README.md` for build details. Physical-device and distribution builds require choosing the correct Apple development team in Xcode.

## Run the local API

From `backend`, run `npm ci`, then `npm test` or `npm start` for the development service at `127.0.0.1:8080`. Development magic links are printed to that terminal; raw tokens are never returned by the request endpoint. Supplying `DATABASE_URL` enables durable consumer persistence, and a separate leased worker executes plan generation, portable exports and account erasure. For a production-shaped laptop environment with PostgreSQL, migrations, worker, synthetic catalogue and an automated full-flow check, see `docs/LOCAL_END_TO_END_METHOD.md`. See `backend/README.md`, `docs/STAGING_DEPLOYMENT_METHOD.md`, `docs/BACKEND_DURABILITY_METHOD.md`, `docs/DURABLE_PLANNER_METHOD.md`, and `docs/AUTH_CONTRACT_EXTENSION.md` for the runtime boundary and remaining production gaps.

## Verify a release candidate

Run `scripts/verify_release_candidate.sh` from the project root to validate the deployment template, execute the complete backend and shared Swift checks, build Debug and Release, and run all native application and simulator journey tests. It creates build products only in a temporary folder and removes them afterward. Set `NOURISH_SIMULATOR_DESTINATION` to override the default latest iPhone 17 Pro simulator, or `NOURISH_NODE_BIN` when Node.js 24+ is not on PATH.

Use `scripts/verify_release_candidate.sh --staging` only after supplying the documented DigitalOcean environment values. Staging mode adds the fail-closed rendered-configuration preflight and prints only its non-secret summary; it does not create or modify cloud resources.

The service also implements and connects the exact 26-event PRD analytics catalogue with default-off server-backed consent, strict app/server authority, bounded properties, authenticated identity derivation, hashed idempotency, and scheduled retention cleanup. Plan outcomes and weekly mutations emit only after authoritative writes; purchase and subscription events require verified Apple data. See `docs/ANALYTICS_EVENT_METHOD.md`.

The same service contains configuration-gated catalogue administration for reviewed ingredient/conversion and nutrient-evidence ingestion plus transactional recipe draft, submit, approve/publish, reject, audit, and immutable version succession. With `DATABASE_URL`, these workflows, provenance, and snapshotted recipe/ingredient metadata are durable in PostgreSQL. A responsive private Control Room at `/admin/` opens on privacy-safe owner insights with formula-bound KPIs, complete PRD filters, activation/cohort views, freshness evidence, accessible tables, and small-group suppression; authenticated native analytics-dimension ingestion now supplies its app-version and coarse acquisition filters. It also exposes exact-match audited user support, security-admin controlled feature flags, authorized aggregate and minimized account CSV exports, the catalogue workflow, operator plan diagnostics, and subscription reconciliation cases with preserved-access policy and accountable verified rechecks. User support is read-only, reason-required, records found and not-found attempts, and offers no impersonation. Feature flags enforce emergency disable, app-version boundaries, allowlists, and deterministic percentage rollout with versioned audit. Account exports require exact identity plus separate creation and delivery reasons, live only in private storage, and expire after 24 hours. Operational projections exclude profile answers, meal history, raw planner seeds, complete Apple transaction identifiers, account tokens, signed payloads, and analytics user rows. The backend now supports MFA-verified, hash-only admin sessions, persisted role grants, revocation, and append-only access audit; the workforce identity provider still needs selection/configuration. See `admin/README.md`, `docs/ADMIN_ANALYTICS_METHOD.md`, `docs/ANALYTICS_DIMENSION_INGESTION.md`, `docs/USER_SUPPORT_METHOD.md`, `docs/FEATURE_FLAG_METHOD.md`, `docs/ADMIN_EXPORT_METHOD.md`, and `docs/ADMIN_SECURITY_METHOD.md`.

Authenticated plan jobs use the stored profile and published catalogue snapshots, require idempotency keys, and expose immutable results, diagnostics, history, adoption, and future activation. Native Plan Studio restores generation progress, explains failures, supports safe meal locks and regeneration reasons, and records meal/weekly feedback. See `docs/PLANNER_METHOD.md` for hard/soft rules, reproducibility, leftovers, scoring, lifecycle, and current limitations.

The weekly-loop service exposes adopted active-plan discovery, safe swap candidates, idempotent swap confirmation, and revision-checked grocery, meal-status, and prep updates. Confirmed swaps create a new immutable plan and derive grocery/prep results atomically. See `docs/WEEKLY_LOOP_METHOD.md`.

Native settings edit all planning preferences with explicit current-versus-next-plan scope. Plan-start weekday drives initial generation, and iOS schedules contextual shopping, prep, enabled-meal, weekly-review, and next-plan reminders whose taps route into the relevant screen. StoreKit purchase-history sync submits transaction JWS values for independent server verification/account binding; Apple's subscription-management sheet and the server-owned entitlement snapshot are connected. Account export and destructive deletion have authenticated idempotent routes; deletion invalidates all sessions, cancels native reminders, clears protected local state, and explicitly separates App Store cancellation. Legal/wellness and privacy-safe support summaries are also available. See `docs/ACCOUNT_LIFECYCLE_METHOD.md` for the trust boundary and remaining production work.

Background synchronization uses a registered app-refresh task, a 15-minute-to-6-hour bounded exponential retry policy, and explicit task expiration handling. Successful acknowledgement cancels the pending request; revision conflicts remain visible for user review instead of being overwritten. See `docs/BACKGROUND_SYNC_METHOD.md`.

## Requirements governance

`docs/REQUIREMENTS_TRACEABILITY.md` is generated directly from the supplied product specification and tracks all 71 numbered requirements plus consumer/admin endpoints, structured errors, analytics events, notification rules, data entities, architecture, security controls, test strategy, release gates, and unresolved decisions.

Regenerate it with `scripts/build_traceability.py` after the source document or implementation evidence changes.

## Planner rule checks

Run `node planner.test.js` to verify accidental-repeat detection, intentional-leftover handling, and recent-recipe fatigue scoring.
