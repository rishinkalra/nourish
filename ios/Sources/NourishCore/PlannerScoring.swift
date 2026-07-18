import Foundation

public struct PlannerScoreBreakdown: Codable, Equatable, Sendable {
    public let servingMultiplier: Decimal
    public let calorieDeviation: Int
    public let proteinDeviation: Int
    public let activeTimePenalty: Int
    public let costPenalty: Int
    public let equipmentLoadPenalty: Int
    public let ingredientReusePenalty: Int

    public var total: Int {
        calorieDeviation + proteinDeviation + activeTimePenalty + costPenalty + equipmentLoadPenalty + ingredientReusePenalty
    }
}

public enum PlannerScoringPolicy {
    public static func target(
        dailyTarget: Int,
        slot: PlanSlot,
        activeSlots: [PlanSlot],
        shares: [PlanSlot: Int]
    ) -> Int {
        targets(dailyTarget: dailyTarget, activeSlots: activeSlots, shares: shares)[slot]
            ?? (activeSlots.isEmpty ? dailyTarget : dailyTarget / activeSlots.count)
    }

    public static func targets(
        dailyTarget: Int,
        activeSlots: [PlanSlot],
        shares: [PlanSlot: Int]
    ) -> [PlanSlot: Int] {
        guard !activeSlots.isEmpty else { return [:] }
        let totalShare = activeSlots.reduce(0) { $0 + max(0, shares[$1, default: 0]) }
        guard totalShare > 0 else {
            let base = dailyTarget / activeSlots.count
            let remainder = dailyTarget - base * activeSlots.count
            return Dictionary(uniqueKeysWithValues: activeSlots.enumerated().map {
                ($0.element, base + ($0.offset < remainder ? 1 : 0))
            })
        }
        var result = Dictionary(uniqueKeysWithValues: activeSlots.map {
            ($0, dailyTarget * max(0, shares[$0, default: 0]) / totalShare)
        })
        let assigned = result.values.reduce(0, +)
        let rankedRemainders = activeSlots.enumerated().sorted {
            let left = dailyTarget * max(0, shares[$0.element, default: 0]) % totalShare
            let right = dailyTarget * max(0, shares[$1.element, default: 0]) % totalShare
            return left == right ? $0.offset < $1.offset : left > right
        }
        for entry in rankedRemainders.prefix(max(0, dailyTarget - assigned)) {
            result[entry.element, default: 0] += 1
        }
        return result
    }

    public static func score(
        recipe: RecipeSnapshot,
        profile: UserProfile,
        slot: PlanSlot,
        activeSlots: [PlanSlot],
        configuration: PlannerConfiguration,
        existingIngredientIDs: Set<String> = []
    ) -> PlannerScoreBreakdown {
        let calorieTarget = target(
            dailyTarget: profile.calorieTarget,
            slot: slot,
            activeSlots: activeSlots,
            shares: configuration.mealTargetShares
        )
        let proteinTarget = profile.optionalDailyProteinTargetGrams.map {
            target(dailyTarget: $0, slot: slot, activeSlots: activeSlots, shares: configuration.mealTargetShares)
        }

        let recipeCostRank = costRank(recipe.costBand ?? .medium)
        let budgetRank = costRank(profile.budget)
        let costPenalty = recipeCostRank * configuration.costBandWeight
            + max(0, recipeCostRank - budgetRank) * configuration.budgetExcessWeight
        let equipmentLoadPenalty = (recipe.equipment?.count ?? 0) * configuration.equipmentItemWeight
        let recipeIngredientIDs = Set(recipe.ingredients.map { normalized($0.ingredientID) }.filter { !$0.isEmpty })
        let normalizedExisting = Set(existingIngredientIDs.map(normalized).filter { !$0.isEmpty })
        let ingredientReusePenalty: Int
        if normalizedExisting.isEmpty {
            ingredientReusePenalty = 0
        } else {
            let overlap = recipeIngredientIDs.intersection(normalizedExisting).count
            let novel = recipeIngredientIDs.subtracting(normalizedExisting).count
            ingredientReusePenalty = novel * configuration.newIngredientPenalty
                - overlap * configuration.ingredientReuseReward
        }

        return servingCandidates(
            recipe: recipe,
            calorieTarget: calorieTarget,
            proteinTarget: proteinTarget,
            stepPercent: configuration.servingMultiplierStepPercent
        ).map { multiplier in
            let scaled = nutrition(recipe.nutritionPerServing, multiplier: multiplier)
            return PlannerScoreBreakdown(
                servingMultiplier: multiplier,
                calorieDeviation: abs(decimalInt(scaled.calories) - calorieTarget) * configuration.calorieDeviationWeight,
                proteinDeviation: proteinTarget.map {
                    abs(decimalInt(scaled.proteinGrams) - $0) * configuration.proteinDeviationWeight
                } ?? 0,
                activeTimePenalty: recipe.activePreparationMinutes * configuration.activeMinuteWeight,
                costPenalty: costPenalty,
                equipmentLoadPenalty: equipmentLoadPenalty,
                ingredientReusePenalty: ingredientReusePenalty
            )
        }.min {
            if $0.total != $1.total { return $0.total < $1.total }
            let leftDistance = abs(decimalDouble($0.servingMultiplier) - 1)
            let rightDistance = abs(decimalDouble($1.servingMultiplier) - 1)
            if leftDistance != rightDistance { return leftDistance < rightDistance }
            return $0.servingMultiplier < $1.servingMultiplier
        } ?? PlannerScoreBreakdown(
            servingMultiplier: 1,
            calorieDeviation: 0,
            proteinDeviation: 0,
            activeTimePenalty: recipe.activePreparationMinutes * configuration.activeMinuteWeight,
            costPenalty: costPenalty,
            equipmentLoadPenalty: equipmentLoadPenalty,
            ingredientReusePenalty: ingredientReusePenalty
        )
    }

    public static func nutrition(_ nutrition: Nutrition, multiplier: Decimal) -> Nutrition {
        Nutrition(
            calories: nutrition.calories * multiplier,
            proteinGrams: nutrition.proteinGrams * multiplier,
            carbohydrateGrams: nutrition.carbohydrateGrams * multiplier,
            fatGrams: nutrition.fatGrams * multiplier,
            fibreGrams: nutrition.fibreGrams * multiplier
        )
    }

    public static func reviewedServingMultipliers(
        for recipe: RecipeSnapshot,
        stepPercent: Int
    ) -> [Decimal] {
        let rawMinimum = decimalDouble(recipe.minimumServingMultiplier ?? 1)
        let rawMaximum = decimalDouble(recipe.maximumServingMultiplier ?? 1)
        guard rawMinimum >= 0.25, rawMaximum <= 4, rawMinimum <= 1, rawMaximum >= 1, rawMinimum <= rawMaximum else {
            return [1]
        }
        let step = Double(max(1, stepPercent)) / 100
        var values = [
            NSDecimalNumber(value: rawMinimum).decimalValue,
            Decimal(1),
            NSDecimalNumber(value: rawMaximum).decimalValue,
        ]
        var value = ceil(rawMinimum / step) * step
        while value <= rawMaximum + 0.000_001 {
            let clamped = min(rawMaximum, max(rawMinimum, value))
            values.append(NSDecimalNumber(value: clamped).decimalValue)
            value += step
        }
        return values.reduce(into: [Decimal]()) { unique, value in
            if !unique.contains(value) { unique.append(value) }
        }.sorted()
    }

    private static func servingCandidates(
        recipe: RecipeSnapshot,
        calorieTarget: Int,
        proteinTarget: Int?,
        stepPercent: Int
    ) -> [Decimal] {
        let rawMinimum = decimalDouble(recipe.minimumServingMultiplier ?? 1)
        let rawMaximum = decimalDouble(recipe.maximumServingMultiplier ?? 1)
        guard rawMinimum >= 0.25, rawMaximum <= 4, rawMinimum <= 1, rawMaximum >= 1, rawMinimum <= rawMaximum else {
            return [1]
        }
        let step = Double(max(1, stepPercent)) / 100
        func candidate(_ rawValue: Double) -> Decimal {
            let clamped = min(rawMaximum, max(rawMinimum, rawValue))
            let quantized = min(rawMaximum, max(rawMinimum, (clamped / step).rounded() * step))
            return NSDecimalNumber(value: quantized).decimalValue
        }
        var values = [
            NSDecimalNumber(value: rawMinimum).decimalValue,
            Decimal(1),
            NSDecimalNumber(value: rawMaximum).decimalValue,
        ]
        let calories = decimalDouble(recipe.nutritionPerServing.calories)
        if calories > 0 { values.append(candidate(Double(calorieTarget) / calories)) }
        let protein = decimalDouble(recipe.nutritionPerServing.proteinGrams)
        if let proteinTarget, protein > 0 { values.append(candidate(Double(proteinTarget) / protein)) }
        return values.reduce(into: [Decimal]()) { unique, value in
            if !unique.contains(value) { unique.append(value) }
        }
    }

    private static func costRank(_ band: BudgetBand) -> Int {
        switch band {
        case .value: 0
        case .medium: 1
        case .flexible: 2
        }
    }

    private static func decimalInt(_ value: Decimal) -> Int {
        NSDecimalNumber(decimal: value).intValue
    }

    private static func decimalDouble(_ value: Decimal) -> Double {
        NSDecimalNumber(decimal: value).doubleValue
    }

    private static func normalized(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}
