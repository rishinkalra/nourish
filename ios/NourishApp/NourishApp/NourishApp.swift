import SwiftUI
import NourishAPI
import NourishUI
import UIKit
import UserNotifications

private enum NourishAppConfiguration {
    static let apiBaseURL: URL = {
        let configuredValue = Bundle.main.object(forInfoDictionaryKey: "NourishAPIBaseURL") as? String
        #if DEBUG
        // A shared staging scheme may override the local Debug origin at launch.
        // Release builds deliberately ignore process environment overrides.
        let runtimeOverride = ProcessInfo.processInfo.environment["NOURISH_API_BASE_URL_OVERRIDE"]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let selectedValue = runtimeOverride?.isEmpty == false ? runtimeOverride : configuredValue
        let allowsLocalHTTP = true
        #else
        let selectedValue = configuredValue
        let allowsLocalHTTP = false
        #endif
        do {
            return try APIBaseURLPolicy.validated(
                rawValue: selectedValue,
                allowsLocalHTTP: allowsLocalHTTP
            )
        } catch {
            fatalError("NourishAPIBaseURL is missing or unsafe for this build configuration.")
        }
    }()
}

final class NourishAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        BackgroundSyncCoordinator.shared.register()
        Task { @MainActor in
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            if [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus) {
                application.registerForRemoteNotifications()
            }
        }
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = PushDeviceToken(data: deviceToken)
        Task {
            await PushDeviceTokenCache.shared.store(token)
            await MainActor.run {
                NotificationCenter.default.post(name: .nourishPushDeviceTokenUpdated, object: nil)
            }
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // APNs registration is retried by iOS on a later authorized launch.
    }
}

@main
struct NourishApp: App {
    @UIApplicationDelegateAdaptor(NourishAppDelegate.self) private var appDelegate

    private static let prepareLaunchDefaults: Void = {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("-NourishUITestOnboarding") || arguments.contains("-NourishUITestMain") {
            UserDefaults.standard.set(0, forKey: "nourish.selected.tab")
            UserDefaults.standard.set(false, forKey: "nourish.analytics.measurement-enabled")
        }
        #endif
    }()

    init() {
        _ = Self.prepareLaunchDefaults
    }

    var body: some Scene {
        WindowGroup {
            AppRootView(baseURL: NourishAppConfiguration.apiBaseURL)
                // The current brand palette is intentionally light. Keep system text,
                // fields, pickers, and materials in the matching appearance until a
                // complete dark palette is available.
                .preferredColorScheme(.light)
        }
    }
}
