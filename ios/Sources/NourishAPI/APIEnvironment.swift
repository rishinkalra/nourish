import Foundation

public enum APIBaseURLConfigurationError: Error, Equatable, Sendable {
    case missing
    case placeholder
    case invalidOrigin
    case insecureRemoteOrigin
}

public enum APIBaseURLPolicy {
    public static func validated(rawValue: String?, allowsLocalHTTP: Bool) throws -> URL {
        guard let rawValue = rawValue?.trimmingCharacters(in: .whitespacesAndNewlines),
              !rawValue.isEmpty else {
            throw APIBaseURLConfigurationError.missing
        }
        guard !rawValue.localizedCaseInsensitiveContains("CHANGE_ME") else {
            throw APIBaseURLConfigurationError.placeholder
        }
        guard var components = URLComponents(string: rawValue),
              let scheme = components.scheme?.lowercased(),
              let host = components.host?.lowercased(),
              !host.isEmpty,
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil,
              components.path.isEmpty || components.path == "/" else {
            throw APIBaseURLConfigurationError.invalidOrigin
        }
        if scheme != "https" {
            let localHosts = Set(["localhost", "127.0.0.1", "::1"])
            guard scheme == "http", allowsLocalHTTP, localHosts.contains(host) else {
                throw APIBaseURLConfigurationError.insecureRemoteOrigin
            }
        }
        components.scheme = scheme
        components.host = host
        components.path = ""
        guard let url = components.url else {
            throw APIBaseURLConfigurationError.invalidOrigin
        }
        return url
    }
}
