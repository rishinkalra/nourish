import Foundation
import NourishAPI

@MainActor
final class AuthenticationStore: ObservableObject {
    enum State: Equatable {
        case restoring
        case signedOut
        case requestingMagicLink
        case magicLinkSent(email: String, resendAvailableAt: Date)
        case authenticated(SessionIdentity)
        case failed(String)
    }

    @Published private(set) var state: State = .restoring

    private let baseURL: URL
    private let manager: SessionManager<URLSessionAuthenticationRemote, KeychainSessionStorage>

    init(baseURL: URL) {
        self.baseURL = baseURL
        manager = SessionManager(
            remote: URLSessionAuthenticationRemote(baseURL: baseURL),
            storage: KeychainSessionStorage()
        )
    }

    func restore() async {
        state = .restoring
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-NourishResetSession") {
            try? await manager.signOut()
        }
        #endif
        do {
            state = viewState(for: try await manager.restore())
        } catch {
            state = .signedOut
        }

        #if DEBUG
        if let callbackURL = developmentMagicLinkURL {
            await handleMagicLink(callbackURL)
        }
        writeDevelopmentAuthenticationProbe()
        #endif
    }

    func requestMagicLink(email: String) async {
        let normalized = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard normalized.contains("@") else {
            state = .failed("Enter a valid email address.")
            return
        }
        state = .requestingMagicLink
        do {
            let receipt = try await manager.requestMagicLink(email: normalized)
            state = .magicLinkSent(email: normalized, resendAvailableAt: receipt.resendAvailableAt)
        } catch let error as APIErrorEnvelope {
            state = .failed(error.userSafeMessage)
        } catch {
            state = .failed("The development sign-in service is unavailable. You can continue in local preview.")
        }
    }

    func handleMagicLink(_ url: URL) async {
        guard url.scheme == "nourish", url.host == "auth", url.path == "/magic-link" else { return }
        do {
            state = viewState(for: try await manager.completeMagicLink(callbackURL: url))
        } catch let error as APIErrorEnvelope {
            state = .failed(error.userSafeMessage)
        } catch {
            state = .failed("This sign-in link could not be completed.")
        }
    }

    func signOut() async {
        do {
            try await manager.signOut()
            state = .signedOut
        } catch {
            state = .signedOut
        }
    }

    func validAccessToken() async throws -> SensitiveToken? {
        try await manager.validAccessToken()
    }

    func makeProfileRepository() -> URLSessionProfileRepository {
        let manager = manager
        return URLSessionProfileRepository(baseURL: baseURL) {
            try await manager.validAccessToken()
        }
    }

    func makePlanRemote() -> URLSessionPlanRemote {
        let manager = manager
        return URLSessionPlanRemote(baseURL: baseURL) {
            try await manager.validAccessToken()
        }
    }

    func makeWeeklyLoopRemote() -> URLSessionWeeklyLoopRemote {
        let manager = manager
        return URLSessionWeeklyLoopRemote(baseURL: baseURL) {
            try await manager.validAccessToken()
        }
    }

    func makeAccountRemote() -> URLSessionAccountRemote {
        let manager = manager
        return URLSessionAccountRemote(baseURL: baseURL) {
            try await manager.validAccessToken()
        }
    }

    func makeFeatureFlagRemote() -> URLSessionFeatureFlagRemote {
        let manager = manager
        return URLSessionFeatureFlagRemote(baseURL: baseURL) {
            try await manager.validAccessToken()
        }
    }

    func makeAnalyticsDimensionRemote() -> URLSessionAnalyticsDimensionRemote {
        let manager = manager
        return URLSessionAnalyticsDimensionRemote(baseURL: baseURL) {
            try await manager.validAccessToken()
        }
    }

    func makeAnalyticsEventRemote() -> URLSessionAnalyticsEventRemote {
        let manager = manager
        return URLSessionAnalyticsEventRemote(baseURL: baseURL) {
            try await manager.validAccessToken()
        }
    }

    var identity: SessionIdentity? {
        guard case let .authenticated(identity) = state else { return nil }
        return identity
    }

    #if DEBUG
    private var developmentMagicLinkURL: URL? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let flagIndex = arguments.firstIndex(of: "-NourishMagicLinkURL") else { return nil }
        let valueIndex = arguments.index(after: flagIndex)
        guard arguments.indices.contains(valueIndex) else { return nil }
        return URL(string: arguments[valueIndex])
    }

    private func writeDevelopmentAuthenticationProbe() {
        let payload: [String: String]
        if let identity {
            payload = ["state": "authenticated", "email": identity.verifiedEmail ?? ""]
        } else {
            payload = ["state": "signed_out"]
        }
        guard
            let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]),
            let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        else { return }
        try? data.write(to: documentsURL.appendingPathComponent("authentication-probe.json"), options: .atomic)
    }
    #endif

    private func viewState(for state: SessionState) -> State {
        switch state {
        case .signedOut: .signedOut
        case let .authenticated(identity): .authenticated(identity)
        }
    }
}
