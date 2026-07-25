import assert from "node:assert/strict";
import test from "node:test";
import { CatalogueService } from "../src/catalogue-service.mjs";

const now = new Date("2026-07-25T00:00:00.000Z");
const author = { id: "catalogue-author", roles: ["author"] };
const reviewer = { id: "nutrition-reviewer", roles: ["reviewer"] };

function serviceWithAIRecord() {
  const service = new CatalogueService({ now: () => now });
  service.upsertIngredient({
    id: "regional-leaf",
    canonicalName: "Regional leaf",
    category: "vegetable",
    compatibleDiets: ["vegetarian", "eggetarian", "nonVegetarian"],
    allergenIDs: [],
    conversions: [{ householdUnit: "cup", householdQuantity: 1, grams: 80 }],
  }, reviewer);
  service.registerReviewedNutrientRecord({
    id: "regional-leaf-ai-v1",
    ingredientID: "regional-leaf",
    nutritionPer100Grams: {
      calories: 31, proteinGrams: 2.4, carbohydrateGrams: 5.2, fatGrams: 0.5, fibreGrams: 3.1,
    },
    source: {
      provider: "OpenAI",
      dataset: "Nourish ingredient estimates",
      datasetVersion: "v1",
      sourceRecordID: "regional-leaf",
      licenseStatus: "approvedForProduction",
      retrievedAt: now.toISOString(),
      provenanceKind: "aiEstimated",
      generationMetadata: { model: "configured-openai-model", promptVersion: "ingredient-nutrition-v1" },
    },
    confidence: "medium",
    effectiveFrom: "2026-07-24T00:00:00.000Z",
    effectiveUntil: null,
  }, reviewer);
  return service;
}

function recipeContent(nutritionDisclosure) {
  return {
    displayName: "Regional leaf stir-fry",
    ingredients: [{
      ingredientID: "regional-leaf", householdQuantity: 1, householdUnit: "cup", grams: 80,
    }],
    methodSteps: ["Cook until tender."],
    servings: 1,
    servingSizeGrams: 80,
    nutritionPerServing: {
      calories: 24.8, proteinGrams: 1.92, carbohydrateGrams: 4.16, fatGrams: 0.4, fibreGrams: 2.48,
    },
    nutritionCalculationVersion: "weighted-grams-v1",
    nutrientRecordIDs: ["regional-leaf-ai-v1"],
    declaredAllergenIDs: [],
    dietType: "vegetarian",
    dominantIngredientIDs: ["regional-leaf"],
    tags: ["estimated nutrition"],
    nutritionDisclosure,
  };
}

test("AI nutrient evidence requires an estimated-nutrition disclosure before review", () => {
  const service = serviceWithAIRecord();
  service.createRecipeDraft({ id: "regional-leaf-stir-fry" }, recipeContent(undefined), author);
  assert.throws(
    () => service.submitLatestDraft("regional-leaf-stir-fry", author),
    (error) => error.details.includes("AI_NUTRITION_DISCLOSURE_REQUIRED"),
  );
});

test("reviewed AI nutrient evidence may enter review when explicitly disclosed", () => {
  const service = serviceWithAIRecord();
  service.createRecipeDraft({ id: "regional-leaf-stir-fry" }, recipeContent("estimated"), author);
  assert.equal(service.submitLatestDraft("regional-leaf-stir-fry", author).workflowState, "inReview");
});

test("AI nutrient evidence cannot claim high confidence", () => {
  const service = new CatalogueService({ now: () => now });
  assert.throws(() => service.registerReviewedNutrientRecord({
    id: "bad-ai-record",
    ingredientID: "regional-leaf",
    nutritionPer100Grams: { calories: 31, proteinGrams: 2.4, carbohydrateGrams: 5.2, fatGrams: 0.5, fibreGrams: 3.1 },
    source: {
      provider: "OpenAI", dataset: "Nourish ingredient estimates", datasetVersion: "v1",
      sourceRecordID: "regional-leaf", licenseStatus: "approvedForProduction",
      retrievedAt: now.toISOString(), provenanceKind: "aiEstimated",
      generationMetadata: { model: "configured-openai-model", promptVersion: "ingredient-nutrition-v1" },
    },
    confidence: "high", effectiveFrom: "2026-07-24T00:00:00.000Z", effectiveUntil: null,
  }, reviewer), /cannot be recorded with high confidence/);
});
