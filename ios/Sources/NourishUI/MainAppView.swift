import SwiftUI
import StoreKit
import UIKit
import NourishAPI
import NourishCore

@MainActor
struct MainAppView: View {
    @StateObject private var store = DemoPlanStore()
    @EnvironmentObject private var weeklyLoopStore: ActiveWeeklyLoopStore
    @EnvironmentObject private var routeStore: AppRouteStore
    @EnvironmentObject private var accountStore: AccountLifecycleStore
    @State private var selectedTab: Int
    @State private var showingProfile = false
    @State private var showingPlanStudio = false
    @State private var showingReminderDirectly = false
    @State private var showingDeleteDirectly = false
    @State private var showingPaywallDirectly = false
    @State private var deepLinkedMealItemID: String?
    let profile: UserProfile?
    let onRestartOnboarding: () -> Void

    init(profile: UserProfile?, onRestartOnboarding: @escaping () -> Void) {
        self.profile = profile
        self.onRestartOnboarding = onRestartOnboarding
        _selectedTab = State(initialValue: UserDefaults.standard.integer(forKey: "nourish.selected.tab"))
    }

    var body: some View {
        Group {
            if weeklyLoopStore.snapshot != nil {
                ActiveWeeklyLoopTabs(
                    selectedTab: $selectedTab,
                    profile: profile,
                    onOpenPlanStudio: { showingPlanStudio = true },
                    onRestartOnboarding: onRestartOnboarding
                )
            } else {
                illustrativeTabs
            }
        }
        .sheet(isPresented: $showingPlanStudio) {
            PlanStudioView(profile: profile)
        }
        .sheet(isPresented: $showingReminderDirectly) {
            if let profile {
                ReminderSettingsView(profile: profile, settings: LifecycleReminderSettings())
            }
        }
        .sheet(isPresented: $showingDeleteDirectly) {
            DeleteAccountView(onDeleted: onRestartOnboarding)
        }
        .sheet(isPresented: $showingPaywallDirectly) {
            SubscriptionPurchaseView(accountStore: accountStore)
        }
        .sheet(isPresented: Binding(
            get: { deepLinkedMealItemID != nil },
            set: { if !$0 { deepLinkedMealItemID = nil } }
        )) {
            if let itemID = deepLinkedMealItemID {
                NavigationStack { ActiveRecipeDetail(itemID: itemID) }
            }
        }
        .onAppear(perform: openDevelopmentPlanStudioIfRequested)
        .onChange(of: routeStore.pendingRoute) { _, route in
            handle(route)
        }
        .onChange(of: selectedTab) { _, tab in
            UserDefaults.standard.set(tab, forKey: "nourish.selected.tab")
        }
    }

    private func openDevelopmentPlanStudioIfRequested() {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-NourishOpenPlanStudio") {
            showingPlanStudio = true
        }
        if ProcessInfo.processInfo.arguments.contains("-NourishOpenPaywall") {
            showingPaywallDirectly = true
        }
        if ProcessInfo.processInfo.arguments.contains("-NourishOpenDeleteAccount") {
            showingDeleteDirectly = true
        } else if ProcessInfo.processInfo.arguments.contains("-NourishOpenReminders") {
            showingReminderDirectly = true
        } else if ProcessInfo.processInfo.arguments.contains("-NourishOpenSettings") {
            showingProfile = true
        }
        #endif
    }

    private func handle(_ route: NourishRoute?) {
        guard let route else { return }
        switch route {
        case .planStudio, .weeklyReview:
            showingPlanStudio = true
        case .groceries:
            selectedTab = 2
        case .prep:
            selectedTab = 3
        case let .meal(slot):
            selectedTab = 0
            let planSlot = PlanSlot(rawValue: slot.rawValue)
            deepLinkedMealItemID = weeklyLoopStore.snapshot?.plan.days
                .flatMap(\.items)
                .first { $0.slot == planSlot }?.id
        case .accountSettings:
            showingProfile = true
        case .subscription:
            showingPaywallDirectly = true
        }
        routeStore.consume()
    }

    private var illustrativeTabs: some View {
        TabView(selection: $selectedTab) {
            NavigationStack { TodayScreen() }
                .tabItem { Label("Today", systemImage: "house") }
                .tag(0)
            NavigationStack { WeekScreen() }
                .tabItem { Label("Week", systemImage: "calendar") }
                .tag(1)
            NavigationStack { GroceryScreen() }
                .tabItem { Label("Groceries", systemImage: "bag") }
                .tag(2)
            NavigationStack { PrepScreen() }
                .tabItem { Label("Prep", systemImage: "fork.knife") }
                .tag(3)
        }
        .environmentObject(store)
        .tint(NourishTheme.forest)
        .toolbarBackground(NourishTheme.paper, for: .tabBar)
        .overlay(alignment: .topTrailing) {
            HStack(spacing: 2) {
                Button { showingPlanStudio = true } label: {
                    Image(systemName: "calendar.badge.plus")
                        .font(.title2)
                        .foregroundStyle(NourishTheme.forest)
                        .padding(12)
                }
                .accessibilityLabel("Create or review a weekly plan")
                .accessibilityIdentifier("main.open-plan-studio")
                Button { showingProfile = true } label: {
                    Image(systemName: "person.crop.circle")
                        .font(.title2)
                        .foregroundStyle(NourishTheme.forest)
                        .padding(12)
                }
                .accessibilityLabel("Open profile and settings")
                .accessibilityIdentifier("main.open-settings")
            }
        }
        .sheet(isPresented: $showingProfile) {
            ProfilePreview(profile: profile, onRestartOnboarding: onRestartOnboarding)
        }
    }
}

private struct ActiveWeeklyLoopTabs: View {
    @EnvironmentObject private var store: ActiveWeeklyLoopStore
    @Binding var selectedTab: Int
    @State private var showingProfile = false
    let profile: UserProfile?
    let onOpenPlanStudio: () -> Void
    let onRestartOnboarding: () -> Void

    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack { ActiveTodayScreen() }
                .tabItem { Label("Today", systemImage: "house") }
                .tag(0)
            NavigationStack { ActiveWeekScreen() }
                .tabItem { Label("Week", systemImage: "calendar") }
                .tag(1)
            NavigationStack { ActiveGroceryScreen() }
                .tabItem { Label("Groceries", systemImage: "bag") }
                .tag(2)
            NavigationStack { ActivePrepScreen() }
                .tabItem { Label("Prep", systemImage: "fork.knife") }
                .tag(3)
        }
        .tint(NourishTheme.forest)
        .toolbarBackground(NourishTheme.paper, for: .tabBar)
        .overlay(alignment: .topTrailing) {
            HStack(spacing: 2) {
                Button(action: onOpenPlanStudio) {
                    Image(systemName: "calendar.badge.plus")
                        .font(.title2)
                        .foregroundStyle(NourishTheme.forest)
                        .padding(12)
                }
                .accessibilityLabel("Create or review a weekly plan")
                .accessibilityIdentifier("main.open-plan-studio")
                Button { showingProfile = true } label: {
                    Image(systemName: "person.crop.circle")
                        .font(.title2)
                        .foregroundStyle(NourishTheme.forest)
                        .padding(12)
                }
                .accessibilityLabel("Open profile and settings")
                .accessibilityIdentifier("main.open-settings")
            }
        }
        .sheet(isPresented: $showingProfile) {
            ProfilePreview(profile: profile, onRestartOnboarding: onRestartOnboarding)
        }
    }
}

private struct ActiveSyncBanner: View {
    @EnvironmentObject private var store: ActiveWeeklyLoopStore

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            icon
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.bold())
                    .accessibilityIdentifier("active.sync-status")
                detail
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if needsRetry {
                Button("Retry") { Task { await store.retry() } }
                    .font(.caption.bold())
            }
        }
        .foregroundStyle(NourishTheme.forest)
        .padding(14)
        .background(background, in: RoundedRectangle(cornerRadius: 16))
    }

    @ViewBuilder private var icon: some View {
        if case .loading = store.state { ProgressView() }
        else { Image(systemName: needsRetry ? "icloud.slash" : "checkmark.icloud") }
    }

    private var title: LocalizedStringKey {
        switch store.state {
        case .loading: "Refreshing your week"
        case .synced: "Reviewed plan synced"
        case .pending: "Saved offline"
        case .conflict: "Review needed"
        case .signedOut, .noActivePlan: "Local preview"
        }
    }

    @ViewBuilder private var detail: some View {
        switch store.state {
        case let .pending(message), let .conflict(message):
            localizedRuntimeMessage(message)
        case .synced:
            Text("Changes are protected on this device and synchronized to your account.")
        default:
            EmptyView()
        }
    }

    private var needsRetry: Bool {
        if case .pending = store.state { return true }
        if case .conflict = store.state { return true }
        return false
    }

    private var background: Color {
        needsRetry ? NourishTheme.amberSoft : NourishTheme.limeSoft
    }
}

private struct ActiveTodayScreen: View {
    @EnvironmentObject private var store: ActiveWeeklyLoopStore

    var body: some View {
        ScrollView {
            if let plan = store.snapshot?.plan,
               let day = activeDay(in: plan) {
                let featuredItem = day.items.last
                let supportingItems = Array(day.items.dropLast())
                VStack(alignment: .leading, spacing: 18) {
                    Text(activeDate(day.localDate).uppercased())
                        .font(.caption.bold())
                        .tracking(1.2)
                        .foregroundStyle(NourishTheme.inkSoft)
                    Text("Your reviewed day")
                        .font(.system(.largeTitle, design: .serif, weight: .semibold))
                        .foregroundStyle(NourishTheme.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text("Meals reviewed for your preferences and this week’s targets.")
                        .foregroundStyle(NourishTheme.inkSoft)
                    if let featuredItem {
                        ActiveReviewedMealHero(item: featuredItem)
                    }
                    ActiveNutritionSummary(day: day, target: plan.targetSnapshot)
                    sectionTitle("Today’s plan", subtitle: "Reviewed meals, ready when you are")
                    ForEach(supportingItems, id: \.id) { item in
                        NavigationLink { ActiveRecipeDetail(itemID: item.id) } label: {
                            ActiveMealCard(item: item)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("active.meal.\(item.id)")
                        .accessibilityHint("Opens recipe details and safe swap options")
                    }
                    ActiveSyncBanner()
                }
                .padding(18)
                .padding(.bottom, 28)
            }
        }
        .background(NourishTheme.paper)
        .navigationTitle("Today")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct ActiveReviewedMealHero: View {
    let item: PlanItem

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            MealArtwork(recipeID: item.recipeSnapshot.recipeID, height: 390)
            LinearGradient(
                colors: [Color.black.opacity(0.02), Color.black.opacity(0.16), Color.black.opacity(0.88)],
                startPoint: .top,
                endPoint: .bottom
            )
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text(item.slot.localizedTitle)
                        .textCase(.uppercase)
                        .font(.caption.bold())
                        .tracking(1.2)
                    Spacer()
                    Label("Reviewed", systemImage: "checkmark.seal.fill")
                        .font(.caption.bold())
                }
                .foregroundStyle(Color.white.opacity(0.90))

                Spacer()

                Text(item.slot == .dinner ? "Tonight" : "Next in your plan")
                    .font(.subheadline)
                    .foregroundStyle(Color.white.opacity(0.76))
                Text(item.recipeSnapshot.displayName)
                    .font(.system(size: 33, weight: .semibold, design: .serif))
                    .foregroundStyle(.white)
                    .padding(.top, 3)
                nutritionAndTimeSummary(
                    calories: decimalDouble(item.nutrition.calories),
                    proteinGrams: decimalDouble(item.nutrition.proteinGrams),
                    activeMinutes: item.recipeSnapshot.activePreparationMinutes
                )
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Color.white.opacity(0.84))
                .padding(.top, 8)

                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) { actions }
                    VStack(spacing: 10) { actions }
                }
                .padding(.top, 18)
            }
            .padding(20)
        }
        .frame(height: 390)
        .clipShape(RoundedRectangle(cornerRadius: 28))
        .shadow(color: NourishTheme.ink.opacity(0.12), radius: 24, y: 12)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var actions: some View {
        NavigationLink { ActiveRecipeDetail(itemID: item.id) } label: {
            Label("View recipe", systemImage: "book.closed")
                .font(.subheadline.bold())
                .foregroundStyle(NourishTheme.ink)
                .padding(.horizontal, 14)
                .frame(maxWidth: .infinity, minHeight: 46)
                .background(.white, in: RoundedRectangle(cornerRadius: 14))
        }
        NavigationLink { ActiveRecipeDetail(itemID: item.id) } label: {
            Label("Meal options", systemImage: "arrow.left.arrow.right")
                .font(.subheadline.bold())
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .frame(maxWidth: .infinity, minHeight: 46)
                .background(Color.white.opacity(0.16), in: RoundedRectangle(cornerRadius: 14))
                .overlay {
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(Color.white.opacity(0.34), lineWidth: 1)
                }
        }
    }
}

private struct ActiveWeekScreen: View {
    @EnvironmentObject private var store: ActiveWeeklyLoopStore
    @EnvironmentObject private var featureFlags: FeatureFlagStore
    @State private var selectedIndex = 0

    var body: some View {
        ScrollView {
            if let plan = store.snapshot?.plan, !plan.days.isEmpty {
                let safeIndex = min(selectedIndex, plan.days.count - 1)
                let day = plan.days[safeIndex]
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("YOUR REVIEWED WEEK")
                            .font(.caption.bold())
                            .tracking(1.2)
                            .foregroundStyle(NourishTheme.inkSoft)
                        Text("Your week, at a glance.")
                            .font(.system(.largeTitle, design: .serif, weight: .semibold))
                            .foregroundStyle(NourishTheme.ink)
                            .accessibilityAddTraits(.isHeader)
                        Text("Choose a day to see its meals, nutrition, and intentional leftovers.")
                            .foregroundStyle(NourishTheme.inkSoft)
                    }
                    if featureFlags.isEnabled(.weeklyInsights) {
                        WeeklyInsightsCard(plan: plan)
                    }
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(Array(plan.days.enumerated()), id: \.element.localDate) { index, candidate in
                                Button { selectedIndex = index } label: {
                                    VStack(spacing: 4) {
                                        Text(activeWeekday(candidate.localDate)).font(.caption.bold())
                                        Text(verbatim: NourishFormatting.integer(candidate.localDate.day)).font(.title3.bold())
                                    }
                                    .frame(width: 54, height: 58)
                                    .background(safeIndex == index ? NourishTheme.forest : NourishTheme.card)
                                    .foregroundStyle(safeIndex == index ? .white : .primary)
                                    .clipShape(RoundedRectangle(cornerRadius: 16))
                                }
                                .accessibilityIdentifier("active.day.\(index)")
                                .accessibilityLabel(Text(activeDate(candidate.localDate)))
                                .accessibilityAddTraits(safeIndex == index ? .isSelected : [])
                            }
                        }
                    }
                    Text(activeDate(day.localDate))
                        .font(.system(.title2, design: .serif, weight: .semibold))
                        .foregroundStyle(NourishTheme.ink)
                    ActiveNutritionSummary(day: day, target: plan.targetSnapshot)
                    ForEach(day.items, id: \.id) { item in
                        NavigationLink { ActiveRecipeDetail(itemID: item.id) } label: {
                            ActiveMealCard(item: item)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("active.meal.\(item.id)")
                        .accessibilityHint("Opens recipe details and safe swap options")
                    }
                    ActiveSyncBanner()
                }
                .padding(18)
                .padding(.bottom, 28)
            }
        }
        .background(NourishTheme.paper)
        .navigationTitle("My week")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct WeeklyInsightsCard: View {
    let plan: WeeklyPlan

    private var items: [PlanItem] { plan.days.flatMap(\.items) }
    private var completed: Int { items.filter { $0.completionState == .completed }.count }
    private var plannedLeftovers: Int {
        items.filter {
            if case .plannedReuse = $0.leftoverRelationship { return true }
            return false
        }.count
    }

    var body: some View {
        WeekOverviewCard(
            days: plan.days.count,
            meals: items.count,
            plannedLeftovers: plannedLeftovers,
            completed: completed
        )
    }
}

private struct ActiveNutritionSummary: View {
    let day: PlanDay
    let target: PlanTargetSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(decimalText(day.nutrition.calories)).font(.title.bold())
                (Text(verbatim: "/ \(NourishFormatting.energyKilocalories(Double(target.dailyCalories)))") + Text(" estimated"))
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            ProgressView(value: min(decimalDouble(day.nutrition.calories) / Double(max(target.dailyCalories, 1)), 1))
                .tint(NourishTheme.leaf)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 118), spacing: 8)], spacing: 8) {
                nutritionTarget(
                    "Protein",
                    planned: day.nutrition.proteinGrams,
                    target: target.optionalDailyProteinGrams.map { Decimal($0) }
                )
                nutritionTarget("Carbs", planned: day.nutrition.carbohydrateGrams, target: nil)
                nutritionTarget("Fat", planned: day.nutrition.fatGrams, target: nil)
            }
            Text("Reviewed recipe snapshots; nutrition remains an estimate for general wellness.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(18)
        .background(NourishTheme.card, in: RoundedRectangle(cornerRadius: 22))
    }

    private func nutritionTarget(_ label: LocalizedStringKey, planned: Decimal, target: Decimal?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption.bold())
            if let target {
                Text(verbatim: "\(NourishFormatting.massGrams(decimalDouble(planned))) / \(NourishFormatting.massGrams(decimalDouble(target)))")
                    .font(.caption)
            } else {
                (Text(verbatim: NourishFormatting.massGrams(decimalDouble(planned))) + Text(" planned"))
                    .font(.caption)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(NourishTheme.limeSoft, in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct ActiveMealCard: View {
    let item: PlanItem

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text(item.slot.localizedTitle).textCase(.uppercase).font(.caption.bold()).foregroundStyle(.secondary)
                Spacer()
                if item.completionState != .planned {
                    Text(item.completionState.activeTitle).font(.caption.bold()).foregroundStyle(NourishTheme.forest)
                }
            }
            Text(item.recipeSnapshot.displayName).font(.title3.bold())
            nutritionAndTimeSummary(
                calories: decimalDouble(item.nutrition.calories),
                proteinGrams: decimalDouble(item.nutrition.proteinGrams),
                activeMinutes: item.recipeSnapshot.activePreparationMinutes
            )
                .font(.subheadline).foregroundStyle(.secondary)
            if case .plannedReuse = item.leftoverRelationship {
                Label("Intentional planned leftover", systemImage: "arrow.triangle.2.circlepath")
                    .font(.caption.bold()).foregroundStyle(NourishTheme.forest)
            }
            Divider().padding(.top, 3)
            HStack(spacing: 8) {
                Text("View recipe & options")
                    .font(.subheadline.bold())
                    .foregroundStyle(NourishTheme.forest)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.bold())
                    .foregroundStyle(NourishTheme.forest)
            }
        }
        .padding(16)
        .background(NourishTheme.card, in: RoundedRectangle(cornerRadius: 20))
    }
}

private struct ActiveRecipeDetail: View {
    @EnvironmentObject private var store: ActiveWeeklyLoopStore
    @EnvironmentObject private var generationStore: PlanGenerationStore
    @EnvironmentObject private var analyticsEventStore: AnalyticsEventStore
    @Environment(\.dismiss) private var dismiss
    let itemID: String
    @State private var candidates: [SwapCandidate] = []
    @State private var loadingCandidates = false
    @State private var candidatesRequested = false
    @AccessibilityFocusState private var focusedCandidateID: String?

    private var item: PlanItem? {
        store.snapshot?.plan.days.flatMap(\.items).first { $0.id == itemID }
    }

    var body: some View {
        ScrollView {
            if let item {
                VStack(alignment: .leading, spacing: 18) {
                    ActiveRecipeDetailHero(item: item)

                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 118), spacing: 10)], spacing: 10) {
                        RecipeNutrient(label: "Calories", value: NourishFormatting.integer(Int(decimalDouble(item.nutrition.calories).rounded())))
                        RecipeNutrient(label: "Protein", value: NourishFormatting.massGrams(decimalDouble(item.nutrition.proteinGrams)))
                        RecipeNutrient(label: "Carbs", value: NourishFormatting.massGrams(decimalDouble(item.nutrition.carbohydrateGrams)))
                        RecipeNutrient(label: "Fat", value: NourishFormatting.massGrams(decimalDouble(item.nutrition.fatGrams)))
                    }

                    Button {
                        generationStore.toggleFavorite(recipeID: item.recipeSnapshot.recipeID)
                    } label: {
                        Label(
                            generationStore.isFavorite(recipeID: item.recipeSnapshot.recipeID)
                                ? "Remove from favorites"
                                : "Add to favorites",
                            systemImage: generationStore.isFavorite(recipeID: item.recipeSnapshot.recipeID)
                                ? "heart.fill"
                                : "heart"
                        )
                        .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                    .tint(NourishTheme.forest)
                    .accessibilityIdentifier("recipe.favorite")
                    .accessibilityHint("Favorites influence future ranking but never override diet, allergen, or variety rules")

                    if case .plannedReuse = item.leftoverRelationship {
                        Label("Intentional planned leftover", systemImage: "arrow.triangle.2.circlepath")
                            .font(.subheadline.bold())
                            .foregroundStyle(NourishTheme.forest)
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(NourishTheme.limeSoft, in: RoundedRectangle(cornerRadius: 16))
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        Label("Meal options", systemImage: "arrow.left.arrow.right")
                            .font(.headline)
                            .foregroundStyle(NourishTheme.forest)
                        Text("FamilyChef will only show replacements that still fit your diet, allergens, targets, and the variety of your whole week.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Button {
                            loadingCandidates = true
                            Task {
                                candidates = await store.swapCandidates(itemID: item.id)
                                candidatesRequested = true
                                loadingCandidates = false
                                focusedCandidateID = candidates.first?.recipe.recipeID
                                await analyticsEventStore.record(
                                    .swapListViewed,
                                    properties: [
                                        "candidate_count": .integer(candidates.count),
                                        "original_recipe_id": .string(item.recipeSnapshot.recipeID),
                                    ]
                                )
                            }
                        } label: {
                            HStack(spacing: 8) {
                                if loadingCandidates {
                                    ProgressView()
                                    Text("Checking safe swaps…")
                                } else {
                                    Label("Find another meal", systemImage: "magnifyingglass")
                                }
                            }
                            .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(NourishTheme.forest)
                        .disabled(loadingCandidates)
                        .accessibilityIdentifier("swap.show-candidates")
                        .accessibilityHint("Shows only replacements that keep the whole week within your safety and variety rules")

                        Menu {
                            ForEach(MealCompletionState.allCases, id: \.rawValue) { status in
                                Button(status.activeTitle) { Task { await store.setMealState(status, itemID: item.id) } }
                            }
                        } label: {
                            HStack(spacing: 10) {
                                Label("Update meal status", systemImage: "checkmark.circle")
                                Spacer()
                                Text(item.completionState.activeTitle)
                                    .foregroundStyle(.secondary)
                                Image(systemName: "chevron.down")
                                    .font(.caption.bold())
                            }
                            .frame(maxWidth: .infinity, minHeight: 46)
                        }
                        .buttonStyle(.bordered)
                        .tint(NourishTheme.forest)
                    }
                    .padding(18)
                    .background(NourishTheme.limeSoft, in: RoundedRectangle(cornerRadius: 22))
                    if candidatesRequested && candidates.isEmpty && !loadingCandidates {
                        Label("No suitable replacements are available right now. Your current meal is unchanged.", systemImage: "checkmark.shield")
                            .font(.subheadline)
                            .foregroundStyle(NourishTheme.forest)
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(NourishTheme.card, in: RoundedRectangle(cornerRadius: 16))
                    }
                    ForEach(candidates, id: \.recipe.recipeID) { candidate in
                        VStack(alignment: .leading, spacing: 10) {
                            Label("Fits your plan", systemImage: "checkmark.shield.fill")
                                .font(.caption.bold())
                                .foregroundStyle(NourishTheme.forest)
                            Text(candidate.recipe.displayName)
                                .font(.system(.title2, design: .serif, weight: .semibold))
                                .foregroundStyle(NourishTheme.ink)
                            nutritionAndTimeSummary(
                                calories: decimalDouble(candidate.recipe.nutritionPerServing.calories),
                                proteinGrams: decimalDouble(candidate.recipe.nutritionPerServing.proteinGrams),
                                activeMinutes: candidate.recipe.activePreparationMinutes
                            )
                            .font(.subheadline)
                            .foregroundStyle(NourishTheme.inkSoft)
                            swapDeltaSummary(
                                calories: candidate.calorieDelta,
                                proteinGrams: candidate.proteinDeltaGrams
                            )
                                .font(.caption).foregroundStyle(.secondary)
                            Button {
                                Task {
                                    if await store.confirmSwap(itemID: item.id, replacementRecipeID: candidate.recipe.recipeID) {
                                        dismiss()
                                    }
                                }
                            } label: {
                                Label("Choose this replacement", systemImage: "checkmark")
                                    .frame(maxWidth: .infinity, minHeight: 44)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(NourishTheme.forest)
                            .accessibilityIdentifier("swap.confirm.\(candidate.recipe.recipeID)")
                            .accessibilityHint("Recalculates this meal, the week, groceries, and preparation plan")
                        }
                        .padding(18)
                        .background(NourishTheme.card, in: RoundedRectangle(cornerRadius: 22))
                        .shadow(color: NourishTheme.ink.opacity(0.05), radius: 12, y: 6)
                        .accessibilityFocused($focusedCandidateID, equals: candidate.recipe.recipeID)
                    }

                    detailSection("Ingredients") {
                        ForEach(item.recipeSnapshot.ingredients, id: \.ingredientID) { ingredient in
                            Text(verbatim: "• \(decimalText(ingredient.householdQuantity)) \(ingredient.householdUnit) \(ingredient.displayName) (\(NourishFormatting.massGrams(decimalDouble(ingredient.grams))))")
                        }
                    }
                    detailSection("Method") {
                        ForEach(Array(item.recipeSnapshot.methodSteps.enumerated()), id: \.offset) { index, step in
                            Text(verbatim: "\(NourishFormatting.integer(index + 1)). \(step)")
                        }
                    }
                    MealFeedbackSection(item: item)

                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: 7) {
                            (Text("Version ")
                                + Text(verbatim: NourishFormatting.integer(item.recipeSnapshot.version))
                                + Text(verbatim: " · ")
                                + Text(item.recipeSnapshot.publicationStatus.localizedLabel)
                                + Text(verbatim: " · ")
                                + Text("nutrition review ")
                                + Text(item.recipeSnapshot.reviewStatus.localizedLabel))
                                .font(.subheadline.bold())
                            Text(verbatim: item.recipeSnapshot.nutritionSourceSummary)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.top, 8)
                    } label: {
                        Label("Recipe review & nutrition source", systemImage: "checkmark.seal")
                            .font(.headline)
                    }
                    .padding(16)
                    .background(NourishTheme.amberSoft, in: RoundedRectangle(cornerRadius: 18))
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 28)
            }
        }
        .background(NourishTheme.paper)
        .navigationTitle("Recipe")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: itemID) {
            guard let item, let plan = store.snapshot?.plan else { return }
            let dayIndex = plan.days.firstIndex { $0.localDate == item.localDate } ?? 0
            await analyticsEventStore.record(
                .mealDetailViewed,
                properties: [
                    "recipe_version_id": .string("\(item.recipeSnapshot.recipeID):v\(item.recipeSnapshot.version)"),
                    "slot": .string(item.slot.rawValue),
                    "day_index": .integer(dayIndex),
                ]
            )
        }
    }
}

private struct ActiveRecipeDetailHero: View {
    let item: PlanItem

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            MealArtwork(recipeID: item.recipeSnapshot.recipeID, height: 310)
            LinearGradient(
                colors: [Color.black.opacity(0.02), Color.black.opacity(0.18), Color.black.opacity(0.86)],
                startPoint: .top,
                endPoint: .bottom
            )
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(item.slot.localizedTitle)
                        .textCase(.uppercase)
                        .font(.caption.bold())
                        .tracking(1.1)
                    Spacer()
                    Label("Reviewed", systemImage: "checkmark.seal.fill")
                        .font(.caption.bold())
                }
                Text(item.recipeSnapshot.displayName)
                    .font(.system(size: 34, weight: .semibold, design: .serif))
                (Text(verbatim: NourishFormatting.durationMinutes(Double(item.recipeSnapshot.activePreparationMinutes)))
                    + Text(" active · ")
                    + Text(item.recipeSnapshot.dietType.localizedLabel))
                    .font(.subheadline)
                    .foregroundStyle(Color.white.opacity(0.78))
            }
            .foregroundStyle(.white)
            .padding(20)
        }
        .frame(height: 310)
        .clipShape(RoundedRectangle(cornerRadius: 28))
        .shadow(color: NourishTheme.ink.opacity(0.12), radius: 22, y: 10)
    }
}

private struct MealFeedbackSection: View {
    @EnvironmentObject private var generationStore: PlanGenerationStore
    let item: PlanItem
    @State private var rating = 0
    @State private var reasons: Set<MealFeedbackReason> = []
    @State private var note = ""
    @State private var submitting = false

    var body: some View {
        detailSection("How was this meal?") {
            HStack(spacing: 8) {
                ForEach(1...5, id: \.self) { value in
                    Button { rating = value } label: {
                        Image(systemName: value <= rating ? "star.fill" : "star")
                            .font(.title3)
                            .foregroundStyle(value <= rating ? Color.orange : .secondary)
                    }
                    .accessibilityLabel(
                        Text("Rate ")
                            + Text(verbatim: NourishFormatting.integer(value))
                            + Text(" out of 5")
                    )
                }
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 8)], alignment: .leading, spacing: 8) {
                ForEach(MealFeedbackReason.allCases, id: \.self) { reason in
                    Button {
                        if reasons.contains(reason) { reasons.remove(reason) }
                        else { reasons.insert(reason) }
                    } label: {
                        Text(reason.localizedDisplayName)
                            .font(.caption.bold())
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .frame(maxWidth: .infinity)
                            .background(reasons.contains(reason) ? NourishTheme.limeSoft : Color.secondary.opacity(0.1), in: Capsule())
                    }
                    .foregroundStyle(.primary)
                }
            }
            TextField("Optional note", text: $note, axis: .vertical)
                .textFieldStyle(.roundedBorder)
            Button {
                submitting = true
                Task {
                    _ = await generationStore.submitFeedback(
                        for: item,
                        rating: rating,
                        reasons: reasons,
                        note: note.isEmpty ? nil : note
                    )
                    submitting = false
                }
            } label: {
                if submitting { Text("Saving…") }
                else { Text("Save meal feedback") }
            }
            .buttonStyle(.bordered)
            .disabled(rating == 0 || submitting)
            if let message = generationStore.feedbackMessageByItemID[item.id] {
                Label {
                    localizedRuntimeMessage(message)
                } icon: {
                    Image(systemName: message == "Feedback saved" ? "checkmark.circle.fill" : "exclamationmark.circle")
                }
                    .font(.caption)
                    .foregroundStyle(message == "Feedback saved" ? NourishTheme.forest : .secondary)
            }
        }
    }
}

private struct ActiveGroceryScreen: View {
    @EnvironmentObject private var store: ActiveWeeklyLoopStore
    @EnvironmentObject private var analyticsEventStore: AnalyticsEventStore
    @State private var recordedListID: String?

    private var categories: [GroceryCategory] {
        let available = Set(store.snapshot?.groceryList.items.map(\.category) ?? [])
        return GroceryCategory.allCases.filter(available.contains)
    }

    private var items: [GroceryItem] { store.snapshot?.groceryList.items ?? [] }
    private var accountedItemCount: Int { items.filter { $0.disposition != .needed }.count }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("WEEKLY SHOP")
                        .font(.caption.bold())
                        .tracking(1.2)
                        .foregroundStyle(NourishTheme.inkSoft)
                    Text("Your grocery list.")
                        .font(.system(.largeTitle, design: .serif, weight: .semibold))
                        .foregroundStyle(NourishTheme.ink)
                    Text("Consolidated from your reviewed week, with pantry items kept separate.")
                        .foregroundStyle(NourishTheme.inkSoft)
                }
                    .accessibilityAddTraits(.isHeader)
                GroceryProgressCard(accounted: accountedItemCount, total: items.count)
                ForEach(categories, id: \.rawValue) { category in
                    Text(category.localizedTitle).textCase(.uppercase).font(.caption.bold()).foregroundStyle(.secondary)
                    ForEach(store.snapshot?.groceryList.items.filter { $0.category == category } ?? [], id: \.id) { item in
                        ActiveGroceryRow(item: item)
                    }
                }
                ActiveSyncBanner()
            }
            .padding(18)
            .padding(.bottom, 28)
        }
        .background(NourishTheme.paper)
        .navigationTitle("Groceries")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: store.snapshot?.groceryList.id) {
            guard let list = store.snapshot?.groceryList, recordedListID != list.id else { return }
            if await analyticsEventStore.record(
                .groceryListOpened,
                properties: [
                    "item_count": .integer(list.items.count),
                    "checked_count": .integer(list.items.filter { $0.disposition == .checked }.count),
                ]
            ) {
                recordedListID = list.id
            }
        }
    }
}

private struct ActiveGroceryRow: View {
    @EnvironmentObject private var store: ActiveWeeklyLoopStore
    let item: GroceryItem

    var body: some View {
        HStack(spacing: 12) {
            Button { Task { await store.toggleGrocery(itemID: item.id) } } label: {
                Image(systemName: item.disposition == .checked ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
            }
            .accessibilityIdentifier("grocery.check.\(item.id)")
            .accessibilityLabel(
                item.disposition == .checked
                    ? Text("Uncheck ") + Text(verbatim: item.displayName)
                    : Text("Check ") + Text(verbatim: item.displayName)
            )
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    Text(item.displayName).strikethrough(item.disposition != .needed)
                    if item.newlyAddedBySwap || item.changedBySwap {
                        Group {
                            if item.newlyAddedBySwap { Text("NEW") }
                            else { Text("UPDATED") }
                        }
                            .font(.caption2.bold())
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(NourishTheme.amberSoft, in: Capsule())
                    }
                }
                Text(verbatim: NourishFormatting.massGrams(decimalDouble(item.effectiveGrams)) + householdSummary(item))
                    .font(.caption).foregroundStyle(.secondary)
                HStack(spacing: 12) {
                    Button { Task { await store.adjustGroceryQuantity(itemID: item.id, by: -50) } } label: { Image(systemName: "minus.circle") }
                        .accessibilityLabel("Decrease quantity by 50 grams")
                    Text("Edit by 50 g").font(.caption2).foregroundStyle(.secondary)
                    Button { Task { await store.adjustGroceryQuantity(itemID: item.id, by: 50) } } label: { Image(systemName: "plus.circle") }
                        .accessibilityLabel("Increase quantity by 50 grams")
                }
            }
            Spacer()
            Button { Task { await store.toggleAlreadyHave(itemID: item.id) } } label: {
                Group {
                    if item.disposition == .alreadyHave { Text("In pantry") }
                    else { Text("Have it") }
                }
                    .font(.caption.bold())
                    .padding(.horizontal, 10).padding(.vertical, 7)
                    .background(item.disposition == .alreadyHave ? NourishTheme.limeSoft : Color.secondary.opacity(0.1), in: Capsule())
            }
            .accessibilityLabel(
                item.disposition == .alreadyHave
                    ? Text("Remove item from pantry")
                    : Text("Mark item as already available")
            )
        }
        .foregroundStyle(.primary)
        .padding(14)
        .background(NourishTheme.card, in: RoundedRectangle(cornerRadius: 18))
    }

    private func householdSummary(_ item: GroceryItem) -> String {
        guard !item.householdQuantities.isEmpty else { return "" }
        return " · " + item.householdQuantities.map { "\(decimalText($0.quantity)) \($0.unit)" }.joined(separator: " + ")
    }
}

private struct ActivePrepScreen: View {
    @EnvironmentObject private var store: ActiveWeeklyLoopStore
    @EnvironmentObject private var analyticsEventStore: AnalyticsEventStore
    @State private var recordedPlanID: String?

    private var tasks: [PrepTask] { store.snapshot?.prepTimeline.tasks ?? [] }
    private var firstIncompleteTask: PrepTask? { tasks.first { !$0.isComplete } }
    private var completedCount: Int { tasks.filter(\.isComplete).count }
    private var totalActiveMinutes: Int { tasks.reduce(0) { $0 + $1.activeMinutes } }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("WEEKLY PREP")
                            .font(.caption.bold())
                            .tracking(1.2)
                            .foregroundStyle(NourishTheme.inkSoft)
                        Text("Set up an easier week.")
                            .font(.system(.largeTitle, design: .serif, weight: .semibold))
                            .foregroundStyle(NourishTheme.ink)
                            .accessibilityAddTraits(.isHeader)
                        (Text(verbatim: NourishFormatting.durationMinutes(Double(totalActiveMinutes)))
                            + Text(" active time across small, reusable prep steps."))
                            .foregroundStyle(NourishTheme.inkSoft)
                    }

                    if tasks.isEmpty {
                        Text("This week has no linked batch-prep tasks.").foregroundStyle(.secondary)
                    } else {
                        if let firstIncompleteTask {
                            PrepPriorityCard(
                                title: firstIncompleteTask.title,
                                detail: firstIncompleteTask.reuseNote,
                                activeMinutes: firstIncompleteTask.activeMinutes,
                                completed: completedCount,
                                total: tasks.count
                            ) {
                                withAnimation { proxy.scrollTo(firstIncompleteTask.id, anchor: .center) }
                            }
                        } else {
                            PrepCompleteCard(total: tasks.count)
                        }

                        sectionTitle(
                            "Your prep flow",
                            subtitle: completedCount == tasks.count ? "Everything is ready" : "Complete one small win at a time"
                        )

                        ForEach(tasks, id: \.id) { task in
                            Button { Task { await store.togglePrep(taskID: task.id) } } label: {
                                HStack(alignment: .top, spacing: 12) {
                                    Image(systemName: task.isComplete ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(task.isComplete ? NourishTheme.leaf : .secondary)
                                    VStack(alignment: .leading, spacing: 7) {
                                        HStack {
                                            Text(task.title).font(.headline)
                                            Spacer()
                                            Text(verbatim: NourishFormatting.durationMinutes(Double(task.activeMinutes)))
                                                .font(.caption.bold()).foregroundStyle(.secondary)
                                        }
                                        Text(activeDate(task.localDate)).font(.caption.bold()).foregroundStyle(.secondary)
                                        Label { Text(verbatim: task.storageNote) } icon: { Image(systemName: "snowflake") }
                                        Label { Text(verbatim: task.reuseNote) } icon: { Image(systemName: "arrow.triangle.2.circlepath") }
                                    }
                                    .font(.subheadline)
                                    .multilineTextAlignment(.leading)
                                }
                                .foregroundStyle(.primary)
                                .padding(16)
                                .background(NourishTheme.card, in: RoundedRectangle(cornerRadius: 20))
                            }
                            .buttonStyle(.plain)
                            .id(task.id)
                        }
                    }
                    ActiveSyncBanner()
                }
                .padding(18)
                .padding(.bottom, 28)
            }
        }
        .background(NourishTheme.paper)
        .navigationTitle("Prep")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: store.snapshot?.prepTimeline.planID) {
            guard let timeline = store.snapshot?.prepTimeline,
                  recordedPlanID != timeline.planID else { return }
            if await analyticsEventStore.record(
                .prepPlanOpened,
                properties: [
                    "task_count": .integer(timeline.tasks.count),
                    "active_minutes": .integer(timeline.tasks.reduce(0) { $0 + $1.activeMinutes }),
                ]
            ) {
                recordedPlanID = timeline.planID
            }
        }
    }
}

private struct PlanStudioView: View {
    @EnvironmentObject private var generationStore: PlanGenerationStore
    @EnvironmentObject private var activeStore: ActiveWeeklyLoopStore
    @EnvironmentObject private var reminderStore: LifecycleReminderStore
    @EnvironmentObject private var accountStore: AccountLifecycleStore
    @EnvironmentObject private var analyticsEventStore: AnalyticsEventStore
    @Environment(\.dismiss) private var dismiss
    let profile: UserProfile?
    @State private var lockedItemIDs: Set<String> = []
    @State private var regenerationReason = "More variety"
    @State private var includeOptionalSnack = false
    @State private var recordedPreviewPlanID: String?

    private let reasonOptions = ["More variety", "Less cooking", "Lower effort", "Ingredients unavailable", "Schedule changed"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    PlanStudioHeader()
                    content
                    if !generationStore.history.isEmpty {
                        PlanHistorySection(entries: generationStore.history)
                    }
                }
                .padding(18)
                .padding(.bottom, 30)
            }
            .background(NourishTheme.paper)
            .navigationTitle("Plan Studio")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task { await recordPlanPreviewIfNeeded() }
            .onChange(of: generationStore.state) { _, _ in
                Task { await recordPlanPreviewIfNeeded() }
            }
        }
    }

    private func recordPlanPreviewIfNeeded() async {
        guard case .ready = generationStore.state,
              let plan = generationStore.draft?.plan,
              recordedPreviewPlanID != plan.id else { return }
        if await analyticsEventStore.record(
            .planPreviewViewed,
            properties: [
                "days_visible": .integer(plan.days.count),
                "entitlement_state": .string(accountStore.entitlement?.state.rawValue ?? "unknown"),
            ]
        ) {
            recordedPreviewPlanID = plan.id
        }
    }

    @ViewBuilder private var content: some View {
        if let profile {
            planContent(profile: profile)
        } else {
            Label("Complete onboarding before creating a reviewed week.", systemImage: "person.crop.circle.badge.exclamationmark")
                .padding(16)
                .background(NourishTheme.amberSoft, in: RoundedRectangle(cornerRadius: 18))
        }
    }

    @ViewBuilder private func planContent(profile: UserProfile) -> some View {
        switch generationStore.state {
        case .signedOut:
            Label("Sign in to generate and adopt a reviewed week.", systemImage: "lock")
                .padding(16)
                .background(NourishTheme.amberSoft, in: RoundedRectangle(cornerRadius: 18))
        case .submitting, .generating:
            VStack(spacing: 16) {
                ProgressView()
                Text("Building a safe, varied week…").font(.headline)
                Text("Hard diet, allergen, exclusion, review, cooking-time, and variety rules run before preferences.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(28)
            .background(NourishTheme.card, in: RoundedRectangle(cornerRadius: 22))
        case .ready:
            if let plan = generationStore.draft?.plan {
                PlanReviewView(plan: plan, diagnostics: generationStore.draft?.diagnostics, lockedItemIDs: $lockedItemIDs)
                planActions(profile: profile, plan: plan)
            }
        case .adopting:
            ProgressView("Activating your reviewed week…")
                .frame(maxWidth: .infinity).padding(28)
        case .adopted:
            VStack(alignment: .leading, spacing: 10) {
                Label {
                    if generationStore.lastAdoptionStatus == "scheduled" {
                        Text("Next week scheduled")
                    } else {
                        Text("Reviewed week activated")
                    }
                } icon: {
                    Image(systemName: "checkmark.seal.fill")
                }
                .font(.title2.bold()).foregroundStyle(NourishTheme.forest)
                if generationStore.lastAdoptionStatus == "scheduled" {
                    Text("Your current week stays active. FamilyChef will switch on the new plan’s local start date.")
                        .foregroundStyle(.secondary)
                } else {
                    Text("Today, Week, Groceries, and Prep now use this immutable reviewed plan.")
                        .foregroundStyle(.secondary)
                }
            }
            .padding(20)
            .background(NourishTheme.limeSoft, in: RoundedRectangle(cornerRadius: 22))
        case let .failed(message, retryable):
            VStack(alignment: .leading, spacing: 12) {
                Label("A reviewed week was not created", systemImage: "exclamationmark.triangle")
                    .font(.headline)
                localizedRuntimeMessage(message).foregroundStyle(.secondary)
                if retryable {
                    Button("Start again") { generationStore.clearDraft() }
                        .buttonStyle(.bordered)
                }
            }
            .padding(18)
            .background(NourishTheme.amberSoft, in: RoundedRectangle(cornerRadius: 20))
            creationActions(profile: profile)
        case .idle:
            creationActions(profile: profile)
        }
    }

    @ViewBuilder private func creationActions(profile: UserProfile) -> some View {
        if let active = activeStore.snapshot?.plan {
            WeeklyReviewCard(plan: active)
            VStack(alignment: .leading, spacing: 12) {
                Text("Prepare the next week").font(.title2.bold())
                Text("Generate the seven days after your current plan. Adoption schedules the renewal without replacing this week early.")
                    .foregroundStyle(.secondary)
                optionalSnackToggle(profile)
                Button("Create next week") {
                    Task {
                        await generationStore.generate(
                            profile: profile,
                            activePlan: active,
                            includeOptionalSnack: includeOptionalSnack,
                            planStartWeekday: reminderStore.settings.planStartWeekday
                        )
                    }
                }
                .buttonStyle(.borderedProminent).tint(NourishTheme.forest)
            }
            .padding(18)
            .background(NourishTheme.card, in: RoundedRectangle(cornerRadius: 20))

            if isFuturePlan(active) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Rework this future week").font(.title3.bold())
                    Text("Lock safe meals to keep, choose a reason, then regenerate the remaining slots. Previous plans remain in history.")
                        .font(.subheadline).foregroundStyle(.secondary)
                    LockablePlanList(plan: active, lockedItemIDs: $lockedItemIDs)
                    reasonMenu
                    Button("Regenerate unlocked meals") {
                        Task {
                            await generationStore.generate(
                                profile: profile,
                                activePlan: active,
                                lockedPlanItemIDs: lockedItemIDs,
                                regenerationReason: regenerationReason,
                                includeOptionalSnack: includeOptionalSnack,
                                planStartWeekday: reminderStore.settings.planStartWeekday
                            )
                        }
                    }
                    .buttonStyle(.bordered)
                }
                .padding(18)
                .background(NourishTheme.card, in: RoundedRectangle(cornerRadius: 20))
            } else {
                Text("The current week is already underway. Use safe meal swaps now; full regeneration is available for a future week.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        } else {
            VStack(alignment: .leading, spacing: 12) {
                Text("Create your first reviewed week").font(.title2.bold())
                Text("FamilyChef will only activate a plan built from published recipes with approved nutrition review.")
                    .foregroundStyle(.secondary)
                optionalSnackToggle(profile)
                Button("Generate reviewed week") {
                    Task {
                        await generationStore.generate(
                            profile: profile,
                            activePlan: nil,
                            includeOptionalSnack: includeOptionalSnack,
                            planStartWeekday: reminderStore.settings.planStartWeekday
                        )
                    }
                }
                .buttonStyle(.borderedProminent).tint(NourishTheme.forest)
            }
            .padding(18)
            .background(NourishTheme.card, in: RoundedRectangle(cornerRadius: 20))
        }
    }

    private func planActions(profile: UserProfile, plan: WeeklyPlan) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Button("Adopt this reviewed week") {
                Task {
                    if await generationStore.adoptDraft() { await activeStore.retry() }
                }
            }
            .buttonStyle(.borderedProminent).tint(NourishTheme.forest)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("plan-studio.adopt")

            Divider()
            Text("Want another version?").font(.headline)
            Text("Locked meals are rechecked against your current safety rules. Planned leftovers must stay linked to their batch source.")
                .font(.footnote).foregroundStyle(.secondary)
            reasonMenu
            Button("Regenerate unlocked meals") {
                Task {
                    await generationStore.generate(
                        profile: profile,
                        activePlan: plan,
                        lockedPlanItemIDs: lockedItemIDs,
                        regenerationReason: regenerationReason,
                        includeOptionalSnack: includeOptionalSnack,
                        planStartWeekday: reminderStore.settings.planStartWeekday
                    )
                }
            }
            .buttonStyle(.bordered)
            .disabled(!isFuturePlan(plan))
        }
        .padding(18)
        .background(NourishTheme.card, in: RoundedRectangle(cornerRadius: 20))
    }

    private var reasonMenu: some View {
        Menu {
            ForEach(reasonOptions, id: \.self) { reason in
                Button { regenerationReason = reason } label: {
                    localizedRuntimeMessage(reason)
                }
            }
        } label: {
            Label {
                Text("Reason: ") + localizedRuntimeMessage(regenerationReason)
            } icon: {
                Image(systemName: "text.bubble")
            }
        }
        .buttonStyle(.bordered)
    }

    @ViewBuilder private func optionalSnackToggle(_ profile: UserProfile) -> some View {
        if profile.snackPreference == .optional {
            Toggle("Include an optional snack", isOn: $includeOptionalSnack)
        }
    }

    private func isFuturePlan(_ plan: WeeklyPlan) -> Bool {
        guard let first = plan.days.first?.localDate,
              let timeZone = TimeZone(identifier: plan.timeZoneIdentifier) else { return false }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let components = calendar.dateComponents([.year, .month, .day], from: .now)
        guard let year = components.year, let month = components.month, let day = components.day else { return false }
        return first >= LocalDate(year: year, month: month, day: day)
    }
}

private struct PlanStudioHeader: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Review before it becomes your week")
                .font(.largeTitle.bold())
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("plan-studio.heading")
            Text("Generation never overrides allergens or hard exclusions. Adopting is a separate confirmation.")
                .foregroundStyle(.secondary)
        }
    }
}

private struct WeeklyReviewCard: View {
    @EnvironmentObject private var generationStore: PlanGenerationStore
    let plan: WeeklyPlan
    @State private var changes: Set<WeeklyReviewChange> = []
    @State private var submitting = false

    private var items: [PlanItem] { plan.days.flatMap(\.items) }
    private var completedCount: Int { items.filter { $0.completionState == .completed }.count }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Weekly review").font(.title2.bold())
            (Text(verbatim: NourishFormatting.integer(completedCount))
                + Text(" of ")
                + Text(verbatim: NourishFormatting.integer(items.count))
                + Text(" planned meals completed"))
                .foregroundStyle(.secondary)
            ProgressView(value: items.isEmpty ? 0 : Double(completedCount) / Double(items.count))
                .tint(NourishTheme.leaf)
            Text("What should change next week?").font(.subheadline.bold())
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 125), spacing: 8)], alignment: .leading, spacing: 8) {
                ForEach(WeeklyReviewChange.allCases, id: \.self) { change in
                    Button {
                        if changes.contains(change) { changes.remove(change) }
                        else { changes.insert(change) }
                    } label: {
                        Text(change.localizedDisplayName)
                            .font(.caption.bold())
                            .padding(.horizontal, 10).padding(.vertical, 8)
                            .frame(maxWidth: .infinity)
                            .background(changes.contains(change) ? NourishTheme.limeSoft : Color.secondary.opacity(0.1), in: Capsule())
                    }
                    .foregroundStyle(.primary)
                }
            }
            Button {
                submitting = true
                Task {
                    _ = await generationStore.submitWeeklyReview(plan: plan, changes: changes)
                    submitting = false
                }
            } label: {
                if submitting { Text("Saving…") }
                else { Text("Complete weekly review") }
            }
            .buttonStyle(.bordered)
            .disabled(submitting)
            if let message = generationStore.weeklyReviewMessage {
                Label {
                    localizedRuntimeMessage(message)
                } icon: {
                    Image(systemName: message == "Weekly review saved" ? "checkmark.circle.fill" : "exclamationmark.circle")
                }
                    .font(.caption)
                    .foregroundStyle(message == "Weekly review saved" ? NourishTheme.forest : .secondary)
            }
        }
        .padding(18)
        .background(NourishTheme.card, in: RoundedRectangle(cornerRadius: 20))
    }
}

private struct PlanHistorySection: View {
    let entries: [PlanHistoryEntry]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Plan history").font(.title3.bold())
            Text("Generated and adopted plans remain immutable; regeneration adds a successor.")
                .font(.footnote).foregroundStyle(.secondary)
            ForEach(entries, id: \.plan.id) { entry in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: historyIcon(entry.lifecycleStatus))
                        .foregroundStyle(NourishTheme.forest)
                    VStack(alignment: .leading, spacing: 3) {
                        if let first = entry.plan.days.first?.localDate, let last = entry.plan.days.last?.localDate {
                            Text(verbatim: "\(activeDate(first)) – \(activeDate(last))").font(.subheadline.bold())
                        }
                        localizedPlanLifecycle(
                            entry.lifecycleStatus,
                            isRegenerated: entry.supersedesPlanID != nil
                        )
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                }
            }
        }
        .padding(18)
        .background(NourishTheme.card, in: RoundedRectangle(cornerRadius: 20))
    }

    private func historyIcon(_ status: String) -> String {
        switch status {
        case "active": "checkmark.circle.fill"
        case "scheduled": "calendar.badge.clock"
        case "draft": "doc"
        default: "clock.arrow.circlepath"
        }
    }
}

private struct PlanReviewView: View {
    let plan: WeeklyPlan
    let diagnostics: PlannerDiagnostics?
    @Binding var lockedItemIDs: Set<String>

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Reviewed seven-day plan").font(.title2.bold())
                    if let first = plan.days.first?.localDate, let last = plan.days.last?.localDate {
                        Text(verbatim: "\(activeDate(first)) – \(activeDate(last))").font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Label("Draft", systemImage: "doc.text.magnifyingglass").font(.caption.bold())
            }
            if let diagnostics {
                HStack(spacing: 16) {
                    Label {
                        Text(verbatim: NourishFormatting.integer(diagnostics.selectedRecipeCount)) + Text(" recipes")
                    } icon: {
                        Image(systemName: "fork.knife")
                    }
                    Label {
                        Text(verbatim: NourishFormatting.integer(diagnostics.variety?.intentionalLeftovers ?? 0)) + Text(" planned leftovers")
                    } icon: {
                        Image(systemName: "arrow.triangle.2.circlepath")
                    }
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            ForEach(plan.days, id: \.localDate) { day in
                VStack(alignment: .leading, spacing: 10) {
                    Text(activeDate(day.localDate).uppercased()).font(.caption.bold()).foregroundStyle(.secondary)
                    macroSummary(day.nutrition)
                        .font(.caption).foregroundStyle(.secondary)
                    ForEach(day.items, id: \.id) { item in
                        LockableMealRow(item: item, lockedItemIDs: $lockedItemIDs)
                    }
                }
                .padding(14)
                .background(NourishTheme.card, in: RoundedRectangle(cornerRadius: 18))
            }
        }
    }
}

private struct LockablePlanList: View {
    let plan: WeeklyPlan
    @Binding var lockedItemIDs: Set<String>

    var body: some View {
        ForEach(plan.days, id: \.localDate) { day in
            VStack(alignment: .leading, spacing: 7) {
                Text(activeDate(day.localDate)).font(.caption.bold()).foregroundStyle(.secondary)
                ForEach(day.items, id: \.id) { item in
                    LockableMealRow(item: item, lockedItemIDs: $lockedItemIDs)
                }
            }
        }
    }
}

private struct LockableMealRow: View {
    let item: PlanItem
    @Binding var lockedItemIDs: Set<String>

    private var canLock: Bool {
        if case .plannedReuse = item.leftoverRelationship { return false }
        return true
    }

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.recipeSnapshot.displayName).font(.subheadline.bold())
                if canLock {
                    Text(item.slot.localizedTitle)
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    (Text(item.slot.localizedTitle) + Text(" · linked leftover"))
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Button {
                if lockedItemIDs.contains(item.id) { lockedItemIDs.remove(item.id) }
                else { lockedItemIDs.insert(item.id) }
            } label: {
                Image(systemName: lockedItemIDs.contains(item.id) ? "lock.fill" : "lock.open")
                    .foregroundStyle(lockedItemIDs.contains(item.id) ? NourishTheme.forest : .secondary)
            }
            .disabled(!canLock)
            .accessibilityLabel(lockedItemIDs.contains(item.id) ? "Unlock meal" : "Lock meal for regeneration")
        }
        .padding(.vertical, 3)
    }
}

private struct TodayScreen: View {
    @EnvironmentObject private var store: DemoPlanStore
    @State private var selectedMeal: DemoMeal?

    private var day: DemoDay { store.days[0] }
    private var featuredMeal: DemoMeal? { day.meals.last }
    private var supportingMeals: [DemoMeal] { Array(day.meals.dropLast()) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(verbatim: illustrativeDate(day, abbreviated: false).uppercased())
                        .font(.caption.bold())
                        .tracking(1.2)
                        .foregroundStyle(NourishTheme.inkSoft)
                    Text("Good morning, Rhea.")
                        .font(.system(.largeTitle, design: .serif, weight: .semibold))
                        .foregroundStyle(NourishTheme.ink)
                    Text("A calm start to a well-fed week.")
                        .foregroundStyle(NourishTheme.inkSoft)
                }

                if let featuredMeal {
                    IllustrativeMealHero(meal: featuredMeal) {
                        selectedMeal = featuredMeal
                    }
                }

                if let mealName = store.lastSwappedMealName {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "checkmark.circle.fill")
                        (Text(verbatim: mealName)
                            + Text(" was replaced. Nutrition, groceries, and prep were recalculated together."))
                            .font(.subheadline)
                        Spacer()
                        Button { store.clearMessage() } label: { Image(systemName: "xmark") }
                            .accessibilityLabel("Dismiss update")
                    }
                    .foregroundStyle(NourishTheme.forest)
                    .padding()
                    .background(NourishTheme.limeSoft, in: RoundedRectangle(cornerRadius: 18))
                }

                sectionTitle("Today’s plan", subtitle: "Practical meals, ready when you are")
                ForEach(supportingMeals) { meal in
                    MealCard(meal: meal, status: store.status(for: meal)) {
                        selectedMeal = meal
                    }
                }

                NutritionSummary(day: day)
                VarietyCard()
                IllustrativePlanBanner()
            }
            .padding(.horizontal, 18)
            .padding(.top, 12)
            .padding(.bottom, 32)
        }
        .background(NourishTheme.paper)
        .navigationTitle("Today")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $selectedMeal) { meal in
            RecipeDetailSheet(meal: meal)
                .environmentObject(store)
        }
    }
}

private struct IllustrativeMealHero: View {
    let meal: DemoMeal
    let openMeal: () -> Void

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            MealArtwork(recipeID: meal.recipeID, height: 410)

            LinearGradient(
                colors: [Color.black.opacity(0.04), Color.black.opacity(0.16), Color.black.opacity(0.88)],
                startPoint: .top,
                endPoint: .bottom
            )

            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text(verbatim: meal.slot.uppercased())
                        .font(.caption.bold())
                        .tracking(1.2)
                    Spacer()
                    Label("Vegetarian", systemImage: "leaf.fill")
                        .font(.caption.bold())
                }
                .foregroundStyle(Color.white.opacity(0.90))

                Spacer()

                Text("Tonight")
                    .font(.subheadline)
                    .foregroundStyle(Color.white.opacity(0.78))
                Text(meal.name)
                    .font(.system(size: 34, weight: .semibold, design: .serif))
                    .foregroundStyle(.white)
                    .padding(.top, 3)
                nutritionAndTimeSummary(
                    calories: Double(meal.calories),
                    proteinGrams: Double(meal.protein),
                    activeMinutes: meal.activeMinutes
                )
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Color.white.opacity(0.86))
                .padding(.top, 8)

                HStack(spacing: 10) {
                    Button(action: openMeal) {
                        Label("View recipe", systemImage: "book.closed")
                            .font(.subheadline.bold())
                            .foregroundStyle(NourishTheme.ink)
                            .padding(.horizontal, 15)
                            .frame(minHeight: 46)
                            .background(.white, in: RoundedRectangle(cornerRadius: 14))
                    }
                    .buttonStyle(.plain)

                    Button(action: openMeal) {
                        Label("Meal options", systemImage: "arrow.left.arrow.right")
                            .font(.subheadline.bold())
                            .foregroundStyle(.white)
                            .padding(.horizontal, 15)
                            .frame(minHeight: 46)
                            .background(Color.white.opacity(0.16), in: RoundedRectangle(cornerRadius: 14))
                            .overlay {
                                RoundedRectangle(cornerRadius: 14)
                                    .stroke(Color.white.opacity(0.34), lineWidth: 1)
                            }
                    }
                    .buttonStyle(.plain)
                }
                .padding(.top, 18)
            }
            .padding(20)
        }
        .frame(height: 410)
        .clipShape(RoundedRectangle(cornerRadius: 28))
        .shadow(color: NourishTheme.ink.opacity(0.12), radius: 24, y: 12)
        .accessibilityElement(children: .contain)
    }
}

private struct MealArtwork: View {
    let recipeID: String
    let height: CGFloat

    var body: some View {
        Group {
            if recipeID == "palak-paneer", let mealImage {
            Image(uiImage: mealImage)
                .resizable()
                .scaledToFill()
                .frame(maxWidth: .infinity)
                    .frame(height: height)
                .clipped()
            } else {
                ZStack {
                    LinearGradient(
                        colors: [NourishTheme.forest, NourishTheme.forest.opacity(0.72)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    Image(systemName: "fork.knife")
                        .font(.system(size: min(height * 0.28, 112), weight: .light))
                        .foregroundStyle(Color.white.opacity(0.12))
                        .offset(x: height * 0.19, y: -height * 0.13)
                }
            }
        }
        .frame(height: height)
    }

    private var mealImage: UIImage? {
        guard let url = Bundle.main.url(forResource: "palak-paneer-meal", withExtension: "png") else {
            return nil
        }
        return UIImage(contentsOfFile: url.path)
    }
}

private struct WeekScreen: View {
    @EnvironmentObject private var store: DemoPlanStore
    @State private var selectedMeal: DemoMeal?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(verbatim: "13–19 JULY")
                        .font(.caption.bold())
                        .tracking(1.2)
                        .foregroundStyle(NourishTheme.inkSoft)
                    Text("Your week, at a glance.")
                        .font(.system(.largeTitle, design: .serif, weight: .semibold))
                        .foregroundStyle(NourishTheme.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text("Built around seven planned days and intentional leftovers.")
                        .foregroundStyle(NourishTheme.inkSoft)
                }

                WeekOverviewCard(
                    days: store.days.count,
                    meals: store.days.flatMap(\.meals).count,
                    plannedLeftovers: store.days.flatMap(\.meals).filter(\.intentionalLeftover).count
                )

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(Array(store.days.enumerated()), id: \.element.id) { index, day in
                            Button {
                                store.selectedDayIndex = index
                            } label: {
                                VStack(spacing: 4) {
                                    Text(verbatim: illustrativeDate(day, abbreviated: true)).font(.caption.bold())
                                    Text(verbatim: NourishFormatting.integer(13 + index)).font(.title3.bold())
                                }
                                .frame(width: 54, height: 58)
                                .background(store.selectedDayIndex == index ? NourishTheme.forest : NourishTheme.card)
                                .foregroundStyle(store.selectedDayIndex == index ? .white : .primary)
                                .clipShape(RoundedRectangle(cornerRadius: 16))
                            }
                            .accessibilityLabel(
                                Text(verbatim: "\(illustrativeDate(day, abbreviated: false)), \(NourishFormatting.energyKilocalories(Double(day.plannedCalories)))")
                                    + Text(" planned")
                            )
                        }
                    }
                }

                Text(verbatim: illustrativeDate(store.selectedDay, abbreviated: false))
                    .font(.system(.title2, design: .serif, weight: .semibold))
                    .foregroundStyle(NourishTheme.ink)
                NutritionSummary(day: store.selectedDay)

                ForEach(store.selectedDay.meals) { meal in
                    MealCard(meal: meal, status: store.status(for: meal)) {
                        selectedMeal = meal
                    }
                }

                VarietyCard()
                IllustrativePlanBanner()
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .padding(.bottom, 28)
        }
        .background(NourishTheme.paper)
        .navigationTitle("My week")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $selectedMeal) { meal in
            RecipeDetailSheet(meal: meal)
                .environmentObject(store)
        }
    }
}

private struct WeekOverviewCard: View {
    let days: Int
    let meals: Int
    let plannedLeftovers: Int
    var completed: Int? = nil

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 0) {
                metrics
            }
            VStack(spacing: 12) {
                metrics
            }
        }
        .padding(18)
        .background(NourishTheme.card, in: RoundedRectangle(cornerRadius: 24))
        .shadow(color: NourishTheme.ink.opacity(0.06), radius: 16, y: 8)
    }

    @ViewBuilder
    private var metrics: some View {
        metric(days, "days planned", systemImage: "calendar")
        Divider().padding(.horizontal, 12)
        metric(meals, "planned meals", systemImage: "fork.knife")
        Divider().padding(.horizontal, 12)
        metric(plannedLeftovers, "planned leftovers", systemImage: "arrow.triangle.2.circlepath")
        if let completed {
            Divider().padding(.horizontal, 12)
            metric(completed, "completed", systemImage: "checkmark.circle")
        }
    }

    private func metric(_ value: Int, _ label: LocalizedStringKey, systemImage: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Label {
                Text(verbatim: NourishFormatting.integer(value))
                    .font(.title2.bold())
            } icon: {
                Image(systemName: systemImage)
                    .foregroundStyle(NourishTheme.leaf)
            }
            Text(label)
                .font(.caption)
                .foregroundStyle(NourishTheme.inkSoft)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct IllustrativePlanBanner: View {
    @EnvironmentObject private var activeStore: ActiveWeeklyLoopStore

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if case .loading = activeStore.state { ProgressView() }
            else { Image(systemName: "point.3.connected.trianglepath.dotted") }
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(detail).font(.footnote).foregroundStyle(.secondary)
            }
        }
        .foregroundStyle(NourishTheme.forest)
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NourishTheme.limeSoft, in: RoundedRectangle(cornerRadius: 18))
    }

    private var title: LocalizedStringKey {
        switch activeStore.state {
        case .loading: "Refreshing your plan"
        case .noActivePlan: "Preview plan"
        case .pending, .conflict: "Showing your saved preview"
        case .signedOut: "Preview plan"
        case .synced: "Reviewed plan ready"
        }
    }

    private var detail: LocalizedStringKey {
        switch activeStore.state {
        case .loading: "Your saved week stays visible while FamilyChef refreshes."
        case .noActivePlan: "Explore the experience with sample meals, then create and adopt your own reviewed week."
        case .pending, .conflict: "Your sample week remains available while the planning service reconnects."
        case .signedOut: "Explore with sample meals. Sign in later to restore your own reviewed week."
        case .synced: "Switching to your reviewed plan."
        }
    }
}

private struct GroceryScreen: View {
    @EnvironmentObject private var store: DemoPlanStore

    private var categories: [String] {
        let order = ["Produce", "Dairy", "Protein", "Grains", "Pantry", "Spices", "Other", "Changed by swap"]
        let available = Set(store.groceries.map(\.category))
        return order.filter(available.contains) + available.filter { !order.contains($0) }.sorted()
    }

    private var accountedItemCount: Int {
        store.groceries.filter {
            store.checkedGroceryIDs.contains($0.id) || store.pantryGroceryIDs.contains($0.id)
        }.count
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("WEEKLY SHOP")
                        .font(.caption.bold())
                        .tracking(1.2)
                        .foregroundStyle(NourishTheme.inkSoft)
                    Text("Your grocery list.")
                        .font(.system(.largeTitle, design: .serif, weight: .semibold))
                        .foregroundStyle(NourishTheme.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text("Check off purchases or mark items already at home.")
                        .foregroundStyle(NourishTheme.inkSoft)
                }

                GroceryProgressCard(accounted: accountedItemCount, total: store.groceries.count)

                ForEach(categories, id: \.self) { category in
                    VStack(alignment: .leading, spacing: 10) {
                        localizedDemoLabel(category).textCase(.uppercase)
                            .font(.caption.bold())
                            .foregroundStyle(.secondary)
                        ForEach(store.groceries.filter { $0.category == category }) { item in
                            GroceryRow(item: item)
                        }
                    }
                }

                Label {
                    Text("This preview list is built from the visible week, counts planned leftovers once, and updates when meals change.")
                } icon: {
                    Image(systemName: "info.circle")
                }
                    .font(.footnote)
                    .foregroundStyle(NourishTheme.inkSoft)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(NourishTheme.limeSoft, in: RoundedRectangle(cornerRadius: 18))
            }
            .padding(18)
            .padding(.bottom, 28)
        }
        .background(NourishTheme.paper)
        .navigationTitle("Groceries")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct GroceryProgressCard: View {
    let accounted: Int
    let total: Int

    private var progress: Double {
        guard total > 0 else { return 0 }
        return Double(accounted) / Double(total)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("WEEKLY SHOP")
                        .font(.caption2.bold())
                        .tracking(1.1)
                        .foregroundStyle(Color.white.opacity(0.72))
                    (Text(verbatim: "\(NourishFormatting.integer(accounted)) / \(NourishFormatting.integer(total))")
                        + Text(" accounted for"))
                        .font(.title2.bold())
                }
                Spacer()
                Text(verbatim: NourishFormatting.integer(Int((progress * 100).rounded())) + "%")
                    .font(.headline)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 7)
                    .background(Color.white.opacity(0.14), in: Capsule())
            }
            ProgressView(value: progress)
                .tint(NourishTheme.limeSoft)
                .background(Color.white.opacity(0.16))
            Text("Checked and pantry items both count toward progress.")
                .font(.caption)
                .foregroundStyle(Color.white.opacity(0.72))
        }
        .foregroundStyle(.white)
        .padding(20)
        .background(NourishTheme.forest, in: RoundedRectangle(cornerRadius: 24))
        .shadow(color: NourishTheme.ink.opacity(0.10), radius: 18, y: 9)
    }
}

private struct GroceryRow: View {
    @EnvironmentObject private var store: DemoPlanStore
    let item: DemoGroceryItem

    private var isChecked: Bool { store.checkedGroceryIDs.contains(item.id) }
    private var isPantry: Bool { store.pantryGroceryIDs.contains(item.id) }

    var body: some View {
        HStack(spacing: 12) {
            Button { store.toggleGrocery(item) } label: {
                Image(systemName: isChecked ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(isChecked ? NourishTheme.leaf : .secondary)
            }
            .accessibilityLabel(
                isChecked
                    ? Text("Uncheck ") + Text(verbatim: item.name)
                    : Text("Check ") + Text(verbatim: item.name)
            )

            VStack(alignment: .leading, spacing: 3) {
                Text(item.name)
                    .strikethrough(isChecked || isPantry)
                HStack(spacing: 6) {
                    Text(item.quantity)
                    Text(verbatim: "· \(item.householdDescription)")
                    if item.newlyAddedBySwap || item.changedBySwap {
                        Group {
                            if item.newlyAddedBySwap { Text("NEW") }
                            else { Text("UPDATED") }
                        }
                            .font(.caption2.bold())
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(NourishTheme.amberSoft, in: Capsule())
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                HStack(spacing: 12) {
                    Button { store.adjustQuantity(item, by: -50) } label: {
                        Label("Remove 50 grams", systemImage: "minus.circle")
                            .labelStyle(.iconOnly)
                    }
                    Text("Edit by 50 g").font(.caption2).foregroundStyle(.secondary)
                    Button { store.adjustQuantity(item, by: 50) } label: {
                        Label("Add 50 grams", systemImage: "plus.circle")
                            .labelStyle(.iconOnly)
                    }
                }
            }
            Spacer()
            Button { store.togglePantry(item) } label: {
                Group {
                    if isPantry { Text("In pantry") }
                    else { Text("Have it") }
                }
                    .font(.caption.bold())
                    .padding(.horizontal, 10).padding(.vertical, 7)
                    .background(isPantry ? NourishTheme.limeSoft : Color.secondary.opacity(0.1), in: Capsule())
            }
            .accessibilityLabel(
                isPantry
                    ? Text("Remove ") + Text(verbatim: item.name) + Text(" from pantry")
                    : Text("Mark ") + Text(verbatim: item.name) + Text(" as already available")
            )
        }
        .padding(14)
        .background(NourishTheme.card, in: RoundedRectangle(cornerRadius: 18))
    }
}

private struct PrepScreen: View {
    @EnvironmentObject private var store: DemoPlanStore

    private var prepDays: [String] {
        store.prepTasks.reduce(into: [String]()) { result, task in
            if !result.contains(task.day) { result.append(task.day) }
        }
    }

    private var firstIncompleteTask: DemoPrepTask? {
        store.prepTasks.first { !store.completedPrepIDs.contains($0.id) }
    }

    private var totalActiveMinutes: Int { store.prepTasks.reduce(0) { $0 + $1.activeMinutes } }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Sunday prep")
                            .textCase(.uppercase)
                            .font(.caption.bold())
                            .tracking(1.2)
                            .foregroundStyle(NourishTheme.inkSoft)
                        Text("Set up an easier week.")
                            .font(.system(.largeTitle, design: .serif, weight: .semibold))
                            .foregroundStyle(NourishTheme.ink)
                            .accessibilityAddTraits(.isHeader)
                        (Text(verbatim: NourishFormatting.durationMinutes(Double(totalActiveMinutes)))
                            + Text(" active time now makes the week easier."))
                            .foregroundStyle(NourishTheme.inkSoft)
                    }

                    if let firstIncompleteTask {
                        PrepPriorityCard(
                            title: firstIncompleteTask.title,
                            detail: firstIncompleteTask.reuseNote,
                            activeMinutes: firstIncompleteTask.activeMinutes,
                            completed: store.completedPrepIDs.count,
                            total: store.prepTasks.count
                        ) {
                            withAnimation { proxy.scrollTo(firstIncompleteTask.id, anchor: .center) }
                        }
                    } else {
                        PrepCompleteCard(total: store.prepTasks.count)
                    }

                    sectionTitle(
                        "Your prep flow",
                        subtitle: store.completedPrepIDs.count == store.prepTasks.count
                            ? "Everything is ready"
                            : "Complete one small win at a time"
                    )

                    ForEach(prepDays, id: \.self) { day in
                        VStack(alignment: .leading, spacing: 12) {
                            localizedDemoLabel(day).textCase(.uppercase).font(.caption.bold()).foregroundStyle(.secondary)
                            ForEach(store.prepTasks.filter { $0.day == day }) { task in
                                PrepTaskRow(task: task)
                                    .id(task.id)
                            }
                        }
                    }
                }
                .padding(18)
                .padding(.bottom, 28)
            }
        }
        .background(NourishTheme.paper)
        .navigationTitle("Prep")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct PrepPriorityCard: View {
    let title: String
    let detail: String
    let activeMinutes: Int
    let completed: Int
    let total: Int
    let revealTask: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 15) {
                ZStack {
                    Circle().stroke(Color.white.opacity(0.24), lineWidth: 7)
                    Circle()
                        .trim(from: 0, to: progress)
                        .stroke(NourishTheme.limeSoft, style: StrokeStyle(lineWidth: 7, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                    VStack(spacing: 0) {
                        Text(verbatim: NourishFormatting.integer(activeMinutes)).font(.title3.bold())
                        Text("min").font(.caption2)
                    }
                }
                .frame(width: 78, height: 78)

                VStack(alignment: .leading, spacing: 5) {
                    Text("START HERE")
                        .font(.caption2.bold())
                        .tracking(1.1)
                        .foregroundStyle(Color.white.opacity(0.70))
                    Text(verbatim: title)
                        .font(.system(.title2, design: .serif, weight: .semibold))
                    Text(verbatim: detail)
                        .font(.subheadline)
                        .foregroundStyle(Color.white.opacity(0.76))
                }
            }

            Button(action: revealTask) {
                Label("Show first task", systemImage: "arrow.down")
                    .font(.subheadline.bold())
                    .foregroundStyle(NourishTheme.ink)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .background(.white, in: RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)
        }
        .foregroundStyle(.white)
        .padding(20)
        .background(NourishTheme.forest, in: RoundedRectangle(cornerRadius: 26))
        .shadow(color: NourishTheme.ink.opacity(0.12), radius: 20, y: 10)
        .accessibilityElement(children: .contain)
    }

    private var progress: Double {
        guard total > 0 else { return 0 }
        return Double(completed) / Double(total)
    }
}

private struct PrepCompleteCard: View {
    let total: Int

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "checkmark.circle.fill")
                .font(.largeTitle)
            VStack(alignment: .leading, spacing: 4) {
                Text("All prep done").font(.headline)
                (Text(verbatim: NourishFormatting.integer(total)) + Text(" small wins completed"))
                    .font(.subheadline)
                    .foregroundStyle(NourishTheme.inkSoft)
            }
        }
        .foregroundStyle(NourishTheme.forest)
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NourishTheme.limeSoft, in: RoundedRectangle(cornerRadius: 22))
    }
}

private struct PrepTaskRow: View {
    @EnvironmentObject private var store: DemoPlanStore
    let task: DemoPrepTask

    private var isComplete: Bool { store.completedPrepIDs.contains(task.id) }

    var body: some View {
        Button { store.togglePrep(task) } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: isComplete ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(isComplete ? NourishTheme.leaf : .secondary)
                VStack(alignment: .leading, spacing: 7) {
                    HStack {
                        Text(task.title).font(.headline)
                        Spacer()
                        Text(verbatim: NourishFormatting.durationMinutes(Double(task.activeMinutes)))
                            .font(.caption.bold()).foregroundStyle(.secondary)
                    }
                    Label { Text(verbatim: task.storageNote) } icon: { Image(systemName: "snowflake") }
                    Label { Text(verbatim: task.reuseNote) } icon: { Image(systemName: "arrow.triangle.2.circlepath") }
                }
                .font(.subheadline)
                .multilineTextAlignment(.leading)
            }
            .foregroundStyle(.primary)
            .padding(16)
            .background(NourishTheme.card, in: RoundedRectangle(cornerRadius: 20))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            (isComplete ? Text("Completed") : Text("Not completed"))
                + Text(verbatim: ", \(task.title), \(NourishFormatting.durationMinutes(Double(task.activeMinutes)))")
        )
    }
}

private struct NutritionSummary: View {
    let day: DemoDay

    private var progress: Double {
        min(Double(day.plannedCalories) / Double(day.calorieTarget), 1)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(verbatim: NourishFormatting.integer(day.plannedCalories)).font(.title.bold())
                (Text(verbatim: "/ \(NourishFormatting.energyKilocalories(Double(day.calorieTarget)))") + Text(" estimated"))
                    .font(.subheadline).foregroundStyle(.secondary)
                Spacer()
                (Text(verbatim: NourishFormatting.massGrams(Double(day.plannedProtein))) + Text(" protein"))
                    .font(.subheadline.bold())
            }
            ProgressView(value: progress).tint(NourishTheme.leaf)
            Text("Target is for general wellness and is not medical advice.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(18)
        .background(NourishTheme.card, in: RoundedRectangle(cornerRadius: 22))
    }
}

private struct MealCard: View {
    let meal: DemoMeal
    let status: DemoMealStatus
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    localizedDemoLabel(meal.slot).textCase(.uppercase).font(.caption.bold()).foregroundStyle(.secondary)
                    Spacer()
                    if status != .planned {
                        Text(status.localizedTitle).font(.caption.bold())
                            .padding(.horizontal, 9).padding(.vertical, 5)
                            .background(NourishTheme.limeSoft, in: Capsule())
                    }
                }
                Text(meal.name).font(.title3.bold())
                nutritionAndTimeSummary(
                    calories: Double(meal.calories),
                    proteinGrams: Double(meal.protein),
                    activeMinutes: meal.activeMinutes
                )
                    .font(.subheadline).foregroundStyle(.secondary)
                if meal.intentionalLeftover {
                    Label {
                        Text("Planned leftover from ") + Text(verbatim: meal.sourceMealName ?? String(localized: "an earlier meal"))
                    } icon: {
                        Image(systemName: "arrow.triangle.2.circlepath")
                    }
                        .font(.caption.bold())
                        .foregroundStyle(NourishTheme.forest)
                }
                Divider().padding(.top, 3)
                HStack(spacing: 8) {
                    Text("View recipe & options")
                        .font(.subheadline.bold())
                        .foregroundStyle(NourishTheme.forest)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption.bold())
                        .foregroundStyle(NourishTheme.forest)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(18)
            .background(meal.intentionalLeftover ? NourishTheme.limeSoft : NourishTheme.card, in: RoundedRectangle(cornerRadius: 22))
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens recipe detail and safe swap options")
    }
}

private struct VarietyCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Variety guard active", systemImage: "sparkles")
                .font(.headline)
            Text("No fresh recipe repeats this week. Tuesday’s palak paneer is the only exact repeat and is explicitly planned from Monday dinner.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(18)
        .background(NourishTheme.amberSoft, in: RoundedRectangle(cornerRadius: 22))
    }
}

private struct RecipeDetailSheet: View {
    @EnvironmentObject private var store: DemoPlanStore
    @Environment(\.dismiss) private var dismiss
    @State private var showingSwaps = false
    let meal: DemoMeal

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    RecipeDetailHero(meal: meal)

                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 118), spacing: 10)], spacing: 10) {
                        RecipeNutrient(label: "Calories", value: NourishFormatting.integer(meal.calories))
                        RecipeNutrient(label: "Protein", value: NourishFormatting.massGrams(Double(meal.protein)))
                        RecipeNutrient(label: "Carbs", value: NourishFormatting.massGrams(Double(meal.carbs)))
                        RecipeNutrient(label: "Fat", value: NourishFormatting.massGrams(Double(meal.fat)))
                    }

                    if meal.intentionalLeftover {
                        Label {
                            Text("Intentional leftover from ")
                                + Text(verbatim: meal.sourceMealName ?? String(localized: "an earlier meal"))
                        } icon: {
                            Image(systemName: "arrow.triangle.2.circlepath")
                        }
                            .font(.subheadline.bold())
                            .foregroundStyle(NourishTheme.forest)
                            .padding()
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(NourishTheme.limeSoft, in: RoundedRectangle(cornerRadius: 16))
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        Label("Meal options", systemImage: "arrow.left.arrow.right")
                            .font(.headline)
                            .foregroundStyle(NourishTheme.forest)
                        Text("Choose a safe replacement or update what happened with this meal.")
                            .font(.subheadline)
                            .foregroundStyle(NourishTheme.inkSoft)
                        Button { showingSwaps = true } label: {
                            Label("Find another meal", systemImage: "magnifyingglass")
                                .font(.subheadline.bold())
                                .frame(maxWidth: .infinity, minHeight: 48)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(NourishTheme.forest)

                        Menu {
                            ForEach(DemoMealStatus.allCases) { status in
                                Button(status.localizedTitle) { store.setStatus(status, for: meal) }
                            }
                        } label: {
                            HStack {
                                Label("Update meal status", systemImage: "checkmark.circle")
                                Spacer()
                                Image(systemName: "chevron.down")
                                    .font(.caption.bold())
                            }
                            .frame(maxWidth: .infinity, minHeight: 46)
                        }
                        .buttonStyle(.bordered)
                        .tint(NourishTheme.forest)
                    }
                    .padding(18)
                    .background(NourishTheme.limeSoft, in: RoundedRectangle(cornerRadius: 22))

                    detailSection("Ingredients") {
                        ForEach(meal.ingredients, id: \.self) { Text(verbatim: "• \($0)") }
                    }
                    detailSection("Method") {
                        ForEach(Array(meal.method.enumerated()), id: \.offset) { index, step in
                            Text(verbatim: "\(NourishFormatting.integer(index + 1)). \(step)")
                        }
                    }
                    detailSection("Allergens") {
                        if meal.allergens.isEmpty {
                            Text("No declared allergens in this illustrative record.")
                        } else {
                            Text(verbatim: meal.allergens.joined(separator: ", "))
                        }
                    }

                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: 8) {
                            (Text("Version ")
                                + Text(verbatim: NourishFormatting.integer(meal.catalogueVersion))
                                + Text(verbatim: " · ")
                                + Text(meal.publicationStatus.localizedLabel)
                                + Text(verbatim: " · ")
                                + Text("nutrition review ")
                                + Text(meal.reviewStatus.localizedLabel))
                                .font(.subheadline.bold())
                            Text(meal.nutritionSourceSummary)
                                .font(.footnote).foregroundStyle(.secondary)
                            Text("Only an authorized published version with licensed nutrient evidence may enter production plans.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        .padding(.top, 8)
                    } label: {
                        Label("Recipe review & nutrition source", systemImage: "checkmark.seal")
                            .font(.headline)
                    }
                    .padding(16)
                    .background(NourishTheme.amberSoft, in: RoundedRectangle(cornerRadius: 18))
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 28)
            }
            .background(NourishTheme.paper)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .sheet(isPresented: $showingSwaps) {
                SwapSheet(original: meal)
                    .environmentObject(store)
            }
        }
    }
}

private struct RecipeDetailHero: View {
    let meal: DemoMeal

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            MealArtwork(recipeID: meal.recipeID, height: 310)
            LinearGradient(
                colors: [Color.black.opacity(0.02), Color.black.opacity(0.18), Color.black.opacity(0.86)],
                startPoint: .top,
                endPoint: .bottom
            )
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    localizedDemoLabel(meal.slot)
                        .textCase(.uppercase)
                        .font(.caption.bold())
                        .tracking(1.1)
                    Spacer()
                    Label("Vegetarian", systemImage: "leaf.fill")
                        .font(.caption.bold())
                }
                Text(meal.name)
                    .font(.system(size: 34, weight: .semibold, design: .serif))
                (Text("1 serving · ")
                    + Text(verbatim: NourishFormatting.durationMinutes(Double(meal.activeMinutes)))
                    + Text(" active · ")
                    + Text(verbatim: meal.cuisine))
                    .font(.subheadline)
                    .foregroundStyle(Color.white.opacity(0.78))
            }
            .foregroundStyle(.white)
            .padding(20)
        }
        .frame(height: 310)
        .clipShape(RoundedRectangle(cornerRadius: 28))
        .shadow(color: NourishTheme.ink.opacity(0.12), radius: 22, y: 10)
    }
}

private struct RecipeNutrient: View {
    let label: LocalizedStringKey
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: value).font(.title3.bold())
            Text(label).font(.caption).foregroundStyle(NourishTheme.inkSoft)
        }
        .frame(maxWidth: .infinity, minHeight: 66, alignment: .leading)
        .padding(.horizontal, 14)
        .background(NourishTheme.card, in: RoundedRectangle(cornerRadius: 16))
    }
}

private struct SwapSheet: View {
    @EnvironmentObject private var store: DemoPlanStore
    @Environment(\.dismiss) private var dismiss
    let original: DemoMeal

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("SAFE REPLACEMENT")
                        .font(.caption.bold())
                        .tracking(1.2)
                        .foregroundStyle(NourishTheme.inkSoft)
                    Text("Choose another meal.")
                        .font(.system(.largeTitle, design: .serif, weight: .semibold))
                        .foregroundStyle(NourishTheme.ink)
                    (Text("Replacing ") + Text(verbatim: original.name))
                        .font(.subheadline)
                        .foregroundStyle(NourishTheme.inkSoft)
                    Label("Every option keeps your diet, allergen, exclusion, and weekly variety rules in place.", systemImage: "checkmark.shield.fill")
                        .font(.subheadline)
                        .foregroundStyle(NourishTheme.forest)
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(NourishTheme.limeSoft, in: RoundedRectangle(cornerRadius: 16))

                    ForEach(store.swapCandidates(for: original)) { candidate in
                        VStack(alignment: .leading, spacing: 10) {
                            Label("Fits your plan", systemImage: "checkmark.shield")
                                .font(.caption.bold())
                                .foregroundStyle(NourishTheme.forest)
                            Text(candidate.meal.name)
                                .font(.system(.title2, design: .serif, weight: .semibold))
                                .foregroundStyle(NourishTheme.ink)
                            (Text(verbatim: "\(candidate.meal.cuisine) · \(NourishFormatting.durationMinutes(Double(candidate.meal.activeMinutes)))")
                                + Text(" active"))
                                .font(.subheadline).foregroundStyle(.secondary)
                            ViewThatFits(in: .horizontal) {
                                HStack(spacing: 10) {
                                    delta(label: "Calories", value: candidate.meal.calories - original.calories, suffix: " kcal")
                                    delta(label: "Protein", value: candidate.meal.protein - original.protein, suffix: "g")
                                }
                                VStack(spacing: 10) {
                                    delta(label: "Calories", value: candidate.meal.calories - original.calories, suffix: " kcal")
                                    delta(label: "Protein", value: candidate.meal.protein - original.protein, suffix: "g")
                                }
                            }
                            Button {
                                store.applySwap(replacing: original, with: candidate)
                                dismiss()
                            } label: {
                                Label("Choose this replacement", systemImage: "checkmark")
                                    .frame(maxWidth: .infinity, minHeight: 44)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(NourishTheme.forest)
                            .accessibilityIdentifier("swap.demo.confirm.\(candidate.id)")
                        }
                        .padding(18)
                        .background(NourishTheme.card, in: RoundedRectangle(cornerRadius: 22))
                        .shadow(color: NourishTheme.ink.opacity(0.05), radius: 12, y: 6)
                    }
                }
                .padding(20)
            }
            .background(NourishTheme.paper)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }

    private func delta(label: LocalizedStringKey, value: Int, suffix: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(verbatim: "\(value >= 0 ? "+" : "")\(NourishFormatting.integer(value))\(suffix)").font(.headline)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(NourishTheme.limeSoft, in: RoundedRectangle(cornerRadius: 14))
    }
}

private struct ProfilePreview: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var authenticationStore: AuthenticationStore
    @EnvironmentObject private var profileStore: AppProfileStore
    @EnvironmentObject private var reminderStore: LifecycleReminderStore
    @EnvironmentObject private var accountStore: AccountLifecycleStore
    @AppStorage("nourish.analytics.measurement-enabled") private var analyticsMeasurementEnabled = false
    @State private var showingProfileEditor = false
    @State private var showingReminderSettings = false
    @State private var showingManageSubscriptions = false
    @State private var showingSubscriptionPurchase = false
    @State private var showingDeleteAccount = false
    @State private var showingSupport = false
    @State private var showingLegal = false
    @State private var subscriptionMessage: String?
    let profile: UserProfile?
    let onRestartOnboarding: () -> Void

    var body: some View {
        NavigationStack {
            List {
                Section("Plan profile") {
                    LabeledContent("Diet") {
                        if let profile { Text(profile.diet.localizedLabel) }
                        else { Text("Preview vegetarian") }
                    }
                    LabeledContent("Daily target") {
                        if let profile {
                            Text(verbatim: NourishFormatting.energyKilocalories(Double(profile.calorieTarget)))
                        } else {
                            Text(verbatim: NourishFormatting.energyKilocalories(1_700)) + Text(" preview")
                        }
                    }
                    LabeledContent("Cooking days") {
                        if let profile {
                            Text(verbatim: NourishFormatting.integer(profile.cookingDays.count)) + Text(" per week")
                        } else {
                            Text("Preview profile")
                        }
                    }
                    LabeledContent("Leftovers") {
                        if let profile { Text(profile.leftoverPreference.localizedLabel) }
                        else { Text("Planned") }
                    }
                    if profile != nil {
                        Button("Edit planning preferences") { showingProfileEditor = true }
                            .accessibilityIdentifier("settings.edit-planning")
                    }
                }
                Section("Plan rhythm & reminders") {
                    LabeledContent("Plan starts") {
                        Text(verbatim: settingsWeekday(reminderStore.settings.planStartWeekday))
                    }
                    LabeledContent("Scheduled reminders") {
                        Text(verbatim: NourishFormatting.integer(reminderStore.scheduledCount))
                    }
                    if profile != nil {
                        Button("Manage reminders") { showingReminderSettings = true }
                            .accessibilityIdentifier("settings.manage-reminders")
                    } else {
                        Text("Complete onboarding before scheduling plan-aware reminders.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                Section("Account") {
                    if let identity = authenticationStore.identity {
                        LabeledContent("Signed in") {
                            Text(verbatim: identity.verifiedEmail ?? identity.userID)
                        }
                        Label("Session tokens stored in Keychain", systemImage: "lock.shield")
                        profileSyncStatus
                        Text("Queued profile, grocery, meal, and prep changes retry when the app becomes active and through iOS Background App Refresh.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Button("Sign out", role: .destructive) {
                            Task { await authenticationStore.signOut() }
                        }
                        Button("Request portable data export") {
                            Task { _ = await accountStore.requestExport() }
                        }
                        .disabled(accountStore.state == .requestingExport)
                        if let receipt = accountStore.exportReceipt {
                            Label {
                                Text("Export ") + Text(verbatim: "\(receipt.status): \(receipt.requestID)")
                            } icon: {
                                Image(systemName: "archivebox")
                            }
                                .font(.footnote)
                                .textSelection(.enabled)
                        }
                        Button("Delete FamilyChef account", role: .destructive) { showingDeleteAccount = true }
                    } else {
                        LabeledContent("Mode") { Text("Local preview") }
                        Label("Profile stored with iOS file protection", systemImage: "lock.shield")
                        Text("Plans are not synced to another device until a real Apple or email session is connected to the backend.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                Section("Nutrition methodology") {
                    Label("Ingredient quantities use household units and grams", systemImage: "scalemass")
                    Label("Per-100g records retain source, version, review, and licensing status", systemImage: "doc.text.magnifyingglass")
                    Label("Only immutable reviewed versions may enter production plans", systemImage: "checkmark.seal")
                    Text("Nutrition values remain estimates for general wellness. Meals in this development build are illustrative drafts, not approved production nutrition.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Section("Planner engine") {
                    Label("Published and reviewed recipes only", systemImage: "checkmark.shield")
                    Label("Hard exclusions run before favorites or preferences", systemImage: "exclamationmark.shield")
                    Label("Stable seed, explicit leftovers, locked-meal revalidation, and diagnostics", systemImage: "list.bullet.clipboard")
                    Text("The visible development week remains illustrative until the production catalogue has sufficient licensed content.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Section("Subscription") {
                    if let entitlement = accountStore.entitlement {
                        LabeledContent("Server state") {
                            Text(entitlement.state.displayTitle)
                        }
                        LabeledContent("Access") {
                            if entitlement.hasAccess { Text("Available") }
                            else { Text("Not verified") }
                        }
                        LabeledContent("Reconciliation") {
                            localizedReconciliationStatus(entitlement.reconciliationStatus)
                        }
                        if let lastVerifiedAt = entitlement.lastVerifiedAt {
                            LabeledContent("Last verified") {
                                Text(verbatim: lastVerifiedAt.formatted(date: .abbreviated, time: .shortened))
                            }
                        }
                    } else if authenticationStore.identity != nil {
                        LabeledContent("Server state") { Text("Checking") }
                    }
                    Button("View FamilyChef plans") { showingSubscriptionPurchase = true }
                        .disabled(authenticationStore.identity == nil)
                    Button("Restore App Store purchases") {
                        Task {
                            do {
                                _ = try await accountStore.prepareAppStorePurchase()
                                try await AppStore.sync()
                                var verifiedTransactions = 0
                                for await result in Transaction.currentEntitlements {
                                    guard case .verified = result else { continue }
                                    try await accountStore.bindAppStoreTransaction(
                                        signedTransactionInfo: result.jwsRepresentation
                                    )
                                    verifiedTransactions += 1
                                }
                                await accountStore.refreshEntitlement()
                                subscriptionMessage = verifiedTransactions > 0
                                    ? "Purchase history was verified by Apple and linked to this FamilyChef account."
                                    : "Purchase history synchronized. No current subscription entitlement was found."
                            } catch {
                                subscriptionMessage = "The App Store purchase could not be verified for this FamilyChef account right now. Existing server access is unchanged."
                            }
                        }
                    }
                    Button("Manage App Store subscription") { showingManageSubscriptions = true }
                    if let subscriptionMessage {
                        localizedRuntimeMessage(subscriptionMessage).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                Section("Legal & support") {
                    Button("Privacy, terms & wellness") { showingLegal = true }
                    Button("Create support request") { showingSupport = true }
                    Text("Anonymized diagnostic context is attached only after explicit confirmation.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("Privacy & measurement") {
                    Toggle("Share first-party product usage", isOn: $analyticsMeasurementEnabled)
                        .accessibilityIdentifier("settings.analytics-consent")
                    Text("Off by default. When enabled, FamilyChef records only named product events with bounded properties. It does not include email, profile answers, meal history, free text, advertising identifiers, or device fingerprints.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Section {
                    Button("Replay onboarding") {
                        dismiss()
                        onRestartOnboarding()
                    }
                } footer: {
                    Text("Final counsel-approved legal documents, launch support contact, live StoreKit products, and Apple server credentials remain deployment work.")
                }
            }
            .navigationTitle("Profile & settings")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .onAppear(perform: openDevelopmentSettingsDestinationIfRequested)
            .sheet(isPresented: $showingProfileEditor) {
                if let profile {
                    ProfileEditorView(
                        profile: profile,
                        initialScope: profileStore.storedProfile?.effectiveScope ?? .nextPlanOnly
                    )
                }
            }
            .sheet(isPresented: $showingReminderSettings) {
                if let profile {
                    ReminderSettingsView(profile: profile, settings: reminderStore.settings)
                }
            }
            .manageSubscriptionsSheet(isPresented: $showingManageSubscriptions)
            .sheet(isPresented: $showingSubscriptionPurchase) {
                SubscriptionPurchaseView(accountStore: accountStore)
            }
            .sheet(isPresented: $showingDeleteAccount) {
                DeleteAccountView(onDeleted: {
                    dismiss()
                    onRestartOnboarding()
                })
            }
            .sheet(isPresented: $showingSupport) { SupportRequestView() }
            .sheet(isPresented: $showingLegal) { LegalInformationView() }
        }
    }

    private func openDevelopmentSettingsDestinationIfRequested() {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("-NourishOpenProfileEditor") {
            showingProfileEditor = true
        } else if arguments.contains("-NourishOpenSupport") {
            showingSupport = true
        } else if arguments.contains("-NourishOpenLegal") {
            showingLegal = true
        }
        #endif
    }

    private func settingsWeekday(_ weekday: Int) -> String {
        let names = Calendar.current.weekdaySymbols
        guard names.indices.contains(weekday - 1) else { return String(localized: "Not set") }
        return names[weekday - 1]
    }

    @ViewBuilder
    private var profileSyncStatus: some View {
        switch profileStore.syncState {
        case .localOnly:
            Label("Profile available on this device", systemImage: "iphone")
        case .syncing:
            HStack {
                ProgressView()
                Text("Synchronizing profile…")
            }
        case .synced:
            Label("Profile synchronized", systemImage: "checkmark.icloud")
                .foregroundStyle(NourishTheme.forest)
        case let .pending(message):
            Label {
                localizedRuntimeMessage(message)
            } icon: {
                Image(systemName: "icloud.slash")
            }
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }
}

private extension EntitlementState {
    var displayTitle: LocalizedStringKey {
        switch self {
        case .active: "Active"
        case .trial: "Trial"
        case .graceOrBillingRetry: "Grace / billing retry"
        case .expired: "Expired"
        case .revokedOrRefunded: "Revoked / refunded"
        case .upgraded: "Upgraded"
        case .downgraded: "Downgraded"
        case .unknown: "Unknown"
        }
    }
}

private func sectionTitle(_ title: LocalizedStringKey, subtitle: LocalizedStringKey) -> some View {
    VStack(alignment: .leading, spacing: 3) {
        Text(title).font(.title2.bold())
        Text(subtitle).font(.caption).foregroundStyle(.secondary)
    }
}

private func detailSection<Content: View>(_ title: LocalizedStringKey, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 10) {
        Text(title).textCase(.uppercase).font(.caption.bold()).foregroundStyle(.secondary)
        content()
    }
}

private extension MealCompletionState {
    var activeTitle: LocalizedStringKey {
        switch self {
        case .planned: "Planned"
        case .completed: "Completed"
        case .skipped: "Skipped"
        case .replacedOutsideApp: "Replaced outside app"
        case .moved: "Moved"
        }
    }
}

private extension PlanSlot {
    var localizedTitle: LocalizedStringKey {
        switch self {
        case .breakfast: "Breakfast"
        case .lunch: "Lunch"
        case .dinner: "Dinner"
        case .snack: "Snack"
        }
    }
}

private extension GroceryCategory {
    var localizedTitle: LocalizedStringKey {
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

private extension MealFeedbackReason {
    var localizedDisplayName: LocalizedStringKey {
        switch self {
        case .taste: "Taste"
        case .effort: "Effort"
        case .cost: "Cost"
        case .portion: "Portion"
        case .ingredientAvailability: "Ingredients"
        }
    }
}

private extension WeeklyReviewChange {
    var localizedDisplayName: LocalizedStringKey {
        switch self {
        case .moreVariety: "More variety"
        case .lessEffort: "Less effort"
        case .lowerCost: "Lower cost"
        case .differentCuisines: "Different cuisines"
        case .adjustPortions: "Adjust portions"
        }
    }
}

private extension DemoMealStatus {
    var localizedTitle: LocalizedStringKey {
        switch self {
        case .planned: "Planned"
        case .completed: "Completed"
        case .skipped: "Skipped"
        case .replacedOutside: "Replaced outside app"
        case .moved: "Moved"
        }
    }
}

private func localizedDemoLabel(_ value: String) -> Text {
    switch value.lowercased() {
    case "breakfast": Text("Breakfast")
    case "lunch": Text("Lunch")
    case "dinner": Text("Dinner")
    case "produce": Text("Produce")
    case "dairy": Text("Dairy")
    case "protein": Text("Protein")
    case "grains": Text("Grains")
    case "pantry": Text("Pantry")
    case "spices": Text("Spices")
    case "changed by swap": Text("Changed by swap")
    case "sunday setup": Text("Sunday setup")
    default: Text(verbatim: value)
    }
}

private func illustrativeDate(_ day: DemoDay, abbreviated: Bool) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    guard let date = calendar.date(from: DateComponents(year: 2026, month: 7, day: 13 + day.id)) else {
        return day.displayDate
    }
    if abbreviated {
        return date.formatted(.dateTime.weekday(.abbreviated))
    }
    return date.formatted(.dateTime.weekday(.wide).day().month(.wide))
}

private func activeDate(_ localDate: LocalDate) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    guard let date = calendar.date(from: DateComponents(year: localDate.year, month: localDate.month, day: localDate.day)) else {
        return "\(localDate.year)-\(localDate.month)-\(localDate.day)"
    }
    return date.formatted(.dateTime.weekday(.wide).day().month(.wide))
}

private func activeWeekday(_ localDate: LocalDate) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    guard let date = calendar.date(from: DateComponents(year: localDate.year, month: localDate.month, day: localDate.day)) else { return "Day" }
    return date.formatted(.dateTime.weekday(.abbreviated))
}

private func activeDay(in plan: WeeklyPlan, now: Date = .now) -> PlanDay? {
    guard !plan.days.isEmpty else { return nil }
    var calendar = Calendar(identifier: .gregorian)
    guard let timeZone = TimeZone(identifier: plan.timeZoneIdentifier) else { return plan.days.first }
    calendar.timeZone = timeZone
    let components = calendar.dateComponents([.year, .month, .day], from: now)
    if let year = components.year, let month = components.month, let day = components.day {
        let today = LocalDate(year: year, month: month, day: day)
        if let matchingDay = plan.days.first(where: { $0.localDate == today }) {
            return matchingDay
        }
    }
    return plan.days.first
}

private func decimalText(_ value: Decimal) -> String {
    NourishFormatting.decimal(value)
}

private func decimalDouble(_ value: Decimal) -> Double {
    NSDecimalNumber(decimal: value).doubleValue
}

private func signedDecimal(_ value: Decimal) -> String {
    let text = decimalText(value)
    return value >= 0 ? "+\(text)" : text
}

private func nutritionAndTimeSummary(
    calories: Double,
    proteinGrams: Double,
    activeMinutes: Int
) -> Text {
    Text(verbatim: NourishFormatting.energyKilocalories(calories))
        + Text(verbatim: " · ")
        + Text(verbatim: NourishFormatting.massGrams(proteinGrams))
        + Text(" protein · ")
        + Text(verbatim: NourishFormatting.durationMinutes(Double(activeMinutes)))
        + Text(" active")
}

private func swapDeltaSummary(calories: Decimal, proteinGrams: Decimal) -> Text {
    Text(verbatim: "\(signedDecimal(calories)) kcal · \(signedDecimal(proteinGrams)) g")
        + Text(" protein")
}

private func macroSummary(_ nutrition: Nutrition) -> Text {
    Text(verbatim: NourishFormatting.energyKilocalories(decimalDouble(nutrition.calories)))
        + Text(verbatim: " · ")
        + Text(verbatim: NourishFormatting.massGrams(decimalDouble(nutrition.proteinGrams)))
        + Text(" protein · ")
        + Text(verbatim: NourishFormatting.massGrams(decimalDouble(nutrition.carbohydrateGrams)))
        + Text(" carbs · ")
        + Text(verbatim: NourishFormatting.massGrams(decimalDouble(nutrition.fatGrams)))
        + Text(" fat estimated")
}
