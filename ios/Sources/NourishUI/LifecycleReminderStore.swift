import Foundation
import NourishCore
import UserNotifications
import UIKit

struct NourishNotificationOpen: Sendable {
    let url: URL
    let templateID: String
    let destination: String
}

enum NourishRoute: Equatable, Sendable {
    case planStudio
    case groceries
    case prep
    case meal(MealSlot)
    case weeklyReview

    init?(url: URL) {
        guard url.scheme?.lowercased() == "nourish", url.host?.lowercased() == "open" else { return nil }
        switch url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")).lowercased() {
        case "plan", "nextplan": self = .planStudio
        case "groceries": self = .groceries
        case "prep": self = .prep
        case "breakfast": self = .meal(.breakfast)
        case "lunch": self = .meal(.lunch)
        case "dinner": self = .meal(.dinner)
        case "weeklyreview": self = .weeklyReview
        default: return nil
        }
    }
}

@MainActor
final class AppRouteStore: ObservableObject {
    @Published private(set) var pendingRoute: NourishRoute?

    @discardableResult
    func handle(_ url: URL) -> Bool {
        guard let route = NourishRoute(url: url) else { return false }
        pendingRoute = route
        return true
    }

    func consume() { pendingRoute = nil }
}

@MainActor
final class LifecycleReminderStore: ObservableObject {
    enum AuthorizationState: Equatable {
        case unknown
        case notRequested
        case authorized
        case denied
        case failed(String)
    }

    @Published private(set) var settings: LifecycleReminderSettings
    @Published private(set) var authorizationState: AuthorizationState = .unknown
    @Published private(set) var scheduledCount = 0
    @Published private(set) var statusMessage: String?

    private let center: UNUserNotificationCenter
    private let defaults: UserDefaults
    private let storageKey = "nourish.lifecycle-reminders.v1"
    private let identifierPrefix = "nourish.lifecycle."

    init(center: UNUserNotificationCenter = .current(), defaults: UserDefaults = .standard) {
        self.center = center
        self.defaults = defaults
        if let data = defaults.data(forKey: storageKey),
           let restored = try? JSONDecoder().decode(LifecycleReminderSettings.self, from: data),
           restored.isValid {
            settings = restored
        } else {
            settings = LifecycleReminderSettings()
        }
    }

    func configure() async {
        center.delegate = NourishNotificationDelegate.shared
        await refreshAuthorization()
        await refreshScheduledCount()
    }

    func save(_ updated: LifecycleReminderSettings, profile: UserProfile) async -> Bool {
        guard updated.isValid else {
            statusMessage = "Check the reminder days and times, then try again."
            return false
        }
        if updated.hasEnabledReminders && authorizationState != .authorized {
            do {
                let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
                authorizationState = granted ? .authorized : .denied
                if granted {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            } catch {
                authorizationState = .failed("Notification permission could not be requested.")
            }
        }
        guard !updated.hasEnabledReminders || authorizationState == .authorized else {
            statusMessage = "Reminders are saved, but notifications are disabled in iOS Settings."
            persist(updated)
            settings = updated
            await cancelLifecycleRequests()
            return false
        }
        if authorizationState == .authorized {
            UIApplication.shared.registerForRemoteNotifications()
        }

        persist(updated)
        settings = updated
        do {
            try await replaceSchedules(with: LifecycleReminderPlanner.descriptors(settings: updated, profile: profile))
            await refreshScheduledCount()
            statusMessage = updated.hasEnabledReminders ? "Reminder schedule updated." : "All Nourish reminders are off."
            return true
        } catch {
            statusMessage = "Your choices were saved, but iOS could not schedule every reminder."
            await refreshScheduledCount()
            return false
        }
    }

    func cancelAll() async {
        settings = LifecycleReminderSettings(planStartWeekday: settings.planStartWeekday)
        persist(settings)
        await cancelLifecycleRequests()
        scheduledCount = 0
        statusMessage = "All Nourish reminders were cancelled."
    }

    func refreshAuthorization() async {
        let notificationSettings = await center.notificationSettings()
        switch notificationSettings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: authorizationState = .authorized
        case .denied: authorizationState = .denied
        case .notDetermined: authorizationState = .notRequested
        @unknown default: authorizationState = .unknown
        }
    }

    private func persist(_ value: LifecycleReminderSettings) {
        if let data = try? JSONEncoder().encode(value) { defaults.set(data, forKey: storageKey) }
    }

    private func replaceSchedules(with descriptors: [ReminderDescriptor]) async throws {
        await cancelLifecycleRequests()
        for descriptor in descriptors {
            let content = UNMutableNotificationContent()
            content.title = descriptor.title
            content.body = descriptor.body
            content.sound = .default
            content.userInfo = [
                "destination": descriptor.destination.deepLink.absoluteString,
                "template_id": descriptor.identifier,
                "analytics_destination": descriptor.destination.analyticsName,
            ]
            let components: DateComponents
            switch descriptor.recurrence {
            case let .daily(time):
                components = DateComponents(hour: time.hour, minute: time.minute)
            case let .weekly(weekday, time):
                components = DateComponents(hour: time.hour, minute: time.minute, weekday: weekday)
            }
            let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: true)
            try await center.add(UNNotificationRequest(
                identifier: identifierPrefix + descriptor.identifier,
                content: content,
                trigger: trigger
            ))
        }
    }

    private func cancelLifecycleRequests() async {
        let requests = await center.pendingNotificationRequests()
        let identifiers = requests.map(\.identifier).filter { $0.hasPrefix(identifierPrefix) }
        center.removePendingNotificationRequests(withIdentifiers: identifiers)
        center.removeDeliveredNotifications(withIdentifiers: identifiers)
    }

    private func refreshScheduledCount() async {
        let requests = await center.pendingNotificationRequests()
        scheduledCount = requests.filter { $0.identifier.hasPrefix(identifierPrefix) }.count
    }
}

final class NourishNotificationDelegate: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
    static let shared = NourishNotificationDelegate()

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let destination = response.notification.request.content.userInfo["destination"] as? String
        let templateID = response.notification.request.content.userInfo["template_id"] as? String
            ?? response.notification.request.identifier
        let analyticsDestination = response.notification.request.content.userInfo["analytics_destination"] as? String
            ?? "unknown"
        Task { @MainActor [destination, templateID, analyticsDestination] in
            if let destination, let url = URL(string: destination) {
                NotificationCenter.default.post(
                    name: .nourishNotificationOpened,
                    object: NourishNotificationOpen(
                        url: url,
                        templateID: templateID,
                        destination: analyticsDestination
                    )
                )
            }
        }
        completionHandler()
    }
}

extension Notification.Name {
    static let nourishNotificationOpened = Notification.Name("NourishNotificationOpened")
}

private extension ReminderDestination {
    var analyticsName: String {
        switch self {
        case .groceries: "groceries"
        case .prep: "prep"
        case .breakfast: "breakfast"
        case .lunch: "lunch"
        case .dinner: "dinner"
        case .weeklyReview: "weekly_review"
        case .nextPlan: "next_plan"
        }
    }
}
