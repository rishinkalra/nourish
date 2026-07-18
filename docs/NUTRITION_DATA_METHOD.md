# Nutrition and recipe data methodology

## Production rule

No recipe may enter a generated plan until its exact version is published by an authorized reviewer. Publication requires verified canonical ingredients, positive gram quantities, complete method and serving data, derived allergen declarations, reviewed per-100g nutrient records, effective source versions, and source rights explicitly approved for production.

The development meals currently shown in the app are illustrative drafts. They remain visibly labelled as unapproved and are not evidence that their nutrition values have been professionally reviewed.

## Calculation boundary

1. Every recipe ingredient references a stable canonical ingredient ID and records both household quantity and grams.
2. Each ingredient's nutrient record stores calories, protein, carbohydrate, fat, and fibre per 100 grams.
3. Each nutrient record retains provider, dataset, dataset version, provider record ID, retrieval date, effective period, confidence, reviewer, and licensing status.
4. Recipe nutrients are calculated from gram weights and the exact effective nutrient-record versions, then divided by declared servings.
5. The recipe version stores the resulting per-serving estimate, a calculation-version identifier, and reviewer-approved minimum/maximum serving multipliers. The range must contain `1×`, stay between `0.25×` and `4×`, and defaults to fixed `1×` for legacy content.
6. Adopted plans copy an immutable snapshot. A planner may scale the reviewed per-serving nutrients and ingredient grams only inside those snapshotted bounds; it does not invent a new nutrient calculation. Historical totals therefore do not change when catalogue data is revised.
7. Production API and worker configuration explicitly allowlist eligible recipe locales and current nutrition-calculation versions. Startup fails closed when either list is absent, and a snapshot outside either list is rejected before ranking.

Rounding is a presentation concern only. Stored calculations should retain decimal precision; the user interface may round calories and grams consistently while continuing to label the result as an estimate.

Optional reviewed purchase-pack gram sizes may support waste diagnostics. The planner reports both estimated waste and the percentage of purchased ingredients with pack-size coverage. When no pack sizes are present it reports the estimate as unavailable rather than assuming a package size.

## Allergen and diet controls

Allergens are derived from canonical ingredient records rather than free-text recipe labels. The declared recipe allergen set must exactly match the derived set before publication. Diet compatibility is checked for every ingredient and again when a recipe is selected for a user's plan. User allergens and explicit ingredient exclusions are hard failures, never scoring preferences.

## Review workflow

- An author creates or edits a draft version.
- Validation, including the reviewed serving range, must pass before submission.
- A different authorized reviewer approves and publishes or rejects with a reason.
- Every transition is audited.
- A published version is immutable. Later changes create the next version while existing plans retain their original snapshot.
- Reviewer-gated ingestion stores verified ingredients, household conversions, per-100g nutrient values, source identity/version/license, effective dates, reviewer identity, and an audit payload transactionally. Published recipe children snapshot ingredient display/category/allergens, and cited nutrient rows/sources are database-guarded from mutation.

## Rights and launch readiness

Synthetic fixtures may exercise the workflow in tests but must not be represented as licensed production nutrition. Before launch, the owner must select and contract the nutrient source, record its permitted uses and geography, validate the ingestion mapping, establish qualified review responsibility, and approve the calculation and rounding policy.
