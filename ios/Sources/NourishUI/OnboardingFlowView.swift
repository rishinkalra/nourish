import SwiftUI
import NourishCore

public struct OnboardingFlowView: View {
    @EnvironmentObject private var authenticationStore: AuthenticationStore
    @EnvironmentObject private var analyticsEventStore: AnalyticsEventStore
    @State private var step: OnboardingStep = .valueProposition
    @State private var draft = OnboardingDraft()
    @State private var magicLinkEmail = ""
    @State private var validationMessage: String?
    @State private var stepStartedAt = Date.now
    @State private var recordedStart = false
    @AccessibilityFocusState private var headingIsFocused: Bool
    @AccessibilityFocusState private var validationIsFocused: Bool

    private let entryPoint: String
    private let onComplete: (UserProfile) -> Void

    public init(entryPoint: String = "app_launch", onComplete: @escaping (UserProfile) -> Void) {
        self.entryPoint = entryPoint
        self.onComplete = onComplete
    }

    public var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    stepContent
                    if let validationMessage {
                        localizedRuntimeMessage(validationMessage)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .accessibilityFocused($validationIsFocused)
                    }
                }
                .frame(maxWidth: 620, alignment: .leading)
                .padding(24)
                .frame(maxWidth: .infinity)
                .accessibilityIdentifier("onboarding.step.\(step.rawValue)")
            }
            footer
        }
        .background(NourishTheme.paper)
        .onChange(of: step) { _, _ in
            validationIsFocused = false
            headingIsFocused = true
        }
        .task {
            guard !recordedStart else { return }
            recordedStart = true
            await analyticsEventStore.record(
                .onboardingStarted,
                properties: ["entry_point": .string(entryPoint)]
            )
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            (Text("Step ")
                + Text(verbatim: NourishFormatting.integer(step.rawValue + 1))
                + Text(" of ")
                + Text(verbatim: NourishFormatting.integer(OnboardingStep.allCases.count)))
                .textCase(.uppercase)
                .font(.caption2.bold()).foregroundStyle(.secondary)
            ProgressView(value: Double(step.rawValue + 1), total: Double(OnboardingStep.allCases.count))
                .tint(NourishTheme.forest)
                .accessibilityLabel("Onboarding progress")
                .accessibilityValue(
                    Text("Step ")
                        + Text(verbatim: NourishFormatting.integer(step.rawValue + 1))
                        + Text(" of ")
                        + Text(verbatim: NourishFormatting.integer(OnboardingStep.allCases.count))
                )
        }
        .padding([.horizontal, .top], 24)
    }

    @ViewBuilder private var stepContent: some View {
        switch step {
        case .valueProposition:
            heading("Seven days. Far fewer decisions.", "We’ll turn your preferences, budget, and cooking rhythm into practical meals, groceries, and prep.")
        case .wellnessEligibility:
            heading("First, a quick safety check.", "Nourish supports general wellness and meal organization—not clinical diets.")
            Toggle("I am 18 years or older", isOn: $draft.confirmsAdult)
            Toggle("A general-wellness plan is suitable for me", isOn: $draft.confirmsGeneralWellnessFit)
            TextField("Country/region code", text: $draft.countryRegionCode)
                .textFieldStyle(.roundedBorder)
            selectionGroup(
                "Units",
                selection: $draft.unitSystem,
                options: [
                    ("Metric", UnitSystem.metric),
                    ("Imperial", UnitSystem.imperial),
                ]
            )
            TextField("Timezone", text: $draft.timeZoneIdentifier)
                .textFieldStyle(.roundedBorder)
        case .authentication:
            heading("Keep your plan with you.", "Choose how the production app should secure your weekly history.")
            selectionGroup(
                "Sign-in method",
                selection: $draft.authenticationMethod,
                options: [
                    ("Continue with Apple", AuthenticationMethod.apple),
                    ("Email magic link", AuthenticationMethod.emailMagicLink),
                ]
            )
            if draft.authenticationMethod == .emailMagicLink {
                TextField("Email address", text: $magicLinkEmail)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                Button {
                    Task { await authenticationStore.requestMagicLink(email: magicLinkEmail) }
                } label: {
                    if authenticationStore.state == .requestingMagicLink {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Text("Email me a secure link").frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(NourishTheme.forest)
                .disabled(authenticationStore.state == .requestingMagicLink)
            } else {
                Label("Apple credential exchange is ready, but this development build still needs the Apple capability and backend verifier configuration.", systemImage: "apple.logo")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            authenticationStatus
            Label("Local preview mode", systemImage: "iphone")
                .font(.headline)
                .padding(.top, 6)
            Text("You can always continue in local preview. When the development service is running, email sign-in creates a real rotating session stored in Keychain; production email delivery and Apple verification still require deployment configuration.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        case .goalAndTarget:
            heading("What should the week support?", "Choose a gentle direction and provide a target you trust.")
            selectionGroup(
                "Goal",
                selection: $draft.goal,
                options: [
                    ("Maintain", WellnessGoal.maintain),
                    ("Gradual loss", WellnessGoal.gradualLoss),
                    ("Gradual gain", WellnessGoal.gradualGain),
                ]
            )
            Stepper(value: $draft.calorieTarget, in: 1_200...3_500, step: 50) {
                LabeledContent("Daily target") {
                    Text(verbatim: NourishFormatting.energyKilocalories(Double(draft.calorieTarget)))
                }
            }
            Toggle("Use my daily protein target", isOn: proteinTargetEnabled)
            if draft.optionalDailyProteinTargetGrams != nil {
                Stepper(value: proteinTarget, in: 10...300, step: 5) {
                    LabeledContent("Daily protein target") {
                        Text(verbatim: NourishFormatting.massGrams(Double(draft.optionalDailyProteinTargetGrams ?? 90)))
                    }
                }
                Text("This is a target you provide, not a target calculated or recommended by Nourish.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            selectionGroup(
                "Target source",
                selection: $draft.targetSource,
                options: [
                    ("Use my target", TargetSource.userProvided),
                    ("Request estimate", TargetSource.reviewedEstimate),
                ]
            )
            if draft.targetSource == .reviewedEstimate {
                Text("The production estimator remains disabled until its formula and safety guardrails receive qualified nutrition review.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        case .foodProfile:
            heading("Make every option feel like yours.", "Diet and allergens are hard constraints. Cuisine preferences guide ranking.")
            selectionGroup(
                "Diet",
                selection: $draft.diet,
                options: [
                    ("Vegetarian", DietType.vegetarian),
                    ("Eggetarian", DietType.eggetarian),
                    ("Vegan", DietType.vegan),
                    ("Non-vegetarian", DietType.nonVegetarian),
                ]
            )
            TextField("Allergens, comma separated", text: setTextBinding(\.allergens))
                .textFieldStyle(.roundedBorder)
            TextField("Ingredients to avoid", text: setTextBinding(\.ingredientExclusions))
                .textFieldStyle(.roundedBorder)
            TextField("Disliked foods", text: setTextBinding(\.dislikedFoods))
                .textFieldStyle(.roundedBorder)
            TextField("Preferred cuisines", text: setTextBinding(\.cuisines))
                .textFieldStyle(.roundedBorder)
            VStack(alignment: .leading) {
                Text("Meals to plan").font(.headline)
                ForEach(MealSlot.allCases, id: \.self) { slot in
                    Toggle(isOn: membershipBinding(slot, in: \.enabledMealSlots)) {
                        Text(slot.localizedLabel)
                    }
                }
            }
            selectionGroup(
                "Snacks",
                selection: $draft.snackPreference,
                options: [
                    ("None", SnackPreference.none),
                    ("Optional", SnackPreference.optional),
                    ("Planned", SnackPreference.planned),
                ]
            )
        case .practicalConstraints:
            heading("How does cooking fit your week?", "Cooking time, budget, and leftovers shape plan quality as much as calories do.")
            selectionGroup(
                "Budget",
                selection: $draft.budget,
                options: [
                    ("Value", BudgetBand.value),
                    ("Medium", BudgetBand.medium),
                    ("Flexible", BudgetBand.flexible),
                ]
            )
            Stepper(value: $draft.maximumActiveMinutes, in: 10...120, step: 5) {
                LabeledContent("Maximum active time") {
                    Text(verbatim: NourishFormatting.durationMinutes(Double(draft.maximumActiveMinutes)))
                }
            }
            selectionGroup(
                "Leftovers",
                selection: $draft.leftoverPreference,
                options: [
                    ("Avoid", LeftoverPreference.avoid),
                    ("Planned", LeftoverPreference.planned),
                    ("Often", LeftoverPreference.often),
                ]
            )
            cookingDaySelector
            Stepper(value: $draft.batchPrepSessionsPerWeek, in: 0...7) {
                LabeledContent("Batch-prep sessions") {
                    Text(verbatim: NourishFormatting.integer(draft.batchPrepSessionsPerWeek))
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("Available equipment").font(.headline)
                Text("Recipes that require equipment you do not have will be excluded.")
                    .font(.footnote).foregroundStyle(.secondary)
                ForEach(KitchenEquipment.allCases, id: \.self) { equipment in
                    Toggle(isOn: membershipBinding(equipment, in: \.availableEquipment)) {
                        Text(equipment.localizedLabel)
                    }
                }
            }
        case .review:
            heading("Here’s what Nourish will protect.", "Hard exclusions first; then targets, cooking load, waste, variety, and preference fit.")
            summaryRow(
                "Goal",
                Text(draft.goal.localizedLabel)
                    + Text(verbatim: " · \(NourishFormatting.energyKilocalories(Double(draft.calorieTarget)))")
            )
            summaryRow("Diet", Text(draft.diet.localizedLabel))
            if let proteinTarget = draft.optionalDailyProteinTargetGrams {
                summaryRow("Protein", Text(verbatim: NourishFormatting.massGrams(Double(proteinTarget))))
            }
            summaryRow("Meals", mealSlotsSummary)
            summaryRow(
                "Cooking",
                Text(verbatim: NourishFormatting.integer(draft.cookingDays.count))
                    + Text(" days · ")
                    + Text(verbatim: NourishFormatting.durationMinutes(Double(draft.maximumActiveMinutes)))
            )
            summaryRow("Leftovers", Text(draft.leftoverPreference.localizedLabel))
            summaryRow(
                "Equipment",
                Text(verbatim: NourishFormatting.integer(draft.availableEquipment.count)) + Text(" selected")
            )
            summaryRow("Consent", Text(verbatim: draft.consentPolicyVersion))
            Toggle("I understand nutrition values are estimates", isOn: $draft.confirmsNutritionEstimates)
        }
    }

    @ViewBuilder private var authenticationStatus: some View {
        switch authenticationStore.state {
        case .restoring:
            Label("Restoring secure session…", systemImage: "arrow.clockwise")
                .font(.footnote).foregroundStyle(.secondary)
        case .signedOut:
            EmptyView()
        case .requestingMagicLink:
            Text("Requesting a one-time link…").font(.footnote).foregroundStyle(.secondary)
        case let .magicLinkSent(email, _):
            Label {
                Text("Link sent to ")
                    + Text(verbatim: email)
                    + Text(". In local development, copy it from the backend terminal.")
            } icon: {
                Image(systemName: "envelope.badge")
            }
                .font(.footnote).foregroundStyle(NourishTheme.forest)
        case let .authenticated(identity):
            Label {
                Text("Signed in as ")
                    + Text(verbatim: identity.verifiedEmail ?? String(localized: "Nourish user"))
            } icon: {
                Image(systemName: "checkmark.shield")
            }
                .font(.footnote).foregroundStyle(NourishTheme.forest)
        case let .failed(message):
            localizedRuntimeMessage(message).font(.footnote).foregroundStyle(.red)
        }
    }

    private var footer: some View {
        HStack {
            Button {
                if let previous = step.previous {
                    step = previous
                    stepStartedAt = .now
                    validationMessage = nil
                }
            } label: {
                Text("Back")
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .disabled(step.previous == nil)
            Spacer()
            Button(action: advance) {
                Text(primaryActionTitle)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
                .buttonStyle(.borderedProminent)
                .tint(NourishTheme.forest)
                .accessibilityIdentifier("onboarding.primary-action")
        }
        .padding(24)
        .background(.thinMaterial)
    }

    private func advance() {
        let submittedStep = step
        let durationMilliseconds = min(
            3_600_000,
            max(0, Int(Date.now.timeIntervalSince(stepStartedAt) * 1_000))
        )
        do {
            try OnboardingValidator.validate(step, draft: draft)
            validationMessage = nil
            Task {
                await analyticsEventStore.record(
                    .onboardingStepCompleted,
                    properties: [
                        "step_name": .string(submittedStep.analyticsName),
                        "duration_ms": .integer(durationMilliseconds),
                    ]
                )
                if submittedStep == .wellnessEligibility {
                    await analyticsEventStore.record(
                        .eligibilityCompleted,
                        properties: [
                            "eligible": .boolean(true),
                            "reason_code": .string("eligible"),
                        ]
                    )
                }
                if submittedStep == .review {
                    await analyticsEventStore.record(
                        .onboardingCompleted,
                        properties: [
                            "diet_type": .string(draft.diet.rawValue),
                            "target_source": .string(draft.targetSource.rawValue),
                            "cooking_days_count": .integer(draft.cookingDays.count),
                        ]
                    )
                }
            }
            if let next = step.next {
                step = next
                stepStartedAt = .now
            } else {
                onComplete(draft.profile(consentAcceptedAt: .now))
            }
        } catch {
            validationMessage = (error as? LocalizedError)?.errorDescription ?? "Check this step and try again."
            validationIsFocused = true
            if submittedStep == .wellnessEligibility {
                let reason = (error as? OnboardingValidationError)?.analyticsReason ?? "eligibility_invalid"
                Task {
                    await analyticsEventStore.record(
                        .eligibilityCompleted,
                        properties: [
                            "eligible": .boolean(false),
                            "reason_code": .string(reason),
                        ]
                    )
                }
            }
        }
    }

    private var primaryActionTitle: LocalizedStringKey {
        if step == .review { return "Build my week" }
        if step == .valueProposition { return "Let’s begin" }
        return "Continue"
    }

    private func heading(_ title: LocalizedStringKey, _ subtitle: LocalizedStringKey) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.largeTitle.weight(.semibold))
                .accessibilityAddTraits(.isHeader)
                .accessibilityFocused($headingIsFocused)
            Text(subtitle).foregroundStyle(.secondary)
        }
    }

    private func summaryRow(_ label: LocalizedStringKey, _ value: Text) -> some View {
        HStack { Text(label).foregroundStyle(.secondary); Spacer(); value.bold() }
            .padding().background(.white.opacity(0.75), in: RoundedRectangle(cornerRadius: 14))
    }

    private func selectionGroup<Value: Hashable>(
        _ title: LocalizedStringKey,
        selection: Binding<Value>,
        options: [(LocalizedStringKey, Value)]
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.headline)
            ForEach(options.indices, id: \.self) { index in
                let option = options[index]
                let isSelected = selection.wrappedValue == option.1
                Button {
                    selection.wrappedValue = option.1
                } label: {
                    HStack(spacing: 12) {
                        Text(option.0)
                            .font(.body.weight(.medium))
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 12)
                        Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                            .font(.title3)
                            .foregroundStyle(isSelected ? NourishTheme.forest : Color.secondary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                    .padding(.horizontal, 16)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.primary)
                .background(isSelected ? NourishTheme.limeSoft : NourishTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay {
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(isSelected ? NourishTheme.forest : Color.secondary.opacity(0.28), lineWidth: isSelected ? 2 : 1)
                }
                .accessibilityLabel(Text(option.0))
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
    }

    private var cookingDaySelector: some View {
        VStack(alignment: .leading, spacing: 10) {
            (Text("Cooking days: ")
                + Text(verbatim: NourishFormatting.integer(draft.cookingDays.count))
                + Text(" selected"))
                .font(.headline)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 132), spacing: 10)], spacing: 10) {
                ForEach(1...7, id: \.self) { weekday in
                    let isSelected = draft.cookingDays.contains(weekday)
                    Button {
                        if isSelected {
                            draft.cookingDays.remove(weekday)
                        } else {
                            draft.cookingDays.insert(weekday)
                        }
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                            Text(verbatim: onboardingWeekdayName(weekday))
                                .lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                        .padding(.horizontal, 12)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(isSelected ? NourishTheme.forest : Color.primary)
                    .background(isSelected ? NourishTheme.limeSoft : NourishTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay {
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(isSelected ? NourishTheme.forest : Color.secondary.opacity(0.28), lineWidth: isSelected ? 2 : 1)
                    }
                    .accessibilityLabel(Text(verbatim: onboardingWeekdayName(weekday)))
                    .accessibilityAddTraits(isSelected ? .isSelected : [])
                }
            }
        }
    }

    private func onboardingWeekdayName(_ weekday: Int) -> String {
        let names = Calendar.current.weekdaySymbols
        guard names.indices.contains(weekday - 1) else {
            return String(localized: "Day ") + NourishFormatting.integer(weekday)
        }
        return names[weekday - 1]
    }

    private var mealSlotsSummary: Text {
        draft.enabledMealSlots.sorted { $0.rawValue < $1.rawValue }.enumerated().reduce(Text("")) { result, entry in
            let separator = entry.offset == 0 ? Text("") : Text(verbatim: ", ")
            return result + separator + Text(entry.element.localizedLabel)
        }
    }

    private var proteinTargetEnabled: Binding<Bool> {
        Binding(
            get: { draft.optionalDailyProteinTargetGrams != nil },
            set: { enabled in draft.optionalDailyProteinTargetGrams = enabled ? (draft.optionalDailyProteinTargetGrams ?? 90) : nil }
        )
    }

    private var proteinTarget: Binding<Int> {
        Binding(
            get: { draft.optionalDailyProteinTargetGrams ?? 90 },
            set: { draft.optionalDailyProteinTargetGrams = $0 }
        )
    }

    private func setTextBinding(_ keyPath: WritableKeyPath<OnboardingDraft, Set<String>>) -> Binding<String> {
        Binding(
            get: { draft[keyPath: keyPath].sorted().joined(separator: ", ") },
            set: { value in
                draft[keyPath: keyPath] = Set(value.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }.filter { !$0.isEmpty })
            }
        )
    }

    private func membershipBinding<Element: Hashable>(_ element: Element, in keyPath: WritableKeyPath<OnboardingDraft, Set<Element>>) -> Binding<Bool> {
        Binding(
            get: { draft[keyPath: keyPath].contains(element) },
            set: { enabled in
                if enabled { draft[keyPath: keyPath].insert(element) }
                else { draft[keyPath: keyPath].remove(element) }
            }
        )
    }
}

private extension OnboardingStep {
    var analyticsName: String {
        switch self {
        case .valueProposition: "value_proposition"
        case .wellnessEligibility: "wellness_eligibility"
        case .authentication: "authentication"
        case .goalAndTarget: "goal_and_target"
        case .foodProfile: "food_profile"
        case .practicalConstraints: "practical_constraints"
        case .review: "review"
        }
    }
}

private extension OnboardingValidationError {
    var analyticsReason: String {
        switch self {
        case .adultConfirmationRequired: "adult_confirmation_required"
        case .unsuitableForPersonalizedPlanning: "wellness_fit_required"
        case .regionOrTimeZoneRequired: "region_or_timezone_required"
        case .calorieTargetOutsidePrototypeRange: "calorie_target_invalid"
        case .proteinTargetOutsidePrototypeRange: "protein_target_invalid"
        case .mealSlotRequired: "meal_slot_required"
        case .cookingDayRequired: "cooking_day_required"
        case .batchPrepSessionOutsideRange: "batch_prep_invalid"
        case .nutritionEstimateConfirmationRequired: "nutrition_estimate_confirmation_required"
        }
    }
}
