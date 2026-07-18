import Foundation

public protocol AccountRemote: Sendable {
    func readEntitlement() async throws -> EntitlementSnapshot
    func issueAppStoreAccountToken() async throws -> AppStoreAccountBinding
    func bindAppStoreTransaction(signedTransactionInfo: String) async throws -> EntitlementSnapshot
    func requestExport(idempotencyKey: String) async throws -> AccountExportReceipt
    func deleteAccount(_ request: AccountDeletionRequest, idempotencyKey: String) async throws -> AccountDeletionReceipt
}

public struct URLSessionAccountRemote: AccountRemote {
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

    public func readEntitlement() async throws -> EntitlementSnapshot {
        try await send(route: .readEntitlement, body: Optional<EmptyBody>.none, idempotencyKey: nil)
    }

    public func issueAppStoreAccountToken() async throws -> AppStoreAccountBinding {
        try await send(route: .issueAppStoreAccountToken, body: EmptyBody(), idempotencyKey: nil)
    }

    public func bindAppStoreTransaction(signedTransactionInfo: String) async throws -> EntitlementSnapshot {
        try await send(
            route: .bindAppStoreTransaction,
            body: AppStoreTransactionBindingRequest(signedTransactionInfo: signedTransactionInfo),
            idempotencyKey: nil
        )
    }

    public func requestExport(idempotencyKey: String) async throws -> AccountExportReceipt {
        try await send(route: .requestAccountExport, body: EmptyBody(), idempotencyKey: idempotencyKey)
    }

    public func deleteAccount(_ request: AccountDeletionRequest, idempotencyKey: String) async throws -> AccountDeletionReceipt {
        try await send(route: .deleteAccount, body: request, idempotencyKey: idempotencyKey)
    }

    private func send<Response: Decodable, Body: Encodable>(
        route: ConsumerRoute,
        body: Body?,
        idempotencyKey: String?
    ) async throws -> Response {
        guard let token = try await accessTokenProvider() else {
            throw APIErrorEnvelope(
                code: .authenticationRequired,
                userSafeMessage: "Please sign in again.",
                correlationID: "local-account-session-required",
                retryable: false
            )
        }
        let descriptor = route.descriptor
        guard let url = URL(string: descriptor.path, relativeTo: baseURL)?.absoluteURL else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.httpMethod = descriptor.method.rawValue
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "accept")
        request.setValue("Bearer \(token.rawValue)", forHTTPHeaderField: "authorization")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "x-correlation-id")
        if let idempotencyKey { request.setValue(idempotencyKey, forHTTPHeaderField: "idempotency-key") }
        if let body {
            request.httpBody = try encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "content-type")
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(http.statusCode) else {
            if let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data) { throw envelope }
            throw URLError(.badServerResponse)
        }
        return try decoder.decode(Response.self, from: data)
    }
}

private struct EmptyBody: Codable {}
