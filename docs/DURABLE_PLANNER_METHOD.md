# Durable planner method

## Runtime lifecycle

In PostgreSQL mode, creating a plan no longer performs generation inside the API request. The API validates the authenticated profile and local week boundary, snapshots the exact request, deterministic seed, profile and profile revision in `plan_jobs`, and creates an idempotent `plan.generate` background job in the same transaction.

The leased worker moves the domain job from `queued` to `generating`. Production startup requires explicit eligible-locale and current nutrition-calculation-version allowlists. It reads only the recipe version currently marked published and active in PostgreSQL, reconstructing its immutable locale, ingredient, method, nutrition, calculation version, source, diet, allergen, slot, and reviewer-approved serving-bound snapshot. It then runs the same deterministic eligibility, bounded-serving, ingredient-reuse, repetition, dominant-ingredient, recent-recipe and intentional-leftover rules used by the verified memory planner, followed by the whole-week serving tolerance pass.

## Atomic materialization

A successful worker transaction writes all of the following together:

- the immutable seven-day `weekly_plans` row and its profile/target/rule version evidence;
- every immutable `plan_items` snapshot;
- derived normalized grocery rows without double-counting planned leftovers;
- batch-linked prep tasks;
- diagnostics, including the ±5% daily / ±3% weekly / optional-protein tolerance evaluation and any documented soft relaxations, candidate-pool size and terminal `succeeded` job state.

If any insert or invariant fails, none of the week is published. A safe domain failure such as insufficient reviewed content becomes a typed `rejected` plan job with diagnostics. Unexpected infrastructure failures stay retryable through the leased queue.

## Locked meals and immutability

A regenerated plan cannot reuse a prior plan-item primary key. The durable worker preserves the locked meal snapshot and position, assigns the successor a new deterministic UUID, and records the original UUID in `locked_from_plan_item_id`. Planned-leftover source references and diagnostic explanation IDs are remapped to the new plan. This preserves the user-visible lock while keeping both plan histories immutable.

## Activation and feedback

Adoption is independently idempotent. The first plan activates immediately even when its meal week starts later. Once an active plan exists, a future renewal is scheduled for its local start date and does not displace the current plan early. Active/history status is derived from adoption dates without mutating plan snapshots.

Meal ratings and weekly reviews verify ownership through the durable plan repository before PostgreSQL insertion. Active-plan reads restore durable groceries, prep completion and meal completion revisions. Grocery, prep and meal changes use optimistic revision checks.

## Current boundary

PostgreSQL swap candidates and confirmation use the same hard eligibility, reviewed-serving, grocery-overlap, linked-leftover, and whole-week variety checks. Candidate deltas use the exact bounded multiplier that confirmation revalidates. Confirmation creates a new immutable plan and item UUID set, remaps valid leftover and diagnostic references, snapshots the replacement recipe version and selected multiplier, recalculates nutrition/groceries/prep, writes the swap audit, and transfers any active or scheduled adoption in one transaction. The source plan and its items remain unchanged and readable.

Compatible operational state follows the successor without weakening safety: unchanged meals retain their status/revision under remapped IDs; the swapped meal resets to planned; grocery check-off, pantry, and user quantity edits follow canonical ingredients; new and changed quantities are flagged; prep completion survives only when the batch task has the same title/date and equivalent source set. A repeated idempotency key returns the already materialized successor.

No live PostgreSQL server is available in this workspace. Executable tests verify query parameterization, transaction order, idempotent enqueue, deterministic 21-item materialization, variety/leftover diagnostics, UUID uniqueness, locked-item lineage, first activation, scheduled renewal, ownership-checked feedback, optimistic operational state, immutable swap succession, audit/adoption writes, and compatible state preservation. Staging still must run all migrations and exercise concurrency, crash recovery and realistic catalogue volume against the selected managed service.
