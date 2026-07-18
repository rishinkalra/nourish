import Foundation
import NourishCore

public enum ProfileSyncAction: String, Equatable, Sendable {
    case noProfile
    case alreadyCurrent
    case uploadedLocal
    case downloadedRemote
}

public struct ProfileSyncResult: Equatable, Sendable {
    public let action: ProfileSyncAction
    public let localProfile: StoredProfile?
    public let remoteRevision: Int?

    public init(action: ProfileSyncAction, localProfile: StoredProfile?, remoteRevision: Int?) {
        self.action = action
        self.localProfile = localProfile
        self.remoteRevision = remoteRevision
    }
}

/// Reconciles a file-protected local profile with the authenticated profile API.
/// Local changes win only when the caller has recorded an unsynchronized edit;
/// otherwise the server is authoritative for an existing account.
public struct ProfileSyncEngine: Sendable {
    private let local: any ProfileRepository
    private let remote: any ProfileRepository

    public init(local: any ProfileRepository, remote: any ProfileRepository) {
        self.local = local
        self.remote = remote
    }

    public func synchronize(localHasPendingChanges: Bool) async throws -> ProfileSyncResult {
        async let localRead = local.read()
        async let remoteRead = remote.read()
        let (localProfile, remoteProfile) = try await (localRead, remoteRead)

        switch (localProfile, remoteProfile) {
        case (nil, nil):
            return ProfileSyncResult(action: .noProfile, localProfile: nil, remoteRevision: nil)

        case let (localProfile?, nil):
            let uploaded = try await remote.update(
                ProfileUpdateRequest(
                    profile: localProfile.profile,
                    changeScope: localProfile.effectiveScope,
                    expectedRevision: 0
                )
            )
            return ProfileSyncResult(
                action: .uploadedLocal,
                localProfile: localProfile,
                remoteRevision: uploaded.revision
            )

        case let (nil, remoteProfile?):
            let downloaded = try await local.update(
                ProfileUpdateRequest(
                    profile: remoteProfile.profile,
                    changeScope: remoteProfile.effectiveScope,
                    expectedRevision: 0
                )
            )
            return ProfileSyncResult(
                action: .downloadedRemote,
                localProfile: downloaded,
                remoteRevision: remoteProfile.revision
            )

        case let (localProfile?, remoteProfile?):
            if localProfile.profile == remoteProfile.profile {
                return ProfileSyncResult(
                    action: .alreadyCurrent,
                    localProfile: localProfile,
                    remoteRevision: remoteProfile.revision
                )
            }

            if localHasPendingChanges {
                let uploaded = try await remote.update(
                    ProfileUpdateRequest(
                        profile: localProfile.profile,
                        changeScope: localProfile.effectiveScope,
                        expectedRevision: remoteProfile.revision
                    )
                )
                return ProfileSyncResult(
                    action: .uploadedLocal,
                    localProfile: localProfile,
                    remoteRevision: uploaded.revision
                )
            }

            let downloaded = try await local.update(
                ProfileUpdateRequest(
                    profile: remoteProfile.profile,
                    changeScope: remoteProfile.effectiveScope,
                    expectedRevision: localProfile.revision
                )
            )
            return ProfileSyncResult(
                action: .downloadedRemote,
                localProfile: downloaded,
                remoteRevision: remoteProfile.revision
            )
        }
    }
}
