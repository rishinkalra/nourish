import Foundation

public enum MealReuse: Equatable, Sendable {
    case fresh(batchID: String?)
    case leftover(batchID: String)
}

public struct PlannedMeal: Equatable, Sendable {
    public var recipeID: String
    public var dominantIngredientIDs: Set<String>
    public var reuse: MealReuse

    public init(recipeID: String, dominantIngredientIDs: Set<String>, reuse: MealReuse = .fresh(batchID: nil)) {
        self.recipeID = recipeID
        self.dominantIngredientIDs = dominantIngredientIDs
        self.reuse = reuse
    }
}

public struct VarietyRules: Codable, Equatable, Sendable {
    public var maximumFreshRecipeAppearances = 1
    public var maximumDominantIngredientAppearances = 3
    public var maximumIntentionalLeftoversPerRecipe = 2
    public var exactRepeatPenalty = 45
    public var dominantIngredientPenalty = 12
    public var recentRecipePenalty = 25
    public var linkedLeftoverReward = 30

    public init() {}
}

public struct VarietyDiagnostics: Codable, Equatable, Sendable {
    public var passed: Bool
    public var accidentalExactRepeats: Int
    public var intentionalLeftovers: Int
    public var peakDominantIngredientAppearances: Int
    public var recentRecipeMatches: Set<String>
}

public struct CandidateVarietyScore: Equatable, Sendable {
    public var penalty: Int
    public var isLinkedLeftover: Bool
    public var isRecentRecipe: Bool
    public var isWithinExactRecipeLimit: Bool
}

public enum VarietyPolicy {
    public static func analyze(
        meals: [PlannedMeal],
        recentRecipeIDs: Set<String> = [],
        rules: VarietyRules = VarietyRules()
    ) -> VarietyDiagnostics {
        let freshMeals = meals.filter { if case .fresh = $0.reuse { true } else { false } }
        let leftoverMeals = meals.filter { if case .leftover = $0.reuse { true } else { false } }
        let freshCounts = counts(freshMeals.map(\.recipeID))
        let leftoverCounts = counts(leftoverMeals.map(\.recipeID))
        let ingredientCounts = counts(meals.flatMap(\.dominantIngredientIDs))

        let accidentalRepeats = freshCounts.values.reduce(0) { total, count in
            total + max(0, count - rules.maximumFreshRecipeAppearances)
        }
        let excessiveLeftovers = leftoverCounts.values.contains { $0 > rules.maximumIntentionalLeftoversPerRecipe }
        let excessiveIngredients = ingredientCounts.values.contains { $0 > rules.maximumDominantIngredientAppearances }
        let recentMatches = Set(freshMeals.map(\.recipeID)).intersection(recentRecipeIDs)

        return VarietyDiagnostics(
            passed: accidentalRepeats == 0 && !excessiveLeftovers && !excessiveIngredients,
            accidentalExactRepeats: accidentalRepeats,
            intentionalLeftovers: leftoverMeals.count,
            peakDominantIngredientAppearances: ingredientCounts.values.max() ?? 0,
            recentRecipeMatches: recentMatches
        )
    }

    public static func score(
        candidate: PlannedMeal,
        existingMeals: [PlannedMeal],
        recentRecipeIDs: Set<String> = [],
        rules: VarietyRules = VarietyRules()
    ) -> CandidateVarietyScore {
        let freshRecipeCount = existingMeals.filter { meal in
            guard meal.recipeID == candidate.recipeID else { return false }
            if case .fresh = meal.reuse { return true }
            return false
        }.count
        let linkedLeftover: Bool = {
            guard case let .leftover(batchID) = candidate.reuse else { return false }
            return existingMeals.contains { meal in
                switch meal.reuse {
                case let .fresh(existingBatch): existingBatch == batchID
                case let .leftover(existingBatch): existingBatch == batchID
                }
            }
        }()
        let ingredientCounts = counts(existingMeals.flatMap(\.dominantIngredientIDs))
        let dominantPressure = candidate.dominantIngredientIDs.filter {
            ingredientCounts[$0, default: 0] >= rules.maximumDominantIngredientAppearances - 1
        }.count
        let recent = recentRecipeIDs.contains(candidate.recipeID)
        let penalty =
            (linkedLeftover ? -rules.linkedLeftoverReward : freshRecipeCount * rules.exactRepeatPenalty) +
            dominantPressure * rules.dominantIngredientPenalty +
            (recent ? rules.recentRecipePenalty : 0)

        return CandidateVarietyScore(
            penalty: penalty,
            isLinkedLeftover: linkedLeftover,
            isRecentRecipe: recent,
            isWithinExactRecipeLimit: linkedLeftover || freshRecipeCount < rules.maximumFreshRecipeAppearances
        )
    }

    private static func counts<S: Sequence>(_ values: S) -> [S.Element: Int] where S.Element: Hashable {
        values.reduce(into: [:]) { $0[$1, default: 0] += 1 }
    }
}
