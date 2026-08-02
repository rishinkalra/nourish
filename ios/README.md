# Native FamilyChef app

FamilyChef is the customer-facing app name. The historical `NourishApp`, `NourishUI`, `NourishAPI` and `NourishCore` target/module names remain internal to preserve build and migration stability. This Swift package contains the production-facing iOS foundations:

- shared profile and onboarding models;
- eligibility, calorie-target, cooking-day, and estimate acknowledgement validation;
- exact-recipe, dominant-ingredient, intentional-leftover, and recent-fatigue variety rules;
- immutable recipe and seven-day local-date plan snapshots;
- hard diet, allergen, ingredient-exclusion, publication, review, and meal-slot eligibility;
- typed contracts for every documented consumer API route and structured error category;
- optimistic profile revisions and explicit current-versus-next-plan change scope;
- durable onboarding profiles using atomic, iOS file-protected local storage;
- redacted session-token models and a Keychain store using after-first-unlock, this-device-only accessibility;
- tested Apple credential, email magic-link request/callback, restore, refresh, and sign-out service boundaries;
- a real URLSession authentication/profile client connected to the local development service;
- a local-first profile sync engine covering first upload, existing-account restore, offline edits, conflict preservation, and retry state;
- canonical ingredient, unit-conversion, nutrient-source, recipe identity, and immutable recipe-version models;
- publication validation for source licensing, nutrient review/effective dates, allergens, diet compatibility, servings, method, and nutrition;
- an audited author/reviewer workflow that prevents self-approval and edits to published versions;
- recipe detail and settings content status showing version, draft/review/publication state, provenance limitation, and methodology;
- deterministic seven-day planning with hard safety filters, stable scoring, explicit leftovers, safe locks, diagnostics, and immutable snapshots;
- a URLSession plan client for authenticated idempotent generation, result reads, and adoption;
- a native Plan Studio for resumable generation, typed failure guidance, seven-day macro review, separate adoption, immutable history, and scheduled next-week activation;
- account-owned meal locks with server safety revalidation, reasoned future-week regeneration, individual meal ratings, and weekly completion/change review;
- a complete planning-preference editor with explicit current-and-future or next-plan-only scope;
- plan-start weekday behavior plus persisted shopping, prep, enabled-slot meal, weekly-review, and next-plan reminder controls;
- contextual iOS notification permission, OS calendar scheduling, cancel-all behavior, and deep links into groceries, prep, meal detail, review, and Plan Studio;
- StoreKit purchase-history synchronization that submits verified transaction JWS values for independent server verification/account binding, plus Apple's native subscription-management sheet;
- StoreKit product loading and purchase presentation using Apple-provided localized metadata, the server-issued app-account token, server-confirmed transaction finishing, and a signed-in transaction-update listener;
- authenticated server entitlement reads covering every specified lifecycle state and delayed reconciliation;
- retry-safe account export and destructive deletion requests with visible queued receipts;
- deletion controls that invalidate the account, cancel reminders, clear protected profile/plan state, and restart onboarding;
- in-app privacy, terms, wellness, nutrition-methodology, and confirmation-gated anonymized support summaries;
- normalized grocery aggregation that retains household-unit context and does not double-count planned leftovers;
- plan-derived prep timelines with active time, storage/reuse guidance, and stable source relationships;
- whole-plan-safe swap ranking and atomic plan/nutrition/grocery/prep recalculation;
- protected per-user weekly-loop persistence with revisions, idempotent mutation IDs, pending-sync journaling, and an authenticated URLSession client;
- adopted-plan discovery, clean-device restore, local-first ordered mutation replay, authoritative refresh, and visible offline/conflict/retry state;
- foreground lifecycle recovery and registered iOS Background App Refresh for queued profile and weekly-loop mutations, with bounded exponential backoff and expiration handling;
- authenticated feature-flag bootstrap with compiled-off defaults, 15-minute protected per-user/app-version cache, foreground refresh, defensive emergency-off handling, and a gated weekly-insights card;
- non-blocking authenticated analytics-dimension bootstrap that sends only installed app version and a bounded first-touch acquisition source, never a client user ID;
- default-off first-party product measurement with server-backed account consent, a strict 12-event app boundary, and best-effort authenticated recording from the connected native product flows;
- onboarding email-link controls, custom callback URL handling, authenticated profile display, and sign-out;
- a seven-stage SwiftUI onboarding flow;
- optional user-provided protein targets and available-kitchen-equipment capture, with no generated nutrition recommendation;
- connected Today and seven-day Week views using adopted reviewed-plan snapshots when present, with clearly labelled sample data only as a fallback;
- recipe detail, meal-status controls, and swap comparison with calorie/protein deltas;
- interactive grocery check/pantry state, quantity editing, relaunch persistence, and NEW/UPDATED swap labelling;
- grouped prep tasks with active time, storage notes, reuse guidance, and completion state;
- automated native checks for onboarding safety, plan variety, reminder validity, meal-slot gating, unique schedule IDs, deep links, and plan-start weekday resolution;
- first-class XCTest targets with fifteen domain/API/privacy/localization/accessibility tests and eighteen simulator UI journeys covering onboarding gates, core navigation and Plan Studio, reviewed-plan adoption, whole-week-safe swap and grocery recalculation, offline grocery persistence and replay, honest paywall presentation, default-off measurement consent, destructive-account confirmation, safe API-origin selection, stable redacted push-token encoding, and Hindi onboarding, illustrative fallback, reviewed-week, paywall, Settings, Plan Studio, Profile Editor, Reminders, Legal, Support and favorite flows at the largest accessibility text size;
- an English-source string catalogue with 463 Hindi-covered strings spanning onboarding, navigation, active-week sync, meal/swap/grocery controls, active and illustrative nutrition/status labels, typed domain values, API/runtime success and failure states, plan adoption/review, Settings and profile editing, reminders and notification guidance, paywall disclosure, long-form privacy/legal/wellness/nutrition content, support controls, favorites and deletion copy, plus locale-aware date, number, unit, and currency formatting helpers;
- matching native and server `wellness-score-v3` policies for exact meal-specific shares, optional protein deviation, cost bands, equipment compatibility/load, reviewed serving bounds, grocery-overlap ranking, whole-week serving optimization, ±5% daily/±3% weekly tolerance evidence, and deterministic soft-relaxation diagnostics;
- theme-linked WCAG contrast measurement that enforces 4.5:1 for branded text and 3:1 for graphical accents so palette changes cannot silently weaken critical contrast;
- a real Xcode application target that runs the package-backed SwiftUI app.

Open `NourishApp/NourishApp.xcodeproj` in Xcode, choose an iPhone Simulator, and run the shared `NourishApp` scheme. The target uses the local package in this folder, so changes to `NourishCore`, `NourishAPI`, or `NourishUI` are picked up directly. For physical-device staging tests, select the shared `FamilyChef Staging` scheme; it connects the Debug app to the current DigitalOcean HTTPS origin while the ordinary `NourishApp` scheme continues to use the local service.

Run `swift run NourishCoreChecks` from this folder to verify the shared domain layer. The shared `NourishApp` scheme also includes `NourishAppTests` and `NourishAppUITests`; use Xcode’s Test action on an iPhone Simulator to run the fifteen XCTest cases and eighteen end-to-end UI journeys together. Debug uses the local API origin; the `FamilyChef Staging` launch scheme overrides Debug with the temporary DigitalOcean staging origin; Release is pinned to `https://api.familychef.in`.

All meals and nutrition values in the native fallback plan are illustrative. Its recipe detail deliberately shows an unapproved-content notice so sample data cannot be mistaken for reviewed production nutrition. An authenticated adopted plan instead renders its immutable published and approved recipe snapshots across Today, Week, Groceries, and Prep.

Start the service in `../backend` with `npm start` to use authentication, profile sync, adopted-plan activation, and weekly-loop synchronization. The Debug build receives `http://localhost:8080` through the `NOURISH_API_BASE_URL` build setting. Release builds fail closed while the setting contains its placeholder and accept only a clean HTTPS origin; HTTP is allowed solely for exact loopback hosts in Debug. One validated origin is injected into authentication and every authenticated remote, preventing a mixed local/staging session. After staging deployment, set the Release value to the DigitalOcean API's final HTTPS origin. The app registers the `nourish://auth/magic-link` callback, keeps the resulting opaque session in Keychain, and partitions protected plan state by account. Debug-build-only launch hooks, fixtures, and state probes support repeatable simulator integration checks; none are present in Release builds.

The ordinary Debug configuration deliberately omits the APNs entitlement so local device testing still works with a Personal Development Team. A paid Apple Developer Program team with Certificates, Identifiers & Profiles access is required for push. For an approved sandbox build, override `CODE_SIGN_ENTITLEMENTS` with `NourishApp/NourishApp.Debug.entitlements`; Release continues to use `NourishApp.Release.entitlements` and therefore fails closed until production push signing is available.

Authenticated bootstrap also calls `GET /v1/feature-flags` with the installed app version. Only compiled keys can affect the app. Fresh decisions are cached for no more than 15 minutes in user-partitioned protected storage; stale or malformed data, service failure without a fresh cache, sign-out, and emergency-disable decisions all resolve to off. The `weekly_insights` key gates the active-week summary without changing the default experience.

Authenticated bootstrap also records the installed marketing version through `POST /v1/analytics/dimensions`. Acquisition remains `unknown` unless the app receives an explicit attributed link with one of the approved coarse values. The first known source is retained and later links cannot overwrite it. This best-effort operation contains no client user ID, profile answer, meal data, advertising identifier, or device fingerprint and never blocks entry to the product. See `../docs/ANALYTICS_DIMENSION_INGESTION.md`.

First-party product measurement is separate and off by default. An authenticated user can enable **Share first-party product usage** under Privacy & measurement. The app first updates account consent through `PATCH /v1/analytics/consent`; only then may it send one of the 12 client-observed PRD events through `POST /v1/analytics/events`. Turning the switch off disables both app and server event collection for that account. All 12 app-observed events are connected to their native flows: app open, onboarding, generated-plan preview, reviewed meal and swap views, grocery and prep opens, paywall display, and notification routing. First-run onboarding remains unmeasured until consent exists; consent is never applied retroactively. See `../docs/ANALYTICS_EVENT_METHOD.md`.

The account section reads entitlement only from the authenticated server contract. StoreKit sync never grants access directly in the app; each current verified transaction is submitted for independent server verification before the snapshot refreshes. Export and deletion keep an idempotency key until the server confirms receipt, so uncertain network responses are safe to retry. Product loading and purchase/paywall presentation, live Apple products/credentials and sandbox fixtures, production privacy infrastructure, and final legal/support destinations remain.

The app registers `com.projectnourish.app.sync` during launch and declares the permitted identifier and background-fetch mode in its Info.plist. Pending local profile or weekly-loop state schedules one refresh request. A failed run backs off from 15 minutes to a six-hour cap; an acknowledged queue cancels the request. iOS ultimately decides execution time, so physical-device energy, networking, force-quit, and Background App Refresh-disabled cases remain release QA.

The specification defines Apple exchange and magic-link request routes but omits refresh, revocation, and magic-link callback endpoints. Those additions are implemented locally and explicitly documented as proposed in `../docs/AUTH_CONTRACT_EXTENSION.md`. Apple capability/verifier setup and production email delivery remain configuration work.

Verified locally with Xcode 26.6 and the iOS 26.5 iPhone 17 Pro Simulator. The app deployment target remains iOS 17. Device signing will require selecting the appropriate Apple development team in Xcode.
