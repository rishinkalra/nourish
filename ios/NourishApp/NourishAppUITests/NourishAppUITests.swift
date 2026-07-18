import XCTest

@MainActor
final class NourishAppUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testOnboardingBlocksUnsafeProgressAndExposesAccessibleControls() {
        let app = launch(arguments: ["-NourishUITestOnboarding"])

        let primaryAction = app.buttons["onboarding.primary-action"]
        XCTAssertTrue(primaryAction.waitForExistence(timeout: 5))
        XCTAssertTrue(primaryAction.isHittable)
        XCTAssertGreaterThanOrEqual(primaryAction.frame.height, 44)
        XCTAssertTrue(app.staticTexts["Seven days. Far fewer decisions."].waitForExistence(timeout: 5))
        let progress = app.progressIndicators["Onboarding progress"]
        XCTAssertTrue(progress.exists)
        XCTAssertEqual(progress.value as? String, "Step 1 of 7")

        primaryAction.tap()
        XCTAssertTrue(app.staticTexts["First, a quick safety check."].waitForExistence(timeout: 2))
        primaryAction.tap()
        XCTAssertTrue(app.staticTexts["You must be 18 or older to use personalized planning."].exists)

        app.switches["I am 18 years or older"].tap()
        primaryAction.tap()
        XCTAssertTrue(app.staticTexts["This personalized planner is intended for general wellness only."].exists)

        app.switches["A general-wellness plan is suitable for me"].tap()
        primaryAction.tap()
        XCTAssertTrue(app.staticTexts["Keep your plan with you."].waitForExistence(timeout: 2))
    }

    func testMainTabsAndPlanStudioAreKeyboardAndAccessibilityDiscoverable() {
        let app = launch(arguments: ["-NourishUITestMain", "-NourishSeedProfile"])

        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 5))

        app.tabBars.buttons["Week"].tap()
        XCTAssertTrue(app.navigationBars["My week"].waitForExistence(timeout: 2))
        app.tabBars.buttons["Groceries"].tap()
        XCTAssertTrue(app.navigationBars["Groceries"].waitForExistence(timeout: 2))
        app.tabBars.buttons["Prep"].tap()
        XCTAssertTrue(app.navigationBars["Prep"].waitForExistence(timeout: 2))

        let planStudio = app.buttons["main.open-plan-studio"]
        XCTAssertTrue(planStudio.isHittable)
        planStudio.tap()
        XCTAssertTrue(app.navigationBars["Plan Studio"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["Review before it becomes your week"].exists)
    }

    func testPrivacyMeasurementStartsOffAndRequiresAnExplicitToggle() {
        let app = launch(arguments: ["-NourishUITestMain", "-NourishSeedProfile", "-NourishOpenSettings"])

        XCTAssertTrue(app.navigationBars["Profile & settings"].waitForExistence(timeout: 5))
        let consent = app.switches["settings.analytics-consent"]
        reveal(consent, in: app)
        XCTAssertTrue(consent.waitForExistence(timeout: 2))
        XCTAssertEqual(consent.value as? String, "0")
        XCTAssertTrue(consent.isHittable)
        consent.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        let enabled = expectation(
            for: NSPredicate(format: "value == %@", "1"),
            evaluatedWith: consent
        )
        wait(for: [enabled], timeout: 2)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(
            format: "label CONTAINS %@", "Off by default"
        )).firstMatch.exists)
    }

    func testAccountDeletionExplainsConsequencesAndRequiresTypedConfirmation() {
        let app = launch(arguments: ["-NourishUITestMain", "-NourishSeedProfile", "-NourishOpenDeleteAccount"])

        XCTAssertTrue(app.navigationBars["Delete account"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(
            format: "label CONTAINS %@", "does not cancel an App Store subscription"
        )).firstMatch.exists)
        let deleteButton = app.buttons["delete-account.submit"]
        XCTAssertTrue(deleteButton.exists)
        XCTAssertFalse(deleteButton.isEnabled)

        let confirmation = app.textFields["delete-account.confirmation"]
        XCTAssertTrue(confirmation.isHittable)
        confirmation.tap()
        confirmation.typeText("DELETE")
        XCTAssertTrue(deleteButton.isEnabled)
    }

    func testHindiOnboardingRemainsUsableAtAccessibilityTextSize() {
        let app = launch(arguments: [
            "-AppleLanguages", "(hi)",
            "-AppleLocale", "hi_IN",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
            "-NourishUITestOnboarding",
        ])

        XCTAssertTrue(app.staticTexts["सात दिन। बहुत कम फैसले।"].waitForExistence(timeout: 5))
        let primaryAction = app.buttons["onboarding.primary-action"]
        XCTAssertTrue(primaryAction.isHittable)
        XCTAssertGreaterThanOrEqual(primaryAction.frame.height, 44)
        primaryAction.tap()
        XCTAssertTrue(app.staticTexts["पहले, एक छोटी सुरक्षा जाँच।"].waitForExistence(timeout: 3))
    }

    func testHindiIllustrativeFallbackLocalizesDynamicLabelsAtLargeText() {
        let app = launch(arguments: [
            "-AppleLanguages", "(hi)",
            "-AppleLocale", "hi_IN",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
            "-NourishUITestMain", "-NourishSeedProfile",
        ])

        XCTAssertTrue(app.staticTexts["उदाहरणात्मक स्थानीय पूर्वावलोकन"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(
            format: "label CONTAINS %@", "प्रोटीन"
        )).firstMatch.waitForExistence(timeout: 3))

        app.tabBars.buttons["किराने की सूची"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(
            format: "label CONTAINS %@", "का हिसाब हो गया"
        )).firstMatch.waitForExistence(timeout: 3))

        app.tabBars.buttons["तैयारी"].tap()
        XCTAssertTrue(app.staticTexts["रविवार की तैयारी"].waitForExistence(timeout: 3))
    }

    func testGeneratedPlanPreviewCanBeAdopted() {
        let app = launch(arguments: [
            "-NourishUITestMain", "-NourishSeedProfile",
            "-NourishSeedPlanDraft", "-NourishOpenPlanStudio",
        ])

        XCTAssertTrue(app.navigationBars["Plan Studio"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Reviewed seven-day plan"].waitForExistence(timeout: 3))
        let adopt = app.buttons["plan-studio.adopt"]
        reveal(adopt, in: app)
        XCTAssertTrue(adopt.isHittable)
        adopt.tap()
        XCTAssertTrue(app.staticTexts["Reviewed week activated"].waitForExistence(timeout: 3))
    }

    func testAdoptedPlanSwapRecalculatesTheWeekAndGroceries() {
        let app = launch(arguments: [
            "-NourishUITestMain", "-NourishSeedProfile", "-NourishSeedWeeklyLoop",
            "-NourishResetWeeklyLoopFixture",
        ])

        XCTAssertTrue(app.staticTexts["Your reviewed day"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Reviewed plan synced"].exists)
        app.tabBars.buttons["Week"].tap()
        XCTAssertTrue(app.navigationBars["My week"].waitForExistence(timeout: 2))

        let meal = app.buttons["active.meal.fixture-meal-0"]
        reveal(meal, in: app)
        XCTAssertTrue(meal.isHittable)
        meal.tap()
        XCTAssertTrue(app.navigationBars["Recipe"].waitForExistence(timeout: 2))

        let showCandidates = app.buttons["swap.show-candidates"]
        reveal(showCandidates, in: app)
        XCTAssertTrue(showCandidates.isHittable)
        showCandidates.tap()
        XCTAssertTrue(app.staticTexts["Coconut poha bowl"].waitForExistence(timeout: 3))
        let confirm = app.buttons["swap.confirm.fixture-coconut-poha"]
        reveal(confirm, in: app)
        XCTAssertTrue(confirm.isHittable)
        confirm.tap()

        XCTAssertTrue(app.navigationBars["My week"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["Coconut poha bowl"].waitForExistence(timeout: 3))
        app.tabBars.buttons["Groceries"].tap()
        XCTAssertTrue(app.navigationBars["Groceries"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.staticTexts["Fresh coconut"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["NEW"].exists)
    }

    func testPaywallExplainsAppleTermsWhenProductsAreNotConfigured() {
        let app = launch(arguments: [
            "-NourishUITestMain", "-NourishSeedProfile", "-NourishOpenPaywall",
        ])

        XCTAssertTrue(app.navigationBars["Nourish membership"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(
            format: "label CONTAINS %@", "final local price"
        )).firstMatch.exists)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(
            format: "label CONTAINS %@", "Cancel any time"
        )).firstMatch.exists)
        XCTAssertTrue(app.staticTexts["Subscriptions not configured"].waitForExistence(timeout: 3))
    }

    func testGroceryChangePersistsOfflineAndReplaysWhenOnline() {
        var app = launch(arguments: [
            "-NourishUITestMain", "-NourishSeedProfile", "-NourishSeedWeeklyLoop",
            "-NourishResetWeeklyLoopFixture", "-NourishFixtureOffline",
        ])

        XCTAssertTrue(app.staticTexts["Your reviewed day"].waitForExistence(timeout: 5))
        app.tabBars.buttons["Groceries"].tap()
        XCTAssertTrue(app.navigationBars["Groceries"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.staticTexts["Saved offline"].waitForExistence(timeout: 3))
        let groceryID = "grocery.check.fixture-reviewed-week-ingredient-fixture-ingredient-0"
        let offlineCheck = app.buttons[groceryID]
        reveal(offlineCheck, in: app)
        XCTAssertTrue(offlineCheck.isHittable)
        offlineCheck.tap()
        XCTAssertTrue(app.staticTexts["Saved offline"].waitForExistence(timeout: 3))
        app.terminate()

        app = launch(arguments: [
            "-NourishUITestMain", "-NourishSeedProfile", "-NourishSeedWeeklyLoop",
        ])
        XCTAssertTrue(app.staticTexts["Your reviewed day"].waitForExistence(timeout: 5))
        app.tabBars.buttons["Groceries"].tap()
        XCTAssertTrue(app.navigationBars["Groceries"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.staticTexts["Reviewed plan synced"].waitForExistence(timeout: 3))
        let replayedCheck = app.buttons[groceryID]
        reveal(replayedCheck, in: app)
        XCTAssertTrue(replayedCheck.waitForExistence(timeout: 2))
        let checked = expectation(
            for: NSPredicate(format: "label == %@", "Uncheck Poha"),
            evaluatedWith: replayedCheck
        )
        wait(for: [checked], timeout: 3)
    }

    func testHindiReviewedWeekKeepsCriticalControlsAccessibleAtLargeText() {
        let app = launch(arguments: [
            "-AppleLanguages", "(hi)",
            "-AppleLocale", "hi_IN",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
            "-NourishUITestMain", "-NourishSeedProfile", "-NourishSeedWeeklyLoop",
            "-NourishResetWeeklyLoopFixture",
        ])

        XCTAssertTrue(app.staticTexts["आपका समीक्षित दिन"].waitForExistence(timeout: 5))
        let syncStatus = app.staticTexts["active.sync-status"]
        XCTAssertTrue(syncStatus.waitForExistence(timeout: 2))
        XCTAssertEqual(syncStatus.label, "समीक्षित योजना सिंक हो गई")

        app.tabBars.buttons["सप्ताह"].tap()
        XCTAssertTrue(app.navigationBars["मेरा सप्ताह"].waitForExistence(timeout: 3))
        let selectedDay = app.buttons["active.day.0"]
        XCTAssertTrue(selectedDay.waitForExistence(timeout: 2))
        XCTAssertTrue(selectedDay.isSelected)

        let meal = app.buttons["active.meal.fixture-meal-0"]
        reveal(meal, in: app)
        XCTAssertTrue(meal.isHittable)
        meal.tap()
        XCTAssertTrue(app.navigationBars["रेसिपी"].waitForExistence(timeout: 3))
        let safeSwaps = app.buttons["swap.show-candidates"]
        reveal(safeSwaps, in: app)
        XCTAssertTrue(safeSwaps.isHittable)
        XCTAssertEqual(safeSwaps.label, "सुरक्षित विकल्प दिखाएँ")
    }

    func testHindiPaywallLocalizesDisclosureAndEmptyStateAtLargeText() {
        let app = launch(arguments: [
            "-AppleLanguages", "(hi)",
            "-AppleLocale", "hi_IN",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
            "-NourishUITestMain", "-NourishSeedProfile", "-NourishOpenPaywall",
        ])

        XCTAssertTrue(app.navigationBars["Nourish सदस्यता"].waitForExistence(timeout: 5))
        let disclosure = app.staticTexts["paywall.disclosure"]
        XCTAssertTrue(disclosure.waitForExistence(timeout: 2))
        XCTAssertTrue(disclosure.label.contains("अंतिम स्थानीय कीमत"))
        XCTAssertTrue(app.staticTexts["सदस्यताएँ कॉन्फ़िगर नहीं हैं"].waitForExistence(timeout: 3))
        let close = app.buttons["paywall.close"]
        XCTAssertTrue(close.exists)
        XCTAssertEqual(close.label, "बंद करें")
    }

    func testHindiPlanStudioReviewRemainsUsableAtLargeText() {
        let app = launch(arguments: [
            "-AppleLanguages", "(hi)",
            "-AppleLocale", "hi_IN",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
            "-NourishUITestMain", "-NourishSeedProfile",
            "-NourishSeedPlanDraft", "-NourishOpenPlanStudio",
        ])

        XCTAssertTrue(app.navigationBars["योजना स्टूडियो"].waitForExistence(timeout: 5))
        let heading = app.staticTexts["plan-studio.heading"]
        XCTAssertTrue(heading.waitForExistence(timeout: 2))
        XCTAssertEqual(heading.label, "इसे अपना सप्ताह बनाने से पहले समीक्षा करें")
        XCTAssertTrue(app.staticTexts["समीक्षित सात-दिवसीय योजना"].waitForExistence(timeout: 3))

        let adopt = app.buttons["plan-studio.adopt"]
        reveal(adopt, in: app)
        XCTAssertTrue(adopt.isHittable)
        XCTAssertEqual(adopt.label, "इस समीक्षित सप्ताह को अपनाएँ")
    }

    func testHindiSettingsCriticalSectionsRemainUsableAtLargeText() {
        let app = launch(arguments: [
            "-AppleLanguages", "(hi)",
            "-AppleLocale", "hi_IN",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
            "-NourishUITestMain", "-NourishSeedProfile", "-NourishOpenSettings",
        ])

        XCTAssertTrue(app.navigationBars["प्रोफ़ाइल और सेटिंग्स"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["योजना प्रोफ़ाइल"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(
            format: "label CONTAINS %@", "शाकाहारी"
        )).firstMatch.waitForExistence(timeout: 2))
        let editPlanning = app.buttons["settings.edit-planning"]
        reveal(editPlanning, in: app)
        XCTAssertTrue(editPlanning.isHittable)
        XCTAssertEqual(editPlanning.label, "योजना प्राथमिकताएँ संपादित करें")
        XCTAssertTrue(app.staticTexts["योजना की लय और रिमाइंडर"].waitForExistence(timeout: 2))
    }

    func testHindiProfileEditorRemainsUsableAtLargeText() {
        let app = launch(arguments: [
            "-AppleLanguages", "(hi)",
            "-AppleLocale", "hi_IN",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
            "-NourishUITestMain", "-NourishSeedProfile", "-NourishOpenSettings",
            "-NourishOpenProfileEditor",
        ])

        XCTAssertTrue(app.navigationBars["योजना प्राथमिकताएँ"].waitForExistence(timeout: 6))
        XCTAssertTrue(app.staticTexts["बदलाव कब लागू हों"].waitForExistence(timeout: 2))
        let save = app.buttons["profile-editor.save"]
        XCTAssertTrue(save.exists)
        XCTAssertEqual(save.label, "सहेजें")
        let breakfast = app.switches["नाश्ते की योजना बनाएँ"]
        reveal(breakfast, in: app, maximumSwipes: 10)
        XCTAssertTrue(breakfast.waitForExistence(timeout: 2))
    }

    func testHindiRemindersRemainUsableAtLargeText() {
        let app = launch(arguments: [
            "-AppleLanguages", "(hi)",
            "-AppleLocale", "hi_IN",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
            "-NourishUITestMain", "-NourishSeedProfile", "-NourishOpenReminders",
        ])

        XCTAssertTrue(app.navigationBars["रिमाइंडर"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["योजना की लय"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.staticTexts["नई योजना के सप्ताह से पहले किराने की सूची खोलता है।"].waitForExistence(timeout: 2))
        let save = app.buttons["reminders.save"]
        XCTAssertTrue(save.exists)
        XCTAssertEqual(save.label, "सहेजें")
    }

    func testHindiLegalInformationExposesAccessibleHeadingsAtLargeText() {
        let app = launch(arguments: [
            "-AppleLanguages", "(hi)",
            "-AppleLocale", "hi_IN",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
            "-NourishUITestMain", "-NourishSeedProfile", "-NourishOpenSettings",
            "-NourishOpenLegal",
        ])

        XCTAssertTrue(app.navigationBars["कानूनी और स्वास्थ्य"].waitForExistence(timeout: 6))
        XCTAssertTrue(app.staticTexts["गोपनीयता सारांश"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.staticTexts["शर्तों का सारांश"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(
            format: "label CONTAINS %@", "व्यक्तिगत डेटा नहीं बेचता"
        )).firstMatch.exists)
        let done = app.buttons["legal.done"]
        XCTAssertTrue(done.exists)
        XCTAssertEqual(done.label, "पूर्ण")
    }

    func testHindiSupportKeepsPrivacyChoiceExplicitAtLargeText() {
        let app = launch(arguments: [
            "-AppleLanguages", "(hi)",
            "-AppleLocale", "hi_IN",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
            "-NourishUITestMain", "-NourishSeedProfile", "-NourishOpenSettings",
            "-NourishOpenSupport",
        ])

        XCTAssertTrue(app.navigationBars["सहायता"].waitForExistence(timeout: 6))
        XCTAssertTrue(app.staticTexts["सहायता कैसे काम करती है"].waitForExistence(timeout: 2))
        let diagnostics = app.switches["support.diagnostics"]
        reveal(diagnostics, in: app)
        XCTAssertTrue(diagnostics.isHittable)
        XCTAssertEqual(diagnostics.label, "अनाम ऐप नैदानिक जानकारी शामिल करें")
        XCTAssertEqual(diagnostics.value as? String, "0")
    }

    @discardableResult
    private func launch(arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NourishResetSession"] + arguments
        app.launch()
        return app
    }

    private func reveal(_ element: XCUIElement, in app: XCUIApplication, maximumSwipes: Int = 5) {
        for _ in 0..<maximumSwipes where !element.isHittable {
            app.swipeUp()
        }
    }
}
