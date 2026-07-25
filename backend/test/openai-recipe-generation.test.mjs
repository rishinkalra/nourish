import assert from "node:assert/strict";
import test from "node:test";
import { MemoryJobQueue } from "../src/job-queue.mjs";
import {
  OpenAIRecipeGenerator,
  RecipeGenerationProviderError,
  calculateNutritionPerServing,
} from "../src/openai-recipe-generator.mjs";
import {
  MemoryRecipeGenerationService,
  PostgresRecipeGenerationService,
  createRecipeGenerationHandler,
} from "../src/recipe-generation-service.mjs";
import { MemoryPrivateObjectStore } from "../src/private-object-store.mjs";
import { CatalogueService } from "../src/catalogue-service.mjs";

const brief = {
  cuisine: "North Indian",
  dietType: "vegetarian",
  mealSlot: "dinner",
  localeIdentifier: "en-IN",
  maximumActiveMinutes: 40,
  servings: 2,
  avoidIngredients: ["peanuts"],
  equipment: ["stovetop"],
};

const proposal = {
  displayName: "Spinach paneer bowl",
  description: "A practical spinach and paneer bowl for a weeknight dinner.",
  cuisine: "North Indian",
  dietType: "vegetarian",
  servings: 2,
  servingSizeGrams: 225,
  activePreparationMinutes: 20,
  totalMinutes: 35,
  eligibleSlots: ["dinner"],
  equipment: ["stovetop"],
  costBand: "medium",
  ingredients: [
    {
      canonicalName: "spinach",
      category: "vegetable",
      householdQuantity: 2,
      householdUnit: "cups",
      grams: 200,
      compatibleDiets: ["vegan", "vegetarian", "eggetarian", "nonVegetarian"],
      proposedAllergenIDs: [],
      nutritionPer100Grams: {
        calories: 20, proteinGrams: 3, carbohydrateGrams: 4, fatGrams: 0.4, fibreGrams: 2,
      },
    },
    {
      canonicalName: "paneer",
      category: "dairy",
      householdQuantity: 1,
      householdUnit: "cup",
      grams: 250,
      compatibleDiets: ["vegetarian", "eggetarian", "nonVegetarian"],
      proposedAllergenIDs: ["milk"],
      nutritionPer100Grams: {
        calories: 260, proteinGrams: 18, carbohydrateGrams: 3, fatGrams: 20, fibreGrams: 0,
      },
    },
  ],
  methodSteps: ["Cook the spinach until tender.", "Fold in paneer and simmer until hot."],
  tags: ["weeknight", "high protein"],
  dominantIngredientNames: ["spinach", "paneer"],
  minimumServingMultiplier: 0.75,
  maximumServingMultiplier: 1.5,
};

test("OpenAI generator requests strict structured output and calculates nutrition itself", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    return requests.length === 1
      ? response({ id: "resp_recipe_1", output_text: JSON.stringify(proposal) })
      : response({ created: 123, data: [{ b64_json: Buffer.from("image-bytes").toString("base64") }] });
  };
  const generator = new OpenAIRecipeGenerator({
    apiKey: "test-openai-key-long-enough",
    fetchImpl,
    now: () => new Date("2026-07-25T10:00:00.000Z"),
  });

  const generated = await generator.generate(brief);

  assert.equal(requests[0].url, "https://api.openai.com/v1/responses");
  assert.equal(requests[0].body.model, "gpt-5.6-sol");
  assert.equal(requests[0].body.store, false);
  assert.equal(requests[0].body.text.format.type, "json_schema");
  assert.equal(requests[0].body.text.format.strict, true);
  assert.equal(requests[1].url, "https://api.openai.com/v1/images/generations");
  assert.equal(requests[1].body.model, "gpt-image-2");
  assert.equal(requests[1].body.prompt.includes("No people"), true);
  assert.deepEqual(generated.recipe.nutritionPerServing, {
    calories: 345,
    proteinGrams: 25.5,
    carbohydrateGrams: 7.75,
    fatGrams: 25.4,
    fibreGrams: 2,
  });
  assert.equal(generated.recipe.nutritionDisclosure, "estimated");
  assert.equal(generated.provenance.promptVersion, "nourish-recipe-v1");
});

test("nutrition calculation is deterministic and gram weighted", () => {
  assert.deepEqual(calculateNutritionPerServing(proposal.ingredients, 2), {
    calories: 345,
    proteinGrams: 25.5,
    carbohydrateGrams: 7.75,
    fatGrams: 25.4,
    fibreGrams: 2,
  });
});

test("provider errors remain retryable and never expose response bodies", async () => {
  const generator = new OpenAIRecipeGenerator({
    apiKey: "test-openai-key-long-enough",
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      async json() { return { error: { message: "secret provider detail" } }; },
    }),
  });
  await assert.rejects(
    generator.generate(brief),
    (error) => error instanceof RecipeGenerationProviderError
      && error.code === "PROVIDER_UNAVAILABLE"
      && error.retryable
      && !error.message.includes("secret provider detail"),
  );
});

test("generation requests are idempotently quarantined and queued", async () => {
  const queue = new MemoryJobQueue();
  const service = new MemoryRecipeGenerationService({ jobQueue: queue });
  const actor = { id: "author-1", roles: ["author"] };
  const first = await service.request(brief, { actor, idempotencyKey: "north-indian-001" });
  const replay = await service.request(brief, { actor, idempotencyKey: "north-indian-001" });
  assert.equal(replay.id, first.id);
  assert.equal((await queue.claim({ workerID: "worker", types: ["recipe.generate"] })).payload.generationID, first.id);
});

test("generation handler stores the image privately and leaves content awaiting review", async () => {
  const generationID = "715cf4f1-8c81-5ab6-bb75-e5c89efeb582";
  const calls = [];
  const row = {
    id: generationID,
    status: "queued",
    brief_json: brief,
  };
  const pool = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.startsWith("SELECT * FROM recipe_generation_runs")) return { rows: [row] };
      return { rows: [] };
    },
  };
  const objectStore = new MemoryPrivateObjectStore();
  const generator = {
    async generate() {
      return {
        recipe: proposal,
        image: {
          base64: Buffer.from("image-bytes").toString("base64"),
          mimeType: "image/png",
          width: 1536,
          height: 1024,
        },
        provenance: {
          textModel: "gpt-5.6-sol",
          imageModel: "gpt-image-2",
          promptVersion: "nourish-recipe-v1",
        },
      };
    },
  };
  const handler = createRecipeGenerationHandler({ pool, generator, objectStore });
  const result = await handler({ payload: { generationID } }, { extendLease: async () => {} });
  const key = `recipe-generations/${generationID}/hero-image.png.b64`;
  assert.deepEqual(result, { generationID, status: "awaitingReview" });
  assert.equal(objectStore.objects.get(key), Buffer.from("image-bytes").toString("base64"));
  assert.equal(calls.some((call) => call.text.includes("status = 'awaiting_review'")), true);
});

test("private image preview returns decoded bytes without exposing the storage key", async () => {
  const generationID = "715cf4f1-8c81-5ab6-bb75-e5c89efeb582";
  const key = `recipe-generations/${generationID}/hero-image.png.b64`;
  const objectStore = new MemoryPrivateObjectStore();
  await objectStore.putText({ key, value: Buffer.from("image-bytes").toString("base64") });
  const pool = {
    async connect() {},
    async query() {
      return {
        rows: [{
          id: generationID,
          requested_by: "author-1",
          status: "awaiting_review",
          brief_json: brief,
          output_json: { recipe: proposal, image: { objectKey: key, mimeType: "image/png" } },
          image_object_key: key,
          attempt_count: 1,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      };
    },
  };
  const service = new PostgresRecipeGenerationService({ pool, objectStore });
  const detail = await service.detail(generationID);
  const image = await service.image(generationID);
  assert.equal(detail.imageAvailable, true);
  assert.equal("imageObjectKey" in detail, false);
  assert.equal("objectKey" in detail.output.image, false);
  assert.equal(image.mimeType, "image/png");
  assert.equal(image.content.toString(), "image-bytes");
});

test("reviewed generation imports only as an editable estimated-nutrition catalogue draft", async () => {
  const queue = new MemoryJobQueue();
  const catalogueService = new CatalogueService();
  const service = new MemoryRecipeGenerationService({ jobQueue: queue, catalogueService });
  const id = "715cf4f1-8c81-5ab6-bb75-e5c89efeb582";
  service.runs.set(id, {
    id,
    status: "awaitingReview",
    requestedBy: "author-1",
    brief,
    output: {
      recipe: {
        ...proposal,
        nutritionPerServing: calculateNutritionPerServing(proposal.ingredients, proposal.servings),
        nutritionCalculationVersion: "ai-weighted-grams-v1",
      },
      image: { objectKey: `recipe-generations/${id}/hero-image.png.b64`, mimeType: "image/png" },
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const result = await service.importDraft(id, {
    recipeID: "spinach-paneer-bowl",
    ingredientMappings: proposal.ingredients.map((ingredient, index) => ({
      generatedIngredientName: ingredient.canonicalName,
      ingredientID: index === 0 ? "spinach" : "paneer",
      nutrientRecordID: index === 0 ? "nutrient-spinach-ai-v1" : "nutrient-paneer-ai-v1",
      householdQuantity: ingredient.householdQuantity,
      householdUnit: ingredient.householdUnit,
      grams: ingredient.grams,
    })),
    declaredAllergenIDs: ["milk"],
    confirmEstimatedNutrition: true,
    confirmImageMatches: true,
    confirmMethodSafe: true,
    confirmDietCompatible: true,
    confirmAllergensReviewed: true,
  }, { actor: { id: "author-1", roles: ["author"] } });
  assert.equal(result.generation.status, "imported");
  assert.equal(result.recipeVersion.workflowState, "draft");
  assert.equal(result.recipeVersion.content.nutritionDisclosure, "estimated");
  assert.equal(result.recipeVersion.content.sourceGenerationID, id);
  assert.equal(catalogueService.publishedSnapshots().length, 0);
});

test("generation decisions are owner-bound, confirmation-gated, and reasoned", async () => {
  const service = new MemoryRecipeGenerationService({
    jobQueue: new MemoryJobQueue(),
    catalogueService: new CatalogueService(),
  });
  const id = "715cf4f1-8c81-5ab6-bb75-e5c89efeb582";
  service.runs.set(id, {
    id, status: "awaitingReview", requestedBy: "author-1", brief,
    output: { recipe: { ...proposal, nutritionPerServing: calculateNutritionPerServing(proposal.ingredients, 2) } },
    createdAt: new Date(), updatedAt: new Date(),
  });
  await assert.rejects(
    service.discard(id, "This recipe duplicates existing catalogue coverage.", {
      actor: { id: "author-2", roles: ["author"] },
    }),
    (error) => error.code === "AUTHENTICATION_REQUIRED",
  );
  await assert.rejects(
    service.discard(id, "too short", { actor: { id: "author-1", roles: ["author"] } }),
    (error) => error.code === "VALIDATION_ERROR",
  );
  const discarded = await service.discard(
    id,
    "This recipe duplicates existing catalogue coverage.",
    { actor: { id: "author-1", roles: ["author"] } },
  );
  assert.equal(discarded.status, "discarded");
  assert.equal(discarded.decisionActor, "author-1");
});

function response(value) {
  return { ok: true, status: 200, async json() { return value; } };
}
