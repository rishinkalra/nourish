import Foundation

public enum IngredientCategory: String, Codable, CaseIterable, Sendable {
    case produce
    case dairy
    case protein
    case grain
    case pantry
    case spice
    case other
}

public enum CatalogueSourceStatus: String, Codable, Sendable {
    case proposed
    case verified
    case retired
}

public enum SourceLicenseStatus: String, Codable, Sendable {
    case unknown
    case evaluationOnly
    case approvedForProduction
    case expired
    case prohibited
}

public enum NutrientConfidence: String, Codable, Sendable {
    case low
    case medium
    case high
}

public struct UnitConversion: Codable, Equatable, Sendable {
    public let householdUnit: String
    public let householdQuantity: Decimal
    public let grams: Decimal

    public init(householdUnit: String, householdQuantity: Decimal, grams: Decimal) {
        self.householdUnit = householdUnit
        self.householdQuantity = householdQuantity
        self.grams = grams
    }
}

public struct IngredientDefinition: Codable, Equatable, Sendable {
    public let id: String
    public let canonicalName: String
    public let aliases: Set<String>
    public let category: IngredientCategory
    public let compatibleDiets: Set<DietType>
    public let allergenIDs: Set<String>
    public let conversions: [UnitConversion]
    public let sourceStatus: CatalogueSourceStatus

    public init(
        id: String,
        canonicalName: String,
        aliases: Set<String> = [],
        category: IngredientCategory,
        compatibleDiets: Set<DietType>,
        allergenIDs: Set<String> = [],
        conversions: [UnitConversion],
        sourceStatus: CatalogueSourceStatus
    ) {
        self.id = id
        self.canonicalName = canonicalName
        self.aliases = aliases
        self.category = category
        self.compatibleDiets = compatibleDiets
        self.allergenIDs = allergenIDs
        self.conversions = conversions
        self.sourceStatus = sourceStatus
    }
}

public struct NutrientSourceReference: Codable, Equatable, Sendable {
    public let id: String
    public let provider: String
    public let dataset: String
    public let datasetVersion: String
    public let sourceRecordID: String
    public let sourceURL: URL?
    public let licenseStatus: SourceLicenseStatus
    public let retrievedAt: Date

    public init(
        id: String,
        provider: String,
        dataset: String,
        datasetVersion: String,
        sourceRecordID: String,
        sourceURL: URL?,
        licenseStatus: SourceLicenseStatus,
        retrievedAt: Date
    ) {
        self.id = id
        self.provider = provider
        self.dataset = dataset
        self.datasetVersion = datasetVersion
        self.sourceRecordID = sourceRecordID
        self.sourceURL = sourceURL
        self.licenseStatus = licenseStatus
        self.retrievedAt = retrievedAt
    }
}

public struct IngredientNutrientRecord: Codable, Equatable, Sendable {
    public let id: String
    public let ingredientID: String
    public let nutritionPer100Grams: Nutrition
    public let source: NutrientSourceReference
    public let confidence: NutrientConfidence
    public let effectiveFrom: Date
    public let effectiveUntil: Date?
    public let reviewedBy: String?
    public let reviewedAt: Date?

    public init(
        id: String,
        ingredientID: String,
        nutritionPer100Grams: Nutrition,
        source: NutrientSourceReference,
        confidence: NutrientConfidence,
        effectiveFrom: Date,
        effectiveUntil: Date?,
        reviewedBy: String?,
        reviewedAt: Date?
    ) {
        self.id = id
        self.ingredientID = ingredientID
        self.nutritionPer100Grams = nutritionPer100Grams
        self.source = source
        self.confidence = confidence
        self.effectiveFrom = effectiveFrom
        self.effectiveUntil = effectiveUntil
        self.reviewedBy = reviewedBy
        self.reviewedAt = reviewedAt
    }
}

public enum RecipeLifecycleStatus: String, Codable, Sendable {
    case active
    case archived
}

public struct RecipeRecord: Codable, Equatable, Sendable {
    public let id: String
    public let localeIdentifier: String
    public let cuisine: String
    public let eligibleSlots: Set<PlanSlot>
    public let activePreparationMinutes: Int
    public let totalMinutes: Int
    public let equipment: Set<String>
    public let costBand: BudgetBand
    public let lifecycleStatus: RecipeLifecycleStatus

    public init(
        id: String,
        localeIdentifier: String,
        cuisine: String,
        eligibleSlots: Set<PlanSlot>,
        activePreparationMinutes: Int,
        totalMinutes: Int,
        equipment: Set<String>,
        costBand: BudgetBand,
        lifecycleStatus: RecipeLifecycleStatus = .active
    ) {
        self.id = id
        self.localeIdentifier = localeIdentifier
        self.cuisine = cuisine
        self.eligibleSlots = eligibleSlots
        self.activePreparationMinutes = activePreparationMinutes
        self.totalMinutes = totalMinutes
        self.equipment = equipment
        self.costBand = costBand
        self.lifecycleStatus = lifecycleStatus
    }
}

public struct RecipeIngredient: Codable, Equatable, Sendable {
    public let ingredientID: String
    public let householdQuantity: Decimal
    public let householdUnit: String
    public let grams: Decimal

    public init(ingredientID: String, householdQuantity: Decimal, householdUnit: String, grams: Decimal) {
        self.ingredientID = ingredientID
        self.householdQuantity = householdQuantity
        self.householdUnit = householdUnit
        self.grams = grams
    }
}

public struct RecipeVersionContent: Codable, Equatable, Sendable {
    public let displayName: String
    public let ingredients: [RecipeIngredient]
    public let methodSteps: [String]
    public let servings: Decimal
    public let servingSizeGrams: Decimal
    public let nutritionPerServing: Nutrition
    public let dietType: DietType
    public let declaredAllergenIDs: Set<String>
    public let dominantIngredientIDs: Set<String>
    public let tags: Set<String>
    public let nutrientRecordIDs: Set<String>
    public let nutritionCalculationVersion: String
    public let minimumServingMultiplier: Decimal?
    public let maximumServingMultiplier: Decimal?

    public init(
        displayName: String,
        ingredients: [RecipeIngredient],
        methodSteps: [String],
        servings: Decimal,
        servingSizeGrams: Decimal,
        nutritionPerServing: Nutrition,
        dietType: DietType,
        declaredAllergenIDs: Set<String>,
        dominantIngredientIDs: Set<String>,
        tags: Set<String>,
        nutrientRecordIDs: Set<String>,
        nutritionCalculationVersion: String,
        minimumServingMultiplier: Decimal? = 1,
        maximumServingMultiplier: Decimal? = 1
    ) {
        self.displayName = displayName
        self.ingredients = ingredients
        self.methodSteps = methodSteps
        self.servings = servings
        self.servingSizeGrams = servingSizeGrams
        self.nutritionPerServing = nutritionPerServing
        self.dietType = dietType
        self.declaredAllergenIDs = declaredAllergenIDs
        self.dominantIngredientIDs = dominantIngredientIDs
        self.tags = tags
        self.nutrientRecordIDs = nutrientRecordIDs
        self.nutritionCalculationVersion = nutritionCalculationVersion
        self.minimumServingMultiplier = minimumServingMultiplier
        self.maximumServingMultiplier = maximumServingMultiplier
    }
}

public enum RecipeVersionWorkflowState: String, Codable, Sendable {
    case draft
    case inReview
    case rejected
    case published
    case archived
}

public struct RecipeVersionRecord: Codable, Equatable, Sendable {
    public let id: String
    public let recipeID: String
    public let version: Int
    public let content: RecipeVersionContent
    public let workflowState: RecipeVersionWorkflowState
    public let authoredBy: String
    public let createdAt: Date
    public let submittedAt: Date?
    public let reviewedBy: String?
    public let reviewedAt: Date?
    public let publishedAt: Date?
    public let rejectionReason: String?

    public init(
        id: String,
        recipeID: String,
        version: Int,
        content: RecipeVersionContent,
        workflowState: RecipeVersionWorkflowState,
        authoredBy: String,
        createdAt: Date,
        submittedAt: Date? = nil,
        reviewedBy: String? = nil,
        reviewedAt: Date? = nil,
        publishedAt: Date? = nil,
        rejectionReason: String? = nil
    ) {
        self.id = id
        self.recipeID = recipeID
        self.version = version
        self.content = content
        self.workflowState = workflowState
        self.authoredBy = authoredBy
        self.createdAt = createdAt
        self.submittedAt = submittedAt
        self.reviewedBy = reviewedBy
        self.reviewedAt = reviewedAt
        self.publishedAt = publishedAt
        self.rejectionReason = rejectionReason
    }
}
