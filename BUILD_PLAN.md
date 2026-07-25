# Nourish application build plan

## Recommended production shape

- **Consumer app:** SwiftUI, async/await, Keychain, StoreKit, APNs, and a small offline cache.
- **Backend:** versioned REST API with PostgreSQL, background plan jobs, and idempotent mutations.
- **Planner:** independently testable service/module that consumes structured constraints and immutable recipe versions.
- **Owner dashboard:** private Next.js application using a separately authenticated admin API.

## Build sequence

Current status: Slices 1–6 provide the native product loop described below. The durability work now adds PostgreSQL identity, profiles, catalogue author/review/publication, entitlement events, asynchronous plan generation/history/adoption, confirmed swap succession, ratings/reviews, grocery/prep/meal state, privacy requests, checksum-verified migrations, readiness, leased plan/privacy/reconciliation jobs, encrypted S3-compatible private portable exports, paginated account-prefix erasure, and transactional relational erasure. Adopted reviewed plans drive the native Today/Week/Groceries/Prep screens; labelled illustrative drafts remain only as an explicit fallback. A responsive private Control Room covers aggregate owner insights, user support, feature flags, authorized exports, catalogue evidence/decisions, plan diagnostics, and subscription reconciliation behind server-owned MFA, short-lived hash-only sessions, persisted roles, revocation, and append-only audit. Native evaluated flags use protected short-lived caching and compiled-off defaults; authenticated bootstrap records first/latest app version and bounded first-known acquisition source without client-supplied identity. The exact 26-event PRD analytics catalogue now has strict schemas, client/server authority, default-off account consent, authenticated ingestion, idempotency, retention, and all 26 connected product actions. A locked Node container, separate migration job, production configuration gate, independently scalable API/worker staging harness, and automated liveness/durable-readiness smoke contract now define the provider-neutral deployment boundary. The PostgreSQL and private-bucket paths still need validation against provisioned services. Licensed source mapping/population, approved production attribution, workforce identity-provider configuration, live Apple configuration/sandbox validation, and production delivery/monitoring remain.

### Slice 1 — Native foundation

- Create the SwiftUI application and navigation shell.
- Implement the seven onboarding screens and local draft state.
- Define shared profile, dietary constraint, recipe, plan, and plan-item models.
- Add accessibility, localization keys, and analytics event interfaces from the beginning.

### Slice 2 — Accounts and profiles

- Email magic-link exchange, rotating sessions, and revocation are implemented locally and connected to the app.
- PostgreSQL identity/session and revisioned-profile adapters, privacy-safe distributed authentication rate limiting, and provider-neutral transactional email delivery with fail-closed Brevo and Postmark adapters are implemented. Brevo is the preferred initial staging configuration. Next verify its sender domain, anonymous transactional tracking, short provider-log retention, and live inbox delivery; provision and validate the managed database; then calibrate limiter thresholds and email deliverability from operational telemetry.
- Configure Sign in with Apple capability and server-side identity verification.
- Authenticated onboarding profile sync through `GET/PATCH /v1/profile`, including offline retry and revision conflicts, is implemented against the local service.
- Version consent, wellness acknowledgement, target source, and configurable guardrails.

### Slice 3 — Reviewed recipe catalogue

- Ingredient, nutrient-source, recipe, immutable recipe-version, allergen, serving, licensing, and provenance models are implemented.
- Draft → review → separate-reviewer publish/reject, audit, serialized version succession, immutable version metadata/children, and active published pointers are transactional in PostgreSQL mode.
- Native recipe detail and eligibility filtering expose and enforce publication/review state.
- Reviewer-gated ingredient/conversion and immutable nutrient-source/record ingestion now persists provenance and content audit evidence in PostgreSQL mode.
- The private Control Room now exposes the recipe work queue, evidence, validation gates, approval/rejection, and combined activity on desktop and phone. Reviewer-confirmed entry forms cover canonical ingredients, diets, allergens, multiple household conversions, immutable per-100 g values, provenance, licences, confidence, and effective dates; JSON source imports prefill but never bypass review.
- A reviewer-only content inventory restores saved ingredients, conversions, nutrient values, and provenance after refresh.
- Server-owned admin identity exchange, mandatory MFA claims, short-lived hash-only sessions, persisted author/reviewer/operator/security-admin grants, revocation, and access audit are implemented; production still needs a selected workforce identity provider and live database validation.
- Next: connect licensed production source adapters and assign qualified reviewers; subscription reconciliation operations are now available in the private owner dashboard.

### Slice 4 — Planner MVP

- Hard constraints, slot pools, stable selection, repetition/recent pressure, favorites/cuisine signals, cooking load, and explicit batch/leftover relationships are implemented.
- Seven-day output, diagnostics, immutable snapshots, idempotent jobs, plan reads, and adoption are implemented locally.
- PostgreSQL mode now queues generation, snapshots the exact profile revision/request, and atomically materializes the immutable plan, items, normalized groceries and prep through a leased worker.
- Native Plan Studio starts/restores jobs, explains typed failures, previews all seven days and macros, and requires separate adoption.
- Locked meals are supported by the Swift engine and authenticated service; native locks are ownership-checked and revalidated before future-week regeneration.
- Regeneration reason, immutable history, current-versus-scheduled activation, weekly completion review, and meal feedback are implemented locally.
- `wellness-score-v3` adds fail-closed production locale/current-calculation-version gates and a deterministic whole-week serving pass over the safe recipe/leftover structure. It targets ±5% daily and ±3% weekly calories plus configurable optional protein, stays inside reviewer-approved serving bounds, and reports ordered soft relaxations to users/operators without weakening hard safety. Next scoring work is production-catalogue calibration and evaluation of broader global recipe selection.
- The private operator view now searches plan runs and exposes exact generator, scoring, and rule versions; candidate and rejection funnels; diagnostics; typed errors; correlations; durations; and lease/retry evidence without returning stored profile snapshots or raw deterministic seeds.
- Normalized groceries and prep tasks now derive from the generated immutable plan in Slice 5.

### Slice 5 — Weekly loop

- Safe candidates and idempotent confirmation create immutable successor plans and atomically recalculate nutrition, groceries, and prep.
- Grocery normalization, household-unit context, planned-leftover de-duplication, category grouping, quantity/check/pantry state, and swap diffs are implemented.
- Batch-linked prep derivation includes active time, storage/reuse notes, source relationships, and completion state.
- Protected offline reads, optimistic revisions, idempotent mutation IDs, and a pending sync journal are implemented.
- Adopted-plan discovery and per-account protected restore are implemented; reviewed plan data replaces illustrative fixtures whenever an active plan exists.
- Local-first grocery, meal-status, and prep mutations replay through authenticated revision-checked APIs; offline, conflict, and retry states are visible. Safe swaps remain intentionally online-confirmed.
- Native settings now edit the complete planning profile with explicit current-versus-next-plan scope and revision-checked synchronization.
- Plan-start weekday drives initial generation; contextual local shopping, prep, meal, review, and next-plan reminders schedule through iOS and deep-link to their destination.
- Foreground lifecycle recovery and registered iOS Background App Refresh now retry pending profile, grocery, meal-status, and prep mutations with bounded exponential backoff and task expiration handling.
- PostgreSQL active-plan reads, confirmed immutable successor swaps with adoption/audit/recalculation and compatible state preservation, plus grocery, prep and meal-state revisions are durable.
- Server plan-ready push now registers authorized devices to the authenticated account, removes the token before sign-out, enqueues delivery separately from successful generation, retries through the leased worker, deep-links into Plan Studio, collapses duplicate delivery, and retires invalid APNs tokens. Ordinary Personal-Team Debug builds deliberately omit APNs so local phone testing remains available; an explicit development-push entitlement and required Release entitlement remain. Next: obtain an approved paid-team role with Certificates, Identifiers & Profiles access, configure APNs credentials and exercise sandbox delivery on physical devices, validate concurrent swap/revision behavior against live PostgreSQL, add the remaining export/deletion/security operational notification templates, and complete physical-device background scheduling/energy validation.

### Slice 6 — Entitlements and operations

- StoreKit purchase-history sync and native subscription management are connected to an authenticated server entitlement read.
- Server lifecycle state covers active, trial, grace/billing retry, expired, revoked/refunded, upgraded, downgraded, and unknown; transient reconciliation failure retains the last verified access decision.
- Account export/deletion use retry-safe idempotent requests and visible queued receipts. Deletion invalidates every session, cancels device reminders, clears protected local profile/plan state, and explains separate App Store cancellation.
- In-app legal/wellness summaries and confirmation-gated anonymized support sharing are implemented.
- PostgreSQL entitlement/event persistence plus leased export/deletion workers are implemented behind explicit runtime configuration.
- Apple signed-payload verification, notification ingress, product allowlisting, account binding, and the scheduled reconciliation worker are implemented behind explicit configuration.
- The private operator dashboard now searches reconciliation cases, shows preserved-access policy plus Apple/server timelines and retry evidence, and transactionally queues reasoned verified rechecks without allowing manual entitlement overrides.
- The owner-insights home now exposes formula-bound KPIs, freshness, complete PRD filters, activation/cohort views, accessible tables, and suppression for groups below five without returning user-level rows.
- The private operator dashboard now performs exact-match user lookup by internal ID or verified email, requires a support reason, returns only a minimized read-only operational summary, audits found and not-found attempts, and provides no impersonation path.
- Security-admin feature flags now provide deterministic percentage rollout, semantic app-version bounds, bounded internal-user allowlists, JSON values, emergency disable, optimistic version checks, and reasoned append-only audit; authenticated evaluation withholds disabled values.
- Authorized owner exports now provide aggregate KPI/cohort CSV by default, exact-match minimized security-admin account exports, separate creation/delivery reasons, idempotent durable status, private storage, 24-hour logical expiry, and append-only audit.
- Native feature flags now bootstrap after authentication, use compiled-off defaults, isolate a 15-minute protected cache by account and app version, refresh on foreground activation, fail closed on malformed/stale decisions, and gate the first weekly-insights experience with defensive emergency-off behavior.
- Native analytics dimensions now use authenticated, idempotent ingestion with server-derived identity, immutable first app version, advancing latest version, bounded first-known acquisition, and an honest `unknown` default.
- The 26-event first-party analytics catalogue now has versioned bounded properties, strict app-versus-server authority, authenticated identity derivation, default-off account consent, hashed idempotency, explicit retention, and scheduled expiry. All 12 app-observed and 14 server-observed events are connected to authoritative product actions.
- Expired customer and administrator exports now receive scheduled exact-object deletion, conditional purge evidence, append-only success/failure audit, and corrupt-key namespace rejection without blocking later account erasure.
- Native XCTest and UI-automation targets now cover fourteen domain/API/privacy/localization/accessibility cases and eighteen critical simulator journeys. The additional environment-policy and push-token checks prove that Release accepts only a clean HTTPS API origin while Debug permits HTTP solely on exact loopback hosts, and that device tokens have stable redacted encoding. Deterministic debug-only fixtures exercise reviewed-plan adoption, whole-week-safe swap and grocery recalculation, honest unconfigured-paywall presentation, and offline grocery persistence/relaunch/replay through the production stores and views. Hindi onboarding, illustrative fallback, active reviewed-week navigation/sync/swap controls, paywall disclosure, Settings, reviewed Plan Studio, Profile Editor, Reminders, Legal, and Support now run at the largest accessibility text size; selected-day traits, post-swap accessibility focus, descriptive meal/swap hints, named grocery controls, localized helper-generated form sections/statuses, legal heading traits, and explicit diagnostic-sharing semantics are implemented. Long-form legal/reminder copy, active/fallback metric and status labels, onboarding/auth interpolation, critical dynamic form labels, typed domain values, and fixed API/runtime status messages are catalogued, with compiled-catalog regression checks; an automated source audit now finds no interpolated SwiftUI labels. Brand text and graphical colors are bound to executable WCAG 4.5:1 and 3:1 thresholds. Next: complete professional translation and full-device VoiceOver review; after that configure live products/credentials and App Store Connect delivery, validate sandbox lifecycles, validate the live database/object store and analytics workers, and finalize counsel-approved policy/support/measurement language.

## Gate before production planning

- Finalize launch diets and cuisine coverage.
- Approve calorie-estimator formula and safety thresholds with a qualified nutrition professional.
- Decide pricing, trial, and preview depth.
- Select backend, analytics, email, monitoring, and hosting vendors.
- Confirm recipe and nutrient-data rights.
