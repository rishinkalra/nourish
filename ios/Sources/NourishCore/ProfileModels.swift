import Foundation

public enum WellnessGoal: String, Codable, CaseIterable, Sendable {
    case maintain
    case gradualLoss
    case gradualGain
}

public enum TargetSource: String, Codable, CaseIterable, Sendable {
    case userProvided
    case reviewedEstimate
}

public enum DietType: String, Codable, CaseIterable, Sendable {
    case vegetarian
    case eggetarian
    case vegan
    case nonVegetarian
}

public enum UnitSystem: String, Codable, CaseIterable, Sendable {
    case metric
    case imperial
}

public enum BudgetBand: String, Codable, CaseIterable, Sendable {
    case value
    case medium
    case flexible
}

public enum KitchenEquipment: String, Codable, CaseIterable, Hashable, Sendable {
    case stovetop
    case pan
    case pot
    case pressureCooker = "pressure-cooker"
    case oven
    case microwave
    case blender
    case airFryer = "air-fryer"
}

public enum LeftoverPreference: String, Codable, CaseIterable, Sendable {
    case avoid
    case planned
    case often
}

public enum AuthenticationMethod: String, Codable, CaseIterable, Sendable {
    case apple
    case emailMagicLink
}

public enum MealSlot: String, Codable, CaseIterable, Hashable, Sendable {
    case breakfast
    case lunch
    case dinner
}

public enum SnackPreference: String, Codable, CaseIterable, Sendable {
    case none
    case optional
    case planned
}

public enum ProfileChangeScope: String, Codable, CaseIterable, Sendable {
    case currentAndFuturePlans
    case nextPlanOnly
}

public struct ConsentRecord: Codable, Equatable, Sendable {
    public var policyVersion: String
    public var acceptedAt: Date

    public init(policyVersion: String, acceptedAt: Date) {
        self.policyVersion = policyVersion
        self.acceptedAt = acceptedAt
    }
}

public struct UserProfile: Codable, Equatable, Sendable {
    public var countryRegionCode: String
    public var unitSystem: UnitSystem
    public var timeZoneIdentifier: String
    public var preferredAuthenticationMethod: AuthenticationMethod?
    public var goal: WellnessGoal
    public var calorieTarget: Int
    public var optionalDailyProteinTargetGrams: Int?
    public var targetSource: TargetSource
    public var targetEstimatorVersion: String?
    public var diet: DietType
    public var allergens: Set<String>
    public var ingredientExclusions: Set<String>
    public var dislikedFoods: Set<String>
    public var cuisines: Set<String>
    public var enabledMealSlots: Set<MealSlot>
    public var snackPreference: SnackPreference
    public var budget: BudgetBand
    public var availableEquipment: Set<KitchenEquipment>?
    public var maximumActiveMinutes: Int
    public var cookingDays: Set<Int>
    public var leftoverPreference: LeftoverPreference
    public var batchPrepSessionsPerWeek: Int
    public var wellnessConsent: ConsentRecord

    public init(
        countryRegionCode: String,
        unitSystem: UnitSystem,
        timeZoneIdentifier: String,
        preferredAuthenticationMethod: AuthenticationMethod? = nil,
        goal: WellnessGoal,
        calorieTarget: Int,
        targetSource: TargetSource,
        targetEstimatorVersion: String?,
        diet: DietType,
        allergens: Set<String>,
        ingredientExclusions: Set<String>,
        dislikedFoods: Set<String>,
        cuisines: Set<String>,
        enabledMealSlots: Set<MealSlot>,
        snackPreference: SnackPreference,
        budget: BudgetBand,
        maximumActiveMinutes: Int,
        cookingDays: Set<Int>,
        leftoverPreference: LeftoverPreference,
        batchPrepSessionsPerWeek: Int,
        wellnessConsent: ConsentRecord,
        optionalDailyProteinTargetGrams: Int? = nil,
        availableEquipment: Set<KitchenEquipment>? = nil
    ) {
        self.countryRegionCode = countryRegionCode
        self.unitSystem = unitSystem
        self.timeZoneIdentifier = timeZoneIdentifier
        self.preferredAuthenticationMethod = preferredAuthenticationMethod
        self.goal = goal
        self.calorieTarget = calorieTarget
        self.optionalDailyProteinTargetGrams = optionalDailyProteinTargetGrams
        self.targetSource = targetSource
        self.targetEstimatorVersion = targetEstimatorVersion
        self.diet = diet
        self.allergens = allergens
        self.ingredientExclusions = ingredientExclusions
        self.dislikedFoods = dislikedFoods
        self.cuisines = cuisines
        self.enabledMealSlots = enabledMealSlots
        self.snackPreference = snackPreference
        self.budget = budget
        self.availableEquipment = availableEquipment
        self.maximumActiveMinutes = maximumActiveMinutes
        self.cookingDays = cookingDays
        self.leftoverPreference = leftoverPreference
        self.batchPrepSessionsPerWeek = batchPrepSessionsPerWeek
        self.wellnessConsent = wellnessConsent
    }
}
