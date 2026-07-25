export class CatalogueError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = "CatalogueError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class MemoryCatalogueStore {
  ingredients = new Map();
  nutrientRecords = new Map();
  recipes = new Map();
  versions = new Map();
  auditEvents = [];
  contentAuditEvents = [];
}

export class CatalogueService {
  constructor({ store = new MemoryCatalogueStore(), now = () => new Date() } = {}) {
    this.store = store;
    this.now = now;
  }

  registerIngredient(ingredient) {
    this.store.ingredients.set(ingredient.id, structuredClone(ingredient));
  }

  registerNutrientRecord(record) {
    this.store.nutrientRecords.set(record.id, structuredClone(record));
  }

  upsertIngredient(ingredient, actor) {
    requireRole(actor, "reviewer");
    if (!ingredient?.id || !ingredient.canonicalName?.trim() || !ingredient.category?.trim()
      || !ingredient.compatibleDiets?.length || !ingredient.conversions?.length
      || ingredient.conversions.some((item) => !item.householdUnit?.trim()
        || !(item.householdQuantity > 0) || !(item.grams > 0))) {
      throw new CatalogueError("VALIDATION_ERROR", "Complete ingredient identity, diets, category, and positive unit conversions are required.");
    }
    const saved = { ...structuredClone(ingredient), sourceStatus: "verified", reviewedBy: actor.id, reviewedAt: this.now() };
    this.store.ingredients.set(ingredient.id, saved);
    this.store.contentAuditEvents.push({
      actorID: actor.id, action: "ingredient.verified", entityType: "ingredient",
      entityID: ingredient.id, content: structuredClone(ingredient), occurredAt: this.now(),
    });
    return structuredClone(saved);
  }

  registerReviewedNutrientRecord(record, actor) {
    requireRole(actor, "reviewer");
    if (!record?.id || !record.ingredientID || !record.source || !record.nutritionPer100Grams) {
      throw new CatalogueError("VALIDATION_ERROR", "Complete nutrient values and provenance are required.");
    }
    validateNutrientProvenance(record);
    if (this.store.nutrientRecords.has(record.id)) {
      throw new CatalogueError("CONFLICT", "This nutrient record ID already exists and is immutable.", 409);
    }
    const saved = { ...structuredClone(record), reviewedBy: actor.id, reviewedAt: this.now() };
    this.store.nutrientRecords.set(record.id, saved);
    this.store.contentAuditEvents.push({
      actorID: actor.id, action: "nutrient_record.reviewed", entityType: "nutrient_record",
      entityID: record.id, content: structuredClone(saved), occurredAt: this.now(),
    });
    return structuredClone(saved);
  }

  reviewQueue() {
    return [...this.store.versions.values()]
      .filter((version) => ["draft", "inReview", "rejected"].includes(version.workflowState))
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((version) => ({
        ...structuredClone(version),
        recipeMetadata: structuredClone(this.store.recipes.get(version.recipeID) ?? {}),
        validationIssues: validateForPublication(version.content, this.store, this.now()),
        nutrientEvidence: (version.content.nutrientRecordIDs ?? []).map((id) => {
          const record = this.store.nutrientRecords.get(id);
          return record ? {
            id: record.id, ingredientID: record.ingredientID, confidence: record.confidence,
            reviewedBy: record.reviewedBy, reviewedAt: record.reviewedAt, source: structuredClone(record.source),
          } : { id, missing: true };
        }),
      }));
  }

  catalogueAuditLog() {
    return [...this.store.auditEvents.map((event) => ({ ...event, entityType: "recipe_version", entityID: event.recipeVersionID })),
      ...this.store.contentAuditEvents]
      .map((event) => structuredClone(event))
      .sort((left, right) => new Date(right.occurredAt) - new Date(left.occurredAt));
  }

  contentInventory() {
    return {
      ingredients: [...this.store.ingredients.values()]
        .map((ingredient) => structuredClone(ingredient))
        .sort((left, right) => left.canonicalName.localeCompare(right.canonicalName)),
      nutrientRecords: [...this.store.nutrientRecords.values()]
        .map((record) => structuredClone(record))
        .sort((left, right) => new Date(right.reviewedAt ?? 0) - new Date(left.reviewedAt ?? 0)),
    };
  }

  createRecipeDraft(recipe, content, actor) {
    requireRole(actor, "author");
    if (!recipe?.id) {
      throw new CatalogueError("VALIDATION_ERROR", "A stable recipe identifier is required.");
    }
    const openVersion = [...this.store.versions.values()].find(
      (candidate) => candidate.recipeID === recipe.id && ["draft", "inReview", "rejected"].includes(candidate.workflowState),
    );
    if (openVersion) {
      throw new CatalogueError("CONFLICT", "Finish the existing editable version before creating another.", 409);
    }
    if (!this.store.recipes.has(recipe.id)) this.store.recipes.set(recipe.id, structuredClone(recipe));
    const versionNumber = Math.max(
      0,
      ...[...this.store.versions.values()].filter((candidate) => candidate.recipeID === recipe.id).map((candidate) => candidate.version),
    ) + 1;
    const version = {
      id: `${recipe.id}-v${versionNumber}`,
      recipeID: recipe.id,
      version: versionNumber,
      content: structuredClone(content),
      workflowState: "draft",
      authoredBy: actor.id,
      createdAt: this.now(),
      submittedAt: null,
      reviewedBy: null,
      reviewedAt: null,
      publishedAt: null,
      rejectionReason: null,
    };
    this.store.versions.set(version.id, version);
    this.#audit(actor, "recipe_version.created", version.id);
    return structuredClone(version);
  }

  editDraft(versionID, content, actor) {
    requireRole(actor, "author");
    const current = this.#version(versionID);
    if (["published", "archived"].includes(current.workflowState)) {
      throw new CatalogueError("CONFLICT", "Published recipe versions are immutable.", 409);
    }
    if (!["draft", "rejected"].includes(current.workflowState)) {
      throw new CatalogueError("CONFLICT", "This version cannot be edited during review.", 409);
    }
    const updated = {
      ...current,
      content: structuredClone(content),
      workflowState: "draft",
      submittedAt: null,
      reviewedBy: null,
      reviewedAt: null,
      publishedAt: null,
      rejectionReason: null,
    };
    this.store.versions.set(versionID, updated);
    this.#audit(actor, "recipe_version.edited", versionID);
    return structuredClone(updated);
  }

  submitLatestDraft(recipeID, actor) {
    requireRole(actor, "author");
    const version = [...this.store.versions.values()]
      .filter((candidate) => candidate.recipeID === recipeID && candidate.workflowState === "draft")
      .sort((left, right) => right.version - left.version)[0];
    if (!version) throw new CatalogueError("VALIDATION_ERROR", "No editable draft exists for this recipe.", 404);
    const issues = validateForPublication(version.content, this.store, this.now());
    if (issues.length) throw new CatalogueError("VALIDATION_ERROR", "Recipe content is not ready for review.", 422, issues);
    const submitted = { ...version, workflowState: "inReview", submittedAt: this.now() };
    this.store.versions.set(version.id, submitted);
    this.#audit(actor, "recipe_version.submitted", version.id);
    return structuredClone(submitted);
  }

  approve(versionID, actor) {
    requireRole(actor, "reviewer");
    const version = this.#version(versionID);
    if (version.workflowState !== "inReview") {
      throw new CatalogueError("CONFLICT", "Only a version in review can be published.", 409);
    }
    if (version.authoredBy === actor.id) {
      throw new CatalogueError("VALIDATION_ERROR", "A recipe author cannot approve their own version.", 403);
    }
    const issues = validateForPublication(version.content, this.store, this.now());
    if (issues.length) throw new CatalogueError("VALIDATION_ERROR", "Recipe content failed publication validation.", 422, issues);
    const timestamp = this.now();
    const published = {
      ...version,
      workflowState: "published",
      reviewedBy: actor.id,
      reviewedAt: timestamp,
      publishedAt: timestamp,
      rejectionReason: null,
    };
    this.store.versions.set(versionID, published);
    const recipe = this.store.recipes.get(version.recipeID);
    this.store.recipes.set(version.recipeID, { ...recipe, currentPublishedVersionID: versionID });
    this.#audit(actor, "recipe_version.published", versionID);
    return structuredClone(published);
  }

  reject(versionID, reason, actor) {
    requireRole(actor, "reviewer");
    if (!reason?.trim()) throw new CatalogueError("VALIDATION_ERROR", "A rejection reason is required.");
    const version = this.#version(versionID);
    if (version.workflowState !== "inReview") {
      throw new CatalogueError("CONFLICT", "Only a version in review can be rejected.", 409);
    }
    const timestamp = this.now();
    const rejected = {
      ...version,
      workflowState: "rejected",
      reviewedBy: actor.id,
      reviewedAt: timestamp,
      rejectionReason: reason.trim(),
    };
    this.store.versions.set(versionID, rejected);
    this.#audit(actor, "recipe_version.rejected", versionID, reason.trim());
    return structuredClone(rejected);
  }

  version(versionID) {
    return structuredClone(this.#version(versionID));
  }

  auditLog() {
    return structuredClone(this.store.auditEvents);
  }

  publishedSnapshots() {
    return [...this.store.versions.values()]
      .filter((version) => version.workflowState === "published")
      .map((version) => {
        const recipe = this.store.recipes.get(version.recipeID);
        const ingredients = version.content.ingredients.map((item) => {
          const ingredient = this.store.ingredients.get(item.ingredientID);
          return {
            ingredientID: ingredient.id,
            displayName: ingredient.canonicalName,
            householdQuantity: item.householdQuantity,
            householdUnit: item.householdUnit,
            grams: item.grams,
            allergenIDs: ingredient.allergenIDs ?? [],
          };
        });
        const sourceSummary = [...new Set([...version.content.nutrientRecordIDs].map((id) => {
          const source = this.store.nutrientRecords.get(id).source;
          return `${source.provider} ${source.dataset} ${source.datasetVersion}`;
        }))].sort().join("; ");
        return {
          recipeID: recipe.id,
          localeIdentifier: recipe.localeIdentifier,
          version: version.version,
          displayName: version.content.displayName,
          ingredients,
          methodSteps: version.content.methodSteps,
          servingSizeGrams: version.content.servingSizeGrams,
          nutritionPerServing: version.content.nutritionPerServing,
          activePreparationMinutes: recipe.activePreparationMinutes,
          totalMinutes: recipe.totalMinutes,
          equipment: recipe.equipment,
          costBand: recipe.costBand,
          minimumServingMultiplier: validServingMultiplier(version.content.minimumServingMultiplier, 1),
          maximumServingMultiplier: validServingMultiplier(version.content.maximumServingMultiplier, 1),
          tags: version.content.tags,
          allergenIDs: version.content.declaredAllergenIDs,
          dietType: version.content.dietType,
          eligibleSlots: recipe.eligibleSlots,
          dominantIngredientIDs: version.content.dominantIngredientIDs,
          nutritionSourceSummary: sourceSummary,
          nutritionCalculationVersion: version.content.nutritionCalculationVersion,
          nutritionDisclosure: version.content.nutritionDisclosure ?? "estimated",
          reviewStatus: "approved",
          publicationStatus: "published",
        };
      });
  }

  #version(versionID) {
    const version = this.store.versions.get(versionID);
    if (!version) throw new CatalogueError("VALIDATION_ERROR", "Recipe version not found.", 404);
    return version;
  }

  #audit(actor, action, recipeVersionID, reason = null) {
    this.store.auditEvents.push({ actorID: actor.id, action, recipeVersionID, reason, occurredAt: this.now() });
  }
}

export function validateForPublication(content, store, now) {
  const issues = [];
  if (!content?.displayName?.trim()) issues.push("MISSING_NAME");
  if (!Array.isArray(content?.ingredients) || content.ingredients.length === 0) issues.push("MISSING_INGREDIENTS");
  if (!Array.isArray(content?.methodSteps) || content.methodSteps.length === 0 || content.methodSteps.some((step) => !step?.trim())) {
    issues.push("MISSING_METHOD");
  }
  const minimumServingMultiplier = Number(content?.minimumServingMultiplier ?? 1);
  const maximumServingMultiplier = Number(content?.maximumServingMultiplier ?? 1);
  if (!(content?.servings > 0) || !(content?.servingSizeGrams > 0)
      || !Number.isFinite(minimumServingMultiplier) || !Number.isFinite(maximumServingMultiplier)
      || minimumServingMultiplier < 0.25 || maximumServingMultiplier > 4
      || minimumServingMultiplier > 1 || maximumServingMultiplier < 1
      || minimumServingMultiplier > maximumServingMultiplier) issues.push("INVALID_SERVING");
  if (!(content?.nutritionPerServing?.calories > 0)) issues.push("INVALID_NUTRITION");
  if (!content?.nutritionCalculationVersion?.trim()) issues.push("MISSING_CALCULATION_VERSION");

  const derivedAllergens = new Set();
  const ingredientIDs = new Set();
  for (const item of content?.ingredients ?? []) {
    ingredientIDs.add(item.ingredientID);
    if (!(item.grams > 0) || !(item.householdQuantity > 0)) issues.push(`INVALID_QUANTITY:${item.ingredientID}`);
    const ingredient = store.ingredients.get(item.ingredientID);
    if (!ingredient) {
      issues.push(`UNKNOWN_INGREDIENT:${item.ingredientID}`);
      continue;
    }
    if (ingredient.sourceStatus !== "verified") issues.push(`UNVERIFIED_INGREDIENT:${item.ingredientID}`);
    if (!ingredient.compatibleDiets?.includes(content.dietType)) issues.push(`DIET_MISMATCH:${item.ingredientID}`);
    for (const allergen of ingredient.allergenIDs ?? []) derivedAllergens.add(allergen);
  }
  const declared = new Set(content?.declaredAllergenIDs ?? []);
  if (!setsEqual(derivedAllergens, declared)) issues.push("ALLERGEN_DECLARATION_MISMATCH");

  const coveredIngredients = new Set();
  let usesAIEstimates = false;
  for (const recordID of content?.nutrientRecordIDs ?? []) {
    const record = store.nutrientRecords.get(recordID);
    if (!record) {
      issues.push(`MISSING_NUTRIENT_RECORD:${recordID}`);
      continue;
    }
    coveredIngredients.add(record.ingredientID);
    if (!ingredientIDs.has(record.ingredientID)) issues.push(`NUTRIENT_INGREDIENT_MISMATCH:${recordID}`);
    if (!record.reviewedBy || !record.reviewedAt) issues.push(`UNREVIEWED_NUTRIENT:${recordID}`);
    const effectiveFrom = new Date(record.effectiveFrom);
    const effectiveUntil = record.effectiveUntil ? new Date(record.effectiveUntil) : null;
    if (effectiveFrom > now || (effectiveUntil && effectiveUntil <= now)) issues.push(`STALE_NUTRIENT:${recordID}`);
    if (record.source?.licenseStatus !== "approvedForProduction") issues.push(`UNLICENSED_SOURCE:${recordID}`);
    if (record.source?.provenanceKind === "aiEstimated") usesAIEstimates = true;
  }
  for (const ingredientID of ingredientIDs) {
    if (!coveredIngredients.has(ingredientID)) issues.push(`MISSING_NUTRIENT_RECORD:${ingredientID}`);
  }
  if (usesAIEstimates && content?.nutritionDisclosure !== "estimated") {
    issues.push("AI_NUTRITION_DISCLOSURE_REQUIRED");
  }
  return [...new Set(issues)];
}

export function validateNutrientProvenance(record) {
  const source = record?.source ?? {};
  const provenanceKind = source.provenanceKind ?? "licensed";
  if (!["publicDomain", "licensed", "aiEstimated"].includes(provenanceKind)) {
    throw new CatalogueError("VALIDATION_ERROR", "A supported nutrient provenance kind is required.");
  }
  if (provenanceKind === "aiEstimated") {
    if (!source.generationMetadata?.model?.trim() || !source.generationMetadata?.promptVersion?.trim()) {
      throw new CatalogueError("VALIDATION_ERROR", "AI-estimated nutrients require model and prompt-version provenance.");
    }
    if (record.confidence === "high") {
      throw new CatalogueError("VALIDATION_ERROR", "AI-estimated nutrients cannot be recorded with high confidence.");
    }
  }
}

function requireRole(actor, role) {
  if (!actor?.id || !actor.roles?.includes(role)) {
    throw new CatalogueError("AUTHENTICATION_REQUIRED", "An authorized catalogue role is required.", 403);
  }
}

function setsEqual(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function validServingMultiplier(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}
