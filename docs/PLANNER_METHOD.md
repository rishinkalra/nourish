# Deterministic weekly planner method

## Safety boundary

The planner may only consider an immutable recipe snapshot whose publication status is `published` and nutrition review status is `approved`. Diet compatibility, allergens, explicit ingredient exclusions, disliked canonical ingredients/display names, enabled meal slots, maximum active cooking time, eligible locale, and current nutrition-calculation version are evaluated before ranking. Production server startup fails closed unless the eligible-locale and current-calculation-version allowlists are configured. A favorite, cuisine preference, calorie fit, recent-meal history, grocery overlap, or deterministic tie-breaker can never restore a rejected candidate.

Locked meals are revalidated against the current profile and rules. If a previously locked item is no longer safe, generation rejects the lock instead of silently preserving it.

## Reproducibility

Generation is a pure operation over:

- profile and target snapshot;
- week-start local date and timezone;
- exact published recipe versions;
- recent and favorite recipe IDs;
- optional snack choice;
- locked items and regeneration reason;
- generator, scoring, eligibility-rule, and variety-rule versions;
- a stable seed.

Candidates are ordered by a stable digest after their calculated score. Identical inputs and versions therefore produce identical plan IDs, selections, leftovers, totals, explanations, and diagnostics. Runtime-random hash functions are not used for selection.

## Assembly

1. Build a hard-eligible candidate pool for each enabled slot.
2. Traverse seven consecutive local dates and enabled slots in a fixed order.
3. On configured non-cooking days, prefer a valid linked leftover from an earlier batch source.
4. Otherwise rank fresh candidates with the versioned `wellness-score-v3` policy using meal-specific calorie share, optional user-provided protein share, budget/cost band, equipment load, active time, ingredient reuse, variety pressure, recent-recipe fatigue, cuisine preference, and favorite reward.
5. Reject an additional fresh appearance of the same exact recipe and any dominant-ingredient choice that would exceed the configured limit.
6. Choose only from the recipe version’s reviewer-approved serving range, in 5% steps plus exact bounds, and materialize the scaled serving quantity and nutrition snapshot without estimating new nutrition values.
7. Optimize all unlocked fresh/batch serving groups against the complete seven-day calorie and optional-protein targets. A batch source and its linked reuses always move together, and every candidate multiplier remains inside the recipe version’s reviewed range.
8. Re-run whole-plan date, slot, nutrition, eligibility, serving-bound, and variety validation before returning success.

`wellness-score-v3` assigns default shares of 25% breakfast, 35% lunch, 35% dinner, and 5% snack, renormalizes them over enabled slots, and deterministically allocates rounding remainders so the slot targets exactly equal the daily target. Protein deviation is applied only when the user supplies an optional target; Nourish does not calculate or recommend that target. Recipe cost bands are soft weighted penalties relative to the selected budget, while unavailable declared equipment is a hard eligibility failure for configured profiles. Legacy profiles without an equipment answer remain readable and are treated as unconfigured until edited.

Serving variation is content, not a planner guess. Each immutable recipe version declares a minimum and maximum multiplier; publication rejects malformed ranges, legacy records default to a fixed `1×` serving, and every generated, locked, validated, compared, and confirmed item must remain inside the snapshotted bounds. Nutrition, grams, grocery quantities, and swap deltas scale from the reviewed per-serving record using that same multiplier.

Ingredient reuse is a deterministic local waste proxy. After the first fresh selection, each distinct new canonical ingredient adds 6 score points and each ingredient already present in the week removes 10 points. It can influence ranking only after hard eligibility and variety gates; it cannot make unsafe content eligible. The same bounded-serving and grocery-overlap score orders otherwise-safe swap candidates using every plan item except the meal being replaced.

All weights, shares, serving steps, eligibility allowlists, and tolerances live in a named configuration contract and both Swift and server implementations have equivalent deterministic checks. `whole-week-serving-planner-v2` applies the specification defaults of daily calories within ±5% where feasible, weekly calories within ±3%, and optional protein within a configurable ±10% when the user supplies a target. It compares the complete week lexicographically: weekly calories, daily calories, optional protein, absolute deviation, then distance from a `1×` serving. If reviewed recipe bounds make a target impossible, diagnostics record soft relaxations in the order `optional_protein`, `daily_calories`, `weekly_calories`. Publication, review, locale, calculation version, diet, allergens, exclusions, disliked foods, equipment, slot, active-time, serving-bound, lock, and variety rules are never relaxed.

Fresh recipe assembly is still deterministic and sequential; the whole-week pass globally refines servings for the selected safe recipe/leftover structure. Production-scale catalogue calibration and evaluation of a broader global recipe-selection search remain explicit quality work, not a silent claim that every possible recipe combination was exhaustively optimized.

## Diagnostics and failure

Every run records generator/scoring/rule versions, seed, candidate-pool size, eligible counts by slot, rejection counts including unavailable locale, stale calculation version, unavailable equipment and invalid serving bounds, unique recipe count, meal target shares, daily and weekly absolute calorie percentages, daily optional-protein differences, mean absolute deviations, aggregate cost and ingredient-reuse scores, distinct-ingredient reuse percentage, active cooking minutes by day, cooking-session count, pack-size waste estimate and coverage, the tolerance contract/pass counts/excess/relaxations, final variety diagnostics, trigger, regeneration reason, and user-facing explanation codes including bounded serving adjustment. Waste remains explicitly unavailable when reviewed pack-size data is absent; the planner never fabricates it.

- `PROFILE_INELIGIBLE`: required profile inputs or enabled slots are missing.
- `CONTENT_INSUFFICIENT`: no published reviewed recipes survive hard filtering.
- `NO_FEASIBLE_PLAN`: candidates exist, but a complete safe varied week cannot be assembled.

The local HTTP service stores succeeded or rejected jobs, returns the same job for a repeated user/idempotency key, retains generated plan history, and records adoption separately so the materialized plan stays immutable.

## Native generation and review lifecycle

Plan Studio submits an authenticated idempotent job and retains its job ID per account. Queued or generating work is polled through the plan-read endpoint, so reopening the app can resume the same preview instead of creating duplicates. Rejected jobs show category-specific guidance: profile completion, reviewed-content coverage, fewer locks, or retry for a transient service failure.

A successful result remains a draft until the user reviews all seven days and separately adopts it. The preview shows daily calories, protein, carbohydrate, and fat estimates, intentional leftovers, and recipe-count diagnostics. Adoption of a first/current plan activates immediately. Adoption of a future renewal is scheduled by local plan date and does not displace the current active week early.

Whole-week regeneration is limited to a future week and requires a reason. Selected meal locks are resolved only from plans owned by the account, rechecked against current publication/review, diet, allergen, ingredient-exclusion, slot, and active-time rules, and recorded in diagnostics. A planned leftover cannot be locked without its source relationship. Each regeneration creates a successor; the prior immutable plan remains visible in plan history.

The weekly review records completion rate plus requested changes before the next-plan flow. Individual reviewed meal details accept a 1–5 rating and the specification's taste, effort, cost, portion, and ingredient-availability reasons. The local service validates ownership and payload vocabulary; production analytics policy and PostgreSQL adapters remain.

## Current production gap

The native app uses an adopted reviewed plan whenever the authenticated service returns one and otherwise keeps a clearly labelled illustrative fallback. The default development service has no published catalogue, so it correctly demonstrates `CONTENT_INSUFFICIENT` until reviewed fixtures or licensed production records are loaded. PostgreSQL adapters, the leased queue worker, production fail-closed locale/calculation-version configuration, and whole-week serving tolerances are implemented. Production still needs a provisioned database, licensed reviewed catalogue volume, live concurrency/load validation, and calibrated observation of v3 selection and serving quality before rollout.
