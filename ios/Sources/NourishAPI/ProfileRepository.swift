import Foundation
import NourishCore

public struct StoredProfile: Codable, Equatable, Sendable {
    public var profile: UserProfile
    public var revision: Int
    public var effectiveScope: ProfileChangeScope

    public init(profile: UserProfile, revision: Int, effectiveScope: ProfileChangeScope) {
        self.profile = profile
        self.revision = revision
        self.effectiveScope = effectiveScope
    }
}

public protocol ProfileRepository: Sendable {
    func read() async throws -> StoredProfile?
    func update(_ request: ProfileUpdateRequest) async throws -> StoredProfile
}

public actor InMemoryProfileRepository: ProfileRepository {
    private var stored: StoredProfile?

    public init(seed: StoredProfile? = nil) {
        stored = seed
    }

    public func read() async throws -> StoredProfile? {
        stored
    }

    public func update(_ request: ProfileUpdateRequest) async throws -> StoredProfile {
        let currentRevision = stored?.revision ?? 0
        guard request.expectedRevision == currentRevision else {
            throw APIErrorEnvelope(
                code: .conflict,
                userSafeMessage: "Your preferences changed elsewhere. Refresh and try again.",
                correlationID: "local-profile-conflict",
                retryable: true
            )
        }
        let updated = StoredProfile(profile: request.profile, revision: currentRevision + 1, effectiveScope: request.changeScope)
        stored = updated
        return updated
    }
}
