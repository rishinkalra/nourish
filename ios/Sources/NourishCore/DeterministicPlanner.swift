import Foundation

public struct PlannerConfiguration: Codable, Equatable, Sendable {
    public var generatorVersion: String
    public var scoringVersion: String
    public var ruleVersion: String
    public var varietyRules: VarietyRules
    public var calorieDeviationWeight: Int
    public var activeMinuteWeight: Int
    public var proteinDeviationWeight: Int
    public var costBandWeight: Int
    public var budgetExcessWeight: Int
    public var equipmentItemWeight: Int
    public var newIngredientPenalty: Int
    public var ingredientReuseReward: Int
    public var servingMultiplierStepPercent: Int
    public var eligibleLocaleIdentifiers: Set<String>
    public var currentNutritionCalculationVersions: Set<String>
    public var dailyCalorieTolerancePercent: Int
    public var weeklyCalorieTolerancePercent: Int
    public var optionalProteinTolerancePercent: Int
    public var mealTargetShares: [PlanSlot: Int]
    public var cuisinePreferenceReward: Int
    public var favoriteReward: Int

    public init(
        generatorVersion: String = "whole-week-serving-planner-v2",
        scoringVersion: String = "wellness-score-v3",
        ruleVersion: String = "eligibility-rules-v1",
        varietyRules: VarietyRules = VarietyRules(),
        calorieDeviationWeight: Int = 1,
        activeMinuteWeight: Int = 2,
        proteinDeviationWeight: Int = 8,
        costBandWeight: Int = 8,
        budgetExcessWeight: Int = 40,
        equipmentItemWeight: Int = 3,
        newIngredientPenalty: Int = 6,
        ingredientReuseReward: Int = 10,
        servingMultiplierStepPercent: Int = 5,
        eligibleLocaleIdentifiers: Set<String> = [],
        currentNutritionCalculationVersions: Set<String> = [],
        dailyCalorieTolerancePercent: Int = 5,
        weeklyCalorieTolerancePercent: Int = 3,
        optionalProteinTolerancePercent: Int = 10,
        mealTargetShares: [PlanSlot: Int] = [.breakfast: 25, .lunch: 35, .dinner: 35, .snack: 5],
        cuisinePreferenceReward: Int = 18,
        favoriteReward: Int = 12
    ) {
        self.generatorVersion = generatorVersion
        self.scoringVersion = scoringVersion
        self.ruleVersion = ruleVersion
        self.varietyRules = varietyRules
        self.calorieDeviationWeight = calorieDeviationWeight
        self.activeMinuteWeight = activeMinuteWeight
        self.proteinDeviationWeight = proteinDeviationWeight
        self.costBandWeight = costBandWeight
        self.budgetExcessWeight = budgetExcessWeight
        self.equipmentItemWeight = equipmentItemWeight
        self.newIngredientPenalty = newIngredientPenalty
        self.ingredientReuseReward = ingredientReuseReward
        self.servingMultiplierStepPercent = servingMultiplierStepPercent
        self.eligibleLocaleIdentifiers = eligibleLocaleIdentifiers
        self.currentNutritionCalculationVersions = currentNutritionCalculationVersions
        self.dailyCalorieTolerancePercent = dailyCalorieTolerancePercent
        self.weeklyCalorieTolerancePercent = weeklyCalorieTolerancePercent
        self.optionalProteinTolerancePercent = optionalProteinTolerancePercent
        self.mealTargetShares = mealTargetShares
        self.cuisinePreferenceReward = cuisinePreferenceReward
        self.favoriteReward = favoriteReward
    }
}

public struct LockedPlannerItem: Codable, Equatable, Sendable {
    public let dayOffset: Int
    public let item: PlanItem

    public init(dayOffset: Int, item: PlanItem) {
        self.dayOffset = dayOffset
        self.item = item
    }
}

public struct PlannerInput: Codable, Equatable, Sendable {
    public let profile: UserProfile
    public let weekStart: LocalDate
    public let recipes: [RecipeSnapshot]
    public let recentRecipeIDs: Set<String>
    public let favoriteRecipeIDs: Set<String>
    public let includeOptionalSnack: Bool
    public let deterministicSeed: String
    public let trigger: String
    public let regenerationReason: String?
    public let lockedItems: [LockedPlannerItem]

    public init(
        profile: UserProfile,
        weekStart: LocalDate,
        recipes: [RecipeSnapshot],
        recentRecipeIDs: Set<String> = [],
        favoriteRecipeIDs: Set<String> = [],
        includeOptionalSnack: Bool = false,
        deterministicSeed: String,
        trigger: String,
        regenerationReason: String? = nil,
        lockedItems: [LockedPlannerItem] = []
    ) {
        self.profile = profile
        self.weekStart = weekStart
        self.recipes = recipes
        self.recentRecipeIDs = recentRecipeIDs
        self.favoriteRecipeIDs = favoriteRecipeIDs
        self.includeOptionalSnack = includeOptionalSnack
        self.deterministicSeed = deterministicSeed
        self.trigger = trigger
        self.regenerationReason = regenerationReason
        self.lockedItems = lockedItems
    }
}

public enum PlannerRejectionReason: String, Codable, CaseIterable, Sendable {
    case notPublished
    case nutritionReviewNotApproved
    case localeUnavailable
    case nutritionCalculationVersionStale
    case dietMismatch
    case allergenConflict
    case ingredientExclusion
    case dislikedIngredient
    case mealSlotMismatch
    case activeTimeExceeded
    case equipmentUnavailable
    case invalidServingBounds
    case varietyLimit
    case invalidLockedItem
}

public enum PlanExplanationCode: String, Codable, Sendable {
    case plannedLeftover
    case batchOpportunity
    case cuisinePreference
    case favorite
    case recentRecipePenalty
    case servingAdjusted
    case lockedByUser
}

public struct PlanExplanation: Codable, Equatable, Sendable {
    public let planItemID: String
    public let code: PlanExplanationCode
    public let message: String
}

public struct PlannerDiagnostics: Codable, Equatable, Sendable {
    public var generatorVersion: String
    public var scoringVersion: String
    public var ruleVersion: String
    public var deterministicSeed: String
    public var candidatePoolSize: Int
    public var eligibleCandidateCountBySlot: [String: Int]
    public var rejectedCandidateCounts: [String: Int]
    public var selectedRecipeCount: Int
    public var meanAbsoluteDailyCalorieDeviation: Double
    public var meanAbsoluteDailyProteinDeviation: Double?
    public var totalCostPenalty: Int?
    public var totalIngredientReusePenalty: Int?
    public var ingredientReusePercentage: Double?
    public var activeCookingMinutesByDay: [String: Int]?
    public var cookingSessionCount: Int?
    public var estimatedWasteGrams: Double?
    public var estimatedWasteCoveragePercentage: Double?
    public var toleranceEvaluation: PlannerToleranceEvaluation?
    public var mealTargetShares: [String: Int]?
    public var variety: VarietyDiagnostics?
    public var explanations: [PlanExplanation]
    public var trigger: String
    public var regenerationReason: String?

    public init(
        generatorVersion: String,
        scoringVersion: String,
        ruleVersion: String,
        deterministicSeed: String,
        candidatePoolSize: Int,
        eligibleCandidateCountBySlot: [String: Int],
        rejectedCandidateCounts: [String: Int],
        selectedRecipeCount: Int,
        meanAbsoluteDailyCalorieDeviation: Double,
        meanAbsoluteDailyProteinDeviation: Double? = nil,
        totalCostPenalty: Int? = nil,
        totalIngredientReusePenalty: Int? = nil,
        ingredientReusePercentage: Double? = nil,
        activeCookingMinutesByDay: [String: Int]? = nil,
        cookingSessionCount: Int? = nil,
        estimatedWasteGrams: Double? = nil,
        estimatedWasteCoveragePercentage: Double? = nil,
        toleranceEvaluation: PlannerToleranceEvaluation? = nil,
        mealTargetShares: [String: Int]? = nil,
        variety: VarietyDiagnostics?,
        explanations: [PlanExplanation],
        trigger: String,
        regenerationReason: String?
    ) {
        self.generatorVersion = generatorVersion
        self.scoringVersion = scoringVersion
        self.ruleVersion = ruleVersion
        self.deterministicSeed = deterministicSeed
        self.candidatePoolSize = candidatePoolSize
        self.eligibleCandidateCountBySlot = eligibleCandidateCountBySlot
        self.rejectedCandidateCounts = rejectedCandidateCounts
        self.selectedRecipeCount = selectedRecipeCount
        self.meanAbsoluteDailyCalorieDeviation = meanAbsoluteDailyCalorieDeviation
        self.meanAbsoluteDailyProteinDeviation = meanAbsoluteDailyProteinDeviation
        self.totalCostPenalty = totalCostPenalty
        self.totalIngredientReusePenalty = totalIngredientReusePenalty
        self.ingredientReusePercentage = ingredientReusePercentage
        self.activeCookingMinutesByDay = activeCookingMinutesByDay
        self.cookingSessionCount = cookingSessionCount
        self.estimatedWasteGrams = estimatedWasteGrams
        self.estimatedWasteCoveragePercentage = estimatedWasteCoveragePercentage
        self.toleranceEvaluation = toleranceEvaluation
        self.mealTargetShares = mealTargetShares
        self.variety = variety
        self.explanations = explanations
        self.trigger = trigger
        self.regenerationReason = regenerationReason
    }
}

public struct PlannerToleranceEvaluation: Codable, Equatable, Sendable {
    public var contractVersion: String
    public var dailyCalorieTolerancePercent: Int
    public var weeklyCalorieTolerancePercent: Int
    public var optionalProteinTolerancePercent: Int
    public var dailyCaloriesWithinToleranceCount: Int
    public var dailyCalorieExcess: Decimal
    public var weeklyCaloriesWithinTolerance: Bool
    public var weeklyCalorieExcess: Decimal
    public var optionalProteinOutsideToleranceDayCount: Int
    public var dailyCalorieAbsoluteDeviationPercentages: [Decimal]?
    public var weeklyCalorieAbsoluteDeviationPercent: Decimal?
    public var optionalProteinAbsoluteDeviationGrams: [Decimal]?
    public var relaxations: [String]
    public var optimizationPasses: Int
}

public struct PlannerResult: Codable, Equatable, Sendable {
    public let plan: WeeklyPlan
    public let diagnostics: PlannerDiagnostics
}

public enum PlannerFailure: Error, Equatable, Sendable {
    case invalidTimeZone
    case invalidLockedItem(String)
    case noFeasiblePlan(PlannerDiagnostics)
    case generatedPlanFailedValidation([PlanValidationIssue], PlannerDiagnostics)
}

public enum DeterministicPlanner {
    public static func generate(
        _ input: PlannerInput,
        configuration: PlannerConfiguration = PlannerConfiguration()
    ) throws -> PlannerResult {
        guard TimeZone(identifier: input.profile.timeZoneIdentifier) != nil else {
            throw PlannerFailure.invalidTimeZone
        }
        let slots = plannedSlots(profile: input.profile, includeOptionalSnack: input.includeOptionalSnack)
        let planID = "plan-\(stableHashHex(input.deterministicSeed + dateKey(input.weekStart)))"
        var rejectedCounts: [String: Int] = [:]
        var eligibleBySlot: [PlanSlot: [RecipeSnapshot]] = [:]

        for slot in slots {
            eligibleBySlot[slot] = input.recipes.filter { recipe in
                let issues = RecipeEligibilityPolicy.issues(for: recipe, profile: input.profile, slot: slot, configuration: configuration)
                if !issues.isEmpty {
                    for issue in issues { increment(rejectionReason(for: issue).rawValue, in: &rejectedCounts) }
                    return false
                }
                if recipe.activePreparationMinutes > input.profile.maximumActiveMinutes {
                    increment(PlannerRejectionReason.activeTimeExceeded.rawValue, in: &rejectedCounts)
                    return false
                }
                return true
            }.sorted(by: stableRecipeOrder)
        }

        var diagnostics = PlannerDiagnostics(
            generatorVersion: configuration.generatorVersion,
            scoringVersion: configuration.scoringVersion,
            ruleVersion: configuration.ruleVersion,
            deterministicSeed: input.deterministicSeed,
            candidatePoolSize: Set(eligibleBySlot.values.flatMap { $0.map(\.recipeID) }).count,
            eligibleCandidateCountBySlot: Dictionary(uniqueKeysWithValues: slots.map { ($0.rawValue, eligibleBySlot[$0]?.count ?? 0) }),
            rejectedCandidateCounts: rejectedCounts,
            selectedRecipeCount: 0,
            meanAbsoluteDailyCalorieDeviation: 0,
            meanAbsoluteDailyProteinDeviation: nil,
            totalCostPenalty: 0,
            totalIngredientReusePenalty: 0,
            mealTargetShares: Dictionary(uniqueKeysWithValues: slots.map { ($0.rawValue, configuration.mealTargetShares[$0, default: 0]) }),
            variety: nil,
            explanations: [],
            trigger: input.trigger,
            regenerationReason: input.regenerationReason
        )

        let lockedByPosition = try validatedLockedItems(input.lockedItems, input: input, slots: slots, configuration: configuration)
        var planDays: [PlanDay] = []
        var selectedItems: [PlanItem] = []
        var explanations: [PlanExplanation] = []

        for dayOffset in 0..<7 {
            guard let localDate = input.weekStart.adding(days: dayOffset, timeZoneIdentifier: input.profile.timeZoneIdentifier) else {
                throw PlannerFailure.invalidTimeZone
            }
            var dayItems: [PlanItem] = []
            for slot in slots {
                let position = PlannerPosition(dayOffset: dayOffset, slot: slot)
                if let locked = lockedByPosition[position] {
                    dayItems.append(locked)
                    selectedItems.append(locked)
                    explanations.append(PlanExplanation(planItemID: locked.id, code: .lockedByUser, message: "Kept because you locked this meal."))
                    continue
                }

                let itemID = "\(planID)-d\(dayOffset)-\(slot.rawValue)"
                if !isCookingDay(dayOffset, profile: input.profile),
                   input.profile.leftoverPreference != .avoid,
                   let leftover = selectLinkedLeftover(
                    itemID: itemID,
                    localDate: localDate,
                    slot: slot,
                    selectedItems: selectedItems,
                    recentRecipeIDs: input.recentRecipeIDs,
                    rules: configuration.varietyRules
                   ) {
                    dayItems.append(leftover.item)
                    selectedItems.append(leftover.item)
                    explanations.append(PlanExplanation(
                        planItemID: leftover.item.id,
                        code: .plannedLeftover,
                        message: "Planned reuse from \(leftover.source.recipeSnapshot.displayName) to reduce cooking and waste."
                    ))
                    continue
                }

                guard let candidates = eligibleBySlot[slot], !candidates.isEmpty else {
                    diagnostics.explanations = explanations
                    throw PlannerFailure.noFeasiblePlan(diagnostics)
                }
                let ranked = candidates.compactMap { recipe -> RankedRecipe? in
                    let candidateMeal = PlannedMeal(recipeID: recipe.recipeID, dominantIngredientIDs: recipe.dominantIngredientIDs)
                    let existingMeals = selectedItems.map { plannedMeal(from: $0) }
                    let variety = VarietyPolicy.score(
                        candidate: candidateMeal,
                        existingMeals: existingMeals,
                        recentRecipeIDs: input.recentRecipeIDs,
                        rules: configuration.varietyRules
                    )
                    let dominantCounts = counts(selectedItems.flatMap { $0.recipeSnapshot.dominantIngredientIDs })
                    let exceedsDominantLimit = recipe.dominantIngredientIDs.contains {
                        dominantCounts[$0, default: 0] >= configuration.varietyRules.maximumDominantIngredientAppearances
                    }
                    guard variety.isWithinExactRecipeLimit, !exceedsDominantLimit else {
                        increment(PlannerRejectionReason.varietyLimit.rawValue, in: &diagnostics.rejectedCandidateCounts)
                        return nil
                    }
                    let scoreBreakdown = PlannerScoringPolicy.score(
                        recipe: recipe,
                        profile: input.profile,
                        slot: slot,
                        activeSlots: slots,
                        configuration: configuration,
                        existingIngredientIDs: Set(selectedItems.flatMap { $0.recipeSnapshot.ingredients.map(\.ingredientID) })
                    )
                    var score = scoreBreakdown.total
                    score += variety.penalty
                    let cuisineMatch = matchesCuisinePreference(recipe, profile: input.profile)
                    let favorite = input.favoriteRecipeIDs.contains(recipe.recipeID)
                    if cuisineMatch { score -= configuration.cuisinePreferenceReward }
                    if favorite { score -= configuration.favoriteReward }
                    let tie = stableHash("\(input.deterministicSeed)|\(dateKey(localDate))|\(slot.rawValue)|\(recipe.recipeID)")
                    return RankedRecipe(recipe: recipe, score: score, tieBreaker: tie, variety: variety, cuisineMatch: cuisineMatch, favorite: favorite, breakdown: scoreBreakdown)
                }.sorted {
                    if $0.score != $1.score { return $0.score < $1.score }
                    if $0.tieBreaker != $1.tieBreaker { return $0.tieBreaker < $1.tieBreaker }
                    return stableRecipeOrder($0.recipe, $1.recipe)
                }
                guard let selected = ranked.first else {
                    diagnostics.explanations = explanations
                    throw PlannerFailure.noFeasiblePlan(diagnostics)
                }
                let batchID = "batch-\(itemID)"
                let relationship: LeftoverRelationship = isCookingDay(dayOffset, profile: input.profile) && input.profile.leftoverPreference != .avoid
                    ? .batchSource(batchID: batchID)
                    : .none
                let item = PlanItem(
                    id: itemID,
                    localDate: localDate,
                    slot: slot,
                    recipeSnapshot: selected.recipe,
                    servingMultiplier: selected.breakdown.servingMultiplier,
                    servingQuantityGrams: selected.recipe.servingSizeGrams * selected.breakdown.servingMultiplier,
                    nutrition: PlannerScoringPolicy.nutrition(selected.recipe.nutritionPerServing, multiplier: selected.breakdown.servingMultiplier),
                    leftoverRelationship: relationship
                )
                dayItems.append(item)
                selectedItems.append(item)
                diagnostics.totalCostPenalty = (diagnostics.totalCostPenalty ?? 0) + selected.breakdown.costPenalty
                diagnostics.totalIngredientReusePenalty = (diagnostics.totalIngredientReusePenalty ?? 0) + selected.breakdown.ingredientReusePenalty
                if case .batchSource = relationship {
                    explanations.append(PlanExplanation(planItemID: item.id, code: .batchOpportunity, message: "Cook an extra portion for a later planned meal."))
                }
                if selected.cuisineMatch {
                    explanations.append(PlanExplanation(planItemID: item.id, code: .cuisinePreference, message: "Matches one of your preferred cuisines."))
                }
                if selected.favorite {
                    explanations.append(PlanExplanation(planItemID: item.id, code: .favorite, message: "Ranked higher because you marked this recipe as a favorite."))
                }
                if selected.variety.isRecentRecipe {
                    explanations.append(PlanExplanation(planItemID: item.id, code: .recentRecipePenalty, message: "Recent-meal fatigue was applied before this recipe was selected."))
                }
                if selected.breakdown.servingMultiplier != 1 {
                    explanations.append(PlanExplanation(planItemID: item.id, code: .servingAdjusted, message: "Serving adjusted within this recipe’s reviewed bounds."))
                }
            }
            planDays.append(PlanDay(localDate: localDate, items: dayItems))
        }

        var plan = WeeklyPlan(
            id: planID,
            timeZoneIdentifier: input.profile.timeZoneIdentifier,
            days: planDays,
            targetSnapshot: PlanTargetSnapshot(
                dailyCalories: input.profile.calorieTarget,
                optionalDailyProteinGrams: input.profile.optionalDailyProteinTargetGrams,
                targetSource: input.profile.targetSource,
                targetVersion: input.profile.targetEstimatorVersion
            ),
            generatorVersion: configuration.generatorVersion,
            scoringVersion: configuration.scoringVersion,
            ruleVersion: configuration.ruleVersion
        )
        let optimized = optimizeWeeklyServings(
            plan: plan,
            profile: input.profile,
            configuration: configuration,
            lockedItemIDs: Set(input.lockedItems.map(\.item.id))
        )
        plan = optimized.plan
        selectedItems = plan.days.flatMap(\.items)
        explanations.removeAll { $0.code == .servingAdjusted }
        for item in selectedItems where item.servingMultiplier != 1 {
            explanations.append(PlanExplanation(
                planItemID: item.id,
                code: .servingAdjusted,
                message: "Serving adjusted within this recipe’s reviewed bounds after whole-week target optimization."
            ))
        }
        diagnostics.toleranceEvaluation = optimized.evaluation
        let variety = VarietyPolicy.analyze(
            meals: selectedItems.map { plannedMeal(from: $0) },
            recentRecipeIDs: input.recentRecipeIDs,
            rules: configuration.varietyRules
        )
        diagnostics.selectedRecipeCount = Set(selectedItems.map { $0.recipeSnapshot.recipeID }).count
        diagnostics.variety = variety
        diagnostics.explanations = explanations
        diagnostics.meanAbsoluteDailyCalorieDeviation = meanDailyCalorieDeviation(plan)
        diagnostics.meanAbsoluteDailyProteinDeviation = meanDailyProteinDeviation(plan)
        let quality = planQualityDiagnostics(plan)
        diagnostics.ingredientReusePercentage = quality.ingredientReusePercentage
        diagnostics.activeCookingMinutesByDay = quality.activeCookingMinutesByDay
        diagnostics.cookingSessionCount = quality.cookingSessionCount
        diagnostics.estimatedWasteGrams = quality.estimatedWasteGrams
        diagnostics.estimatedWasteCoveragePercentage = quality.estimatedWasteCoveragePercentage
        let validationIssues = WeeklyPlanValidator.issues(for: plan, profile: input.profile, recentRecipeIDs: input.recentRecipeIDs, configuration: configuration)
        guard validationIssues.isEmpty else {
            throw PlannerFailure.generatedPlanFailedValidation(validationIssues, diagnostics)
        }
        return PlannerResult(plan: plan, diagnostics: diagnostics)
    }

    private static func optimizeWeeklyServings(
        plan: WeeklyPlan,
        profile: UserProfile,
        configuration: PlannerConfiguration,
        lockedItemIDs: Set<String>
    ) -> (plan: WeeklyPlan, evaluation: PlannerToleranceEvaluation) {
        var optimized = plan
        let groups = servingGroups(in: optimized)
        var objective = toleranceObjective(plan: optimized, profile: profile, configuration: configuration)
        var changed = true
        var pass = 0
        while changed && pass < 4 {
            changed = false
            pass += 1
            for group in groups where lockedItemIDs.isDisjoint(with: group.itemIDs) {
                guard let source = optimized.days.flatMap(\.items).first(where: { $0.id == group.sourceItemID }) else { continue }
                var bestPlan = optimized
                var bestObjective = objective
                var improved = false
                for multiplier in PlannerScoringPolicy.reviewedServingMultipliers(
                    for: source.recipeSnapshot,
                    stepPercent: configuration.servingMultiplierStepPercent
                ) {
                    let candidate = applyingServingMultiplier(multiplier, to: group.itemIDs, in: optimized)
                    let candidateObjective = toleranceObjective(plan: candidate, profile: profile, configuration: configuration)
                    if isBetterObjective(candidateObjective, than: bestObjective) {
                        bestPlan = candidate
                        bestObjective = candidateObjective
                        improved = true
                    }
                }
                if improved {
                    optimized = bestPlan
                    objective = bestObjective
                    changed = true
                }
            }
        }
        return (
            optimized,
            toleranceEvaluation(plan: optimized, profile: profile, configuration: configuration, optimizationPasses: pass)
        )
    }

    private static func servingGroups(in plan: WeeklyPlan) -> [ServingGroup] {
        let items = plan.days.flatMap(\.items)
        var reusesBySource: [String: Set<String>] = [:]
        for item in items {
            guard case let .plannedReuse(_, sourceID) = item.leftoverRelationship else { continue }
            reusesBySource[sourceID, default: []].insert(item.id)
        }
        return items.compactMap { item in
            if case .plannedReuse = item.leftoverRelationship { return nil }
            return ServingGroup(sourceItemID: item.id, itemIDs: Set([item.id]).union(reusesBySource[item.id, default: []]))
        }
    }

    private static func applyingServingMultiplier(_ multiplier: Decimal, to itemIDs: Set<String>, in source: WeeklyPlan) -> WeeklyPlan {
        var result = source
        for dayIndex in result.days.indices {
            for itemIndex in result.days[dayIndex].items.indices where itemIDs.contains(result.days[dayIndex].items[itemIndex].id) {
                var item = result.days[dayIndex].items[itemIndex]
                item.servingMultiplier = multiplier
                item.servingQuantityGrams = item.recipeSnapshot.servingSizeGrams * multiplier
                item.nutrition = PlannerScoringPolicy.nutrition(item.recipeSnapshot.nutritionPerServing, multiplier: multiplier)
                result.days[dayIndex].items[itemIndex] = item
            }
        }
        return result
    }

    private static func toleranceObjective(
        plan: WeeklyPlan,
        profile: UserProfile,
        configuration: PlannerConfiguration
    ) -> [Decimal] {
        let evaluation = toleranceEvaluation(plan: plan, profile: profile, configuration: configuration, optimizationPasses: 0)
        let calorieDeviation = plan.days.reduce(Decimal.zero) {
            $0 + magnitude($1.nutrition.calories - Decimal(profile.calorieTarget))
        }
        let proteinDeviation = profile.optionalDailyProteinTargetGrams.map { target in
            plan.days.reduce(Decimal.zero) { $0 + magnitude($1.nutrition.proteinGrams - Decimal(target)) }
        } ?? 0
        let multiplierDistance = plan.days.flatMap(\.items).reduce(Decimal.zero) {
            $0 + magnitude($1.servingMultiplier - 1)
        }
        return [
            evaluation.weeklyCaloriesWithinTolerance ? 0 : 1,
            evaluation.weeklyCalorieExcess,
            Decimal(7 - evaluation.dailyCaloriesWithinToleranceCount),
            evaluation.dailyCalorieExcess,
            Decimal(evaluation.optionalProteinOutsideToleranceDayCount),
            calorieDeviation,
            proteinDeviation,
            multiplierDistance,
        ]
    }

    private static func isBetterObjective(_ left: [Decimal], than right: [Decimal]) -> Bool {
        for (leftValue, rightValue) in zip(left, right) where leftValue != rightValue {
            return leftValue < rightValue
        }
        return false
    }

    private static func toleranceEvaluation(
        plan: WeeklyPlan,
        profile: UserProfile,
        configuration: PlannerConfiguration,
        optimizationPasses: Int
    ) -> PlannerToleranceEvaluation {
        let dailyAllowed = Decimal(profile.calorieTarget * configuration.dailyCalorieTolerancePercent) / 100
        let dailyDeviations = plan.days.map { magnitude($0.nutrition.calories - Decimal(profile.calorieTarget)) }
        let weeklyTarget = Decimal(profile.calorieTarget * plan.days.count)
        let weeklyAllowed = weeklyTarget * Decimal(configuration.weeklyCalorieTolerancePercent) / 100
        let weeklyDeviation = magnitude(plan.days.reduce(Decimal.zero) { $0 + $1.nutrition.calories } - weeklyTarget)
        let proteinAllowed = Decimal((profile.optionalDailyProteinTargetGrams ?? 0) * configuration.optionalProteinTolerancePercent) / 100
        let proteinDeviations = profile.optionalDailyProteinTargetGrams.map { target in
            plan.days.map { magnitude($0.nutrition.proteinGrams - Decimal(target)) }
        } ?? []
        let dailyWithin = dailyDeviations.filter { $0 <= dailyAllowed }.count
        let weeklyWithin = weeklyDeviation <= weeklyAllowed
        let proteinOutside = proteinDeviations.filter { $0 > proteinAllowed }.count
        var relaxations: [String] = []
        if proteinOutside > 0 { relaxations.append("optional_protein") }
        if dailyWithin < plan.days.count { relaxations.append("daily_calories") }
        if !weeklyWithin { relaxations.append("weekly_calories") }
        return PlannerToleranceEvaluation(
            contractVersion: "planner-tolerance-v1",
            dailyCalorieTolerancePercent: configuration.dailyCalorieTolerancePercent,
            weeklyCalorieTolerancePercent: configuration.weeklyCalorieTolerancePercent,
            optionalProteinTolerancePercent: configuration.optionalProteinTolerancePercent,
            dailyCaloriesWithinToleranceCount: dailyWithin,
            dailyCalorieExcess: dailyDeviations.reduce(Decimal.zero) { $0 + positive($1 - dailyAllowed) },
            weeklyCaloriesWithinTolerance: weeklyWithin,
            weeklyCalorieExcess: positive(weeklyDeviation - weeklyAllowed),
            optionalProteinOutsideToleranceDayCount: proteinOutside,
            dailyCalorieAbsoluteDeviationPercentages: dailyDeviations.map { percentage($0, of: Decimal(profile.calorieTarget)) },
            weeklyCalorieAbsoluteDeviationPercent: percentage(weeklyDeviation, of: weeklyTarget),
            optionalProteinAbsoluteDeviationGrams: proteinDeviations,
            relaxations: relaxations,
            optimizationPasses: optimizationPasses
        )
    }

    private static func magnitude(_ value: Decimal) -> Decimal { value < 0 ? -value : value }
    private static func positive(_ value: Decimal) -> Decimal { value > 0 ? value : 0 }
    private static func percentage(_ numerator: Decimal, of denominator: Decimal) -> Decimal {
        denominator > 0 ? numerator * 100 / denominator : 0
    }

    private static func planQualityDiagnostics(_ plan: WeeklyPlan) -> (
        ingredientReusePercentage: Double,
        activeCookingMinutesByDay: [String: Int],
        cookingSessionCount: Int,
        estimatedWasteGrams: Double?,
        estimatedWasteCoveragePercentage: Double
    ) {
        var ingredientMealCounts: [String: Int] = [:]
        var purchasedGrams: [String: Double] = [:]
        var packSizes: [String: Double] = [:]
        var activeCookingMinutesByDay: [String: Int] = [:]
        var cookingSessionCount = 0
        for day in plan.days {
            var activeMinutes = 0
            for item in day.items {
                let mealIngredientIDs = Set(item.recipeSnapshot.ingredients.map { normalized($0.ingredientID) }.filter { !$0.isEmpty })
                for ingredientID in mealIngredientIDs { ingredientMealCounts[ingredientID, default: 0] += 1 }
                if case .plannedReuse = item.leftoverRelationship { continue }
                cookingSessionCount += 1
                activeMinutes += item.recipeSnapshot.activePreparationMinutes
                for ingredient in item.recipeSnapshot.ingredients {
                    let ingredientID = normalized(ingredient.ingredientID)
                    guard !ingredientID.isEmpty else { continue }
                    purchasedGrams[ingredientID, default: 0] += decimalDouble(ingredient.grams * item.servingMultiplier)
                    if let packSize = ingredient.purchasePackSizeGrams {
                        let value = decimalDouble(packSize)
                        if value > 0, packSizes[ingredientID] == nil { packSizes[ingredientID] = value }
                    }
                }
            }
            activeCookingMinutesByDay[dateKey(day.localDate)] = activeMinutes
        }
        let reusedIngredientCount = ingredientMealCounts.values.filter { $0 >= 2 }.count
        let reusePercentage = ingredientMealCounts.isEmpty
            ? 0
            : Double(reusedIngredientCount) * 100 / Double(ingredientMealCounts.count)
        let estimatedWaste: Double? = packSizes.isEmpty ? nil : purchasedGrams.reduce(0.0) { partial, entry in
            guard let packSize = packSizes[entry.key] else { return partial }
            return partial + max(0, ceil(entry.value / packSize) * packSize - entry.value)
        }
        let wasteCoverage = purchasedGrams.isEmpty
            ? 0
            : Double(packSizes.count) * 100 / Double(purchasedGrams.count)
        return (reusePercentage, activeCookingMinutesByDay, cookingSessionCount, estimatedWaste, wasteCoverage)
    }

    private static func plannedSlots(profile: UserProfile, includeOptionalSnack: Bool) -> [PlanSlot] {
        var slots: [PlanSlot] = []
        if profile.enabledMealSlots.contains(.breakfast) { slots.append(.breakfast) }
        if profile.enabledMealSlots.contains(.lunch) { slots.append(.lunch) }
        if profile.enabledMealSlots.contains(.dinner) { slots.append(.dinner) }
        if profile.snackPreference == .planned || (profile.snackPreference == .optional && includeOptionalSnack) { slots.append(.snack) }
        return slots
    }

    private static func validatedLockedItems(
        _ lockedItems: [LockedPlannerItem],
        input: PlannerInput,
        slots: [PlanSlot],
        configuration: PlannerConfiguration
    ) throws -> [PlannerPosition: PlanItem] {
        var positions: [PlannerPosition: PlanItem] = [:]
        for locked in lockedItems {
            guard (0..<7).contains(locked.dayOffset), slots.contains(locked.item.slot),
                  let expectedDate = input.weekStart.adding(days: locked.dayOffset, timeZoneIdentifier: input.profile.timeZoneIdentifier),
                  expectedDate == locked.item.localDate,
                  RecipeEligibilityPolicy.isEligible(locked.item.recipeSnapshot, profile: input.profile, slot: locked.item.slot, configuration: configuration),
                  RecipeEligibilityPolicy.servingMultiplier(locked.item.servingMultiplier, isAllowedFor: locked.item.recipeSnapshot),
                  locked.item.recipeSnapshot.activePreparationMinutes <= input.profile.maximumActiveMinutes else {
                throw PlannerFailure.invalidLockedItem(locked.item.id)
            }
            let position = PlannerPosition(dayOffset: locked.dayOffset, slot: locked.item.slot)
            guard positions[position] == nil else { throw PlannerFailure.invalidLockedItem(locked.item.id) }
            positions[position] = locked.item
        }
        return positions
    }

    private static func selectLinkedLeftover(
        itemID: String,
        localDate: LocalDate,
        slot: PlanSlot,
        selectedItems: [PlanItem],
        recentRecipeIDs: Set<String>,
        rules: VarietyRules
    ) -> (item: PlanItem, source: PlanItem)? {
        let existingMeals = selectedItems.map { plannedMeal(from: $0) }
        let dominantCounts = counts(selectedItems.flatMap { $0.recipeSnapshot.dominantIngredientIDs })
        for source in selectedItems.reversed() where source.slot == slot {
            guard case let .batchSource(batchID) = source.leftoverRelationship else { continue }
            let reuseCount = selectedItems.filter {
                if case let .plannedReuse(existingBatchID, _) = $0.leftoverRelationship { return existingBatchID == batchID }
                return false
            }.count
            guard reuseCount < rules.maximumIntentionalLeftoversPerRecipe else { continue }
            let candidate = PlannedMeal(
                recipeID: source.recipeSnapshot.recipeID,
                dominantIngredientIDs: source.recipeSnapshot.dominantIngredientIDs,
                reuse: .leftover(batchID: batchID)
            )
            let variety = VarietyPolicy.score(candidate: candidate, existingMeals: existingMeals, recentRecipeIDs: recentRecipeIDs, rules: rules)
            let exceedsDominantLimit = source.recipeSnapshot.dominantIngredientIDs.contains {
                dominantCounts[$0, default: 0] >= rules.maximumDominantIngredientAppearances
            }
            guard variety.isLinkedLeftover, !exceedsDominantLimit else { continue }
            return (
                PlanItem(
                    id: itemID,
                    localDate: localDate,
                    slot: slot,
                    recipeSnapshot: source.recipeSnapshot,
                    servingMultiplier: source.servingMultiplier,
                    servingQuantityGrams: source.servingQuantityGrams,
                    nutrition: source.nutrition,
                    leftoverRelationship: .plannedReuse(batchID: batchID, sourcePlanItemID: source.id)
                ),
                source
            )
        }
        return nil
    }

    private static func matchesCuisinePreference(_ recipe: RecipeSnapshot, profile: UserProfile) -> Bool {
        let preferences = Set(profile.cuisines.map(normalized))
        let tags = Set(recipe.tags.map { normalized($0.replacingOccurrences(of: "cuisine:", with: "")) })
        return !preferences.intersection(tags).isEmpty
    }

    private static func meanDailyCalorieDeviation(_ plan: WeeklyPlan) -> Double {
        guard !plan.days.isEmpty else { return 0 }
        let target = Double(plan.targetSnapshot.dailyCalories)
        let total = plan.days.reduce(0.0) { partial, day in
            partial + abs(Double(truncating: NSDecimalNumber(decimal: day.nutrition.calories)) - target)
        }
        return total / Double(plan.days.count)
    }

    private static func meanDailyProteinDeviation(_ plan: WeeklyPlan) -> Double? {
        guard let targetValue = plan.targetSnapshot.optionalDailyProteinGrams, !plan.days.isEmpty else { return nil }
        let target = Double(targetValue)
        let total = plan.days.reduce(0.0) { partial, day in
            partial + abs(Double(truncating: NSDecimalNumber(decimal: day.nutrition.proteinGrams)) - target)
        }
        return total / Double(plan.days.count)
    }

    private static func isCookingDay(_ dayOffset: Int, profile: UserProfile) -> Bool {
        profile.cookingDays.contains(dayOffset + 1)
    }

    private static func plannedMeal(from item: PlanItem) -> PlannedMeal {
        let reuse: MealReuse
        switch item.leftoverRelationship {
        case .none: reuse = .fresh(batchID: nil)
        case let .batchSource(batchID): reuse = .fresh(batchID: batchID)
        case let .plannedReuse(batchID, _): reuse = .leftover(batchID: batchID)
        }
        return PlannedMeal(recipeID: item.recipeSnapshot.recipeID, dominantIngredientIDs: item.recipeSnapshot.dominantIngredientIDs, reuse: reuse)
    }

    private static func rejectionReason(for issue: RecipeEligibilityIssue) -> PlannerRejectionReason {
        switch issue {
        case .notPublished: .notPublished
        case .nutritionReviewNotApproved: .nutritionReviewNotApproved
        case .localeUnavailable: .localeUnavailable
        case .nutritionCalculationVersionStale: .nutritionCalculationVersionStale
        case .dietMismatch: .dietMismatch
        case .allergenConflict: .allergenConflict
        case .ingredientExclusion: .ingredientExclusion
        case .dislikedIngredient: .dislikedIngredient
        case .mealSlotMismatch: .mealSlotMismatch
        case .equipmentUnavailable: .equipmentUnavailable
        case .invalidServingBounds: .invalidServingBounds
        }
    }

    private static func increment(_ key: String, in counts: inout [String: Int]) {
        counts[key, default: 0] += 1
    }

    private static func counts<S: Sequence>(_ values: S) -> [S.Element: Int] where S.Element: Hashable {
        values.reduce(into: [:]) { $0[$1, default: 0] += 1 }
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

    private static func stableRecipeOrder(_ left: RecipeSnapshot, _ right: RecipeSnapshot) -> Bool {
        if left.recipeID != right.recipeID { return left.recipeID < right.recipeID }
        return left.version < right.version
    }

    private static func dateKey(_ date: LocalDate) -> String {
        String(format: "%04d-%02d-%02d", date.year, date.month, date.day)
    }

    private static func stableHashHex(_ value: String) -> String {
        String(stableHash(value), radix: 16)
    }

    private static func stableHash(_ value: String) -> UInt64 {
        value.utf8.reduce(14_695_981_039_346_656_037) { hash, byte in
            (hash ^ UInt64(byte)) &* 1_099_511_628_211
        }
    }
}

private struct PlannerPosition: Hashable {
    let dayOffset: Int
    let slot: PlanSlot
}

private struct ServingGroup {
    let sourceItemID: String
    let itemIDs: Set<String>
}

private struct RankedRecipe {
    let recipe: RecipeSnapshot
    let score: Int
    let tieBreaker: UInt64
    let variety: CandidateVarietyScore
    let cuisineMatch: Bool
    let favorite: Bool
    let breakdown: PlannerScoreBreakdown
}
