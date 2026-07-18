import { randomUUID } from "node:crypto";
import { CatalogueError, validateForPublication } from "./catalogue-service.mjs";
import { withTransaction } from "./database.mjs";
import { PostgresCatalogueReader } from "./postgres-catalogue-reader.mjs";

const editableStates = new Set(["draft", "rejected"]);

export class PostgresCatalogueService {
  constructor({ pool, now = () => new Date() } = {}) {
    if (!pool?.query || !pool?.connect) throw new Error("A PostgreSQL pool is required.");
    this.pool = pool;
    this.now = now;
    this.reader = new PostgresCatalogueReader({ pool });
  }

  async upsertIngredient(ingredient, actor) {
    requireRole(actor, "reviewer");
    validateIngredient(ingredient);
    const occurredAt = this.now();
    return withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO ingredients (
            id, canonical_name, aliases, category, compatible_diets, allergen_ids,
            source_status, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 'verified', $7, $7)
         ON CONFLICT (id) DO UPDATE SET
            canonical_name = EXCLUDED.canonical_name, aliases = EXCLUDED.aliases,
            category = EXCLUDED.category, compatible_diets = EXCLUDED.compatible_diets,
            allergen_ids = EXCLUDED.allergen_ids, source_status = 'verified', updated_at = EXCLUDED.updated_at`,
        [
          ingredient.id, ingredient.canonicalName.trim(), ingredient.aliases ?? [], ingredient.category.trim(),
          ingredient.compatibleDiets, ingredient.allergenIDs ?? [], occurredAt,
        ],
      );
      await client.query("DELETE FROM ingredient_unit_conversions WHERE ingredient_id = $1", [ingredient.id]);
      for (const conversion of ingredient.conversions) {
        await client.query(
          `INSERT INTO ingredient_unit_conversions (
              ingredient_id, household_unit, household_quantity, grams
           ) VALUES ($1, $2, $3, $4)`,
          [ingredient.id, conversion.householdUnit.trim(), conversion.householdQuantity, conversion.grams],
        );
      }
      await insertContentAudit(client, actor.id, "ingredient.verified", "ingredient", ingredient.id, ingredient, occurredAt);
      return { ...structuredClone(ingredient), sourceStatus: "verified", reviewedBy: actor.id, reviewedAt: occurredAt };
    });
  }

  async registerReviewedNutrientRecord(record, actor) {
    requireRole(actor, "reviewer");
    validateNutrientRecord(record);
    const reviewedAt = this.now();
    return withTransaction(this.pool, async (client) => {
      const source = record.source;
      const ingredient = await client.query("SELECT id FROM ingredients WHERE id = $1", [record.ingredientID]);
      if (!ingredient.rows[0]) throw new CatalogueError("VALIDATION_ERROR", "The nutrient record ingredient is not verified.", 422);
      const existingSource = await client.query(
        `SELECT * FROM nutrient_sources
          WHERE id = $1 OR (
            provider = $2 AND dataset = $3 AND dataset_version = $4 AND source_record_id = $5
          ) LIMIT 1`,
        [source.id, source.provider.trim(), source.dataset.trim(), source.datasetVersion.trim(), source.sourceRecordID.trim()],
      );
      if (existingSource.rows[0] && (String(existingSource.rows[0].id) !== source.id || !sameSource(existingSource.rows[0], source))) {
        throw new CatalogueError("CONFLICT", "A nutrient source identity cannot be reused for different provenance.", 409);
      }
      if (!existingSource.rows[0]) await client.query(
        `INSERT INTO nutrient_sources (
            id, provider, dataset, dataset_version, source_record_id, source_url,
            license_status, retrieved_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          source.id, source.provider.trim(), source.dataset.trim(), source.datasetVersion.trim(),
          source.sourceRecordID.trim(), source.sourceURL ?? null, snakeLicense(source.licenseStatus),
          new Date(source.retrievedAt),
        ],
      );
      const nutrition = record.nutritionPer100Grams;
      const inserted = await client.query(
        `INSERT INTO ingredient_nutrients (
            id, ingredient_id, source_id, calories_per_100g, protein_g_per_100g,
            carbohydrate_g_per_100g, fat_g_per_100g, fibre_g_per_100g, confidence,
            effective_from, effective_until, reviewed_by, reviewed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          record.id, record.ingredientID, source.id, nutrition.calories, nutrition.proteinGrams,
          nutrition.carbohydrateGrams, nutrition.fatGrams, nutrition.fibreGrams, record.confidence,
          new Date(record.effectiveFrom), record.effectiveUntil ? new Date(record.effectiveUntil) : null,
          actor.id, reviewedAt,
        ],
      );
      if (!inserted.rows[0]) throw new CatalogueError("CONFLICT", "This nutrient record ID already exists and is immutable.", 409);
      const reviewed = { ...structuredClone(record), reviewedBy: actor.id, reviewedAt };
      await insertContentAudit(client, actor.id, "nutrient_record.reviewed", "nutrient_record", record.id, reviewed, reviewedAt);
      return reviewed;
    });
  }

  async contentInventory() {
    const [ingredientResult, conversionResult, nutrientResult] = await Promise.all([
      this.pool.query(
        `SELECT id, canonical_name, aliases, category, compatible_diets, allergen_ids,
                source_status, updated_at
           FROM ingredients
          ORDER BY canonical_name, id`,
      ),
      this.pool.query(
        `SELECT ingredient_id, household_unit, household_quantity, grams
           FROM ingredient_unit_conversions
          ORDER BY ingredient_id, household_unit, household_quantity`,
      ),
      this.pool.query(
        `SELECT nutrient.id, nutrient.ingredient_id, nutrient.calories_per_100g,
                nutrient.protein_g_per_100g, nutrient.carbohydrate_g_per_100g,
                nutrient.fat_g_per_100g, nutrient.fibre_g_per_100g, nutrient.confidence,
                nutrient.effective_from, nutrient.effective_until, nutrient.reviewed_by,
                nutrient.reviewed_at, source.id AS source_id, source.provider, source.dataset,
                source.dataset_version, source.source_record_id, source.source_url,
                source.license_status, source.retrieved_at
           FROM ingredient_nutrients nutrient
           JOIN nutrient_sources source ON source.id = nutrient.source_id
          ORDER BY nutrient.reviewed_at DESC, nutrient.id`,
      ),
    ]);
    const conversionsByIngredient = new Map();
    for (const row of conversionResult.rows) {
      const conversions = conversionsByIngredient.get(row.ingredient_id) ?? [];
      conversions.push({
        householdUnit: row.household_unit,
        householdQuantity: Number(row.household_quantity),
        grams: Number(row.grams),
      });
      conversionsByIngredient.set(row.ingredient_id, conversions);
    }
    return {
      ingredients: ingredientResult.rows.map((row) => ({
        id: row.id, canonicalName: row.canonical_name, aliases: row.aliases ?? [], category: row.category,
        compatibleDiets: row.compatible_diets ?? [], allergenIDs: row.allergen_ids ?? [],
        sourceStatus: row.source_status, updatedAt: row.updated_at,
        conversions: conversionsByIngredient.get(row.id) ?? [],
      })),
      nutrientRecords: nutrientResult.rows.map((row) => ({
        id: String(row.id), ingredientID: row.ingredient_id,
        nutritionPer100Grams: {
          calories: Number(row.calories_per_100g), proteinGrams: Number(row.protein_g_per_100g),
          carbohydrateGrams: Number(row.carbohydrate_g_per_100g), fatGrams: Number(row.fat_g_per_100g),
          fibreGrams: Number(row.fibre_g_per_100g),
        },
        source: {
          id: String(row.source_id), provider: row.provider, dataset: row.dataset,
          datasetVersion: row.dataset_version, sourceRecordID: row.source_record_id,
          sourceURL: row.source_url, licenseStatus: camelLicense(row.license_status), retrievedAt: row.retrieved_at,
        },
        confidence: row.confidence, effectiveFrom: row.effective_from, effectiveUntil: row.effective_until,
        reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null, reviewedAt: row.reviewed_at,
      })),
    };
  }

  async createRecipeDraft(recipe, content, actor) {
    requireRole(actor, "author");
    validateRecipeMetadata(recipe);
    const createdAt = this.now();
    return withTransaction(this.pool, async (client) => {
      await lockRecipe(client, recipe.id);
      const open = await client.query(
        `SELECT id FROM recipe_versions
          WHERE recipe_id = $1 AND workflow_state IN ('draft', 'in_review', 'rejected')
          LIMIT 1`,
        [recipe.id],
      );
      if (open.rows[0]) throw new CatalogueError("CONFLICT", "Finish the existing editable version before creating another.", 409);
      await client.query(
        `INSERT INTO recipes (
            id, locale_identifier, cuisine, eligible_slots, active_preparation_minutes,
            total_minutes, equipment, cost_band, lifecycle_status, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          recipe.id, recipe.localeIdentifier, recipe.cuisine, recipe.eligibleSlots,
          recipe.activePreparationMinutes, recipe.totalMinutes, recipe.equipment ?? [],
          recipe.costBand, recipe.lifecycleStatus ?? "active", createdAt,
        ],
      );
      const latest = await client.query("SELECT COALESCE(MAX(version), 0) AS version FROM recipe_versions WHERE recipe_id = $1", [recipe.id]);
      const versionNumber = Number(latest.rows[0]?.version ?? 0) + 1;
      const versionID = randomUUID();
      const values = normalizedContent(content);
      const inserted = await client.query(
        `INSERT INTO recipe_versions (
            id, recipe_id, version, display_name, servings, serving_size_grams,
            calories_per_serving, protein_g_per_serving, carbohydrate_g_per_serving,
            fat_g_per_serving, fibre_g_per_serving, diet_type,
            declared_allergen_ids, dominant_ingredient_ids, tags,
            nutrition_calculation_version, workflow_state, authored_by, created_at,
            recipe_metadata_json, content_json
         ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
            $13, $14, $15, $16, 'draft', $17, $18, $19::jsonb, $20::jsonb
         ) RETURNING *`,
        [
          versionID, recipe.id, versionNumber, values.displayName, values.servings, values.servingSizeGrams,
          values.calories, values.protein, values.carbohydrates, values.fat, values.fibre, values.dietType,
          values.allergens, values.dominantIngredients, values.tags, values.calculationVersion,
          actor.id, createdAt, JSON.stringify(recipe), JSON.stringify(content ?? {}),
        ],
      );
      await insertAudit(client, actor.id, "recipe_version.created", versionID, null, createdAt);
      return mapVersion(inserted.rows[0]);
    });
  }

  async editDraft(versionID, content, actor) {
    requireRole(actor, "author");
    const occurredAt = this.now();
    return withTransaction(this.pool, async (client) => {
      const row = await lockedVersion(client, versionID);
      if (!editableStates.has(camelState(row.workflow_state))) {
        throw new CatalogueError("CONFLICT", row.workflow_state === "published" || row.workflow_state === "archived"
          ? "Published recipe versions are immutable." : "This version cannot be edited during review.", 409);
      }
      await clearVersionChildren(client, versionID);
      const updated = await client.query(
        `UPDATE recipe_versions
            SET content_json = $2::jsonb, workflow_state = 'draft', submitted_at = NULL,
                reviewed_by = NULL, reviewed_at = NULL, published_at = NULL, rejection_reason = NULL
          WHERE id = $1
        RETURNING *`,
        [versionID, JSON.stringify(content ?? {})],
      );
      await insertAudit(client, actor.id, "recipe_version.edited", versionID, null, occurredAt);
      return mapVersion(updated.rows[0]);
    });
  }

  async submitLatestDraft(recipeID, actor) {
    requireRole(actor, "author");
    const submittedAt = this.now();
    return withTransaction(this.pool, async (client) => {
      await lockRecipe(client, recipeID);
      const result = await client.query(
        `SELECT * FROM recipe_versions
          WHERE recipe_id = $1 AND workflow_state = 'draft'
          ORDER BY version DESC LIMIT 1
          FOR UPDATE`,
        [recipeID],
      );
      const row = result.rows[0];
      if (!row) throw new CatalogueError("VALIDATION_ERROR", "No editable draft exists for this recipe.", 404);
      const content = storedJSON(row.content_json);
      const issues = await publicationIssues(client, content, this.now());
      if (issues.length) throw new CatalogueError("VALIDATION_ERROR", "Recipe content is not ready for review.", 422, issues);
      await replaceVersionChildren(client, row.id, content);
      const values = normalizedContent(content);
      const updated = await client.query(
        `UPDATE recipe_versions SET
            display_name = $2, servings = $3, serving_size_grams = $4,
            calories_per_serving = $5, protein_g_per_serving = $6,
            carbohydrate_g_per_serving = $7, fat_g_per_serving = $8,
            fibre_g_per_serving = $9, diet_type = $10, declared_allergen_ids = $11,
            dominant_ingredient_ids = $12, tags = $13, nutrition_calculation_version = $14,
            workflow_state = 'in_review', submitted_at = $15
          WHERE id = $1
        RETURNING *`,
        [
          row.id, values.displayName, values.servings, values.servingSizeGrams, values.calories,
          values.protein, values.carbohydrates, values.fat, values.fibre, values.dietType,
          values.allergens, values.dominantIngredients, values.tags, values.calculationVersion, submittedAt,
        ],
      );
      await insertAudit(client, actor.id, "recipe_version.submitted", row.id, null, submittedAt);
      return mapVersion(updated.rows[0]);
    });
  }

  async approve(versionID, actor) {
    requireRole(actor, "reviewer");
    const reviewedAt = this.now();
    return withTransaction(this.pool, async (client) => {
      const row = await lockedVersion(client, versionID);
      if (row.workflow_state !== "in_review") throw new CatalogueError("CONFLICT", "Only a version in review can be published.", 409);
      if (row.authored_by === actor.id) throw new CatalogueError("VALIDATION_ERROR", "A recipe author cannot approve their own version.", 403);
      const content = storedJSON(row.content_json);
      const issues = await publicationIssues(client, content, this.now());
      if (issues.length) throw new CatalogueError("VALIDATION_ERROR", "Recipe content failed publication validation.", 422, issues);
      await replaceVersionChildren(client, row.id, content);
      const published = await client.query(
        `UPDATE recipe_versions
            SET workflow_state = 'published', reviewed_by = $2, reviewed_at = $3,
                published_at = $3, rejection_reason = NULL
          WHERE id = $1
        RETURNING *`,
        [versionID, actor.id, reviewedAt],
      );
      await client.query(
        `UPDATE recipes SET current_published_version_id = $2, updated_at = $3 WHERE id = $1`,
        [row.recipe_id, versionID, reviewedAt],
      );
      await insertAudit(client, actor.id, "recipe_version.published", versionID, null, reviewedAt);
      return mapVersion(published.rows[0]);
    });
  }

  async reject(versionID, reason, actor) {
    requireRole(actor, "reviewer");
    if (!reason?.trim()) throw new CatalogueError("VALIDATION_ERROR", "A rejection reason is required.");
    const reviewedAt = this.now();
    return withTransaction(this.pool, async (client) => {
      const row = await lockedVersion(client, versionID);
      if (row.workflow_state !== "in_review") throw new CatalogueError("CONFLICT", "Only a version in review can be rejected.", 409);
      const rejected = await client.query(
        `UPDATE recipe_versions
            SET workflow_state = 'rejected', reviewed_by = $2, reviewed_at = $3,
                published_at = NULL, rejection_reason = $4
          WHERE id = $1
        RETURNING *`,
        [versionID, actor.id, reviewedAt, reason.trim()],
      );
      await insertAudit(client, actor.id, "recipe_version.rejected", versionID, reason.trim(), reviewedAt);
      return mapVersion(rejected.rows[0]);
    });
  }

  async version(versionID) {
    const result = await this.pool.query("SELECT * FROM recipe_versions WHERE id = $1", [versionID]);
    if (!result.rows[0]) throw new CatalogueError("VALIDATION_ERROR", "Recipe version not found.", 404);
    return mapVersion(result.rows[0]);
  }

  async auditLog() {
    const result = await this.pool.query(
      `SELECT actor_id, action, recipe_version_id, reason, occurred_at
         FROM catalogue_audit_logs ORDER BY occurred_at, id`,
    );
    return result.rows.map((row) => ({
      actorID: row.actor_id, action: row.action, recipeVersionID: row.recipe_version_id,
      reason: row.reason, occurredAt: new Date(row.occurred_at),
    }));
  }

  async reviewQueue() {
    const result = await this.pool.query(
      `SELECT * FROM recipe_versions
        WHERE workflow_state IN ('draft', 'in_review', 'rejected')
        ORDER BY created_at DESC, recipe_id, version DESC`,
    );
    return Promise.all(result.rows.map(async (row) => {
      const content = storedJSON(row.content_json);
      const [issues, evidence] = await Promise.all([
        publicationIssues(this.pool, content, this.now()),
        nutrientEvidence(this.pool, content.nutrientRecordIDs ?? []),
      ]);
      return {
        ...mapVersion(row),
        recipeMetadata: storedJSON(row.recipe_metadata_json),
        validationIssues: issues,
        nutrientEvidence: evidence,
      };
    }));
  }

  async catalogueAuditLog() {
    const [recipeEvents, contentEvents] = await Promise.all([
      this.pool.query(
        `SELECT actor_id, action, recipe_version_id, reason, occurred_at
           FROM catalogue_audit_logs ORDER BY occurred_at DESC, id DESC`,
      ),
      this.pool.query(
        `SELECT actor_id, action, entity_type, entity_id, content_json, occurred_at
           FROM catalogue_content_audit_logs ORDER BY occurred_at DESC, id DESC`,
      ),
    ]);
    return [
      ...recipeEvents.rows.map((row) => ({
        actorID: row.actor_id, action: row.action, entityType: "recipe_version",
        entityID: row.recipe_version_id, reason: row.reason, occurredAt: new Date(row.occurred_at),
      })),
      ...contentEvents.rows.map((row) => ({
        actorID: row.actor_id, action: row.action, entityType: row.entity_type,
        entityID: row.entity_id, content: storedJSON(row.content_json), occurredAt: new Date(row.occurred_at),
      })),
    ].sort((left, right) => right.occurredAt - left.occurredAt);
  }

  publishedSnapshots() {
    return this.reader.publishedSnapshots();
  }
}

async function lockedVersion(client, versionID) {
  const result = await client.query("SELECT * FROM recipe_versions WHERE id = $1 FOR UPDATE", [versionID]);
  if (!result.rows[0]) throw new CatalogueError("VALIDATION_ERROR", "Recipe version not found.", 404);
  return result.rows[0];
}

async function lockRecipe(client, recipeID) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [recipeID]);
}

async function publicationIssues(client, content, now) {
  const ingredientIDs = [...new Set((content?.ingredients ?? []).map((item) => item.ingredientID).filter(Boolean))];
  const nutrientIDs = [...new Set((content?.nutrientRecordIDs ?? []).filter(isUUID))];
  const [ingredients, nutrients] = await Promise.all([
    ingredientIDs.length
      ? client.query(
        `SELECT id, canonical_name, compatible_diets, allergen_ids, source_status
           FROM ingredients WHERE id = ANY($1::text[])`,
        [ingredientIDs],
      )
      : { rows: [] },
    nutrientIDs.length
      ? client.query(
        `SELECT nutrient.id, nutrient.ingredient_id, nutrient.effective_from, nutrient.effective_until,
                nutrient.reviewed_by, nutrient.reviewed_at, source.provider, source.dataset,
                source.dataset_version, source.license_status
           FROM ingredient_nutrients nutrient
           JOIN nutrient_sources source ON source.id = nutrient.source_id
          WHERE nutrient.id = ANY($1::uuid[])`,
        [nutrientIDs],
      )
      : { rows: [] },
  ]);
  const store = { ingredients: new Map(), nutrientRecords: new Map() };
  for (const row of ingredients.rows) {
    store.ingredients.set(row.id, {
      id: row.id, canonicalName: row.canonical_name, compatibleDiets: row.compatible_diets ?? [],
      allergenIDs: row.allergen_ids ?? [], sourceStatus: row.source_status,
    });
  }
  for (const row of nutrients.rows) {
    store.nutrientRecords.set(String(row.id), {
      id: String(row.id), ingredientID: row.ingredient_id, effectiveFrom: row.effective_from,
      effectiveUntil: row.effective_until, reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at,
      source: {
        provider: row.provider, dataset: row.dataset, datasetVersion: row.dataset_version,
        licenseStatus: camelLicense(row.license_status),
      },
    });
  }
  return validateForPublication(content, store, now);
}

async function nutrientEvidence(client, recordIDs) {
  const ids = [...new Set(recordIDs.filter(isUUID))];
  if (!ids.length) return recordIDs.map((id) => ({ id, missing: true }));
  const result = await client.query(
    `SELECT nutrient.id, nutrient.ingredient_id, nutrient.confidence,
            nutrient.effective_from, nutrient.effective_until, nutrient.reviewed_by,
            nutrient.reviewed_at, source.id AS source_id, source.provider, source.dataset,
            source.dataset_version, source.source_record_id, source.source_url,
            source.license_status, source.retrieved_at
       FROM ingredient_nutrients nutrient
       JOIN nutrient_sources source ON source.id = nutrient.source_id
      WHERE nutrient.id = ANY($1::uuid[])`,
    [ids],
  );
  const byID = new Map(result.rows.map((row) => [String(row.id), row]));
  return recordIDs.map((id) => {
    const row = byID.get(String(id));
    if (!row) return { id, missing: true };
    return {
      id: String(row.id), ingredientID: row.ingredient_id, confidence: row.confidence,
      effectiveFrom: row.effective_from, effectiveUntil: row.effective_until,
      reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at,
      source: {
        id: String(row.source_id), provider: row.provider, dataset: row.dataset,
        datasetVersion: row.dataset_version, sourceRecordID: row.source_record_id,
        sourceURL: row.source_url, licenseStatus: camelLicense(row.license_status), retrievedAt: row.retrieved_at,
      },
    };
  });
}

async function clearVersionChildren(client, versionID) {
  await client.query("DELETE FROM recipe_version_nutrient_evidence WHERE recipe_version_id = $1", [versionID]);
  await client.query("DELETE FROM recipe_version_steps WHERE recipe_version_id = $1", [versionID]);
  await client.query("DELETE FROM recipe_version_ingredients WHERE recipe_version_id = $1", [versionID]);
}

async function replaceVersionChildren(client, versionID, content) {
  await clearVersionChildren(client, versionID);
  for (const [position, item] of (content.ingredients ?? []).entries()) {
    await client.query(
      `INSERT INTO recipe_version_ingredients (
          recipe_version_id, position, ingredient_id, household_quantity, household_unit, grams,
          canonical_name_snapshot, category_snapshot, allergen_ids_snapshot
       ) SELECT $1, $2, ingredient.id, $4, $5, $6,
                ingredient.canonical_name, ingredient.category, ingredient.allergen_ids
           FROM ingredients ingredient WHERE ingredient.id = $3`,
      [versionID, position, item.ingredientID, item.householdQuantity, item.householdUnit, item.grams],
    );
  }
  for (const [position, instruction] of (content.methodSteps ?? []).entries()) {
    await client.query(
      `INSERT INTO recipe_version_steps (recipe_version_id, position, instruction) VALUES ($1, $2, $3)`,
      [versionID, position, instruction],
    );
  }
  for (const nutrientID of content.nutrientRecordIDs ?? []) {
    await client.query(
      `INSERT INTO recipe_version_nutrient_evidence (recipe_version_id, ingredient_nutrient_id) VALUES ($1, $2)`,
      [versionID, nutrientID],
    );
  }
}

async function insertAudit(client, actorID, action, versionID, reason, occurredAt) {
  await client.query(
    `INSERT INTO catalogue_audit_logs (id, actor_id, action, recipe_version_id, reason, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), actorID, action, versionID, reason, occurredAt],
  );
}

async function insertContentAudit(client, actorID, action, entityType, entityID, content, occurredAt) {
  await client.query(
    `INSERT INTO catalogue_content_audit_logs (
        id, actor_id, action, entity_type, entity_id, content_json, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [randomUUID(), actorID, action, entityType, entityID, JSON.stringify(content), occurredAt],
  );
}

function normalizedContent(content = {}) {
  const nutrition = content.nutritionPerServing ?? {};
  return {
    displayName: content.displayName?.trim() || "Untitled draft",
    servings: positiveOrPlaceholder(content.servings),
    servingSizeGrams: positiveOrPlaceholder(content.servingSizeGrams),
    calories: positiveOrPlaceholder(nutrition.calories),
    protein: nonnegativeOrPlaceholder(nutrition.proteinGrams),
    carbohydrates: nonnegativeOrPlaceholder(nutrition.carbohydrateGrams),
    fat: nonnegativeOrPlaceholder(nutrition.fatGrams),
    fibre: nonnegativeOrPlaceholder(nutrition.fibreGrams),
    dietType: content.dietType || "unknown",
    allergens: content.declaredAllergenIDs ?? [],
    dominantIngredients: content.dominantIngredientIDs?.length ? content.dominantIngredientIDs : ["unassigned"],
    tags: content.tags ?? [],
    calculationVersion: content.nutritionCalculationVersion?.trim() || "draft-unverified",
  };
}

function mapVersion(row) {
  return {
    id: row.id,
    recipeID: row.recipe_id,
    version: Number(row.version),
    content: storedJSON(row.content_json),
    workflowState: camelState(row.workflow_state),
    authoredBy: row.authored_by,
    createdAt: new Date(row.created_at),
    submittedAt: row.submitted_at ? new Date(row.submitted_at) : null,
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
    rejectionReason: row.rejection_reason ?? null,
  };
}

function validateRecipeMetadata(recipe) {
  if (!recipe?.id || !recipe.localeIdentifier || !recipe.cuisine || !Array.isArray(recipe.eligibleSlots)
    || !recipe.eligibleSlots.length || !Number.isInteger(recipe.activePreparationMinutes)
    || !Number.isInteger(recipe.totalMinutes) || recipe.activePreparationMinutes < 0
    || recipe.totalMinutes < recipe.activePreparationMinutes || !recipe.costBand) {
    throw new CatalogueError("VALIDATION_ERROR", "Complete recipe identity, timing, slot, locale, cuisine, and cost metadata are required.");
  }
}

function validateIngredient(ingredient) {
  if (!ingredient?.id || !ingredient.canonicalName?.trim() || !ingredient.category?.trim()
    || !Array.isArray(ingredient.compatibleDiets) || !ingredient.compatibleDiets.length
    || !Array.isArray(ingredient.conversions) || !ingredient.conversions.length
    || ingredient.conversions.some((item) => !item.householdUnit?.trim()
      || !(item.householdQuantity > 0) || !(item.grams > 0))) {
    throw new CatalogueError("VALIDATION_ERROR", "Complete ingredient identity, diets, category, and positive unit conversions are required.");
  }
}

function validateNutrientRecord(record) {
  const nutrition = record?.nutritionPer100Grams;
  const source = record?.source;
  const values = nutrition ? [nutrition.calories, nutrition.proteinGrams, nutrition.carbohydrateGrams, nutrition.fatGrams, nutrition.fibreGrams] : [];
  if (!isUUID(record?.id) || !record?.ingredientID || !isUUID(source?.id)
    || !source.provider?.trim() || !source.dataset?.trim() || !source.datasetVersion?.trim()
    || !source.sourceRecordID?.trim() || !["approvedForProduction", "evaluationOnly", "unknown", "expired", "prohibited"].includes(source.licenseStatus)
    || Number.isNaN(new Date(source.retrievedAt).getTime()) || !["low", "medium", "high"].includes(record.confidence)
    || values.length !== 5 || values.some((value) => !(Number(value) >= 0))
    || Number.isNaN(new Date(record.effectiveFrom).getTime())
    || (record.effectiveUntil && new Date(record.effectiveUntil) <= new Date(record.effectiveFrom))) {
    throw new CatalogueError("VALIDATION_ERROR", "Complete immutable nutrient values, provenance, licensing, confidence, and effective dates are required.");
  }
}

function requireRole(actor, role) {
  if (!actor?.id || !actor.roles?.includes(role)) {
    throw new CatalogueError("AUTHENTICATION_REQUIRED", "An authorized catalogue role is required.", 403);
  }
}

function storedJSON(value) {
  return structuredClone(typeof value === "string" ? JSON.parse(value) : value ?? {});
}

function camelState(value) {
  return value === "in_review" ? "inReview" : value;
}

function camelLicense(value) {
  return ({ approved_for_production: "approvedForProduction", evaluation_only: "evaluationOnly" })[value] ?? value;
}

function snakeLicense(value) {
  return ({ approvedForProduction: "approved_for_production", evaluationOnly: "evaluation_only" })[value] ?? value;
}

function sameSource(row, source) {
  return row && row.provider === source.provider.trim() && row.dataset === source.dataset.trim()
    && row.dataset_version === source.datasetVersion.trim() && row.source_record_id === source.sourceRecordID.trim()
    && row.license_status === snakeLicense(source.licenseStatus)
    && (row.source_url ?? null) === (source.sourceURL ?? null)
    && new Date(row.retrieved_at).getTime() === new Date(source.retrievedAt).getTime();
}

function isUUID(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
}

function positiveOrPlaceholder(value) {
  return Number(value) > 0 ? Number(value) : 1;
}

function nonnegativeOrPlaceholder(value) {
  return Number(value) >= 0 ? Number(value) : 0;
}
