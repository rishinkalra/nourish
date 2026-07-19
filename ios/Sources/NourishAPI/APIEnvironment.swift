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
            guard scheme == "http", allowsLocalHTTP, isPrivateDevelopmentHost(host) else {
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

    private static func isPrivateDevelopmentHost(_ host: String) -> Bool {
        if ["localhost", "127.0.0.1", "::1"].contains(host) || host.hasSuffix(".local") {
            return true
        }
        let octets = host.split(separator: ".").compactMap { Int($0) }
        if octets.count == 4, octets.allSatisfy({ (0...255).contains($0) }) {
            return octets[0] == 10
                || (octets[0] == 172 && (16...31).contains(octets[1]))
                || (octets[0] == 192 && octets[1] == 168)
                || (octets[0] == 169 && octets[1] == 254)
        }
        return host.hasPrefix("fc") || host.hasPrefix("fd") || host.hasPrefix("fe8") || host.hasPrefix("fe9")
            || host.hasPrefix("fea") || host.hasPrefix("feb")
    }
}
