import Foundation

public enum AnalyticsAcquisitionSource: String, CaseIterable, Codable, Sendable {
    case unknown
    case organic
    case appStoreSearch = "app_store_search"
    case referral
    case paidSocial = "paid_social"

    public static func captured(from url: URL) -> AnalyticsAcquisitionSource? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let rawValue = components.queryItems?.first(where: { $0.name == "acquisition_source" })?.value,
              let source = AnalyticsAcquisitionSource(rawValue: rawValue.lowercased()),
              source != .unknown else { return nil }
        return source
    }
}

public struct AnalyticsDimensionReceipt: Codable, Equatable, Sendable {
    public let firstAppVersion: String
    public let latestAppVersion: String
    public let acquisitionSource: AnalyticsAcquisitionSource
    public let firstSeenAt: Date
    public let updatedAt: Date
    public let contractVersion: String

    public init(
        firstAppVersion: String,
        latestAppVersion: String,
        acquisitionSource: AnalyticsAcquisitionSource,
        firstSeenAt: Date,
        updatedAt: Date,
        contractVersion: String
    ) {
        self.firstAppVersion = firstAppVersion
        self.latestAppVersion = latestAppVersion
        self.acquisitionSource = acquisitionSource
        self.firstSeenAt = firstSeenAt
        self.updatedAt = updatedAt
        self.contractVersion = contractVersion
    }
}

public protocol AnalyticsDimensionRemote: Sendable {
    func record(appVersion: String, acquisitionSource: AnalyticsAcquisitionSource) async throws -> AnalyticsDimensionReceipt
}

public struct URLSessionAnalyticsDimensionRemote: AnalyticsDimensionRemote {
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

    public func record(appVersion: String, acquisitionSource: AnalyticsAcquisitionSource) async throws -> AnalyticsDimensionReceipt {
        guard let token = try await accessTokenProvider() else {
            throw APIErrorEnvelope(
                code: .authenticationRequired,
                userSafeMessage: "Please sign in again.",
                correlationID: "local-analytics-session-required",
                retryable: false
            )
        }
        guard let url = URL(string: "/v1/analytics/dimensions", relativeTo: baseURL)?.absoluteURL else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "accept")
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue("Bearer \(token.rawValue)", forHTTPHeaderField: "authorization")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "x-correlation-id")
        request.httpBody = try encoder.encode(AnalyticsDimensionBody(appVersion: appVersion, acquisitionSource: acquisitionSource))
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(http.statusCode) else {
            if let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data) { throw envelope }
            throw URLError(.badServerResponse)
        }
        return try decoder.decode(AnalyticsDimensionReceipt.self, from: data)
    }
}

private struct AnalyticsDimensionBody: Codable, Sendable {
    let appVersion: String
    let acquisitionSource: AnalyticsAcquisitionSource
}
