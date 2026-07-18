import Foundation
import Security

public struct SensitiveToken: Codable, Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    public let rawValue: String

    public init(_ rawValue: String) {
        self.rawValue = rawValue
    }

    public var description: String { "<redacted>" }
    public var debugDescription: String { "<redacted>" }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        rawValue = try container.decode(String.self)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

public struct SessionIdentity: Codable, Equatable, Sendable {
    public let userID: String
    public let verifiedEmail: String?
    public let createdAt: Date?

    public init(userID: String, verifiedEmail: String?, createdAt: Date? = nil) {
        self.userID = userID
        self.verifiedEmail = verifiedEmail
        self.createdAt = createdAt
    }
}

public struct AppSession: Codable, Equatable, Sendable {
    public let identity: SessionIdentity
    public let accessToken: SensitiveToken
    public let refreshToken: SensitiveToken
    public let accessTokenExpiresAt: Date

    public init(identity: SessionIdentity, accessToken: SensitiveToken, refreshToken: SensitiveToken, accessTokenExpiresAt: Date) {
        self.identity = identity
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.accessTokenExpiresAt = accessTokenExpiresAt
    }

    public func requiresRefresh(at date: Date, leeway: TimeInterval = 60) -> Bool {
        accessTokenExpiresAt <= date.addingTimeInterval(leeway)
    }
}

public struct AppleCredentialExchange: Codable, Equatable, Sendable {
    public let identityToken: SensitiveToken
    public let authorizationCode: SensitiveToken
    public let nonce: SensitiveToken

    public init(identityToken: SensitiveToken, authorizationCode: SensitiveToken, nonce: SensitiveToken) {
        self.identityToken = identityToken
        self.authorizationCode = authorizationCode
        self.nonce = nonce
    }
}

public struct MagicLinkRequestReceipt: Codable, Equatable, Sendable {
    public let requestID: String
    public let resendAvailableAt: Date

    public init(requestID: String, resendAvailableAt: Date) {
        self.requestID = requestID
        self.resendAvailableAt = resendAvailableAt
    }
}

public enum SessionState: Equatable, Sendable {
    case signedOut
    case authenticated(SessionIdentity)
}

public enum AuthenticationConfigurationError: Error, Equatable, Sendable {
    case refreshContractNotConfigured
    case magicLinkCallbackContractNotConfigured
}

public protocol AuthenticationRemote: Sendable {
    func exchangeAppleCredential(_ credential: AppleCredentialExchange) async throws -> AppSession
    func requestMagicLink(email: String) async throws -> MagicLinkRequestReceipt
    func completeMagicLink(callbackURL: URL) async throws -> AppSession
    func refreshSession(using refreshToken: SensitiveToken) async throws -> AppSession
    func revokeSession(accessToken: SensitiveToken) async throws
}

public protocol SessionStorage: Sendable {
    func load() async throws -> AppSession?
    func save(_ session: AppSession) async throws
    func delete() async throws
}

public actor SessionManager<Remote: AuthenticationRemote, Storage: SessionStorage> {
    private let remote: Remote
    private let storage: Storage
    private var session: AppSession?

    public init(remote: Remote, storage: Storage) {
        self.remote = remote
        self.storage = storage
    }

    public func restore(at date: Date = .now) async throws -> SessionState {
        guard let stored = try await storage.load() else {
            session = nil
            return .signedOut
        }

        if stored.requiresRefresh(at: date) {
            do {
                let refreshed = try await remote.refreshSession(using: stored.refreshToken)
                try await storage.save(refreshed)
                session = refreshed
                return .authenticated(refreshed.identity)
            } catch {
                session = nil
                try await storage.delete()
                throw error
            }
        }

        session = stored
        return .authenticated(stored.identity)
    }

    public func signInWithApple(_ credential: AppleCredentialExchange) async throws -> SessionState {
        let authenticated = try await remote.exchangeAppleCredential(credential)
        try await storage.save(authenticated)
        session = authenticated
        return .authenticated(authenticated.identity)
    }

    public func requestMagicLink(email: String) async throws -> MagicLinkRequestReceipt {
        try await remote.requestMagicLink(email: email)
    }

    public func completeMagicLink(callbackURL: URL) async throws -> SessionState {
        let authenticated = try await remote.completeMagicLink(callbackURL: callbackURL)
        try await storage.save(authenticated)
        session = authenticated
        return .authenticated(authenticated.identity)
    }

    public func validAccessToken(at date: Date = .now) async throws -> SensitiveToken? {
        if session == nil {
            _ = try await restore(at: date)
        }
        guard let current = session else { return nil }
        if current.requiresRefresh(at: date) {
            _ = try await restore(at: date)
        }
        return session?.accessToken
    }

    public func signOut() async throws {
        let token = session?.accessToken
        session = nil
        try await storage.delete()
        if let token {
            try await remote.revokeSession(accessToken: token)
        }
    }
}

public actor InMemorySessionStorage: SessionStorage {
    private var session: AppSession?

    public init(seed: AppSession? = nil) {
        session = seed
    }

    public func load() async throws -> AppSession? { session }
    public func save(_ session: AppSession) async throws { self.session = session }
    public func delete() async throws { session = nil }
}

public struct KeychainSessionStorage: SessionStorage {
    private let service: String
    private let account: String

    public init(service: String = "com.projectnourish.session", account: String = "active-session") {
        self.service = service
        self.account = account
    }

    public func load() async throws -> AppSession? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw KeychainSessionError.unexpectedStatus(status)
        }
        return try Self.decoder.decode(AppSession.self, from: data)
    }

    public func save(_ session: AppSession) async throws {
        let data = try Self.encoder.encode(session)
        let attributes: [String: Any] = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw KeychainSessionError.unexpectedStatus(updateStatus)
        }

        var insert = baseQuery
        insert[kSecValueData as String] = data
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(insert as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw KeychainSessionError.unexpectedStatus(addStatus)
        }
    }

    public func delete() async throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainSessionError.unexpectedStatus(status)
        }
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
        ]
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}

public enum KeychainSessionError: Error, Equatable, Sendable {
    case unexpectedStatus(OSStatus)
}
