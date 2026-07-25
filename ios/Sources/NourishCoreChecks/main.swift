import Foundation
import NourishAPI
import NourishCore

@main
struct NourishCoreChecks {
    static func main() async throws {
        try onboardingChecks()
        reminderChecks()
        backgroundSyncPolicyChecks()
        try await featureFlagChecks()
        analyticsDimensionChecks()
        varietyChecks()
        scoringV3Checks()
        planSafetyChecks()
        try plannerGenerationChecks()
        try await weeklyLoopRepositoryChecks()
        try await catalogueChecks()
        apiContractChecks()
        try await profileRepositoryChecks()
        try await profileSyncChecks()
        try await sessionChecks()
        print("NourishCore checks passed")
    }

    private static func backgroundSyncPolicyChecks() {
        expect(BackgroundSyncPolicy.retryDelay(forAttempt: 0) == 15 * 60, "The first background retry should respect the iOS minimum interval")
        expect(BackgroundSyncPolicy.retryDelay(forAttempt: 1) == 30 * 60, "Background retries should use exponential backoff")
        expect(BackgroundSyncPolicy.retryDelay(forAttempt: 20) == 6 * 60 * 60, "Background retry delay should be capped")
        expect(BackgroundSyncPolicy.shouldSchedule(profilePending: true, weeklyLoopPending: false), "A pending profile should schedule background sync")
        expect(BackgroundSyncPolicy.shouldSchedule(profilePending: false, weeklyLoopPending: true), "A pending weekly-loop mutation should schedule background sync")
        expect(!BackgroundSyncPolicy.shouldSchedule(profilePending: false, weeklyLoopPending: false), "Acknowledged state should cancel background sync")
    }

    private static func featureFlagChecks() async throws {
        let evaluatedAt = Date(timeIntervalSince1970: 1_721_116_800)
        let enabled = FeatureFlagSnapshot(
            appVersion: "1.4.0",
            evaluatedAt: evaluatedAt,
            contractVersion: "feature-flags-v1",
            flags: [FeatureFlagDecision(key: "weekly_insights", enabled: true, version: 3, reasonCode: "percentage_rollout")]
        )
        expect(AppFeatureFlagSet(snapshot: enabled).isEnabled(.weeklyInsights), "A uniquely evaluated consumed flag should enable its guarded feature")

        let emergency = FeatureFlagSnapshot(
            appVersion: "1.4.0",
            evaluatedAt: evaluatedAt,
            contractVersion: "feature-flags-v1",
            flags: [FeatureFlagDecision(key: "weekly_insights", enabled: true, version: 4, reasonCode: "emergency_disabled")]
        )
        expect(!AppFeatureFlagSet(snapshot: emergency).isEnabled(.weeklyInsights), "Emergency disable must fail closed even if an inconsistent payload says enabled")

        let duplicated = FeatureFlagSnapshot(
            appVersion: "1.4.0",
            evaluatedAt: evaluatedAt,
            contractVersion: "feature-flags-v1",
            flags: [
                FeatureFlagDecision(key: "weekly_insights", enabled: true, version: 3, reasonCode: "allowlisted"),
                FeatureFlagDecision(key: "weekly_insights", enabled: true, version: 4, reasonCode: "percentage_rollout"),
            ]
        )
        expect(!AppFeatureFlagSet(snapshot: duplicated).isEnabled(.weeklyInsights), "Duplicate decisions must fail closed")
        expect(!AppFeatureFlagSet.safeDefaults.isEnabled(.weeklyInsights), "Missing evaluation must use a compiled-off default")

        let paywall = FeatureFlagSnapshot(
            appVersion: "1.4.0",
            evaluatedAt: evaluatedAt,
            contractVersion: "feature-flags-v1",
            flags: [FeatureFlagDecision(
                key: "paywall_configuration",
                enabled: true,
                version: 1,
                reasonCode: "enabled",
                value: .object([
                    "headline": .string("Plan with confidence"),
                    "trialMessage": .string("Eligible trials are confirmed by Apple."),
                    "productOrder": .array([.string("annual"), .string("monthly"), .string("annual")]),
                ])
            )]
        )
        let paywallPresentation = AppFeatureFlagSet(snapshot: paywall).paywallPresentation
        expect(paywallPresentation?.headline == "Plan with confidence", "Remote paywall copy should decode only from the evaluated compiled flag")
        expect(paywallPresentation?.productOrder == ["annual", "monthly"], "Remote paywall order should be stable and deduplicated")

        let root = FileManager.default.temporaryDirectory.appending(path: "nourish-feature-flag-check-\(UUID().uuidString)")
        let cache = FileFeatureFlagCache(rootURL: root)
        try await cache.save(enabled, userID: "user-a")
        let restored = try await cache.load(userID: "user-a", appVersion: "1.4.0", now: evaluatedAt.addingTimeInterval(60))
        let otherUser = try await cache.load(userID: "user-b", appVersion: "1.4.0", now: evaluatedAt.addingTimeInterval(60))
        let otherVersion = try await cache.load(userID: "user-a", appVersion: "1.5.0", now: evaluatedAt.addingTimeInterval(60))
        let stale = try await cache.load(userID: "user-a", appVersion: "1.4.0", now: evaluatedAt.addingTimeInterval(FileFeatureFlagCache.maximumAge + 1))
        expect(restored == enabled, "A fresh protected cache should restore for the same user and app version")
        expect(otherUser == nil, "Feature-flag cache must not cross user boundaries")
        expect(otherVersion == nil, "Feature-flag cache must not cross app-version boundaries")
        expect(stale == nil, "Stale flags must fall back to compiled-off defaults")
        try FileManager.default.removeItem(at: root)
    }

    private static func analyticsDimensionChecks() {
        let referral = URL(string: "nourish://referral?acquisition_source=referral")!
        let unknown = URL(string: "nourish://referral?acquisition_source=unbounded-network")!
        let auth = URL(string: "nourish://auth/magic-link?token=redacted")!
        expect(AnalyticsAcquisitionSource.captured(from: referral) == .referral, "A bounded referral source should be captured from an explicit app link")
        expect(AnalyticsAcquisitionSource.captured(from: unknown) == nil, "Unbounded acquisition labels must be rejected")
        expect(AnalyticsAcquisitionSource.captured(from: auth) == nil, "Authentication links without attribution must not invent a source")
        expect(AnalyticsAcquisitionSource.allCases.count == 5, "The acquisition taxonomy must remain intentionally bounded")
    }

    private static func reminderChecks() {
        let profile = sampleProfile()
        var settings = LifecycleReminderSettings()
        settings.shopping.isEnabled = true
        settings.prep.isEnabled = true
        settings.meals[0].isEnabled = true
        settings.weeklyReview.isEnabled = true
        settings.nextPlan.isEnabled = true
        let descriptors = LifecycleReminderPlanner.descriptors(settings: settings, profile: profile)
        expect(settings.isValid, "Default lifecycle reminder settings should be valid")
        expect(descriptors.count == 5, "Enabled shopping, prep, breakfast, review, and next-plan reminders should materialize")
        expect(Set(descriptors.map(\.identifier)).count == descriptors.count, "Reminder identifiers should be stable and unique")
        expect(descriptors.first { $0.identifier == "shopping" }?.destination.deepLink.absoluteString == "nourish://open/groceries", "Shopping reminders should deep-link to groceries")
        let monday = LifecycleReminderPlanner.nextPlanStart(
            onOrAfter: Date(timeIntervalSince1970: 1_721_001_600),
            weekday: 2,
            timeZoneIdentifier: "Asia/Kolkata"
        )
        expect(monday == LocalDate(year: 2024, month: 7, day: 15), "Plan-start preference should resolve the next local weekday")

        var invalid = settings
        invalid.planStartWeekday = 0
        expect(!invalid.isValid, "Invalid plan-start weekdays should be rejected")
        expect(LifecycleReminderPlanner.descriptors(settings: invalid, profile: profile).isEmpty, "Invalid reminder settings should never materialize schedules")

        var lunchDisabledProfile = profile
        lunchDisabledProfile.enabledMealSlots.remove(.lunch)
        var lunchSettings = LifecycleReminderSettings()
        if let index = lunchSettings.meals.firstIndex(where: { $0.slot == .lunch }) {
            lunchSettings.meals[index].isEnabled = true
        }
        expect(LifecycleReminderPlanner.descriptors(settings: lunchSettings, profile: lunchDisabledProfile).isEmpty, "Disabled meal slots should not schedule meal notifications")
    }

    private static func onboardingChecks() throws {
        var ineligible = OnboardingDraft()
        ineligible.confirmsGeneralWellnessFit = true
        do {
            try OnboardingValidator.validate(.wellnessEligibility, draft: ineligible)
            fail("Adult confirmation should be required")
        } catch OnboardingValidationError.adultConfirmationRequired {
            // Expected.
        }

        var completed = OnboardingDraft()
        completed.confirmsAdult = true
        completed.confirmsGeneralWellnessFit = true
        completed.confirmsNutritionEstimates = true
        try OnboardingValidator.validate(.wellnessEligibility, draft: completed)
        try OnboardingValidator.validate(.review, draft: completed)
        let profile = completed.profile(consentAcceptedAt: Date(timeIntervalSince1970: 1_700_000_000))
        expect(profile.calorieTarget == 1_850, "Profile should retain the calorie target")
        expect(profile.wellnessConsent.policyVersion == "wellness-v1.0", "Profile should retain consent policy version")
        expect(profile.countryRegionCode == "IN", "Profile should retain country/region")
        expect(profile.unitSystem == .metric, "Profile should retain the unit system")
        expect(profile.timeZoneIdentifier == "Asia/Kolkata", "Profile should retain timezone")
        expect(profile.preferredAuthenticationMethod == .apple, "Profile should retain the preferred authentication method")
        expect(profile.enabledMealSlots == Set(MealSlot.allCases), "Profile should retain enabled meal slots")
        expect(profile.snackPreference == .optional, "Profile should retain snack preference")
        expect(profile.dislikedFoods.contains("mushrooms"), "Profile should retain disliked foods")
        expect(profile.batchPrepSessionsPerWeek == 1, "Profile should retain batch-prep session count")
        expect(profile.availableEquipment?.contains(.pressureCooker) == true, "Profile should retain available cooking equipment")
    }

    private static func scoringV3Checks() {
        let configuration = PlannerConfiguration()
        expect(configuration.scoringVersion == "wellness-score-v3", "The planner should identify the whole-week tolerance scoring contract")
        let slots: [PlanSlot] = [.breakfast, .lunch, .dinner]
        let targets = PlannerScoringPolicy.targets(
            dailyTarget: 1_850,
            activeSlots: slots,
            shares: configuration.mealTargetShares
        )
        expect(targets.values.reduce(0, +) == 1_850, "Meal-specific target shares should preserve the exact daily target")
        expect(targets[.lunch, default: 0] > targets[.breakfast, default: 0], "Lunch should receive a larger initial target share than breakfast")

        var profile = sampleProfile()
        profile.optionalDailyProteinTargetGrams = 90
        profile.budget = .value
        profile.availableEquipment = [.stovetop, .pan]

        var gatedRecipe = sampleRecipe(id: "score-gated", eligibleSlots: [.lunch])
        gatedRecipe.localeIdentifier = "en-IN"
        let gatedConfiguration = PlannerConfiguration(
            eligibleLocaleIdentifiers: ["en-IN"],
            currentNutritionCalculationVersions: ["nutrition-v1"]
        )
        expect(
            RecipeEligibilityPolicy.issues(for: gatedRecipe, profile: profile, slot: .lunch, configuration: gatedConfiguration).isEmpty,
            "Configured current locale and calculation versions should remain eligible"
        )
        gatedRecipe.localeIdentifier = "en-GB"
        expect(
            RecipeEligibilityPolicy.issues(for: gatedRecipe, profile: profile, slot: .lunch, configuration: gatedConfiguration).contains(.localeUnavailable),
            "Configured locale eligibility should fail closed"
        )
        gatedRecipe.localeIdentifier = "en-IN"
        gatedRecipe.nutritionCalculationVersion = "legacy-v0"
        expect(
            RecipeEligibilityPolicy.issues(for: gatedRecipe, profile: profile, slot: .lunch, configuration: gatedConfiguration).contains(.nutritionCalculationVersionStale),
            "Stale nutrition calculation versions should fail closed"
        )

        var fit = sampleRecipe(id: "score-fit", calories: Decimal(targets[.lunch, default: 0]), eligibleSlots: [.lunch])
        fit.nutritionPerServing.proteinGrams = Decimal(PlannerScoringPolicy.target(
            dailyTarget: 90,
            slot: .lunch,
            activeSlots: slots,
            shares: configuration.mealTargetShares
        ))
        fit.costBand = .value
        fit.equipment = ["pan"]

        var nonVegetarianRecipe = fit
        nonVegetarianRecipe.recipeID = "score-non-vegetarian"
        nonVegetarianRecipe.dietType = .nonVegetarian
        var eggetarianProfile = profile
        eggetarianProfile.diet = .eggetarian
        expect(
            RecipeEligibilityPolicy.issues(for: nonVegetarianRecipe, profile: eggetarianProfile, slot: .lunch).contains(.dietMismatch),
            "An eggetarian profile must not admit non-vegetarian recipes"
        )
        var nonVegetarianProfile = profile
        nonVegetarianProfile.diet = .nonVegetarian
        expect(
            !RecipeEligibilityPolicy.issues(for: nonVegetarianRecipe, profile: nonVegetarianProfile, slot: .lunch).contains(.dietMismatch),
            "A non-vegetarian profile should admit reviewed non-vegetarian recipes"
        )

        var expensive = fit
        expensive.recipeID = "score-expensive"
        expensive.costBand = .flexible
        let fitScore = PlannerScoringPolicy.score(recipe: fit, profile: profile, slot: .lunch, activeSlots: slots, configuration: configuration)
        let expensiveScore = PlannerScoringPolicy.score(recipe: expensive, profile: profile, slot: .lunch, activeSlots: slots, configuration: configuration)
        expect(fitScore.proteinDeviation == 0, "A recipe matching the user-provided protein target should have no protein penalty")
        expect(fitScore.total < expensiveScore.total, "A value-budget profile should rank an otherwise identical value recipe above a flexible-cost recipe")

        var scalable = fit
        scalable.recipeID = "score-scalable"
        scalable.nutritionPerServing = Nutrition(calories: 500, proteinGrams: 25, carbohydrateGrams: 50, fatGrams: 15, fibreGrams: 8)
        scalable.minimumServingMultiplier = Decimal(string: "0.75")
        scalable.maximumServingMultiplier = Decimal(string: "1.4")
        let scalableScore = PlannerScoringPolicy.score(recipe: scalable, profile: profile, slot: .lunch, activeSlots: slots, configuration: configuration)
        expect(scalableScore.servingMultiplier > 1 && scalableScore.servingMultiplier <= Decimal(string: "1.4")!, "Serving adjustment must stay within reviewed recipe bounds")

        var overlapping = fit
        overlapping.recipeID = "score-overlap"
        overlapping.ingredients = [IngredientSnapshot(ingredientID: "spinach", displayName: "Spinach", householdQuantity: 1, householdUnit: "cup", grams: 60)]
        var novel = overlapping
        novel.recipeID = "score-novel"
        novel.ingredients = [IngredientSnapshot(ingredientID: "rice", displayName: "Rice", householdQuantity: 1, householdUnit: "cup", grams: 180)]
        let overlapScore = PlannerScoringPolicy.score(recipe: overlapping, profile: profile, slot: .lunch, activeSlots: slots, configuration: configuration, existingIngredientIDs: ["spinach", "chickpeas"])
        let novelScore = PlannerScoringPolicy.score(recipe: novel, profile: profile, slot: .lunch, activeSlots: slots, configuration: configuration, existingIngredientIDs: ["spinach", "chickpeas"])
        expect(overlapScore.ingredientReusePenalty < novelScore.ingredientReusePenalty, "Existing grocery overlap should rank above an otherwise equivalent novel ingredient")

        var unavailable = fit
        unavailable.equipment = ["oven"]
        expect(
            RecipeEligibilityPolicy.issues(for: unavailable, profile: profile, slot: .lunch).contains {
                if case .equipmentUnavailable = $0 { return true }
                return false
            },
            "Unavailable required equipment should be a hard eligibility failure"
        )
        var disliked = fit
        disliked.recipeID = "score-disliked"
        disliked.ingredients = [IngredientSnapshot(ingredientID: "mushrooms", displayName: "Mushrooms", householdQuantity: 1, householdUnit: "cup", grams: 80)]
        expect(
            RecipeEligibilityPolicy.issues(for: disliked, profile: profile, slot: .lunch).contains {
                if case .dislikedIngredient = $0 { return true }
                return false
            },
            "A recipe containing a disliked food should not enter generation or swap ranking"
        )
    }

    private static func varietyChecks() {
        let week = [
            PlannedMeal(recipeID: "palak-paneer", dominantIngredientIDs: ["spinach", "paneer"], reuse: .fresh(batchID: "palak-batch")),
            PlannedMeal(recipeID: "palak-paneer", dominantIngredientIDs: ["spinach", "paneer"], reuse: .leftover(batchID: "palak-batch")),
            PlannedMeal(recipeID: "rajma-bowl", dominantIngredientIDs: ["rajma", "tomato"]),
            PlannedMeal(recipeID: "moong-chilla", dominantIngredientIDs: ["moong", "onion"]),
        ]

        let healthy = VarietyPolicy.analyze(meals: week)
        expect(healthy.passed, "A linked leftover should pass variety diagnostics")
        expect(healthy.accidentalExactRepeats == 0, "A linked leftover should not count as an accidental repeat")

        let repeated = week + [PlannedMeal(recipeID: "rajma-bowl", dominantIngredientIDs: ["rajma", "tomato"])]
        let unhealthy = VarietyPolicy.analyze(meals: repeated)
        expect(!unhealthy.passed, "An unlinked exact repeat should fail diagnostics")
        expect(unhealthy.accidentalExactRepeats == 1, "One accidental repeat should be reported")

        let leftover = PlannedMeal(recipeID: "palak-paneer", dominantIngredientIDs: ["spinach", "paneer"], reuse: .leftover(batchID: "palak-batch"))
        let leftoverScore = VarietyPolicy.score(candidate: leftover, existingMeals: week)
        expect(leftoverScore.isLinkedLeftover, "Batch-linked reuse should be detected")
        expect(leftoverScore.penalty < 0, "Useful batch-linked reuse should receive a reward")

        let recent = PlannedMeal(recipeID: "rajma-bowl", dominantIngredientIDs: ["rajma", "tomato"])
        let recentScore = VarietyPolicy.score(candidate: recent, existingMeals: week, recentRecipeIDs: ["rajma-bowl"])
        expect(recentScore.isRecentRecipe && recentScore.penalty > 0, "Recent recipes should receive a fatigue penalty")
    }

    private static func apiContractChecks() {
        let routes: [ConsumerRoute] = [
            .authenticateWithApple,
            .requestMagicLink,
            .completeMagicLink,
            .refreshSession,
            .revokeSession,
            .readProfile,
            .updateProfile,
            .readFeatureFlags,
            .updateAnalyticsDimensions,
            .updateAnalyticsConsent,
            .recordAnalyticsEvent,
            .estimateCalories,
            .createPlan,
            .readActivePlan,
            .readPlanHistory,
            .readPlan(id: "plan-1"),
            .adoptPlan(id: "plan-1"),
            .readSwapCandidates(planItemID: "item-1"),
            .confirmSwap(planItemID: "item-1"),
            .updateMealStatus(planItemID: "item-1"),
            .readGroceryList(id: "grocery-1"),
            .updateGroceryList(id: "grocery-1"),
            .updatePrepTask(id: "prep-1"),
            .submitFeedback,
            .readEntitlement,
            .issueAppStoreAccountToken,
            .bindAppStoreTransaction,
            .requestAccountExport,
            .deleteAccount,
        ]
        expect(routes.allSatisfy { $0.descriptor.path.hasPrefix("/v1/") }, "Every consumer route should be API-versioned")
        expect(ConsumerRoute.createPlan.descriptor.requiresIdempotencyKey, "Plan generation should require an idempotency key")
        expect(ConsumerRoute.confirmSwap(planItemID: "item-1").descriptor.requiresIdempotencyKey, "Swap confirmation should require an idempotency key")
        expect(ConsumerRoute.requestAccountExport.descriptor.requiresIdempotencyKey, "Exports should require an idempotency key")
        expect(ConsumerRoute.deleteAccount.descriptor.requiresIdempotencyKey, "Deletion should require an idempotency key")
        expect(!ConsumerRoute.completeMagicLink.descriptor.requiresAuthentication, "Magic-link completion must work before a session exists")
        expect(ConsumerRoute.revokeSession.descriptor.requiresAuthentication, "Session revocation must require authentication")
        expect(ConsumerRoute.readPlanHistory.descriptor.path == "/v1/plans/history", "Plan history should have a stable authenticated route")
        expect(ConsumerRoute.readFeatureFlags.descriptor.path == "/v1/feature-flags", "Feature evaluation should have a stable authenticated route")
        expect(ConsumerRoute.updateAnalyticsDimensions.descriptor.path == "/v1/analytics/dimensions", "Analytics dimensions should have a stable authenticated route")
        expect(ConsumerRoute.updateAnalyticsConsent.descriptor == RouteDescriptor(method: .patch, path: "/v1/analytics/consent"), "Analytics consent should have a stable authenticated route")
        expect(ConsumerRoute.recordAnalyticsEvent.descriptor.path == "/v1/analytics/events", "Analytics events should have a stable authenticated route")
        expect(ClientAnalyticsEventName.allCases.count == 12, "Only the twelve client-observed PRD analytics events should be callable by the app")
        expect(ConsumerRoute.bindAppStoreTransaction.descriptor.path == "/v1/entitlement/transactions", "StoreKit JWS binding should have a stable authenticated route")
        let feedback = MealFeedbackRequest(
            planItemID: "item-1",
            recipeID: "recipe-1",
            rating: 4,
            reasonTags: [.taste, .effort]
        )
        let feedbackData = try? JSONEncoder().encode(feedback)
        expect(feedbackData.flatMap { String(data: $0, encoding: .utf8) }?.contains("ingredientAvailability") == false, "Feedback should encode only selected quick reasons")
        let weeklyReview = WeeklyReviewRequest(planID: "plan-1", completionRate: 0.75, changesRequested: [.moreVariety, .lessEffort])
        let weeklyReviewData = try? JSONEncoder().encode(weeklyReview)
        expect(weeklyReviewData.flatMap { String(data: $0, encoding: .utf8) }?.contains("weeklyReview") == true, "Weekly review should share the typed feedback route")
        expect(Set(StructuredAPIErrorCode.allCases.map(\.rawValue)).contains("NO_FEASIBLE_PLAN"), "No-feasible-plan must be a structured error")
        expect(Set(StructuredAPIErrorCode.allCases.map(\.rawValue)).contains("AUTHENTICATION_REQUIRED"), "The proposed authentication extension must use a typed 401 error")
        expect(Set(EntitlementState.allCases).count == 8, "Every documented entitlement state should be represented")
        let deletion = AccountDeletionRequest(acknowledgement: "DELETE", reason: "No longer needed")
        let deletionData = try? JSONEncoder().encode(deletion)
        expect(deletionData.flatMap { String(data: $0, encoding: .utf8) }?.contains("DELETE") == true, "Deletion confirmation should be explicit on the wire")
        let entitlement = EntitlementSnapshot(
            userID: "user-1",
            state: .graceOrBillingRetry,
            hasAccess: true,
            productID: "nourish.monthly",
            environment: "sandbox",
            verificationStatus: "verified",
            lastVerifiedAt: Date(timeIntervalSince1970: 1_700_000_000),
            nextReconciliationAt: Date(timeIntervalSince1970: 1_700_003_600),
            reconciliationStatus: "current"
        )
        expect((try? JSONDecoder().decode(EntitlementSnapshot.self, from: JSONEncoder().encode(entitlement))) == entitlement, "Entitlement snapshots should round-trip without losing verification state")
    }

    private static func planSafetyChecks() {
        let profile = sampleProfile()
        let approved = sampleRecipe(id: "approved-recipe")
        expect(RecipeEligibilityPolicy.isEligible(approved, profile: profile, slot: .dinner), "Approved recipe should be eligible")

        let peanutRecipe = sampleRecipe(id: "peanut-recipe", allergenIDs: ["peanuts"])
        let peanutIssues = RecipeEligibilityPolicy.issues(for: peanutRecipe, profile: profile, slot: .dinner)
        expect(peanutIssues.contains(.allergenConflict(["peanuts"])), "Allergen conflicts must be hard failures")

        let draftRecipe = sampleRecipe(id: "draft-recipe", publicationStatus: .draft)
        expect(RecipeEligibilityPolicy.issues(for: draftRecipe, profile: profile, slot: .dinner).contains(.notPublished), "Unpublished recipes must be rejected")

        let start = LocalDate(year: 2026, month: 7, day: 13)
        let days = (0..<7).map { offset -> PlanDay in
            let date = start.adding(days: offset, timeZoneIdentifier: profile.timeZoneIdentifier)!
            let recipe = sampleRecipe(id: "recipe-\(offset)")
            let item = PlanItem(
                id: "item-\(offset)",
                localDate: date,
                slot: .dinner,
                recipeSnapshot: recipe,
                servingMultiplier: 1,
                servingQuantityGrams: recipe.servingSizeGrams,
                nutrition: recipe.nutritionPerServing
            )
            return PlanDay(localDate: date, items: [item])
        }
        let plan = WeeklyPlan(
            id: "plan-1",
            timeZoneIdentifier: profile.timeZoneIdentifier,
            days: days,
            targetSnapshot: PlanTargetSnapshot(dailyCalories: profile.calorieTarget, optionalDailyProteinGrams: nil, targetSource: profile.targetSource, targetVersion: nil),
            generatorVersion: "generator-v1",
            scoringVersion: "score-v1",
            ruleVersion: "rules-v1"
        )
        expect(WeeklyPlanValidator.isValid(plan, profile: profile), "Seven consecutive eligible local-date days should validate")

        var unsafeDays = days
        unsafeDays[0].items[0].recipeSnapshot = peanutRecipe
        let unsafePlan = WeeklyPlan(id: "unsafe", timeZoneIdentifier: profile.timeZoneIdentifier, days: unsafeDays, targetSnapshot: plan.targetSnapshot, generatorVersion: "generator-v1", scoringVersion: "score-v1", ruleVersion: "rules-v1")
        expect(!WeeklyPlanValidator.isValid(unsafePlan, profile: profile), "A hard-exclusion violation must reject the plan")
    }

    private static func plannerGenerationChecks() throws {
        var profile = sampleProfile()
        profile.snackPreference = .none
        let recipes = (0..<12).map { index -> RecipeSnapshot in
            var recipe = sampleRecipe(
                id: "planner-recipe-\(index)",
                calories: Decimal(500 + (index * 12)),
                eligibleSlots: Set(PlanSlot.allCases),
                tags: ["dinner", "cuisine:north indian"]
            )
            recipe.minimumServingMultiplier = Decimal(string: "0.75")
            recipe.maximumServingMultiplier = Decimal(string: "1.25")
            recipe.ingredients[0].purchasePackSizeGrams = 500
            return recipe
        }
        let unsafeFavorite = sampleRecipe(
            id: "unsafe-favorite",
            allergenIDs: ["peanuts"],
            calories: 610,
            eligibleSlots: Set(PlanSlot.allCases)
        )
        let input = PlannerInput(
            profile: profile,
            weekStart: LocalDate(year: 2026, month: 7, day: 20),
            recipes: recipes + [unsafeFavorite],
            recentRecipeIDs: ["planner-recipe-0"],
            favoriteRecipeIDs: [unsafeFavorite.recipeID, "planner-recipe-1"],
            deterministicSeed: "user-1|2026-07-20|profile-r3",
            trigger: "weekly_review"
        )
        let first = try DeterministicPlanner.generate(input)
        let replay = try DeterministicPlanner.generate(input)
        expect(first == replay, "Identical planner inputs must produce byte-equivalent model output")
        expect(first.plan.days.count == 7, "The planner should materialize seven local-date days")
        expect(first.plan.days.allSatisfy { $0.items.count == 3 }, "Every enabled meal slot should be filled")
        expect(first.plan.days.flatMap(\.items).allSatisfy { $0.recipeSnapshot.recipeID != unsafeFavorite.recipeID }, "Favorites must never override allergen safety")
        expect(first.diagnostics.rejectedCandidateCounts[PlannerRejectionReason.allergenConflict.rawValue, default: 0] > 0, "Unsafe candidates should be counted in diagnostics")
        let leftoverItems = first.plan.days.flatMap(\.items).filter {
            if case .plannedReuse = $0.leftoverRelationship { return true }
            return false
        }
        expect(leftoverItems.count == 9, "Three non-cooking days should reuse one planned leftover per enabled slot")
        expect(first.diagnostics.variety?.passed == true, "Generated plans must pass final variety validation")
        expect(first.diagnostics.toleranceEvaluation?.contractVersion == "planner-tolerance-v1", "Whole-week optimization should record its tolerance contract")
        expect(first.diagnostics.toleranceEvaluation?.dailyCalorieAbsoluteDeviationPercentages?.count == 7, "Diagnostics should capture daily absolute calorie percentages")
        expect(first.diagnostics.toleranceEvaluation?.weeklyCalorieAbsoluteDeviationPercent != nil, "Diagnostics should capture weekly absolute calorie percentage")
        expect(first.diagnostics.ingredientReusePercentage != nil, "Diagnostics should capture ingredient reuse as a percentage")
        expect(first.diagnostics.activeCookingMinutesByDay?.count == 7, "Diagnostics should capture cooking load for each day")
        expect((first.diagnostics.cookingSessionCount ?? 0) > 0, "Diagnostics should capture the number of cooking sessions")
        expect(first.diagnostics.estimatedWasteGrams != nil, "Available purchase-pack sizes should produce an estimated waste value")
        expect(first.diagnostics.estimatedWasteCoveragePercentage == 100, "Waste diagnostics should state their pack-size coverage")
        expect(first.plan.generatorVersion == "whole-week-serving-planner-v2", "Generated plans should identify the whole-week serving optimizer")
        expect(first.plan.days.flatMap(\.items).allSatisfy {
            RecipeEligibilityPolicy.servingMultiplier($0.servingMultiplier, isAllowedFor: $0.recipeSnapshot)
        }, "Whole-week optimization must stay inside every reviewed serving range")

        var infeasibleProfile = profile
        infeasibleProfile.calorieTarget = 1_000
        infeasibleProfile.optionalDailyProteinTargetGrams = 50
        infeasibleProfile.enabledMealSlots = [.dinner]
        infeasibleProfile.leftoverPreference = .avoid
        let fixedRecipes = (0..<7).map {
            sampleRecipe(
                id: "fixed-low-energy-\($0)",
                calories: 800,
                eligibleSlots: [.dinner],
                tags: ["dinner"]
            )
        }
        let infeasibleResult = try DeterministicPlanner.generate(PlannerInput(
            profile: infeasibleProfile,
            weekStart: input.weekStart,
            recipes: fixedRecipes,
            deterministicSeed: "fixed-infeasible-week",
            trigger: "release-gate-check"
        ))
        expect(
            infeasibleResult.diagnostics.toleranceEvaluation?.relaxations == ["optional_protein", "daily_calories", "weekly_calories"],
            "Infeasible reviewed serving bounds should preserve safety and document protein, daily-calorie, and weekly-calorie relaxations"
        )
        expect(first.diagnostics.explanations.contains { $0.code == .plannedLeftover }, "Planner output should explain intentional leftovers")
        let envelope = PlanReadEnvelope(job: nil, plan: first.plan, diagnostics: first.diagnostics)
        let encodedEnvelope = try JSONEncoder().encode(envelope)
        let decodedEnvelope = try JSONDecoder().decode(PlanReadEnvelope.self, from: encodedEnvelope)
        expect(decodedEnvelope == envelope, "Materialized plan snapshots and diagnostics should survive the native API wire format")
        try weeklyLoopChecks(plan: first.plan, profile: profile, recipes: recipes)

        let lockedItem = first.plan.days[0].items[0]
        let lockedInput = PlannerInput(
            profile: profile,
            weekStart: input.weekStart,
            recipes: recipes,
            deterministicSeed: "regeneration-seed",
            trigger: "user_regeneration",
            regenerationReason: "Keep Monday breakfast; vary the rest",
            lockedItems: [LockedPlannerItem(dayOffset: 0, item: lockedItem)]
        )
        let lockedResult = try DeterministicPlanner.generate(lockedInput)
        expect(lockedResult.plan.days[0].items.contains(lockedItem), "A safe locked meal should survive regeneration unchanged")
        expect(lockedResult.diagnostics.explanations.contains { $0.planItemID == lockedItem.id && $0.code == .lockedByUser }, "Locked meals should be explicit in diagnostics")

        var unsafeLockedItem = lockedItem
        unsafeLockedItem.recipeSnapshot = unsafeFavorite
        do {
            _ = try DeterministicPlanner.generate(
                PlannerInput(
                    profile: profile,
                    weekStart: input.weekStart,
                    recipes: recipes,
                    deterministicSeed: "unsafe-lock",
                    trigger: "user_regeneration",
                    lockedItems: [LockedPlannerItem(dayOffset: 0, item: unsafeLockedItem)]
                )
            )
            fail("A locked meal that violates an allergen must be rejected")
        } catch PlannerFailure.invalidLockedItem {
            // Expected.
        }

        var insufficientProfile = profile
        insufficientProfile.enabledMealSlots = [.dinner]
        insufficientProfile.leftoverPreference = .avoid
        do {
            _ = try DeterministicPlanner.generate(
                PlannerInput(
                    profile: insufficientProfile,
                    weekStart: input.weekStart,
                    recipes: [recipes[0]],
                    deterministicSeed: "insufficient-pool",
                    trigger: "test"
                )
            )
            fail("An insufficient unique recipe pool should fail explicitly")
        } catch let PlannerFailure.noFeasiblePlan(diagnostics) {
            expect(diagnostics.candidatePoolSize == 1, "Failure diagnostics should retain the candidate-pool size")
            expect(diagnostics.rejectedCandidateCounts[PlannerRejectionReason.varietyLimit.rawValue, default: 0] > 0, "Failure diagnostics should explain variety exhaustion")
        }
    }

    private static func weeklyLoopChecks(plan: WeeklyPlan, profile: UserProfile, recipes: [RecipeSnapshot]) throws {
        var snapshot = WeeklyLoopSnapshot.materialize(plan: plan)
        let expectedSpinachGrams = plan.days.flatMap(\.items).reduce(Decimal.zero) { total, item in
            if case .plannedReuse = item.leftoverRelationship { return total }
            return total + item.recipeSnapshot.ingredients
                .filter { $0.ingredientID == "spinach" }
                .reduce(Decimal.zero) { $0 + $1.grams * item.servingMultiplier }
        }
        let spinach = snapshot.groceryList.items.first { $0.ingredientID == "spinach" }
        expect(spinach?.requiredGrams == expectedSpinachGrams, "Groceries should normalize ingredient quantities to grams without double-counting planned leftovers")
        expect(!snapshot.prepTimeline.tasks.isEmpty, "Linked leftovers should produce plan-derived prep tasks")
        expect(snapshot.prepTimeline.tasks.allSatisfy { !$0.storageNote.isEmpty && !$0.reuseNote.isEmpty }, "Every prep task should explain storage and reuse")

        if let spinachIndex = snapshot.groceryList.items.firstIndex(where: { $0.ingredientID == "spinach" }) {
            snapshot.groceryList.items[spinachIndex].disposition = .checked
            snapshot.groceryList.items[spinachIndex].userAdjustedGrams = expectedSpinachGrams + 25
        }
        let linkedSourceIDs = Set(plan.days.flatMap(\.items).compactMap { item -> String? in
            guard case let .plannedReuse(_, sourceID) = item.leftoverRelationship else { return nil }
            return sourceID
        })
        guard let original = plan.days.flatMap(\.items).first(where: { item in
            if case .batchSource = item.leftoverRelationship { return !linkedSourceIDs.contains(item.id) }
            return false
        }) else { fail("Planner fixture should contain an unreserved batch meal") }
        var replacement = sampleRecipe(
            id: "weekly-loop-tofu",
            calories: original.nutrition.calories + 35,
            eligibleSlots: Set(PlanSlot.allCases),
            tags: [original.slot.rawValue],
            ingredientID: "tofu",
            ingredientName: "Firm tofu",
            ingredientGrams: 180
        )
        replacement.minimumServingMultiplier = Decimal(string: "0.75")
        replacement.maximumServingMultiplier = Decimal(string: "1.25")
        let candidates = WeeklyLoopEngine.swapCandidates(
            replacing: original.id,
            in: snapshot.plan,
            recipes: recipes + [replacement],
            profile: profile
        )
        guard let replacementCandidate = candidates.first(where: { $0.recipe.recipeID == replacement.recipeID }) else {
            fail("Swap ranking should expose only whole-plan-safe candidates")
        }
        expect(
            replacementCandidate.servingMultiplier.map { $0 >= Decimal(string: "0.75")! && $0 <= Decimal(string: "1.25")! } == true,
            "Swap comparisons should use the same reviewed serving bounds as generation"
        )

        let mutation = try WeeklyLoopEngine.applySwap(
            to: snapshot,
            expectedRevision: snapshot.revision,
            mutationID: "swap-1",
            itemID: original.id,
            replacement: replacement,
            profile: profile
        )
        expect(mutation.snapshot.revision == 2, "An atomic swap should advance the weekly-loop revision")
        let swappedItem = mutation.snapshot.plan.days.flatMap(\.items).first { $0.id == original.id }
        expect(swappedItem?.recipeSnapshot.recipeID == replacement.recipeID, "The selected immutable recipe snapshot should replace the original item")
        expect(swappedItem?.servingMultiplier == replacementCandidate.servingMultiplier, "Confirmed swaps should preserve the reviewed serving shown in comparison")
        let swapCalorieDelta = (swappedItem?.nutrition.calories ?? 0) - original.nutrition.calories
        let originalWeekCalories = snapshot.plan.days.reduce(Decimal.zero) { $0 + $1.nutrition.calories }
        let swappedWeekCalories = mutation.snapshot.plan.days.reduce(Decimal.zero) { $0 + $1.nutrition.calories }
        expect(swappedWeekCalories == originalWeekCalories + swapCalorieDelta, "Weekly nutrition totals should reflect the bounded serving in the same mutation")
        let originalDayCalories = snapshot.plan.days.first { $0.localDate == original.localDate }?.nutrition.calories
        let swappedDayCalories = mutation.snapshot.plan.days.first { $0.localDate == original.localDate }?.nutrition.calories
        expect(swappedDayCalories == originalDayCalories.map { $0 + swapCalorieDelta }, "Daily nutrition totals should reflect the bounded serving in the same mutation")
        expect(mutation.addedIngredientIDs.contains("tofu"), "A swap should report newly added grocery ingredients")
        expect(mutation.changedIngredientIDs.contains("spinach"), "A swap should report changed grocery quantities")
        let preservedSpinach = mutation.snapshot.groceryList.items.first { $0.ingredientID == "spinach" }
        expect(preservedSpinach?.disposition == .checked && preservedSpinach?.userAdjustedGrams == expectedSpinachGrams + 25, "Grocery check-off and quantity edits should survive recalculation")

        do {
            _ = try WeeklyLoopEngine.applySwap(
                to: mutation.snapshot,
                expectedRevision: 1,
                mutationID: "stale-swap",
                itemID: original.id,
                replacement: replacement,
                profile: profile
            )
            fail("A stale weekly-loop mutation should fail")
        } catch WeeklyLoopMutationError.revisionConflict {
            // Expected.
        }

        let unsafe = sampleRecipe(
            id: "unsafe-weekly-loop-swap",
            allergenIDs: ["peanuts"],
            eligibleSlots: Set(PlanSlot.allCases),
            ingredientID: "peanut",
            ingredientName: "Peanuts"
        )
        do {
            _ = try WeeklyLoopEngine.applySwap(
                to: snapshot,
                expectedRevision: snapshot.revision,
                mutationID: "unsafe-swap",
                itemID: original.id,
                replacement: unsafe,
                profile: profile
            )
            fail("A swap must never override allergen safety")
        } catch WeeklyLoopMutationError.hardEligibilityViolation {
            // Expected.
        }

        let encoded = try JSONEncoder().encode(mutation.snapshot)
        let decoded = try JSONDecoder().decode(WeeklyLoopSnapshot.self, from: encoded)
        expect(decoded == mutation.snapshot, "Weekly plan, grocery, prep, and offline state should round-trip together")
    }

    private static func catalogueChecks() async throws {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let ingredient = IngredientDefinition(
            id: "spinach",
            canonicalName: "Spinach",
            aliases: ["palak"],
            category: .produce,
            compatibleDiets: [.vegan, .vegetarian, .eggetarian],
            conversions: [UnitConversion(householdUnit: "cup", householdQuantity: 1, grams: 60)],
            sourceStatus: .verified
        )
        let source = NutrientSourceReference(
            id: "source-spinach-v1",
            provider: "Licensed fixture provider",
            dataset: "Test nutrients",
            datasetVersion: "2026.1",
            sourceRecordID: "spinach-raw",
            sourceURL: nil,
            licenseStatus: .approvedForProduction,
            retrievedAt: now
        )
        let nutrient = IngredientNutrientRecord(
            id: "nutrient-spinach-v1",
            ingredientID: ingredient.id,
            nutritionPer100Grams: Nutrition(calories: 23, proteinGrams: 2.9, carbohydrateGrams: 3.6, fatGrams: 0.4, fibreGrams: 2.2),
            source: source,
            confidence: .high,
            effectiveFrom: now.addingTimeInterval(-86_400),
            effectiveUntil: nil,
            reviewedBy: "nutrient-reviewer",
            reviewedAt: now
        )
        let recipe = RecipeRecord(
            id: "sauteed-spinach",
            localeIdentifier: "en-IN",
            cuisine: "Indian",
            eligibleSlots: [.lunch, .dinner],
            activePreparationMinutes: 10,
            totalMinutes: 15,
            equipment: ["pan"],
            costBand: .value
        )
        let content = RecipeVersionContent(
            displayName: "Sautéed spinach",
            ingredients: [RecipeIngredient(ingredientID: ingredient.id, householdQuantity: 2, householdUnit: "cups", grams: 120)],
            methodSteps: ["Wash, dry, and sauté the spinach until just wilted."],
            servings: 1,
            servingSizeGrams: 120,
            nutritionPerServing: Nutrition(calories: 28, proteinGrams: 3.5, carbohydrateGrams: 4.3, fatGrams: 0.5, fibreGrams: 2.6),
            dietType: .vegan,
            declaredAllergenIDs: [],
            dominantIngredientIDs: [ingredient.id],
            tags: ["quick", "dinner"],
            nutrientRecordIDs: [nutrient.id],
            nutritionCalculationVersion: "weighted-grams-v1",
            minimumServingMultiplier: Decimal(string: "0.75"),
            maximumServingMultiplier: Decimal(string: "1.25")
        )
        let catalogue = InMemoryRecipeCatalogue()
        await catalogue.registerIngredient(ingredient)
        await catalogue.registerNutrientRecord(nutrient)
        await catalogue.registerRecipe(recipe)
        let author = CatalogueActor(id: "author-1", roles: [.author])
        let reviewer = CatalogueActor(id: "reviewer-1", roles: [.reviewer])
        let draft = try await catalogue.createDraft(recipeID: recipe.id, content: content, actor: author, at: now)
        let submitted = try await catalogue.submit(id: draft.id, actor: author, at: now)
        expect(submitted.workflowState == .inReview, "Valid catalogue content should enter review")
        let published = try await catalogue.approve(id: draft.id, actor: reviewer, at: now)
        expect(published.workflowState == .published, "A separate authorized reviewer should publish valid content")
        let snapshot = try await catalogue.publishedSnapshot(id: draft.id)
        expect(snapshot.publicationStatus == .published && snapshot.reviewStatus == .approved, "Only published catalogue versions should materialize approved plan snapshots")
        expect(snapshot.nutritionSourceSummary.contains("2026.1"), "Plan snapshots should retain attributable nutrient source versions")
        expect(snapshot.minimumServingMultiplier == Decimal(string: "0.75") && snapshot.maximumServingMultiplier == Decimal(string: "1.25"), "Published snapshots should retain reviewer-approved serving bounds")
        do {
            _ = try await catalogue.editDraft(id: draft.id, content: content, actor: author, at: now)
            fail("Published versions must be immutable")
        } catch CatalogueWorkflowError.immutablePublishedVersion {
            // Expected.
        }
        let nextDraft = try await catalogue.createDraft(recipeID: recipe.id, content: content, actor: author, at: now)
        let originalPublishedVersion = await catalogue.version(id: draft.id)
        expect(nextDraft.version == 2, "Changes after publication should create a new recipe version")
        expect(originalPublishedVersion?.workflowState == .published, "Creating a new draft must not mutate the published version")
        let auditLog = await catalogue.auditLog()
        expect(auditLog.map(\.action) == ["recipe_version.created", "recipe_version.submitted", "recipe_version.published", "recipe_version.created"], "Catalogue transitions should create an ordered audit trail")

        let unlicensedSource = NutrientSourceReference(
            id: "unlicensed-source",
            provider: "Unknown fixture",
            dataset: "Unlicensed",
            datasetVersion: "1",
            sourceRecordID: "spinach",
            sourceURL: nil,
            licenseStatus: .unknown,
            retrievedAt: now
        )
        let unlicensedRecord = IngredientNutrientRecord(
            id: "unlicensed-nutrient",
            ingredientID: ingredient.id,
            nutritionPer100Grams: nutrient.nutritionPer100Grams,
            source: unlicensedSource,
            confidence: .low,
            effectiveFrom: now,
            effectiveUntil: nil,
            reviewedBy: "reviewer",
            reviewedAt: now
        )
        let unlicensedContent = RecipeVersionContent(
            displayName: content.displayName,
            ingredients: content.ingredients,
            methodSteps: content.methodSteps,
            servings: content.servings,
            servingSizeGrams: content.servingSizeGrams,
            nutritionPerServing: content.nutritionPerServing,
            dietType: content.dietType,
            declaredAllergenIDs: content.declaredAllergenIDs,
            dominantIngredientIDs: content.dominantIngredientIDs,
            tags: content.tags,
            nutrientRecordIDs: [unlicensedRecord.id],
            nutritionCalculationVersion: content.nutritionCalculationVersion
        )
        let issues = RecipeCatalogueValidator.issues(
            for: unlicensedContent,
            ingredients: [ingredient.id: ingredient],
            nutrientRecords: [unlicensedRecord.id: unlicensedRecord],
            at: now
        )
        expect(issues.contains(.nutrientSourceNotLicensed(unlicensedRecord.id)), "Unlicensed nutrient sources must block catalogue publication")
        let invalidServingContent = RecipeVersionContent(
            displayName: content.displayName,
            ingredients: content.ingredients,
            methodSteps: content.methodSteps,
            servings: content.servings,
            servingSizeGrams: content.servingSizeGrams,
            nutritionPerServing: content.nutritionPerServing,
            dietType: content.dietType,
            declaredAllergenIDs: content.declaredAllergenIDs,
            dominantIngredientIDs: content.dominantIngredientIDs,
            tags: content.tags,
            nutrientRecordIDs: content.nutrientRecordIDs,
            nutritionCalculationVersion: content.nutritionCalculationVersion,
            minimumServingMultiplier: Decimal(string: "1.2"),
            maximumServingMultiplier: Decimal(string: "0.8")
        )
        expect(
            RecipeCatalogueValidator.issues(
                for: invalidServingContent,
                ingredients: [ingredient.id: ingredient],
                nutrientRecords: [nutrient.id: nutrient],
                at: now
            ).contains(.invalidServing),
            "Catalogue review should block malformed serving bounds"
        )
    }

    private static func weeklyLoopRepositoryChecks() async throws {
        var profile = sampleProfile()
        profile.snackPreference = .none
        let recipes = (0..<12).map { index in
            sampleRecipe(
                id: "offline-recipe-\(index)",
                calories: Decimal(480 + index * 10),
                eligibleSlots: Set(PlanSlot.allCases),
                tags: ["offline"]
            )
        }
        let result = try DeterministicPlanner.generate(PlannerInput(
            profile: profile,
            weekStart: LocalDate(year: 2026, month: 8, day: 3),
            recipes: recipes,
            deterministicSeed: "offline-weekly-loop",
            trigger: "test"
        ))
        let snapshot = WeeklyLoopSnapshot.materialize(plan: result.plan)
        let fileURL = FileManager.default.temporaryDirectory
            .appending(path: "nourish-weekly-loop-check-\(UUID().uuidString)")
            .appending(path: "weekly-loop.json")
        let repository = FileWeeklyLoopRepository(fileURL: fileURL)
        _ = try await repository.replace(with: snapshot, markSynced: true)

        guard let grocery = snapshot.groceryList.items.first,
              let meal = snapshot.plan.days.first?.items.first else {
            fail("A materialized weekly loop should contain groceries and meals")
        }
        let mutationDate = Date(timeIntervalSince1970: 1_785_715_200)
        let checked = try await repository.applyLocal(
            id: "grocery-check-1",
            mutation: .groceryDisposition(itemID: grocery.id, disposition: .checked),
            expectedRevision: snapshot.revision,
            at: mutationDate
        )
        expect(checked.snapshot.groceryList.items.first { $0.id == grocery.id }?.disposition == .checked, "Offline grocery check-off should be persisted")
        expect(checked.pendingMutations.count == 1, "Offline changes should enter the sync journal")

        let replay = try await repository.applyLocal(
            id: "grocery-check-1",
            mutation: .groceryDisposition(itemID: grocery.id, disposition: .checked),
            expectedRevision: snapshot.revision,
            at: mutationDate
        )
        expect(replay == checked, "Replaying a local mutation ID should be idempotent")

        let quantity = try await repository.applyLocal(
            id: "grocery-quantity-1",
            mutation: .groceryQuantity(itemID: grocery.id, grams: grocery.requiredGrams + 50),
            expectedRevision: checked.snapshot.revision,
            at: mutationDate.addingTimeInterval(1)
        )
        let mealState = try await repository.applyLocal(
            id: "meal-state-1",
            mutation: .mealCompletion(itemID: meal.id, state: .completed),
            expectedRevision: quantity.snapshot.revision,
            at: mutationDate.addingTimeInterval(2)
        )
        expect(mealState.snapshot.plan.days.flatMap(\.items).first { $0.id == meal.id }?.completionState == .completed, "Offline meal status should be part of the same persisted document")

        var latest = mealState
        if let prep = mealState.snapshot.prepTimeline.tasks.first {
            latest = try await repository.applyLocal(
                id: "prep-state-1",
                mutation: .prepCompletion(taskID: prep.id, isComplete: true),
                expectedRevision: mealState.snapshot.revision,
                at: mutationDate.addingTimeInterval(3)
            )
            expect(latest.snapshot.prepTimeline.tasks.first { $0.id == prep.id }?.isComplete == true, "Offline prep completion should persist")
        }
        let restored = try await FileWeeklyLoopRepository(fileURL: fileURL).read()
        expect(restored == latest, "A clean repository instance should restore the complete weekly loop and pending journal")

        do {
            _ = try await repository.applyLocal(
                id: "stale-local-change",
                mutation: .mealCompletion(itemID: meal.id, state: .skipped),
                expectedRevision: snapshot.revision
            )
            fail("A stale offline edit should not overwrite newer weekly-loop state")
        } catch FileWeeklyLoopRepositoryError.revisionConflict {
            // Expected.
        }

        let synced = try await repository.markSynced(through: latest.snapshot.revision)
        expect(synced.pendingMutations.isEmpty, "Acknowledged offline mutations should leave the pending sync journal")
        expect(synced.lastSyncedRevision == latest.snapshot.revision, "The local repository should retain its last acknowledged revision")

        let activeEnvelope = ActiveWeeklyLoopEnvelope(
            plan: result.plan,
            diagnostics: result.diagnostics,
            groceryList: RemoteGroceryList(
                id: snapshot.groceryList.id,
                planID: snapshot.plan.id,
                items: snapshot.groceryList.items,
                revision: 1
            ),
            prepTimeline: snapshot.prepTimeline,
            revision: 1,
            operationalRevisions: WeeklyLoopOperationalRevisions(
                grocery: 1,
                meals: Dictionary(uniqueKeysWithValues: snapshot.plan.days.flatMap(\.items).map { ($0.id, 0) }),
                prep: Dictionary(uniqueKeysWithValues: snapshot.prepTimeline.tasks.map { ($0.id, 0) })
            )
        )
        let syncRemote = StubWeeklyLoopRemote(active: activeEnvelope)
        let syncURL = FileManager.default.temporaryDirectory
            .appending(path: "nourish-weekly-sync-check-\(UUID().uuidString)")
            .appending(path: "weekly-loop.json")
        let syncRepository = FileWeeklyLoopRepository(fileURL: syncURL)
        let syncEngine = WeeklyLoopSyncEngine(repository: syncRepository, remote: syncRemote)
        guard case let .synced(activated) = await syncEngine.restoreAndSynchronize() else {
            fail("An adopted remote plan should activate into protected local storage")
        }
        expect(activated.snapshot.plan.id == snapshot.plan.id, "Active-plan synchronization should retain the adopted immutable plan ID")

        guard let activeGrocery = activated.snapshot.groceryList.items.first,
              let activeMeal = activated.snapshot.plan.days.first?.items.first,
              let activePrep = activated.snapshot.prepTimeline.tasks.first else {
            fail("The active weekly-loop fixture should contain grocery, meal, and prep state")
        }
        let queuedGrocery = try await syncRepository.applyLocal(
            id: "sync-grocery-1",
            mutation: .groceryDisposition(itemID: activeGrocery.id, disposition: .checked),
            expectedRevision: activated.snapshot.revision,
            at: mutationDate
        )
        let queuedMeal = try await syncRepository.applyLocal(
            id: "sync-meal-1",
            mutation: .mealCompletion(itemID: activeMeal.id, state: .completed),
            expectedRevision: queuedGrocery.snapshot.revision,
            at: mutationDate.addingTimeInterval(1)
        )
        _ = try await syncRepository.applyLocal(
            id: "sync-prep-1",
            mutation: .prepCompletion(taskID: activePrep.id, isComplete: true),
            expectedRevision: queuedMeal.snapshot.revision,
            at: mutationDate.addingTimeInterval(2)
        )
        guard case let .synced(replayed) = await syncEngine.restoreAndSynchronize() else {
            fail("Queued weekly-loop mutations should replay when the remote is available")
        }
        expect(replayed.pendingMutations.isEmpty, "Successful replay should acknowledge every queued mutation")
        expect(replayed.snapshot.groceryList.items.first { $0.id == activeGrocery.id }?.disposition == .checked, "Remote refresh should retain synchronized grocery state")
        expect(replayed.snapshot.plan.days.flatMap(\.items).first { $0.id == activeMeal.id }?.completionState == .completed, "Remote refresh should retain synchronized meal state")
        expect(replayed.snapshot.prepTimeline.tasks.first { $0.id == activePrep.id }?.isComplete == true, "Remote refresh should retain synchronized prep state")

        let offlineQueued = try await syncRepository.applyLocal(
            id: "offline-after-sync",
            mutation: .groceryQuantity(itemID: activeGrocery.id, grams: activeGrocery.requiredGrams + 75),
            expectedRevision: replayed.snapshot.revision,
            at: mutationDate.addingTimeInterval(3)
        )
        await syncRemote.setAvailable(false)
        guard case let .localPending(pending, _) = await syncEngine.restoreAndSynchronize() else {
            fail("Unavailable sync should keep the active week and its local journal")
        }
        expect(pending.snapshot == offlineQueued.snapshot && pending.pendingMutations.count == 1, "Offline activation should never discard the latest local mutation")
    }

    private static func profileRepositoryChecks() async throws {
        let profile = sampleProfile()
        let repository = InMemoryProfileRepository()
        let stored = try await repository.update(ProfileUpdateRequest(profile: profile, changeScope: .nextPlanOnly, expectedRevision: 0))
        expect(stored.revision == 1, "First profile update should advance revision")
        expect(stored.effectiveScope == .nextPlanOnly, "Profile update should preserve explicit change scope")
        do {
            _ = try await repository.update(ProfileUpdateRequest(profile: profile, changeScope: .currentAndFuturePlans, expectedRevision: 0))
            fail("A stale profile revision should fail")
        } catch let error as APIErrorEnvelope {
            expect(error.code == .conflict, "A stale profile revision should return CONFLICT")
        }

        let fileURL = FileManager.default.temporaryDirectory
            .appending(path: "nourish-profile-check-\(UUID().uuidString)")
            .appending(path: "profile.json")
        let fileRepository = FileProfileRepository(fileURL: fileURL)
        let persisted = try await fileRepository.update(
            ProfileUpdateRequest(profile: profile, changeScope: .currentAndFuturePlans, expectedRevision: 0)
        )
        let restored = try await FileProfileRepository(fileURL: fileURL).read()
        expect(restored == persisted, "File profile repository should restore the complete profile and revision")
    }

    private static func profileSyncChecks() async throws {
        let baseProfile = sampleProfile()

        let newAccountLocal = InMemoryProfileRepository(
            seed: StoredProfile(profile: baseProfile, revision: 1, effectiveScope: .currentAndFuturePlans)
        )
        let newAccountRemote = InMemoryProfileRepository()
        let uploaded = try await ProfileSyncEngine(local: newAccountLocal, remote: newAccountRemote)
            .synchronize(localHasPendingChanges: true)
        let uploadedRemoteProfile = try await newAccountRemote.read()
        expect(uploaded.action == .uploadedLocal, "A new authenticated account should receive the local onboarding profile")
        expect(uploadedRemoteProfile?.profile == baseProfile, "Uploaded onboarding data should be readable remotely")

        var existingProfile = baseProfile
        existingProfile.calorieTarget = 2_050
        let existingLocal = InMemoryProfileRepository(
            seed: StoredProfile(profile: baseProfile, revision: 1, effectiveScope: .currentAndFuturePlans)
        )
        let existingRemote = InMemoryProfileRepository(
            seed: StoredProfile(profile: existingProfile, revision: 4, effectiveScope: .nextPlanOnly)
        )
        let downloaded = try await ProfileSyncEngine(local: existingLocal, remote: existingRemote)
            .synchronize(localHasPendingChanges: false)
        let downloadedLocalProfile = try await existingLocal.read()
        expect(downloaded.action == .downloadedRemote, "An existing account should restore its server profile when local data is clean")
        expect(downloadedLocalProfile?.profile.calorieTarget == 2_050, "The downloaded account profile should replace clean local data")

        var editedProfile = baseProfile
        editedProfile.maximumActiveMinutes = 20
        let editedLocal = InMemoryProfileRepository(
            seed: StoredProfile(profile: editedProfile, revision: 2, effectiveScope: .nextPlanOnly)
        )
        let editedRemote = InMemoryProfileRepository(
            seed: StoredProfile(profile: baseProfile, revision: 3, effectiveScope: .currentAndFuturePlans)
        )
        let reconciled = try await ProfileSyncEngine(local: editedLocal, remote: editedRemote)
            .synchronize(localHasPendingChanges: true)
        let reconciledRemoteProfile = try await editedRemote.read()
        expect(reconciled.action == .uploadedLocal, "A recorded offline edit should win over an older server profile")
        expect(reconciledRemoteProfile?.profile.maximumActiveMinutes == 20, "Offline profile edits should be uploaded")
    }

    private static func sessionChecks() async throws {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let identity = SessionIdentity(userID: "user-1", verifiedEmail: "rhea@example.test")
        let firstSession = AppSession(
            identity: identity,
            accessToken: SensitiveToken("access-secret"),
            refreshToken: SensitiveToken("refresh-secret"),
            accessTokenExpiresAt: now.addingTimeInterval(3_600)
        )
        let refreshedSession = AppSession(
            identity: identity,
            accessToken: SensitiveToken("fresh-access-secret"),
            refreshToken: SensitiveToken("fresh-refresh-secret"),
            accessTokenExpiresAt: now.addingTimeInterval(7_200)
        )
        let remote = StubAuthenticationRemote(signInSession: firstSession, refreshedSession: refreshedSession)
        let storage = InMemorySessionStorage()
        let manager = SessionManager(remote: remote, storage: storage)
        let credential = AppleCredentialExchange(
            identityToken: SensitiveToken("identity-secret"),
            authorizationCode: SensitiveToken("authorization-secret"),
            nonce: SensitiveToken("nonce-secret")
        )

        let signedIn = try await manager.signInWithApple(credential)
        let persistedAfterSignIn = try await storage.load()
        expect(signedIn == .authenticated(identity), "Apple credential exchange should expose identity without exposing tokens")
        expect(persistedAfterSignIn == firstSession, "Authenticated sessions should be persisted")
        expect(firstSession.accessToken.description == "<redacted>", "Tokens must redact their descriptions")
        let encodedToken = try JSONEncoder().encode(firstSession.accessToken)
        expect(String(decoding: encodedToken, as: UTF8.self) == "\"access-secret\"", "Wire tokens should encode as single JSON strings")

        let receipt = try await manager.requestMagicLink(email: "rhea@example.test")
        expect(receipt.requestID == "magic-request-1", "Magic-link requests should return a typed receipt")

        let magicLinkState = try await manager.completeMagicLink(
            callbackURL: URL(string: "https://example.test/auth/callback?token=redacted")!
        )
        expect(magicLinkState == .authenticated(identity), "Magic-link callback completion should persist an authenticated session")

        try await manager.signOut()
        let persistedAfterSignOut = try await storage.load()
        let revocationCount = await remote.revocationCount()
        expect(persistedAfterSignOut == nil, "Sign-out should clear local session storage")
        expect(revocationCount == 1, "Sign-out should request remote token revocation")

        let expired = AppSession(
            identity: identity,
            accessToken: SensitiveToken("expired-access"),
            refreshToken: SensitiveToken("refresh-secret"),
            accessTokenExpiresAt: now.addingTimeInterval(-1)
        )
        let expiringStorage = InMemorySessionStorage(seed: expired)
        let restoringManager = SessionManager(remote: remote, storage: expiringStorage)
        let restored = try await restoringManager.restore(at: now)
        let persistedAfterRefresh = try await expiringStorage.load()
        let refreshCount = await remote.refreshCount()
        expect(restored == .authenticated(identity), "Restore should refresh an expired session")
        expect(persistedAfterRefresh == refreshedSession, "Refreshed tokens should replace expired Keychain material")
        expect(refreshCount == 1, "Expired restore should refresh exactly once")
    }

    private static func sampleProfile() -> UserProfile {
        var draft = OnboardingDraft()
        draft.confirmsAdult = true
        draft.confirmsGeneralWellnessFit = true
        draft.confirmsNutritionEstimates = true
        return draft.profile(consentAcceptedAt: Date(timeIntervalSince1970: 1_700_000_000))
    }

    private static func sampleRecipe(
        id: String,
        allergenIDs: Set<String> = [],
        calories: Decimal = 500,
        reviewStatus: RecipeReviewStatus = .approved,
        publicationStatus: RecipePublicationStatus = .published,
        eligibleSlots: Set<PlanSlot> = [.dinner],
        tags: Set<String> = ["dinner"],
        ingredientID: String = "spinach",
        ingredientName: String = "Spinach",
        ingredientGrams: Decimal = 120
    ) -> RecipeSnapshot {
        RecipeSnapshot(
            recipeID: id,
            localeIdentifier: "en-IN",
            version: 1,
            displayName: id,
            ingredients: [IngredientSnapshot(ingredientID: ingredientID, displayName: ingredientName, householdQuantity: 2, householdUnit: "cups", grams: ingredientGrams, allergenIDs: allergenIDs)],
            methodSteps: ["Cook until done."],
            servingSizeGrams: 350,
            nutritionPerServing: Nutrition(calories: calories, proteinGrams: 25, carbohydrateGrams: 60, fatGrams: 18, fibreGrams: 10),
            activePreparationMinutes: 25,
            totalMinutes: 35,
            tags: tags,
            allergenIDs: allergenIDs,
            dietType: .vegetarian,
            eligibleSlots: eligibleSlots,
            dominantIngredientIDs: [id],
            nutritionSourceSummary: "Reviewed synthetic fixture",
            nutritionCalculationVersion: "nutrition-v1",
            reviewStatus: reviewStatus,
            publicationStatus: publicationStatus
        )
    }

    private static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        if !condition() { fail(message) }
    }

    private static func fail(_ message: String) -> Never {
        fatalError("NourishCore check failed: \(message)")
    }
}

private actor StubAuthenticationRemote: AuthenticationRemote {
    private let signInSession: AppSession
    private let refreshedSession: AppSession
    private var refreshes = 0
    private var revocations = 0

    init(signInSession: AppSession, refreshedSession: AppSession) {
        self.signInSession = signInSession
        self.refreshedSession = refreshedSession
    }

    func exchangeAppleCredential(_ credential: AppleCredentialExchange) async throws -> AppSession {
        signInSession
    }

    func requestMagicLink(email: String) async throws -> MagicLinkRequestReceipt {
        MagicLinkRequestReceipt(requestID: "magic-request-1", resendAvailableAt: .now.addingTimeInterval(60))
    }

    func completeMagicLink(callbackURL: URL) async throws -> AppSession {
        signInSession
    }

    func refreshSession(using refreshToken: SensitiveToken) async throws -> AppSession {
        refreshes += 1
        return refreshedSession
    }

    func revokeSession(accessToken: SensitiveToken) async throws {
        revocations += 1
    }

    func refreshCount() -> Int { refreshes }
    func revocationCount() -> Int { revocations }
}

private actor StubWeeklyLoopRemote: WeeklyLoopRemote {
    private var active: ActiveWeeklyLoopEnvelope
    private var available = true
    private let now = Date(timeIntervalSince1970: 1_785_715_200)

    init(active: ActiveWeeklyLoopEnvelope) {
        self.active = active
    }

    func setAvailable(_ value: Bool) {
        available = value
    }

    func readActiveWeeklyLoop() async throws -> ActiveWeeklyLoopEnvelope {
        try requireAvailable()
        return active
    }

    func swapCandidates(planItemID: String) async throws -> [SwapCandidate] {
        try requireAvailable()
        return []
    }

    func confirmSwap(planItemID: String, replacementRecipeID: String, idempotencyKey: String) async throws -> SwapConfirmationEnvelope {
        try requireAvailable()
        throw URLError(.unsupportedURL)
    }

    func readGroceryList(id: String) async throws -> RemoteGroceryList {
        try requireAvailable()
        guard id == active.groceryList.id else { throw URLError(.fileDoesNotExist) }
        return active.groceryList
    }

    func updateGroceryList(id: String, patch: GroceryListPatch) async throws -> RemoteGroceryList {
        try requireAvailable()
        guard id == active.groceryList.id, patch.expectedRevision == active.operationalRevisions.grocery else {
            throw APIErrorEnvelope(code: .conflict, userSafeMessage: "Grocery conflict", correlationID: "stub", retryable: true)
        }
        for change in patch.changes {
            guard let index = active.groceryList.items.firstIndex(where: { $0.id == change.itemID }) else { continue }
            if let disposition = change.disposition { active.groceryList.items[index].disposition = disposition }
            if let grams = change.userAdjustedGrams { active.groceryList.items[index].userAdjustedGrams = grams }
        }
        active.operationalRevisions.grocery += 1
        active.groceryList.revision = active.operationalRevisions.grocery
        active.revision = active.operationalRevisions.grocery
        return active.groceryList
    }

    func updateMealStatus(planItemID: String, state: MealCompletionState, expectedRevision: Int) async throws -> MealStatusReceipt {
        try requireAvailable()
        guard expectedRevision == active.operationalRevisions.meals[planItemID, default: 0] else {
            throw APIErrorEnvelope(code: .conflict, userSafeMessage: "Meal conflict", correlationID: "stub", retryable: true)
        }
        guard let day = active.plan.days.firstIndex(where: { $0.items.contains(where: { $0.id == planItemID }) }),
              let item = active.plan.days[day].items.firstIndex(where: { $0.id == planItemID }) else {
            throw URLError(.fileDoesNotExist)
        }
        active.plan.days[day].items[item].completionState = state
        active.operationalRevisions.meals[planItemID, default: 0] += 1
        return MealStatusReceipt(itemID: planItemID, state: state, revision: active.operationalRevisions.meals[planItemID]!, updatedAt: now)
    }

    func updatePrepTask(id: String, isComplete: Bool, expectedRevision: Int) async throws -> PrepTaskReceipt {
        try requireAvailable()
        guard expectedRevision == active.operationalRevisions.prep[id, default: 0] else {
            throw APIErrorEnvelope(code: .conflict, userSafeMessage: "Prep conflict", correlationID: "stub", retryable: true)
        }
        guard let index = active.prepTimeline.tasks.firstIndex(where: { $0.id == id }) else { throw URLError(.fileDoesNotExist) }
        active.prepTimeline.tasks[index].isComplete = isComplete
        active.operationalRevisions.prep[id, default: 0] += 1
        return PrepTaskReceipt(taskID: id, isComplete: isComplete, revision: active.operationalRevisions.prep[id]!, updatedAt: now)
    }

    private func requireAvailable() throws {
        if !available { throw URLError(.notConnectedToInternet) }
    }
}
