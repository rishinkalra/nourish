import { randomUUID } from "node:crypto";
import { withTransaction } from "./database.mjs";
import { validateGenerationBrief } from "./openai-recipe-generator.mjs";

export class RecipeGenerationError extends Error {
  constructor(code, message, status = 400, retryable = false) {
    super(message);
    this.name = "RecipeGenerationError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export class ConfigurationGatedRecipeGenerationService {
  async request() {
    throw new RecipeGenerationError("TEMPORARY_FAILURE", "Recipe generation is not configured.", 503, true);
  }

  async list() {
    throw new RecipeGenerationError("TEMPORARY_FAILURE", "Recipe generation is not configured.", 503, true);
  }

  async detail() {
    throw new RecipeGenerationError("TEMPORARY_FAILURE", "Recipe generation is not configured.", 503, true);
  }

  async image() {
    throw new RecipeGenerationError("TEMPORARY_FAILURE", "Recipe image preview is not configured.", 503, true);
  }

  async importDraft() {
    throw new RecipeGenerationError("TEMPORARY_FAILURE", "Recipe generation is not configured.", 503, true);
  }

  async discard() {
    throw new RecipeGenerationError("TEMPORARY_FAILURE", "Recipe generation is not configured.", 503, true);
  }
}

export class MemoryRecipeGenerationService {
  constructor({ jobQueue, objectStore, catalogueService, now = () => new Date() } = {}) {
    if (!jobQueue?.enqueue) throw new RecipeGenerationError("CONFIGURATION_ERROR", "A background queue is required.", 500);
    this.jobQueue = jobQueue;
    this.objectStore = objectStore;
    this.catalogueService = catalogueService;
    this.now = now;
    this.runs = new Map();
    this.idempotency = new Map();
  }

  async request(brief, { actor, idempotencyKey }) {
    requireAuthor(actor);
    const normalizedBrief = validateGenerationBrief(brief);
    const key = validateIdempotencyKey(idempotencyKey);
    const replayID = this.idempotency.get(`${actor.id}:${key}`);
    if (replayID) return publicMemoryRun(this.runs.get(replayID));
    const now = this.now();
    const run = {
      id: randomUUID(), status: "queued", brief: normalizedBrief, requestedBy: actor.id,
      idempotencyKey: key, output: null, imageObjectKey: null, lastErrorCode: null,
      createdAt: now, updatedAt: now, completedAt: null,
    };
    this.runs.set(run.id, run);
    this.idempotency.set(`${actor.id}:${key}`, run.id);
    await this.jobQueue.enqueue({
      type: "recipe.generate",
      idempotencyKey: `recipe-generation:${run.id}`,
      payload: { generationID: run.id },
      maxAttempts: 4,
    });
    return publicMemoryRun(run);
  }

  async list({ limit = 100 } = {}) {
    return [...this.runs.values()]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, validatedLimit(limit))
      .map(publicMemoryRun);
  }

  async detail(id) {
    const run = this.runs.get(id);
    if (!run) throw new RecipeGenerationError("VALIDATION_ERROR", "Recipe generation was not found.", 404);
    return publicMemoryRun(run);
  }

  async image(id) {
    const run = this.runs.get(id);
    if (!run) throw new RecipeGenerationError("VALIDATION_ERROR", "Recipe generation was not found.", 404);
    return readRunImage(run, this.objectStore);
  }

  async importDraft(id, review, { actor }) {
    requireAuthor(actor);
    const run = this.runs.get(id);
    requireReviewableOwnedRun(run, actor);
    if (!this.catalogueService?.createRecipeDraft) {
      throw new RecipeGenerationError("TEMPORARY_FAILURE", "Catalogue drafting is not configured.", 503, true);
    }
    const draft = prepareCatalogueDraft(run, review);
    const version = await this.catalogueService.createRecipeDraft(draft.recipe, draft.content, actor);
    const decidedAt = this.now();
    Object.assign(run, {
      status: "imported", importedRecipeVersionID: version.id, decisionActor: actor.id,
      decidedAt, updatedAt: decidedAt,
    });
    return { generation: publicMemoryRun(run), recipeVersion: version };
  }

  async discard(id, reason, { actor }) {
    requireAuthor(actor);
    const run = this.runs.get(id);
    requireReviewableOwnedRun(run, actor);
    const safeReason = validateDecisionReason(reason);
    const decidedAt = this.now();
    Object.assign(run, {
      status: "discarded", decisionActor: actor.id, decisionReason: safeReason,
      decidedAt, updatedAt: decidedAt,
    });
    return publicMemoryRun(run);
  }
}

export class PostgresRecipeGenerationService {
  constructor({ pool, objectStore, catalogueService, now = () => new Date() } = {}) {
    if (!pool?.connect || !pool?.query) throw new RecipeGenerationError("CONFIGURATION_ERROR", "PostgreSQL is required.", 500);
    this.pool = pool;
    this.objectStore = objectStore;
    this.catalogueService = catalogueService;
    this.now = now;
  }

  async request(brief, { actor, idempotencyKey }) {
    requireAuthor(actor);
    const normalizedBrief = validateGenerationBrief(brief);
    const key = validateIdempotencyKey(idempotencyKey);
    const now = this.now();
    return withTransaction(this.pool, async (client) => {
      const existing = await client.query(
        `SELECT * FROM recipe_generation_runs
          WHERE requested_by = $1 AND idempotency_key = $2`,
        [actor.id, key],
      );
      if (existing.rows[0]) return mapRun(existing.rows[0]);
      const generationID = randomUUID();
      const inserted = await client.query(
        `INSERT INTO recipe_generation_runs (
            id, requested_by, idempotency_key, status, brief_json, created_at, updated_at
         ) VALUES ($1, $2, $3, 'queued', $4::jsonb, $5, $5)
         RETURNING *`,
        [generationID, actor.id, key, JSON.stringify(normalizedBrief), now],
      );
      await client.query(
        `INSERT INTO background_jobs (
            id, job_type, user_id, idempotency_key, state, payload_json,
            max_attempts, available_at, created_at, updated_at
         ) VALUES ($1, 'recipe.generate', NULL, $2, 'queued', $3::jsonb, 4, $4, $4, $4)
         ON CONFLICT (job_type, idempotency_key) DO NOTHING`,
        [randomUUID(), `recipe-generation:${generationID}`, JSON.stringify({ generationID }), now],
      );
      return mapRun(inserted.rows[0]);
    });
  }

  async list({ limit = 100 } = {}) {
    const result = await this.pool.query(
      `SELECT * FROM recipe_generation_runs
        ORDER BY created_at DESC, id DESC
        LIMIT $1`,
      [validatedLimit(limit)],
    );
    return result.rows.map(mapRun);
  }

  async detail(id) {
    const result = await this.pool.query("SELECT * FROM recipe_generation_runs WHERE id = $1", [id]);
    if (!result.rows[0]) throw new RecipeGenerationError("VALIDATION_ERROR", "Recipe generation was not found.", 404);
    return mapRun(result.rows[0]);
  }

  async image(id) {
    const result = await this.pool.query("SELECT * FROM recipe_generation_runs WHERE id = $1", [id]);
    if (!result.rows[0]) throw new RecipeGenerationError("VALIDATION_ERROR", "Recipe generation was not found.", 404);
    return readRunImage(result.rows[0], this.objectStore);
  }

  async importDraft(id, review, { actor }) {
    requireAuthor(actor);
    if (!this.catalogueService?.createRecipeDraft) {
      throw new RecipeGenerationError("TEMPORARY_FAILURE", "Catalogue drafting is not configured.", 503, true);
    }
    return withTransaction(this.pool, async (client) => {
      const selected = await client.query(
        "SELECT * FROM recipe_generation_runs WHERE id = $1 FOR UPDATE",
        [validatedGenerationID(id)],
      );
      const row = selected.rows[0];
      requireReviewableOwnedRun(row, actor);
      const draft = prepareCatalogueDraft(row, review);
      const version = await this.catalogueService.createRecipeDraft(
        draft.recipe,
        draft.content,
        actor,
        { transactionClient: client },
      );
      const decidedAt = this.now();
      await client.query(
        `UPDATE recipe_generation_runs
            SET status = 'imported', decision_actor = $2,
                imported_recipe_version_id = $3, decided_at = $4, updated_at = $4
          WHERE id = $1`,
        [id, actor.id, version.id, decidedAt],
      );
      await client.query(
        `INSERT INTO recipe_generation_decisions (
            id, generation_id, action, actor_id, recipe_version_id, occurred_at
         ) VALUES ($1, $2, 'imported', $3, $4, $5)`,
        [randomUUID(), id, actor.id, version.id, decidedAt],
      );
      const generation = mapRun({
        ...row,
        status: "imported",
        decision_actor: actor.id,
        imported_recipe_version_id: version.id,
        decided_at: decidedAt,
        updated_at: decidedAt,
      });
      return { generation, recipeVersion: version };
    });
  }

  async discard(id, reason, { actor }) {
    requireAuthor(actor);
    const safeReason = validateDecisionReason(reason);
    return withTransaction(this.pool, async (client) => {
      const selected = await client.query(
        "SELECT * FROM recipe_generation_runs WHERE id = $1 FOR UPDATE",
        [validatedGenerationID(id)],
      );
      const row = selected.rows[0];
      requireReviewableOwnedRun(row, actor);
      const decidedAt = this.now();
      const updated = await client.query(
        `UPDATE recipe_generation_runs
            SET status = 'discarded', decision_actor = $2, decision_reason = $3,
                decided_at = $4, updated_at = $4
          WHERE id = $1
        RETURNING *`,
        [id, actor.id, safeReason, decidedAt],
      );
      await client.query(
        `INSERT INTO recipe_generation_decisions (
            id, generation_id, action, actor_id, reason, occurred_at
         ) VALUES ($1, $2, 'discarded', $3, $4, $5)`,
        [randomUUID(), id, actor.id, safeReason, decidedAt],
      );
      return mapRun(updated.rows[0]);
    });
  }
}

export function createRecipeGenerationHandler({ pool, generator, objectStore, now = () => new Date() } = {}) {
  if (!pool?.query || !generator?.generate || !objectStore?.putText) {
    throw new RecipeGenerationError("CONFIGURATION_ERROR", "Recipe generation worker dependencies are incomplete.", 500);
  }
  return async (job, { extendLease } = {}) => {
    const generationID = job?.payload?.generationID;
    if (!isUUID(generationID)) throw new RecipeGenerationError("VALIDATION_ERROR", "The recipe generation job is invalid.");
    const selected = await pool.query("SELECT * FROM recipe_generation_runs WHERE id = $1", [generationID]);
    const run = selected.rows[0];
    if (!run) throw new RecipeGenerationError("VALIDATION_ERROR", "Recipe generation was not found.");
    if (run.status === "awaiting_review") return { generationID, status: "awaitingReview" };

    await pool.query(
      `UPDATE recipe_generation_runs
          SET status = 'running', attempt_count = attempt_count + 1,
              last_error_code = NULL, updated_at = $2
        WHERE id = $1`,
      [generationID, now()],
    );
    try {
      await extendLease?.(10 * 60_000);
      const generated = await generator.generate(parseJSON(run.brief_json));
      await extendLease?.(10 * 60_000);
      const imageObjectKey = `recipe-generations/${generationID}/hero-image.png.b64`;
      await objectStore.putText({ key: imageObjectKey, value: generated.image.base64 });
      const output = {
        recipe: generated.recipe,
        image: {
          objectKey: imageObjectKey,
          mimeType: generated.image.mimeType,
          width: generated.image.width,
          height: generated.image.height,
        },
        provenance: generated.provenance,
      };
      const completedAt = now();
      await pool.query(
        `UPDATE recipe_generation_runs
            SET status = 'awaiting_review', output_json = $2::jsonb,
                image_object_key = $3, text_model = $4, image_model = $5,
                prompt_version = $6, completed_at = $7, updated_at = $7
          WHERE id = $1`,
        [
          generationID, JSON.stringify(output), imageObjectKey,
          generated.provenance.textModel, generated.provenance.imageModel,
          generated.provenance.promptVersion, completedAt,
        ],
      );
      return { generationID, status: "awaitingReview" };
    } catch (error) {
      await pool.query(
        `UPDATE recipe_generation_runs
            SET status = 'failed', last_error_code = $2, updated_at = $3
          WHERE id = $1`,
        [generationID, boundedErrorCode(error?.code), now()],
      );
      throw error;
    }
  };
}

function mapRun(row) {
  const output = parseJSON(row.output_json);
  return {
    id: String(row.id),
    status: camelStatus(row.status),
    brief: parseJSON(row.brief_json),
    requestedBy: String(row.requested_by),
    idempotencyKey: row.idempotency_key,
    output: publicOutput(output),
    imageAvailable: Boolean(row.image_object_key),
    textModel: row.text_model,
    imageModel: row.image_model,
    promptVersion: row.prompt_version,
    attemptCount: Number(row.attempt_count ?? 0),
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    decisionActor: row.decision_actor,
    decisionReason: row.decision_reason,
    importedRecipeVersionID: row.imported_recipe_version_id,
    decidedAt: row.decided_at,
  };
}

async function readRunImage(run, objectStore) {
  const output = parseJSON(run?.output_json ?? run?.output);
  const key = run?.image_object_key ?? run?.imageObjectKey ?? output?.image?.objectKey;
  if (!key) throw new RecipeGenerationError("VALIDATION_ERROR", "The recipe image is not available.", 404);
  if (!objectStore?.getText) {
    throw new RecipeGenerationError("TEMPORARY_FAILURE", "Recipe image preview is not configured.", 503, true);
  }
  try {
    const base64 = await objectStore.getText(key);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) throw new Error("Invalid image");
    return {
      content: Buffer.from(base64, "base64"),
      mimeType: output?.image?.mimeType === "image/png" ? "image/png" : "image/png",
    };
  } catch (error) {
    if (error instanceof RecipeGenerationError) throw error;
    throw new RecipeGenerationError("TEMPORARY_FAILURE", "The recipe image is temporarily unavailable.", 503, true);
  }
}

function publicOutput(output) {
  if (!output) return null;
  return {
    ...output,
    image: output.image ? {
      mimeType: output.image.mimeType,
      width: output.image.width,
      height: output.image.height,
    } : null,
  };
}

function publicMemoryRun(run) {
  const { imageObjectKey, ...publicRun } = structuredClone(run);
  return {
    ...publicRun,
    output: publicOutput(publicRun.output),
    imageAvailable: Boolean(imageObjectKey),
  };
}

function requireAuthor(actor) {
  if (!actor?.id || !actor.roles?.some((role) => role === "author" || role === "security_admin")) {
    throw new RecipeGenerationError("AUTHENTICATION_REQUIRED", "Recipe author access is required.", 403);
  }
}

function requireReviewableOwnedRun(run, actor) {
  if (!run) throw new RecipeGenerationError("VALIDATION_ERROR", "Recipe generation was not found.", 404);
  const status = run.status === "awaiting_review" ? "awaitingReview" : run.status;
  if (status !== "awaitingReview") {
    throw new RecipeGenerationError("CONFLICT", "Only a generated draft awaiting review can be decided.", 409);
  }
  const requestedBy = String(run.requested_by ?? run.requestedBy ?? "");
  if (requestedBy !== actor.id && !actor.roles?.includes("security_admin")) {
    throw new RecipeGenerationError("AUTHENTICATION_REQUIRED", "Only the requesting author can decide this draft.", 403);
  }
}

function prepareCatalogueDraft(run, review) {
  const output = parseJSON(run.output_json ?? run.output);
  const generated = output?.recipe;
  if (!generated) throw new RecipeGenerationError("CONFLICT", "The generated recipe is not ready for import.", 409);
  const value = review ?? {};
  const confirmations = [
    "confirmEstimatedNutrition", "confirmImageMatches", "confirmMethodSafe",
    "confirmDietCompatible", "confirmAllergensReviewed",
  ];
  if (confirmations.some((field) => value[field] !== true)) {
    throw new RecipeGenerationError("VALIDATION_ERROR", "Complete every recipe review confirmation before import.");
  }
  const recipeID = safeIdentifier(value.recipeID, "Recipe ID");
  const mappings = validateIngredientMappings(value.ingredientMappings, generated.ingredients);
  const declaredAllergenIDs = safeIdentifierArray(value.declaredAllergenIDs ?? [], 30, "Declared allergens");
  const dominantIngredientIDs = dominantMappings(generated, mappings);
  const nutrition = generated.nutritionPerServing;
  return {
    recipe: {
      id: recipeID,
      localeIdentifier: "en-IN",
      cuisine: generated.cuisine,
      eligibleSlots: generated.eligibleSlots,
      activePreparationMinutes: generated.activePreparationMinutes,
      totalMinutes: generated.totalMinutes,
      equipment: generated.equipment,
      costBand: generated.costBand,
      lifecycleStatus: "active",
    },
    content: {
      displayName: generated.displayName,
      description: generated.description,
      servings: generated.servings,
      servingSizeGrams: generated.servingSizeGrams,
      minimumServingMultiplier: generated.minimumServingMultiplier,
      maximumServingMultiplier: generated.maximumServingMultiplier,
      dietType: generated.dietType,
      nutritionPerServing: nutrition,
      nutritionDisclosure: "estimated",
      ingredients: mappings.map((mapping) => ({
        ingredientID: mapping.ingredientID,
        householdQuantity: mapping.householdQuantity,
        householdUnit: mapping.householdUnit,
        grams: mapping.grams,
      })),
      methodSteps: generated.methodSteps,
      nutrientRecordIDs: mappings.map((mapping) => mapping.nutrientRecordID),
      nutritionCalculationVersion: generated.nutritionCalculationVersion ?? "ai-weighted-grams-v1",
      declaredAllergenIDs,
      dominantIngredientIDs,
      tags: generated.tags,
      sourceGenerationID: String(run.id),
    },
  };
}

function validateIngredientMappings(mappings, generatedIngredients) {
  if (!Array.isArray(mappings) || mappings.length !== generatedIngredients.length) {
    throw new RecipeGenerationError("VALIDATION_ERROR", "Map every generated ingredient before import.");
  }
  const generatedNames = new Set(generatedIngredients.map((ingredient) => ingredient.canonicalName.toLocaleLowerCase("en-IN")));
  const seenNames = new Set();
  return mappings.map((mapping) => {
    const generatedIngredientName = String(mapping?.generatedIngredientName ?? "").trim();
    const normalizedName = generatedIngredientName.toLocaleLowerCase("en-IN");
    if (!generatedNames.has(normalizedName) || seenNames.has(normalizedName)) {
      throw new RecipeGenerationError("VALIDATION_ERROR", "Ingredient mappings must match each generated ingredient exactly once.");
    }
    seenNames.add(normalizedName);
    const householdQuantity = positiveNumber(mapping.householdQuantity, 0.01, 100, "Household quantity");
    const grams = positiveNumber(mapping.grams, 0.1, 5_000, "Ingredient grams");
    return {
      generatedIngredientName,
      ingredientID: safeIdentifier(mapping.ingredientID, "Ingredient ID"),
      nutrientRecordID: safeIdentifier(mapping.nutrientRecordID, "Nutrient record ID"),
      householdQuantity,
      householdUnit: boundedReviewText(mapping.householdUnit, 1, 40, "Household unit"),
      grams,
    };
  });
}

function dominantMappings(generated, mappings) {
  const byName = new Map(mappings.map((mapping) => [
    mapping.generatedIngredientName.toLocaleLowerCase("en-IN"),
    mapping.ingredientID,
  ]));
  const dominant = generated.dominantIngredientNames
    .map((name) => byName.get(name.toLocaleLowerCase("en-IN")))
    .filter(Boolean);
  return [...new Set(dominant.length ? dominant : mappings.slice(0, 3).map((mapping) => mapping.ingredientID))];
}

function validatedGenerationID(value) {
  if (!isUUID(value)) throw new RecipeGenerationError("VALIDATION_ERROR", "The recipe generation ID is invalid.");
  return value;
}

function validateDecisionReason(value) {
  return boundedReviewText(value, 12, 500, "Discard reason");
}

function safeIdentifier(value, label) {
  const identifier = String(value ?? "").trim();
  if (!/^[a-z0-9][a-z0-9._:-]{1,119}$/i.test(identifier)) {
    throw new RecipeGenerationError("VALIDATION_ERROR", `${label} is invalid.`);
  }
  return identifier;
}

function safeIdentifierArray(values, maximum, label) {
  if (!Array.isArray(values) || values.length > maximum) {
    throw new RecipeGenerationError("VALIDATION_ERROR", `${label} are invalid.`);
  }
  return [...new Set(values.map((value) => safeIdentifier(value, label)))];
}

function positiveNumber(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new RecipeGenerationError("VALIDATION_ERROR", `${label} is invalid.`);
  }
  return number;
}

function boundedReviewText(value, minimum, maximum, label) {
  const text = String(value ?? "").trim();
  if (text.length < minimum || text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new RecipeGenerationError("VALIDATION_ERROR", `${label} is invalid.`);
  }
  return text;
}

function validateIdempotencyKey(value) {
  const key = String(value ?? "").trim();
  if (!key || key.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key)) {
    throw new RecipeGenerationError("VALIDATION_ERROR", "A safe idempotency key is required.");
  }
  return key;
}

function validatedLimit(value) {
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 1 && limit <= 200 ? limit : 100;
}

function parseJSON(value) {
  if (value == null) return null;
  return structuredClone(typeof value === "string" ? JSON.parse(value) : value);
}

function camelStatus(value) {
  return value === "awaiting_review" ? "awaitingReview" : value;
}

function boundedErrorCode(value) {
  const code = String(value ?? "TEMPORARY_FAILURE").replace(/[^A-Z0-9_]/g, "_").slice(0, 80);
  return code || "TEMPORARY_FAILURE";
}

function isUUID(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ""));
}
