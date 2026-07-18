import Foundation
import NourishAPI

@MainActor
final class AnalyticsEventStore: ObservableObject {
    private var remote: (any AnalyticsEventRemote)?
    private var userID: String?
    private var accountCreatedAt: Date?
    private var connectionGeneration = 0

    func connect(
        userID: String,
        accountCreatedAt: Date?,
        remote: any AnalyticsEventRemote,
        measurementEnabled: Bool
    ) async {
        connectionGeneration += 1
        self.userID = userID
        self.accountCreatedAt = accountCreatedAt
        self.remote = remote
        let generation = connectionGeneration
        do {
            let receipt = try await remote.setMeasurementEnabled(measurementEnabled)
            guard generation == connectionGeneration,
                  receipt.enabled == measurementEnabled,
                  receipt.contractVersion == "analytics-consent-v1" else { return }
        } catch {
            guard generation == connectionGeneration else { return }
            disconnect()
            return
        }
        guard measurementEnabled else {
            disconnect()
            return
        }
        await recordAppOpened(source: "authenticated_bootstrap")
    }

    func disableMeasurement(using fallbackRemote: any AnalyticsEventRemote) async {
        connectionGeneration += 1
        let generation = connectionGeneration
        let consentRemote = remote ?? fallbackRemote
        _ = try? await consentRemote.setMeasurementEnabled(false)
        guard generation == connectionGeneration else { return }
        disconnect()
    }

    func disconnect() {
        connectionGeneration += 1
        remote = nil
        userID = nil
        accountCreatedAt = nil
    }

    func recordAppOpened(source: String) async {
        let appVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        let daysSinceSignup = accountCreatedAt.map {
            max(0, Calendar(identifier: .gregorian).dateComponents([.day], from: $0, to: .now).day ?? 0)
        } ?? 0
        _ = await record(
            .appOpened,
            properties: [
                "source": .string(source),
                "app_version": .string(appVersion),
                "days_since_signup": .integer(daysSinceSignup),
            ]
        )
    }

    @discardableResult
    func record(
        _ eventName: ClientAnalyticsEventName,
        properties: [String: AnalyticsEventValue]
    ) async -> Bool {
        guard userID != nil, let remote else { return false }
        let generation = connectionGeneration
        let event = ClientAnalyticsEvent(eventName: eventName, properties: properties)
        do {
            let receipt = try await remote.record(event)
            guard generation == connectionGeneration,
                  receipt.eventName == eventName.rawValue,
                  receipt.schemaVersion == "1",
                  receipt.contractVersion == "analytics-events-v1" else { return false }
            return true
        } catch {
            // Optional first-party measurement never blocks product use.
            return false
        }
    }
}
