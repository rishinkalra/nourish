import SwiftUI
import NourishCore

struct ProfileEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var profileStore: AppProfileStore
    @State private var draft: UserProfile
    @State private var changeScope: ProfileChangeScope
    @State private var validationMessage: String?

    init(profile: UserProfile, initialScope: ProfileChangeScope) {
        _draft = State(initialValue: profile)
        _changeScope = State(initialValue: initialScope)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("When changes apply") {
                    Picker("Plan impact", selection: $changeScope) {
                        Text("Current and future plans").tag(ProfileChangeScope.currentAndFuturePlans)
                        Text("Next plan only").tag(ProfileChangeScope.nextPlanOnly)
                    }
                    .pickerStyle(.inline)
                    Text(scopeExplanation)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Region and units") {
                    TextField("Country/region code", text: $draft.countryRegionCode)
                        .textInputAutocapitalization(.characters)
                    Picker("Units", selection: $draft.unitSystem) {
                        Text("Metric").tag(UnitSystem.metric)
                        Text("Imperial").tag(UnitSystem.imperial)
                    }
                    TextField("Timezone identifier", text: $draft.timeZoneIdentifier)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }

                Section("Goal and target") {
                    Picker("Goal", selection: $draft.goal) {
                        Text("Maintain").tag(WellnessGoal.maintain)
                        Text("Gradual loss").tag(WellnessGoal.gradualLoss)
                        Text("Gradual gain").tag(WellnessGoal.gradualGain)
                    }
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
                    Picker("Target source", selection: $draft.targetSource) {
                        Text("My target").tag(TargetSource.userProvided)
                        Text("Reviewed estimate").tag(TargetSource.reviewedEstimate)
                    }
                    if draft.targetSource == .reviewedEstimate {
                        Text("The estimator stays unavailable until its formula and guardrails receive qualified nutrition review.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }

                Section("Food preferences") {
                    Picker("Diet", selection: $draft.diet) {
                        Text("Vegetarian").tag(DietType.vegetarian)
                        Text("Eggetarian").tag(DietType.eggetarian)
                        Text("Vegan").tag(DietType.vegan)
                        Text("Non-vegetarian").tag(DietType.nonVegetarian)
                    }
                    TextField("Allergens, comma separated", text: setBinding(\.allergens))
                    TextField("Ingredients to avoid", text: setBinding(\.ingredientExclusions))
                    TextField("Disliked foods", text: setBinding(\.dislikedFoods))
                    TextField("Preferred cuisines", text: setBinding(\.cuisines))
                    ForEach(MealSlot.allCases, id: \.self) { slot in
                        Toggle(isOn: membershipBinding(slot, in: \.enabledMealSlots)) {
                            Text(mealSlotPlanningLabel(slot))
                        }
                    }
                    Picker("Snacks", selection: $draft.snackPreference) {
                        Text("None").tag(SnackPreference.none)
                        Text("Optional").tag(SnackPreference.optional)
                        Text("Planned").tag(SnackPreference.planned)
                    }
                }

                Section("Cooking rhythm") {
                    Picker("Budget", selection: $draft.budget) {
                        Text("Value").tag(BudgetBand.value)
                        Text("Medium").tag(BudgetBand.medium)
                        Text("Flexible").tag(BudgetBand.flexible)
                    }
                    Stepper(value: $draft.maximumActiveMinutes, in: 10...120, step: 5) {
                        LabeledContent("Maximum active time") {
                            Text(verbatim: NourishFormatting.durationMinutes(Double(draft.maximumActiveMinutes)))
                        }
                    }
                    Picker("Leftovers", selection: $draft.leftoverPreference) {
                        Text("Avoid").tag(LeftoverPreference.avoid)
                        Text("Planned").tag(LeftoverPreference.planned)
                        Text("Often").tag(LeftoverPreference.often)
                    }
                    Stepper(value: $draft.batchPrepSessionsPerWeek, in: 0...7) {
                        LabeledContent("Batch-prep sessions") {
                            Text(verbatim: NourishFormatting.integer(draft.batchPrepSessionsPerWeek))
                        }
                    }
                    ForEach(1...7, id: \.self) { weekday in
                        Toggle(isOn: membershipBinding(weekday, in: \.cookingDays)) {
                            Text(verbatim: weekdayName(weekday))
                        }
                    }
                }

                Section("Available equipment") {
                    Text("Recipes that require equipment you do not have will be excluded.")
                        .font(.footnote).foregroundStyle(.secondary)
                    if draft.availableEquipment == nil {
                        Text("Equipment has not been configured for this older profile. Until you choose, Nourish will not exclude recipes by equipment.")
                            .font(.footnote).foregroundStyle(.secondary)
                        Button("Choose common equipment") {
                            draft.availableEquipment = [.stovetop, .pan, .pot, .pressureCooker, .microwave, .blender]
                        }
                    }
                    ForEach(KitchenEquipment.allCases, id: \.self) { equipment in
                        Toggle(isOn: equipmentBinding(equipment)) {
                            Text(equipment.localizedLabel)
                        }
                    }
                }

                if let validationMessage {
                    Section { Text(LocalizedStringKey(validationMessage)).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Planning preferences")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .accessibilityIdentifier("profile-editor.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: save) {
                        if profileStore.state == .saving {
                            Text("Saving…")
                        } else {
                            Text("Save")
                        }
                    }
                        .disabled(profileStore.state == .saving)
                        .accessibilityIdentifier("profile-editor.save")
                }
            }
        }
    }

    private var scopeExplanation: LocalizedStringKey {
        switch changeScope {
        case .currentAndFuturePlans:
            "New safety and preference rules take effect now. An already adopted plan remains an immutable record; rework it separately in Plan Studio if needed."
        case .nextPlanOnly:
            "Keep the adopted week unchanged and apply these choices when the next plan is generated."
        }
    }

    private func save() {
        guard TimeZone(identifier: draft.timeZoneIdentifier) != nil else {
            validationMessage = "Enter a valid timezone such as Asia/Kolkata."
            return
        }
        guard !draft.enabledMealSlots.isEmpty else {
            validationMessage = "Choose at least one meal slot."
            return
        }
        guard !draft.cookingDays.isEmpty else {
            validationMessage = "Choose at least one cooking day."
            return
        }
        Task {
            if await profileStore.saveProfile(draft, changeScope: changeScope) { dismiss() }
            else { validationMessage = profileStore.failureMessage ?? "These preferences could not be saved." }
        }
    }

    private func setBinding(_ keyPath: WritableKeyPath<UserProfile, Set<String>>) -> Binding<String> {
        Binding(
            get: { draft[keyPath: keyPath].sorted().joined(separator: ", ") },
            set: { value in
                draft[keyPath: keyPath] = Set(value.split(separator: ",").map {
                    $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                }.filter { !$0.isEmpty })
            }
        )
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

    private func equipmentBinding(_ equipment: KitchenEquipment) -> Binding<Bool> {
        Binding(
            get: { draft.availableEquipment?.contains(equipment) == true },
            set: { enabled in
                var available = draft.availableEquipment ?? []
                if enabled { available.insert(equipment) }
                else { available.remove(equipment) }
                draft.availableEquipment = available
            }
        )
    }

    private func membershipBinding<Element: Hashable>(
        _ element: Element,
        in keyPath: WritableKeyPath<UserProfile, Set<Element>>
    ) -> Binding<Bool> {
        Binding(
            get: { draft[keyPath: keyPath].contains(element) },
            set: { enabled in
                if enabled { draft[keyPath: keyPath].insert(element) }
                else { draft[keyPath: keyPath].remove(element) }
            }
        )
    }

    private func mealSlotPlanningLabel(_ slot: MealSlot) -> LocalizedStringKey {
        switch slot {
        case .breakfast: "Plan breakfast"
        case .lunch: "Plan lunch"
        case .dinner: "Plan dinner"
        }
    }
}

struct ReminderSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var reminderStore: LifecycleReminderStore
    @State private var draft: LifecycleReminderSettings
    let profile: UserProfile

    init(profile: UserProfile, settings: LifecycleReminderSettings) {
        self.profile = profile
        _draft = State(initialValue: settings)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Plan rhythm") {
                    Picker("Plan starts", selection: $draft.planStartWeekday) {
                        ForEach(1...7, id: \.self) { Text(verbatim: weekdayName($0)).tag($0) }
                    }
                    (
                        Text("Reminder times use ") +
                        Text(verbatim: profile.timeZoneIdentifier) +
                        Text(". iOS automatically follows local daylight-saving changes.")
                    )
                        .font(.footnote).foregroundStyle(.secondary)
                }
                weeklySection("Shopping", reminder: $draft.shopping, explanation: "Opens the grocery list before the new plan week.")
                weeklySection("Batch prep", reminder: $draft.prep, explanation: "Opens preparation tasks and storage notes.")

                Section("Meal reminders") {
                    ForEach(Array(draft.meals.indices), id: \.self) { index in
                        let slot = draft.meals[index].slot
                        Toggle(isOn: $draft.meals[index].isEnabled) {
                            Text(mealReminderLabel(slot))
                        }
                            .disabled(!profile.enabledMealSlots.contains(slot))
                        if draft.meals[index].isEnabled && profile.enabledMealSlots.contains(slot) {
                            DatePicker("Time", selection: clockBinding($draft.meals[index].time), displayedComponents: .hourAndMinute)
                        }
                    }
                    Text("Meal notifications open the matching reviewed meal. Slots not enabled in your profile stay unavailable.")
                        .font(.footnote).foregroundStyle(.secondary)
                }

                weeklySection("Weekly review", reminder: $draft.weeklyReview, explanation: "Opens completion and preference feedback near the end of the week.")
                weeklySection("Next plan", reminder: $draft.nextPlan, explanation: "Opens Plan Studio to generate and adopt the week ahead.")

                Section("Notification access") {
                    LabeledContent("Permission") { Text(authorizationLabel) }
                    LabeledContent("Scheduled") {
                        Text(verbatim: NourishFormatting.integer(reminderStore.scheduledCount))
                    }
                    if reminderStore.authorizationState == .denied {
                        Text("Notifications are disabled for Nourish. Enable them in the iOS Settings app after saving your choices.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    if let message = reminderStore.statusMessage {
                        localizedRuntimeMessage(message).font(.footnote).foregroundStyle(.secondary)
                    }
                    Button("Turn off every reminder", role: .destructive) {
                        Task { await reminderStore.cancelAll(); draft = reminderStore.settings }
                    }
                }
            }
            .navigationTitle("Reminders")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .accessibilityIdentifier("reminders.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            _ = await reminderStore.save(draft, profile: profile)
                            if reminderStore.authorizationState == .authorized || !draft.hasEnabledReminders { dismiss() }
                        }
                    }
                    .accessibilityIdentifier("reminders.save")
                }
            }
        }
    }

    private func weeklySection(
        _ title: LocalizedStringKey,
        reminder: Binding<WeeklyReminder>,
        explanation: LocalizedStringKey
    ) -> some View {
        Section(title) {
            Toggle("Enabled", isOn: reminder.isEnabled)
            if reminder.wrappedValue.isEnabled {
                Picker("Day", selection: reminder.weekday) {
                    ForEach(1...7, id: \.self) { Text(verbatim: weekdayName($0)).tag($0) }
                }
                DatePicker("Time", selection: clockBinding(reminder.time), displayedComponents: .hourAndMinute)
            }
            Text(explanation).font(.footnote).foregroundStyle(.secondary)
        }
    }

    private func clockBinding(_ clock: Binding<ReminderClock>) -> Binding<Date> {
        Binding(
            get: {
                Calendar.current.date(from: DateComponents(hour: clock.wrappedValue.hour, minute: clock.wrappedValue.minute)) ?? .now
            },
            set: { date in
                let values = Calendar.current.dateComponents([.hour, .minute], from: date)
                clock.wrappedValue = ReminderClock(hour: values.hour ?? 9, minute: values.minute ?? 0)
            }
        )
    }

    private var authorizationLabel: LocalizedStringKey {
        switch reminderStore.authorizationState {
        case .unknown: "Checking"
        case .notRequested: "Not requested"
        case .authorized: "Allowed"
        case .denied: "Disabled in iOS"
        case .failed: "Unavailable"
        }
    }

    private func mealReminderLabel(_ slot: MealSlot) -> LocalizedStringKey {
        switch slot {
        case .breakfast: "Breakfast"
        case .lunch: "Lunch"
        case .dinner: "Dinner"
        }
    }
}

private func weekdayName(_ weekday: Int) -> String {
    let names = Calendar.current.weekdaySymbols
    guard names.indices.contains(weekday - 1) else {
        return String(localized: "Day ") + NourishFormatting.integer(weekday)
    }
    return names[weekday - 1]
}
