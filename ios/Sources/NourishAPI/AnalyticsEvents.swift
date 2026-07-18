import Foundation

public enum ClientAnalyticsEventName: String, CaseIterable, Codable, Sendable {
    case appOpened = "app_opened"
    case onboardingStarted = "onboarding_started"
    case eligibilityCompleted = "eligibility_completed"
    case onboardingStepCompleted = "onboarding_step_completed"
    case onboardingCompleted = "onboarding_completed"
    case planPreviewViewed = "plan_preview_viewed"
    case mealDetailViewed = "meal_detail_viewed"
    case swapListViewed = "swap_list_viewed"
    case groceryListOpened = "grocery_list_opened"
    case prepPlanOpened = "prep_plan_opened"
    case paywallViewed = "paywall_viewed"
    case notificationOpened = "notification_opened"
}

public enum AnalyticsEventValue: Encodable, Equatable, Sendable {
    case string(String)
    case integer(Int)
    case number(Double)
    case boolean(Bool)
    case strings([String])

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case let .string(value): try container.encode(value)
        case let .integer(value): try container.encode(value)
        case let .number(value): try container.encode(value)
        case let .boolean(value): try container.encode(value)
        case let .strings(value): try container.encode(value)
        }
    }
}

public struct ClientAnalyticsEvent: Encodable, Equatable, Sendable {
    public let eventID: UUID
    public let eventName: ClientAnalyticsEventName
    public let schemaVersion: String
    public let occurredAt: Date
    public let properties: [String: AnalyticsEventValue]

    public init(
        eventID: UUID = UUID(),
        eventName: ClientAnalyticsEventName,
        occurredAt: Date = .now,
        properties: [String: AnalyticsEventValue]
    ) {
        self.eventID = eventID
        self.eventName = eventName
        schemaVersion = "1"
        self.occurredAt = occurredAt
        self.properties = properties
    }
}

public struct AnalyticsEventReceipt: Codable, Equatable, Sendable {
    public let eventID: UUID
    public let eventName: String
    public let schemaVersion: String
    public let acceptedAt: Date
    public let retentionExpiresAt: Date
    public let replay: Bool
    public let contractVersion: String

    public init(
        eventID: UUID,
        eventName: String,
        schemaVersion: String,
        acceptedAt: Date,
        retentionExpiresAt: Date,
        replay: Bool,
        contractVersion: String
    ) {
        self.eventID = eventID
        self.eventName = eventName
        self.schemaVersion = schemaVersion
        self.acceptedAt = acceptedAt
        self.retentionExpiresAt = retentionExpiresAt
        self.replay = replay
        self.contractVersion = contractVersion
    }
}

public struct AnalyticsConsentReceipt: Codable, Equatable, Sendable {
    public let enabled: Bool
    public let updatedAt: Date
    public let contractVersion: String

    public init(enabled: Bool, updatedAt: Date, contractVersion: String) {
        self.enabled = enabled
        self.updatedAt = updatedAt
        self.contractVersion = contractVersion
    }
}

public protocol AnalyticsEventRemote: Sendable {
    func setMeasurementEnabled(_ enabled: Bool) async throws -> AnalyticsConsentReceipt
    func record(_ event: ClientAnalyticsEvent) async throws -> AnalyticsEventReceipt
}

public struct URLSessionAnalyticsEventRemote: AnalyticsEventRemote {
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

    public func record(_ event: ClientAnalyticsEvent) async throws -> AnalyticsEventReceipt {
        try await send(
            path: "/v1/analytics/events",
            method: "POST",
            body: event,
            response: AnalyticsEventReceipt.self
        )
    }

    public func setMeasurementEnabled(_ enabled: Bool) async throws -> AnalyticsConsentReceipt {
        try await send(
            path: "/v1/analytics/consent",
            method: "PATCH",
            body: AnalyticsConsentBody(enabled: enabled),
            response: AnalyticsConsentReceipt.self
        )
    }

    private func send<Body: Encodable, Response: Decodable>(
        path: String,
        method: String,
        body: Body,
        response responseType: Response.Type
    ) async throws -> Response {
        guard let token = try await accessTokenProvider() else {
            throw APIErrorEnvelope(
                code: .authenticationRequired,
                userSafeMessage: "Please sign in again.",
                correlationID: "local-analytics-event-session-required",
                retryable: false
            )
        }
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "accept")
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue("Bearer \(token.rawValue)", forHTTPHeaderField: "authorization")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "x-correlation-id")
        request.httpBody = try encoder.encode(body)
        let (data, urlResponse) = try await session.data(for: request)
        guard let http = urlResponse as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(http.statusCode) else {
            if let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data) { throw envelope }
            throw URLError(.badServerResponse)
        }
        return try decoder.decode(responseType, from: data)
    }
}

private struct AnalyticsConsentBody: Encodable {
    let enabled: Bool
}
