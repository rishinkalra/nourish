#if DEBUG
import Foundation
import NourishAPI
import NourishCore

struct DevelopmentWeeklyLoopFixture: Sendable {
    let profile: UserProfile
    let snapshot: WeeklyLoopSnapshot
    let replacementRecipe: RecipeSnapshot
    let diagnostics: PlannerDiagnostics

    static func make(now: Date = .now) -> DevelopmentWeeklyLoopFixture {
        var draft = OnboardingDraft()
        draft.confirmsAdult = true
        draft.confirmsGeneralWellnessFit = true
        draft.confirmsNutritionEstimates = true
        draft.allergens = []
        draft.dislikedFoods = []
        let profile = draft.profile(consentAcceptedAt: Date(timeIntervalSince1970: 0))
        let start = mondayContaining(now, timeZoneIdentifier: profile.timeZoneIdentifier)
        let mealNames = [
            "Lemon poha bowl", "Moong chilla plate", "Ragi breakfast bowl",
            "Tofu bhurji toast", "Chana vegetable upma", "Millet idli plate",
            "Vegetable dalia bowl",
        ]
        let ingredientNames = [
            "Poha", "Moong dal", "Ragi flour", "Tofu", "Chana dal", "Millet", "Broken wheat",
        ]
        let days = mealNames.enumerated().map { index, name -> PlanDay in
            let date = start.adding(days: index, timeZoneIdentifier: profile.timeZoneIdentifier) ?? start
            let recipe = recipe(
                id: "fixture-recipe-\(index)",
                name: name,
                ingredientID: "fixture-ingredient-\(index)",
                ingredientName: ingredientNames[index],
                calories: 360 + (index * 10),
                protein: 14 + index
            )
            return PlanDay(
                localDate: date,
                items: [PlanItem(
                    id: "fixture-meal-\(index)",
                    localDate: date,
                    slot: .breakfast,
                    recipeSnapshot: recipe,
                    servingMultiplier: 1,
                    servingQuantityGrams: recipe.servingSizeGrams,
                    nutrition: recipe.nutritionPerServing
                )]
            )
        }
        let plan = WeeklyPlan(
            id: "fixture-reviewed-week",
            timeZoneIdentifier: profile.timeZoneIdentifier,
            days: days,
            targetSnapshot: PlanTargetSnapshot(
                dailyCalories: profile.calorieTarget,
                optionalDailyProteinGrams: 75,
                targetSource: profile.targetSource,
                targetVersion: nil
            ),
            generatorVersion: "fixture-generator-v1",
            scoringVersion: "fixture-scoring-v1",
            ruleVersion: "fixture-rules-v1"
        )
        let snapshot = WeeklyLoopSnapshot.materialize(plan: plan)
        let replacement = recipe(
            id: "fixture-coconut-poha",
            name: "Coconut poha bowl",
            ingredientID: "fixture-coconut",
            ingredientName: "Fresh coconut",
            calories: 405,
            protein: 16
        )
        let diagnostics = PlannerDiagnostics(
            generatorVersion: plan.generatorVersion,
            scoringVersion: plan.scoringVersion,
            ruleVersion: plan.ruleVersion,
            deterministicSeed: "ui-fixture-seed",
            candidatePoolSize: mealNames.count + 1,
            eligibleCandidateCountBySlot: [PlanSlot.breakfast.rawValue: mealNames.count + 1],
            rejectedCandidateCounts: [:],
            selectedRecipeCount: mealNames.count,
            meanAbsoluteDailyCalorieDeviation: 0,
            variety: VarietyPolicy.analyze(
                meals: days.flatMap(\.items).map {
                    PlannedMeal(
                        recipeID: $0.recipeSnapshot.recipeID,
                        dominantIngredientIDs: $0.recipeSnapshot.dominantIngredientIDs,
                        reuse: .fresh(batchID: nil)
                    )
                }
            ),
            explanations: [],
            trigger: "ui_fixture",
            regenerationReason: nil
        )
        return DevelopmentWeeklyLoopFixture(
            profile: profile,
            snapshot: snapshot,
            replacementRecipe: replacement,
            diagnostics: diagnostics
        )
    }

    private static func recipe(
        id: String,
        name: String,
        ingredientID: String,
        ingredientName: String,
        calories: Int,
        protein: Int
    ) -> RecipeSnapshot {
        RecipeSnapshot(
            recipeID: id,
            version: 1,
            displayName: name,
            ingredients: [IngredientSnapshot(
                ingredientID: ingredientID,
                displayName: ingredientName,
                householdQuantity: 1,
                householdUnit: "cup",
                grams: 180
            )],
            methodSteps: ["Combine the reviewed ingredients.", "Cook until ready and serve warm."],
            servingSizeGrams: 300,
            nutritionPerServing: Nutrition(
                calories: Decimal(calories),
                proteinGrams: Decimal(protein),
                carbohydrateGrams: 54,
                fatGrams: 11,
                fibreGrams: 8
            ),
            activePreparationMinutes: 20,
            totalMinutes: 30,
            tags: ["fixture", "breakfast"],
            allergenIDs: [],
            dietType: .vegetarian,
            eligibleSlots: [.breakfast],
            dominantIngredientIDs: [ingredientID],
            nutritionSourceSummary: "Deterministic UI-test fixture",
            nutritionCalculationVersion: "fixture-nutrition-v1",
            reviewStatus: .approved,
            publicationStatus: .published
        )
    }

    private static func mondayContaining(_ date: Date, timeZoneIdentifier: String) -> LocalDate {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: timeZoneIdentifier) ?? .autoupdatingCurrent
        let weekday = calendar.component(.weekday, from: date)
        let daysSinceMonday = (weekday + 5) % 7
        let monday = calendar.date(byAdding: .day, value: -daysSinceMonday, to: date) ?? date
        let components = calendar.dateComponents([.year, .month, .day], from: monday)
        return LocalDate(
            year: components.year ?? 2026,
            month: components.month ?? 1,
            day: components.day ?? 1
        )
    }
}

actor DevelopmentWeeklyLoopRemote: WeeklyLoopRemote {
    private var snapshot: WeeklyLoopSnapshot
    private let profile: UserProfile
    private let replacementRecipe: RecipeSnapshot
    private let diagnostics: PlannerDiagnostics
    private let isOnline: Bool
    private var groceryRevision = 1
    private var mealRevisions: [String: Int]
    private var prepRevisions: [String: Int]

    init(fixture: DevelopmentWeeklyLoopFixture, isOnline: Bool) {
        snapshot = fixture.snapshot
        profile = fixture.profile
        replacementRecipe = fixture.replacementRecipe
        diagnostics = fixture.diagnostics
        self.isOnline = isOnline
        mealRevisions = Dictionary(uniqueKeysWithValues: fixture.snapshot.plan.days.flatMap(\.items).map { ($0.id, 0) })
        prepRevisions = Dictionary(uniqueKeysWithValues: fixture.snapshot.prepTimeline.tasks.map { ($0.id, 0) })
    }

    func readActiveWeeklyLoop() async throws -> ActiveWeeklyLoopEnvelope {
        try requireOnline()
        return ActiveWeeklyLoopEnvelope(
            plan: snapshot.plan,
            diagnostics: diagnostics,
            groceryList: remoteGroceryList,
            prepTimeline: snapshot.prepTimeline,
            revision: snapshot.revision,
            operationalRevisions: WeeklyLoopOperationalRevisions(
                grocery: groceryRevision,
                meals: mealRevisions,
                prep: prepRevisions
            )
        )
    }

    func swapCandidates(planItemID: String) async throws -> [SwapCandidate] {
        try requireOnline()
        return WeeklyLoopEngine.swapCandidates(
            replacing: planItemID,
            in: snapshot.plan,
            recipes: [replacementRecipe],
            profile: profile
        )
    }

    func confirmSwap(planItemID: String, replacementRecipeID: String, idempotencyKey: String) async throws -> SwapConfirmationEnvelope {
        try requireOnline()
        guard replacementRecipeID == replacementRecipe.recipeID else { throw URLError(.badURL) }
        let previousPlanID = snapshot.plan.id
        snapshot = try WeeklyLoopEngine.applySwap(
            to: snapshot,
            expectedRevision: snapshot.revision,
            mutationID: idempotencyKey,
            itemID: planItemID,
            replacement: replacementRecipe,
            profile: profile
        ).snapshot
        groceryRevision += 1
        return SwapConfirmationEnvelope(
            plan: snapshot.plan,
            groceryList: snapshot.groceryList,
            prepTimeline: snapshot.prepTimeline,
            revision: snapshot.revision,
            supersedesPlanID: previousPlanID,
            swappedAt: .now
        )
    }

    func readGroceryList(id: String) async throws -> RemoteGroceryList {
        try requireOnline()
        return remoteGroceryList
    }

    func updateGroceryList(id: String, patch: GroceryListPatch) async throws -> RemoteGroceryList {
        try requireOnline()
        guard patch.expectedRevision == groceryRevision else { throw conflict() }
        for change in patch.changes {
            guard let index = snapshot.groceryList.items.firstIndex(where: { $0.id == change.itemID }) else { continue }
            if let disposition = change.disposition {
                snapshot.groceryList.items[index].disposition = disposition
            }
            if let grams = change.userAdjustedGrams {
                snapshot.groceryList.items[index].userAdjustedGrams = grams
            }
        }
        groceryRevision += 1
        return remoteGroceryList
    }

    func updateMealStatus(planItemID: String, state: MealCompletionState, expectedRevision: Int) async throws -> MealStatusReceipt {
        try requireOnline()
        guard expectedRevision == mealRevisions[planItemID, default: 0] else { throw conflict() }
        guard let dayIndex = snapshot.plan.days.firstIndex(where: { $0.items.contains(where: { $0.id == planItemID }) }),
              let itemIndex = snapshot.plan.days[dayIndex].items.firstIndex(where: { $0.id == planItemID }) else {
            throw URLError(.fileDoesNotExist)
        }
        snapshot.plan.days[dayIndex].items[itemIndex].completionState = state
        mealRevisions[planItemID, default: 0] += 1
        return MealStatusReceipt(itemID: planItemID, state: state, revision: mealRevisions[planItemID, default: 0], updatedAt: .now)
    }

    func updatePrepTask(id: String, isComplete: Bool, expectedRevision: Int) async throws -> PrepTaskReceipt {
        try requireOnline()
        guard expectedRevision == prepRevisions[id, default: 0] else { throw conflict() }
        guard let index = snapshot.prepTimeline.tasks.firstIndex(where: { $0.id == id }) else {
            throw URLError(.fileDoesNotExist)
        }
        snapshot.prepTimeline.tasks[index].isComplete = isComplete
        prepRevisions[id, default: 0] += 1
        return PrepTaskReceipt(taskID: id, isComplete: isComplete, revision: prepRevisions[id, default: 0], updatedAt: .now)
    }

    private var remoteGroceryList: RemoteGroceryList {
        RemoteGroceryList(
            id: snapshot.groceryList.id,
            planID: snapshot.groceryList.planID,
            items: snapshot.groceryList.items,
            revision: groceryRevision
        )
    }

    private func requireOnline() throws {
        if !isOnline { throw URLError(.notConnectedToInternet) }
    }

    private func conflict() -> APIErrorEnvelope {
        APIErrorEnvelope(
            code: .conflict,
            userSafeMessage: "The fixture changed elsewhere.",
            correlationID: "ui-fixture-conflict",
            retryable: true
        )
    }
}
#endif
