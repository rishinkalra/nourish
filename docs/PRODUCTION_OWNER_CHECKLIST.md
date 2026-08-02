# FamilyChef production owner checklist

This is the exhaustive hand-off for work that cannot be completed or truthfully verified on a local development machine. All locally actionable engineering work is tracked in `REQUIREMENTS_TRACEABILITY.md`; an unchecked item below requires an account owner, paid service, production credential, qualified reviewer, deployed environment, or real beta population.

## 1. Company, Apple and commercial ownership

- [ ] Finish enrollment in a new Apple Developer Program organization owned by the intended FamilyChef legal entity; grant Account Holder/Admin access for Certificates, Identifiers & Profiles.
- [x] Adopt FamilyChef as the customer-facing app/web brand and `familychef.in` as its domain family; preserve the internal project identifiers and existing bundle identifier until the Apple organization is ready.
- [ ] Confirm the final legal entity, App Store positioning, launch geography, supported diets/cuisines, age position, customer-support ownership and grievance contact.
- [ ] Create App Store Connect products and approve monthly/annual pricing, introductory offer or trial, preview depth, tax/accounting treatment and customer-facing terms.
- [ ] Configure the App ID, Sign in with Apple, APNs keys, distribution certificates/profiles, App Store Server API credentials and Server Notifications V2 URL.
- [ ] Complete sandbox evidence for purchase, trial if enabled, renewal, cancellation, expiration, billing retry/grace, upgrade/downgrade, refund/revocation, restore, account switching and temporary server failure.
- [ ] Complete App Store privacy answers and public policy/support URLs so they match `privacy_inventory.json` and the bundled `PrivacyInfo.xcprivacy`.
- [ ] Approve a TestFlight release and the public-release beta gates.

Local evidence: `SUBSCRIPTION_OPERATIONS_METHOD.md`, `ENTITLEMENT_RECONCILIATION_METHOD.md`, `PUSH_NOTIFICATION_METHOD.md`, `PRIVACY_GOVERNANCE_METHOD.md`.

## 2. Legal, privacy, wellness and content approval

- [ ] Have counsel approve privacy policy, terms, DPDP duties, processor/subprocessor list, data regions/transfers, retention, deletion, non-sale position, breach process and user-rights handling.
- [ ] Have a qualified nutrition professional approve the calorie-estimator and any optional macro-target formula, permitted inputs, contraindications, guardrails and version. Until then the app must continue accepting user-provided calorie/protein targets, show other macros as planned estimates, and must not present an unreviewed estimate as advice.
- [ ] Have qualified reviewers approve the wellness disclaimer, nutrition-estimate language, storage/reheating windows, recipe review policy and AI-estimated nutrition disclosure.
- [ ] Approve recipe, nutrient-source and photography rights. Populate enough licensed or internally authored, separately reviewed catalogue versions for every launch diet/locale; AI output must remain quarantined until a human approves it.
- [ ] Configure the production OpenAI organization/project, retention/training terms, restricted key and spending limits; run the first controlled generation and review.
- [ ] Complete professional Hindi review and supported-locale validation.

Local evidence: `AI_RECIPE_GENERATION_METHOD.md`, `NUTRITION_DATA_METHOD.md`, `PRIVACY_GOVERNANCE_METHOD.md`.

## 3. Production infrastructure and secrets

- [x] Approve the USD 30/month staging envelope in `DIGITALOCEAN_STAGING_COST.md` (approved by Rishin on 2 August 2026).
- [ ] Configure the USD 25 notification-only billing alert and provision the DigitalOcean BLR App Platform API/worker/migration components, disposable development PostgreSQL, a private BLR1 Space and final HTTPS domains/DNS.
- [ ] Create separate least-privilege API and worker storage identities; keep all secrets in the platform secret store, not source control.
- [ ] Generate and escrow the application-encryption key ring; document rotation, recovery, owner access and offboarding.
- [ ] Run the fail-closed DigitalOcean preflight, 28 checksum-verified migrations, readiness/smoke checks, production-like concurrency test and rollback rehearsal.
- [ ] Validate managed PostgreSQL point-in-time recovery, failover, encryption and isolated restore; validate private-object backup/replica expiry, complete deletion, signed delivery and downstream-processor deletion.
- [ ] Configure the independent shared rate limiter and calibrate authentication/export thresholds under production-shaped concurrency.

Local evidence: `DIGITALOCEAN_STAGING_METHOD.md`, `DIGITALOCEAN_STAGING_COST.md`, `STAGING_DEPLOYMENT_METHOD.md`, `DISASTER_RECOVERY_METHOD.md`, `RATE_LIMITING_METHOD.md`.

## 4. Identity, email, monitoring and operations

- [ ] Select and configure the workforce identity provider; require MFA and assign separate author, reviewer, operator and security-admin grants.
- [ ] Configure Brevo with an authenticated sending domain, anonymous transactional tracking enabled, recipient-level tracking prohibited, approved short log/content retention and DPA; validate magic-link and operational mail in representative inboxes.
- [ ] Select the monitoring/log destination and on-call owner; activate uptime, latency, error, queue/dead-job, webhook, restart, CPU and memory alerts plus dashboards and escalation routes.
- [ ] Run alert, incident, rollback, restore, breach-assessment and key-rotation drills; record owners, dates and outcomes.
- [ ] Approve whether any production attribution mechanism is needed. Keep it absent unless its privacy review and disclosures are complete.
- [ ] Decide whether trial-ending notifications will be used; record explicit notification consent and confirm Apple offer terms before enabling their scheduler.

Local evidence: `ADMIN_SECURITY_METHOD.md`, `EMAIL_DELIVERY_METHOD.md`, `OBSERVABILITY_METHOD.md`, `OPERATIONAL_NOTIFICATION_METHOD.md`.

## 5. Real-device and beta release evidence

- [ ] Validate VoiceOver traversal, Dynamic Type, contrast, focus order and reduced-motion behavior on the supported physical-device matrix.
- [ ] Validate offline cache migration, storage pressure, background refresh, force-quit, low-power and network-transition behavior on physical devices.
- [ ] Validate APNs sandbox delivery and deep links on an authorized physical device.
- [ ] Collect at least 100 eligible physical-device cold launches and cached-plan opens; meet the documented p95 thresholds.
- [ ] Collect at least 100 production-shaped successful plan generations and the agreed beta sample; meet generation p95, plan-success and crash-free gates.
- [ ] Reconcile beta dashboards against controlled source data and sign off launch error budgets.

Local evidence: `SERVICE_LEVEL_AND_PERFORMANCE_METHOD.md`, `BACKGROUND_SYNC_METHOD.md`, `PUSH_NOTIFICATION_METHOD.md`, `ADMIN_ANALYTICS_METHOD.md`.

## Completion rule

Production is ready only when every checkbox above has an accountable owner, dated evidence and approval. Local tests or generated credentials are not substitutes for these controls.
