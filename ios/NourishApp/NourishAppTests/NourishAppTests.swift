import Foundation
import XCTest
import NourishAPI
import NourishCore
@testable import NourishUI

final class NourishAppTests: XCTestCase {
    func testAPIBaseURLPolicyAllowsOnlyLocalDebugHTTPOrRemoteHTTPSOrigins() throws {
        XCTAssertEqual(
            try APIBaseURLPolicy.validated(
                rawValue: "http://localhost:8080/",
                allowsLocalHTTP: true
            ).absoluteString,
            "http://localhost:8080"
        )
        XCTAssertEqual(
            try APIBaseURLPolicy.validated(
                rawValue: "https://staging-api.nourish.example",
                allowsLocalHTTP: false
            ).absoluteString,
            "https://staging-api.nourish.example"
        )
        XCTAssertEqual(
            try APIBaseURLPolicy.validated(
                rawValue: "http://nourish-mac.local:8080",
                allowsLocalHTTP: true
            ).absoluteString,
            "http://nourish-mac.local:8080"
        )
        XCTAssertThrowsError(
            try APIBaseURLPolicy.validated(
                rawValue: "http://192.168.1.20:8080",
                allowsLocalHTTP: true
            )
        ) { error in
            XCTAssertEqual(error as? APIBaseURLConfigurationError, .insecureRemoteOrigin)
        }
        XCTAssertThrowsError(
            try APIBaseURLPolicy.validated(
                rawValue: "http://8.8.8.8:8080",
                allowsLocalHTTP: true
            )
        ) { error in
            XCTAssertEqual(error as? APIBaseURLConfigurationError, .insecureRemoteOrigin)
        }
        XCTAssertThrowsError(
            try APIBaseURLPolicy.validated(
                rawValue: "http://staging-api.nourish.example",
                allowsLocalHTTP: true
            )
        ) { error in
            XCTAssertEqual(error as? APIBaseURLConfigurationError, .insecureRemoteOrigin)
        }
        XCTAssertThrowsError(
            try APIBaseURLPolicy.validated(
                rawValue: "https://CHANGE_ME_API_BASE_URL",
                allowsLocalHTTP: false
            )
        ) { error in
            XCTAssertEqual(error as? APIBaseURLConfigurationError, .placeholder)
        }
        XCTAssertThrowsError(
            try APIBaseURLPolicy.validated(
                rawValue: "https://user:secret@staging-api.nourish.example/path",
                allowsLocalHTTP: false
            )
        ) { error in
            XCTAssertEqual(error as? APIBaseURLConfigurationError, .invalidOrigin)
        }
    }

    func testOnboardingSafetyAndEstimateAcknowledgementAreRequired() throws {
        var draft = OnboardingDraft()

        XCTAssertThrowsError(try OnboardingValidator.validate(.wellnessEligibility, draft: draft)) { error in
            XCTAssertEqual(error as? OnboardingValidationError, .adultConfirmationRequired)
        }

        draft.confirmsAdult = true
        XCTAssertThrowsError(try OnboardingValidator.validate(.wellnessEligibility, draft: draft)) { error in
            XCTAssertEqual(error as? OnboardingValidationError, .unsuitableForPersonalizedPlanning)
        }

        draft.confirmsGeneralWellnessFit = true
        XCTAssertNoThrow(try OnboardingValidator.validate(.wellnessEligibility, draft: draft))
        XCTAssertThrowsError(try OnboardingValidator.validate(.review, draft: draft)) { error in
            XCTAssertEqual(error as? OnboardingValidationError, .nutritionEstimateConfirmationRequired)
        }

        draft.confirmsNutritionEstimates = true
        XCTAssertNoThrow(try OnboardingValidator.validate(.review, draft: draft))
    }

    func testNonVegetarianDietRoundTripsThroughTheProfileContract() throws {
        var draft = OnboardingDraft()
        draft.diet = .nonVegetarian
        let profile = draft.profile(consentAcceptedAt: Date(timeIntervalSince1970: 0))

        let encoded = try JSONEncoder().encode(profile)
        let decoded = try JSONDecoder().decode(UserProfile.self, from: encoded)

        XCTAssertEqual(decoded.diet, .nonVegetarian)
        XCTAssertEqual(decoded.diet.rawValue, "nonVegetarian")
    }

    func testPlanningAndAccountMutationRoutesPreserveSafetyRequirements() {
        XCTAssertTrue(ConsumerRoute.createPlan.descriptor.requiresIdempotencyKey)
        XCTAssertTrue(ConsumerRoute.confirmSwap(planItemID: "meal/1").descriptor.requiresIdempotencyKey)
        XCTAssertTrue(ConsumerRoute.adoptPlan(id: "plan/1").descriptor.requiresIdempotencyKey)
        XCTAssertTrue(ConsumerRoute.requestAccountExport.descriptor.requiresIdempotencyKey)
        XCTAssertTrue(ConsumerRoute.deleteAccount.descriptor.requiresIdempotencyKey)
        XCTAssertEqual(
            ConsumerRoute.confirmSwap(planItemID: "meal/1").descriptor.path,
            "/v1/plan-items/meal%2F1/swap"
        )
        XCTAssertEqual(ConsumerRoute.updateAnalyticsConsent.descriptor.method, .patch)
        XCTAssertEqual(ConsumerRoute.recordAnalyticsEvent.descriptor.path, "/v1/analytics/events")
        XCTAssertEqual(ConsumerRoute.registerPushDevice.descriptor.path, "/v1/push-registrations")
        XCTAssertEqual(ConsumerRoute.unregisterPushDevice.descriptor.method, .delete)
    }

    func testPushDeviceTokensAreStableAndRedacted() {
        let token = PushDeviceToken(data: Data([0x00, 0x0f, 0xa1, 0xff]))
        XCTAssertEqual(token.rawValue, "000fa1ff")
        XCTAssertEqual(token.description, "<redacted>")
        XCTAssertEqual(token.debugDescription, "<redacted>")
    }

    func testReminderPlanningIncludesOnlyEnabledProfileMeals() {
        var draft = OnboardingDraft()
        draft.confirmsAdult = true
        draft.confirmsGeneralWellnessFit = true
        draft.confirmsNutritionEstimates = true
        draft.enabledMealSlots = [.breakfast, .dinner]
        let profile = draft.profile(consentAcceptedAt: Date(timeIntervalSince1970: 0))
        let settings = LifecycleReminderSettings(
            shopping: WeeklyReminder(isEnabled: true, weekday: 1, time: ReminderClock(hour: 10)),
            meals: [
                MealReminder(slot: .breakfast, isEnabled: true, time: ReminderClock(hour: 8)),
                MealReminder(slot: .lunch, isEnabled: true, time: ReminderClock(hour: 13)),
                MealReminder(slot: .dinner, isEnabled: true, time: ReminderClock(hour: 19)),
            ]
        )

        let descriptors = LifecycleReminderPlanner.descriptors(settings: settings, profile: profile)
        XCTAssertEqual(Set(descriptors.map(\.destination)), [.groceries, .breakfast, .dinner])
        XCTAssertFalse(descriptors.contains { $0.destination == .lunch })
    }

    func testDeepLinksRouteOnlyToKnownProductDestinations() {
        XCTAssertEqual(NourishRoute(url: URL(string: "nourish://open/groceries")!), .groceries)
        XCTAssertEqual(NourishRoute(url: URL(string: "nourish://open/weeklyReview")!), .weeklyReview)
        XCTAssertEqual(NourishRoute(url: URL(string: "nourish://open/dinner")!), .meal(.dinner))
        XCTAssertNil(NourishRoute(url: URL(string: "https://example.test/groceries")!))
        XCTAssertNil(NourishRoute(url: URL(string: "nourish://open/unknown")!))
    }

    func testClientAnalyticsBoundaryMatchesTheTwelveAppObservedEvents() {
        XCTAssertEqual(ClientAnalyticsEventName.allCases.count, 12)
        XCTAssertEqual(Set(ClientAnalyticsEventName.allCases.map(\.rawValue)), [
            "app_opened", "onboarding_started", "eligibility_completed",
            "onboarding_step_completed", "onboarding_completed", "plan_preview_viewed",
            "meal_detail_viewed", "swap_list_viewed", "grocery_list_opened",
            "prep_plan_opened", "paywall_viewed", "notification_opened",
        ])
    }

    func testBackgroundRetryIsBoundedAndOnlyScheduledForPendingWork() {
        XCTAssertEqual(BackgroundSyncPolicy.retryDelay(forAttempt: -1), 15 * 60)
        XCTAssertEqual(BackgroundSyncPolicy.retryDelay(forAttempt: 1), 30 * 60)
        XCTAssertEqual(BackgroundSyncPolicy.retryDelay(forAttempt: 99), 6 * 60 * 60)
        XCTAssertTrue(BackgroundSyncPolicy.shouldSchedule(profilePending: true, weeklyLoopPending: false))
        XCTAssertTrue(BackgroundSyncPolicy.shouldSchedule(profilePending: false, weeklyLoopPending: true))
        XCTAssertFalse(BackgroundSyncPolicy.shouldSchedule(profilePending: false, weeklyLoopPending: false))
    }

    func testLocaleAwareFormattingUsesRequestedDatesNumbersUnitsAndCurrency() {
        let english = Locale(identifier: "en_US")
        let french = Locale(identifier: "fr_FR")
        let india = Locale(identifier: "en_IN")
        let utc = TimeZone(secondsFromGMT: 0)!
        let referenceDate = Date(timeIntervalSince1970: 0)

        XCTAssertNotEqual(
            NourishFormatting.integer(1_234_567, locale: english),
            NourishFormatting.integer(1_234_567, locale: french)
        )
        XCTAssertTrue(
            NourishFormatting.date(referenceDate, locale: french, timeZone: utc)
                .localizedCaseInsensitiveContains("janvier")
        )
        XCTAssertTrue(
            NourishFormatting.energyKilocalories(1_700, locale: french)
                .localizedCaseInsensitiveContains("kcal")
        )
        let rupees = NourishFormatting.currency(Decimal(string: "1499.50")!, code: "INR", locale: india)
        XCTAssertTrue(rupees.contains("₹") || rupees.localizedCaseInsensitiveContains("INR"))
    }

    @MainActor
    func testMeasurementConsentGatesNativeEventRecording() async {
        let disabledRemote = AnalyticsRemoteSpy()
        let store = AnalyticsEventStore()
        await store.connect(
            userID: "user-1",
            accountCreatedAt: nil,
            remote: disabledRemote,
            measurementEnabled: false
        )
        let disabledRecordAccepted = await store.record(.paywallViewed, properties: [
            "placement": .string("settings"), "products": .strings([]),
        ])
        let disabledEvents = await disabledRemote.recordedEventNames()
        XCTAssertFalse(disabledRecordAccepted)
        XCTAssertEqual(disabledEvents, [])

        let enabledRemote = AnalyticsRemoteSpy()
        await store.connect(
            userID: "user-1",
            accountCreatedAt: nil,
            remote: enabledRemote,
            measurementEnabled: true
        )
        let paywallAccepted = await store.record(.paywallViewed, properties: [
            "placement": .string("settings"), "products": .strings(["nourish.monthly"]),
        ])
        let enabledEvents = await enabledRemote.recordedEventNames()
        XCTAssertTrue(paywallAccepted)
        XCTAssertEqual(enabledEvents, [.appOpened, .paywallViewed])

        await store.disableMeasurement(using: enabledRemote)
        let notificationAccepted = await store.record(.notificationOpened, properties: [
            "template_id": .string("weekly-review"), "destination": .string("weekly_review"),
        ])
        let consentUpdates = await enabledRemote.consentUpdates()
        XCTAssertFalse(notificationAccepted)
        XCTAssertEqual(consentUpdates, [true, false])
    }

    #if DEBUG
    func testDevelopmentWeeklyLoopFixtureIsValidAndSwapRecalculatesGroceries() throws {
        let fixture = DevelopmentWeeklyLoopFixture.make(
            now: Date(timeIntervalSince1970: 1_783_900_800)
        )
        XCTAssertTrue(WeeklyPlanValidator.isValid(fixture.snapshot.plan, profile: fixture.profile))

        let candidates = WeeklyLoopEngine.swapCandidates(
            replacing: "fixture-meal-0",
            in: fixture.snapshot.plan,
            recipes: [fixture.replacementRecipe],
            profile: fixture.profile
        )
        XCTAssertEqual(candidates.map(\.recipe.recipeID), ["fixture-coconut-poha"])

        let result = try WeeklyLoopEngine.applySwap(
            to: fixture.snapshot,
            expectedRevision: fixture.snapshot.revision,
            mutationID: "fixture-swap",
            itemID: "fixture-meal-0",
            replacement: fixture.replacementRecipe,
            profile: fixture.profile
        )
        let replacement = result.snapshot.plan.days.flatMap(\.items)
            .first { $0.id == "fixture-meal-0" }
        XCTAssertEqual(replacement?.recipeSnapshot.displayName, "Coconut poha bowl")
        let coconut = result.snapshot.groceryList.items
            .first { $0.ingredientID == "fixture-coconut" }
        XCTAssertEqual(coconut?.displayName, "Fresh coconut")
        XCTAssertEqual(coconut?.newlyAddedBySwap, true)
    }
    #endif

    func testBrandThemeMeetsMeasuredWCAGContrastThresholds() {
        let textBackgrounds = [
            NourishTheme.limeSoftRGB,
            NourishTheme.paperRGB,
            NourishTheme.amberSoftRGB,
            NourishTheme.whiteRGB,
        ]
        for background in textBackgrounds {
            XCTAssertGreaterThanOrEqual(
                NourishTheme.forestRGB.contrastRatio(with: background),
                4.5
            )
        }
        XCTAssertGreaterThanOrEqual(
            NourishTheme.leafRGB.contrastRatio(with: NourishTheme.whiteRGB),
            4.5
        )
        XCTAssertGreaterThanOrEqual(
            NourishTheme.leafRGB.contrastRatio(with: NourishTheme.limeSoftRGB),
            3.0
        )
    }

    func testCompiledHindiCatalogResolvesLongFormAndDynamicLabelCopy() throws {
        let testBundle = Bundle(for: NourishAppTests.self)
        let appBundleURL = testBundle.bundleURL
            .deletingLastPathComponent()
            .appendingPathComponent("NourishApp.app")
        let stringsURL = appBundleURL
            .appendingPathComponent("hi.lproj")
            .appendingPathComponent("Localizable.strings")
        let data = try Data(contentsOf: stringsURL)
        let catalog = try XCTUnwrap(
            PropertyListSerialization.propertyList(from: data, format: nil) as? [String: String]
        )
        XCTAssertEqual(
            catalog["Privacy summary"],
            "गोपनीयता सारांश"
        )
        XCTAssertEqual(
            catalog["Plan breakfast"],
            "नाश्ते की योजना बनाएँ"
        )
        XCTAssertEqual(
            catalog["Maximum active time"],
            "अधिकतम सक्रिय समय"
        )
        XCTAssertEqual(
            catalog["Opens preparation tasks and storage notes."],
            "तैयारी कार्य और भंडारण नोट खोलता है।"
        )
        XCTAssertEqual(
            catalog["Notifications are disabled for Nourish. Enable them in the iOS Settings app after saving your choices."],
            "Nourish की सूचनाएँ बंद हैं। अपनी पसंद सहेजने के बाद उन्हें iOS सेटिंग ऐप में चालू करें।"
        )
        XCTAssertEqual(
            catalog["Illustrative local preview"],
            "उदाहरणात्मक स्थानीय पूर्वावलोकन"
        )
        XCTAssertEqual(catalog[" protein · "], " प्रोटीन · ")
        XCTAssertEqual(catalog["Produce"], "ताज़ी उपज")
        XCTAssertEqual(catalog["Replaced outside app"], "ऐप के बाहर बदला गया")
        XCTAssertEqual(catalog["Published"], "प्रकाशित")
        XCTAssertEqual(catalog["Current"], "वर्तमान")
        XCTAssertEqual(catalog["Non-vegetarian"], "मांसाहारी")
        XCTAssertEqual(catalog["Find another meal"], "कोई दूसरा भोजन खोजें")
        XCTAssertEqual(catalog[" · regenerated successor"], " · पुनः बनाई गई अगली योजना")
        XCTAssertEqual(catalog["Feedback saved"], "प्रतिक्रिया सहेजी गई")
        XCTAssertEqual(
            catalog["There are not enough licensed, reviewed recipes for this profile yet. Your current week is unchanged."],
            "इस प्रोफ़ाइल के लिए अभी पर्याप्त लाइसेंस प्राप्त, समीक्षित रेसिपी नहीं हैं। आपका वर्तमान सप्ताह नहीं बदला है।"
        )
    }
}

private actor AnalyticsRemoteSpy: AnalyticsEventRemote {
    private var enabledUpdates: [Bool] = []
    private var events: [ClientAnalyticsEvent] = []

    func setMeasurementEnabled(_ enabled: Bool) async throws -> AnalyticsConsentReceipt {
        enabledUpdates.append(enabled)
        return AnalyticsConsentReceipt(
            enabled: enabled,
            updatedAt: Date(timeIntervalSince1970: 0),
            contractVersion: "analytics-consent-v1"
        )
    }

    func record(_ event: ClientAnalyticsEvent) async throws -> AnalyticsEventReceipt {
        events.append(event)
        return AnalyticsEventReceipt(
            eventID: event.eventID,
            eventName: event.eventName.rawValue,
            schemaVersion: event.schemaVersion,
            acceptedAt: event.occurredAt,
            retentionExpiresAt: event.occurredAt.addingTimeInterval(90 * 86_400),
            replay: false,
            contractVersion: "analytics-events-v1"
        )
    }

    func recordedEventNames() -> [ClientAnalyticsEventName] {
        events.map(\.eventName)
    }

    func consentUpdates() -> [Bool] {
        enabledUpdates
    }
}
