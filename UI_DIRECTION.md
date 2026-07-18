# Nourish UI direction

## Product experience

Nourish should feel like a calm weekly food companion, not a calorie ledger. The home screen begins with the next useful decision—what to eat today—then keeps calories and macros visible but secondary. The experience follows the product loop in the specification: plan → shop → prepare → eat → review → improve.

## Navigation

The first release uses four primary destinations:

1. **Today** — the next meal, today's plan, completion, nutrition range, and a practical nudge.
2. **My week** — the seven-day plan, calorie/protein summaries, ingredient reuse, and meal swaps.
3. **Groceries** — one consolidated, categorized list with pantry separation and live progress.
4. **Prep plan** — ordered batch-prep tasks, time saved, and storage guidance.

Profile, subscription, privacy, support, history, and favorites remain secondary destinations. This keeps the core weekly loop easy to reach with one thumb.

## Visual system

- Warm ivory backgrounds make the experience domestic rather than clinical.
- Forest green signals trust and structure; fresh lime is used sparingly for progress and success.
- A soft serif is reserved for welcoming page titles. Everything operational uses a clean system sans-serif.
- Photography shows achievable Indian home cooking rather than aspirational restaurant plating.
- Nutrition is expressed as ranges, progress, and plain-language context. Safety and estimate copy stays close to the relevant values.

## Key interaction principles

- Allergens and explicit exclusions are never silently relaxed.
- A swap explains that alternatives remain valid and shows the calorie/protein difference before confirmation.
- Completion is a lightweight tap, not a logging workflow.
- Grocery and prep state works as a checklist and is designed to persist offline later.
- Empty and no-feasible-plan states should offer specific, safe constraint changes instead of a dead end.

## Onboarding

The onboarding prototype compresses the specification's ten journey stages into seven user-facing steps while retaining every critical input:

1. Explain the outcome before requesting an account.
2. Confirm 18+ eligibility and general-wellness suitability.
3. Choose Apple sign-in or an email magic link.
4. Select maintain/gradual-loss/gradual-gain and provide a calorie target.
5. Capture diet, allergens, ingredients to avoid, and cuisine preferences.
6. Capture budget, active cooking time, cooking days, and leftover preference.
7. Review the plan contract and explicitly acknowledge that nutrition values are estimates.

The production flow then adds server-side constraint validation, generation progress, a three-day preview, subscription decision, plan adoption, reminders, and grocery activation. Authentication and payment are represented but not executed in this prototype.

## Repetition and leftovers

Repetition is not a single yes/no setting. The planner must distinguish:

- **Accidental exact repetition** — discouraged and limited to one fresh appearance per recipe per week by the current prototype rule.
- **Intentional leftovers** — allowed when linked to a batch, labelled in the plan, and within the user's tolerance.
- **Dominant-ingredient repetition** — limited so a week does not become paneer- or rice-heavy despite different recipe names.
- **Recent-recipe fatigue** — recipes from recent weeks receive a ranking penalty.
- **Ingredient reuse** — encouraged when it reduces waste without creating monotonous meals.

All of these are plan-quality rules. They never weaken diet, allergen, or explicit ingredient exclusions.

## Current implementation boundary

The consumer browser experience remains a visual interaction prototype, while the native SwiftUI application now carries the authenticated, locally durable weekly loop. The backend includes memory and PostgreSQL runtime boundaries for identity, profiles, reviewed catalogue content, plans, weekly operations, entitlements, and privacy work. The new private Control Room covers catalogue review and audit operations on desktop and phone. Production infrastructure, licensed content population, admin identity/MFA, and the broader owner operations modules remain.

## Suggested next build slices

1. Production admin identity, MFA-ready sessions, persisted grants, and access audit.
2. Dashboard ingredient/nutrient entry plus source-mapping import review.
3. Plan-run diagnostics with rule versions, candidate pools, failures, and correlation IDs.
4. KPI/cohort, subscription timeline, feature-flag, and authorized export modules.
5. Live PostgreSQL, Apple sandbox, physical-device background, accessibility, and performance validation.
