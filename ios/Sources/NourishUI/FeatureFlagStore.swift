import Foundation
import NourishAPI

@MainActor
final class FeatureFlagStore: ObservableObject {
    enum Source: Equatable {
        case safeDefaults
        case protectedCache(evaluatedAt: Date)
        case server(evaluatedAt: Date)
    }

    @Published private(set) var flags = AppFeatureFlagSet.safeDefaults
    @Published private(set) var source: Source = .safeDefaults

    private let cache: (any FeatureFlagCache)?
    private var userID: String?
    private var remote: (any FeatureFlagRemote)?
    private var connectionGeneration = UUID()

    init(cache: (any FeatureFlagCache)? = try? FileFeatureFlagCache.applicationSupport()) {
        self.cache = cache
    }

    func connect(userID: String, remote: any FeatureFlagRemote) async {
        let generation = UUID()
        connectionGeneration = generation
        self.userID = userID
        self.remote = remote
        flags = .safeDefaults
        source = .safeDefaults

        if let cached = try? await cache?.load(userID: userID, appVersion: appVersion, now: .now),
           connectionGeneration == generation {
            flags = AppFeatureFlagSet(snapshot: cached)
            source = .protectedCache(evaluatedAt: cached.evaluatedAt)
        }
        await refresh(expectedGeneration: generation)
    }

    func refresh() async {
        await refresh(expectedGeneration: connectionGeneration)
    }

    func disconnect() {
        connectionGeneration = UUID()
        userID = nil
        remote = nil
        flags = .safeDefaults
        source = .safeDefaults
    }

    func isEnabled(_ key: AppFeatureFlagKey) -> Bool {
        flags.isEnabled(key)
    }

    private func refresh(expectedGeneration: UUID) async {
        guard let remote, let userID else { return }
        do {
            let snapshot = try await remote.read(appVersion: appVersion)
            guard connectionGeneration == expectedGeneration,
                  snapshot.appVersion == appVersion,
                  snapshot.contractVersion == "feature-flags-v1" else { return }
            flags = AppFeatureFlagSet(snapshot: snapshot)
            source = .server(evaluatedAt: snapshot.evaluatedAt)
            try? await cache?.save(snapshot, userID: userID)
        } catch {
            // Preserve a still-valid protected cache. With no valid cache, every consumed flag remains safely off.
        }
    }

    private var appVersion: String {
        let value = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        return value?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? "1.0.0"
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
