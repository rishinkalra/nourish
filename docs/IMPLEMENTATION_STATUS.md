# FamilyChef implementation status

Updated 2 August 2026.

## Current outcome

The locally actionable v1.0 product, native app, service, database, admin, privacy, operations and release-engineering work is implemented and evidence-mapped. The generated register contains 71 numbered requirements and no numbered requirement remains `not_started`. `partial` now means that the remaining proof depends on a qualified reviewer, account owner, paid vendor, deployed production-like infrastructure, Apple sandbox, physical-device matrix or beta population.

The source-of-truth documents are:

- `REQUIREMENTS_TRACEABILITY.md` for every numbered requirement, interface, release criterion, evidence path and remaining qualification;
- `PRODUCTION_OWNER_CHECKLIST.md` for the exhaustive non-local production gates;
- `FAMILYCHEF_DOMAIN_CONFIGURATION.md` for the approved public/API/Control Room/email hostname boundary and DNS sequence;
- `DIGITALOCEAN_STAGING_COST.md` for the current billable staging estimate and approval envelope;
- the focused method documents in this folder for operation and verification details.

## Product and native app

- Accessible SwiftUI onboarding covers wellness eligibility, authentication choice, editable goals and targets, vegetarian/eggetarian/vegan/non-vegetarian diets, allergens/exclusions/dislikes, cuisines, meal slots, equipment, budget, cooking time/days, leftovers, estimate acknowledgement and review.
- Calorie targets remain user-provided until a qualified professional approves the estimator formula and guardrails. The UI does not present an unreviewed estimate as advice.
- Email magic-link authentication, rotating sessions, Keychain persistence, account restore, sign-out, export and deletion flows are implemented. Sign in with Apple is fail-closed until the owner configures the capability and verifier.
- Adopted reviewed plans drive Today, Week, Groceries, Prep, recipe detail, meal status, swaps, feedback and weekly review. Offline state uses protected per-account persistence, optimistic revisions, idempotent mutations and background retry.
- Daily cards show planned calories against the snapshotted target, protein against the optional user target, and planned protein/carbohydrate/fat estimates without inventing unapproved macro targets.
- Users can favorite a reviewed recipe from recipe detail. Favorites persist per account, feed future generation requests and never override diet, allergen, exclusion, equipment, publication or variety rules.
- StoreKit presentation uses only configured products and Apple-localized price/term data. Entitlement changes require independently verified Apple evidence.
- English/Hindi catalogue coverage, largest Dynamic Type journeys, contrast checks, accessibility labels/focus and no-custom-motion behavior are implemented; professional translation and complete physical-device VoiceOver review remain owner gates.
- A bundled privacy manifest declares no tracking and the conservative data categories currently used by the app.

## Backend, data and content

- Node 24 API and worker support durable PostgreSQL authentication, profiles, reviewed catalogue, planning/history/adoption, weekly operations, feedback, subscriptions, privacy requests, analytics, feature flags, rate limits, push registration, operational notifications and AI recipe quarantine.
- PostgreSQL has 28 checksum-verified migrations. Same-client transactions, compare-and-set revisions, append-only audit, hashed tokens, leased/idempotent jobs, bounded retries and dead-job handling are covered.
- The planner enforces reviewed/current content, diet, allergens, exclusions, dislikes, slots, equipment, serving bounds and variety before preference scoring. It builds seven local dates, whole-week nutrition evidence, groceries, prep, batches and explicit leftover lineage.
- Concurrent duplicate regeneration collapses to one durable job; locked batch lineage is retained and revalidated.
- Recipe Studio creates bounded Indian-locale briefs, requests structured OpenAI recipe/image output, calculates nutrition deterministically from gram-weighted ingredient evidence and keeps everything in encrypted quarantine. Review, import, reject and discard actions are implemented; generated content never auto-publishes.
- Operational messages include plan-ready, export-ready, trial-ending and material account-security templates with privacy-minimized deep links. Trial scheduling stays disabled until consent and commercial terms are approved.
- Portable export, erasure and export-retention workers operate through encrypted private storage and auditable database transitions.

## Admin and operations

- The private Control Room covers catalogue review, Recipe Studio quarantine, plan-run diagnostics, subscription reconciliation, KPI/cohort analysis, exact-match minimized support, feature flags and accountable exports.
- Administrator access is server-owned, role-gated, MFA-aware, expiring, revocable and append-only audited. A local static key exists only for development.
- First-party analytics uses the exact 26-event typed catalogue, default-off consent, server-derived identity for authoritative outcomes, bounded fields and 90-day default retention.
- API responses advertise compatibility version 1. The frozen native/API compatibility window has an executable regression check.
- Structured telemetry carries validated correlation IDs across API, jobs, privacy, notification, subscription and recipe-generation work without raw health or credential data.
- The DigitalOcean template defines separate 512 MiB API, worker and migration components, disposable PostgreSQL 16 development storage, private Spaces-compatible encrypted storage, health checks and initial resource alerts. This USD 22 base topology fits the owner-approved USD 30 staging envelope but must use test data only; managed PostgreSQL backup/recovery qualification remains a production gate. The `FamilyChef Staging` project, USD 25 spend alert and restricted `familychef-staging-private` SYD1 Space now exist; BLR1/SGP1 Spaces were unavailable to this account at creation time. Staging is pinned to `api-staging.familychef.in`, its Control Room CORS boundary is `control-staging.familychef.in`, and transactional email uses the future verified `familychef.in` sender. The iOS Release build is pinned to `api.familychef.in`. The template cannot deploy automatically and its renderer fails closed on placeholders or unsafe configuration.

## Current verification evidence

- Complete backend suite: 156 checks pass.
- Shared Swift core checks pass.
- Debug and Release iOS simulator builds pass.
- Native application tests: 15 pass.
- Native UI journeys: 18 pass, including Hindi largest-text onboarding, active plan, swap, paywall, settings, reminders, legal/support and favorite control coverage.
- Real local PostgreSQL journey passes through authentication, profile, worker-owned seven-day/21-meal generation, adoption, groceries, prep, concurrency, idempotency and locked lineage.
- Local performance evidence records worker-backed generation below 8 seconds and 20 active-plan reads below the 1-second p95 gate.
- Isolated local dump/restore rehearsal matches all 28 migrations and the 14-recipe guarded catalogue, then removes the temporary database.
- Privacy manifest lint, dependency privacy review and v1 API compatibility checks pass.
- `scripts/verify_release_candidate.sh` is the one-command release gate; staging mode additionally invokes the fail-closed DigitalOcean preflight.

## What remains

No additional item can be truthfully completed only by changing local code. Production still requires the owner-dependent checklist in `PRODUCTION_OWNER_CHECKLIST.md`: the new legal/Apple organization, counsel and nutrition approval, licensed reviewed content, paid cloud resources and secrets, production identity/email/monitoring, Apple sandbox and APNs evidence, managed backup/restore/failover, professional translation/accessibility review, physical-device performance/background/offline evidence and statistically valid beta gates.

Until those controls are complete, this is a verified local release candidate—not an authorized production release.
