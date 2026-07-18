import Foundation
import NourishAPI

@MainActor
final class AnalyticsDimensionStore: ObservableObject {
    private var userID: String?
    private var remote: (any AnalyticsDimensionRemote)?
    private var lastConfirmedSignature: String?
    private var connectionGeneration = UUID()

    func connect(
        userID: String,
        remote: any AnalyticsDimensionRemote,
        acquisitionSource: AnalyticsAcquisitionSource
    ) async {
        connectionGeneration = UUID()
        self.userID = userID
        self.remote = remote
        lastConfirmedSignature = nil
        await record(acquisitionSource: acquisitionSource)
    }

    func record(acquisitionSource: AnalyticsAcquisitionSource) async {
        guard let remote, userID != nil else { return }
        let generation = connectionGeneration
        let signature = "\(appVersion)|\(acquisitionSource.rawValue)"
        guard signature != lastConfirmedSignature else { return }
        do {
            let receipt = try await remote.record(appVersion: appVersion, acquisitionSource: acquisitionSource)
            guard generation == connectionGeneration, receipt.contractVersion == "analytics-dimensions-v1" else { return }
            lastConfirmedSignature = signature
        } catch {
            // Analytics must never block sign-in or product use; a future authenticated bootstrap can retry.
        }
    }

    func disconnect() {
        connectionGeneration = UUID()
        userID = nil
        remote = nil
        lastConfirmedSignature = nil
    }

    private var appVersion: String {
        let value = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        return value?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? "1.0.0"
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
