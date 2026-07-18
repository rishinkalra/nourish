import Foundation
import NourishCore

public protocol PlanRemote: Sendable {
    func createPlan(_ request: PlanGenerationRequest, idempotencyKey: String) async throws -> PlanJob
    func readPlan(id: String) async throws -> PlanReadEnvelope
    func readPlanHistory() async throws -> [PlanHistoryEntry]
    func adoptPlan(id: String, idempotencyKey: String) async throws -> PlanAdoptionReceipt
    func submitFeedback(_ request: MealFeedbackRequest) async throws -> FeedbackReceipt
    func submitWeeklyReview(_ request: WeeklyReviewRequest) async throws -> FeedbackReceipt
}

public struct URLSessionPlanRemote: PlanRemote {
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

    public func createPlan(_ requestBody: PlanGenerationRequest, idempotencyKey: String) async throws -> PlanJob {
        var request = try await makeRequest(route: .createPlan, idempotencyKey: idempotencyKey)
        request.httpBody = try encoder.encode(requestBody)
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        return try await send(request, as: PlanJob.self)
    }

    public func readPlan(id: String) async throws -> PlanReadEnvelope {
        try await send(makeRequest(route: .readPlan(id: id)), as: PlanReadEnvelope.self)
    }

    public func readPlanHistory() async throws -> [PlanHistoryEntry] {
        try await send(makeRequest(route: .readPlanHistory), as: [PlanHistoryEntry].self)
    }

    public func adoptPlan(id: String, idempotencyKey: String) async throws -> PlanAdoptionReceipt {
        try await send(makeRequest(route: .adoptPlan(id: id), idempotencyKey: idempotencyKey), as: PlanAdoptionReceipt.self)
    }

    public func submitFeedback(_ requestBody: MealFeedbackRequest) async throws -> FeedbackReceipt {
        var request = try await makeRequest(route: .submitFeedback)
        request.httpBody = try encoder.encode(requestBody)
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        return try await send(request, as: FeedbackReceipt.self)
    }

    public func submitWeeklyReview(_ requestBody: WeeklyReviewRequest) async throws -> FeedbackReceipt {
        var request = try await makeRequest(route: .submitFeedback)
        request.httpBody = try encoder.encode(requestBody)
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        return try await send(request, as: FeedbackReceipt.self)
    }

    private func makeRequest(route: ConsumerRoute, idempotencyKey: String? = nil) async throws -> URLRequest {
        guard let token = try await accessTokenProvider() else {
            throw APIErrorEnvelope(
                code: .authenticationRequired,
                userSafeMessage: "Please sign in again.",
                correlationID: "local-session-required",
                retryable: false
            )
        }
        let descriptor = route.descriptor
        guard let url = URL(string: descriptor.path, relativeTo: baseURL)?.absoluteURL else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.httpMethod = descriptor.method.rawValue
        request.timeoutInterval = 45
        request.setValue("application/json", forHTTPHeaderField: "accept")
        request.setValue("Bearer \(token.rawValue)", forHTTPHeaderField: "authorization")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "x-correlation-id")
        if let idempotencyKey { request.setValue(idempotencyKey, forHTTPHeaderField: "idempotency-key") }
        return request
    }

    private func send<Response: Decodable>(_ request: URLRequest, as type: Response.Type) async throws -> Response {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(http.statusCode) else {
            if let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data) { throw envelope }
            throw URLError(.badServerResponse)
        }
        return try decoder.decode(type, from: data)
    }
}
