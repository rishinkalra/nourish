const RESPONSES_URL = "https://api.openai.com/v1/responses";
const IMAGES_URL = "https://api.openai.com/v1/images/generations";
export const RECIPE_PROMPT_VERSION = "nourish-recipe-v1";

export class RecipeGenerationProviderError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message);
    this.name = "RecipeGenerationProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

export class OpenAIRecipeGenerator {
  constructor({
    apiKey,
    textModel = "gpt-5.6-sol",
    imageModel = "gpt-image-2",
    fetchImpl = globalThis.fetch,
    timeoutMilliseconds = 120_000,
    now = () => new Date(),
  } = {}) {
    if (!apiKey?.trim()) throw new RecipeGenerationProviderError("CONFIGURATION_ERROR", "OpenAI recipe generation is not configured.");
    if (typeof fetchImpl !== "function") throw new RecipeGenerationProviderError("CONFIGURATION_ERROR", "An HTTP client is required.");
    this.apiKey = apiKey;
    this.textModel = textModel;
    this.imageModel = imageModel;
    this.fetchImpl = fetchImpl;
    this.timeoutMilliseconds = timeoutMilliseconds;
    this.now = now;
  }

  async generate(brief) {
    const normalizedBrief = validateGenerationBrief(brief);
    const textResponse = await this.#post(RESPONSES_URL, {
      model: this.textModel,
      store: false,
      reasoning: { effort: "medium" },
      input: [
        { role: "system", content: recipeSystemPrompt() },
        { role: "user", content: JSON.stringify(normalizedBrief) },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "nourish_recipe",
          strict: true,
          schema: recipeSchema(),
        },
      },
    });
    const proposal = validateRecipeProposal(JSON.parse(responseOutputText(textResponse)));
    const nutritionPerServing = calculateNutritionPerServing(proposal.ingredients, proposal.servings);

    const imageResponse = await this.#post(IMAGES_URL, {
      model: this.imageModel,
      prompt: imagePrompt(proposal),
      size: "1536x1024",
      quality: "medium",
      n: 1,
    });
    const encodedImage = imageResponse?.data?.[0]?.b64_json;
    if (!strictBase64(encodedImage)) {
      throw new RecipeGenerationProviderError("PROVIDER_RESPONSE_INVALID", "The image provider returned an invalid result.");
    }

    return {
      recipe: {
        ...proposal,
        nutritionPerServing,
        nutritionDisclosure: "estimated",
        nutritionCalculationVersion: "ai-weighted-grams-v1",
      },
      image: {
        base64: encodedImage,
        mimeType: "image/png",
        width: 1536,
        height: 1024,
      },
      provenance: {
        provider: "OpenAI",
        textModel: this.textModel,
        imageModel: this.imageModel,
        promptVersion: RECIPE_PROMPT_VERSION,
        textResponseID: boundedIdentifier(textResponse?.id),
        imageCreatedAt: imageResponse?.created ?? null,
        generatedAt: this.now().toISOString(),
      },
    };
  }

  async #post(url, body) {
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMilliseconds),
      });
    } catch {
      throw new RecipeGenerationProviderError("PROVIDER_UNAVAILABLE", "Recipe generation is temporarily unavailable.", { retryable: true });
    }
    if (!response?.ok) {
      const retryable = response?.status === 408 || response?.status === 409 || response?.status === 429 || response?.status >= 500;
      throw new RecipeGenerationProviderError(
        retryable ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REJECTED",
        retryable ? "Recipe generation is temporarily unavailable." : "The generation request was not accepted.",
        { retryable },
      );
    }
    try {
      return await response.json();
    } catch {
      throw new RecipeGenerationProviderError("PROVIDER_RESPONSE_INVALID", "The generation provider returned an invalid result.");
    }
  }
}

export function validateGenerationBrief(brief) {
  const value = brief ?? {};
  const dietType = value.dietType;
  const mealSlot = value.mealSlot;
  if (!["vegan", "vegetarian", "eggetarian", "nonVegetarian"].includes(dietType)) {
    throw new RecipeGenerationProviderError("VALIDATION_ERROR", "A supported diet type is required.");
  }
  if (!["breakfast", "lunch", "dinner", "snack"].includes(mealSlot)) {
    throw new RecipeGenerationProviderError("VALIDATION_ERROR", "A supported meal slot is required.");
  }
  const cuisine = boundedText(value.cuisine, 2, 80, "Cuisine");
  const localeIdentifier = value.localeIdentifier ?? "en-IN";
  if (localeIdentifier !== "en-IN") {
    throw new RecipeGenerationProviderError("VALIDATION_ERROR", "Recipe generation currently supports en-IN.");
  }
  const maximumActiveMinutes = boundedInteger(value.maximumActiveMinutes ?? 45, 5, 180, "Maximum active minutes");
  const servings = boundedInteger(value.servings ?? 2, 1, 12, "Servings");
  return {
    cuisine,
    dietType,
    mealSlot,
    localeIdentifier,
    maximumActiveMinutes,
    servings,
    avoidIngredients: boundedStringArray(value.avoidIngredients ?? [], 30, 80, "Avoided ingredients"),
    requiredIngredients: boundedStringArray(value.requiredIngredients ?? [], 12, 80, "Required ingredients"),
    equipment: boundedStringArray(value.equipment ?? [], 12, 80, "Equipment"),
    notes: value.notes ? boundedText(value.notes, 1, 500, "Notes") : "",
  };
}

export function calculateNutritionPerServing(ingredients, servings) {
  const total = ingredients.reduce((sum, ingredient) => {
    const scale = ingredient.grams / 100;
    for (const field of nutritionFields) sum[field] += ingredient.nutritionPer100Grams[field] * scale;
    return sum;
  }, Object.fromEntries(nutritionFields.map((field) => [field, 0])));
  return Object.fromEntries(nutritionFields.map((field) => [field, rounded(total[field] / servings)]));
}

function validateRecipeProposal(proposal) {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) invalidProvider();
  proposal.displayName = boundedText(proposal.displayName, 3, 120, "Recipe name", true);
  proposal.description = boundedText(proposal.description, 10, 500, "Description", true);
  proposal.cuisine = boundedText(proposal.cuisine, 2, 80, "Cuisine", true);
  if (!["vegan", "vegetarian", "eggetarian", "nonVegetarian"].includes(proposal.dietType)) invalidProvider();
  proposal.servings = boundedInteger(proposal.servings, 1, 12, "Servings", true);
  proposal.servingSizeGrams = boundedNumber(proposal.servingSizeGrams, 20, 2_000, true);
  proposal.activePreparationMinutes = boundedInteger(proposal.activePreparationMinutes, 0, 240, "Active time", true);
  proposal.totalMinutes = boundedInteger(proposal.totalMinutes, proposal.activePreparationMinutes, 1_440, "Total time", true);
  proposal.eligibleSlots = boundedEnumArray(proposal.eligibleSlots, ["breakfast", "lunch", "dinner", "snack"], 4);
  proposal.equipment = boundedStringArray(proposal.equipment, 12, 80, "Equipment", true);
  if (!["low", "medium", "high"].includes(proposal.costBand)) invalidProvider();
  if (!Array.isArray(proposal.ingredients) || proposal.ingredients.length < 2 || proposal.ingredients.length > 30) invalidProvider();
  proposal.ingredients = proposal.ingredients.map((ingredient) => validateIngredientProposal(ingredient));
  if (!Array.isArray(proposal.methodSteps) || proposal.methodSteps.length < 1 || proposal.methodSteps.length > 20) invalidProvider();
  proposal.methodSteps = proposal.methodSteps.map((step) => boundedText(step, 3, 500, "Method step", true));
  proposal.tags = boundedStringArray(proposal.tags, 20, 80, "Tags", true);
  proposal.dominantIngredientNames = boundedStringArray(proposal.dominantIngredientNames, 5, 100, "Dominant ingredients", true);
  proposal.minimumServingMultiplier = boundedNumber(proposal.minimumServingMultiplier, 0.25, 1, true);
  proposal.maximumServingMultiplier = boundedNumber(proposal.maximumServingMultiplier, 1, 4, true);
  return proposal;
}

function validateIngredientProposal(ingredient) {
  if (!ingredient || typeof ingredient !== "object" || Array.isArray(ingredient)) invalidProvider();
  ingredient.canonicalName = boundedText(ingredient.canonicalName, 1, 100, "Ingredient", true);
  ingredient.category = boundedText(ingredient.category, 1, 60, "Category", true);
  ingredient.householdQuantity = boundedNumber(ingredient.householdQuantity, 0.01, 100, true);
  ingredient.householdUnit = boundedText(ingredient.householdUnit, 1, 40, "Household unit", true);
  ingredient.grams = boundedNumber(ingredient.grams, 0.1, 5_000, true);
  ingredient.compatibleDiets = boundedEnumArray(
    ingredient.compatibleDiets,
    ["vegan", "vegetarian", "eggetarian", "nonVegetarian"],
    4,
  );
  ingredient.proposedAllergenIDs = boundedStringArray(ingredient.proposedAllergenIDs, 20, 60, "Allergens", true);
  const nutrition = ingredient.nutritionPer100Grams;
  if (!nutrition || typeof nutrition !== "object" || Array.isArray(nutrition)) invalidProvider();
  for (const field of nutritionFields) {
    const maximum = field === "calories" ? 1_000 : 100;
    nutrition[field] = boundedNumber(nutrition[field], 0, maximum, true);
  }
  return ingredient;
}

function responseOutputText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) return response.output_text;
  for (const item of response?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content?.type === "refusal") {
        throw new RecipeGenerationProviderError("PROVIDER_REJECTED", "The generation request was not accepted.");
      }
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  throw new RecipeGenerationProviderError("PROVIDER_RESPONSE_INVALID", "The generation provider returned no structured recipe.");
}

function recipeSystemPrompt() {
  return [
    "Create one original, practical home-cooked recipe for the supplied brief.",
    "Do not reproduce or imitate a named chef, restaurant, cookbook, website, or branded product.",
    "Use ingredients commonly purchasable in India and express every ingredient in grams plus one household unit.",
    "Return plausible per-100g nutrition estimates for each ingredient; these are estimates for later review, not verified facts.",
    "Make diet compatibility conservative. Proposed allergens are review hints only.",
    "Do not include medical claims, weight-loss promises, people, logos, packaging, or written text in the image description.",
    "Ensure total time is at least active preparation time and the method is complete.",
  ].join(" ");
}

function imagePrompt(proposal) {
  return [
    "Original editorial food photograph for the Nourish meal-planning app.",
    `${proposal.displayName}, ${proposal.cuisine} cuisine.`,
    `Show the finished dish accurately using these visible ingredients: ${proposal.ingredients.slice(0, 12).map((item) => item.canonicalName).join(", ")}.`,
    "Natural appetizing plating, realistic home-cooked texture, soft daylight, warm neutral background, three-quarter camera angle.",
    "No people, hands, text, logos, labels, packaging, restaurant branding, watermarks, or decorative ingredients absent from the recipe.",
    "Landscape composition with safe central crop space for mobile cards. Photorealistic, not illustration.",
  ].join(" ");
}

function recipeSchema() {
  const stringArray = { type: "array", items: { type: "string" } };
  const nutrition = {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(nutritionFields.map((field) => [field, { type: "number" }])),
    required: nutritionFields,
  };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      displayName: { type: "string" },
      description: { type: "string" },
      cuisine: { type: "string" },
      dietType: { type: "string", enum: ["vegan", "vegetarian", "eggetarian", "nonVegetarian"] },
      servings: { type: "integer" },
      servingSizeGrams: { type: "number" },
      activePreparationMinutes: { type: "integer" },
      totalMinutes: { type: "integer" },
      eligibleSlots: { type: "array", items: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] } },
      equipment: stringArray,
      costBand: { type: "string", enum: ["low", "medium", "high"] },
      ingredients: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            canonicalName: { type: "string" },
            category: { type: "string" },
            householdQuantity: { type: "number" },
            householdUnit: { type: "string" },
            grams: { type: "number" },
            compatibleDiets: {
              type: "array",
              items: { type: "string", enum: ["vegan", "vegetarian", "eggetarian", "nonVegetarian"] },
            },
            proposedAllergenIDs: stringArray,
            nutritionPer100Grams: nutrition,
          },
          required: [
            "canonicalName", "category", "householdQuantity", "householdUnit", "grams",
            "compatibleDiets", "proposedAllergenIDs", "nutritionPer100Grams",
          ],
        },
      },
      methodSteps: stringArray,
      tags: stringArray,
      dominantIngredientNames: stringArray,
      minimumServingMultiplier: { type: "number" },
      maximumServingMultiplier: { type: "number" },
    },
    required: [
      "displayName", "description", "cuisine", "dietType", "servings", "servingSizeGrams",
      "activePreparationMinutes", "totalMinutes", "eligibleSlots", "equipment", "costBand",
      "ingredients", "methodSteps", "tags", "dominantIngredientNames",
      "minimumServingMultiplier", "maximumServingMultiplier",
    ],
  };
}

const nutritionFields = ["calories", "proteinGrams", "carbohydrateGrams", "fatGrams", "fibreGrams"];

function boundedText(value, minimum, maximum, label, provider = false) {
  const normalized = String(value ?? "").trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    if (provider) invalidProvider();
    throw new RecipeGenerationProviderError("VALIDATION_ERROR", `${label} must contain ${minimum} to ${maximum} characters.`);
  }
  return normalized;
}

function boundedStringArray(value, maximumItems, maximumLength, label, provider = false) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    if (provider) invalidProvider();
    throw new RecipeGenerationProviderError("VALIDATION_ERROR", `${label} contains too many values.`);
  }
  return [...new Set(value.map((item) => boundedText(item, 1, maximumLength, label, provider)))];
}

function boundedEnumArray(value, allowed, maximumItems) {
  if (!Array.isArray(value) || !value.length || value.length > maximumItems || value.some((item) => !allowed.includes(item))) invalidProvider();
  return [...new Set(value)];
}

function boundedInteger(value, minimum, maximum, label, provider = false) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    if (provider) invalidProvider();
    throw new RecipeGenerationProviderError("VALIDATION_ERROR", `${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function boundedNumber(value, minimum, maximum, provider = false) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    if (provider) invalidProvider();
    throw new RecipeGenerationProviderError("VALIDATION_ERROR", "The generated recipe contains an invalid number.");
  }
  return number;
}

function boundedIdentifier(value) {
  return typeof value === "string" && value.length <= 200 ? value : null;
}

function strictBase64(value) {
  if (typeof value !== "string" || !value.length || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  return Buffer.from(value, "base64").toString("base64") === value;
}

function rounded(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function invalidProvider() {
  throw new RecipeGenerationProviderError("PROVIDER_RESPONSE_INVALID", "The generated recipe failed validation.");
}
