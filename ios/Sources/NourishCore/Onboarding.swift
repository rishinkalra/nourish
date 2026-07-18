import Foundation

public enum OnboardingStep: Int, CaseIterable, Sendable {
    case valueProposition
    case wellnessEligibility
    case authentication
    case goalAndTarget
    case foodProfile
    case practicalConstraints
    case review

    public var next: OnboardingStep? {
        OnboardingStep(rawValue: rawValue + 1)
    }

    public var previous: OnboardingStep? {
        OnboardingStep(rawValue: rawValue - 1)
    }
}

public struct OnboardingDraft: Equatable, Sendable {
    public var confirmsAdult = false
    public var confirmsGeneralWellnessFit = false
    public var countryRegionCode = "IN"
    public var unitSystem: UnitSystem = .metric
    public var timeZoneIdentifier = "Asia/Kolkata"
    public var authenticationMethod: AuthenticationMethod = .apple
    public var goal: WellnessGoal = .maintain
    public var calorieTarget = 1_850
    public var optionalDailyProteinTargetGrams: Int?
    public var targetSource: TargetSource = .userProvided
    public var targetEstimatorVersion: String?
    public var diet: DietType = .vegetarian
    public var allergens: Set<String> = ["peanuts"]
    public var ingredientExclusions: Set<String> = []
    public var dislikedFoods: Set<String> = ["mushrooms"]
    public var cuisines: Set<String> = ["North Indian", "South Indian"]
    public var enabledMealSlots: Set<MealSlot> = Set(MealSlot.allCases)
    public var snackPreference: SnackPreference = .optional
    public var budget: BudgetBand = .medium
    public var availableEquipment: Set<KitchenEquipment> = [.stovetop, .pan, .pot, .pressureCooker, .microwave, .blender]
    public var maximumActiveMinutes = 35
    public var cookingDays: Set<Int> = [1, 3, 5, 7]
    public var leftoverPreference: LeftoverPreference = .planned
    public var batchPrepSessionsPerWeek = 1
    public var confirmsNutritionEstimates = false
    public var consentPolicyVersion = "wellness-v1.0"

    public init() {}

    public func profile(consentAcceptedAt: Date) -> UserProfile {
        UserProfile(
            countryRegionCode: countryRegionCode,
            unitSystem: unitSystem,
            timeZoneIdentifier: timeZoneIdentifier,
            preferredAuthenticationMethod: authenticationMethod,
            goal: goal,
            calorieTarget: calorieTarget,
            targetSource: targetSource,
            targetEstimatorVersion: targetEstimatorVersion,
            diet: diet,
            allergens: allergens,
            ingredientExclusions: ingredientExclusions,
            dislikedFoods: dislikedFoods,
            cuisines: cuisines,
            enabledMealSlots: enabledMealSlots,
            snackPreference: snackPreference,
            budget: budget,
            maximumActiveMinutes: maximumActiveMinutes,
            cookingDays: cookingDays,
            leftoverPreference: leftoverPreference,
            batchPrepSessionsPerWeek: batchPrepSessionsPerWeek,
            wellnessConsent: ConsentRecord(policyVersion: consentPolicyVersion, acceptedAt: consentAcceptedAt),
            optionalDailyProteinTargetGrams: optionalDailyProteinTargetGrams,
            availableEquipment: availableEquipment
        )
    }
}

public enum OnboardingValidationError: Error, Equatable, LocalizedError {
    case adultConfirmationRequired
    case unsuitableForPersonalizedPlanning
    case regionOrTimeZoneRequired
    case calorieTargetOutsidePrototypeRange
    case proteinTargetOutsidePrototypeRange
    case mealSlotRequired
    case cookingDayRequired
    case batchPrepSessionOutsideRange
    case nutritionEstimateConfirmationRequired

    public var errorDescription: String? {
        switch self {
        case .adultConfirmationRequired:
            "You must be 18 or older to use personalized planning."
        case .unsuitableForPersonalizedPlanning:
            "This personalized planner is intended for general wellness only."
        case .regionOrTimeZoneRequired:
            "Country/region and timezone are required for local plan dates and units."
        case .calorieTargetOutsidePrototypeRange:
            "Enter a calorie target between 1,200 and 3,500 kcal."
        case .proteinTargetOutsidePrototypeRange:
            "Enter a protein target between 10 and 300 grams, or turn the target off."
        case .mealSlotRequired:
            "Choose at least one meal slot."
        case .cookingDayRequired:
            "Choose at least one day when cooking is possible."
        case .batchPrepSessionOutsideRange:
            "Choose between zero and seven batch-prep sessions per week."
        case .nutritionEstimateConfirmationRequired:
            "Confirm that calorie and nutrition values are estimates."
        }
    }
}

public enum OnboardingValidator {
    public static func validate(_ step: OnboardingStep, draft: OnboardingDraft) throws {
        switch step {
        case .wellnessEligibility:
            guard draft.confirmsAdult else { throw OnboardingValidationError.adultConfirmationRequired }
            guard draft.confirmsGeneralWellnessFit else { throw OnboardingValidationError.unsuitableForPersonalizedPlanning }
            guard !draft.countryRegionCode.isEmpty, !draft.timeZoneIdentifier.isEmpty else {
                throw OnboardingValidationError.regionOrTimeZoneRequired
            }
        case .goalAndTarget:
            guard (1_200...3_500).contains(draft.calorieTarget) else {
                throw OnboardingValidationError.calorieTargetOutsidePrototypeRange
            }
            if let proteinTarget = draft.optionalDailyProteinTargetGrams,
               !(10...300).contains(proteinTarget) {
                throw OnboardingValidationError.proteinTargetOutsidePrototypeRange
            }
        case .foodProfile:
            guard !draft.enabledMealSlots.isEmpty else { throw OnboardingValidationError.mealSlotRequired }
        case .practicalConstraints:
            guard !draft.cookingDays.isEmpty else { throw OnboardingValidationError.cookingDayRequired }
            guard (0...7).contains(draft.batchPrepSessionsPerWeek) else {
                throw OnboardingValidationError.batchPrepSessionOutsideRange
            }
        case .review:
            guard draft.confirmsNutritionEstimates else {
                throw OnboardingValidationError.nutritionEstimateConfirmationRequired
            }
        case .valueProposition, .authentication:
            break
        }
    }
}
