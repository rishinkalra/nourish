# Weekly plan loop method

## Source of truth

Groceries and preparation tasks are derived from an immutable `WeeklyPlan`; they are not independent hand-maintained lists. Each swap creates a new plan revision and retains the prior plan for history and rollback.

## Grocery aggregation

- Ingredients are grouped by canonical ingredient ID.
- Required quantities are normalized to grams while compatible household-unit totals are retained for display.
- Serving multipliers are applied before aggregation.
- A `plannedReuse` item is not counted again because its food was purchased and prepared by the linked `batchSource`.
- User quantity overrides, check-off state, and “already have” state survive recalculation for ingredients that remain in the plan.
- A swap distinguishes newly introduced ingredients from existing ingredients whose required quantity changed.
- Category assignment accepts explicit ingredient configuration and has a conservative fallback category.

## Preparation derivation

Every batch source with linked planned reuses creates a dated task containing active minutes, source plan-item IDs, a storage note, and an explanation of the reserved portions. Completion is operational state and does not mutate the recipe or plan snapshot.

Storage copy in the development fixtures is generic. Production storage windows must be reviewed recipe/catalogue content rather than inferred by the client.

## Safe swaps and atomicity

Candidates pass publication, nutrition-review, diet, allergen, explicit ingredient-exclusion, disliked-food, meal-slot, active-time, reviewed-serving-bound, linked-leftover, and final whole-week variety checks before display. The shared v2.1 score chooses a serving only inside the replacement recipe’s immutable reviewed range and rewards overlap with the rest of the plan’s canonical grocery ingredients. Candidate calorie/protein deltas therefore describe the exact bounded serving that confirmation will use. Confirmation revalidates that choice and recalculates the replacement item, daily/weekly nutrition, groceries, prep tasks, and change flags as one result.

A batch source that supplies future planned leftovers cannot be swapped independently. The user must regenerate the linked set so no reuse points at food that is no longer prepared.

The local HTTP service and PostgreSQL runtime both materialize a new immutable plan/item ID set for a confirmed swap and leave the source plan readable. PostgreSQL commits the successor, recipe-version audit, recalculated groceries/prep, compatible meal/grocery/prep state, and active or scheduled adoption handoff in one transaction. A repeated confirmation key resolves to the same saved successor.

## Offline behavior

The native repository stores the plan, groceries, prep, operational states, revision, and pending mutations in one atomically written, iOS file-protected document. Mutations use stable IDs and optimistic base revisions. A repeated mutation ID is idempotent; a stale revision produces a conflict instead of silently overwriting newer state. Acknowledged revisions are removed from the pending sync journal.

After authentication, active-plan discovery loads the user's separately adopted plan together with its normalized groceries, prep timeline, and server-side operational revisions. The cache is partitioned by authenticated user ID so a signed-out or different account never receives another account's plan. A clean device restores from the service; an available local snapshot renders first and then refreshes.

Meal status, grocery check/pantry/quantity edits, and prep completion are applied locally before the network request. The synchronization engine replays pending mutations in local revision order, sends the last acknowledged remote revision for each resource, acknowledges each successful mutation, and finally refreshes the authoritative active envelope. Network failures retain the exact protected snapshot and expose retry state. A remote revision mismatch stops replay and exposes a review-needed conflict rather than overwriting either version.

Swaps are a deliberate exception: candidate eligibility depends on current whole-plan constraints and confirmation creates an immutable successor plan. The client therefore requires connectivity and confirmation for a swap; it never silently replays an offline swap against a potentially changed plan.

The visible development week also persists its check-offs, pantry state, quantity edits, meal states, and prep completion across relaunches. It is shown only as an explicitly illustrative fallback when there is no adopted reviewed plan or the user is signed out; it is never relabelled as production content.
