import Foundation
import NourishCore

public struct URLSessionAuthenticationRemote: AuthenticationRemote {
    private let baseURL: URL
    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        encoder = Self.makeEncoder()
        decoder = Self.makeDecoder()
    }

    public func exchangeAppleCredential(_ credential: AppleCredentialExchange) async throws -> AppSession {
        try await send(
            route: .authenticateWithApple,
            body: AppleExchangeBody(
                identityToken: credential.identityToken,
                authorizationCode: credential.authorizationCode,
                nonce: credential.nonce
            )
        )
    }

    public func requestMagicLink(email: String) async throws -> MagicLinkRequestReceipt {
        try await send(route: .requestMagicLink, body: MagicLinkRequestBody(email: email))
    }

    public func completeMagicLink(callbackURL: URL) async throws -> AppSession {
        guard let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
              let token = components.queryItems?.first(where: { $0.name == "token" })?.value,
              !token.isEmpty else {
            throw APIErrorEnvelope(
                code: .validationError,
                userSafeMessage: "This sign-in link is invalid or incomplete.",
                correlationID: "local-magic-link-validation",
                retryable: false
            )
        }
        return try await send(route: .completeMagicLink, body: MagicLinkCompletionBody(token: SensitiveToken(token)))
    }

    public func refreshSession(using refreshToken: SensitiveToken) async throws -> AppSession {
        try await send(route: .refreshSession, body: RefreshBody(refreshToken: refreshToken))
    }

    public func revokeSession(accessToken: SensitiveToken) async throws {
        let request = try makeRequest(route: .revokeSession, accessToken: accessToken)
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
    }

    private func send<Response: Decodable, Body: Encodable>(
        route: ConsumerRoute,
        body: Body
    ) async throws -> Response {
        var request = try makeRequest(route: route)
        request.httpBody = try encoder.encode(body)
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        return try decoder.decode(Response.self, from: data)
    }

    private func makeRequest(route: ConsumerRoute, accessToken: SensitiveToken? = nil) throws -> URLRequest {
        let descriptor = route.descriptor
        guard let url = URL(string: descriptor.path, relativeTo: baseURL)?.absoluteURL else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url)
        request.httpMethod = descriptor.method.rawValue
        request.timeoutInterval = 20
        request.setValue(UUID().uuidString, forHTTPHeaderField: "x-correlation-id")
        request.setValue("application/json", forHTTPHeaderField: "accept")
        if let accessToken {
            request.setValue("Bearer \(accessToken.rawValue)", forHTTPHeaderField: "authorization")
        }
        return request
    }

    private func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(http.statusCode) else {
            if let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data) { throw envelope }
            throw URLError(.badServerResponse)
        }
    }

    static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }

    static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let value = try decoder.singleValueContainer().decode(String.self)
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = fractional.date(from: value) { return date }
            let standard = ISO8601DateFormatter()
            if let date = standard.date(from: value) { return date }
            throw DecodingError.dataCorruptedError(
                in: try decoder.singleValueContainer(),
                debugDescription: "Expected an ISO-8601 date."
            )
        }
        return decoder
    }
}

public struct URLSessionProfileRepository: ProfileRepository {
    private let baseURL: URL
    private let session: URLSession
    private let accessTokenProvider: @Sendable () async throws -> SensitiveToken?
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(
        baseURL: URL,
        session: URLSession = .shared,
        accessTokenProvider: @escaping @Sendable () async throws -> SensitiveToken?
    ) {
        self.baseURL = baseURL
        self.session = session
        self.accessTokenProvider = accessTokenProvider
        encoder = URLSessionAuthenticationRemote.makeEncoder()
        decoder = URLSessionAuthenticationRemote.makeDecoder()
    }

    public func read() async throws -> StoredProfile? {
        let request = try await makeRequest(route: .readProfile)
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        if data == Data("null".utf8) { return nil }
        return try decoder.decode(StoredProfile.self, from: data)
    }

    public func update(_ requestBody: ProfileUpdateRequest) async throws -> StoredProfile {
        var request = try await makeRequest(route: .updateProfile)
        request.httpBody = try encoder.encode(requestBody)
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        return try decoder.decode(StoredProfile.self, from: data)
    }

    private func makeRequest(route: ConsumerRoute) async throws -> URLRequest {
        guard let token = try await accessTokenProvider() else {
            throw APIErrorEnvelope(
                code: .authenticationRequired,
                userSafeMessage: "Please sign in again.",
                correlationID: "local-session-required",
                retryable: false
            )
        }
        let descriptor = route.descriptor
        guard let url = URL(string: descriptor.path, relativeTo: baseURL)?.absoluteURL else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url)
        request.httpMethod = descriptor.method.rawValue
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "accept")
        request.setValue("Bearer \(token.rawValue)", forHTTPHeaderField: "authorization")
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
}

private struct AppleExchangeBody: Encodable {
    let identityToken: SensitiveToken
    let authorizationCode: SensitiveToken
    let nonce: SensitiveToken
}

private struct MagicLinkRequestBody: Encodable { let email: String }
private struct MagicLinkCompletionBody: Encodable { let token: SensitiveToken }
private struct RefreshBody: Encodable { let refreshToken: SensitiveToken }
