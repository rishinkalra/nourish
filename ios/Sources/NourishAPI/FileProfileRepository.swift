import Foundation
import NourishCore

public actor FileProfileRepository: ProfileRepository {
    private let fileURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(fileURL: URL) {
        self.fileURL = fileURL
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
    }

    public static func applicationSupport(
        fileManager: FileManager = .default,
        directoryName: String = "ProjectNourish"
    ) throws -> FileProfileRepository {
        guard let applicationSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            throw FileProfileRepositoryError.applicationSupportUnavailable
        }
        return FileProfileRepository(fileURL: applicationSupport.appending(path: directoryName).appending(path: "profile.json"))
    }

    public func read() async throws -> StoredProfile? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        let data = try Data(contentsOf: fileURL)
        return try decoder.decode(StoredProfile.self, from: data)
    }

    public func update(_ request: ProfileUpdateRequest) async throws -> StoredProfile {
        let current = try await read()
        let currentRevision = current?.revision ?? 0
        guard request.expectedRevision == currentRevision else {
            throw APIErrorEnvelope(
                code: .conflict,
                userSafeMessage: "Your preferences changed elsewhere. Refresh and try again.",
                correlationID: "local-profile-conflict",
                retryable: true
            )
        }

        let updated = StoredProfile(
            profile: request.profile,
            revision: currentRevision + 1,
            effectiveScope: request.changeScope
        )
        try persist(updated)
        return updated
    }

    public func clear() throws {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        try FileManager.default.removeItem(at: fileURL)
    }

    private func persist(_ profile: StoredProfile) throws {
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try encoder.encode(profile)
        try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}

public enum FileProfileRepositoryError: Error, Equatable, Sendable {
    case applicationSupportUnavailable
}
