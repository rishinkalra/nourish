(function attachPlanner(root, factory) {
  const planner = factory();
  if (typeof module === "object" && module.exports) module.exports = planner;
  else root.NourishPlanner = planner;
})(typeof globalThis !== "undefined" ? globalThis : this, function createPlanner() {
  const DEFAULT_VARIETY_RULES = Object.freeze({
    maxFreshRecipeAppearances: 1,
    maxDominantIngredientAppearances: 3,
    maxIntentionalLeftoversPerRecipe: 2,
    recentRecipeCooldownWeeks: 2,
    penalties: Object.freeze({ exactRepeat: 45, dominantIngredient: 12, recentRecipe: 25, linkedLeftover: -30 }),
  });

  function mergedRules(rules = {}) {
    return { ...DEFAULT_VARIETY_RULES, ...rules, penalties: { ...DEFAULT_VARIETY_RULES.penalties, ...(rules.penalties || {}) } };
  }

  function countBy(values) {
    return values.reduce((counts, value) => {
      if (value) counts[value] = (counts[value] || 0) + 1;
      return counts;
    }, {});
  }

  function analyzeVariety(planItems, recentRecipeIds = [], providedRules = {}) {
    const rules = mergedRules(providedRules);
    const freshItems = planItems.filter((item) => item.reuseType !== "leftover");
    const leftoverItems = planItems.filter((item) => item.reuseType === "leftover");
    const freshRecipeCounts = countBy(freshItems.map((item) => item.recipeId));
    const leftoverCounts = countBy(leftoverItems.map((item) => item.recipeId));
    const ingredientCounts = countBy(planItems.flatMap((item) => item.dominantIngredients || []));
    const recentSet = new Set(recentRecipeIds);

    const exactRepeatViolations = Object.entries(freshRecipeCounts)
      .filter(([, count]) => count > rules.maxFreshRecipeAppearances)
      .map(([recipeId, count]) => ({ recipeId, count, limit: rules.maxFreshRecipeAppearances }));
    const leftoverViolations = Object.entries(leftoverCounts)
      .filter(([, count]) => count > rules.maxIntentionalLeftoversPerRecipe)
      .map(([recipeId, count]) => ({ recipeId, count, limit: rules.maxIntentionalLeftoversPerRecipe }));
    const ingredientViolations = Object.entries(ingredientCounts)
      .filter(([, count]) => count > rules.maxDominantIngredientAppearances)
      .map(([ingredientId, count]) => ({ ingredientId, count, limit: rules.maxDominantIngredientAppearances }));
    const recentRecipeMatches = [...new Set(freshItems.map((item) => item.recipeId).filter((id) => recentSet.has(id)))];
    const peakIngredientCount = Math.max(0, ...Object.values(ingredientCounts));

    return {
      passed: exactRepeatViolations.length === 0 && leftoverViolations.length === 0 && ingredientViolations.length === 0,
      exactRepeatCount: exactRepeatViolations.reduce((sum, item) => sum + item.count - item.limit, 0),
      intentionalLeftoverCount: leftoverItems.length,
      peakIngredientCount,
      recentRecipeMatches,
      violations: { exactRecipes: exactRepeatViolations, leftovers: leftoverViolations, dominantIngredients: ingredientViolations },
    };
  }

  function scoreVarietyCandidate(candidate, context, providedRules = {}) {
    const rules = mergedRules(providedRules);
    const planItems = context.planItems || [];
    const sameFreshRecipeCount = planItems.filter((item) => item.recipeId === candidate.recipeId && item.reuseType !== "leftover").length;
    const isLinkedLeftover = candidate.reuseType === "leftover" && candidate.batchId && planItems.some((item) => item.batchId === candidate.batchId);
    const ingredientCounts = countBy(planItems.flatMap((item) => item.dominantIngredients || []));
    const dominantPressure = (candidate.dominantIngredients || []).filter((id) => (ingredientCounts[id] || 0) >= rules.maxDominantIngredientAppearances - 1).length;
    const isRecent = (context.recentRecipeIds || []).includes(candidate.recipeId);

    const penalty =
      (isLinkedLeftover ? rules.penalties.linkedLeftover : sameFreshRecipeCount * rules.penalties.exactRepeat) +
      dominantPressure * rules.penalties.dominantIngredient +
      (isRecent ? rules.penalties.recentRecipe : 0);

    return {
      penalty,
      factors: { isLinkedLeftover, sameFreshRecipeCount, dominantPressure, isRecent },
      withinVarietyLimits: isLinkedLeftover || sameFreshRecipeCount < rules.maxFreshRecipeAppearances,
    };
  }

  return { DEFAULT_VARIETY_RULES, analyzeVariety, scoreVarietyCandidate };
});
