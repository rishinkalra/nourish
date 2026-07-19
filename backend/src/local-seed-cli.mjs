import { createHash } from "node:crypto";
import { createPostgresPool } from "./database.mjs";
import { PostgresCatalogueService } from "./postgres-catalogue-service.mjs";

assertLocalDatabase();

const pool = await createPostgresPool({
  connectionString: process.env.DATABASE_URL,
  requireTLS: false,
  applicationName: "project-nourish-local-seed",
});
const catalogue = new PostgresCatalogueService({ pool });
const author = { id: "local-synthetic-author", roles: ["author"] };
const reviewer = { id: "local-synthetic-reviewer", roles: ["reviewer"] };
const retrievedAt = "2026-01-01T00:00:00.000Z";

const meals = [
  ["chana-masala", "Chana Masala", "Chickpeas", "legumes", "North Indian", 24, 34, 520, 24],
  ["palak-paneer", "Palak Paneer", "Spinach", "produce", "North Indian", 25, 35, 510, 27],
  ["vegetable-poha", "Vegetable Poha", "Flattened rice", "grains", "West Indian", 18, 25, 465, 16],
  ["moong-dal-chilla", "Moong Dal Chilla", "Moong dal", "legumes", "North Indian", 22, 30, 480, 25],
  ["lemon-rice", "Lemon Rice", "Rice", "grains", "South Indian", 20, 30, 535, 14],
  ["rajma-bowl", "Rajma Rice Bowl", "Kidney beans", "legumes", "North Indian", 28, 38, 590, 26],
  ["vegetable-upma", "Vegetable Upma", "Semolina", "grains", "South Indian", 20, 28, 470, 17],
  ["masoor-dal", "Masoor Dal with Roti", "Red lentils", "legumes", "North Indian", 25, 35, 555, 28],
  ["tofu-bhurji", "Tofu Bhurji", "Tofu", "protein", "Indian", 18, 25, 485, 31],
  ["sambar-rice", "Sambar Rice", "Toor dal", "legumes", "South Indian", 30, 42, 570, 23],
  ["millet-khichdi", "Millet Vegetable Khichdi", "Pearl millet", "grains", "West Indian", 25, 38, 540, 20],
  ["paneer-tikka-bowl", "Paneer Tikka Bowl", "Paneer", "protein", "North Indian", 30, 40, 605, 34],
  ["besan-pudla", "Besan Pudla", "Chickpea flour", "legumes", "West Indian", 20, 28, 475, 22],
  ["coconut-veg-stew", "Coconut Vegetable Stew", "Mixed vegetables", "produce", "South Indian", 25, 35, 500, 18],
];

let published = 0;
let unchanged = 0;
try {
  for (const [index, meal] of meals.entries()) {
    const [slug, displayName, ingredientName, category, cuisine, activeMinutes, totalMinutes, calories, protein] = meal;
    const ingredientID = `local-${slug}-ingredient`;
    const nutrientID = stableUUID(`local-nutrient|${slug}`);
    const sourceID = stableUUID(`local-source|${slug}`);

    const ingredientExists = await pool.query("SELECT 1 FROM ingredients WHERE id = $1", [ingredientID]);
    if (!ingredientExists.rows[0]) {
      await catalogue.upsertIngredient({
        id: ingredientID,
        canonicalName: ingredientName,
        aliases: [],
        category,
        compatibleDiets: ["vegan", "vegetarian", "eggetarian", "nonVegetarian"],
        allergenIDs: [],
        conversions: [{ householdUnit: "portion", householdQuantity: 1, grams: 180 }],
      }, reviewer);
    }

    const nutrientExists = await pool.query("SELECT 1 FROM ingredient_nutrients WHERE id = $1", [nutrientID]);
    if (!nutrientExists.rows[0]) {
      await catalogue.registerReviewedNutrientRecord({
        id: nutrientID,
        ingredientID,
        nutritionPer100Grams: {
          calories: Math.round(calories / 3.5),
          proteinGrams: Math.round(protein / 3.5 * 10) / 10,
          carbohydrateGrams: 18 + index,
          fatGrams: 5 + index % 4,
          fibreGrams: 5 + index % 5,
        },
        source: {
          id: sourceID,
          provider: "Nourish local synthetic fixture",
          dataset: "Local end-to-end meals",
          datasetVersion: "1",
          sourceRecordID: slug,
          sourceURL: null,
          licenseStatus: "approvedForProduction",
          retrievedAt,
        },
        confidence: "high",
        effectiveFrom: retrievedAt,
        effectiveUntil: null,
      }, reviewer);
    }

    const recipeID = `local-${slug}`;
    const existing = await pool.query(
      `SELECT version.id, version.workflow_state
         FROM recipes recipe
         LEFT JOIN recipe_versions version ON version.recipe_id = recipe.id
        WHERE recipe.id = $1
        ORDER BY version.version DESC NULLS LAST LIMIT 1`,
      [recipeID],
    );
    if (existing.rows[0]?.workflow_state === "published") {
      unchanged += 1;
      continue;
    }

    const recipe = {
      id: recipeID,
      localeIdentifier: "en-IN",
      cuisine,
      eligibleSlots: ["breakfast", "lunch", "dinner"],
      activePreparationMinutes: activeMinutes,
      totalMinutes,
      equipment: ["stovetop", "pan"],
      costBand: index % 4 === 0 ? "value" : "medium",
      lifecycleStatus: "active",
    };
    const content = {
      displayName,
      ingredients: [{
        ingredientID,
        householdQuantity: 1,
        householdUnit: "portion",
        grams: 350,
      }],
      methodSteps: [
        `Prepare the ${ingredientName.toLowerCase()} and measured ingredients.`,
        "Cook on the stovetop until tender and safely heated through.",
        "Season to taste, portion, and serve warm.",
      ],
      servings: 1,
      servingSizeGrams: 350,
      minimumServingMultiplier: 0.75,
      maximumServingMultiplier: 1.25,
      nutritionPerServing: {
        calories,
        proteinGrams: protein,
        carbohydrateGrams: 55 + index,
        fatGrams: 14 + index % 5,
        fibreGrams: 8 + index % 5,
      },
      dietType: "vegetarian",
      declaredAllergenIDs: [],
      dominantIngredientIDs: [ingredientID],
      tags: [`cuisine:${cuisine}`, "local-synthetic"],
      nutrientRecordIDs: [nutrientID],
      nutritionCalculationVersion: "local-synthetic-v1",
    };

    let versionID = existing.rows[0]?.id;
    if (!versionID) {
      versionID = (await catalogue.createRecipeDraft(recipe, content, author)).id;
    } else if (existing.rows[0].workflow_state === "rejected") {
      await catalogue.editDraft(versionID, content, author);
    }
    const state = (await catalogue.version(versionID)).workflowState;
    if (["draft", "rejected"].includes(state)) await catalogue.submitLatestDraft(recipeID, author);
    if ((await catalogue.version(versionID)).workflowState === "inReview") await catalogue.approve(versionID, reviewer);
    published += 1;
  }
  process.stdout.write(`${JSON.stringify({ status: "ok", published, unchanged, recipes: meals.length })}\n`);
} finally {
  await pool.end();
}

function assertLocalDatabase() {
  if (process.env.NODE_ENV === "production" || process.env.NOURISH_ENABLE_LOCAL_SEED !== "true") {
    throw new Error("Local synthetic seeding is disabled.");
  }
  const url = new URL(process.env.DATABASE_URL ?? "invalid://missing");
  if (!["db", "localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/nourish_local") {
    throw new Error("Refusing to seed a database that is not the Nourish local database.");
  }
}

function stableUUID(value) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = "8";
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
