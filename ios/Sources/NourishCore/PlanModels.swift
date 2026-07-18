import Foundation

public struct Nutrition: Codable, Equatable, Sendable {
    public var calories: Decimal
    public var proteinGrams: Decimal
    public var carbohydrateGrams: Decimal
    public var fatGrams: Decimal
    public var fibreGrams: Decimal

    public init(calories: Decimal, proteinGrams: Decimal, carbohydrateGrams: Decimal, fatGrams: Decimal, fibreGrams: Decimal) {
        self.calories = calories
        self.proteinGrams = proteinGrams
        self.carbohydrateGrams = carbohydrateGrams
        self.fatGrams = fatGrams
        self.fibreGrams = fibreGrams
    }

    public static let zero = Nutrition(calories: 0, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0, fibreGrams: 0)

    public static func + (lhs: Nutrition, rhs: Nutrition) -> Nutrition {
        Nutrition(
            calories: lhs.calories + rhs.calories,
            proteinGrams: lhs.proteinGrams + rhs.proteinGrams,
            carbohydrateGrams: lhs.carbohydrateGrams + rhs.carbohydrateGrams,
            fatGrams: lhs.fatGrams + rhs.fatGrams,
            fibreGrams: lhs.fibreGrams + rhs.fibreGrams
        )
    }
}

public struct IngredientSnapshot: Codable, Equatable, Sendable {
    public var ingredientID: String
    public var displayName: String
    public var householdQuantity: Decimal
    public var householdUnit: String
    public var grams: Decimal
    public var purchasePackSizeGrams: Decimal?
    public var allergenIDs: Set<String>

    public init(ingredientID: String, displayName: String, householdQuantity: Decimal, householdUnit: String, grams: Decimal, purchasePackSizeGrams: Decimal? = nil, allergenIDs: Set<String> = []) {
        self.ingredientID = ingredientID
        self.displayName = displayName
        self.householdQuantity = householdQuantity
        self.householdUnit = householdUnit
        self.grams = grams
        self.purchasePackSizeGrams = purchasePackSizeGrams
        self.allergenIDs = allergenIDs
    }
}

public enum RecipePublicationStatus: String, Codable, Hashable, Sendable {
    case draft
    case review
    case published
    case archived
}

public enum RecipeReviewStatus: String, Codable, Hashable, Sendable {
    case pending
    case approved
    case rejected
    case stale
}

public enum PlanSlot: String, Codable, CaseIterable, Hashable, Sendable {
    case breakfast
    case lunch
    case dinner
    case snack
}

public struct RecipeSnapshot: Codable, Equatable, Sendable {
    public var recipeID: String
    public var localeIdentifier: String?
    public var version: Int
    public var displayName: String
    public var ingredients: [IngredientSnapshot]
    public var methodSteps: [String]
    public var servingSizeGrams: Decimal
    public var nutritionPerServing: Nutrition
    public var activePreparationMinutes: Int
    public var totalMinutes: Int
    public var equipment: Set<String>?
    public var costBand: BudgetBand?
    public var minimumServingMultiplier: Decimal?
    public var maximumServingMultiplier: Decimal?
    public var tags: Set<String>
    public var allergenIDs: Set<String>
    public var dietType: DietType
    public var eligibleSlots: Set<PlanSlot>
    public var dominantIngredientIDs: Set<String>
    public var nutritionSourceSummary: String
    public var nutritionCalculationVersion: String
    public var reviewStatus: RecipeReviewStatus
    public var publicationStatus: RecipePublicationStatus

    public init(
        recipeID: String,
        localeIdentifier: String? = nil,
        version: Int,
        displayName: String,
        ingredients: [IngredientSnapshot],
        methodSteps: [String],
        servingSizeGrams: Decimal,
        nutritionPerServing: Nutrition,
        activePreparationMinutes: Int,
        totalMinutes: Int,
        tags: Set<String>,
        allergenIDs: Set<String>,
        dietType: DietType,
        eligibleSlots: Set<PlanSlot>,
        dominantIngredientIDs: Set<String>,
        nutritionSourceSummary: String,
        nutritionCalculationVersion: String,
        reviewStatus: RecipeReviewStatus,
        publicationStatus: RecipePublicationStatus,
        equipment: Set<String>? = nil,
        costBand: BudgetBand? = nil,
        minimumServingMultiplier: Decimal? = nil,
        maximumServingMultiplier: Decimal? = nil
    ) {
        self.recipeID = recipeID
        self.localeIdentifier = localeIdentifier
        self.version = version
        self.displayName = displayName
        self.ingredients = ingredients
        self.methodSteps = methodSteps
        self.servingSizeGrams = servingSizeGrams
        self.nutritionPerServing = nutritionPerServing
        self.activePreparationMinutes = activePreparationMinutes
        self.totalMinutes = totalMinutes
        self.equipment = equipment
        self.costBand = costBand
        self.minimumServingMultiplier = minimumServingMultiplier
        self.maximumServingMultiplier = maximumServingMultiplier
        self.tags = tags
        self.allergenIDs = allergenIDs
        self.dietType = dietType
        self.eligibleSlots = eligibleSlots
        self.dominantIngredientIDs = dominantIngredientIDs
        self.nutritionSourceSummary = nutritionSourceSummary
        self.nutritionCalculationVersion = nutritionCalculationVersion
        self.reviewStatus = reviewStatus
        self.publicationStatus = publicationStatus
    }
}

public struct LocalDate: Codable, Equatable, Hashable, Sendable, Comparable {
    public var year: Int
    public var month: Int
    public var day: Int

    public init(year: Int, month: Int, day: Int) {
        self.year = year
        self.month = month
        self.day = day
    }

    public static func < (lhs: LocalDate, rhs: LocalDate) -> Bool {
        (lhs.year, lhs.month, lhs.day) < (rhs.year, rhs.month, rhs.day)
    }

    public func adding(days: Int, timeZoneIdentifier: String) -> LocalDate? {
        var calendar = Calendar(identifier: .gregorian)
        guard let timeZone = TimeZone(identifier: timeZoneIdentifier) else { return nil }
        calendar.timeZone = timeZone
        guard let date = calendar.date(from: DateComponents(year: year, month: month, day: day)),
              let result = calendar.date(byAdding: .day, value: days, to: date) else { return nil }
        let components = calendar.dateComponents([.year, .month, .day], from: result)
        guard let year = components.year, let month = components.month, let day = components.day else { return nil }
        return LocalDate(year: year, month: month, day: day)
    }
}

public enum LeftoverRelationship: Codable, Equatable, Sendable {
    case none
    case batchSource(batchID: String)
    case plannedReuse(batchID: String, sourcePlanItemID: String)
}

public enum MealCompletionState: String, Codable, CaseIterable, Sendable {
    case planned
    case completed
    case skipped
    case replacedOutsideApp
    case moved
}

public struct PlanItem: Codable, Equatable, Sendable {
    public var id: String
    public var localDate: LocalDate
    public var slot: PlanSlot
    public var recipeSnapshot: RecipeSnapshot
    public var servingMultiplier: Decimal
    public var servingQuantityGrams: Decimal
    public var nutrition: Nutrition
    public var leftoverRelationship: LeftoverRelationship
    public var completionState: MealCompletionState

    public init(
        id: String,
        localDate: LocalDate,
        slot: PlanSlot,
        recipeSnapshot: RecipeSnapshot,
        servingMultiplier: Decimal,
        servingQuantityGrams: Decimal,
        nutrition: Nutrition,
        leftoverRelationship: LeftoverRelationship = .none,
        completionState: MealCompletionState = .planned
    ) {
        self.id = id
        self.localDate = localDate
        self.slot = slot
        self.recipeSnapshot = recipeSnapshot
        self.servingMultiplier = servingMultiplier
        self.servingQuantityGrams = servingQuantityGrams
        self.nutrition = nutrition
        self.leftoverRelationship = leftoverRelationship
        self.completionState = completionState
    }
}

public struct PlanDay: Codable, Equatable, Sendable {
    public var localDate: LocalDate
    public var items: [PlanItem]

    public init(localDate: LocalDate, items: [PlanItem]) {
        self.localDate = localDate
        self.items = items
    }

    public var nutrition: Nutrition {
        items.reduce(.zero) { $0 + $1.nutrition }
    }
}

public struct PlanTargetSnapshot: Codable, Equatable, Sendable {
    public var dailyCalories: Int
    public var optionalDailyProteinGrams: Int?
    public var targetSource: TargetSource
    public var targetVersion: String?

    public init(dailyCalories: Int, optionalDailyProteinGrams: Int?, targetSource: TargetSource, targetVersion: String?) {
        self.dailyCalories = dailyCalories
        self.optionalDailyProteinGrams = optionalDailyProteinGrams
        self.targetSource = targetSource
        self.targetVersion = targetVersion
    }
}

public struct WeeklyPlan: Codable, Equatable, Sendable {
    public var id: String
    public var timeZoneIdentifier: String
    public var days: [PlanDay]
    public var targetSnapshot: PlanTargetSnapshot
    public var generatorVersion: String
    public var scoringVersion: String
    public var ruleVersion: String

    public init(id: String, timeZoneIdentifier: String, days: [PlanDay], targetSnapshot: PlanTargetSnapshot, generatorVersion: String, scoringVersion: String, ruleVersion: String) {
        self.id = id
        self.timeZoneIdentifier = timeZoneIdentifier
        self.days = days
        self.targetSnapshot = targetSnapshot
        self.generatorVersion = generatorVersion
        self.scoringVersion = scoringVersion
        self.ruleVersion = ruleVersion
    }
}
