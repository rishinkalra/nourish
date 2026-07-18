import CryptoKit
import Foundation

public enum AppFeatureFlagKey: String, CaseIterable, Codable, Sendable {
    case weeklyInsights = "weekly_insights"
}

public struct FeatureFlagDecision: Codable, Equatable, Sendable {
    public let key: String
    public let enabled: Bool
    public let version: Int
    public let reasonCode: String

    public init(key: String, enabled: Bool, version: Int, reasonCode: String) {
        self.key = key
        self.enabled = enabled
        self.version = version
        self.reasonCode = reasonCode
    }
}

public struct FeatureFlagSnapshot: Codable, Equatable, Sendable {
    public let appVersion: String
    public let evaluatedAt: Date
    public let contractVersion: String
    public let flags: [FeatureFlagDecision]

    public init(appVersion: String, evaluatedAt: Date, contractVersion: String, flags: [FeatureFlagDecision]) {
        self.appVersion = appVersion
        self.evaluatedAt = evaluatedAt
        self.contractVersion = contractVersion
        self.flags = flags
    }
}

public struct AppFeatureFlagSet: Equatable, Sendable {
    private let decisions: [AppFeatureFlagKey: FeatureFlagDecision]

    public static let safeDefaults = AppFeatureFlagSet(decisions: [:])

    public init(snapshot: FeatureFlagSnapshot) {
        guard snapshot.contractVersion == "feature-flags-v1" else {
            decisions = [:]
            return
        }
        let grouped = Dictionary(grouping: snapshot.flags) { $0.key }
        decisions = AppFeatureFlagKey.allCases.reduce(into: [:]) { result, key in
            guard let matches = grouped[key.rawValue], matches.count == 1, let decision = matches.first else { return }
            let mustDisable = decision.reasonCode == "emergency_disabled" || decision.version < 1
            result[key] = FeatureFlagDecision(
                key: decision.key,
                enabled: mustDisable ? false : decision.enabled,
                version: decision.version,
                reasonCode: decision.reasonCode
            )
        }
    }

    private init(decisions: [AppFeatureFlagKey: FeatureFlagDecision]) {
        self.decisions = decisions
    }

    public func isEnabled(_ key: AppFeatureFlagKey) -> Bool {
        decisions[key]?.enabled == true
    }

    public func decision(_ key: AppFeatureFlagKey) -> FeatureFlagDecision? {
        decisions[key]
    }
}

public protocol FeatureFlagRemote: Sendable {
    func read(appVersion: String) async throws -> FeatureFlagSnapshot
}

public protocol FeatureFlagCache: Sendable {
    func load(userID: String, appVersion: String, now: Date) async throws -> FeatureFlagSnapshot?
    func save(_ snapshot: FeatureFlagSnapshot, userID: String) async throws
}

public actor FileFeatureFlagCache: FeatureFlagCache {
    public static let maximumAge: TimeInterval = 15 * 60

    private let rootURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(rootURL: URL) {
        self.rootURL = rootURL
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
    }

    public static func applicationSupport(
        fileManager: FileManager = .default,
        directoryName: String = "ProjectNourish"
    ) throws -> FileFeatureFlagCache {
        guard let applicationSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            throw FeatureFlagCacheError.applicationSupportUnavailable
        }
        return FileFeatureFlagCache(rootURL: applicationSupport.appending(path: directoryName).appending(path: "feature-flags"))
    }

    public func load(userID: String, appVersion: String, now: Date = .now) async throws -> FeatureFlagSnapshot? {
        let url = fileURL(userID: userID)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let snapshot = try decoder.decode(FeatureFlagSnapshot.self, from: Data(contentsOf: url))
        let age = now.timeIntervalSince(snapshot.evaluatedAt)
        guard snapshot.contractVersion == "feature-flags-v1",
              snapshot.appVersion == appVersion,
              age >= -60,
              age <= Self.maximumAge else { return nil }
        return snapshot
    }

    public func save(_ snapshot: FeatureFlagSnapshot, userID: String) async throws {
        let url = fileURL(userID: userID)
        try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
        try encoder.encode(snapshot).write(
            to: url,
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
        )
    }

    private func fileURL(userID: String) -> URL {
        let digest = SHA256.hash(data: Data(userID.utf8)).map { String(format: "%02x", $0) }.joined()
        return rootURL.appending(path: "\(digest).json")
    }
}

public enum FeatureFlagCacheError: Error, Equatable, Sendable {
    case applicationSupportUnavailable
}

public struct URLSessionFeatureFlagRemote: FeatureFlagRemote {
    private let baseURL: URL
    private let session: URLSession
    private let accessTokenProvider: @Sendable () async throws -> SensitiveToken?
    private let decoder: JSONDecoder

    public init(
        baseURL: URL,
        session: URLSession = .shared,
        accessTokenProvider: @escaping @Sendable () async throws -> SensitiveToken?
    ) {
        self.baseURL = baseURL
        self.session = session
        self.accessTokenProvider = accessTokenProvider
        decoder = URLSessionAuthenticationRemote.makeDecoder()
    }

    public func read(appVersion: String) async throws -> FeatureFlagSnapshot {
        guard let token = try await accessTokenProvider() else {
            throw APIErrorEnvelope(
                code: .authenticationRequired,
                userSafeMessage: "Please sign in again.",
                correlationID: "local-feature-flags-session-required",
                retryable: false
            )
        }
        guard var components = URLComponents(url: baseURL.appending(path: "v1/feature-flags"), resolvingAgainstBaseURL: false) else {
            throw URLError(.badURL)
        }
        components.queryItems = [URLQueryItem(name: "appVersion", value: appVersion)]
        guard let url = components.url else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "accept")
        request.setValue("Bearer \(token.rawValue)", forHTTPHeaderField: "authorization")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "x-correlation-id")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(http.statusCode) else {
            if let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data) { throw envelope }
            throw URLError(.badServerResponse)
        }
        return try decoder.decode(FeatureFlagSnapshot.self, from: data)
    }
}
