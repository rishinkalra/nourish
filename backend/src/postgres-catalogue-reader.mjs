export class PostgresCatalogueReader {
  constructor({ pool }) {
    if (!pool?.query) throw new Error("A PostgreSQL pool is required.");
    this.pool = pool;
  }

  async publishedSnapshots() {
    const [versions, ingredients, steps, sources] = await Promise.all([
      this.pool.query(
        `SELECT version.id AS recipe_version_id, version.recipe_id, version.version,
                version.display_name, version.serving_size_grams,
                version.calories_per_serving, version.protein_g_per_serving,
                version.carbohydrate_g_per_serving, version.fat_g_per_serving,
                version.fibre_g_per_serving, version.diet_type,
                version.declared_allergen_ids, version.dominant_ingredient_ids,
                version.tags, version.nutrition_calculation_version,
                version.recipe_metadata_json, version.content_json,
                recipe.eligible_slots, recipe.active_preparation_minutes,
                recipe.total_minutes, recipe.equipment, recipe.cost_band,
                recipe.locale_identifier
           FROM recipe_versions version
           JOIN recipes recipe ON recipe.id = version.recipe_id
          WHERE version.workflow_state = 'published'
            AND recipe.lifecycle_status = 'active'
            AND recipe.current_published_version_id = version.id
          ORDER BY version.recipe_id`,
      ),
      this.pool.query(
        `SELECT item.recipe_version_id, item.position, item.ingredient_id,
                item.canonical_name_snapshot AS canonical_name,
                item.category_snapshot AS category,
                item.allergen_ids_snapshot AS allergen_ids, item.household_quantity,
                item.household_unit, item.grams
           FROM recipe_version_ingredients item
           JOIN recipe_versions version ON version.id = item.recipe_version_id
           JOIN recipes recipe ON recipe.current_published_version_id = version.id
          WHERE version.workflow_state = 'published'
          ORDER BY item.recipe_version_id, item.position`,
      ),
      this.pool.query(
        `SELECT step.recipe_version_id, step.position, step.instruction
           FROM recipe_version_steps step
           JOIN recipe_versions version ON version.id = step.recipe_version_id
           JOIN recipes recipe ON recipe.current_published_version_id = version.id
          WHERE version.workflow_state = 'published'
          ORDER BY step.recipe_version_id, step.position`,
      ),
      this.pool.query(
        `SELECT DISTINCT evidence.recipe_version_id, source.provider,
                source.dataset, source.dataset_version
           FROM recipe_version_nutrient_evidence evidence
           JOIN ingredient_nutrients nutrient ON nutrient.id = evidence.ingredient_nutrient_id
           JOIN nutrient_sources source ON source.id = nutrient.source_id
           JOIN recipe_versions version ON version.id = evidence.recipe_version_id
           JOIN recipes recipe ON recipe.current_published_version_id = version.id
          WHERE version.workflow_state = 'published'
          ORDER BY evidence.recipe_version_id, source.provider, source.dataset, source.dataset_version`,
      ),
    ]);

    const ingredientGroups = groupBy(ingredients.rows, "recipe_version_id");
    const stepGroups = groupBy(steps.rows, "recipe_version_id");
    const sourceGroups = groupBy(sources.rows, "recipe_version_id");
    return versions.rows.map((row) => {
      const metadata = storedMetadata(row.recipe_metadata_json);
      const content = storedMetadata(row.content_json);
      return {
        recipeID: row.recipe_id,
        localeIdentifier: row.locale_identifier,
        recipeVersionID: row.recipe_version_id,
        version: Number(row.version),
        displayName: row.display_name,
        ingredients: (ingredientGroups.get(row.recipe_version_id) ?? []).map((item) => ({
          ingredientID: item.ingredient_id,
          displayName: item.canonical_name,
          category: item.category,
          householdQuantity: Number(item.household_quantity),
          householdUnit: item.household_unit,
          grams: Number(item.grams),
          allergenIDs: item.allergen_ids ?? [],
        })),
        methodSteps: (stepGroups.get(row.recipe_version_id) ?? []).map((step) => step.instruction),
        servingSizeGrams: Number(row.serving_size_grams),
        nutritionPerServing: {
          calories: Number(row.calories_per_serving),
          proteinGrams: Number(row.protein_g_per_serving),
          carbohydrateGrams: Number(row.carbohydrate_g_per_serving),
          fatGrams: Number(row.fat_g_per_serving),
          fibreGrams: Number(row.fibre_g_per_serving),
        },
        activePreparationMinutes: Number(metadata.activePreparationMinutes ?? row.active_preparation_minutes),
        totalMinutes: Number(metadata.totalMinutes ?? row.total_minutes),
        equipment: metadata.equipment ?? row.equipment ?? [],
        costBand: metadata.costBand ?? row.cost_band,
        minimumServingMultiplier: validServingMultiplier(content.minimumServingMultiplier, 1),
        maximumServingMultiplier: validServingMultiplier(content.maximumServingMultiplier, 1),
        tags: row.tags ?? [],
        allergenIDs: row.declared_allergen_ids ?? [],
        dietType: row.diet_type,
        eligibleSlots: metadata.eligibleSlots ?? row.eligible_slots ?? [],
        dominantIngredientIDs: row.dominant_ingredient_ids ?? [],
        nutritionSourceSummary: (sourceGroups.get(row.recipe_version_id) ?? [])
          .map((source) => `${source.provider} ${source.dataset} ${source.dataset_version}`).join("; "),
        nutritionCalculationVersion: row.nutrition_calculation_version,
        reviewStatus: "approved",
        publicationStatus: "published",
      };
    });
  }
}

function storedMetadata(value) {
  if (!value) return {};
  return typeof value === "string" ? JSON.parse(value) : value;
}

function validServingMultiplier(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) groups.set(row[key], [...(groups.get(row[key]) ?? []), row]);
  return groups;
}
