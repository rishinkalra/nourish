import Foundation

public enum GroceryCategory: String, Codable, CaseIterable, Hashable, Sendable {
    case produce
    case dairy
    case protein
    case grains
    case pantry
    case spices
    case other

    public var displayName: String {
        switch self {
        case .produce: "Produce"
        case .dairy: "Dairy"
        case .protein: "Protein"
        case .grains: "Grains"
        case .pantry: "Pantry"
        case .spices: "Spices"
        case .other: "Other"
        }
    }
}

public enum GroceryItemDisposition: String, Codable, Sendable {
    case needed
    case checked
    case alreadyHave
}

public struct HouseholdQuantityTotal: Codable, Equatable, Sendable {
    public var unit: String
    public var quantity: Decimal

    public init(unit: String, quantity: Decimal) {
        self.unit = unit
        self.quantity = quantity
    }
}

public struct GroceryItem: Identifiable, Codable, Equatable, Sendable {
    public var id: String
    public var ingredientID: String
    public var displayName: String
    public var category: GroceryCategory
    public var requiredGrams: Decimal
    public var householdQuantities: [HouseholdQuantityTotal]
    public var userAdjustedGrams: Decimal?
    public var disposition: GroceryItemDisposition
    public var changedBySwap: Bool
    public var newlyAddedBySwap: Bool

    public init(
        id: String,
        ingredientID: String,
        displayName: String,
        category: GroceryCategory,
        requiredGrams: Decimal,
        householdQuantities: [HouseholdQuantityTotal],
        userAdjustedGrams: Decimal? = nil,
        disposition: GroceryItemDisposition = .needed,
        changedBySwap: Bool = false,
        newlyAddedBySwap: Bool = false
    ) {
        self.id = id
        self.ingredientID = ingredientID
        self.displayName = displayName
        self.category = category
        self.requiredGrams = requiredGrams
        self.householdQuantities = householdQuantities
        self.userAdjustedGrams = userAdjustedGrams
        self.disposition = disposition
        self.changedBySwap = changedBySwap
        self.newlyAddedBySwap = newlyAddedBySwap
    }

    public var effectiveGrams: Decimal { userAdjustedGrams ?? requiredGrams }
}

public struct GroceryList: Identifiable, Codable, Equatable, Sendable {
    public var id: String
    public var planID: String
    public var items: [GroceryItem]

    public init(id: String, planID: String, items: [GroceryItem]) {
        self.id = id
        self.planID = planID
        self.items = items
    }
}

public struct GroceryCategoryConfiguration: Codable, Equatable, Sendable {
    public var categoryByIngredientID: [String: GroceryCategory]

    public init(categoryByIngredientID: [String: GroceryCategory] = [:]) {
        self.categoryByIngredientID = categoryByIngredientID
    }
}

public enum GroceryListDeriver {
    public static func derive(
        from plan: WeeklyPlan,
        categoryConfiguration: GroceryCategoryConfiguration = GroceryCategoryConfiguration(),
        preserving previous: GroceryList? = nil
    ) -> GroceryList {
        struct Accumulator {
            var ingredientID: String
            var displayName: String
            var grams: Decimal = 0
            var householdByUnit: [String: Decimal] = [:]
        }

        var grouped: [String: Accumulator] = [:]
        for item in plan.days.flatMap(\.items) {
            // Planned reuses consume food prepared by their batch source; counting them again
            // would double the shopping quantity.
            if case .plannedReuse = item.leftoverRelationship { continue }
            for ingredient in item.recipeSnapshot.ingredients {
                let key = normalized(ingredient.ingredientID)
                let multiplier = item.servingMultiplier
                var value = grouped[key] ?? Accumulator(
                    ingredientID: ingredient.ingredientID,
                    displayName: ingredient.displayName
                )
                value.grams += ingredient.grams * multiplier
                let unit = ingredient.householdUnit.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                if !unit.isEmpty {
                    value.householdByUnit[unit, default: 0] += ingredient.householdQuantity * multiplier
                }
                grouped[key] = value
            }
        }

        let previousByIngredient = Dictionary(uniqueKeysWithValues: (previous?.items ?? []).map { (normalized($0.ingredientID), $0) })
        let hasPrevious = previous != nil
        let items = grouped.values.map { value in
            let key = normalized(value.ingredientID)
            let old = previousByIngredient[key]
            return GroceryItem(
                id: "\(plan.id)-ingredient-\(key)",
                ingredientID: value.ingredientID,
                displayName: value.displayName,
                category: categoryConfiguration.categoryByIngredientID[key] ?? inferredCategory(
                    ingredientID: value.ingredientID,
                    displayName: value.displayName
                ),
                requiredGrams: value.grams,
                householdQuantities: value.householdByUnit
                    .map { HouseholdQuantityTotal(unit: $0.key, quantity: $0.value) }
                    .sorted { $0.unit < $1.unit },
                userAdjustedGrams: old?.userAdjustedGrams,
                disposition: old?.disposition ?? .needed,
                changedBySwap: old.map { $0.requiredGrams != value.grams } ?? false,
                newlyAddedBySwap: hasPrevious && old == nil
            )
        }.sorted {
            if $0.category.rawValue != $1.category.rawValue { return $0.category.rawValue < $1.category.rawValue }
            return $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending
        }
        return GroceryList(id: "grocery-\(plan.id)", planID: plan.id, items: items)
    }

    private static func inferredCategory(ingredientID: String, displayName: String) -> GroceryCategory {
        let text = normalized("\(ingredientID) \(displayName)")
        if containsAny(text, ["spinach", "tomato", "onion", "vegetable", "mushroom", "lemon", "greens", "fruit"]) { return .produce }
        if containsAny(text, ["paneer", "milk", "curd", "yogurt", "cheese"]) { return .dairy }
        if containsAny(text, ["tofu", "dal", "lentil", "bean", "chana", "rajma", "moong", "egg"]) { return .protein }
        if containsAny(text, ["rice", "atta", "wheat", "oat", "millet", "quinoa", "ragi", "poha"]) { return .grains }
        if containsAny(text, ["spice", "masala", "cumin", "turmeric", "chilli", "pepper", "salt"]) { return .spices }
        if containsAny(text, ["oil", "vinegar", "flour", "sugar"]) { return .pantry }
        return .other
    }

    private static func containsAny(_ text: String, _ values: [String]) -> Bool {
        values.contains(where: text.contains)
    }

    private static func normalized(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}

public struct PrepTask: Identifiable, Codable, Equatable, Sendable {
    public var id: String
    public var localDate: LocalDate
    public var title: String
    public var activeMinutes: Int
    public var storageNote: String
    public var reuseNote: String
    public var sourcePlanItemIDs: [String]
    public var isComplete: Bool

    public init(
        id: String,
        localDate: LocalDate,
        title: String,
        activeMinutes: Int,
        storageNote: String,
        reuseNote: String,
        sourcePlanItemIDs: [String],
        isComplete: Bool = false
    ) {
        self.id = id
        self.localDate = localDate
        self.title = title
        self.activeMinutes = activeMinutes
        self.storageNote = storageNote
        self.reuseNote = reuseNote
        self.sourcePlanItemIDs = sourcePlanItemIDs
        self.isComplete = isComplete
    }
}

public struct PrepTimeline: Codable, Equatable, Sendable {
    public var planID: String
    public var tasks: [PrepTask]

    public init(planID: String, tasks: [PrepTask]) {
        self.planID = planID
        self.tasks = tasks
    }
}

public enum PrepTimelineDeriver {
    public static func derive(from plan: WeeklyPlan, preserving previous: PrepTimeline? = nil) -> PrepTimeline {
        let allItems = plan.days.flatMap(\.items)
        let previousCompletion = Dictionary(uniqueKeysWithValues: (previous?.tasks ?? []).map { ($0.id, $0.isComplete) })
        let tasks = allItems.compactMap { item -> PrepTask? in
            guard case let .batchSource(batchID) = item.leftoverRelationship else { return nil }
            let reuses = allItems.filter {
                guard case let .plannedReuse(reuseBatchID, sourceID) = $0.leftoverRelationship else { return false }
                return reuseBatchID == batchID && sourceID == item.id
            }
            guard !reuses.isEmpty else { return nil }
            let reuseSummary = reuses
                .sorted { ($0.localDate, $0.slot.rawValue) < ($1.localDate, $1.slot.rawValue) }
                .map { "\(dateKey($0.localDate)) \($0.slot.rawValue)" }
                .joined(separator: ", ")
            let taskID = "prep-\(plan.id)-\(batchID)"
            return PrepTask(
                id: taskID,
                localDate: item.localDate,
                title: "Prepare \(item.recipeSnapshot.displayName) batch",
                activeMinutes: item.recipeSnapshot.activePreparationMinutes,
                storageNote: "Cool promptly, refrigerate in sealed shallow containers, and use within the reviewed storage window.",
                reuseNote: "Reserve \(reuses.count) planned portion\(reuses.count == 1 ? "" : "s") for \(reuseSummary).",
                sourcePlanItemIDs: [item.id] + reuses.map(\.id),
                isComplete: previousCompletion[taskID] ?? false
            )
        }.sorted { ($0.localDate, $0.title) < ($1.localDate, $1.title) }
        return PrepTimeline(planID: plan.id, tasks: tasks)
    }

    private static func dateKey(_ date: LocalDate) -> String {
        String(format: "%04d-%02d-%02d", date.year, date.month, date.day)
    }
}

public struct WeeklyLoopSnapshot: Codable, Equatable, Sendable {
    public var plan: WeeklyPlan
    public var groceryList: GroceryList
    public var prepTimeline: PrepTimeline
    public var revision: Int
    public var lastMutationID: String?

    public init(plan: WeeklyPlan, groceryList: GroceryList, prepTimeline: PrepTimeline, revision: Int = 1, lastMutationID: String? = nil) {
        self.plan = plan
        self.groceryList = groceryList
        self.prepTimeline = prepTimeline
        self.revision = revision
        self.lastMutationID = lastMutationID
    }

    public static func materialize(plan: WeeklyPlan) -> WeeklyLoopSnapshot {
        WeeklyLoopSnapshot(
            plan: plan,
            groceryList: GroceryListDeriver.derive(from: plan),
            prepTimeline: PrepTimelineDeriver.derive(from: plan)
        )
    }
}

public struct SwapCandidate: Codable, Equatable, Sendable {
    public var recipe: RecipeSnapshot
    public var calorieDelta: Decimal
    public var proteinDeltaGrams: Decimal
    public var servingMultiplier: Decimal?

    public init(recipe: RecipeSnapshot, calorieDelta: Decimal, proteinDeltaGrams: Decimal, servingMultiplier: Decimal? = nil) {
        self.recipe = recipe
        self.calorieDelta = calorieDelta
        self.proteinDeltaGrams = proteinDeltaGrams
        self.servingMultiplier = servingMultiplier
    }
}

public struct SwapMutationResult: Codable, Equatable, Sendable {
    public var snapshot: WeeklyLoopSnapshot
    public var removedIngredientIDs: Set<String>
    public var addedIngredientIDs: Set<String>
    public var changedIngredientIDs: Set<String>
}

public enum WeeklyLoopMutationError: Error, Equatable, Sendable {
    case revisionConflict(expected: Int, actual: Int)
    case planItemNotFound
    case hardEligibilityViolation([RecipeEligibilityIssue])
    case activeTimeExceeded
    case linkedLeftoversRequireRegeneration
    case resultingPlanInvalid([PlanValidationIssue])
}

public enum WeeklyLoopEngine {
    public static func swapCandidates(
        replacing itemID: String,
        in plan: WeeklyPlan,
        recipes: [RecipeSnapshot],
        profile: UserProfile,
        recentRecipeIDs: Set<String> = []
    ) -> [SwapCandidate] {
        guard let item = plan.days.flatMap(\.items).first(where: { $0.id == itemID }) else { return [] }
        let activeSlots = PlanSlot.allCases.filter { slot in
            plan.days.contains { day in day.items.contains { $0.slot == slot } }
        }
        let existingIngredientIDs = Set(plan.days.flatMap(\.items).filter { $0.id != itemID }
            .flatMap { $0.recipeSnapshot.ingredients.map(\.ingredientID) })
        let configuration = PlannerConfiguration()
        return recipes.compactMap { recipe -> (candidate: SwapCandidate, score: Int)? in
            guard recipe.recipeID != item.recipeSnapshot.recipeID,
                  recipe.activePreparationMinutes <= profile.maximumActiveMinutes,
                  RecipeEligibilityPolicy.isEligible(recipe, profile: profile, slot: item.slot, configuration: configuration)
            else { return nil }
            let breakdown = PlannerScoringPolicy.score(
                recipe: recipe,
                profile: profile,
                slot: item.slot,
                activeSlots: activeSlots,
                configuration: configuration,
                existingIngredientIDs: existingIngredientIDs
            )
            guard let candidatePlan = replacing(itemID: itemID, with: recipe, servingMultiplier: breakdown.servingMultiplier, in: plan),
                  WeeklyPlanValidator.isValid(candidatePlan, profile: profile, recentRecipeIDs: recentRecipeIDs, configuration: configuration)
            else { return nil }
            let nutrition = PlannerScoringPolicy.nutrition(recipe.nutritionPerServing, multiplier: breakdown.servingMultiplier)
            return (
                SwapCandidate(
                    recipe: recipe,
                    calorieDelta: nutrition.calories - item.nutrition.calories,
                    proteinDeltaGrams: nutrition.proteinGrams - item.nutrition.proteinGrams,
                    servingMultiplier: breakdown.servingMultiplier
                ),
                breakdown.total
            )
        }.sorted {
            if $0.score != $1.score { return $0.score < $1.score }
            let lhsDeviation = decimalMagnitude($0.candidate.calorieDelta)
            let rhsDeviation = decimalMagnitude($1.candidate.calorieDelta)
            if lhsDeviation != rhsDeviation { return lhsDeviation < rhsDeviation }
            return $0.candidate.recipe.recipeID < $1.candidate.recipe.recipeID
        }.map(\.candidate)
    }

    public static func applySwap(
        to snapshot: WeeklyLoopSnapshot,
        expectedRevision: Int,
        mutationID: String,
        itemID: String,
        replacement: RecipeSnapshot,
        profile: UserProfile,
        recentRecipeIDs: Set<String> = []
    ) throws -> SwapMutationResult {
        guard expectedRevision == snapshot.revision else {
            throw WeeklyLoopMutationError.revisionConflict(expected: expectedRevision, actual: snapshot.revision)
        }
        guard let original = snapshot.plan.days.flatMap(\.items).first(where: { $0.id == itemID }) else {
            throw WeeklyLoopMutationError.planItemNotFound
        }
        let configuration = PlannerConfiguration()
        let eligibilityIssues = RecipeEligibilityPolicy.issues(for: replacement, profile: profile, slot: original.slot, configuration: configuration)
        guard eligibilityIssues.isEmpty else { throw WeeklyLoopMutationError.hardEligibilityViolation(eligibilityIssues) }
        guard replacement.activePreparationMinutes <= profile.maximumActiveMinutes else {
            throw WeeklyLoopMutationError.activeTimeExceeded
        }
        if case .batchSource = original.leftoverRelationship {
            let hasLinkedReuse = snapshot.plan.days.flatMap(\.items).contains {
                guard case let .plannedReuse(_, sourceID) = $0.leftoverRelationship else { return false }
                return sourceID == itemID
            }
            if hasLinkedReuse { throw WeeklyLoopMutationError.linkedLeftoversRequireRegeneration }
        }
        let activeSlots = PlanSlot.allCases.filter { slot in
            snapshot.plan.days.contains { day in day.items.contains { $0.slot == slot } }
        }
        let existingIngredientIDs = Set(snapshot.plan.days.flatMap(\.items).filter { $0.id != itemID }
            .flatMap { $0.recipeSnapshot.ingredients.map(\.ingredientID) })
        let servingMultiplier = PlannerScoringPolicy.score(
            recipe: replacement,
            profile: profile,
            slot: original.slot,
            activeSlots: activeSlots,
            configuration: configuration,
            existingIngredientIDs: existingIngredientIDs
        ).servingMultiplier
        guard let plan = replacing(itemID: itemID, with: replacement, servingMultiplier: servingMultiplier, in: snapshot.plan) else {
            throw WeeklyLoopMutationError.planItemNotFound
        }
        let validationIssues = WeeklyPlanValidator.issues(for: plan, profile: profile, recentRecipeIDs: recentRecipeIDs, configuration: configuration)
        guard validationIssues.isEmpty else { throw WeeklyLoopMutationError.resultingPlanInvalid(validationIssues) }

        let groceries = GroceryListDeriver.derive(from: plan, preserving: snapshot.groceryList)
        let prep = PrepTimelineDeriver.derive(from: plan, preserving: snapshot.prepTimeline)
        let oldIDs = Set(snapshot.groceryList.items.map(\.ingredientID))
        let newIDs = Set(groceries.items.map(\.ingredientID))
        let changed = Set(groceries.items.filter(\.changedBySwap).map(\.ingredientID))
        let updated = WeeklyLoopSnapshot(
            plan: plan,
            groceryList: groceries,
            prepTimeline: prep,
            revision: snapshot.revision + 1,
            lastMutationID: mutationID
        )
        return SwapMutationResult(
            snapshot: updated,
            removedIngredientIDs: oldIDs.subtracting(newIDs),
            addedIngredientIDs: newIDs.subtracting(oldIDs),
            changedIngredientIDs: changed
        )
    }

    private static func replacing(itemID: String, with recipe: RecipeSnapshot, servingMultiplier: Decimal, in plan: WeeklyPlan) -> WeeklyPlan? {
        var plan = plan
        guard let dayIndex = plan.days.firstIndex(where: { $0.items.contains(where: { $0.id == itemID }) }),
              let itemIndex = plan.days[dayIndex].items.firstIndex(where: { $0.id == itemID }) else { return nil }
        let original = plan.days[dayIndex].items[itemIndex]
        plan.days[dayIndex].items[itemIndex] = PlanItem(
            id: original.id,
            localDate: original.localDate,
            slot: original.slot,
            recipeSnapshot: recipe,
            servingMultiplier: servingMultiplier,
            servingQuantityGrams: recipe.servingSizeGrams * servingMultiplier,
            nutrition: PlannerScoringPolicy.nutrition(recipe.nutritionPerServing, multiplier: servingMultiplier),
            leftoverRelationship: .none,
            completionState: .planned
        )
        return plan
    }

    private static func decimalMagnitude(_ value: Decimal) -> Decimal {
        value < 0 ? -value : value
    }
}
