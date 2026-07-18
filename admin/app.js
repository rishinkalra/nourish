const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  apiBase: "http://127.0.0.1:8080",
  adminID: "",
  adminKey: "",
  demo: false,
  items: [],
  audit: [],
  ingredients: [],
  nutrientRecords: [],
  planRuns: [],
  subscriptions: [],
  analytics: null,
  cohorts: null,
  supportUser: null,
  flags: [],
  flagAudit: [],
  flagsLoaded: false,
  selectedFlagKey: null,
  exports: [],
  exportsLoaded: false,
  pendingExportID: null,
  selectedID: null,
  selectedPlanRunID: null,
  selectedSubscriptionUserID: null,
  pendingSubscriptionUserID: null,
};

const demoItems = [
  {
    id: "palak-paneer-v3", recipeID: "palak-paneer", version: 3, workflowState: "inReview",
    authoredBy: "ananya.k", createdAt: "2026-07-14T07:30:00.000Z", submittedAt: "2026-07-15T06:15:00.000Z",
    recipeMetadata: { cuisine: "North Indian", eligibleSlots: ["lunch", "dinner"], activePreparationMinutes: 24, totalMinutes: 38, costBand: "medium" },
    validationIssues: [],
    content: {
      displayName: "Palak paneer plate", servings: 2, servingSizeGrams: 420, minimumServingMultiplier: 0.75, maximumServingMultiplier: 1.25, dietType: "vegetarian",
      nutritionPerServing: { calories: 618, proteinGrams: 31.8, carbohydrateGrams: 64.2, fatGrams: 26.1, fibreGrams: 9.4 },
      ingredients: [
        { ingredientID: "spinach", householdQuantity: 4, householdUnit: "cups", grams: 240 },
        { ingredientID: "paneer", householdQuantity: 1.5, householdUnit: "cups", grams: 240 },
        { ingredientID: "basmati-rice", householdQuantity: 1, householdUnit: "cup cooked", grams: 180 },
        { ingredientID: "tomato", householdQuantity: 2, householdUnit: "medium", grams: 220 },
      ],
      methodSteps: ["Wash and blanch the spinach, then cool promptly.", "Blend spinach with the cooked tomato masala.", "Fold in paneer and simmer gently for six minutes.", "Serve with measured cooked basmati rice."],
      nutrientRecordIDs: ["nutrient-spinach-v2", "nutrient-paneer-v3", "nutrient-rice-v1"],
      nutritionCalculationVersion: "weighted-grams-v2", declaredAllergenIDs: ["milk"], tags: ["weeknight", "batch-friendly"],
    },
    nutrientEvidence: [
      { id: "nutrient-spinach-v2", ingredientID: "spinach", confidence: "high", reviewedBy: "nutrition.rhea", reviewedAt: "2026-07-12T09:00:00Z", source: { provider: "Licensed India Food Data", dataset: "Raw produce", datasetVersion: "2026.2", licenseStatus: "approvedForProduction", sourceRecordID: "spinach-raw-104" } },
      { id: "nutrient-paneer-v3", ingredientID: "paneer", confidence: "high", reviewedBy: "nutrition.rhea", reviewedAt: "2026-07-12T09:14:00Z", source: { provider: "Licensed India Food Data", dataset: "Dairy products", datasetVersion: "2026.2", licenseStatus: "approvedForProduction", sourceRecordID: "paneer-fullfat-210" } },
      { id: "nutrient-rice-v1", ingredientID: "basmati-rice", confidence: "medium", reviewedBy: "nutrition.dev", reviewedAt: "2026-06-28T11:00:00Z", source: { provider: "Licensed India Food Data", dataset: "Cooked staples", datasetVersion: "2026.1", licenseStatus: "approvedForProduction", sourceRecordID: "rice-basmati-cooked-022" } },
    ],
  },
  {
    id: "ragi-dosa-v2", recipeID: "ragi-dosa", version: 2, workflowState: "inReview",
    authoredBy: "meera.s", createdAt: "2026-07-13T10:40:00.000Z", submittedAt: "2026-07-14T12:10:00.000Z",
    recipeMetadata: { cuisine: "South Indian", eligibleSlots: ["breakfast", "dinner"], activePreparationMinutes: 18, totalMinutes: 28, costBand: "value" },
    validationIssues: ["MISSING_NUTRIENT_RECORD:coconut-chutney"],
    content: {
      displayName: "Ragi dosa with coconut chutney", servings: 2, servingSizeGrams: 310, dietType: "vegan",
      nutritionPerServing: { calories: 442, proteinGrams: 11.6, carbohydrateGrams: 67.8, fatGrams: 14.2, fibreGrams: 8.1 },
      ingredients: [{ ingredientID: "ragi-flour", householdQuantity: 1, householdUnit: "cup", grams: 120 }, { ingredientID: "coconut-chutney", householdQuantity: .5, householdUnit: "cup", grams: 90 }],
      methodSteps: ["Whisk ragi flour into a thin, pourable batter.", "Cook two thin dosas on a hot seasoned pan.", "Serve with measured coconut chutney."],
      nutrientRecordIDs: ["nutrient-ragi-v1"], nutritionCalculationVersion: "weighted-grams-v2", declaredAllergenIDs: [], tags: ["breakfast", "quick"],
    },
    nutrientEvidence: [{ id: "nutrient-ragi-v1", ingredientID: "ragi-flour", confidence: "high", reviewedBy: "nutrition.rhea", reviewedAt: "2026-07-10T08:00:00Z", source: { provider: "Licensed India Food Data", dataset: "Millets", datasetVersion: "2026.1", licenseStatus: "approvedForProduction", sourceRecordID: "ragi-flour-010" } }],
  },
  {
    id: "chana-salad-v1", recipeID: "chana-salad", version: 1, workflowState: "draft",
    authoredBy: "kabir.m", createdAt: "2026-07-15T07:05:00.000Z", submittedAt: null,
    recipeMetadata: { cuisine: "Indian", eligibleSlots: ["lunch"], activePreparationMinutes: 12, totalMinutes: 15, costBand: "value" },
    validationIssues: ["MISSING_METHOD"],
    content: { displayName: "Lemony chana salad", servings: 1, servingSizeGrams: 350, dietType: "vegan", nutritionPerServing: { calories: 390, proteinGrams: 17, carbohydrateGrams: 59, fatGrams: 9, fibreGrams: 14 }, ingredients: [{ ingredientID: "chickpeas", householdQuantity: 1.25, householdUnit: "cups cooked", grams: 205 }], methodSteps: [], nutrientRecordIDs: ["nutrient-chickpea-v2"], nutritionCalculationVersion: "weighted-grams-v2", declaredAllergenIDs: [], tags: ["no-cook"] },
    nutrientEvidence: [{ id: "nutrient-chickpea-v2", ingredientID: "chickpeas", confidence: "high", reviewedBy: "nutrition.rhea", reviewedAt: "2026-07-09T08:00:00Z", source: { provider: "Licensed India Food Data", dataset: "Cooked pulses", datasetVersion: "2026.2", licenseStatus: "approvedForProduction", sourceRecordID: "chickpeas-cooked-014" } }],
  },
  {
    id: "avial-v4", recipeID: "avial", version: 4, workflowState: "rejected", authoredBy: "meera.s",
    createdAt: "2026-07-11T09:00:00.000Z", submittedAt: "2026-07-12T06:00:00.000Z", rejectionReason: "Declared allergens do not include milk from the yoghurt ingredient.",
    recipeMetadata: { cuisine: "Kerala", eligibleSlots: ["lunch", "dinner"], activePreparationMinutes: 25, totalMinutes: 42, costBand: "medium" },
    validationIssues: ["ALLERGEN_DECLARATION_MISMATCH"],
    content: { displayName: "Kerala vegetable avial", servings: 3, servingSizeGrams: 380, dietType: "vegetarian", nutritionPerServing: { calories: 410, proteinGrams: 13, carbohydrateGrams: 44, fatGrams: 22, fibreGrams: 12 }, ingredients: [{ ingredientID: "mixed-vegetables", householdQuantity: 4, householdUnit: "cups", grams: 600 }, { ingredientID: "yoghurt", householdQuantity: 1, householdUnit: "cup", grams: 240 }], methodSteps: ["Cook the vegetables until just tender.", "Fold in coconut paste and yoghurt off the heat."], nutrientRecordIDs: ["nutrient-veg-v1", "nutrient-yoghurt-v2"], nutritionCalculationVersion: "weighted-grams-v2", declaredAllergenIDs: [], tags: ["traditional"] },
    nutrientEvidence: [],
  },
];

const demoAudit = [
  { action: "recipe_version.submitted", actorID: "ananya.k", entityType: "recipe_version", entityID: "palak-paneer-v3", occurredAt: "2026-07-15T06:15:00Z" },
  { action: "nutrient_record.reviewed", actorID: "nutrition.rhea", entityType: "nutrient_record", entityID: "nutrient-paneer-v3", occurredAt: "2026-07-12T09:14:00Z" },
  { action: "recipe_version.rejected", actorID: "reviewer.dev", entityType: "recipe_version", entityID: "avial-v4", reason: "Allergen declaration mismatch", occurredAt: "2026-07-12T06:30:00Z" },
  { action: "ingredient.verified", actorID: "content.ops", entityType: "ingredient", entityID: "spinach", occurredAt: "2026-07-10T07:20:00Z" },
];

const demoPlanRuns = [
  {
    id: "a4f03410-313a-4b13-9a52-90e37ce11201", userID: "d9bf8f61-4dc7-4203-b6b5-19db9059ce01",
    state: "succeeded", planID: "2dc92968-632d-47d6-a099-8e0c7a128f01", correlationID: "d15d1a91-f43c-49ea-8674-5d7229ad7101",
    request: { weekStart: "2026-07-20", timeZoneIdentifier: "Asia/Kolkata", trigger: "weekly_review", regenerationReason: "More quick dinners", profileRevision: 8, lockedPlanItemCount: 2, includeOptionalSnack: false },
    versions: { generator: "whole-week-serving-planner-v2", scoring: "wellness-score-v3", rules: "eligibility-rules-v1" },
    deterministicSeedSHA256: "61de958bcb7cce445803b70cc5f944001fb7f37cc24c92fa00bb4c6d30cb11a4",
    diagnostics: { candidatePoolSize: 34, eligibleCandidateCountBySlot: { breakfast: 18, lunch: 26, dinner: 24 }, rejectedCandidateCounts: { allergenConflict: 7, dietMismatch: 18, activeTimeExceeded: 11, mealSlotMismatch: 29 }, selectedRecipeCount: 12, meanAbsoluteDailyCalorieDeviation: 42.4, totalIngredientReusePenalty: -84, ingredientReusePercentage: 72, activeCookingMinutesByDay: { "2026-07-20": 75, "2026-07-21": 0, "2026-07-22": 68, "2026-07-23": 0, "2026-07-24": 71, "2026-07-25": 66, "2026-07-26": 0 }, cookingSessionCount: 12, estimatedWasteGrams: null, estimatedWasteCoveragePercentage: 0, toleranceEvaluation: { contractVersion: "planner-tolerance-v1", dailyCalorieTolerancePercent: 5, weeklyCalorieTolerancePercent: 3, optionalProteinTolerancePercent: 10, dailyCaloriesWithinToleranceCount: 7, weeklyCaloriesWithinTolerance: true, weeklyCalorieExcess: 0, weeklyCalorieAbsoluteDeviationPercent: 1.2, optionalProteinOutsideToleranceDayCount: 0, relaxations: [], optimizationPasses: 2 }, variety: { passed: true, accidentalExactRepeats: 0, intentionalLeftovers: 9, dominantIngredientViolations: 0, recentRecipeCount: 1 }, explanationCounts: { plannedLeftover: 9, batchOpportunity: 12, cuisinePreference: 8, servingAdjusted: 11, lockedByUser: 2 } },
    error: null, retry: { jobID: "f6b71f43-4902-498d-9d3d-6ff7643a0101", state: "succeeded", attemptCount: 1, maxAttempts: 8, workerID: null, lastErrorCode: null, lastErrorMessage: null, completedAt: "2026-07-15T06:42:03Z" },
    createdAt: "2026-07-15T06:42:01Z", startedAt: "2026-07-15T06:42:01Z", completedAt: "2026-07-15T06:42:03Z", durationMilliseconds: 2180,
  },
  {
    id: "a4f03410-313a-4b13-9a52-90e37ce11202", userID: "6bc7ae73-56ce-42e2-9dd7-acde44a1ce02",
    state: "rejected", planID: null, correlationID: "d15d1a91-f43c-49ea-8674-5d7229ad7102",
    request: { weekStart: "2026-07-20", timeZoneIdentifier: "Asia/Kolkata", trigger: "initial", regenerationReason: null, profileRevision: 2, lockedPlanItemCount: 0, includeOptionalSnack: true },
    versions: { generator: "whole-week-serving-planner-v2", scoring: "wellness-score-v3", rules: "eligibility-rules-v1" },
    deterministicSeedSHA256: "39127583bac48efcd46728db0a02a47ac528643f3f1eac972331f3263f62a1e2",
    diagnostics: { candidatePoolSize: 2, eligibleCandidateCountBySlot: { breakfast: 0, lunch: 2, dinner: 1, snack: 0 }, rejectedCandidateCounts: { allergenConflict: 14, ingredientExclusion: 8, dietMismatch: 23, mealSlotMismatch: 41 }, selectedRecipeCount: 0, meanAbsoluteDailyCalorieDeviation: 0, variety: null, explanationCounts: {} },
    error: { code: "NO_FEASIBLE_PLAN", message: "No safe varied week could be assembled from the eligible candidates.", retryable: false },
    retry: { jobID: "f6b71f43-4902-498d-9d3d-6ff7643a0102", state: "succeeded", attemptCount: 1, maxAttempts: 8, workerID: null, lastErrorCode: null, lastErrorMessage: null, completedAt: "2026-07-15T05:18:04Z" },
    createdAt: "2026-07-15T05:18:03Z", startedAt: "2026-07-15T05:18:03Z", completedAt: "2026-07-15T05:18:04Z", durationMilliseconds: 690,
  },
  {
    id: "a4f03410-313a-4b13-9a52-90e37ce11203", userID: "8cb52cea-ef26-42b9-9d52-f1182dfdce03",
    state: "generating", planID: null, correlationID: "d15d1a91-f43c-49ea-8674-5d7229ad7103",
    request: { weekStart: "2026-07-27", timeZoneIdentifier: "Asia/Kolkata", trigger: "manual_regeneration", regenerationReason: "Travel week", profileRevision: 11, lockedPlanItemCount: 4, includeOptionalSnack: false },
    versions: { generator: "whole-week-serving-planner-v2", scoring: "wellness-score-v3", rules: "eligibility-rules-v1" },
    deterministicSeedSHA256: "c86399d8fe2131ae0cd10e8c6685b30aa2fe9f41bcbdbe532e4c46a9f2c93d23",
    diagnostics: null, error: null,
    retry: { jobID: "f6b71f43-4902-498d-9d3d-6ff7643a0103", state: "running", attemptCount: 2, maxAttempts: 8, workerID: "planner-worker-2", lastErrorCode: "CATALOGUE_REFRESH", lastErrorMessage: "Published catalogue changed before materialization.", lockedUntil: "2026-07-15T08:36:00Z", completedAt: null },
    createdAt: "2026-07-15T08:29:58Z", startedAt: "2026-07-15T08:30:01Z", completedAt: null, durationMilliseconds: null,
  },
  {
    id: "a4f03410-313a-4b13-9a52-90e37ce11204", userID: "f24cfc52-acde-439b-aebf-5ecf80d9ce04",
    state: "failed", planID: null, correlationID: "d15d1a91-f43c-49ea-8674-5d7229ad7104",
    request: { weekStart: "2026-07-20", timeZoneIdentifier: "Asia/Kolkata", trigger: "initial", regenerationReason: null, profileRevision: 3, lockedPlanItemCount: 0, includeOptionalSnack: false },
    versions: { generator: "whole-week-serving-planner-v2", scoring: "wellness-score-v3", rules: "eligibility-rules-v1" },
    deterministicSeedSHA256: "1c8846c7646c611defb0dad72f73917c56fcb03a6c85c60d2a62226ea63a8fd8",
    diagnostics: null, error: { code: "TEMPORARY_FAILURE", message: "Generation stopped after an operational failure.", retryable: false },
    retry: { jobID: "f6b71f43-4902-498d-9d3d-6ff7643a0104", state: "dead", attemptCount: 8, maxAttempts: 8, workerID: null, lastErrorCode: "DATABASE_TIMEOUT", lastErrorMessage: "Database transaction timed out.", completedAt: "2026-07-15T04:10:00Z" },
    createdAt: "2026-07-15T03:32:00Z", startedAt: "2026-07-15T03:32:02Z", completedAt: "2026-07-15T04:10:00Z", durationMilliseconds: 2278000,
  },
];

const demoSubscriptions = [
  {
    userID: "7f2311c2-a0ad-45d0-a4f9-70bfc9270a11", state: "active", hasAccess: true,
    productID: "nourish.monthly", environment: "production", periodEndsAt: "2026-08-11T18:30:00Z", willAutoRenew: true,
    verificationStatus: "verified", updatedAt: "2026-07-15T08:54:00Z",
    identity: { originalTransactionReference: "…823761 · 40e19811f68d", appAccountTokenSHA256: "73d4c8d74b61633c7c51d60da9fb19dc1ab8275152c5b3996605bfa468d04dde", sourceEventReference: "…af4412 · d288d6f24a11" },
    reconciliation: { status: "mismatch", attemptCount: 2, errorCode: "APPLE_APP_ACCOUNT_TOKEN_MISMATCH", lastVerifiedAt: "2026-07-14T09:00:00Z", lastReconciledAt: "2026-07-15T08:54:00Z", nextReconciliationAt: "2026-07-16T08:54:00Z" },
    latestJob: { id: "3a76e16b-62c2-4e47-a652-18e809874011", state: "succeeded", attemptCount: 2, maxAttempts: 8, completedAt: "2026-07-15T08:54:00Z" },
    timeline: [
      { id: "mismatch-job", kind: "reconciliation_job", source: "Nourish worker", at: "2026-07-15T08:54:00Z", title: "Reconciliation Succeeded", outcome: "succeeded", detail: "Apple response verified; bound account token did not match", reference: "…874011 · 5c7f32f22410" },
      { id: "mismatch-apple", kind: "apple_event", source: "Apple verified event", at: "2026-07-15T08:53:58Z", title: "Status Response", outcome: "verified", detail: "Production transaction identity verified", reference: "…823761 · 40e19811f68d", payloadSHA256Prefix: "dc60ef75a08b" },
      { id: "mismatch-prior", kind: "server_entitlement", source: "Nourish", at: "2026-07-14T09:00:00Z", title: "Verified Entitlement Applied", outcome: "succeeded", detail: "Active · access retained", reference: "…af4412 · d288d6f24a11" },
    ],
  },
  {
    userID: "27580171-6ad4-4ab4-901f-cc4189430a22", state: "trial", hasAccess: true,
    productID: "nourish.annual", environment: "sandbox", periodEndsAt: "2026-07-22T18:30:00Z", willAutoRenew: true,
    verificationStatus: "verified", updatedAt: "2026-07-15T08:31:00Z",
    identity: { originalTransactionReference: "…557902 · 9dc2f150893b", appAccountTokenSHA256: "2f83ac23e633171c19328c4fd73d47305280096c2844d1cb9c54b01ba1802a08", sourceEventReference: "…4f1038 · 9e1800e5c952" },
    reconciliation: { status: "delayed", attemptCount: 3, errorCode: "APPLE_5000001", lastVerifiedAt: "2026-07-14T03:20:00Z", lastReconciledAt: "2026-07-15T08:31:00Z", nextReconciliationAt: "2026-07-15T09:01:00Z" },
    latestJob: { id: "8a0094b6-2a40-4827-b126-04db10a36022", state: "queued", attemptCount: 3, maxAttempts: 8, availableAt: "2026-07-15T09:01:00Z", errorCode: "APPLE_5000001", errorMessage: "Apple subscription status is temporarily unavailable." },
    timeline: [
      { id: "delayed-job", kind: "reconciliation_job", source: "Nourish worker", at: "2026-07-15T08:31:00Z", title: "Reconciliation Queued", outcome: "queued", detail: "APPLE_5000001 · attempt 3/8", reference: "…a36022 · e50820b1672f" },
      { id: "delayed-notification", kind: "apple_notification", source: "App Store notification", at: "2026-07-14T03:20:00Z", title: "Subscribed", outcome: "applied", detail: "Sandbox notification", reference: "…557902 · 9dc2f150893b", payloadSHA256Prefix: "aad3efb2d9f4" },
    ],
  },
  {
    userID: "c40505f6-7480-47fb-8a1d-09bb73f70a33", state: "expired", hasAccess: false,
    productID: "nourish.monthly", environment: "production", periodEndsAt: "2026-07-14T18:30:00Z", willAutoRenew: false,
    verificationStatus: "verified", updatedAt: "2026-07-15T07:12:00Z",
    identity: { originalTransactionReference: "…204381 · b5bd9d770913", appAccountTokenSHA256: "eb18b86012e270701b7f43372b184102f56d9868d8ca394c99826c80d3e03bd", sourceEventReference: "…a8d502 · 39832c485e90" },
    reconciliation: { status: "pending", attemptCount: 0, errorCode: null, lastVerifiedAt: "2026-07-14T18:31:00Z", lastReconciledAt: "2026-07-14T18:31:00Z", nextReconciliationAt: "2026-07-15T07:12:00Z" },
    latestJob: { id: "58a2aef2-3ff5-4ce5-8f5a-01f2f8bd7033", state: "running", attemptCount: 1, maxAttempts: 8, workerID: "entitlement-worker-1", lockedUntil: "2026-07-15T07:17:00Z" },
    timeline: [{ id: "pending-job", kind: "reconciliation_job", source: "Nourish worker", at: "2026-07-15T07:12:00Z", title: "Reconciliation Running", outcome: "running", detail: "Attempt 1/8", reference: "…bd7033 · 1f55da07aa3c" }],
  },
  {
    userID: "622c99df-789d-4350-8cde-bc63186e0a44", state: "active", hasAccess: true,
    productID: "nourish.annual", environment: "production", periodEndsAt: "2027-05-04T18:30:00Z", willAutoRenew: true,
    verificationStatus: "verified", updatedAt: "2026-07-15T06:02:00Z",
    identity: { originalTransactionReference: "…990041 · 87a98e803825", appAccountTokenSHA256: "4aed0e320fa7f740ce3d6275a399a2a2905e08f1d648315ba8dd2b28c450d205", sourceEventReference: "…d01370 · 37a774fce7fb" },
    reconciliation: { status: "current", attemptCount: 0, errorCode: null, lastVerifiedAt: "2026-07-15T06:02:00Z", lastReconciledAt: "2026-07-15T06:02:00Z", nextReconciliationAt: "2026-07-15T12:02:00Z" },
    latestJob: { id: "4c2893db-f0b9-40bf-a861-1c4464f8e044", state: "succeeded", attemptCount: 1, maxAttempts: 8, completedAt: "2026-07-15T06:02:00Z" },
    timeline: [{ id: "current-apple", kind: "apple_event", source: "Apple verified event", at: "2026-07-15T06:02:00Z", title: "Did Renew", outcome: "applied", detail: "Production event processed by Nourish", reference: "…990041 · 87a98e803825", payloadSHA256Prefix: "a8809cbf389f" }],
  },
];

const demoAnalytics = {
  filters: { startDate: "2026-06-16", endDate: "2026-07-14", timeZone: "Asia/Kolkata", subscriptionState: "all", appVersion: "all", acquisitionSource: "all", dietType: "all", cohort: "all", cohortBy: "registration_week" },
  freshnessAt: "2026-07-15T09:30:00Z",
  metrics: [
    { id: "registered_users", label: "New accounts", format: "integer", value: 1842, numerator: 1842, denominator: null, formula: "Count of non-disabled internal users created inside the selected local-date window." },
    { id: "onboarding_completion_rate", label: "Onboarding completion", format: "percentage", value: .782, numerator: 1440, denominator: 1842, formula: "Distinct users whose first saved profile falls inside the window ÷ accounts created inside the window." },
    { id: "plan_generation_success_rate", label: "Plan success", format: "percentage", value: .914, numerator: 1268, denominator: 1387, formula: "Succeeded plan jobs created inside the window ÷ terminal succeeded, rejected, or failed plan jobs created inside the window." },
    { id: "plan_adoption_rate", label: "Plan adoption", format: "percentage", value: .681, numerator: 804, denominator: 1180, formula: "Distinct users adopting a plan inside the window ÷ distinct users with a succeeded plan job inside the window." },
    { id: "weekly_review_rate", label: "Weekly review", format: "percentage", value: .536, numerator: 431, denominator: 804, formula: "Distinct users submitting a weekly review inside the window ÷ distinct users adopting a plan inside the window." },
    { id: "meal_completion_rate", label: "Meal completion", format: "percentage", value: .742, numerator: 9840, denominator: 13261, formula: "Meal states marked completed inside the window ÷ completed, skipped, or replaced-outside-app states updated inside the window." },
    { id: "verified_access_users", label: "Verified access now", format: "integer", value: 692, numerator: 692, denominator: null, formula: "Count of filtered users whose latest server-owned subscription snapshot is in an access-granting state at dashboard freshness time; the date window does not change this snapshot metric." },
  ],
  privacy: { aggregationOnly: true, minimumCohortSize: 5, populationSize: 4821, suppressed: false, identifiableFieldsReturned: [] },
};

const demoCohorts = {
  filters: structuredClone(demoAnalytics.filters), freshnessAt: demoAnalytics.freshnessAt, cohortDimension: "registration_week",
  funnel: [
    { id: "registered", label: "Registered", count: 1842, conversionFromPrevious: 1, formula: "Distinct cohort users at the selected cohort-start milestone." },
    { id: "onboarded", label: "Profile saved", count: 1440, conversionFromPrevious: .782, formula: "Cohort users with at least one saved profile by the selected end date." },
    { id: "generated", label: "Plan generated", count: 1180, conversionFromPrevious: .819, formula: "Cohort users with at least one succeeded plan job by the selected end date." },
    { id: "adopted", label: "Plan adopted", count: 804, conversionFromPrevious: .681, formula: "Cohort users with at least one plan adoption by the selected end date." },
    { id: "reviewed", label: "Weekly review", count: 431, conversionFromPrevious: .536, formula: "Cohort users with at least one weekly plan review by the selected end date." },
  ],
  rows: [
    { cohortStart: "2026-06-16", registeredUsers: 394, onboardedUsers: 318, generatedUsers: 272, adoptedUsers: 194, reviewedUsers: 112, onboardingRate: .807, generationRate: .690, adoptionRate: .713, reviewRate: .577 },
    { cohortStart: "2026-06-23", registeredUsers: 438, onboardedUsers: 351, generatedUsers: 291, adoptedUsers: 203, reviewedUsers: 116, onboardingRate: .801, generationRate: .664, adoptionRate: .698, reviewRate: .571 },
    { cohortStart: "2026-06-30", registeredUsers: 472, onboardedUsers: 366, generatedUsers: 301, adoptedUsers: 207, reviewedUsers: 111, onboardingRate: .775, generationRate: .638, adoptionRate: .688, reviewRate: .536 },
    { cohortStart: "2026-07-07", registeredUsers: 538, onboardedUsers: 405, generatedUsers: 316, adoptedUsers: 200, reviewedUsers: 92, onboardingRate: .753, generationRate: .587, adoptionRate: .633, reviewRate: .460 },
  ],
  tableColumns: [{ id: "cohortStart", label: "Cohort week" }, { id: "registeredUsers", label: "Registered" }, { id: "onboardedUsers", label: "Profile saved" }, { id: "generatedUsers", label: "Plan generated" }, { id: "adoptedUsers", label: "Plan adopted" }, { id: "reviewedUsers", label: "Weekly review" }],
  privacy: { aggregationOnly: true, minimumCohortSize: 5, populationSize: 1842, suppressed: false, identifiableFieldsReturned: [] },
};

const demoSupportUser = {
  identity: { userID: "34d81cbb-5f9f-4d84-b1dc-8d991768949c", verifiedEmail: "aanya@example.test", createdAt: "2026-05-18T07:30:00Z", status: "active" },
  account: { onboardingStatus: "complete", profileRevision: 4, profileUpdatedAt: "2026-07-12T05:20:00Z", activeSessionCount: 1 },
  subscription: { state: "active", hasAccess: true, productID: "nourish.annual", periodEndsAt: "2027-05-18T07:30:00Z", reconciliationStatus: "current", lastVerifiedAt: "2026-07-15T08:30:00Z" },
  planning: { latestJobID: "d08cb9bb-f2aa-4c99-b7a9-b2f3d532c218", latestJobState: "succeeded", latestJobCreatedAt: "2026-07-14T04:45:00Z", latestJobCompletedAt: "2026-07-14T04:45:42Z", adoptedPlanCount: 7, latestAdoptionAt: "2026-07-14T05:02:00Z", latestWeeklyReviewAt: "2026-07-13T17:20:00Z" },
  privacyRequests: { latestExport: { status: "ready", requestedAt: "2026-06-28T08:10:00Z" }, latestDeletion: null },
  accessReceipt: { id: "01a78285-bfca-46d6-8a82-848fcaa19db2", reason: "Demo account access review.", outcome: "found", correlationID: "demo-support-lookup", occurredAt: "2026-07-15T09:42:00Z" },
  supportBoundary: { readOnly: true, impersonationAvailable: false, exactMatchOnly: true, rawProfileAnswersReturned: false, tokensReturned: false, mealHistoryReturned: false },
};

const demoFlags = [
  { id: "flag-smart-grocery", key: "smart_grocery_sort", description: "Group grocery items using the new aisle-order model.", enabled: true, emergencyDisabled: false, rolloutPercentage: 65, minimumAppVersion: "1.3.0", maximumAppVersion: null, allowlistedUserIDs: ["internal-merch-01", "internal-qa-04"], value: { mode: "aisle_v2" }, version: 4, createdBy: "release.ananya", updatedBy: "release.ananya", createdAt: "2026-07-01T06:30:00Z", updatedAt: "2026-07-15T08:10:00Z", effectiveState: "active" },
  { id: "flag-weekly-insights", key: "weekly_insights", description: "Show the redesigned weekly nutrition and completion summary.", enabled: true, emergencyDisabled: true, rolloutPercentage: 30, minimumAppVersion: "1.4.0", maximumAppVersion: "1.5.9", allowlistedUserIDs: ["internal-product-02"], value: { layout: "guided" }, version: 7, createdBy: "release.kabir", updatedBy: "security.rhea", createdAt: "2026-06-18T09:00:00Z", updatedAt: "2026-07-15T09:22:00Z", effectiveState: "emergency_disabled" },
  { id: "flag-recipe-cost", key: "recipe_cost_bands", description: "Display reviewed recipe cost bands in plan selection.", enabled: false, emergencyDisabled: false, rolloutPercentage: 0, minimumAppVersion: null, maximumAppVersion: null, allowlistedUserIDs: [], value: { currency: "INR" }, version: 2, createdBy: "release.meera", updatedBy: "release.meera", createdAt: "2026-07-10T07:15:00Z", updatedAt: "2026-07-12T05:45:00Z", effectiveState: "inactive" },
];

const demoFlagAudit = [
  { id: "flag-audit-1", flagKey: "weekly_insights", flagVersion: 7, actorID: "security.rhea", action: "emergency_disabled", reason: "Disable while the iOS 1.4 crash report is investigated.", beforeSHA256: "8a11b8f9", afterSHA256: "49f5c6a2", correlationID: "flag-emergency-20260715", occurredAt: "2026-07-15T09:22:00Z" },
  { id: "flag-audit-2", flagKey: "smart_grocery_sort", flagVersion: 4, actorID: "release.ananya", action: "updated", reason: "Increase rollout after stable completion and crash-free evidence.", beforeSHA256: "5a0cc731", afterSHA256: "9c0c7d44", correlationID: "flag-rollout-20260715", occurredAt: "2026-07-15T08:10:00Z" },
  { id: "flag-audit-3", flagKey: "recipe_cost_bands", flagVersion: 2, actorID: "release.meera", action: "updated", reason: "Keep inactive until licensed cost coverage reaches the launch threshold.", beforeSHA256: "165bc3e2", afterSHA256: "ae4f9120", correlationID: "flag-hold-20260712", occurredAt: "2026-07-12T05:45:00Z" },
];

const demoExports = [
  { id: "demo-export-kpis", exportType: "kpis", dataScope: "aggregate", status: "ready", requestedBy: "owner.demo", reason: null, filters: demoAnalytics.filters, subjectReference: null, filename: "nourish-kpis-2026-07-16.csv", rowCount: 7, requestedAt: "2026-07-16T06:15:00Z", readyAt: "2026-07-16T06:15:00Z", expiresAt: "2026-07-17T06:15:00Z", deliveredAt: null, _content: '"metric_id","label","value","formula"\r\n"activation_rate","Activation rate","0.635","adopted / registered"\r\n' },
  { id: "demo-export-support", exportType: "support_account", dataScope: "user", status: "ready", requestedBy: "security.demo", reason: "Approved support case NP-1042 account review", filters: { exactMatch: true, projection: "support_account_v1" }, subjectReference: "d3c9a5f41b20", filename: "nourish-support-account-2026-07-16.csv", rowCount: 1, requestedAt: "2026-07-16T05:40:00Z", readyAt: "2026-07-16T05:40:00Z", expiresAt: "2026-07-17T05:40:00Z", deliveredAt: null, _content: '"internal_user_id","verified_email","account_status","onboarding_status","subscription_state"\r\n"34d81cbb-5f9f-4d84-b1dc-8d991768949c","aanya@example.test","active","complete","active"\r\n' },
];

function demoInventory() {
  const ingredients = new Map();
  for (const item of demoItems) {
    for (const ingredient of item.content?.ingredients || []) {
      const saved = ingredients.get(ingredient.ingredientID) || {
        id: ingredient.ingredientID, canonicalName: titleCase(ingredient.ingredientID), aliases: [],
        category: ingredientCategory(ingredient.ingredientID), compatibleDiets: /paneer|yoghurt/.test(ingredient.ingredientID)
          ? ["vegetarian", "eggetarian", "nonVegetarian"] : ["vegan", "vegetarian", "eggetarian", "nonVegetarian"],
        allergenIDs: ingredient.ingredientID === "paneer" || ingredient.ingredientID === "yoghurt" ? ["milk"] : [],
        conversions: [], sourceStatus: "verified",
      };
      if (!saved.conversions.some((entry) => entry.householdUnit === ingredient.householdUnit && entry.householdQuantity === ingredient.householdQuantity)) {
        saved.conversions.push({ householdUnit: ingredient.householdUnit, householdQuantity: ingredient.householdQuantity, grams: ingredient.grams });
      }
      ingredients.set(saved.id, saved);
    }
  }
  const records = new Map();
  demoItems.flatMap((item) => item.nutrientEvidence || []).filter((record) => !record.missing)
    .forEach((record) => records.set(record.id, structuredClone(record)));
  return { ingredients: [...ingredients.values()], nutrientRecords: [...records.values()] };
}

function adminHeaders(json = false) {
  return { "x-nourish-admin-key": state.adminKey, "x-nourish-admin-id": state.adminID, ...(json ? { "content-type": "application/json" } : {}) };
}

async function api(path, options = {}) {
  const response = await fetch(`${state.apiBase}${path}`, { ...options, headers: { ...adminHeaders(Boolean(options.body)), ...(options.headers || {}) } });
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || body?.userSafeMessage || body?.message || `Request failed (${response.status})`);
  return body;
}

async function connect() {
  state.adminID = $("#reviewerID").value.trim();
  state.adminKey = $("#adminKey").value;
  if (!state.adminID || !state.adminKey) return showGateError("Enter both your operator ID and development key.");
  $("#connectButton").disabled = true;
  $("#connectButton").textContent = "Checking access…";
  try {
    const [queue, audit, inventory, planRuns, subscriptions, analytics, cohorts] = await Promise.all([
      api("/admin/v1/catalogue/queue"), api("/admin/v1/catalogue/audit"), api("/admin/v1/catalogue/content"),
      api("/admin/v1/plan-runs?limit=200"), api("/admin/v1/subscriptions?limit=200"),
      api(`/admin/v1/kpis?${analyticsQueryParams()}`), api(`/admin/v1/cohorts?${analyticsQueryParams()}`),
    ]);
    state.items = queue.items || [];
    state.audit = audit.events || [];
    state.ingredients = inventory.ingredients || [];
    state.nutrientRecords = inventory.nutrientRecords || [];
    state.planRuns = planRuns.runs || [];
    state.subscriptions = subscriptions.subscriptions || [];
    state.analytics = analytics; state.cohorts = cohorts;
    openDashboard(false);
  } catch (error) {
    showGateError(`${error.message} Make sure the local API is running and the admin key matches.`);
  } finally {
    $("#connectButton").disabled = false;
    $("#connectButton").textContent = "Connect securely";
  }
}

function openDemo() {
  state.demo = true; state.adminID = "reviewer.demo"; state.adminKey = "";
  state.items = structuredClone(demoItems); state.audit = structuredClone(demoAudit);
  state.planRuns = structuredClone(demoPlanRuns);
  state.subscriptions = structuredClone(demoSubscriptions);
  state.analytics = structuredClone(demoAnalytics); state.cohorts = structuredClone(demoCohorts);
  state.supportUser = null;
  state.flags = structuredClone(demoFlags); state.flagAudit = structuredClone(demoFlagAudit); state.flagsLoaded = true; state.selectedFlagKey = null;
  state.exports = structuredClone(demoExports); state.exportsLoaded = true; state.pendingExportID = null;
  $("#supportLookupType").value = "verified_email";
  $("#supportLookupValue").value = demoSupportUser.identity.verifiedEmail;
  $("#supportLookupReason").value = "Investigating the account-access issue reported in demo ticket NP-1042.";
  applyAnalyticsFilterValues(state.analytics.filters);
  const inventory = demoInventory(); state.ingredients = inventory.ingredients; state.nutrientRecords = inventory.nutrientRecords;
  openDashboard(true);
}

function openDashboard(demo) {
  $("#accessGate").classList.add("is-hidden");
  $("#dashboard").classList.remove("is-hidden");
  const initials = initialsFor(state.adminID);
  $("#operatorAvatar").textContent = initials; $("#mobileAvatar").textContent = initials;
  $("#operatorName").textContent = state.adminID; $("#settingsOperator").textContent = state.adminID;
  $("#operatorMode").textContent = demo ? "Demo workspace" : "Operator session";
  renderAll(); switchView("insights");
}

function disconnect() {
  state.adminID = ""; state.adminKey = ""; state.demo = false; state.items = []; state.audit = [];
  state.ingredients = []; state.nutrientRecords = []; state.planRuns = []; state.subscriptions = []; state.analytics = null; state.cohorts = null; state.supportUser = null;
  state.flags = []; state.flagAudit = []; state.flagsLoaded = false; state.selectedFlagKey = null;
  state.exports = []; state.exportsLoaded = false; state.pendingExportID = null;
  state.selectedID = null; state.selectedPlanRunID = null; state.selectedSubscriptionUserID = null; state.pendingSubscriptionUserID = null;
  $("#adminKey").value = ""; $("#dashboard").classList.add("is-hidden"); $("#accessGate").classList.remove("is-hidden");
}

function renderAll() { renderInsights(); renderSupportUser(); renderFlags(); renderExports(); renderMetrics(); renderQueue(); renderSources(); renderPlanRuns(); renderSubscriptions(); renderAudit(); renderIngredientOptions(); }

function initializeAnalyticsFilters() {
  if ($("#analyticsStartDate").value) return;
  const end = new Date(); const start = new Date(end); start.setDate(start.getDate() - 27);
  $("#analyticsStartDate").value = localDateValue(start); $("#analyticsEndDate").value = localDateValue(end);
}

function analyticsFilterValues() {
  return {
    startDate: $("#analyticsStartDate").value, endDate: $("#analyticsEndDate").value,
    timeZone: $("#analyticsTimeZone").value, subscriptionState: $("#analyticsSubscription").value,
    appVersion: $("#analyticsAppVersion").value, acquisitionSource: $("#analyticsAcquisition").value,
    dietType: $("#analyticsDiet").value, cohort: $("#analyticsCohort").value,
    cohortBy: $("#analyticsCohortBy").value,
  };
}

function analyticsQueryParams() {
  return new URLSearchParams(analyticsFilterValues()).toString();
}

function applyAnalyticsFilterValues(filters = {}) {
  const values = {
    analyticsStartDate: filters.startDate, analyticsEndDate: filters.endDate, analyticsTimeZone: filters.timeZone,
    analyticsSubscription: filters.subscriptionState, analyticsAppVersion: filters.appVersion,
    analyticsAcquisition: filters.acquisitionSource, analyticsDiet: filters.dietType,
    analyticsCohort: filters.cohort, analyticsCohortBy: filters.cohortBy,
  };
  for (const [id, value] of Object.entries(values)) if (value && $(`#${id}`)) $(`#${id}`).value = value;
}

async function loadAnalytics() {
  const button = $("#applyAnalyticsFilters"); button.disabled = true; button.textContent = "Applying…";
  try {
    if (state.demo) {
      const filters = analyticsFilterValues();
      ({ analytics: state.analytics, cohorts: state.cohorts } = filteredDemoAnalytics(filters));
    } else {
      const query = analyticsQueryParams();
      [state.analytics, state.cohorts] = await Promise.all([api(`/admin/v1/kpis?${query}`), api(`/admin/v1/cohorts?${query}`)]);
    }
    renderInsights(); showToast("Owner insights updated with the selected filters.");
  } catch (error) { showToast(error.message, true); }
  finally { button.disabled = false; button.textContent = "Apply filters"; }
}

function filteredDemoAnalytics(filters) {
  const analytics = structuredClone(demoAnalytics); const cohorts = structuredClone(demoCohorts);
  analytics.filters = { ...filters }; cohorts.filters = { ...filters }; cohorts.cohortDimension = filters.cohortBy;
  const start = new Date(`${filters.startDate}T00:00:00Z`); const end = new Date(`${filters.endDate}T00:00:00Z`);
  const dayFactor = Math.min(1, Math.max(.12, (Math.round((end - start) / 86_400_000) + 1) / 29));
  const dimensionFactor = [filters.subscriptionState, filters.appVersion, filters.acquisitionSource, filters.dietType, filters.cohort]
    .reduce((factor, value) => factor * (value && value !== "all" ? .62 : 1), 1);
  const factor = dayFactor * dimensionFactor;
  const suppress = filters.appVersion === "1.1-beta" || Math.round(analytics.privacy.populationSize * factor) < 5;
  analytics.privacy.populationSize = Math.round(analytics.privacy.populationSize * factor); analytics.privacy.suppressed = suppress;
  analytics.metrics = analytics.metrics.map((metric) => {
    if (suppress) return { ...metric, value: null, numerator: null, denominator: null, suppressed: true };
    if (metric.format === "integer") return { ...metric, value: Math.round(metric.value * factor), numerator: Math.round(metric.numerator * factor) };
    return { ...metric, numerator: Math.round(metric.numerator * factor), denominator: Math.round(metric.denominator * factor) };
  });
  cohorts.privacy.populationSize = Math.round(cohorts.privacy.populationSize * factor); cohorts.privacy.suppressed = suppress;
  cohorts.funnel = cohorts.funnel.map((step) => suppress ? { ...step, count: null, conversionFromPrevious: null, suppressed: true } : { ...step, count: Math.round(step.count * factor) });
  cohorts.rows = cohorts.rows.map((row) => {
    const registeredUsers = Math.round(row.registeredUsers * factor);
    if (suppress || (registeredUsers > 0 && registeredUsers < 5)) return { cohortStart: row.cohortStart, suppressed: true, registeredUsers: null, onboardedUsers: null, generatedUsers: null, adoptedUsers: null, reviewedUsers: null, adoptionRate: null };
    return { ...row, registeredUsers, onboardedUsers: Math.round(row.onboardedUsers * factor), generatedUsers: Math.round(row.generatedUsers * factor), adoptedUsers: Math.round(row.adoptedUsers * factor), reviewedUsers: Math.round(row.reviewedUsers * factor) };
  });
  return { analytics, cohorts };
}

function updateSupportLookupInput() {
  const byEmail = $("#supportLookupType").value === "verified_email";
  const input = $("#supportLookupValue");
  input.type = byEmail ? "email" : "text";
  input.placeholder = byEmail ? "user@example.com" : "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";
  input.value = "";
  state.supportUser = null;
  renderSupportUser();
}

async function lookupSupportUser(event) {
  event.preventDefault();
  const type = $("#supportLookupType").value;
  const value = $("#supportLookupValue").value.trim();
  const reason = $("#supportLookupReason").value.trim();
  const button = $("#supportLookupButton");
  if (reason.length < 12) return showToast("Add a specific support reason of at least 12 characters.", true);
  button.disabled = true; button.textContent = "Recording & checking…";
  try {
    if (state.demo) {
      const match = type === "verified_email"
        ? value.toLowerCase() === demoSupportUser.identity.verifiedEmail.toLowerCase()
        : value === demoSupportUser.identity.userID;
      if (!match) throw new Error("No account matched that exact identifier. This demo attempt was still audited.");
      state.supportUser = structuredClone(demoSupportUser);
      state.supportUser.accessReceipt = { ...state.supportUser.accessReceipt, id: crypto.randomUUID(), reason, occurredAt: new Date().toISOString() };
    } else {
      const body = type === "verified_email" ? { verifiedEmail: value, reason } : { internalUserID: value, reason };
      state.supportUser = await api("/admin/v1/users/lookup", { method: "POST", body: JSON.stringify(body) });
    }
    renderSupportUser(); showToast("Account opened and access receipt recorded.");
  } catch (error) {
    state.supportUser = null; renderSupportUser(); showToast(error.message, true);
  } finally {
    button.disabled = false; button.textContent = "Find account";
  }
}

function renderSupportUser() {
  const result = $("#supportResult"); const empty = $("#supportEmpty"); const user = state.supportUser;
  result.classList.toggle("is-hidden", !user); empty.classList.toggle("is-hidden", Boolean(user));
  if (!user) { result.innerHTML = ""; return; }
  const identity = user.identity ?? {}; const account = user.account ?? {}; const subscription = user.subscription ?? {};
  const planning = user.planning ?? {}; const privacy = user.privacyRequests ?? {}; const receipt = user.accessReceipt ?? {};
  result.innerHTML = `<div class="support-result-heading"><div><p class="eyebrow">SCOPED ACCOUNT SUMMARY</p><h2>${escapeHTML(identity.verifiedEmail || "Verified email unavailable")}</h2><p>${escapeHTML(identity.userID)} · joined ${formatDate(identity.createdAt)}</p></div><span class="support-account-status ${identity.status === "disabled" ? "disabled" : ""}">${escapeHTML(titleCase(identity.status || "unknown"))}</span></div>
    <div class="support-facts">${supportFact("Onboarding", titleCase(account.onboardingStatus || "unknown"))}${supportFact("Verified access", subscription.hasAccess ? "Available" : "Not available")}${supportFact("Subscription", titleCase(subscription.state || "unknown"))}${supportFact("Active sessions", account.activeSessionCount ?? 0)}</div>
    <div class="support-detail-grid">
      ${supportDetail("Account state", [["Profile revision", account.profileRevision ?? "—"], ["Profile updated", formatDate(account.profileUpdatedAt)], ["Account created", formatDate(identity.createdAt)]])}
      ${supportDetail("Subscription", [["Product", subscription.productID || "Not linked"], ["Period ends", formatDate(subscription.periodEndsAt)], ["Reconciliation", titleCase(subscription.reconciliationStatus || "unknown")], ["Last verified", formatDate(subscription.lastVerifiedAt)]])}
      ${supportDetail("Planning activity", [["Latest run", titleCase(planning.latestJobState || "none")], ["Latest run ID", shortID(planning.latestJobID)], ["Adopted plans", planning.adoptedPlanCount ?? 0], ["Latest adoption", formatDate(planning.latestAdoptionAt)], ["Latest weekly review", formatDate(planning.latestWeeklyReviewAt)]])}
      ${supportDetail("Privacy requests", [["Latest export", privacy.latestExport ? titleCase(privacy.latestExport.status) : "None"], ["Export requested", formatDate(privacy.latestExport?.requestedAt)], ["Latest deletion", privacy.latestDeletion ? titleCase(privacy.latestDeletion.status) : "None"], ["Deletion requested", formatDate(privacy.latestDeletion?.requestedAt)]])}
      <article class="support-detail-card"><h3>Data boundary</h3><dl><div><dt>Mode</dt><dd>Read-only</dd></div><div><dt>Exact match</dt><dd>Required</dd></div><div><dt>Profile answers</dt><dd>Withheld</dd></div><div><dt>Meal history</dt><dd>Withheld</dd></div><div><dt>Impersonation</dt><dd>Unavailable</dd></div></dl></article>
    </div>
    <div class="support-audit-receipt"><svg><use href="#i-audit"/></svg><div><strong>Permanent access receipt recorded</strong><span>${escapeHTML(receipt.reason || "Reason unavailable")} · ${formatDate(receipt.occurredAt)}</span></div><code>${escapeHTML(receipt.id || receipt.correlationID || "recorded")}</code></div>`;
}

function supportFact(label, value) { return `<article><small>${escapeHTML(label)}</small><strong>${escapeHTML(value)}</strong></article>`; }
function supportDetail(title, rows) { return `<article class="support-detail-card"><h3>${escapeHTML(title)}</h3><dl>${rows.map(([label, value]) => `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`).join("")}</dl></article>`; }

async function loadFlags() {
  if (state.demo) { state.flagsLoaded = true; renderFlags(); return; }
  try {
    const result = await api("/admin/v1/flags");
    state.flags = result.flags || []; state.flagAudit = result.auditEvents || []; state.flagsLoaded = true;
    renderFlags();
  } catch (error) { showToast(`${error.message} Feature flags require security-admin access.`, true); }
}

function renderFlags() {
  const flags = state.flags;
  const active = flags.filter((flag) => flag.enabled && !flag.emergencyDisabled);
  const emergency = flags.filter((flag) => flag.emergencyDisabled);
  $("#activeFlagCount").textContent = active.length;
  $("#emergencyFlagCount").textContent = emergency.length;
  $("#navEmergencyFlagCount").textContent = emergency.length;
  $("#averageRollout").textContent = `${active.length ? Math.round(active.reduce((sum, flag) => sum + flag.rolloutPercentage, 0) / active.length) : 0}%`;
  $("#allowlistedUserCount").textContent = flags.reduce((sum, flag) => sum + (flag.allowlistedUserIDs?.length || 0), 0);
  $("#flagInventoryLabel").textContent = `${flags.length} configured`;
  $("#emptyFlags").classList.toggle("is-hidden", flags.length > 0);
  $("#flagList").innerHTML = flags.map((flag) => `<button class="flag-list-item${state.selectedFlagKey === flag.key ? " is-active" : ""}" data-flag-key="${escapeHTML(flag.key)}"><div><span class="flag-state ${escapeHTML(flag.effectiveState)}">${escapeHTML(titleCase(flag.effectiveState))}</span><h3>${escapeHTML(flag.key)}</h3><p>${escapeHTML(flag.description)}</p></div><aside><strong>${flag.rolloutPercentage}%</strong><small>version ${flag.version}</small></aside></button>`).join("");
  $$('[data-flag-key]').forEach((button) => button.addEventListener("click", () => selectFlag(button.dataset.flagKey)));
  renderFlagAudit();
  if (state.selectedFlagKey === "__new") renderFlagEditor(null);
  else renderFlagEditor(flags.find((flag) => flag.key === state.selectedFlagKey) ?? null, Boolean(state.selectedFlagKey));
}

function selectFlag(key) { state.selectedFlagKey = key; renderFlags(); }
function newFlag() { state.selectedFlagKey = "__new"; renderFlags(); }

function renderFlagEditor(flag, selectionExpected = false) {
  const form = $("#flagForm"); const empty = $("#flagEditorEmpty");
  const visible = Boolean(flag) || state.selectedFlagKey === "__new";
  form.classList.toggle("is-hidden", !visible); empty.classList.toggle("is-hidden", visible);
  if (!visible) return;
  $("#flagFormTitle").textContent = flag ? flag.key : "New feature flag";
  $("#flagFormMeta").textContent = flag ? `Last changed by ${flag.updatedBy} · ${formatDate(flag.updatedAt)}` : "Start inactive and document the intended behavior.";
  $("#flagVersion").textContent = flag ? `VERSION ${flag.version}` : "NEW";
  $("#flagKey").value = flag?.key ?? ""; $("#flagKey").disabled = Boolean(flag);
  $("#flagDescription").value = flag?.description ?? "";
  $("#flagEnabled").checked = flag?.enabled ?? false; $("#flagEmergencyDisabled").checked = flag?.emergencyDisabled ?? false;
  $("#flagRollout").value = flag?.rolloutPercentage ?? 0; $("#flagRolloutRange").value = flag?.rolloutPercentage ?? 0;
  $("#flagMinimumVersion").value = flag?.minimumAppVersion ?? ""; $("#flagMaximumVersion").value = flag?.maximumAppVersion ?? "";
  $("#flagAllowlist").value = (flag?.allowlistedUserIDs || []).join("\n");
  $("#flagValue").value = JSON.stringify(flag?.value ?? null, null, 2); $("#flagReason").value = "";
  $("#saveFlagButton").textContent = flag ? "Save new version" : "Save new flag";
  if (selectionExpected && !flag) state.selectedFlagKey = null;
}

async function saveFlag(event) {
  event.preventDefault();
  const existing = state.flags.find((flag) => flag.key === state.selectedFlagKey);
  let value;
  try { value = JSON.parse($("#flagValue").value); } catch { return showToast("Flag value must be valid JSON.", true); }
  const payload = {
    key: $("#flagKey").value.trim(), description: $("#flagDescription").value.trim(),
    enabled: $("#flagEnabled").checked, emergencyDisabled: $("#flagEmergencyDisabled").checked,
    rolloutPercentage: Number($("#flagRollout").value), minimumAppVersion: $("#flagMinimumVersion").value.trim() || null,
    maximumAppVersion: $("#flagMaximumVersion").value.trim() || null,
    allowlistedUserIDs: [...new Set($("#flagAllowlist").value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))],
    value, expectedVersion: existing?.version ?? null, reason: $("#flagReason").value.trim(),
  };
  if (payload.reason.length < 12) return showToast("Add a specific change reason of at least 12 characters.", true);
  const button = $("#saveFlagButton"); button.disabled = true; button.textContent = "Saving version…";
  try {
    let result;
    if (state.demo) {
      const now = new Date().toISOString(); const version = (existing?.version ?? 0) + 1;
      const flag = { ...payload, id: existing?.id ?? crypto.randomUUID(), version, createdBy: existing?.createdBy ?? state.adminID, updatedBy: state.adminID, createdAt: existing?.createdAt ?? now, updatedAt: now, effectiveState: payload.emergencyDisabled ? "emergency_disabled" : payload.enabled ? "active" : "inactive" };
      delete flag.expectedVersion; delete flag.reason;
      const action = !existing ? "created" : !existing.emergencyDisabled && flag.emergencyDisabled ? "emergency_disabled" : existing.emergencyDisabled && !flag.emergencyDisabled ? "emergency_restored" : "updated";
      result = { flag, audit: { id: crypto.randomUUID(), flagID: flag.id, flagKey: flag.key, flagVersion: version, actorID: state.adminID, action, reason: payload.reason, beforeSHA256: existing ? "demo-before" : null, afterSHA256: "demo-after", correlationID: crypto.randomUUID(), occurredAt: now } };
    } else result = await api("/admin/v1/flags", { method: "POST", body: JSON.stringify(payload) });
    const index = state.flags.findIndex((flag) => flag.key === result.flag.key);
    if (index >= 0) state.flags[index] = result.flag; else state.flags.push(result.flag);
    state.flagAudit.unshift(result.audit); state.selectedFlagKey = result.flag.key; renderFlags();
    showToast(result.audit.action === "emergency_disabled" ? "Emergency disable recorded and active." : "Feature-flag version saved.");
  } catch (error) { showToast(error.message, true); }
  finally { button.disabled = false; button.textContent = state.flags.some((flag) => flag.key === state.selectedFlagKey) ? "Save new version" : "Save new flag"; }
}

function renderFlagAudit() {
  $("#flagAuditList").innerHTML = state.flagAudit.length ? state.flagAudit.map((event) => `<article class="flag-audit-row"><div><strong>${escapeHTML(event.flagKey)} · v${escapeHTML(event.flagVersion)}</strong><span>${escapeHTML(titleCase(event.action))} by ${escapeHTML(event.actorID)}</span></div><p>${escapeHTML(event.reason)}</p><small>${formatDate(event.occurredAt)}<br>${escapeHTML(shortID(event.correlationID))}</small></article>`).join("") : '<div class="flag-audit-empty">No feature-flag changes have been recorded.</div>';
}

async function loadExports() {
  if (state.demo) { state.exportsLoaded = true; renderExports(); return; }
  try {
    const result = await api("/admin/v1/exports");
    state.exports = result.exports || []; state.exportsLoaded = true; renderExports();
  } catch (error) { showToast(error.message, true); }
}

function updateExportForm() {
  const userLevel = $("#exportType").value === "support_account";
  $("#exportUserFields").classList.toggle("is-hidden", !userLevel);
  $("#exportScopeCopy").innerHTML = userLevel
    ? "<strong>User-level · security admin</strong>Exact-match minimized account summary. Creation and delivery are separately reasoned and audited."
    : `<strong>Aggregate · current insight filters</strong>${escapeHTML(shortWindow(analyticsFilterValues()))} · small groups remain suppressed.`;
  $("#createExportButton").textContent = userLevel ? "Create protected account export" : "Create aggregate export";
}

async function createExport(event) {
  event.preventDefault(); $("#exportFormError").textContent = "";
  const exportType = $("#exportType").value; const userLevel = exportType === "support_account";
  const payload = { exportType, filters: userLevel ? undefined : analyticsFilterValues() };
  if (userLevel) {
    const value = $("#exportIdentifierValue").value.trim(); const reason = $("#exportReason").value.trim();
    if (!value) return $("#exportFormError").textContent = "Enter one exact verified email or internal user ID.";
    if (reason.length < 12) return $("#exportFormError").textContent = "Add a specific creation reason of at least 12 characters.";
    payload[$("#exportIdentifierType").value] = value; payload.reason = reason;
  }
  const button = $("#createExportButton"); button.disabled = true; button.textContent = "Protecting export…";
  try {
    let created;
    if (state.demo) created = demoCreateExport(payload);
    else created = await api("/admin/v1/exports", { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(payload) });
    state.exports = [created, ...state.exports.filter((item) => item.id !== created.id)]; state.exportsLoaded = true;
    $("#exportIdentifierValue").value = ""; $("#exportReason").value = ""; renderExports();
    showToast(userLevel ? "Protected account export created; delivery still requires a fresh reason." : "Aggregate export is ready for 24 hours.");
  } catch (error) { $("#exportFormError").textContent = error.message; }
  finally { button.disabled = false; updateExportForm(); }
}

function demoCreateExport(payload) {
  const requestedAt = new Date(); const expiresAt = new Date(requestedAt.getTime() + 86_400_000); const userLevel = payload.exportType === "support_account";
  const filename = `nourish-${payload.exportType.replaceAll("_", "-")}-${localDateValue(requestedAt)}.csv`;
  const content = userLevel ? demoExports[1]._content : payload.exportType === "kpis" ? demoExports[0]._content : '"cohortStart","registeredUsers","adoptedUsers","suppressed"\r\n"2026-07-07","538","200","false"\r\n';
  return { id: crypto.randomUUID(), exportType: payload.exportType, dataScope: userLevel ? "user" : "aggregate", status: "ready", requestedBy: state.adminID, reason: payload.reason ?? null, filters: userLevel ? { exactMatch: true, projection: "support_account_v1" } : payload.filters, subjectReference: userLevel ? "demo4a91c70b" : null, filename, rowCount: userLevel ? 1 : payload.exportType === "kpis" ? 7 : 1, requestedAt: requestedAt.toISOString(), readyAt: requestedAt.toISOString(), expiresAt: expiresAt.toISOString(), deliveredAt: null, _content: content };
}

function renderExports() {
  updateExportForm();
  const ready = state.exports.filter((item) => item.status === "ready" && new Date(item.expiresAt) > new Date());
  $("#navReadyExportCount").textContent = ready.length;
  $("#exportEmpty").classList.toggle("is-hidden", state.exports.length > 0);
  $("#exportList").innerHTML = state.exports.map((item) => {
    const expired = item.status !== "ready" || new Date(item.expiresAt) <= new Date(); const status = expired ? (item.status === "failed" ? "failed" : "expired") : "ready";
    return `<article class="export-row"><div><span class="export-scope ${escapeHTML(item.dataScope)}">${item.dataScope === "user" ? "Account-level" : "Aggregate"}</span><strong>${escapeHTML(titleCase(item.exportType))}</strong><small>${escapeHTML(item.filename)}${item.subjectReference ? ` · subject ${escapeHTML(item.subjectReference)}` : ""}</small></div><div><strong>${escapeHTML(item.rowCount)} rows</strong><small>by ${escapeHTML(item.requestedBy)}</small></div><div><span class="export-status ${status}">${escapeHTML(titleCase(status))}</span><small>${expired ? "No longer available" : `Expires ${formatDate(item.expiresAt)}`}</small></div><button class="secondary-button" data-download-export="${escapeHTML(item.id)}" ${expired ? "disabled" : ""}>Download</button></article>`;
  }).join("");
  $$('[data-download-export]').forEach((button) => button.addEventListener("click", () => beginExportDownload(button.dataset.downloadExport)));
}

function beginExportDownload(id) {
  const item = state.exports.find((candidate) => candidate.id === id); if (!item) return;
  if (item.dataScope === "user") {
    state.pendingExportID = id; $("#exportDownloadReason").value = ""; $("#exportDownloadError").textContent = ""; openModal("#exportDownloadModal");
  } else deliverExport(id);
}

async function confirmExportDownload() {
  const reason = $("#exportDownloadReason").value.trim();
  if (reason.length < 12) return $("#exportDownloadError").textContent = "Add a specific delivery reason of at least 12 characters.";
  const button = $("#confirmExportDownload"); button.disabled = true; button.textContent = "Preparing…";
  try { await deliverExport(state.pendingExportID, reason); closeModals(); }
  catch (error) { $("#exportDownloadError").textContent = error.message; }
  finally { button.disabled = false; button.textContent = "Download and audit"; }
}

async function deliverExport(id, reason = "") {
  const item = state.exports.find((candidate) => candidate.id === id); if (!item) return;
  let blob;
  if (state.demo) blob = new Blob([item._content || ""], { type: "text/csv;charset=utf-8" });
  else {
    const response = await fetch(`${state.apiBase}/admin/v1/exports/${encodeURIComponent(id)}/content`, { headers: { ...adminHeaders(), ...(reason ? { "x-export-access-reason": reason } : {}) } });
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.userSafeMessage || `Export delivery failed (${response.status})`); }
    blob = await response.blob();
  }
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = item.filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  item.deliveredAt = new Date().toISOString(); renderExports(); showToast("Export delivered and the access receipt was recorded.");
}

function renderInsights() {
  const analytics = state.analytics; const cohorts = state.cohorts;
  if (!analytics || !cohorts) return;
  $("#analyticsFreshness").textContent = `${formatDate(analytics.freshnessAt)} · ${analytics.filters.timeZone}`;
  const privacy = analytics.privacy ?? {}; const privacyBanner = $("#analyticsPrivacy");
  privacyBanner.classList.toggle("is-suppressed", Boolean(privacy.suppressed));
  privacyBanner.querySelector("strong").textContent = privacy.suppressed ? "Small group suppressed" : "Aggregation boundary";
  privacyBanner.querySelector("span").textContent = privacy.suppressed
    ? `This filter resolves to ${privacy.populationSize} people. Metrics are hidden below the minimum group size of ${privacy.minimumCohortSize}.`
    : `No email, internal user ID, profile answer, or user-level row is returned. Groups below ${privacy.minimumCohortSize} are suppressed.`;
  $("#kpiGrid").innerHTML = analytics.metrics.map((metric) => `<article class="kpi-card${metric.suppressed ? " suppressed" : ""}"><header><span>${escapeHTML(metric.label)}</span><button type="button" data-definition-id="${escapeHTML(metric.id)}" aria-label="Read ${escapeHTML(metric.label)} definition">?</button></header><strong class="kpi-value">${metric.suppressed ? "Suppressed" : escapeHTML(formatMetric(metric))}</strong><small>${escapeHTML(metric.formula)}</small><div class="kpi-evidence"><span>${metric.denominator == null ? `Count ${formatNumber(metric.numerator)}` : `${formatNumber(metric.numerator)} / ${formatNumber(metric.denominator)}`}</span><span>${escapeHTML(shortWindow(analytics.filters))}</span></div></article>`).join("");
  $$('[data-definition-id]').forEach((button) => button.addEventListener("click", () => {
    const target = $(`[data-metric-definition="${button.dataset.definitionId}"]`); target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }));
  $("#metricDefinitions").innerHTML = analytics.metrics.map((metric) => `<article class="definition-row" data-metric-definition="${escapeHTML(metric.id)}"><header><strong>${escapeHTML(metric.label)}</strong><code>${escapeHTML(metric.id)}</code></header><p>${escapeHTML(metric.formula)}</p><footer>Fresh as of ${formatDate(analytics.freshnessAt)} · ${escapeHTML(analytics.filters.timeZone)}</footer></article>`).join("");
  $("#funnelWindow").textContent = shortWindow(cohorts.filters);
  const maximum = Math.max(1, ...cohorts.funnel.map((step) => Number(step.count ?? 0)));
  $("#ownerFunnel").innerHTML = cohorts.funnel.map((step) => `<div class="owner-funnel-row"><span>${escapeHTML(step.label)}</span><div class="owner-funnel-track"><i style="width:${step.count == null ? 4 : Math.max(4, step.count / maximum * 100)}%">${step.count == null ? "" : formatNumber(step.count)}</i></div><strong>${step.count == null ? "Hidden" : step.conversionFromPrevious == null ? "—" : formatPercent(step.conversionFromPrevious)}<small>${step.id === "registered" ? "base" : "from prior"}</small></strong></div>`).join("");
  $("#cohortChartTitle").textContent = `Adoption by ${cohorts.cohortDimension === "first_plan_week" ? "first-plan" : "registration"} week`;
  $("#cohortChart").innerHTML = cohorts.rows.map((row) => {
    const rate = row.adoptionRate ?? 0; const label = row.suppressed ? "<5" : formatPercent(rate);
    return `<div class="cohort-column${row.suppressed ? " suppressed" : ""}"><div style="height:${row.suppressed ? 8 : Math.max(5, rate * 100)}%">${label}</div><span>${escapeHTML(formatCohortWeek(row.cohortStart))}</span></div>`;
  }).join("") || '<div class="detail-empty"><h2>No cohorts in this window</h2></div>';
  $("#cohortTableHead").innerHTML = `<tr>${cohorts.tableColumns.map((column) => `<th scope="col">${escapeHTML(column.label)}</th>`).join("")}</tr>`;
  $("#cohortTableBody").innerHTML = cohorts.rows.map((row) => `<tr>${cohorts.tableColumns.map((column) => `<td>${column.id === "cohortStart" ? escapeHTML(row.cohortStart) : row.suppressed ? "Suppressed (<5)" : formatNumber(row[column.id])}</td>`).join("")}</tr>`).join("");
}

function switchCohortMode(mode) {
  $$('[data-cohort-mode]').forEach((button) => button.classList.toggle("is-active", button.dataset.cohortMode === mode));
  $("#cohortChart").classList.toggle("is-hidden", mode !== "chart"); $("#cohortTableWrap").classList.toggle("is-hidden", mode !== "table");
}

function formatMetric(metric) { return metric.format === "percentage" ? formatPercent(metric.value) : formatNumber(metric.value); }
function formatPercent(value) { return value == null ? "—" : new Intl.NumberFormat("en-IN", { style: "percent", maximumFractionDigits: 1 }).format(value); }
function formatNumber(value) { return value == null ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value); }
function shortWindow(filters) { return `${filters.startDate} → ${filters.endDate}`; }
function formatCohortWeek(value) { return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00Z`)); }

function renderMetrics() {
  const reviews = state.items.filter((item) => item.workflowState === "inReview");
  const ready = reviews.filter((item) => !(item.validationIssues || []).length);
  const issues = state.items.filter((item) => (item.validationIssues || []).length);
  const evidence = new Set(state.nutrientRecords.map((item) => item.id));
  $("#reviewCount").textContent = reviews.length; $("#readyCount").textContent = ready.length;
  $("#issueCount").textContent = issues.length; $("#sourceCount").textContent = evidence.size;
  $("#navQueueCount").textContent = state.items.length;
}

function filteredItems() {
  const search = $("#queueSearch").value.trim().toLowerCase(); const filter = $("#stateFilter").value;
  return state.items.filter((item) => (filter === "all" || item.workflowState === filter)
    && (!search || item.content?.displayName?.toLowerCase().includes(search) || item.recipeID.toLowerCase().includes(search) || item.authoredBy.toLowerCase().includes(search)))
    .sort((a, b) => stateOrder(a.workflowState) - stateOrder(b.workflowState) || new Date(a.submittedAt || a.createdAt) - new Date(b.submittedAt || b.createdAt));
}

function renderQueue() {
  const items = filteredItems(); const list = $("#queueList"); list.innerHTML = "";
  $("#queueLabel").textContent = `${items.length} open item${items.length === 1 ? "" : "s"}`;
  $("#emptyQueue").classList.toggle("is-hidden", items.length > 0);
  items.forEach((item) => {
    const button = document.createElement("button"); button.className = `queue-item${state.selectedID === item.id ? " is-active" : ""}`;
    const issues = item.validationIssues || [];
    button.innerHTML = `<div><div class="queue-item-meta"><span class="state-pill ${item.workflowState}">${stateLabel(item.workflowState)}</span><time>${relativeDate(item.submittedAt || item.createdAt)}</time></div><h3>${escapeHTML(item.content?.displayName || item.recipeID)}</h3><p>${escapeHTML(item.authoredBy)} · v${item.version} · ${escapeHTML(item.recipeMetadata?.cuisine || "Cuisine not set")}</p></div>${issues.length ? `<span class="issue-dot" title="${issues.length} validation issue(s)">${issues.length}</span>` : '<span class="ready-dot" title="Validation ready">✓</span>'}`;
    button.addEventListener("click", () => selectItem(item.id)); list.append(button);
  });
  if (state.selectedID && !state.items.some((item) => item.id === state.selectedID)) closeDetail();
}

function selectItem(id) {
  state.selectedID = id; renderQueue(); const item = state.items.find((candidate) => candidate.id === id); if (!item) return;
  $("#detailEmpty").classList.add("is-hidden"); $("#detailContent").classList.remove("is-hidden"); $("#detailPanel").classList.add("is-open");
  const pill = $("#detailState"); pill.textContent = stateLabel(item.workflowState); pill.className = `state-pill ${item.workflowState}`;
  $("#detailName").textContent = item.content?.displayName || item.recipeID;
  $("#detailMeta").textContent = `${item.recipeMetadata?.cuisine || "Cuisine not set"} · ${(item.recipeMetadata?.eligibleSlots || []).join(" / ") || "No slots"}`;
  $("#authorName").textContent = item.authoredBy; $("#authorAvatar").textContent = initialsFor(item.authoredBy);
  $("#submittedAt").textContent = item.submittedAt ? formatDate(item.submittedAt) : "Not submitted"; $("#versionNumber").textContent = `v${item.version}`;
  renderValidation(item); renderRecipe(item); renderEvidence(item); renderChecks(item); renderDecision(item);
}

function renderValidation(item) {
  const issues = item.validationIssues || []; const banner = $("#validationBanner");
  banner.className = `validation-banner ${issues.length ? "issues" : "ready"}`;
  banner.innerHTML = issues.length ? `<strong>${issues.length} publication gate${issues.length > 1 ? "s" : ""} failed.</strong> Review the Checks tab before making a decision.` : "<strong>All automated publication gates pass.</strong> Human review of content and evidence is still required.";
}

function renderRecipe(item) {
  const content = item.content || {}; const nutrition = content.nutritionPerServing || {}; const meta = item.recipeMetadata || {};
  $("#recipeFacts").innerHTML = [
    ["Serving", `${content.servingSizeGrams || "—"} g`], ["Energy", `${nutrition.calories || "—"} kcal`],
    ["Serving range", `${content.minimumServingMultiplier ?? 1}×–${content.maximumServingMultiplier ?? 1}×`],
    ["Protein", `${nutrition.proteinGrams || "—"} g`], ["Active time", `${meta.activePreparationMinutes ?? "—"} min`],
  ].map(([label, value]) => `<div><small>${label}</small><strong>${value}</strong></div>`).join("");
  $("#ingredientTable").innerHTML = (content.ingredients || []).map((ingredient) => `<div class="ingredient-row"><strong>${escapeHTML(titleCase(ingredient.ingredientID))}</strong><span>${ingredient.householdQuantity} ${escapeHTML(ingredient.householdUnit)}</span><span>${ingredient.grams} g</span></div>`).join("") || '<div class="ingredient-row"><span>No ingredients supplied</span></div>';
  $("#methodList").innerHTML = (content.methodSteps || []).map((step) => `<li>${escapeHTML(step)}</li>`).join("") || "<li>No method steps supplied.</li>";
}

function renderEvidence(item) {
  const evidence = item.nutrientEvidence || []; $("#evidenceCount").textContent = evidence.length;
  $("#evidenceList").innerHTML = evidence.map((record) => {
    if (record.missing) return `<article class="evidence-card"><header><div><h3>${escapeHTML(record.id)}</h3><p>Evidence record could not be resolved.</p></div><span class="licence bad">MISSING</span></header></article>`;
    const source = record.source || {}; const approved = source.licenseStatus === "approvedForProduction";
    return `<article class="evidence-card"><header><div><h3>${escapeHTML(titleCase(record.ingredientID))}</h3><p>${escapeHTML(source.provider || "Provider missing")} · ${escapeHTML(source.dataset || "Dataset missing")}</p></div><span class="licence ${approved ? "" : "bad"}">${approved ? "PRODUCTION APPROVED" : escapeHTML(source.licenseStatus || "UNKNOWN")}</span></header><div class="evidence-facts"><div><small>DATASET VERSION</small><strong>${escapeHTML(source.datasetVersion || "—")}</strong></div><div><small>CONFIDENCE</small><strong>${escapeHTML(record.confidence || "—")}</strong></div><div><small>REVIEWED BY</small><strong>${escapeHTML(record.reviewedBy || "Not reviewed")}</strong></div></div></article>`;
  }).join("") || '<div class="detail-empty"><h2>No evidence linked</h2><p>This recipe cannot be published until every ingredient has reviewed nutrition evidence.</p></div>';
}

function renderChecks(item) {
  const issues = item.validationIssues || []; const checks = [
    ["Recipe name and method", !issues.some((x) => /MISSING_NAME|MISSING_METHOD/.test(x)), "Complete, ordered cooking instructions"],
    ["Ingredient quantities", !issues.some((x) => /INGREDIENT|QUANTITY/.test(x)), "Positive household quantities and grams"],
    ["Allergen declaration", !issues.includes("ALLERGEN_DECLARATION_MISMATCH"), "Derived allergens exactly match declaration"],
    ["Nutrition evidence", !issues.some((x) => /NUTRIENT|SOURCE/.test(x)), "Reviewed, effective, production-licensed records"],
    ["Serving and calculation", !issues.some((x) => /SERVING|NUTRITION|CALCULATION/.test(x)), "Valid serving and calculation version"],
  ];
  $("#checksCount").textContent = issues.length;
  $("#checkList").innerHTML = checks.map(([name, passed, detail]) => `<article class="check-card ${passed ? "" : "failed"}"><div><span class="check-symbol">${passed ? "✓" : "!"}</span><p><strong>${name}</strong><small>${detail}</small></p></div><span class="licence ${passed ? "" : "bad"}">${passed ? "PASS" : "REVIEW"}</span></article>`).join("");
}

function renderDecision(item) {
  const ready = !(item.validationIssues || []).length && item.workflowState === "inReview";
  $("#approveButton").disabled = !ready; $("#rejectButton").disabled = item.workflowState !== "inReview";
  $("#decisionHint").textContent = item.workflowState === "draft" ? "The author must submit this draft before a reviewer can decide." : item.workflowState === "rejected" ? `Returned to author: ${item.rejectionReason || "Reason recorded in audit."}` : ready ? "Publishing creates an immutable version. Your identity is recorded." : "Resolve or reject the failed gates; publication is blocked.";
}

async function approveSelected() {
  const item = selectedItem(); if (!item) return;
  if (state.demo) { state.items = state.items.filter((candidate) => candidate.id !== item.id); state.audit.unshift({ action: "recipe_version.published", actorID: state.adminID, entityType: "recipe_version", entityID: item.id, occurredAt: new Date().toISOString() }); closeDetail(); renderAll(); return showToast(`${item.content.displayName} published in demo mode.`); }
  try { await api(`/admin/v1/recipe-versions/${encodeURIComponent(item.id)}/approve`, { method: "POST" }); await refreshData(); closeDetail(); showToast(`${item.content.displayName} published.`); } catch (error) { showToast(error.message, true); }
}

async function rejectSelected() {
  const item = selectedItem(); const reason = $("#rejectionReason").value.trim(); if (!item || !reason) return showToast("Add a specific rejection reason.", true);
  if (state.demo) { item.workflowState = "rejected"; item.rejectionReason = reason; state.audit.unshift({ action: "recipe_version.rejected", actorID: state.adminID, entityType: "recipe_version", entityID: item.id, reason, occurredAt: new Date().toISOString() }); closeModals(); selectItem(item.id); renderAll(); return showToast(`${item.content.displayName} returned to its author.`); }
  try { await api(`/admin/v1/recipe-versions/${encodeURIComponent(item.id)}/reject`, { method: "POST", body: JSON.stringify({ reason }) }); await refreshData(); closeModals(); selectItem(item.id); showToast(`${item.content.displayName} returned to its author.`); } catch (error) { showToast(error.message, true); }
}

async function refreshData() {
  if (state.demo) return renderAll();
  try {
    const [queue, audit, inventory, planRuns, subscriptions] = await Promise.all([
      api("/admin/v1/catalogue/queue"), api("/admin/v1/catalogue/audit"), api("/admin/v1/catalogue/content"),
      api("/admin/v1/plan-runs?limit=200"), api("/admin/v1/subscriptions?limit=200"),
    ]);
    state.items = queue.items || []; state.audit = audit.events || [];
    state.ingredients = inventory.ingredients || []; state.nutrientRecords = inventory.nutrientRecords || [];
    state.planRuns = planRuns.runs || [];
    state.subscriptions = subscriptions.subscriptions || [];
    renderAll(); showToast("Catalogue refreshed.");
  } catch (error) { showToast(error.message, true); }
}

function renderSources() {
  const records = new Map(); state.nutrientRecords.forEach((record) => records.set(record.id, record));
  state.items.flatMap((item) => item.nutrientEvidence || []).forEach((record) => { if (!record.missing && !records.has(record.id)) records.set(record.id, record); });
  $("#ingredientCount").textContent = state.ingredients.length;
  $("#nutrientCount").textContent = records.size;
  $("#approvedSourceCount").textContent = [...records.values()].filter((record) => record.source?.licenseStatus === "approvedForProduction").length;
  $("#ingredientGrid").innerHTML = state.ingredients.map((ingredient) => `<article class="ingredient-card"><header><div><h3>${escapeHTML(ingredient.canonicalName)}</h3><code>${escapeHTML(ingredient.id)}</code></div><span class="licence">VERIFIED</span></header><p>${escapeHTML(titleCase(ingredient.category))} · ${(ingredient.compatibleDiets || []).map(titleCase).join(" / ")}</p><div class="conversion-chips">${(ingredient.conversions || []).map((conversion) => `<span>${conversion.householdQuantity} ${escapeHTML(conversion.householdUnit)} = ${conversion.grams} g</span>`).join("")}</div>${(ingredient.allergenIDs || []).length ? `<small>Allergens: ${(ingredient.allergenIDs || []).map(escapeHTML).join(", ")}</small>` : "<small>Reviewed with no declared allergens</small>"}</article>`).join("") || '<div class="detail-empty library-empty"><h2>No verified ingredients</h2><p>Add the first canonical ingredient before creating nutrient evidence.</p></div>';
  $("#sourceGrid").innerHTML = [...records.values()].map((record) => {
    const source = record.source || {}; const approved = source.licenseStatus === "approvedForProduction";
    const nutrition = record.nutritionPer100Grams;
    return `<article class="source-card"><span class="licence ${approved ? "" : "bad"}">${approved ? "PRODUCTION APPROVED" : escapeHTML(titleCase(source.licenseStatus || "needs review"))}</span><h3>${escapeHTML(ingredientName(record.ingredientID))}</h3><p>${escapeHTML(source.provider || "Missing source")} · ${escapeHTML(source.dataset || "No dataset")}</p>${nutrition ? `<div class="macro-line"><span>${nutrition.calories} kcal</span><span>${nutrition.proteinGrams} g protein</span><span>${nutrition.carbohydrateGrams} g carbs</span></div>` : ""}<dl><div><dt>Dataset version</dt><dd>${escapeHTML(source.datasetVersion || "—")}</dd></div><div><dt>Confidence</dt><dd>${escapeHTML(record.confidence || "—")}</dd></div><div><dt>Source record</dt><dd>${escapeHTML(source.sourceRecordID || "—")}</dd></div><div><dt>Reviewer</dt><dd>${escapeHTML(record.reviewedBy || "—")}</dd></div></dl></article>`;
  }).join("") || '<div class="detail-empty library-empty"><h2>No nutrient evidence yet</h2><p>Add a traceable per-100 g record after verifying its ingredient.</p></div>';
}

function filteredPlanRuns() {
  const search = $("#planRunSearch")?.value.trim().toLowerCase() ?? "";
  const filter = $("#planRunState")?.value ?? "all";
  return state.planRuns.filter((run) => (filter === "all" || run.state === filter)
    && (!search || [run.id, run.userID, run.correlationID, run.error?.code]
      .some((value) => String(value ?? "").toLowerCase().includes(search))))
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

function renderPlanRuns() {
  const runs = filteredPlanRuns();
  const failed = state.planRuns.filter((run) => ["rejected", "failed"].includes(run.state));
  $("#planRunCount").textContent = state.planRuns.length;
  $("#planSucceededCount").textContent = state.planRuns.filter((run) => run.state === "succeeded").length;
  $("#planFailedCount").textContent = failed.length;
  $("#planActiveCount").textContent = state.planRuns.filter((run) => ["queued", "generating"].includes(run.state)).length;
  $("#navPlanIssueCount").textContent = failed.length;
  $("#planRunLabel").textContent = `${runs.length} run${runs.length === 1 ? "" : "s"}`;
  $("#emptyPlanRuns").classList.toggle("is-hidden", runs.length > 0);
  $("#planRunList").innerHTML = runs.map((run) => {
    const candidates = run.diagnostics?.candidatePoolSize;
    return `<button class="plan-run-item${state.selectedPlanRunID === run.id ? " is-active" : ""}" data-plan-run-id="${escapeHTML(run.id)}"><div><div class="queue-item-meta"><span class="run-state ${escapeHTML(run.state)}">${escapeHTML(titleCase(run.state))}</span><time>${relativeDate(run.createdAt)}</time></div><h3>${escapeHTML(run.request?.weekStart || "Week not resolved")}</h3><p>${escapeHTML(shortID(run.userID))} · ${escapeHTML(triggerLabel(run.request?.trigger))}${run.error?.code ? ` · ${escapeHTML(run.error.code)}` : ""}</p></div><span class="run-count"><strong>${candidates ?? "—"}</strong>candidates</span></button>`;
  }).join("");
  $$('[data-plan-run-id]').forEach((button) => button.addEventListener("click", () => selectPlanRun(button.dataset.planRunId)));
  if (state.selectedPlanRunID && !state.planRuns.some((run) => run.id === state.selectedPlanRunID)) closePlanRunDetail();
}

async function selectPlanRun(runID) {
  state.selectedPlanRunID = runID; renderPlanRuns();
  let run = state.planRuns.find((item) => item.id === runID);
  if (!state.demo) {
    try {
      run = await api(`/admin/v1/plan-runs/${encodeURIComponent(runID)}`);
      const index = state.planRuns.findIndex((item) => item.id === runID);
      if (index >= 0) state.planRuns[index] = run;
    } catch (error) { return showToast(error.message, true); }
  }
  renderPlanRunDetail(run); $("#planRunDetail").classList.add("is-open");
}

function renderPlanRunDetail(run) {
  if (!run) return closePlanRunDetail();
  const diagnostics = run.diagnostics;
  const retry = run.retry;
  const error = run.error;
  $("#planRunDetail").innerHTML = `<div class="run-detail-content"><div class="run-detail-heading"><div><span class="run-state ${escapeHTML(run.state)}">${escapeHTML(titleCase(run.state))}</span><h2>Week of ${escapeHTML(run.request?.weekStart || "unknown")}</h2><p>${escapeHTML(run.id)} · created ${formatDate(run.createdAt)}</p></div><div class="run-duration"><button class="icon-button close-run-detail" aria-label="Close plan-run detail"><svg><use href="#i-x"/></svg></button><strong>${escapeHTML(formatDuration(run.durationMilliseconds, run.state))}</strong><span>run duration</span></div></div>
    ${error ? `<section class="run-section"><div class="run-alert"><span class="check-symbol">!</span><div><strong>${escapeHTML(error.code)}${error.retryable ? " · retryable" : ""}</strong><span>${escapeHTML(error.message)}</span></div></div></section>` : ""}
    <section class="run-section"><h3>Generation request</h3><div class="run-facts">${fact("Trigger", triggerLabel(run.request?.trigger))}${fact("Internal user", shortID(run.userID))}${fact("Profile revision", run.request?.profileRevision ?? "Local")}${fact("Time zone", run.request?.timeZoneIdentifier ?? "—")}${fact("Locked meals", run.request?.lockedPlanItemCount ?? 0)}${fact("Optional snack", run.request?.includeOptionalSnack ? "Included" : "Not requested")}${fact("Plan outcome", run.planID ? shortID(run.planID) : "No plan materialized")}${fact("Reason", run.request?.regenerationReason || "—")}</div></section>
    <section class="run-section"><h3>Exact versions</h3><div class="version-strip"><div><small>Generator</small><code>${escapeHTML(run.versions?.generator || "—")}</code></div><div><small>Scoring</small><code>${escapeHTML(run.versions?.scoring || "—")}</code></div><div><small>Eligibility rules</small><code>${escapeHTML(run.versions?.rules || "—")}</code></div></div></section>
    <section class="run-section"><h3>Candidate funnel</h3>${diagnostics ? `<div class="funnel-grid"><article class="funnel-card"><h4>Eligible by meal slot</h4>${barList(diagnostics.eligibleCandidateCountBySlot, false)}</article><article class="funnel-card"><h4>Rejected by hard rule</h4>${barList(diagnostics.rejectedCandidateCounts, true)}</article></div>` : '<div class="validation-banner issues"><strong>Diagnostics are not available yet.</strong> The run may still be generating or may have failed before candidate evaluation.</div>'}</section>
    ${diagnostics ? `<section class="run-section"><h3>Outcome diagnostics</h3><div class="run-facts">${fact("Candidate pool", diagnostics.candidatePoolSize ?? "—")}${fact("Selected recipes", diagnostics.selectedRecipeCount ?? "—")}${fact("Mean calorie deviation", diagnostics.meanAbsoluteDailyCalorieDeviation == null ? "—" : `${Math.round(diagnostics.meanAbsoluteDailyCalorieDeviation)} kcal`)}${fact("Mean protein deviation", diagnostics.meanAbsoluteDailyProteinDeviation == null ? "No target" : `${Math.round(diagnostics.meanAbsoluteDailyProteinDeviation)} g`)}${fact("Cost penalty", diagnostics.totalCostPenalty ?? "—")}${fact("Ingredient reuse score", diagnostics.totalIngredientReusePenalty ?? "—")}${fact("Ingredient reuse", diagnostics.ingredientReusePercentage == null ? "—" : `${Math.round(diagnostics.ingredientReusePercentage)}%`)}${fact("Cooking sessions", diagnostics.cookingSessionCount ?? "—")}${fact("Cooking load", diagnostics.activeCookingMinutesByDay ? `${Object.values(diagnostics.activeCookingMinutesByDay).reduce((sum, value) => sum + Number(value || 0), 0)} active min` : "—")}${fact("Estimated waste", diagnostics.estimatedWasteGrams == null ? "Pack-size data unavailable" : `${Math.round(diagnostics.estimatedWasteGrams)} g · ${Math.round(diagnostics.estimatedWasteCoveragePercentage ?? 0)}% coverage`)}${fact("Variety gate", diagnostics.variety ? diagnostics.variety.passed ? "Passed" : "Failed" : "Not reached")}${fact("Intentional leftovers", diagnostics.variety?.intentionalLeftovers ?? "—")}${fact("Exact repeats", diagnostics.variety?.accidentalExactRepeats ?? "—")}${fact("Recent recipes", diagnostics.variety?.recentRecipeCount ?? "—")}${fact("Explanations", Object.values(diagnostics.explanationCounts || {}).reduce((sum, count) => sum + count, 0))}</div></section>` : ""}
    ${diagnostics?.toleranceEvaluation ? `<section class="run-section"><h3>Nutrition tolerance contract</h3><div class="run-facts">${fact("Contract", diagnostics.toleranceEvaluation.contractVersion || "—")}${fact("Daily calories", `${diagnostics.toleranceEvaluation.dailyCaloriesWithinToleranceCount ?? 0} / 7 within ±${diagnostics.toleranceEvaluation.dailyCalorieTolerancePercent ?? 5}%`)}${fact("Weekly calories", diagnostics.toleranceEvaluation.weeklyCaloriesWithinTolerance ? `Passed ±${diagnostics.toleranceEvaluation.weeklyCalorieTolerancePercent ?? 3}%` : `Relaxed · ${Math.round(diagnostics.toleranceEvaluation.weeklyCalorieExcess ?? 0)} kcal outside`)}${fact("Weekly abs deviation", diagnostics.toleranceEvaluation.weeklyCalorieAbsoluteDeviationPercent == null ? "—" : `${diagnostics.toleranceEvaluation.weeklyCalorieAbsoluteDeviationPercent.toFixed(1)}%`)}${fact("Optional protein", diagnostics.meanAbsoluteDailyProteinDeviation == null ? "No target" : diagnostics.toleranceEvaluation.optionalProteinOutsideToleranceDayCount === 0 ? `Passed ±${diagnostics.toleranceEvaluation.optionalProteinTolerancePercent ?? 10}%` : `${diagnostics.toleranceEvaluation.optionalProteinOutsideToleranceDayCount} days outside`)}${fact("Documented relaxations", diagnostics.toleranceEvaluation.relaxations?.length ? diagnostics.toleranceEvaluation.relaxations.map(titleCase).join(", ") : "None")}${fact("Optimization passes", diagnostics.toleranceEvaluation.optimizationPasses ?? "—")}</div></section>` : ""}
    <section class="run-section"><h3>Correlation and seed evidence</h3><div class="correlation-strip"><div><small>Correlation ID</small><code>${escapeHTML(run.correlationID || "—")}</code></div><button class="secondary-button compact copy-correlation" type="button">Copy correlation</button></div>${run.deterministicSeedSHA256 ? `<div class="correlation-strip seed-strip"><div><small>Deterministic seed SHA-256 · raw seed withheld</small><code>${escapeHTML(run.deterministicSeedSHA256)}</code></div></div>` : ""}</section>
    <section class="run-section"><h3>Lease and retry evidence</h3>${retry ? `<div class="retry-timeline">${fact("Queue state", titleCase(retry.state || "unknown"), "article")}${fact("Attempts", `${retry.attemptCount ?? 0} / ${retry.maxAttempts ?? "—"}`, "article")}${fact("Worker", retry.workerID || "Released", "article")}${fact("Lease until", retry.lockedUntil ? formatDate(retry.lockedUntil) : "No active lease", "article")}${fact("Last error", retry.lastErrorCode || "None", "article")}${fact("Job ID", shortID(retry.jobID), "article")}${fact("Completed", retry.completedAt ? formatDate(retry.completedAt) : "Not completed", "article")}${fact("Plan state", titleCase(run.state), "article")}</div>${retry.lastErrorMessage ? `<div class="validation-banner issues"><strong>${escapeHTML(retry.lastErrorCode || "Prior attempt")}</strong> ${escapeHTML(retry.lastErrorMessage)}</div>` : ""}` : '<div class="validation-banner ready"><strong>Inline memory run.</strong> No leased background job exists for this development execution.</div>'}</section></div>`;
  $(".close-run-detail", $("#planRunDetail")).addEventListener("click", closePlanRunDetail);
  $(".copy-correlation", $("#planRunDetail")).addEventListener("click", () => copyCorrelation(run.correlationID));
}

async function refreshPlanRuns() {
  if (state.demo) { state.planRuns = structuredClone(demoPlanRuns); renderPlanRuns(); return showToast("Plan runs refreshed."); }
  try {
    const result = await api("/admin/v1/plan-runs?limit=200"); state.planRuns = result.runs || [];
    renderPlanRuns(); if (state.selectedPlanRunID) await selectPlanRun(state.selectedPlanRunID); showToast("Plan runs refreshed.");
  } catch (error) { showToast(error.message, true); }
}

function closePlanRunDetail() {
  state.selectedPlanRunID = null; $("#planRunDetail").classList.remove("is-open");
  $("#planRunDetail").innerHTML = '<div class="detail-empty"><span>→</span><h2>Select a plan run</h2><p>Versions, candidate funnel, outcome, correlation, and retry evidence will appear here.</p></div>';
  renderPlanRuns();
}

async function copyCorrelation(value) {
  try { await navigator.clipboard.writeText(value); showToast("Correlation ID copied."); }
  catch { showToast("Correlation ID could not be copied in this browser.", true); }
}

function barList(values = {}, rejected = false) {
  const entries = Object.entries(values); const maximum = Math.max(1, ...entries.map(([, value]) => Number(value)));
  return `<div class="bar-list${rejected ? " rejected" : ""}">${entries.map(([key, value]) => `<div class="bar-row"><span title="${escapeHTML(titleCase(key))}">${escapeHTML(titleCase(key))}</span><div class="bar-track"><i style="width:${Math.max(4, Number(value) / maximum * 100)}%"></i></div><strong>${Number(value)}</strong></div>`).join("") || '<p class="security-copy">No candidate counts recorded.</p>'}</div>`;
}

function fact(label, value, wrapper = "div") { return `<${wrapper}><small>${escapeHTML(label)}</small><strong>${escapeHTML(value)}</strong></${wrapper}>`; }
function shortID(value) { const text = String(value ?? "—"); return text.length > 16 ? `${text.slice(0, 8)}…${text.slice(-4)}` : text; }
function triggerLabel(value) { return ({ initial: "Initial plan", weekly_review: "Weekly review", manual_regeneration: "Manual regeneration" })[value] || titleCase(value || "unknown"); }
function formatDuration(milliseconds, stateValue) {
  if (milliseconds == null) return ["queued", "generating"].includes(stateValue) ? "In progress" : "—";
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)} s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round(milliseconds % 60_000 / 1_000)}s`;
}

function filteredSubscriptions() {
  const search = $("#subscriptionSearch")?.value.trim().toLowerCase() ?? "";
  const filter = $("#subscriptionStatus")?.value ?? "all";
  return state.subscriptions.filter((subscription) => {
    const status = subscription.reconciliation?.status;
    const statusMatch = filter === "all" || (filter === "attention" ? ["mismatch", "delayed"].includes(status) : status === filter);
    const searchMatch = !search || [subscription.userID, subscription.productID, subscription.environment, subscription.reconciliation?.errorCode]
      .some((value) => String(value ?? "").toLowerCase().includes(search));
    return statusMatch && searchMatch;
  }).sort((left, right) => new Date(right.updatedAt ?? 0) - new Date(left.updatedAt ?? 0));
}

function renderSubscriptions() {
  const subscriptions = filteredSubscriptions();
  const mismatch = state.subscriptions.filter((item) => item.reconciliation?.status === "mismatch").length;
  const delayed = state.subscriptions.filter((item) => item.reconciliation?.status === "delayed").length;
  $("#subscriptionCount").textContent = state.subscriptions.length;
  $("#subscriptionMismatchCount").textContent = mismatch;
  $("#subscriptionDelayedCount").textContent = delayed;
  $("#subscriptionCurrentCount").textContent = state.subscriptions.filter((item) => item.reconciliation?.status === "current").length;
  $("#navSubscriptionIssueCount").textContent = mismatch + delayed;
  $("#subscriptionLabel").textContent = `${subscriptions.length} case${subscriptions.length === 1 ? "" : "s"}`;
  $("#emptySubscriptions").classList.toggle("is-hidden", subscriptions.length > 0);
  $("#subscriptionList").innerHTML = subscriptions.map((subscription) => {
    const reconciliation = subscription.reconciliation ?? {};
    return `<button class="subscription-item${state.selectedSubscriptionUserID === subscription.userID ? " is-active" : ""}" data-subscription-user="${escapeHTML(subscription.userID)}"><div><div class="queue-item-meta"><span class="subscription-status ${escapeHTML(reconciliation.status || "pending")}">${escapeHTML(subscriptionStatusLabel(reconciliation.status))}</span><time>${relativeDate(subscription.updatedAt)}</time></div><h3>${escapeHTML(subscription.productID || "Unlinked product")}</h3><p>${escapeHTML(shortID(subscription.userID))} · ${escapeHTML(titleCase(subscription.environment || "unknown"))}${reconciliation.errorCode ? ` · ${escapeHTML(reconciliation.errorCode)}` : ""}</p></div><span class="access-indicator ${subscription.hasAccess ? "retained" : "inactive"}"><strong>${subscription.hasAccess ? "Access" : "No access"}</strong>${escapeHTML(entitlementStateLabel(subscription.state))}</span></button>`;
  }).join("");
  $$('[data-subscription-user]').forEach((button) => button.addEventListener("click", () => selectSubscription(button.dataset.subscriptionUser)));
  if (state.selectedSubscriptionUserID && !state.subscriptions.some((item) => item.userID === state.selectedSubscriptionUserID)) closeSubscriptionDetail();
}

async function selectSubscription(userID) {
  state.selectedSubscriptionUserID = userID; renderSubscriptions();
  let subscription = state.subscriptions.find((item) => item.userID === userID);
  if (!state.demo) {
    try {
      subscription = await api(`/admin/v1/subscriptions/${encodeURIComponent(userID)}`);
      const index = state.subscriptions.findIndex((item) => item.userID === userID);
      if (index >= 0) state.subscriptions[index] = subscription;
    } catch (error) { return showToast(error.message, true); }
  }
  renderSubscriptionDetail(subscription); $("#subscriptionDetail").classList.add("is-open");
}

function renderSubscriptionDetail(subscription) {
  if (!subscription) return closeSubscriptionDetail();
  const reconciliation = subscription.reconciliation ?? {};
  const job = subscription.latestJob;
  const canRetry = ["mismatch", "delayed"].includes(reconciliation.status);
  const statusCopy = subscriptionStatusCopy(reconciliation.status, subscription.hasAccess);
  $("#subscriptionDetail").innerHTML = `<div class="subscription-detail-content"><div class="subscription-detail-heading"><div><span class="subscription-status ${escapeHTML(reconciliation.status || "pending")}">${escapeHTML(subscriptionStatusLabel(reconciliation.status))}</span><h2>${escapeHTML(subscription.productID || "Subscription case")}</h2><p>${escapeHTML(subscription.userID)} · updated ${formatDate(subscription.updatedAt)}</p></div><button class="icon-button close-subscription-detail" aria-label="Close subscription detail"><svg><use href="#i-x"/></svg></button></div>
    <section class="subscription-alert ${escapeHTML(reconciliation.status || "pending")}"><span class="check-symbol">${reconciliation.status === "current" ? "✓" : reconciliation.status === "pending" ? "…" : "!"}</span><div><strong>${escapeHTML(statusCopy.title)}</strong><p>${escapeHTML(statusCopy.body)}</p></div></section>
    <section class="subscription-section"><h3>Access and renewal</h3><div class="access-policy"><div><small>SERVER ACCESS DECISION</small><strong>${subscription.hasAccess ? "Access retained" : "No subscription access"}</strong><span>${escapeHTML(entitlementStateLabel(subscription.state))} is the last verified state.</span></div><span class="access-seal ${subscription.hasAccess ? "retained" : "inactive"}">${subscription.hasAccess ? "LEGITIMATE ACCESS" : "INACTIVE"}</span></div><div class="subscription-facts">${fact("Entitlement", entitlementStateLabel(subscription.state))}${fact("Environment", titleCase(subscription.environment || "unknown"))}${fact("Period ends", subscription.periodEndsAt ? formatDate(subscription.periodEndsAt) : "—")}${fact("Auto-renew", subscription.willAutoRenew == null ? "Unknown" : subscription.willAutoRenew ? "On" : "Off")}${fact("Last verified", formatDate(reconciliation.lastVerifiedAt))}${fact("Last reconciled", formatDate(reconciliation.lastReconciledAt))}${fact("Next check", formatDate(reconciliation.nextReconciliationAt))}${fact("Attempts", reconciliation.attemptCount ?? 0)}</div></section>
    <section class="subscription-section"><h3>Privacy-safe identity evidence</h3><div class="identity-evidence"><div><small>Original transaction reference</small><code>${escapeHTML(subscription.identity?.originalTransactionReference || "Not linked")}</code></div><div><small>App account token SHA-256</small><code>${escapeHTML(subscription.identity?.appAccountTokenSHA256 || "Not issued")}</code></div><div><small>Source event reference</small><code>${escapeHTML(subscription.identity?.sourceEventReference || "Not recorded")}</code></div></div><p class="privacy-note"><svg><use href="#i-shield"/></svg> Raw account tokens, full transaction identifiers, signed Apple payloads, and purchase credentials are withheld.</p></section>
    <section class="subscription-section"><h3>Retry evidence</h3>${job ? `<div class="retry-timeline subscription-retry-evidence">${fact("Job state", titleCase(job.state || "unknown"), "article")}${fact("Attempts", `${job.attemptCount ?? 0} / ${job.maxAttempts ?? "—"}`, "article")}${fact("Worker", job.workerID || "Released", "article")}${fact("Available", formatDate(job.availableAt), "article")}${fact("Lease until", formatDate(job.lockedUntil), "article")}${fact("Error", job.errorCode || reconciliation.errorCode || "None", "article")}${fact("Job", shortID(job.id), "article")}${fact("Completed", formatDate(job.completedAt), "article")}</div>${job.errorMessage ? `<div class="validation-banner issues"><strong>${escapeHTML(job.errorCode || "Prior attempt")}</strong> ${escapeHTML(job.errorMessage)}</div>` : ""}` : '<div class="validation-banner ready"><strong>No reconciliation job recorded.</strong> The subscription will follow its scheduled verification time.</div>'}</section>
    <section class="subscription-section"><div class="section-heading"><h3>Apple and Nourish timeline</h3><small>Newest evidence first</small></div><div class="subscription-timeline">${(subscription.timeline || []).map(renderSubscriptionTimelineEvent).join("") || '<div class="validation-banner ready"><strong>No timeline evidence yet.</strong> Events will appear after verified Apple ingress or reconciliation.</div>'}</div></section>
    <section class="subscription-section operator-resolution"><div><h3>Operator resolution</h3><p>${canRetry ? "After reviewing the identity and timeline, queue a fresh Apple-signed verification. Access cannot be changed manually." : reconciliation.status === "pending" ? "A verified check is already queued or running. Wait for its durable outcome." : "This case is current. It will be checked again at the scheduled time."}</p></div>${canRetry ? '<button class="approve-button queue-subscription-retry">Queue verified Apple check</button>' : '<span class="resolution-locked"><svg><use href="#i-shield"/></svg>No manual entitlement override</span>'}</section>
  </div>`;
  $(".close-subscription-detail", $("#subscriptionDetail")).addEventListener("click", closeSubscriptionDetail);
  $(".queue-subscription-retry", $("#subscriptionDetail"))?.addEventListener("click", () => openSubscriptionRetry(subscription.userID));
}

function renderSubscriptionTimelineEvent(event) {
  const icon = event.kind === "apple_event" || event.kind === "apple_notification" ? "A" : event.kind === "operator_action" ? "O" : "N";
  return `<article class="timeline-event ${escapeHTML(event.kind || "server")}"><span class="timeline-node">${icon}</span><div><header><strong>${escapeHTML(event.title || "Operational event")}</strong><time>${formatDate(event.at)}</time></header><p>${escapeHTML(event.detail || "Evidence recorded")}</p><footer><span>${escapeHTML(event.source || "Nourish")}</span>${event.reference ? `<code>${escapeHTML(event.reference)}</code>` : ""}${event.payloadSHA256Prefix ? `<code>payload ${escapeHTML(event.payloadSHA256Prefix)}…</code>` : ""}</footer></div><span class="timeline-outcome ${escapeHTML(event.outcome || "recorded")}">${escapeHTML(titleCase(event.outcome || "recorded"))}</span></article>`;
}

async function refreshSubscriptions() {
  if (state.demo) { state.subscriptions = structuredClone(demoSubscriptions); renderSubscriptions(); closeSubscriptionDetail(); return showToast("Subscription cases refreshed."); }
  try {
    const result = await api("/admin/v1/subscriptions?limit=200"); state.subscriptions = result.subscriptions || [];
    renderSubscriptions(); if (state.selectedSubscriptionUserID) await selectSubscription(state.selectedSubscriptionUserID);
    showToast("Subscription cases refreshed.");
  } catch (error) { showToast(error.message, true); }
}

function openSubscriptionRetry(userID) {
  state.pendingSubscriptionUserID = userID; $("#subscriptionRetryReason").value = ""; $("#subscriptionRetryError").textContent = "";
  openModal("#subscriptionRetryModal"); setTimeout(() => $("#subscriptionRetryReason").focus(), 0);
}

async function retrySubscription() {
  const userID = state.pendingSubscriptionUserID;
  const reason = $("#subscriptionRetryReason").value.trim();
  if (!userID || reason.length < 10) { $("#subscriptionRetryError").textContent = "Give a specific operational reason of at least 10 characters."; return; }
  setFormBusy("#confirmSubscriptionRetry", true, "Queueing…");
  try {
    let updated;
    if (state.demo) {
      updated = state.subscriptions.find((item) => item.userID === userID);
      const occurredAt = new Date().toISOString();
      updated.reconciliation.status = "pending"; updated.reconciliation.nextReconciliationAt = occurredAt; updated.updatedAt = occurredAt;
      updated.latestJob = { id: crypto.randomUUID(), state: "queued", attemptCount: 0, maxAttempts: 8, availableAt: occurredAt };
      updated.timeline.unshift({ id: crypto.randomUUID(), kind: "operator_action", source: state.adminID, at: occurredAt, title: "Verified Check Queued", outcome: "pending", detail: reason, reference: "demo correlation" });
    } else {
      updated = await api(`/admin/v1/subscriptions/${encodeURIComponent(userID)}/actions/retry`, { method: "POST", body: JSON.stringify({ reason }) });
      const index = state.subscriptions.findIndex((item) => item.userID === userID); if (index >= 0) state.subscriptions[index] = updated;
    }
    closeModals(); state.pendingSubscriptionUserID = null; renderSubscriptions(); renderSubscriptionDetail(updated);
    showToast("Verified Apple check queued. Existing access was not changed.");
  } catch (error) { $("#subscriptionRetryError").textContent = error.message; }
  finally { setFormBusy("#confirmSubscriptionRetry", false, "Queue verified check"); }
}

function closeSubscriptionDetail() {
  state.selectedSubscriptionUserID = null; $("#subscriptionDetail").classList.remove("is-open");
  $("#subscriptionDetail").innerHTML = '<div class="detail-empty"><span>→</span><h2>Select a subscription case</h2><p>Access policy, Apple and server timelines, retry evidence, and safe operator actions will appear here.</p></div>';
  renderSubscriptions();
}

function subscriptionStatusLabel(value) { return ({ current: "Current", pending: "Pending", delayed: "Delayed", mismatch: "Mismatch" })[value] || titleCase(value || "pending"); }
function entitlementStateLabel(value) { return ({ graceOrBillingRetry: "Grace / billing retry", revokedOrRefunded: "Revoked / refunded" })[value] || titleCase(value || "unknown"); }
function subscriptionStatusCopy(status, hasAccess) {
  if (status === "mismatch") return { title: "Verified identity evidence does not match.", body: `${hasAccess ? "The last legitimate access decision is preserved" : "No prior access is being granted"} while an operator reviews the case.` };
  if (status === "delayed") return { title: "Apple verification is temporarily delayed.", body: `${hasAccess ? "Existing legitimate access remains in place" : "No subscription access is active"}; the durable worker will retry with bounded backoff.` };
  if (status === "pending") return { title: "A verified reconciliation is queued or running.", body: "The entitlement will change only after Apple-signed status and bound identity are verified." };
  return { title: "Apple and Nourish state are current.", body: "The latest verified status has been applied and the next reconciliation is scheduled." };
}

function renderAudit() {
  $("#activityList").innerHTML = state.audit.map((event) => `<div class="activity-row"><div><strong>${escapeHTML(actionLabel(event.action))}</strong><small>${escapeHTML(event.reason || "Recorded catalogue operation")}</small></div><span>${escapeHTML(event.actorID || "system")}</span><span>${escapeHTML(`${event.entityType}: ${event.entityID}`)}</span><time>${formatDate(event.occurredAt)}</time></div>`).join("") || '<div class="empty-state"><h3>No activity recorded</h3></div>';
}

function renderIngredientOptions(selectedValue = null) {
  const select = $("#nutrientIngredient"); if (!select) return;
  const selected = selectedValue ?? select.value;
  select.innerHTML = '<option value="">Choose an ingredient</option>' + state.ingredients
    .map((ingredient) => `<option value="${escapeHTML(ingredient.id)}">${escapeHTML(ingredient.canonicalName)} · ${escapeHTML(ingredient.id)}</option>`).join("");
  if (state.ingredients.some((ingredient) => ingredient.id === selected)) select.value = selected;
}

function openContentModal(tab = "ingredient") {
  resetContentForms(); switchContentTab(tab); openModal("#contentModal");
  setTimeout(() => $(tab === "ingredient" ? "#ingredientID" : "#nutrientIngredient").focus(), 0);
}

function resetContentForms() {
  $("#ingredientForm").reset(); $("#nutrientForm").reset(); $("#contentFormError").textContent = "";
  $("#conversionList").innerHTML = ""; addConversion();
  $("#nutrientID").value = crypto.randomUUID(); $("#sourceID").value = crypto.randomUUID();
  const today = localDateValue(new Date());
  $("#sourceRetrievedAt").value = today; $("#nutrientEffectiveFrom").value = today;
  renderIngredientOptions(); updateLicenceWarning();
}

function switchContentTab(tab) {
  $$('[data-content-tab]').forEach((button) => button.classList.toggle("is-active", button.dataset.contentTab === tab));
  $$('[data-content-panel]').forEach((panel) => panel.classList.toggle("is-visible", panel.dataset.contentPanel === tab));
  $("#contentFormError").textContent = "";
}

function addConversion(conversion = {}) {
  const row = document.createElement("div"); row.className = "conversion-row";
  row.innerHTML = '<label>Household unit<input data-conversion="unit" required placeholder="e.g. cup cooked" /></label><label>Quantity<input data-conversion="quantity" type="number" min="0.0001" step="0.0001" required placeholder="1" /></label><label>Grams<input data-conversion="grams" type="number" min="0.0001" step="0.0001" required placeholder="180" /></label><button class="icon-button remove-conversion" type="button" aria-label="Remove conversion"><svg><use href="#i-x"/></svg></button>';
  $('[data-conversion="unit"]', row).value = conversion.householdUnit ?? "";
  $('[data-conversion="quantity"]', row).value = conversion.householdQuantity ?? "";
  $('[data-conversion="grams"]', row).value = conversion.grams ?? "";
  $(".remove-conversion", row).addEventListener("click", () => {
    if ($$(".conversion-row", $("#conversionList")).length === 1) return showContentError("Every ingredient needs at least one household conversion.");
    row.remove();
  });
  $("#conversionList").append(row);
}

async function saveIngredient(event) {
  event.preventDefault();
  const diets = $$('input[name="compatibleDiet"]:checked').map((input) => input.value);
  if (!diets.length) return showContentError("Select at least one compatible diet.");
  const ingredient = {
    id: $("#ingredientID").value.trim().toLowerCase(), canonicalName: $("#ingredientName").value.trim(),
    aliases: commaList($("#ingredientAliases").value), category: $("#ingredientCategory").value.trim().toLowerCase(),
    compatibleDiets: diets, allergenIDs: commaList($("#ingredientAllergens").value).map((value) => value.toLowerCase()),
    conversions: $$(".conversion-row", $("#conversionList")).map((row) => ({
      householdUnit: $('[data-conversion="unit"]', row).value.trim(),
      householdQuantity: Number($('[data-conversion="quantity"]', row).value),
      grams: Number($('[data-conversion="grams"]', row).value),
    })),
  };
  if (!ingredient.conversions.every((conversion) => conversion.householdUnit && conversion.householdQuantity > 0 && conversion.grams > 0)) {
    return showContentError("Complete every conversion with a positive quantity and gram value.");
  }
  setFormBusy("#saveIngredientButton", true, "Saving…");
  try {
    let saved;
    if (state.demo) {
      saved = { ...structuredClone(ingredient), sourceStatus: "verified", reviewedBy: state.adminID, reviewedAt: new Date().toISOString() };
      const existing = state.ingredients.findIndex((item) => item.id === ingredient.id);
      if (existing >= 0) state.ingredients[existing] = saved; else state.ingredients.push(saved);
      state.audit.unshift({ action: "ingredient.verified", actorID: state.adminID, entityType: "ingredient", entityID: ingredient.id, occurredAt: saved.reviewedAt });
    } else {
      saved = await api("/admin/v1/ingredients", { method: "POST", body: JSON.stringify({ ingredient }) });
      await reloadCatalogue();
    }
    renderAll(); resetContentForms(); renderIngredientOptions(saved.id); $("#nutrientIngredient").value = saved.id;
    switchContentTab("nutrient"); showToast(`${saved.canonicalName} is verified. Add its nutrient evidence next.`);
  } catch (error) { showContentError(error.message); }
  finally { setFormBusy("#saveIngredientButton", false, "Save verified ingredient"); }
}

async function saveNutrient(event) {
  event.preventDefault();
  const effectiveFrom = $("#nutrientEffectiveFrom").value;
  const effectiveUntil = $("#nutrientEffectiveUntil").value || null;
  if (effectiveUntil && effectiveUntil <= effectiveFrom) return showContentError("Effective-until must be later than effective-from.");
  const record = {
    id: $("#nutrientID").value, ingredientID: $("#nutrientIngredient").value,
    nutritionPer100Grams: {
      calories: Number($("#nutrientCalories").value), proteinGrams: Number($("#nutrientProtein").value),
      carbohydrateGrams: Number($("#nutrientCarbs").value), fatGrams: Number($("#nutrientFat").value),
      fibreGrams: Number($("#nutrientFibre").value),
    },
    source: {
      id: $("#sourceID").value, provider: $("#sourceProvider").value.trim(), dataset: $("#sourceDataset").value.trim(),
      datasetVersion: $("#sourceVersion").value.trim(), sourceRecordID: $("#sourceRecordID").value.trim(),
      sourceURL: $("#sourceURL").value.trim() || null, licenseStatus: $("#sourceLicense").value,
      retrievedAt: dateAtNoon($("#sourceRetrievedAt").value),
    },
    confidence: $("#nutrientConfidence").value, effectiveFrom: dateAtNoon(effectiveFrom),
    effectiveUntil: effectiveUntil ? dateAtNoon(effectiveUntil) : null,
  };
  setFormBusy("#saveNutrientButton", true, "Saving immutable record…");
  try {
    let saved;
    if (state.demo) {
      if (state.nutrientRecords.some((item) => item.id === record.id)) throw new Error("This nutrient record ID already exists and is immutable.");
      saved = { ...structuredClone(record), reviewedBy: state.adminID, reviewedAt: new Date().toISOString() };
      state.nutrientRecords.unshift(saved);
      state.audit.unshift({ action: "nutrient_record.reviewed", actorID: state.adminID, entityType: "nutrient_record", entityID: record.id, occurredAt: saved.reviewedAt });
    } else {
      saved = await api("/admin/v1/nutrient-records", { method: "POST", body: JSON.stringify({ record }) });
      await reloadCatalogue();
    }
    renderAll(); closeModals(); switchView("sources"); showToast(`Immutable nutrient evidence saved for ${ingredientName(saved.ingredientID)}.`);
  } catch (error) { showContentError(error.message); }
  finally { setFormBusy("#saveNutrientButton", false, "Save immutable evidence"); }
}

async function reloadCatalogue() {
  const [queue, audit, inventory] = await Promise.all([
    api("/admin/v1/catalogue/queue"), api("/admin/v1/catalogue/audit"), api("/admin/v1/catalogue/content"),
  ]);
  state.items = queue.items || []; state.audit = audit.events || [];
  state.ingredients = inventory.ingredients || []; state.nutrientRecords = inventory.nutrientRecords || [];
}

async function importContentJSON(input, type) {
  const file = input.files?.[0]; if (!file) return;
  try {
    const parsed = JSON.parse(await file.text()); const value = parsed[type === "ingredient" ? "ingredient" : "record"] ?? parsed;
    if (type === "ingredient") populateIngredientForm(value); else populateNutrientForm(value);
    showToast("Import loaded for review. Nothing has been saved yet.");
  } catch { showContentError("This file is not valid catalogue JSON."); }
  finally { input.value = ""; }
}

function populateIngredientForm(ingredient) {
  $("#ingredientID").value = ingredient.id ?? ""; $("#ingredientName").value = ingredient.canonicalName ?? "";
  $("#ingredientCategory").value = ingredient.category ?? ""; $("#ingredientAliases").value = (ingredient.aliases ?? []).join(", ");
  $("#ingredientAllergens").value = (ingredient.allergenIDs ?? []).join(", ");
  $$('input[name="compatibleDiet"]').forEach((input) => { input.checked = (ingredient.compatibleDiets ?? []).includes(input.value); });
  $("#conversionList").innerHTML = ""; (ingredient.conversions?.length ? ingredient.conversions : [{}]).forEach(addConversion);
  $("#ingredientReviewed").checked = false;
}

function populateNutrientForm(record) {
  renderIngredientOptions(record.ingredientID); $("#nutrientIngredient").value = record.ingredientID ?? "";
  $("#nutrientID").value = record.id ?? crypto.randomUUID();
  const nutrition = record.nutritionPer100Grams ?? {}; const source = record.source ?? {};
  $("#nutrientCalories").value = nutrition.calories ?? ""; $("#nutrientProtein").value = nutrition.proteinGrams ?? "";
  $("#nutrientCarbs").value = nutrition.carbohydrateGrams ?? ""; $("#nutrientFat").value = nutrition.fatGrams ?? ""; $("#nutrientFibre").value = nutrition.fibreGrams ?? "";
  $("#sourceID").value = source.id ?? crypto.randomUUID(); $("#sourceProvider").value = source.provider ?? "";
  $("#sourceDataset").value = source.dataset ?? ""; $("#sourceVersion").value = source.datasetVersion ?? "";
  $("#sourceRecordID").value = source.sourceRecordID ?? ""; $("#sourceURL").value = source.sourceURL ?? "";
  $("#sourceLicense").value = source.licenseStatus ?? "approvedForProduction"; $("#sourceRetrievedAt").value = localDateValue(source.retrievedAt ?? new Date());
  $("#nutrientConfidence").value = record.confidence ?? "high"; $("#nutrientEffectiveFrom").value = localDateValue(record.effectiveFrom ?? new Date());
  $("#nutrientEffectiveUntil").value = record.effectiveUntil ? localDateValue(record.effectiveUntil) : "";
  $("#nutrientReviewed").checked = false; updateLicenceWarning();
}

function updateLicenceWarning() {
  const approved = $("#sourceLicense").value === "approvedForProduction";
  $("#licenceWarning").classList.toggle("is-blocked", !approved);
}

function showContentError(message) { $("#contentFormError").textContent = message; }
function setFormBusy(selector, busy, label) { const button = $(selector); button.disabled = busy; button.textContent = label; }
function commaList(value) { return [...new Set(String(value).split(",").map((item) => item.trim()).filter(Boolean))]; }
function localDateValue(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function dateAtNoon(value) { return `${value}T12:00:00.000Z`; }
function ingredientName(id) { return state.ingredients.find((ingredient) => ingredient.id === id)?.canonicalName ?? titleCase(id); }
function ingredientCategory(id) { return /milk|paneer|yoghurt/.test(id) ? "dairy" : /rice|ragi|flour/.test(id) ? "grains" : /chickpea|lentil|dal/.test(id) ? "pulses" : "produce"; }

function switchView(view) { $$(".nav-item").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view)); $$('[data-view-panel]').forEach((panel) => panel.classList.toggle("is-visible", panel.dataset.viewPanel === view)); $("#sidebar").classList.remove("is-open"); window.scrollTo({ top: 0, behavior: "auto" }); if (view === "flags" && !state.flagsLoaded) loadFlags(); if (view === "exports" && !state.exportsLoaded) loadExports(); }
function switchDetailTab(tab) { $$("[data-detail-tab]").forEach((button) => button.classList.toggle("is-active", button.dataset.detailTab === tab)); $$("[data-detail-panel]").forEach((panel) => panel.classList.toggle("is-visible", panel.dataset.detailPanel === tab)); }
function selectedItem() { return state.items.find((item) => item.id === state.selectedID); }
function closeDetail() { state.selectedID = null; $("#detailPanel").classList.remove("is-open"); $("#detailContent").classList.add("is-hidden"); $("#detailEmpty").classList.remove("is-hidden"); renderQueue(); }
function openModal(id) { $(id).classList.add("is-open"); $(id).setAttribute("aria-hidden", "false"); }
function closeModals() { $$(".modal-backdrop").forEach((modal) => { modal.classList.remove("is-open"); modal.setAttribute("aria-hidden", "true"); }); }
function showGateError(message) { $("#gateError").textContent = message; }
function showToast(message, error = false) { const toast = $("#toast"); toast.textContent = message; toast.style.background = error ? "#873b36" : ""; toast.classList.add("is-visible"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 2800); }
function initialsFor(value) { return value.split(/[.\s_-]/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "OP"; }
function stateLabel(value) { return ({ inReview: "IN REVIEW", draft: "DRAFT", rejected: "REJECTED" })[value] || String(value).toUpperCase(); }
function stateOrder(value) { return ({ inReview: 0, draft: 1, rejected: 2 })[value] ?? 9; }
function titleCase(value = "") { return String(value).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function actionLabel(value = "") { return titleCase(value.replace("recipe_version.", "Recipe ").replace("nutrient_record.", "Nutrient ").replace("ingredient.", "Ingredient ")); }
function formatDate(value) { if (!value) return "—"; return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function relativeDate(value) { if (!value) return "Not submitted"; const hours = Math.max(0, Math.round((Date.now() - new Date(value)) / 3_600_000)); return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`; }
function escapeHTML(value) { return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }

$("#connectButton").addEventListener("click", connect); $("#demoButton").addEventListener("click", openDemo);
[$("#disconnectButton"), $("#settingsDisconnect")].forEach((button) => button.addEventListener("click", disconnect));
$$(".nav-item").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
$("#menuButton").addEventListener("click", () => $("#sidebar").classList.toggle("is-open"));
$("#queueSearch").addEventListener("input", renderQueue); $("#stateFilter").addEventListener("change", renderQueue);
$("#planRunSearch").addEventListener("input", renderPlanRuns); $("#planRunState").addEventListener("change", renderPlanRuns);
$("#subscriptionSearch").addEventListener("input", renderSubscriptions); $("#subscriptionStatus").addEventListener("change", renderSubscriptions);
$("#closeDetail").addEventListener("click", closeDetail); $$("[data-detail-tab]").forEach((button) => button.addEventListener("click", () => switchDetailTab(button.dataset.detailTab)));
$("#approveButton").addEventListener("click", approveSelected); $("#rejectButton").addEventListener("click", () => { $("#rejectionReason").value = ""; openModal("#rejectModal"); });
$("#confirmReject").addEventListener("click", rejectSelected);
[$("#addContentButton"), $("#addEvidenceButton")].forEach((button) => button.addEventListener("click", () => openContentModal("ingredient")));
$$("[data-content-tab]").forEach((button) => button.addEventListener("click", () => switchContentTab(button.dataset.contentTab)));
$("#addConversionButton").addEventListener("click", () => addConversion());
$("#ingredientForm").addEventListener("submit", saveIngredient); $("#nutrientForm").addEventListener("submit", saveNutrient);
$("#ingredientImport").addEventListener("change", (event) => importContentJSON(event.target, "ingredient"));
$("#nutrientImport").addEventListener("change", (event) => importContentJSON(event.target, "nutrient"));
$("#sourceLicense").addEventListener("change", updateLicenceWarning);
$$('[data-close-modal]').forEach((button) => button.addEventListener("click", closeModals));
[$("#refreshButton"), $("#refreshAuditButton")].forEach((button) => button.addEventListener("click", refreshData));
$("#refreshPlanRunsButton").addEventListener("click", refreshPlanRuns);
$("#refreshSubscriptionsButton").addEventListener("click", refreshSubscriptions);
$("#confirmSubscriptionRetry").addEventListener("click", retrySubscription);
$("#applyAnalyticsFilters").addEventListener("click", loadAnalytics);
$("#supportLookupType").addEventListener("change", updateSupportLookupInput);
$("#supportLookupForm").addEventListener("submit", lookupSupportUser);
$("#newFlagButton").addEventListener("click", newFlag);
$("#flagForm").addEventListener("submit", saveFlag);
$("#exportType").addEventListener("change", updateExportForm);
$("#exportIdentifierType").addEventListener("change", () => { $("#exportIdentifierValue").placeholder = $("#exportIdentifierType").value === "verifiedEmail" ? "person@example.com" : "Internal user ID"; });
$("#exportForm").addEventListener("submit", createExport);
$("#refreshExportsButton").addEventListener("click", loadExports);
$("#confirmExportDownload").addEventListener("click", confirmExportDownload);
$("#flagRolloutRange").addEventListener("input", () => { $("#flagRollout").value = $("#flagRolloutRange").value; });
$("#flagRollout").addEventListener("input", () => { $("#flagRolloutRange").value = $("#flagRollout").value; });
$$('[data-cohort-mode]').forEach((button) => button.addEventListener("click", () => switchCohortMode(button.dataset.cohortMode)));
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModals(); });
initializeAnalyticsFilters();
