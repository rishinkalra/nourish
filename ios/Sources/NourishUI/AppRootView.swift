import SwiftUI
import NourishAPI
import NourishCore
import UserNotifications

public struct AppRootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("nourish.onboarding.complete") private var onboardingComplete = false
    @AppStorage("nourish.install.acquisition-source") private var acquisitionSourceRaw = AnalyticsAcquisitionSource.unknown.rawValue
    @AppStorage("nourish.analytics.measurement-enabled") private var analyticsMeasurementEnabled = false
    @StateObject private var profileStore = AppProfileStore()
    @StateObject private var authenticationStore: AuthenticationStore
    @StateObject private var weeklyLoopStore = ActiveWeeklyLoopStore()
    @StateObject private var planGenerationStore = PlanGenerationStore()
    @StateObject private var reminderStore = LifecycleReminderStore()
    @StateObject private var routeStore = AppRouteStore()
    @StateObject private var accountStore = AccountLifecycleStore()
    @StateObject private var featureFlagStore = FeatureFlagStore()
    @StateObject private var analyticsDimensionStore = AnalyticsDimensionStore()
    @StateObject private var analyticsEventStore = AnalyticsEventStore()
    @State private var showingPersistenceError = false
    @State private var showingAuthenticationSuccess = false
    @State private var onboardingEntryPoint = "app_launch"

    public init(baseURL: URL = URL(string: "http://localhost:8080")!) {
        _authenticationStore = StateObject(wrappedValue: AuthenticationStore(baseURL: baseURL))
    }

    public var body: some View {
        rootContent
            .environmentObject(authenticationStore)
            .environmentObject(profileStore)
            .environmentObject(weeklyLoopStore)
            .environmentObject(planGenerationStore)
            .environmentObject(reminderStore)
            .environmentObject(routeStore)
            .environmentObject(accountStore)
            .environmentObject(featureFlagStore)
            .environmentObject(analyticsEventStore)
            .task {
                BackgroundSyncCoordinator.shared.configure(operation: performBackgroundSync)
                await profileStore.restore()
                await authenticationStore.restore()
                await reminderStore.configure()
                #if DEBUG
                await installDevelopmentFixturesIfRequested()
                #endif
                updateBackgroundSyncSchedule()
            }
            .onOpenURL(perform: openURL)
            .onReceive(NotificationCenter.default.publisher(for: .nourishNotificationOpened)) { notification in
                if let opened = notification.object as? NourishNotificationOpen {
                    _ = routeStore.handle(opened.url)
                    Task {
                        await analyticsEventStore.record(
                            .notificationOpened,
                            properties: [
                                "template_id": .string(opened.templateID),
                                "destination": .string(opened.destination),
                            ]
                        )
                    }
                } else if let url = notification.object as? URL {
                    _ = routeStore.handle(url)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .nourishPushDeviceTokenUpdated)) { _ in
                Task { await synchronizePushRegistrationIfAuthorized() }
            }
            .onChange(of: authenticationStore.state, authenticationStateChanged)
            .onChange(of: profileStore.failureMessage, profileFailureChanged)
            .onChange(of: profileStore.syncState) { _, _ in updateBackgroundSyncSchedule() }
            .onChange(of: weeklyLoopStore.state) { _, _ in updateBackgroundSyncSchedule() }
            .onChange(of: analyticsMeasurementEnabled, analyticsMeasurementChanged)
            .onChange(of: scenePhase, scenePhaseChanged)
            .alert("Profile not saved", isPresented: $showingPersistenceError) {
                Button("OK", role: .cancel) {}
            } message: {
                if let failureMessage = profileStore.failureMessage {
                    localizedRuntimeMessage(failureMessage)
                } else {
                    Text("Please try again.")
                }
            }
            .alert("Signed in securely", isPresented: $showingAuthenticationSuccess) {
                Button("Continue", role: .cancel) {}
            } message: {
                if let email = authenticationStore.identity?.verifiedEmail {
                    Text(verbatim: email)
                } else {
                    Text("Your Nourish session is stored in Keychain.")
                }
            }
    }

    @ViewBuilder
    private var rootContent: some View {
        Group {
            if shouldPresentMainApp {
                MainAppView(
                    profile: profileStore.storedProfile?.profile,
                    onRestartOnboarding: {
                        onboardingEntryPoint = "settings_restart"
                        onboardingComplete = false
                    }
                )
            } else {
                OnboardingFlowView(
                    entryPoint: onboardingEntryPoint,
                    onComplete: persistOnboardingProfile
                )
            }
        }
    }

    private var shouldPresentMainApp: Bool {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("-NourishUITestOnboarding") { return false }
        if arguments.contains("-NourishUITestMain") { return true }
        #endif
        return onboardingComplete
    }

    private func openURL(_ url: URL) {
        captureAcquisition(from: url)
        if routeStore.handle(url) { return }
        Task { await authenticationStore.handleMagicLink(url) }
    }

    private func authenticationStateChanged(
        _ oldState: AuthenticationStore.State,
        _ newState: AuthenticationStore.State
    ) {
        switch newState {
        case .authenticated:
            Task {
                await profileStore.connect(to: authenticationStore.makeProfileRepository())
                if let identity = authenticationStore.identity {
                    await planGenerationStore.connect(
                        userID: identity.userID,
                        remote: authenticationStore.makePlanRemote()
                    )
                    await weeklyLoopStore.connect(
                        userID: identity.userID,
                        remote: authenticationStore.makeWeeklyLoopRemote()
                    )
                    await accountStore.connect(
                        userID: identity.userID,
                        remote: authenticationStore.makeAccountRemote()
                    )
                    await featureFlagStore.connect(
                        userID: identity.userID,
                        remote: authenticationStore.makeFeatureFlagRemote()
                    )
                    await analyticsDimensionStore.connect(
                        userID: identity.userID,
                        remote: authenticationStore.makeAnalyticsDimensionRemote(),
                        acquisitionSource: acquisitionSource
                    )
                    await analyticsEventStore.connect(
                        userID: identity.userID,
                        accountCreatedAt: identity.createdAt,
                        remote: authenticationStore.makeAnalyticsEventRemote(),
                        measurementEnabled: analyticsMeasurementEnabled
                    )
                    await synchronizePushRegistrationIfAuthorized()
                }
            }
        case .signedOut:
            profileStore.disconnectRemote()
            weeklyLoopStore.disconnect()
            planGenerationStore.disconnect()
            accountStore.disconnect()
            featureFlagStore.disconnect()
            analyticsDimensionStore.disconnect()
            analyticsEventStore.disconnect()
        case .restoring, .requestingMagicLink, .magicLinkSent, .failed:
            break
        }
        if case .authenticated = newState, case .authenticated = oldState {
            return
        }
        if case .authenticated = newState {
            showingAuthenticationSuccess = true
        }
    }

    private func profileFailureChanged(_ oldMessage: String?, _ newMessage: String?) {
        showingPersistenceError = newMessage != nil
    }

    private var acquisitionSource: AnalyticsAcquisitionSource {
        AnalyticsAcquisitionSource(rawValue: acquisitionSourceRaw) ?? .unknown
    }

    private func captureAcquisition(from url: URL) {
        guard acquisitionSource == .unknown,
              let captured = AnalyticsAcquisitionSource.captured(from: url) else { return }
        acquisitionSourceRaw = captured.rawValue
        guard authenticationStore.identity != nil else { return }
        Task { await analyticsDimensionStore.record(acquisitionSource: captured) }
    }

    private func scenePhaseChanged(_ oldPhase: ScenePhase, _ newPhase: ScenePhase) {
        guard newPhase == .active, authenticationStore.identity != nil else { return }
        Task {
            _ = await performBackgroundSync()
            await featureFlagStore.refresh()
            if analyticsMeasurementEnabled {
                await analyticsEventStore.recordAppOpened(source: "foreground")
            }
            updateBackgroundSyncSchedule()
        }
    }

    private func analyticsMeasurementChanged(_ oldValue: Bool, _ newValue: Bool) {
        guard let identity = authenticationStore.identity else {
            analyticsEventStore.disconnect()
            return
        }
        if !newValue {
            Task {
                await analyticsEventStore.disableMeasurement(
                    using: authenticationStore.makeAnalyticsEventRemote()
                )
            }
            return
        }
        Task {
            await analyticsEventStore.connect(
                userID: identity.userID,
                accountCreatedAt: identity.createdAt,
                remote: authenticationStore.makeAnalyticsEventRemote(),
                measurementEnabled: true
            )
        }
    }

    private func updateBackgroundSyncSchedule() {
        let shouldSchedule = BackgroundSyncPolicy.shouldSchedule(
            profilePending: profileStore.needsBackgroundSync,
            weeklyLoopPending: weeklyLoopStore.needsBackgroundSync
        )
        if authenticationStore.identity == nil || !shouldSchedule {
            BackgroundSyncCoordinator.shared.cancelScheduledRetry()
        } else {
            BackgroundSyncCoordinator.shared.scheduleRetry()
        }
    }

    private func performBackgroundSync() async -> Bool {
        guard let identity = authenticationStore.identity else { return true }
        await profileStore.connect(to: authenticationStore.makeProfileRepository())
        await weeklyLoopStore.connect(
            userID: identity.userID,
            remote: authenticationStore.makeWeeklyLoopRemote()
        )
        return !profileStore.needsBackgroundSync && !weeklyLoopStore.needsBackgroundSync
    }

    private func synchronizePushRegistrationIfAuthorized() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus) else { return }
        await authenticationStore.synchronizePushRegistration()
    }

    private func persistOnboardingProfile(_ profile: UserProfile) {
        Task {
            if await profileStore.saveOnboardingProfile(profile) {
                onboardingComplete = true
            } else {
                showingPersistenceError = true
            }
        }
    }

    #if DEBUG
    private func installDevelopmentFixturesIfRequested() async {
        let arguments = ProcessInfo.processInfo.arguments
        guard arguments.contains("-NourishSeedWeeklyLoop") ||
                arguments.contains("-NourishSeedPlanDraft") else { return }
        let fixture = DevelopmentWeeklyLoopFixture.make()
        if arguments.contains("-NourishSeedWeeklyLoop") {
            await weeklyLoopStore.installDevelopmentFixture(
                fixture,
                isOnline: !arguments.contains("-NourishFixtureOffline"),
                reset: arguments.contains("-NourishResetWeeklyLoopFixture")
            )
        }
        if arguments.contains("-NourishSeedPlanDraft") {
            planGenerationStore.installDevelopmentDraft(
                plan: fixture.snapshot.plan,
                diagnostics: fixture.diagnostics
            )
        }
    }
    #endif
}

struct NourishRGB: Equatable, Sendable {
    let red: Double
    let green: Double
    let blue: Double

    var color: Color { Color(red: red, green: green, blue: blue) }

    func contrastRatio(with other: NourishRGB) -> Double {
        let lighter = max(relativeLuminance, other.relativeLuminance)
        let darker = min(relativeLuminance, other.relativeLuminance)
        return (lighter + 0.05) / (darker + 0.05)
    }

    private var relativeLuminance: Double {
        0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
    }

    private func linear(_ component: Double) -> Double {
        component <= 0.04045
            ? component / 12.92
            : pow((component + 0.055) / 1.055, 2.4)
    }
}

enum NourishTheme {
    static let inkRGB = NourishRGB(red: 0.09, green: 0.20, blue: 0.17)
    static let inkSoftRGB = NourishRGB(red: 0.33, green: 0.39, blue: 0.37)
    static let forestRGB = NourishRGB(red: 0.11, green: 0.29, blue: 0.22)
    static let leafRGB = NourishRGB(red: 0.34, green: 0.49, blue: 0.22)
    static let limeSoftRGB = NourishRGB(red: 0.91, green: 0.96, blue: 0.80)
    static let paperRGB = NourishRGB(red: 0.96, green: 0.95, blue: 0.91)
    static let amberSoftRGB = NourishRGB(red: 1.0, green: 0.93, blue: 0.73)
    static let whiteRGB = NourishRGB(red: 1, green: 1, blue: 1)

    static let ink = inkRGB.color
    static let inkSoft = inkSoftRGB.color
    static let forest = forestRGB.color
    static let leaf = leafRGB.color
    static let limeSoft = limeSoftRGB.color
    static let paper = paperRGB.color
    static let card = Color(red: 1.0, green: 0.99, blue: 0.98)
    static let amberSoft = amberSoftRGB.color
}
