import Foundation

public struct PushDeviceToken: Codable, Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    public let rawValue: String

    public init(data: Data) {
        rawValue = data.map { String(format: "%02x", $0) }.joined()
    }

    public init(rawValue: String) {
        self.rawValue = rawValue.lowercased()
    }

    public var description: String { "<redacted>" }
    public var debugDescription: String { "<redacted>" }
}

public enum PushEnvironment: String, Codable, Sendable {
    case sandbox
    case production
}

public struct PushRegistrationReceipt: Codable, Equatable, Sendable {
    public let registrationID: String
    public let environment: PushEnvironment
    public let registeredAt: Date

    public init(registrationID: String, environment: PushEnvironment, registeredAt: Date) {
        self.registrationID = registrationID
        self.environment = environment
        self.registeredAt = registeredAt
    }
}

public protocol PushRegistrationRemote: Sendable {
    func register(deviceToken: PushDeviceToken, environment: PushEnvironment) async throws -> PushRegistrationReceipt
    func unregister(deviceToken: PushDeviceToken, environment: PushEnvironment) async throws
}

public actor PushDeviceTokenCache {
    public static let shared = PushDeviceTokenCache()
    private var token: PushDeviceToken?

    public init() {}

    public func store(_ token: PushDeviceToken) {
        self.token = token
    }

    public func current() -> PushDeviceToken? {
        token
    }

    public func clear() {
        token = nil
    }
}

public struct URLSessionPushRegistrationRemote: PushRegistrationRemote {
    private let baseURL: URL
    private let session: URLSession
    private let accessTokenProvider: @Sendable () async throws -> SensitiveToken?
    private let encoder = URLSessionAuthenticationRemote.makeEncoder()
    private let decoder = URLSessionAuthenticationRemote.makeDecoder()

    public init(
        baseURL: URL,
        session: URLSession = .shared,
        accessTokenProvider: @escaping @Sendable () async throws -> SensitiveToken?
    ) {
        self.baseURL = baseURL
        self.session = session
        self.accessTokenProvider = accessTokenProvider
    }

    public func register(
        deviceToken: PushDeviceToken,
        environment: PushEnvironment
    ) async throws -> PushRegistrationReceipt {
        var request = try await makeRequest(route: .registerPushDevice)
        request.httpBody = try encoder.encode(Body(deviceToken: deviceToken, environment: environment))
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        return try decoder.decode(PushRegistrationReceipt.self, from: data)
    }

    public func unregister(
        deviceToken: PushDeviceToken,
        environment: PushEnvironment
    ) async throws {
        var request = try await makeRequest(route: .unregisterPushDevice)
        request.httpBody = try encoder.encode(Body(deviceToken: deviceToken, environment: environment))
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
    }

    private func makeRequest(route: ConsumerRoute) async throws -> URLRequest {
        guard let accessToken = try await accessTokenProvider() else {
            throw APIErrorEnvelope(
                code: .authenticationRequired,
                userSafeMessage: "Please sign in again.",
                correlationID: "local-session-required",
                retryable: false
            )
        }
        guard let url = URL(string: route.descriptor.path, relativeTo: baseURL)?.absoluteURL else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url)
        request.httpMethod = route.descriptor.method.rawValue
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "accept")
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue("Bearer \(accessToken.rawValue)", forHTTPHeaderField: "authorization")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "x-correlation-id")
        return request
    }

    private func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(http.statusCode) else {
            if let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data) { throw envelope }
            throw URLError(.badServerResponse)
        }
    }

    private struct Body: Encodable {
        let deviceToken: PushDeviceToken
        let environment: PushEnvironment
    }
}

public extension Notification.Name {
    static let nourishPushDeviceTokenUpdated = Notification.Name("NourishPushDeviceTokenUpdated")
}
