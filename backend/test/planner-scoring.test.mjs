import assert from "node:assert/strict";
import test from "node:test";
import {
  WELLNESS_SCORE_V2,
  eligibilityReasons,
  optimizeWeeklyServings,
  plannerConfigurationFromEnvironment,
  scoreRecipe,
  targetsForSlots,
} from "../src/planner-service.mjs";
import { MemoryCatalogueStore, validateForPublication } from "../src/catalogue-service.mjs";

const slots = ["breakfast", "lunch", "dinner"];
const profile = {
  calorieTarget: 1_850,
  optionalDailyProteinTargetGrams: 90,
  budget: "value",
  availableEquipment: ["stovetop", "pan"],
  maximumActiveMinutes: 35,
  diet: "vegetarian",
  allergens: [],
  ingredientExclusions: [],
  dislikedFoods: [],
};

function recipe(overrides = {}) {
  return {
    recipeID: "scoring-fixture",
    version: 1,
    publicationStatus: "published",
    localeIdentifier: "en-IN",
    reviewStatus: "approved",
    nutritionCalculationVersion: "test-v1",
    dietType: "vegetarian",
    eligibleSlots: ["lunch"],
    ingredients: [],
    allergenIDs: [],
    nutritionPerServing: { calories: 682, proteinGrams: 33, carbohydrateGrams: 70, fatGrams: 20, fibreGrams: 10 },
    activePreparationMinutes: 20,
    equipment: ["pan"],
    costBand: "value",
    ...overrides,
  };
}

test("wellness score v3 assigns exact meal-specific daily targets", () => {
  const targets = targetsForSlots(profile.calorieTarget, slots);
  assert.equal(Object.values(targets).reduce((sum, value) => sum + value, 0), profile.calorieTarget);
  assert.ok(targets.lunch > targets.breakfast);
  assert.equal(WELLNESS_SCORE_V2.version, "wellness-score-v3");
});

test("wellness score v3 applies protein, cost, and equipment signals after hard eligibility", () => {
  const fit = recipe();
  const expensive = recipe({ recipeID: "expensive", costBand: "flexible" });
  const fitScore = scoreRecipe(fit, profile, "lunch", slots);
  const expensiveScore = scoreRecipe(expensive, profile, "lunch", slots);
  assert.equal(fitScore.proteinDeviation, 0);
  assert.ok(fitScore.total < expensiveScore.total);
  assert.deepEqual(eligibilityReasons(recipe({ equipment: ["oven"] }), profile, "lunch"), ["equipmentUnavailable"]);
});

test("wellness score v3 scales only within reviewed bounds", () => {
  const scalable = recipe({
    nutritionPerServing: { calories: 500, proteinGrams: 25, carbohydrateGrams: 50, fatGrams: 15, fibreGrams: 8 },
    minimumServingMultiplier: 0.75,
    maximumServingMultiplier: 1.4,
  });
  const fixed = recipe({
    recipeID: "fixed",
    nutritionPerServing: scalable.nutritionPerServing,
    minimumServingMultiplier: 1,
    maximumServingMultiplier: 1,
  });
  const scalableScore = scoreRecipe(scalable, profile, "lunch", slots);
  const fixedScore = scoreRecipe(fixed, profile, "lunch", slots);
  assert.ok(scalableScore.servingMultiplier > 1 && scalableScore.servingMultiplier <= 1.4);
  assert.ok(scalableScore.calorieDeviation < fixedScore.calorieDeviation);
});

test("wellness score v3 rewards grocery overlap and rejects malformed serving bounds", () => {
  const overlapping = recipe({ ingredients: [{ ingredientID: "spinach" }] });
  const novel = recipe({ recipeID: "novel", ingredients: [{ ingredientID: "rice" }] });
  const existing = new Set(["spinach", "chickpeas"]);
  const overlapScore = scoreRecipe(overlapping, profile, "lunch", slots, undefined, existing);
  const novelScore = scoreRecipe(novel, profile, "lunch", slots, undefined, existing);
  assert.ok(overlapScore.ingredientReusePenalty < novelScore.ingredientReusePenalty);
  assert.deepEqual(
    eligibilityReasons(recipe({ minimumServingMultiplier: 1.2, maximumServingMultiplier: 0.8 }), profile, "lunch"),
    ["invalidServingBounds"],
  );
  assert.deepEqual(
    eligibilityReasons(
      recipe({ ingredients: [{ ingredientID: "mushrooms", displayName: "Mushrooms" }] }),
      { ...profile, dislikedFoods: ["mushrooms"] },
      "lunch",
    ),
    ["dislikedIngredient"],
  );
});

test("catalogue publication blocks unreviewable serving ranges", () => {
  const issues = validateForPublication({
    displayName: "Invalid serving fixture",
    ingredients: [],
    methodSteps: ["Cook safely."],
    servings: 1,
    servingSizeGrams: 300,
    minimumServingMultiplier: 1.2,
    maximumServingMultiplier: 0.8,
    nutritionPerServing: { calories: 500 },
    nutritionCalculationVersion: "test-v1",
    declaredAllergenIDs: [],
    nutrientRecordIDs: [],
  }, new MemoryCatalogueStore(), new Date("2026-07-18T00:00:00.000Z"));
  assert.ok(issues.includes("INVALID_SERVING"));
});

test("production planner configuration fails closed and gates locale and calculation versions", () => {
  assert.throws(
    () => plannerConfigurationFromEnvironment({ NODE_ENV: "production" }),
    /NOURISH_PLANNER_ELIGIBLE_LOCALES/,
  );
  const configuration = plannerConfigurationFromEnvironment({
    NODE_ENV: "production",
    NOURISH_PLANNER_ELIGIBLE_LOCALES: "en-IN, hi-IN",
    NOURISH_PLANNER_NUTRITION_CALCULATION_VERSIONS: "test-v1",
  });
  assert.deepEqual(eligibilityReasons(recipe(), profile, "lunch", configuration), []);
  assert.deepEqual(
    eligibilityReasons(recipe({ localeIdentifier: "en-GB" }), profile, "lunch", configuration),
    ["localeUnavailable"],
  );
  assert.deepEqual(
    eligibilityReasons(recipe({ nutritionCalculationVersion: "legacy-v0" }), profile, "lunch", configuration),
    ["nutritionCalculationVersionStale"],
  );
});

test("whole-week serving optimization reaches feasible tolerances and records impossible relaxation", () => {
  const scalable = recipe({
    servingSizeGrams: 300,
    nutritionPerServing: { calories: 800, proteinGrams: 40, carbohydrateGrams: 80, fatGrams: 20, fibreGrams: 10 },
    minimumServingMultiplier: 0.75,
    maximumServingMultiplier: 1.25,
  });
  const plan = {
    id: "optimizer-plan",
    timeZoneIdentifier: "Asia/Kolkata",
    days: Array.from({ length: 7 }, (_, index) => ({
      localDate: { year: 2026, month: 7, day: 20 + index },
      items: [{
        id: `item-${index}`,
        slot: "lunch",
        recipeSnapshot: structuredClone(scalable),
        servingMultiplier: 1,
        servingQuantityGrams: 300,
        nutrition: structuredClone(scalable.nutritionPerServing),
        leftoverRelationship: { none: {} },
      }],
    })),
  };
  const targetProfile = { ...profile, calorieTarget: 1_000, optionalDailyProteinTargetGrams: 50 };
  const optimized = optimizeWeeklyServings({ plan, profile: targetProfile });
  assert.equal(optimized.toleranceEvaluation.dailyCaloriesWithinToleranceCount, 7);
  assert.equal(optimized.toleranceEvaluation.weeklyCaloriesWithinTolerance, true);
  assert.deepEqual(optimized.toleranceEvaluation.dailyCalorieAbsoluteDeviationPercentages, [0, 0, 0, 0, 0, 0, 0]);
  assert.equal(optimized.toleranceEvaluation.weeklyCalorieAbsoluteDeviationPercent, 0);
  assert.deepEqual(optimized.toleranceEvaluation.optionalProteinAbsoluteDeviationGrams, [0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(optimized.toleranceEvaluation.relaxations, []);
  assert.ok(optimized.plan.days.every((day) => day.items[0].servingMultiplier === 1.25));

  const fixed = structuredClone(plan);
  for (const item of fixed.days.flatMap((day) => day.items)) {
    item.recipeSnapshot.minimumServingMultiplier = 1;
    item.recipeSnapshot.maximumServingMultiplier = 1;
  }
  const infeasible = optimizeWeeklyServings({ plan: fixed, profile: targetProfile });
  assert.deepEqual(infeasible.toleranceEvaluation.relaxations, ["optional_protein", "daily_calories", "weekly_calories"]);
  assert.deepEqual(infeasible.toleranceEvaluation.dailyCalorieAbsoluteDeviationPercentages, [20, 20, 20, 20, 20, 20, 20]);
  assert.equal(infeasible.toleranceEvaluation.weeklyCalorieAbsoluteDeviationPercent, 20);
  assert.deepEqual(infeasible.toleranceEvaluation.optionalProteinAbsoluteDeviationGrams, [10, 10, 10, 10, 10, 10, 10]);
});
