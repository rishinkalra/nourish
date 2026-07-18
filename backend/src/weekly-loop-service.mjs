import { createHash } from "node:crypto";
import { WELLNESS_SCORE_V2, PlanError, analyzeVariety, eligibilityReasons, scoreRecipe } from "./planner-service.mjs";

export class WeeklyLoopService {
  constructor({ planService, recipeProvider = () => [], scoringConfiguration = WELLNESS_SCORE_V2, now = () => new Date() }) {
    this.planService = planService;
    this.recipeProvider = recipeProvider;
    this.scoringConfiguration = scoringConfiguration;
    this.now = now;
    this.swapIdempotency = new Map();
    this.groceryState = new Map();
    this.mealOperationalState = new Map();
    this.prepOperationalState = new Map();
  }

  readActive(userID) {
    const active = this.planService.readActive(userID);
    const derived = deriveWeeklyLoop(active.plan);
    const grocery = this.readGroceryList(derived.groceryList.id, userID);
    for (const task of derived.prepTimeline.tasks) {
      const state = this.prepOperationalState.get(`${userID}:${task.id}`);
      if (state) task.isComplete = state.isComplete;
    }
    for (const item of active.plan.days.flatMap((day) => day.items)) {
      const state = this.mealOperationalState.get(`${userID}:${item.id}`);
      if (state) item.completionState = state.state;
    }
    const mealRevisions = Object.fromEntries(active.plan.days.flatMap((day) => day.items).map((item) => [
      item.id,
      this.mealOperationalState.get(`${userID}:${item.id}`)?.revision ?? 0,
    ]));
    const prepRevisions = Object.fromEntries(derived.prepTimeline.tasks.map((task) => [
      task.id,
      this.prepOperationalState.get(`${userID}:${task.id}`)?.revision ?? 0,
    ]));
    return {
      plan: active.plan,
      diagnostics: active.diagnostics,
      groceryList: grocery,
      prepTimeline: derived.prepTimeline,
      revision: Math.max(1, grocery.revision),
      operationalRevisions: {
        grocery: grocery.revision,
        meals: mealRevisions,
        prep: prepRevisions,
      },
    };
  }

  swapCandidates({ itemID, userID, profile }) {
    if (!profile) throw new PlanError("PROFILE_INELIGIBLE", "Complete your planning profile first.", 422);
    const { plan, item } = this.findItem(itemID, userID);
    if (hasLinkedReuse(plan, item)) return [];
    const activeSlots = [...new Set(plan.days.flatMap((day) => day.items.map((planItem) => planItem.slot)))];
    const existingIngredientIDs = ingredientsOutsideItem(plan, itemID);
    return this.recipeProvider().filter((recipe) => (
      recipe.recipeID !== item.recipeSnapshot.recipeID
      && eligibilityReasons(recipe, profile, item.slot, this.scoringConfiguration).length === 0
      && resultingVariety(plan, item.id, recipe).passed
    )).map((recipe) => {
      const breakdown = scoreRecipe(recipe, profile, item.slot, activeSlots, this.scoringConfiguration, existingIngredientIDs);
      const nutrition = scaleNutrition(recipe.nutritionPerServing, breakdown.servingMultiplier);
      return {
        recipe,
        servingMultiplier: breakdown.servingMultiplier,
        rankingScore: breakdown.total,
        calorieDelta: Number(nutrition.calories) - Number(item.nutrition.calories),
        proteinDeltaGrams: Number(nutrition.proteinGrams) - Number(item.nutrition.proteinGrams),
      };
    }).sort((left, right) => (
      left.rankingScore - right.rankingScore
      || Math.abs(left.calorieDelta) - Math.abs(right.calorieDelta)
      || left.recipe.recipeID.localeCompare(right.recipe.recipeID)
    )).map(({ rankingScore: _rankingScore, ...candidate }) => candidate);
  }

  applySwap({ itemID, replacementRecipeID, userID, profile, idempotencyKey }) {
    if (!idempotencyKey) throw new PlanError("VALIDATION_ERROR", "An idempotency key is required.", 400);
    const idempotencyID = `${userID}:${idempotencyKey}`;
    if (this.swapIdempotency.has(idempotencyID)) return structuredClone(this.swapIdempotency.get(idempotencyID));
    const { record, plan, item } = this.findItem(itemID, userID);
    if (!profile) throw new PlanError("PROFILE_INELIGIBLE", "Complete your planning profile first.", 422);
    if (hasLinkedReuse(plan, item)) {
      throw new PlanError("CONFLICT", "This meal supplies planned leftovers. Regenerate those linked meals together.", 409, true);
    }
    const replacement = this.recipeProvider().find((recipe) => recipe.recipeID === replacementRecipeID);
    if (!replacement) throw new PlanError("VALIDATION_ERROR", "Swap recipe not found.", 404);
    const issues = eligibilityReasons(replacement, profile, item.slot, this.scoringConfiguration);
    if (issues.length) throw new PlanError("VALIDATION_ERROR", "This swap no longer satisfies your safety rules.", 422, false, { eligibilityIssues: issues });
    const variety = resultingVariety(plan, item.id, replacement);
    if (!variety.passed) throw new PlanError("NO_FEASIBLE_PLAN", "This swap would break the week’s variety limits.", 422, false, { variety });

    const activeSlots = [...new Set(plan.days.flatMap((day) => day.items.map((planItem) => planItem.slot)))];
    const servingMultiplier = scoreRecipe(
      replacement, profile, item.slot, activeSlots, this.scoringConfiguration, ingredientsOutsideItem(plan, itemID),
    ).servingMultiplier;
    const newPlanID = `plan-${digest(`${plan.id}|${itemID}|${replacementRecipeID}|${idempotencyKey}`).slice(0, 16)}`;
    const idMap = new Map(plan.days.flatMap((day) => day.items).map((oldItem) => [oldItem.id, `${newPlanID}-${dateKey(oldItem.localDate)}-${oldItem.slot}`]));
    const swappedPlan = structuredClone(plan);
    swappedPlan.id = newPlanID;
    for (const day of swappedPlan.days) {
      for (const planItem of day.items) {
        const originalID = planItem.id;
        planItem.id = idMap.get(originalID);
        if (planItem.leftoverRelationship.plannedReuse) {
          planItem.leftoverRelationship.plannedReuse.sourcePlanItemID = idMap.get(planItem.leftoverRelationship.plannedReuse.sourcePlanItemID);
        }
        if (originalID === itemID) {
          planItem.recipeSnapshot = structuredClone(replacement);
          planItem.servingMultiplier = servingMultiplier;
          planItem.servingQuantityGrams = replacement.servingSizeGrams * servingMultiplier;
          planItem.nutrition = scaleNutrition(replacement.nutritionPerServing, servingMultiplier);
          planItem.leftoverRelationship = { none: {} };
          planItem.completionState = "planned";
        }
      }
    }
    const diagnostics = {
      ...structuredClone(record.diagnostics),
      trigger: "meal_swap",
      regenerationReason: `Replaced ${item.recipeSnapshot.recipeID} with ${replacementRecipeID}`,
      variety,
      explanations: (record.diagnostics?.explanations ?? []).filter(
        (explanation) => !(explanation.planItemID === itemID && explanation.code === "servingAdjusted"),
      ).map((explanation) => ({
        ...structuredClone(explanation),
        planItemID: idMap.get(explanation.planItemID) ?? explanation.planItemID,
      })),
    };
    if (servingMultiplier !== 1) {
      diagnostics.explanations.push({
        planItemID: idMap.get(itemID),
        code: "servingAdjusted",
        message: "Serving adjusted within this recipe’s reviewed bounds.",
      });
    }
    this.planService.store.plans.set(newPlanID, { userID, plan: swappedPlan, diagnostics, adoptedAt: null, supersedesPlanID: plan.id });
    if (this.planService.store.adoptedPlanIDByUser.get(userID) === plan.id) {
      this.planService.store.adoptedPlanIDByUser.set(userID, newPlanID);
    }
    const weeklyLoop = deriveWeeklyLoop(swappedPlan);
    const receipt = {
      plan: swappedPlan,
      groceryList: weeklyLoop.groceryList,
      prepTimeline: weeklyLoop.prepTimeline,
      revision: 1,
      supersedesPlanID: plan.id,
      swappedAt: this.now(),
    };
    this.groceryState.set(weeklyLoop.groceryList.id, { userID, revision: 1, list: weeklyLoop.groceryList });
    this.swapIdempotency.set(idempotencyID, receipt);
    return structuredClone(receipt);
  }

  readGroceryList(id, userID) {
    const stored = this.groceryState.get(id);
    if (stored) {
      if (stored.userID !== userID) throw new PlanError("AUTHENTICATION_REQUIRED", "This grocery list is not available.", 403);
      return structuredClone({ ...stored.list, revision: stored.revision });
    }
    const planID = id.startsWith("grocery-") ? id.slice("grocery-".length) : null;
    const record = planID ? this.planService.store.plans.get(planID) : null;
    if (!record || record.userID !== userID) throw new PlanError("VALIDATION_ERROR", "Grocery list not found.", 404);
    const list = deriveWeeklyLoop(record.plan).groceryList;
    this.groceryState.set(id, { userID, revision: 1, list });
    return structuredClone({ ...list, revision: 1 });
  }

  updateGroceryList({ id, userID, expectedRevision, changes }) {
    this.readGroceryList(id, userID);
    const stored = this.groceryState.get(id);
    if (expectedRevision !== stored.revision) throw new PlanError("CONFLICT", "This grocery list changed elsewhere.", 409, true);
    for (const change of changes ?? []) {
      const item = stored.list.items.find((candidate) => candidate.id === change.itemID);
      if (!item) throw new PlanError("VALIDATION_ERROR", "Grocery item not found.", 404);
      if (change.disposition) item.disposition = change.disposition;
      if (change.userAdjustedGrams !== undefined) {
        if (change.userAdjustedGrams !== null && Number(change.userAdjustedGrams) <= 0) throw new PlanError("VALIDATION_ERROR", "Quantity must be greater than zero.", 400);
        item.userAdjustedGrams = change.userAdjustedGrams;
      }
    }
    stored.revision += 1;
    return structuredClone({ ...stored.list, revision: stored.revision });
  }

  updateMealStatus({ itemID, userID, state, expectedRevision = 0 }) {
    this.findItem(itemID, userID);
    if (!["planned", "completed", "skipped", "replacedOutsideApp", "moved"].includes(state)) {
      throw new PlanError("VALIDATION_ERROR", "Meal status is invalid.", 400);
    }
    const key = `${userID}:${itemID}`;
    const current = this.mealOperationalState.get(key) ?? { revision: 0, state: "planned" };
    if (expectedRevision !== current.revision) throw new PlanError("CONFLICT", "This meal changed elsewhere.", 409, true);
    const updated = { itemID, state, revision: current.revision + 1, updatedAt: this.now() };
    this.mealOperationalState.set(key, updated);
    return structuredClone(updated);
  }

  updatePrepTask({ taskID, userID, isComplete, expectedRevision = 0 }) {
    const active = this.readActive(userID);
    if (!active.prepTimeline.tasks.some((task) => task.id === taskID)) {
      throw new PlanError("VALIDATION_ERROR", "Prep task not found.", 404);
    }
    const key = `${userID}:${taskID}`;
    const current = this.prepOperationalState.get(key) ?? { revision: 0, isComplete: false };
    if (expectedRevision !== current.revision) throw new PlanError("CONFLICT", "This prep task changed elsewhere.", 409, true);
    const updated = { taskID, isComplete: Boolean(isComplete), revision: current.revision + 1, updatedAt: this.now() };
    this.prepOperationalState.set(key, updated);
    return structuredClone(updated);
  }

  findItem(itemID, userID) {
    for (const record of this.planService.store.plans.values()) {
      if (record.userID !== userID) continue;
      const item = record.plan.days.flatMap((day) => day.items).find((candidate) => candidate.id === itemID);
      if (item) return { record, plan: record.plan, item };
    }
    throw new PlanError("VALIDATION_ERROR", "Plan item not found.", 404);
  }
}

export function deriveWeeklyLoop(plan) {
  const grouped = new Map();
  const allItems = plan.days.flatMap((day) => day.items);
  for (const item of allItems) {
    if (item.leftoverRelationship.plannedReuse) continue;
    for (const ingredient of item.recipeSnapshot.ingredients ?? []) {
      const key = normalized(ingredient.ingredientID);
      const current = grouped.get(key) ?? {
        id: `${plan.id}-ingredient-${key}`,
        ingredientID: ingredient.ingredientID,
        displayName: ingredient.displayName,
        category: ingredient.category ?? "other",
        requiredGrams: 0,
        householdQuantities: {},
        userAdjustedGrams: null,
        disposition: "needed",
        changedBySwap: false,
        newlyAddedBySwap: false,
      };
      current.requiredGrams += Number(ingredient.grams) * Number(item.servingMultiplier);
      const unit = normalized(ingredient.householdUnit);
      current.householdQuantities[unit] = (current.householdQuantities[unit] ?? 0) + Number(ingredient.householdQuantity) * Number(item.servingMultiplier);
      grouped.set(key, current);
    }
  }
  const groceryList = {
    id: `grocery-${plan.id}`,
    planID: plan.id,
    items: [...grouped.values()].map((item) => ({
      ...item,
      householdQuantities: Object.entries(item.householdQuantities).map(([unit, quantity]) => ({ unit, quantity })),
    })).sort((left, right) => left.category.localeCompare(right.category) || left.displayName.localeCompare(right.displayName)),
  };
  const tasks = allItems.flatMap((item) => {
    const batchID = item.leftoverRelationship.batchSource?.batchID;
    if (!batchID) return [];
    const reuses = allItems.filter((candidate) => candidate.leftoverRelationship.plannedReuse?.batchID === batchID && candidate.leftoverRelationship.plannedReuse?.sourcePlanItemID === item.id);
    if (!reuses.length) return [];
    return [{
      id: `prep-${plan.id}-${batchID}`,
      localDate: item.localDate,
      title: `Prepare ${item.recipeSnapshot.displayName} batch`,
      activeMinutes: item.recipeSnapshot.activePreparationMinutes,
      storageNote: "Cool promptly, refrigerate in sealed shallow containers, and follow the reviewed storage window.",
      reuseNote: `Reserve ${reuses.length} planned portion${reuses.length === 1 ? "" : "s"}.`,
      sourcePlanItemIDs: [item.id, ...reuses.map((reuse) => reuse.id)],
      isComplete: false,
    }];
  });
  return { groceryList, prepTimeline: { planID: plan.id, tasks } };
}

function resultingVariety(plan, itemID, recipe) {
  const items = structuredClone(plan.days.flatMap((day) => day.items));
  const item = items.find((candidate) => candidate.id === itemID);
  item.recipeSnapshot = structuredClone(recipe);
  item.leftoverRelationship = { none: {} };
  return analyzeVariety(items, new Set());
}

function hasLinkedReuse(plan, item) {
  return Boolean(item.leftoverRelationship.batchSource && plan.days.flatMap((day) => day.items).some(
    (candidate) => candidate.leftoverRelationship.plannedReuse?.sourcePlanItemID === item.id,
  ));
}

function scaleNutrition(nutrition, multiplier) {
  return Object.fromEntries(Object.entries(nutrition).map(([key, value]) => [key, Number(value) * Number(multiplier)]));
}

function ingredientsOutsideItem(plan, itemID) {
  return new Set(plan.days.flatMap((day) => day.items)
    .filter((item) => item.id !== itemID)
    .flatMap((item) => item.recipeSnapshot.ingredients?.map((ingredient) => normalized(ingredient.ingredientID)) ?? []));
}

function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function dateKey(date) {
  return `${String(date.year).padStart(4, "0")}${String(date.month).padStart(2, "0")}${String(date.day).padStart(2, "0")}`;
}
