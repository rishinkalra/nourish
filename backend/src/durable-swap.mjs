import { analyzeVariety, PlanError } from "./planner-service.mjs";
import { deterministicUUID } from "./stable-identifiers.mjs";
import { deriveWeeklyLoop } from "./weekly-loop-service.mjs";

export function buildDurableSwapSuccessor({
  sourcePlan,
  sourceDiagnostics,
  sourceItemID,
  replacement,
  servingMultiplier = null,
  userID,
  idempotencyKey,
}) {
  const sourceItems = sourcePlan.days.flatMap((day) => day.items);
  const sourceItem = sourceItems.find((item) => item.id === sourceItemID);
  if (!sourceItem) throw new PlanError("VALIDATION_ERROR", "Plan item not found.", 404);
  if (hasLinkedReuse(sourcePlan, sourceItem)) {
    throw new PlanError("CONFLICT", "This meal supplies planned leftovers. Regenerate those linked meals together.", 409, true);
  }
  if (!replacement?.recipeVersionID) {
    throw new PlanError("CONTENT_INSUFFICIENT", "The selected recipe is missing its immutable reviewed version.", 422);
  }
  const replacementMultiplier = Number(servingMultiplier ?? sourceItem.servingMultiplier);
  const minimumMultiplier = Number(replacement.minimumServingMultiplier ?? 1);
  const maximumMultiplier = Number(replacement.maximumServingMultiplier ?? 1);
  if (!Number.isFinite(replacementMultiplier)
      || !Number.isFinite(minimumMultiplier) || !Number.isFinite(maximumMultiplier)
      || minimumMultiplier < 0.25 || maximumMultiplier > 4
      || minimumMultiplier > 1 || maximumMultiplier < 1 || minimumMultiplier > maximumMultiplier
      || replacementMultiplier < minimumMultiplier || replacementMultiplier > maximumMultiplier) {
    throw new PlanError("VALIDATION_ERROR", "The selected serving is outside this recipe’s reviewed bounds.", 422);
  }

  const resultPlanID = deterministicUUID(`meal-swap-plan|${userID}|${sourcePlan.id}|${sourceItemID}|${replacement.recipeVersionID}|${idempotencyKey}`);
  const oldToNew = new Map(sourceItems.map((item) => [
    item.id,
    deterministicUUID(`meal-swap-item|${resultPlanID}|${localDateKey(item.localDate)}|${item.slot}`),
  ]));
  const resultPlan = structuredClone(sourcePlan);
  resultPlan.id = resultPlanID;
  for (const item of resultPlan.days.flatMap((day) => day.items)) {
    const priorID = item.id;
    item.id = oldToNew.get(priorID);
    const reuse = item.leftoverRelationship?.plannedReuse;
    if (reuse && oldToNew.has(reuse.sourcePlanItemID)) reuse.sourcePlanItemID = oldToNew.get(reuse.sourcePlanItemID);
    if (priorID === sourceItemID) {
      item.recipeSnapshot = structuredClone(replacement);
      item.servingMultiplier = replacementMultiplier;
      item.servingQuantityGrams = Number(replacement.servingSizeGrams) * replacementMultiplier;
      item.nutrition = scaleNutrition(replacement.nutritionPerServing, replacementMultiplier);
      item.leftoverRelationship = { none: {} };
      item.lockedFromPlanItemID = null;
      item.completionState = "planned";
    }
  }

  const variety = analyzeVariety(resultPlan.days.flatMap((day) => day.items), new Set());
  if (!variety.passed) {
    throw new PlanError("NO_FEASIBLE_PLAN", "This swap would break the week’s variety limits.", 422, false, { variety });
  }
  const diagnostics = {
    ...structuredClone(sourceDiagnostics ?? {}),
    trigger: "meal_swap",
    regenerationReason: `Replaced ${sourceItem.recipeSnapshot.recipeID} with ${replacement.recipeID}`,
    variety,
    explanations: (sourceDiagnostics?.explanations ?? []).filter(
      (explanation) => !(explanation.planItemID === sourceItemID && explanation.code === "servingAdjusted"),
    ).map((explanation) => structuredClone(explanation)),
  };
  for (const explanation of diagnostics.explanations ?? []) {
    if (oldToNew.has(explanation.planItemID)) explanation.planItemID = oldToNew.get(explanation.planItemID);
  }
  if (replacementMultiplier !== 1) {
    diagnostics.explanations.push({
      planItemID: oldToNew.get(sourceItemID),
      code: "servingAdjusted",
      message: "Serving adjusted within this recipe’s reviewed bounds.",
    });
  }
  return { resultPlan, diagnostics, sourceItem, oldToNew, variety };
}

export function buildPreservedSwapOperations({ resultPlan, oldToNew, previousGroceryList, previousPrepTimeline }) {
  const derived = deriveWeeklyLoop(resultPlan);
  const previousGroceryByIngredient = new Map((previousGroceryList?.items ?? []).map((item) => [normalized(item.ingredientID), item]));
  const hasPreviousGrocery = Boolean(previousGroceryList);
  const groceryList = {
    id: deterministicUUID(`grocery-list|${resultPlan.id}`),
    planID: resultPlan.id,
    revision: 1,
    items: derived.groceryList.items.map((item) => {
      const previous = previousGroceryByIngredient.get(normalized(item.ingredientID));
      return {
        ...item,
        id: deterministicUUID(`grocery-item|${resultPlan.id}|${item.ingredientID}`),
        userAdjustedGrams: previous?.userAdjustedGrams ?? null,
        disposition: previous?.disposition ?? "needed",
        changedBySwap: previous ? !quantitiesEqual(previous.requiredGrams, item.requiredGrams) : false,
        newlyAddedBySwap: hasPreviousGrocery && !previous,
      };
    }),
  };

  const newToOld = new Map([...oldToNew].map(([oldID, newID]) => [newID, oldID]));
  const previousPrepBySignature = new Map((previousPrepTimeline?.tasks ?? []).map((task) => [prepSignature(task), task]));
  const prepTimeline = {
    planID: resultPlan.id,
    tasks: derived.prepTimeline.tasks.map((task) => {
      const oldSourceIDs = task.sourcePlanItemIDs.map((id) => newToOld.get(id)).filter(Boolean);
      const equivalent = previousPrepBySignature.get(prepSignature({ ...task, sourcePlanItemIDs: oldSourceIDs }));
      return {
        ...task,
        id: deterministicUUID(`prep-task|${task.id}`),
        isComplete: Boolean(equivalent?.isComplete),
        revision: equivalent ? Number(equivalent.revision ?? 0) : 0,
      };
    }),
  };
  return { groceryList, prepTimeline };
}

function hasLinkedReuse(plan, item) {
  return Boolean(item.leftoverRelationship?.batchSource && plan.days.flatMap((day) => day.items).some(
    (candidate) => candidate.leftoverRelationship?.plannedReuse?.sourcePlanItemID === item.id,
  ));
}

function scaleNutrition(nutrition, multiplier) {
  return Object.fromEntries(Object.entries(nutrition).map(([key, value]) => [key, Number(value) * Number(multiplier)]));
}

function prepSignature(task) {
  return `${localDateKey(task.localDate)}|${task.title}|${[...(task.sourcePlanItemIDs ?? [])].sort().join(",")}`;
}

function quantitiesEqual(left, right) {
  return Math.abs(Number(left) - Number(right)) < 0.00005;
}

function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function localDateKey(value) {
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}
