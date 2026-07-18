import Foundation

public enum RecipeEligibilityIssue: Equatable, Sendable {
    case notPublished
    case nutritionReviewNotApproved
    case localeUnavailable
    case nutritionCalculationVersionStale
    case dietMismatch
    case allergenConflict(Set<String>)
    case ingredientExclusion(Set<String>)
    case dislikedIngredient(Set<String>)
    case mealSlotMismatch
    case equipmentUnavailable(Set<String>)
    case invalidServingBounds
}

public enum RecipeEligibilityPolicy {
    public static func issues(
        for recipe: RecipeSnapshot,
        profile: UserProfile,
        slot: PlanSlot,
        configuration: PlannerConfiguration = PlannerConfiguration()
    ) -> [RecipeEligibilityIssue] {
        var issues: [RecipeEligibilityIssue] = []
        if recipe.publicationStatus != .published { issues.append(.notPublished) }
        if recipe.reviewStatus != .approved { issues.append(.nutritionReviewNotApproved) }
        let eligibleLocales = normalized(configuration.eligibleLocaleIdentifiers)
        if !eligibleLocales.isEmpty,
           !eligibleLocales.contains((recipe.localeIdentifier ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()) {
            issues.append(.localeUnavailable)
        }
        let currentCalculationVersions = normalized(configuration.currentNutritionCalculationVersions)
        if !currentCalculationVersions.isEmpty,
           !currentCalculationVersions.contains(recipe.nutritionCalculationVersion.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()) {
            issues.append(.nutritionCalculationVersionStale)
        }
        if !diet(recipe.dietType, isCompatibleWith: profile.diet) { issues.append(.dietMismatch) }

        let recipeAllergens = normalized(recipe.allergenIDs.union(recipe.ingredients.flatMap(\.allergenIDs)))
        let allergenConflicts = recipeAllergens.intersection(normalized(profile.allergens))
        if !allergenConflicts.isEmpty { issues.append(.allergenConflict(allergenConflicts)) }

        let ingredientIDs = normalized(recipe.ingredients.map(\.ingredientID))
        let exclusions = ingredientIDs.intersection(normalized(profile.ingredientExclusions))
        if !exclusions.isEmpty { issues.append(.ingredientExclusion(exclusions)) }
        let dislikedFoods = normalized(profile.dislikedFoods)
        let dislikedIngredients = Set(recipe.ingredients.compactMap { ingredient -> String? in
            let ingredientID = ingredient.ingredientID.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let displayName = ingredient.displayName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            return dislikedFoods.contains(ingredientID) || dislikedFoods.contains(displayName) ? ingredientID : nil
        })
        if !dislikedIngredients.isEmpty { issues.append(.dislikedIngredient(dislikedIngredients)) }
        if !recipe.eligibleSlots.contains(slot) { issues.append(.mealSlotMismatch) }
        if let availableEquipment = profile.availableEquipment,
           let requiredEquipment = recipe.equipment {
            let available = normalized(availableEquipment.map(\.rawValue))
            let unavailable = normalized(requiredEquipment).subtracting(available)
            if !unavailable.isEmpty { issues.append(.equipmentUnavailable(unavailable)) }
        }
        if !servingBoundsAreValid(recipe) { issues.append(.invalidServingBounds) }
        return issues
    }

    public static func isEligible(
        _ recipe: RecipeSnapshot,
        profile: UserProfile,
        slot: PlanSlot,
        configuration: PlannerConfiguration = PlannerConfiguration()
    ) -> Bool {
        issues(for: recipe, profile: profile, slot: slot, configuration: configuration).isEmpty
    }

    private static func diet(_ recipeDiet: DietType, isCompatibleWith requestedDiet: DietType) -> Bool {
        switch requestedDiet {
        case .vegan:
            recipeDiet == .vegan
        case .vegetarian:
            recipeDiet == .vegetarian || recipeDiet == .vegan
        case .eggetarian:
            recipeDiet == .eggetarian || recipeDiet == .vegetarian || recipeDiet == .vegan
        case .nonVegetarian:
            true
        }
    }

    private static func normalized<S: Sequence>(_ values: S) -> Set<String> where S.Element == String {
        Set(values.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }.filter { !$0.isEmpty })
    }

    static func servingBoundsAreValid(_ recipe: RecipeSnapshot) -> Bool {
        let minimum = recipe.minimumServingMultiplier ?? 1
        let maximum = recipe.maximumServingMultiplier ?? 1
        return minimum >= Decimal(string: "0.25")! && maximum <= 4
            && minimum <= 1 && maximum >= 1 && minimum <= maximum
    }

    public static func servingMultiplier(_ multiplier: Decimal, isAllowedFor recipe: RecipeSnapshot) -> Bool {
        guard servingBoundsAreValid(recipe) else { return false }
        let minimum = recipe.minimumServingMultiplier ?? 1
        let maximum = recipe.maximumServingMultiplier ?? 1
        return multiplier >= minimum && multiplier <= maximum
    }
}

public enum PlanValidationIssue: Equatable, Sendable {
    case dayCount(Int)
    case nonConsecutiveDates
    case itemDateMismatch(itemID: String)
    case disabledMealSlot(itemID: String)
    case invalidNutrition(itemID: String)
    case servingMultiplierOutOfBounds(itemID: String)
    case hardEligibilityViolation(itemID: String, issues: [RecipeEligibilityIssue])
    case varietyViolation(VarietyDiagnostics)
}

public enum WeeklyPlanValidator {
    public static func issues(
        for plan: WeeklyPlan,
        profile: UserProfile,
        recentRecipeIDs: Set<String> = [],
        configuration: PlannerConfiguration = PlannerConfiguration()
    ) -> [PlanValidationIssue] {
        var issues: [PlanValidationIssue] = []
        if plan.days.count != 7 { issues.append(.dayCount(plan.days.count)) }
        let orderedDays = plan.days.sorted { $0.localDate < $1.localDate }
        for index in 1..<orderedDays.count {
            if orderedDays[index - 1].localDate.adding(days: 1, timeZoneIdentifier: plan.timeZoneIdentifier) != orderedDays[index].localDate {
                issues.append(.nonConsecutiveDates)
                break
            }
        }

        for day in plan.days {
            for item in day.items {
                if item.localDate != day.localDate { issues.append(.itemDateMismatch(itemID: item.id)) }
                if !slotIsEnabled(item.slot, profile: profile) { issues.append(.disabledMealSlot(itemID: item.id)) }
                if hasInvalidNutrition(item.nutrition) { issues.append(.invalidNutrition(itemID: item.id)) }
                if !RecipeEligibilityPolicy.servingMultiplier(item.servingMultiplier, isAllowedFor: item.recipeSnapshot) {
                    issues.append(.servingMultiplierOutOfBounds(itemID: item.id))
                }
                let hardIssues = RecipeEligibilityPolicy.issues(for: item.recipeSnapshot, profile: profile, slot: item.slot, configuration: configuration)
                if !hardIssues.isEmpty { issues.append(.hardEligibilityViolation(itemID: item.id, issues: hardIssues)) }
            }
        }
        let varietyMeals = plan.days.flatMap(\.items).map { item in
            PlannedMeal(
                recipeID: item.recipeSnapshot.recipeID,
                dominantIngredientIDs: item.recipeSnapshot.dominantIngredientIDs,
                reuse: reuse(from: item.leftoverRelationship)
            )
        }
        let variety = VarietyPolicy.analyze(meals: varietyMeals, recentRecipeIDs: recentRecipeIDs)
        if !variety.passed { issues.append(.varietyViolation(variety)) }
        return issues
    }

    public static func isValid(
        _ plan: WeeklyPlan,
        profile: UserProfile,
        recentRecipeIDs: Set<String> = [],
        configuration: PlannerConfiguration = PlannerConfiguration()
    ) -> Bool {
        issues(for: plan, profile: profile, recentRecipeIDs: recentRecipeIDs, configuration: configuration).isEmpty
    }

    private static func slotIsEnabled(_ slot: PlanSlot, profile: UserProfile) -> Bool {
        switch slot {
        case .breakfast: profile.enabledMealSlots.contains(.breakfast)
        case .lunch: profile.enabledMealSlots.contains(.lunch)
        case .dinner: profile.enabledMealSlots.contains(.dinner)
        case .snack: profile.snackPreference != .none
        }
    }

    private static func hasInvalidNutrition(_ nutrition: Nutrition) -> Bool {
        nutrition.calories < 0 || nutrition.proteinGrams < 0 || nutrition.carbohydrateGrams < 0 || nutrition.fatGrams < 0 || nutrition.fibreGrams < 0
    }

    private static func reuse(from relationship: LeftoverRelationship) -> MealReuse {
        switch relationship {
        case .none: .fresh(batchID: nil)
        case let .batchSource(batchID): .fresh(batchID: batchID)
        case let .plannedReuse(batchID, _): .leftover(batchID: batchID)
        }
    }
}
