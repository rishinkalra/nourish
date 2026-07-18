import { createHash } from "node:crypto";

export const WELLNESS_SCORE_V2 = Object.freeze({
  version: "wellness-score-v3",
  calorieDeviationWeight: 1,
  proteinDeviationWeight: 8,
  activeMinuteWeight: 2,
  costBandWeight: 8,
  budgetExcessWeight: 40,
  equipmentItemWeight: 3,
  newIngredientPenalty: 6,
  ingredientReuseReward: 10,
  servingMultiplierStep: 0.05,
  eligibleLocaleIdentifiers: Object.freeze([]),
  currentNutritionCalculationVersions: Object.freeze([]),
  dailyCalorieTolerancePercent: 5,
  weeklyCalorieTolerancePercent: 3,
  optionalProteinTolerancePercent: 10,
  cuisinePreferenceReward: 18,
  favoriteReward: 12,
  recentRecipePenalty: 25,
  mealTargetShares: Object.freeze({ breakfast: 25, lunch: 35, dinner: 35, snack: 5 }),
});

export function plannerConfigurationFromEnvironment(environment = process.env) {
  const configuration = {
    ...WELLNESS_SCORE_V2,
    eligibleLocaleIdentifiers: configuredList(environment.NOURISH_PLANNER_ELIGIBLE_LOCALES),
    currentNutritionCalculationVersions: configuredList(environment.NOURISH_PLANNER_NUTRITION_CALCULATION_VERSIONS),
  };
  if (environment.NODE_ENV === "production"
      && (!configuration.eligibleLocaleIdentifiers.length || !configuration.currentNutritionCalculationVersions.length)) {
    throw new Error("Production planning requires NOURISH_PLANNER_ELIGIBLE_LOCALES and NOURISH_PLANNER_NUTRITION_CALCULATION_VERSIONS.");
  }
  return configuration;
}

export class PlanError extends Error {
  constructor(code, message, status = 422, retryable = false, diagnostics = undefined) {
    super(message);
    this.name = "PlanError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.diagnostics = diagnostics;
  }
}

export class MemoryPlanStore {
  jobs = new Map();
  plans = new Map();
  idempotency = new Map();
  adoptionIdempotency = new Map();
  adoptedPlanIDByUser = new Map();
  scheduledPlanIDByUser = new Map();
}

export class PlannerService {
  constructor({ recipeProvider = () => [], store = new MemoryPlanStore(), now = () => new Date(), scoringConfiguration = WELLNESS_SCORE_V2 } = {}) {
    this.recipeProvider = recipeProvider;
    this.store = store;
    this.now = now;
    this.scoringConfiguration = scoringConfiguration;
  }

  create({ userID, profile, request, idempotencyKey, correlationID }) {
    if (!profile) throw new PlanError("PROFILE_INELIGIBLE", "Complete your planning profile first.");
    if (!idempotencyKey) throw new PlanError("VALIDATION_ERROR", "An idempotency key is required.", 400);
    const idempotencyID = `${userID}:${idempotencyKey}`;
    const existingJobID = this.store.idempotency.get(idempotencyID);
    if (existingJobID) return structuredClone(withoutOwner(this.store.jobs.get(existingJobID)));

    const recipes = this.recipeProvider();
    const jobID = `job-${digest(`${userID}|${idempotencyKey}`).slice(0, 16)}`;
    try {
      if (request?.trigger === "manual_regeneration" && request?.weekStartLocalDate < localDateKey(this.now(), profile.timeZoneIdentifier)) {
        throw new PlanError("VALIDATION_ERROR", "Only a future week can be regenerated. Use meal swaps for the active week.", 400);
      }
      const lockedItems = this.resolveLockedItems(userID, request?.lockedPlanItemIDs ?? []);
      const result = generatePlan({ profile, recipes, request, userID, lockedItems, scoringConfiguration: this.scoringConfiguration });
      const job = {
        id: jobID,
        state: "succeeded",
        correlationID,
        planID: result.plan.id,
        error: null,
        createdAt: this.now(),
      };
      this.store.plans.set(result.plan.id, {
        userID,
        ...result,
        adoptedAt: null,
        createdAt: this.now(),
        supersedesPlanID: request?.trigger === "manual_regeneration" ? this.store.adoptedPlanIDByUser.get(userID) ?? null : null,
      });
      this.store.jobs.set(jobID, { userID, ...job });
      this.store.idempotency.set(idempotencyID, jobID);
      return structuredClone(job);
    } catch (error) {
      if (!(error instanceof PlanError)) throw error;
      const job = {
        id: jobID,
        state: "rejected",
        correlationID,
        planID: null,
        error: {
          code: error.code,
          userSafeMessage: error.message,
          correlationID,
          retryable: error.retryable,
        },
        diagnostics: error.diagnostics ?? null,
        createdAt: this.now(),
      };
      this.store.jobs.set(jobID, { userID, ...job });
      this.store.idempotency.set(idempotencyID, jobID);
      return structuredClone(job);
    }
  }

  read(jobOrPlanID, userID) {
    const job = this.store.jobs.get(jobOrPlanID);
    if (job) {
      if (job.userID !== userID) throw new PlanError("AUTHENTICATION_REQUIRED", "This plan is not available.", 403);
      const planRecord = job.planID ? this.store.plans.get(job.planID) : null;
      return structuredClone({ job: withoutOwner(job), plan: planRecord?.plan ?? null, diagnostics: planRecord?.diagnostics ?? job.diagnostics ?? null });
    }
    const planRecord = this.store.plans.get(jobOrPlanID);
    if (!planRecord || planRecord.userID !== userID) throw new PlanError("VALIDATION_ERROR", "Plan not found.", 404);
    return structuredClone({ job: null, plan: planRecord.plan, diagnostics: planRecord.diagnostics });
  }

  readActive(userID) {
    this.promoteScheduledPlan(userID);
    const planID = this.store.adoptedPlanIDByUser.get(userID);
    if (!planID) throw new PlanError("VALIDATION_ERROR", "No active plan is available.", 404);
    return this.read(planID, userID);
  }

  history(userID) {
    this.promoteScheduledPlan(userID);
    const activeID = this.store.adoptedPlanIDByUser.get(userID);
    const scheduledID = this.store.scheduledPlanIDByUser.get(userID);
    return [...this.store.plans.values()]
      .filter((record) => record.userID === userID)
      .sort((left, right) => new Date(right.createdAt ?? 0) - new Date(left.createdAt ?? 0))
      .map((record) => structuredClone({
        plan: record.plan,
        diagnostics: record.diagnostics,
        adoptedAt: record.adoptedAt ?? null,
        supersedesPlanID: record.supersedesPlanID ?? null,
        lifecycleStatus: record.plan.id === activeID ? "active" : record.plan.id === scheduledID ? "scheduled" : record.adoptedAt ? "history" : "draft",
      }));
  }

  adopt(planID, userID, idempotencyKey) {
    if (!idempotencyKey) throw new PlanError("VALIDATION_ERROR", "An idempotency key is required.", 400);
    const idempotencyID = `${userID}:${idempotencyKey}`;
    const existing = this.store.adoptionIdempotency.get(idempotencyID);
    if (existing) return structuredClone(existing);
    const record = this.store.plans.get(planID);
    if (!record || record.userID !== userID) throw new PlanError("VALIDATION_ERROR", "Plan not found.", 404);
    const adoptedAt = this.now();
    this.store.plans.set(planID, { ...record, adoptedAt });
    const activatesOn = dateKey(record.plan.days[0].localDate);
    const today = localDateKey(this.now(), record.plan.timeZoneIdentifier);
    const isFutureRenewal = this.store.adoptedPlanIDByUser.has(userID) && activatesOn > today;
    if (isFutureRenewal) this.store.scheduledPlanIDByUser.set(userID, planID);
    else this.store.adoptedPlanIDByUser.set(userID, planID);
    const receipt = { planID, status: isFutureRenewal ? "scheduled" : "adopted", adoptedAt };
    this.store.adoptionIdempotency.set(idempotencyID, receipt);
    return structuredClone(receipt);
  }

  ownsPlanItem(userID, planItemID) {
    return [...this.store.plans.values()].some((record) =>
      record.userID === userID && record.plan.days.some((day) => day.items.some((item) => item.id === planItemID))
    );
  }

  ownsPlan(userID, planID) {
    return this.store.plans.get(planID)?.userID === userID;
  }

  resolveLockedItems(userID, planItemIDs) {
    if (!Array.isArray(planItemIDs) || planItemIDs.length === 0) return [];
    const requested = new Set(planItemIDs);
    const resolved = new Map();
    const activePlanID = this.store.adoptedPlanIDByUser.get(userID);
    const records = [...this.store.plans.entries()]
      .filter(([, record]) => record.userID === userID)
      .sort(([leftID], [rightID]) => Number(rightID === activePlanID) - Number(leftID === activePlanID));
    for (const [, record] of records) {
      for (const item of record.plan.days.flatMap((day) => day.items)) {
        if (requested.has(item.id) && !resolved.has(item.id)) resolved.set(item.id, structuredClone(item));
      }
    }
    const missing = [...requested].filter((id) => !resolved.has(id));
    if (missing.length > 0) {
      throw new PlanError("VALIDATION_ERROR", "One or more locked meals are not available for this account.", 400);
    }
    return [...resolved.values()];
  }

  promoteScheduledPlan(userID) {
    const scheduledID = this.store.scheduledPlanIDByUser.get(userID);
    if (!scheduledID) return;
    const record = this.store.plans.get(scheduledID);
    if (!record) {
      this.store.scheduledPlanIDByUser.delete(userID);
      return;
    }
    const activatesOn = dateKey(record.plan.days[0].localDate);
    if (activatesOn <= localDateKey(this.now(), record.plan.timeZoneIdentifier)) {
      this.store.adoptedPlanIDByUser.set(userID, scheduledID);
      this.store.scheduledPlanIDByUser.delete(userID);
    }
  }
}

export function generatePlan({ profile, recipes, request, userID = "local-user", lockedItems = [], scoringConfiguration = WELLNESS_SCORE_V2 }) {
  const weekStart = parseLocalDate(request?.weekStartLocalDate);
  const seed = request?.deterministicSeed || `${userID}|${request?.weekStartLocalDate}`;
  const slots = plannedSlots(profile, request?.includeOptionalSnack === true);
  if (slots.length === 0) throw new PlanError("PROFILE_INELIGIBLE", "Enable at least one meal slot.");
  const rejectedCandidateCounts = {};
  const eligibleBySlot = new Map();
  for (const slot of slots) {
    const eligible = recipes.filter((recipe) => {
      const reasons = eligibilityReasons(recipe, profile, slot, scoringConfiguration);
      for (const reason of reasons) increment(rejectedCandidateCounts, reason);
      return reasons.length === 0;
    }).sort(stableRecipeOrder);
    eligibleBySlot.set(slot, eligible);
  }
  const candidatePoolSize = new Set([...eligibleBySlot.values()].flat().map((recipe) => recipe.recipeID)).size;
  const diagnostics = {
    generatorVersion: "whole-week-serving-planner-v2",
    scoringVersion: scoringConfiguration.version,
    ruleVersion: "eligibility-rules-v1",
    deterministicSeed: seed,
    candidatePoolSize,
    eligibleCandidateCountBySlot: Object.fromEntries(slots.map((slot) => [slot, eligibleBySlot.get(slot).length])),
    rejectedCandidateCounts,
    selectedRecipeCount: 0,
    meanAbsoluteDailyCalorieDeviation: 0,
    meanAbsoluteDailyProteinDeviation: null,
    totalCostPenalty: 0,
    totalIngredientReusePenalty: 0,
    ingredientReusePercentage: null,
    activeCookingMinutesByDay: {},
    cookingSessionCount: 0,
    estimatedWasteGrams: null,
    estimatedWasteCoveragePercentage: 0,
    toleranceEvaluation: null,
    mealTargetShares: Object.fromEntries(slots.map((slot) => [slot, scoringConfiguration.mealTargetShares[slot] ?? 0])),
    variety: null,
    explanations: [],
    trigger: request?.trigger ?? "unknown",
    regenerationReason: request?.regenerationReason ?? null,
    lockedPlanItemCount: lockedItems.length,
  };
  if (candidatePoolSize === 0) throw new PlanError("CONTENT_INSUFFICIENT", "No reviewed recipes satisfy this profile.", 422, false, diagnostics);

  const planID = `plan-${digest(`${seed}|${request.weekStartLocalDate}`).slice(0, 16)}`;
  const lockedByPosition = validateLockedItems({ lockedItems, profile, weekStart, slots, scoringConfiguration });
  const selected = [];
  const days = [];
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const localDate = addDays(weekStart, dayOffset);
    const items = [];
    for (const slot of slots) {
      const itemID = `${planID}-d${dayOffset}-${slot}`;
      const locked = lockedByPosition.get(`${dateKey(localDate)}|${slot}`);
      if (locked) {
        const preserved = structuredClone(locked);
        items.push(preserved);
        selected.push(preserved);
        diagnostics.explanations.push({
          planItemID: preserved.id,
          code: "lockedByUser",
          message: "Kept because you locked this meal before regeneration.",
        });
        continue;
      }
      const leftover = !isCookingDay(profile, dayOffset) && profile.leftoverPreference !== "avoid"
        ? linkedLeftover({ itemID, localDate, slot, selected })
        : null;
      if (leftover) {
        items.push(leftover.item);
        selected.push(leftover.item);
        diagnostics.explanations.push({
          planItemID: leftover.item.id,
          code: "plannedLeftover",
          message: `Planned reuse from ${leftover.source.recipeSnapshot.displayName} to reduce cooking and waste.`,
        });
        continue;
      }
      const ranked = eligibleBySlot.get(slot).map((recipe) => rankRecipe({ recipe, selected, profile, request, seed, localDate, slot, slots, scoringConfiguration }))
        .filter(Boolean)
        .sort((left, right) => left.score - right.score || left.tie - right.tie || stableRecipeOrder(left.recipe, right.recipe));
      if (!ranked.length) {
        increment(diagnostics.rejectedCandidateCounts, "varietyLimit");
        throw new PlanError("NO_FEASIBLE_PLAN", "The reviewed recipe pool is too small for a safe varied week.", 422, false, diagnostics);
      }
      const chosen = ranked[0];
      const batchID = `batch-${itemID}`;
      const batchSource = isCookingDay(profile, dayOffset) && profile.leftoverPreference !== "avoid";
      const item = {
        id: itemID,
        localDate,
        slot,
        recipeSnapshot: structuredClone(chosen.recipe),
        servingMultiplier: chosen.breakdown.servingMultiplier,
        servingQuantityGrams: Number(chosen.recipe.servingSizeGrams) * chosen.breakdown.servingMultiplier,
        nutrition: scaleNutrition(chosen.recipe.nutritionPerServing, chosen.breakdown.servingMultiplier),
        leftoverRelationship: batchSource ? { batchSource: { batchID } } : { none: {} },
        completionState: "planned",
      };
      items.push(item);
      selected.push(item);
      diagnostics.totalIngredientReusePenalty += chosen.breakdown.ingredientReusePenalty;
      if (batchSource) diagnostics.explanations.push({ planItemID: item.id, code: "batchOpportunity", message: "Cook an extra portion for a later planned meal." });
      if (chosen.cuisineMatch) diagnostics.explanations.push({ planItemID: item.id, code: "cuisinePreference", message: "Matches one of your preferred cuisines." });
      if (chosen.favorite) diagnostics.explanations.push({ planItemID: item.id, code: "favorite", message: "Ranked higher because you marked this recipe as a favorite." });
      if (chosen.breakdown.servingMultiplier !== 1) diagnostics.explanations.push({ planItemID: item.id, code: "servingAdjusted", message: "Serving adjusted within this recipe’s reviewed bounds." });
    }
    days.push({ localDate, items });
  }

  let plan = {
    id: planID,
    timeZoneIdentifier: profile.timeZoneIdentifier,
    days,
    targetSnapshot: {
      dailyCalories: profile.calorieTarget,
      optionalDailyProteinGrams: profile.optionalDailyProteinTargetGrams ?? null,
      targetSource: profile.targetSource,
      targetVersion: profile.targetEstimatorVersion ?? null,
    },
    generatorVersion: "whole-week-serving-planner-v2",
    scoringVersion: diagnostics.scoringVersion,
    ruleVersion: diagnostics.ruleVersion,
  };
  const optimized = optimizeWeeklyServings({
    plan,
    profile,
    configuration: scoringConfiguration,
    lockedItemIDs: new Set(lockedItems.map((item) => item.id)),
  });
  plan = optimized.plan;
  diagnostics.toleranceEvaluation = optimized.toleranceEvaluation;
  diagnostics.generatorVersion = plan.generatorVersion;
  diagnostics.explanations = diagnostics.explanations.filter((item) => item.code !== "servingAdjusted");
  for (const item of plan.days.flatMap((day) => day.items)) {
    if (Number(item.servingMultiplier) !== 1) diagnostics.explanations.push({
      planItemID: item.id,
      code: "servingAdjusted",
      message: "Serving adjusted within this recipe’s reviewed bounds after whole-week target optimization.",
    });
  }

  const optimizedItems = plan.days.flatMap((day) => day.items);
  const variety = analyzeVariety(optimizedItems, new Set(request?.recentRecipeIDs ?? []));
  if (!variety.passed) throw new PlanError("NO_FEASIBLE_PLAN", "The generated week failed final variety validation.", 422, false, { ...diagnostics, variety });
  diagnostics.variety = variety;
  diagnostics.selectedRecipeCount = new Set(optimizedItems.map((item) => item.recipeSnapshot.recipeID)).size;
  diagnostics.meanAbsoluteDailyCalorieDeviation = plan.days.reduce((sum, day) => {
    const calories = day.items.reduce((subtotal, item) => subtotal + Number(item.nutrition.calories), 0);
    return sum + Math.abs(calories - profile.calorieTarget);
  }, 0) / 7;
  if (Number.isInteger(profile.optionalDailyProteinTargetGrams)) {
    diagnostics.meanAbsoluteDailyProteinDeviation = plan.days.reduce((sum, day) => {
      const protein = day.items.reduce((subtotal, item) => subtotal + Number(item.nutrition.proteinGrams), 0);
      return sum + Math.abs(protein - profile.optionalDailyProteinTargetGrams);
    }, 0) / 7;
  }
  diagnostics.totalCostPenalty = plan.days.flatMap((day) => day.items).reduce(
    (sum, item) => sum + costPenalty(item.recipeSnapshot.costBand, profile.budget, scoringConfiguration),
    0,
  );
  Object.assign(diagnostics, planQualityDiagnostics(plan));
  return { plan, diagnostics };
}

export function optimizeWeeklyServings({ plan, profile, configuration = WELLNESS_SCORE_V2, lockedItemIDs = new Set() }) {
  let optimized = structuredClone(plan);
  const groups = servingGroups(optimized);
  let objective = toleranceObjective(optimized, profile, configuration);
  let changed = true;
  let pass = 0;
  while (changed && pass < 4) {
    changed = false;
    pass += 1;
    for (const group of groups) {
      if (group.itemIDs.some((id) => lockedItemIDs.has(id))) continue;
      const source = optimized.days.flatMap((day) => day.items).find((item) => item.id === group.sourceItemID);
      if (!source) continue;
      let bestPlan = optimized;
      let bestObjective = objective;
      for (const multiplier of reviewedServingMultipliers(source.recipeSnapshot, configuration.servingMultiplierStep)) {
        const candidate = planWithServingMultiplier(optimized, group.itemIDs, multiplier);
        const candidateObjective = toleranceObjective(candidate, profile, configuration);
        if (compareObjective(candidateObjective, bestObjective) < 0) {
          bestPlan = candidate;
          bestObjective = candidateObjective;
        }
      }
      if (bestPlan !== optimized) {
        optimized = bestPlan;
        objective = bestObjective;
        changed = true;
      }
    }
  }
  return { plan: optimized, toleranceEvaluation: toleranceEvaluation(optimized, profile, configuration, pass) };
}

function servingGroups(plan) {
  const items = plan.days.flatMap((day) => day.items);
  const reusesBySource = new Map();
  for (const item of items) {
    const sourceID = item.leftoverRelationship?.plannedReuse?.sourcePlanItemID;
    if (sourceID) reusesBySource.set(sourceID, [...(reusesBySource.get(sourceID) ?? []), item.id]);
  }
  return items.filter((item) => !item.leftoverRelationship?.plannedReuse).map((item) => ({
    sourceItemID: item.id,
    itemIDs: [item.id, ...(reusesBySource.get(item.id) ?? [])],
  }));
}

function planWithServingMultiplier(plan, itemIDs, multiplier) {
  const result = structuredClone(plan);
  const ids = new Set(itemIDs);
  for (const item of result.days.flatMap((day) => day.items)) {
    if (!ids.has(item.id)) continue;
    item.servingMultiplier = multiplier;
    item.servingQuantityGrams = Number(item.recipeSnapshot.servingSizeGrams) * multiplier;
    item.nutrition = scaleNutrition(item.recipeSnapshot.nutritionPerServing, multiplier);
  }
  return result;
}

function reviewedServingMultipliers(recipe, configuredStep) {
  const minimum = Number(recipe.minimumServingMultiplier ?? 1);
  const maximum = Number(recipe.maximumServingMultiplier ?? 1);
  const step = Number.isFinite(configuredStep) && configuredStep > 0 ? configuredStep : 0.05;
  if (!servingBoundsAreValid(recipe)) return [1];
  const values = [minimum, 1, maximum];
  for (let value = Math.ceil(minimum / step) * step; value <= maximum + 0.000001; value += step) {
    values.push(Number(Math.min(maximum, Math.max(minimum, value)).toFixed(4)));
  }
  return [...new Set(values)].sort((left, right) => left - right);
}

function toleranceObjective(plan, profile, configuration) {
  const evaluation = toleranceEvaluation(plan, profile, configuration, 0);
  const totalCalorieDeviation = plan.days.reduce((sum, day) => sum + Math.abs(
    day.items.reduce((subtotal, item) => subtotal + Number(item.nutrition.calories), 0) - Number(profile.calorieTarget),
  ), 0);
  const totalProteinDeviation = Number.isInteger(profile.optionalDailyProteinTargetGrams)
    ? plan.days.reduce((sum, day) => sum + Math.abs(
      day.items.reduce((subtotal, item) => subtotal + Number(item.nutrition.proteinGrams), 0)
        - profile.optionalDailyProteinTargetGrams,
    ), 0) : 0;
  const multiplierDistance = plan.days.flatMap((day) => day.items)
    .reduce((sum, item) => sum + Math.abs(Number(item.servingMultiplier) - 1), 0);
  return [
    evaluation.weeklyCaloriesWithinTolerance ? 0 : 1,
    evaluation.weeklyCalorieExcess,
    7 - evaluation.dailyCaloriesWithinToleranceCount,
    evaluation.dailyCalorieExcess,
    evaluation.optionalProteinOutsideToleranceDayCount,
    totalCalorieDeviation,
    totalProteinDeviation,
    multiplierDistance,
  ];
}

function compareObjective(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function toleranceEvaluation(plan, profile, configuration, optimizationPasses) {
  const dailyAllowed = Number(profile.calorieTarget) * Number(configuration.dailyCalorieTolerancePercent ?? 5) / 100;
  const dailyDeviations = plan.days.map((day) => Math.abs(
    day.items.reduce((sum, item) => sum + Number(item.nutrition.calories), 0) - Number(profile.calorieTarget),
  ));
  const weeklyCalories = plan.days.flatMap((day) => day.items).reduce((sum, item) => sum + Number(item.nutrition.calories), 0);
  const weeklyTarget = Number(profile.calorieTarget) * plan.days.length;
  const weeklyAllowed = weeklyTarget * Number(configuration.weeklyCalorieTolerancePercent ?? 3) / 100;
  const weeklyDeviation = Math.abs(weeklyCalories - weeklyTarget);
  const proteinAllowed = Number(profile.optionalDailyProteinTargetGrams ?? 0)
    * Number(configuration.optionalProteinTolerancePercent ?? 10) / 100;
  const proteinDeviations = Number.isInteger(profile.optionalDailyProteinTargetGrams) ? plan.days.map((day) => Math.abs(
    day.items.reduce((sum, item) => sum + Number(item.nutrition.proteinGrams), 0)
      - profile.optionalDailyProteinTargetGrams,
  )) : [];
  const dailyCaloriesWithinToleranceCount = dailyDeviations.filter((value) => value <= dailyAllowed + 0.000001).length;
  const weeklyCaloriesWithinTolerance = weeklyDeviation <= weeklyAllowed + 0.000001;
  const optionalProteinOutsideToleranceDayCount = proteinDeviations.filter((value) => value > proteinAllowed + 0.000001).length;
  const relaxations = [];
  if (optionalProteinOutsideToleranceDayCount) relaxations.push("optional_protein");
  if (dailyCaloriesWithinToleranceCount < plan.days.length) relaxations.push("daily_calories");
  if (!weeklyCaloriesWithinTolerance) relaxations.push("weekly_calories");
  return {
    contractVersion: "planner-tolerance-v1",
    dailyCalorieTolerancePercent: Number(configuration.dailyCalorieTolerancePercent ?? 5),
    weeklyCalorieTolerancePercent: Number(configuration.weeklyCalorieTolerancePercent ?? 3),
    optionalProteinTolerancePercent: Number(configuration.optionalProteinTolerancePercent ?? 10),
    dailyCaloriesWithinToleranceCount,
    dailyCalorieExcess: dailyDeviations.reduce((sum, value) => sum + Math.max(0, value - dailyAllowed), 0),
    weeklyCaloriesWithinTolerance,
    weeklyCalorieExcess: Math.max(0, weeklyDeviation - weeklyAllowed),
    optionalProteinOutsideToleranceDayCount,
    dailyCalorieAbsoluteDeviationPercentages: dailyDeviations.map((value) => percent(value, Number(profile.calorieTarget))),
    weeklyCalorieAbsoluteDeviationPercent: percent(weeklyDeviation, weeklyTarget),
    optionalProteinAbsoluteDeviationGrams: proteinDeviations,
    relaxations,
    optimizationPasses,
  };
}

function planQualityDiagnostics(plan) {
  const ingredientMealCounts = new Map();
  const purchasedGrams = new Map();
  const packSizes = new Map();
  const activeCookingMinutesByDay = {};
  let cookingSessionCount = 0;
  for (const day of plan.days) {
    const dayKey = dateKey(day.localDate);
    let activeMinutes = 0;
    for (const item of day.items) {
      const mealIngredients = new Set((item.recipeSnapshot.ingredients ?? [])
        .map((ingredient) => normalized(ingredient.ingredientID)).filter(Boolean));
      for (const ingredientID of mealIngredients) {
        ingredientMealCounts.set(ingredientID, (ingredientMealCounts.get(ingredientID) ?? 0) + 1);
      }
      if (item.leftoverRelationship?.plannedReuse) continue;
      cookingSessionCount += 1;
      activeMinutes += Number(item.recipeSnapshot.activePreparationMinutes ?? 0);
      for (const ingredient of item.recipeSnapshot.ingredients ?? []) {
        const ingredientID = normalized(ingredient.ingredientID);
        if (!ingredientID) continue;
        purchasedGrams.set(ingredientID, (purchasedGrams.get(ingredientID) ?? 0)
          + Number(ingredient.grams ?? 0) * Number(item.servingMultiplier ?? 1));
        const packSize = Number(ingredient.purchasePackSizeGrams);
        if (Number.isFinite(packSize) && packSize > 0 && !packSizes.has(ingredientID)) packSizes.set(ingredientID, packSize);
      }
    }
    activeCookingMinutesByDay[dayKey] = activeMinutes;
  }
  const ingredientCount = ingredientMealCounts.size;
  const reusedIngredientCount = [...ingredientMealCounts.values()].filter((count) => count >= 2).length;
  let estimatedWasteGrams = 0;
  for (const [ingredientID, grams] of purchasedGrams) {
    const packSize = packSizes.get(ingredientID);
    if (packSize) estimatedWasteGrams += Math.max(0, Math.ceil(grams / packSize) * packSize - grams);
  }
  return {
    ingredientReusePercentage: ingredientCount ? reusedIngredientCount * 100 / ingredientCount : 0,
    activeCookingMinutesByDay,
    cookingSessionCount,
    estimatedWasteGrams: packSizes.size ? estimatedWasteGrams : null,
    estimatedWasteCoveragePercentage: purchasedGrams.size ? packSizes.size * 100 / purchasedGrams.size : 0,
  };
}

function percent(numerator, denominator) {
  return denominator > 0 ? numerator * 100 / denominator : 0;
}

function validateLockedItems({ lockedItems, profile, weekStart, slots, scoringConfiguration }) {
  const positions = new Map();
  const lockedIDs = new Set(lockedItems.map((item) => item.id));
  for (const item of lockedItems) {
    const offset = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
      .findIndex((date) => dateKey(date) === dateKey(item.localDate));
    const unsafe = offset < 0
      || !slots.includes(item.slot)
      || eligibilityReasons(item.recipeSnapshot, profile, item.slot, scoringConfiguration).length > 0
      || item.recipeSnapshot.activePreparationMinutes > profile.maximumActiveMinutes
      || Number(item.servingMultiplier) < Number(item.recipeSnapshot.minimumServingMultiplier ?? 1)
      || Number(item.servingMultiplier) > Number(item.recipeSnapshot.maximumServingMultiplier ?? 1);
    if (unsafe) {
      throw new PlanError("VALIDATION_ERROR", "A locked meal no longer satisfies the current planning rules.", 400, false, {
        invalidLockedPlanItemID: item.id,
      });
    }
    const plannedReuse = item.leftoverRelationship?.plannedReuse;
    if (plannedReuse && !lockedIDs.has(plannedReuse.sourcePlanItemID)) {
      throw new PlanError("VALIDATION_ERROR", "Lock the linked batch meal together with its planned leftover.", 400, false, {
        invalidLockedPlanItemID: item.id,
      });
    }
    const key = `${dateKey(item.localDate)}|${item.slot}`;
    if (positions.has(key)) {
      throw new PlanError("VALIDATION_ERROR", "Only one meal can be locked in each plan slot.", 400);
    }
    positions.set(key, item);
  }
  return positions;
}

export function eligibilityReasons(recipe, profile, slot, configuration = WELLNESS_SCORE_V2) {
  const reasons = [];
  if (recipe.publicationStatus !== "published") reasons.push("notPublished");
  if (recipe.reviewStatus !== "approved") reasons.push("nutritionReviewNotApproved");
  const eligibleLocales = new Set((configuration.eligibleLocaleIdentifiers ?? []).map(normalized));
  if (eligibleLocales.size && !eligibleLocales.has(normalized(recipe.localeIdentifier))) reasons.push("localeUnavailable");
  const currentCalculations = new Set((configuration.currentNutritionCalculationVersions ?? []).map(normalized));
  if (currentCalculations.size && !currentCalculations.has(normalized(recipe.nutritionCalculationVersion))) {
    reasons.push("nutritionCalculationVersionStale");
  }
  if (!dietCompatible(recipe.dietType, profile.diet)) reasons.push("dietMismatch");
  if (!recipe.eligibleSlots?.includes(slot)) reasons.push("mealSlotMismatch");
  if (recipe.activePreparationMinutes > profile.maximumActiveMinutes) reasons.push("activeTimeExceeded");
  const allergens = new Set([...(recipe.allergenIDs ?? []), ...(recipe.ingredients ?? []).flatMap((item) => item.allergenIDs ?? [])].map(normalized));
  if ((profile.allergens ?? []).some((item) => allergens.has(normalized(item)))) reasons.push("allergenConflict");
  const ingredientIDs = new Set((recipe.ingredients ?? []).map((item) => normalized(item.ingredientID)));
  if ((profile.ingredientExclusions ?? []).some((item) => ingredientIDs.has(normalized(item)))) reasons.push("ingredientExclusion");
  const dislikedFoods = new Set((profile.dislikedFoods ?? []).map(normalized));
  if ((recipe.ingredients ?? []).some((item) => (
    dislikedFoods.has(normalized(item.ingredientID)) || dislikedFoods.has(normalized(item.displayName))
  ))) reasons.push("dislikedIngredient");
  if (Array.isArray(profile.availableEquipment) && Array.isArray(recipe.equipment)) {
    const available = new Set(profile.availableEquipment.map(normalized));
    if (recipe.equipment.some((item) => !available.has(normalized(item)))) reasons.push("equipmentUnavailable");
  }
  if (!servingBoundsAreValid(recipe)) reasons.push("invalidServingBounds");
  return reasons;
}

function rankRecipe({ recipe, selected, profile, request, seed, localDate, slot, slots, scoringConfiguration }) {
  const freshCount = selected.filter((item) => item.recipeSnapshot.recipeID === recipe.recipeID && !item.leftoverRelationship.plannedReuse).length;
  if (freshCount >= 1) return null;
  const dominantCounts = countValues(selected.flatMap((item) => item.recipeSnapshot.dominantIngredientIDs ?? []));
  if ((recipe.dominantIngredientIDs ?? []).some((id) => (dominantCounts[id] ?? 0) >= 3)) return null;
  const recent = (request?.recentRecipeIDs ?? []).includes(recipe.recipeID);
  const cuisineMatch = cuisineMatches(recipe, profile);
  const favorite = (request?.favoriteRecipeIDs ?? []).includes(recipe.recipeID);
  const existingIngredientIDs = new Set(selected.flatMap((item) => item.recipeSnapshot.ingredients?.map((ingredient) => normalized(ingredient.ingredientID)) ?? []));
  const breakdown = scoreRecipe(recipe, profile, slot, slots, scoringConfiguration, existingIngredientIDs);
  let score = breakdown.total;
  if (recent) score += scoringConfiguration.recentRecipePenalty;
  if (cuisineMatch) score -= scoringConfiguration.cuisinePreferenceReward;
  if (favorite) score -= scoringConfiguration.favoriteReward;
  return { recipe, score, breakdown, tie: stableNumber(`${seed}|${dateKey(localDate)}|${slot}|${recipe.recipeID}`), cuisineMatch, favorite };
}

export function scoreRecipe(recipe, profile, slot, activeSlots, configuration = WELLNESS_SCORE_V2, existingIngredientIDs = new Set()) {
  const calorieTarget = targetForSlot(profile.calorieTarget, slot, activeSlots, configuration.mealTargetShares);
  const proteinTarget = Number.isInteger(profile.optionalDailyProteinTargetGrams)
    ? targetForSlot(profile.optionalDailyProteinTargetGrams, slot, activeSlots, configuration.mealTargetShares)
    : null;
  const activeTimePenalty = Number(recipe.activePreparationMinutes) * configuration.activeMinuteWeight;
  const recipeCostPenalty = costPenalty(recipe.costBand, profile.budget, configuration);
  const equipmentLoadPenalty = (recipe.equipment?.length ?? 0) * configuration.equipmentItemWeight;
  const normalizedExisting = new Set([...existingIngredientIDs].map(normalized));
  const recipeIngredientIDs = new Set((recipe.ingredients ?? []).map((ingredient) => normalized(ingredient.ingredientID)).filter(Boolean));
  const ingredientReusePenalty = normalizedExisting.size === 0 ? 0
    : [...recipeIngredientIDs].filter((ingredient) => !normalizedExisting.has(ingredient)).length * configuration.newIngredientPenalty
      - [...recipeIngredientIDs].filter((ingredient) => normalizedExisting.has(ingredient)).length * configuration.ingredientReuseReward;
  return servingCandidates(recipe, calorieTarget, proteinTarget, configuration.servingMultiplierStep).map((servingMultiplier) => {
    const nutrition = scaleNutrition(recipe.nutritionPerServing, servingMultiplier);
    const calorieDeviation = Math.abs(Number(nutrition.calories) - calorieTarget) * configuration.calorieDeviationWeight;
    const proteinDeviation = proteinTarget == null ? 0
      : Math.abs(Number(nutrition.proteinGrams) - proteinTarget) * configuration.proteinDeviationWeight;
    return {
      servingMultiplier,
      calorieDeviation,
      proteinDeviation,
      activeTimePenalty,
      costPenalty: recipeCostPenalty,
      equipmentLoadPenalty,
      ingredientReusePenalty,
      total: calorieDeviation + proteinDeviation + activeTimePenalty + recipeCostPenalty + equipmentLoadPenalty + ingredientReusePenalty,
    };
  }).sort((left, right) => left.total - right.total
    || Math.abs(left.servingMultiplier - 1) - Math.abs(right.servingMultiplier - 1)
    || left.servingMultiplier - right.servingMultiplier)[0];
}

function servingCandidates(recipe, calorieTarget, proteinTarget, configuredStep) {
  const minimum = Number(recipe.minimumServingMultiplier ?? 1);
  const maximum = Number(recipe.maximumServingMultiplier ?? 1);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)
      || minimum < 0.25 || maximum > 4 || minimum > 1 || maximum < 1 || minimum > maximum) return [1];
  const step = Number.isFinite(configuredStep) && configuredStep > 0 ? configuredStep : 0.05;
  const candidate = (rawValue) => {
    const clamped = Math.min(maximum, Math.max(minimum, rawValue));
    return Number(Math.min(maximum, Math.max(minimum, Math.round(clamped / step) * step)).toFixed(4));
  };
  const values = [minimum, 1, maximum];
  const calories = Number(recipe.nutritionPerServing.calories);
  if (calories > 0) values.push(candidate(calorieTarget / calories));
  const protein = Number(recipe.nutritionPerServing.proteinGrams);
  if (proteinTarget != null && protein > 0) values.push(candidate(proteinTarget / protein));
  return [...new Set(values)];
}

function servingBoundsAreValid(recipe) {
  const minimum = Number(recipe.minimumServingMultiplier ?? 1);
  const maximum = Number(recipe.maximumServingMultiplier ?? 1);
  return Number.isFinite(minimum) && Number.isFinite(maximum)
    && minimum >= 0.25 && maximum <= 4 && minimum <= 1 && maximum >= 1 && minimum <= maximum;
}

export function scaleNutrition(nutrition, multiplier) {
  return {
    calories: Number(nutrition.calories) * multiplier,
    proteinGrams: Number(nutrition.proteinGrams) * multiplier,
    carbohydrateGrams: Number(nutrition.carbohydrateGrams) * multiplier,
    fatGrams: Number(nutrition.fatGrams) * multiplier,
    fibreGrams: Number(nutrition.fibreGrams) * multiplier,
  };
}

export function targetForSlot(dailyTarget, slot, activeSlots, shares = WELLNESS_SCORE_V2.mealTargetShares) {
  return targetsForSlots(dailyTarget, activeSlots, shares)[slot]
    ?? (activeSlots.length ? Math.floor(dailyTarget / activeSlots.length) : dailyTarget);
}

export function targetsForSlots(dailyTarget, activeSlots, shares = WELLNESS_SCORE_V2.mealTargetShares) {
  if (!activeSlots.length) return {};
  const totalShare = activeSlots.reduce((sum, item) => sum + Math.max(0, shares[item] ?? 0), 0);
  if (totalShare <= 0) {
    const base = Math.floor(dailyTarget / activeSlots.length);
    const remainder = dailyTarget - base * activeSlots.length;
    return Object.fromEntries(activeSlots.map((item, index) => [item, base + (index < remainder ? 1 : 0)]));
  }
  const targets = Object.fromEntries(activeSlots.map((item) => [
    item,
    Math.floor(dailyTarget * Math.max(0, shares[item] ?? 0) / totalShare),
  ]));
  let remainder = dailyTarget - Object.values(targets).reduce((sum, value) => sum + value, 0);
  const ranked = activeSlots.map((item, index) => ({
    item,
    index,
    remainder: dailyTarget * Math.max(0, shares[item] ?? 0) % totalShare,
  })).sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (const entry of ranked) {
    if (remainder <= 0) break;
    targets[entry.item] += 1;
    remainder -= 1;
  }
  return targets;
}

function costPenalty(recipeBand = "medium", budgetBand = "medium", configuration = WELLNESS_SCORE_V2) {
  const recipeRank = costRank(recipeBand);
  const budgetRank = costRank(budgetBand);
  return recipeRank * configuration.costBandWeight
    + Math.max(0, recipeRank - budgetRank) * configuration.budgetExcessWeight;
}

function costRank(band) {
  if (band === "value") return 0;
  if (band === "flexible") return 2;
  return 1;
}

function linkedLeftover({ itemID, localDate, slot, selected }) {
  const dominantCounts = countValues(selected.flatMap((item) => item.recipeSnapshot.dominantIngredientIDs ?? []));
  for (const source of [...selected].reverse()) {
    if (source.slot !== slot || !source.leftoverRelationship.batchSource) continue;
    const batchID = source.leftoverRelationship.batchSource.batchID;
    const reuseCount = selected.filter((item) => item.leftoverRelationship.plannedReuse?.batchID === batchID).length;
    if (reuseCount >= 2) continue;
    if ((source.recipeSnapshot.dominantIngredientIDs ?? []).some((id) => (dominantCounts[id] ?? 0) >= 3)) continue;
    return {
      source,
      item: {
        ...structuredClone(source),
        id: itemID,
        localDate,
        leftoverRelationship: { plannedReuse: { batchID, sourcePlanItemID: source.id } },
      },
    };
  }
  return null;
}

export function analyzeVariety(items, recentRecipeIDs) {
  const fresh = items.filter((item) => !item.leftoverRelationship.plannedReuse);
  const leftovers = items.filter((item) => item.leftoverRelationship.plannedReuse);
  const freshCounts = countValues(fresh.map((item) => item.recipeSnapshot.recipeID));
  const leftoverCounts = countValues(leftovers.map((item) => item.recipeSnapshot.recipeID));
  const dominantCounts = countValues(items.flatMap((item) => item.recipeSnapshot.dominantIngredientIDs ?? []));
  const accidental = Object.values(freshCounts).reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  return {
    passed: accidental === 0 && Object.values(leftoverCounts).every((count) => count <= 2) && Object.values(dominantCounts).every((count) => count <= 3),
    accidentalExactRepeats: accidental,
    intentionalLeftovers: leftovers.length,
    peakDominantIngredientAppearances: Math.max(0, ...Object.values(dominantCounts)),
    recentRecipeMatches: [...new Set(fresh.map((item) => item.recipeSnapshot.recipeID).filter((id) => recentRecipeIDs.has(id)))],
  };
}

function plannedSlots(profile, includeOptionalSnack) {
  const slots = ["breakfast", "lunch", "dinner"].filter((slot) => profile.enabledMealSlots.includes(slot));
  if (profile.snackPreference === "planned" || (profile.snackPreference === "optional" && includeOptionalSnack)) slots.push("snack");
  return slots;
}

function isCookingDay(profile, dayOffset) {
  return profile.cookingDays.includes(dayOffset + 1);
}

function dietCompatible(recipeDiet, requestedDiet) {
  if (requestedDiet === "vegan") return recipeDiet === "vegan";
  if (requestedDiet === "vegetarian") return recipeDiet === "vegan" || recipeDiet === "vegetarian";
  if (requestedDiet === "eggetarian") return ["vegan", "vegetarian", "eggetarian"].includes(recipeDiet);
  return requestedDiet === "nonVegetarian";
}

function cuisineMatches(recipe, profile) {
  const preferences = new Set((profile.cuisines ?? []).map(normalized));
  return (recipe.tags ?? []).map((tag) => normalized(tag).replace("cuisine:", "")).some((tag) => preferences.has(tag));
}

function parseLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) throw new PlanError("VALIDATION_ERROR", "Use a valid YYYY-MM-DD week start.", 400);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function addDays(localDate, offset) {
  const date = new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day + offset));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function dateKey(date) {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function localDateKey(date, timeZoneIdentifier) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZoneIdentifier,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function stableRecipeOrder(left, right) {
  return left.recipeID.localeCompare(right.recipeID) || left.version - right.version;
}

function countValues(values) {
  return values.reduce((counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }), {});
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}

function configuredList(value) {
  return [...new Set(String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean))];
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableNumber(value) {
  return Number.parseInt(digest(value).slice(0, 12), 16);
}

function withoutOwner(record) {
  const { userID: _userID, ...safe } = record;
  return safe;
}
