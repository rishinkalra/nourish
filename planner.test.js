const assert = require("node:assert/strict");
const { analyzeVariety, scoreVarietyCandidate } = require("./planner.js");

const variedWeek = [
  { recipeId: "palak-paneer", batchId: "batch-a", dominantIngredients: ["spinach", "paneer"] },
  { recipeId: "palak-paneer", batchId: "batch-a", reuseType: "leftover", dominantIngredients: ["spinach", "paneer"] },
  { recipeId: "rajma-bowl", dominantIngredients: ["rajma", "tomato"] },
  { recipeId: "moong-chilla", dominantIngredients: ["moong", "onion"] },
  { recipeId: "idli-sambar", dominantIngredients: ["rice", "toor-dal"] },
];

const healthyDiagnostics = analyzeVariety(variedWeek);
assert.equal(healthyDiagnostics.passed, true);
assert.equal(healthyDiagnostics.exactRepeatCount, 0);
assert.equal(healthyDiagnostics.intentionalLeftoverCount, 1);

const accidentalRepeat = analyzeVariety([...variedWeek, { recipeId: "rajma-bowl", dominantIngredients: ["rajma", "tomato"] }]);
assert.equal(accidentalRepeat.passed, false);
assert.equal(accidentalRepeat.exactRepeatCount, 1);

const leftoverScore = scoreVarietyCandidate(
  { recipeId: "palak-paneer", batchId: "batch-a", reuseType: "leftover", dominantIngredients: ["spinach", "paneer"] },
  { planItems: variedWeek, recentRecipeIds: [] },
);
assert.equal(leftoverScore.factors.isLinkedLeftover, true);
assert.equal(leftoverScore.withinVarietyLimits, true);
assert.ok(leftoverScore.penalty < 0);

const fatiguedScore = scoreVarietyCandidate(
  { recipeId: "rajma-bowl", dominantIngredients: ["rajma", "tomato"] },
  { planItems: variedWeek, recentRecipeIds: ["rajma-bowl"] },
);
assert.equal(fatiguedScore.factors.isRecent, true);
assert.ok(fatiguedScore.penalty > 0);

console.log("Planner variety tests passed");
