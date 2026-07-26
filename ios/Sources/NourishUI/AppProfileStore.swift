import Foundation
import NourishAPI
import NourishCore

@MainActor
final class AppProfileStore: ObservableObject {
    enum PersistenceState: Equatable {
        case loading
        case ready
        case saving
        case failed(String)
    }

    enum SyncState: Equatable {
        case localOnly
        case syncing
        case synced(ProfileSyncAction)
        case pending(String)
    }

    @Published private(set) var storedProfile: StoredProfile?
    @Published private(set) var state: PersistenceState = .loading
    @Published private(set) var syncState: SyncState = .localOnly

    private let repository: FileProfileRepository?
    private var remoteRepository: URLSessionProfileRepository?
    private let userDefaults: UserDefaults
    private let pendingUploadKey = "nourish.profile.pending-upload"

    init(fileManager: FileManager = .default, userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
        if let applicationSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
            repository = FileProfileRepository(
                fileURL: applicationSupport
                    .appending(path: "ProjectNourish")
                    .appending(path: "profile.json")
            )
        } else {
            repository = nil
            state = .failed("Local profile storage is unavailable on this device.")
        }
    }

    func restore() async {
        guard let repository else { return }
        state = .loading
        do {
            storedProfile = try await repository.read()
            #if DEBUG
            if storedProfile == nil, ProcessInfo.processInfo.arguments.contains("-NourishSeedProfile") {
                var draft = OnboardingDraft()
                draft.confirmsAdult = true
                draft.confirmsGeneralWellnessFit = true
                draft.confirmsNutritionEstimates = true
                storedProfile = try await repository.update(
                    ProfileUpdateRequest(
                        profile: draft.profile(consentAcceptedAt: .now),
                        changeScope: .currentAndFuturePlans,
                        expectedRevision: 0
                    )
                )
                userDefaults.set(true, forKey: pendingUploadKey)
            }
            #endif
            state = .ready
        } catch {
            state = .failed("FamilyChef could not restore the local profile.")
        }
    }

    func saveOnboardingProfile(_ profile: UserProfile) async -> Bool {
        await saveProfile(profile, changeScope: .currentAndFuturePlans)
    }

    func saveProfile(_ profile: UserProfile, changeScope: ProfileChangeScope) async -> Bool {
        guard let repository else { return false }
        guard Self.isValid(profile) else {
            state = .failed("Check the target, meal slots, cooking days, region, and timezone.")
            return false
        }
        state = .saving
        do {
            let request = ProfileUpdateRequest(
                profile: profile,
                changeScope: changeScope,
                expectedRevision: storedProfile?.revision ?? 0
            )
            storedProfile = try await repository.update(request)
            userDefaults.set(true, forKey: pendingUploadKey)
            state = .ready
            await synchronizeIfPossible()
            return true
        } catch let error as APIErrorEnvelope where error.code == .conflict {
            do {
                storedProfile = try await repository.read()
            } catch {
                storedProfile = nil
            }
            state = .failed(error.userSafeMessage)
            return false
        } catch {
            state = .failed("FamilyChef could not save this profile. Please try again.")
            return false
        }
    }

    private static func isValid(_ profile: UserProfile) -> Bool {
        !profile.countryRegionCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && TimeZone(identifier: profile.timeZoneIdentifier) != nil
            && (1_200...3_500).contains(profile.calorieTarget)
            && profile.optionalDailyProteinTargetGrams.map { (10...300).contains($0) } != false
            && !profile.enabledMealSlots.isEmpty
            && !profile.cookingDays.isEmpty
            && (10...120).contains(profile.maximumActiveMinutes)
            && (0...7).contains(profile.batchPrepSessionsPerWeek)
    }

    var failureMessage: String? {
        guard case let .failed(message) = state else { return nil }
        return message
    }

    func connect(to remoteRepository: URLSessionProfileRepository) async {
        self.remoteRepository = remoteRepository
        await synchronizeIfPossible()
    }

    func disconnectRemote() {
        remoteRepository = nil
        syncState = .localOnly
    }

    var needsBackgroundSync: Bool {
        if case .pending = syncState { return true }
        return userDefaults.bool(forKey: pendingUploadKey)
    }

    @discardableResult
    func retrySynchronization() async -> Bool {
        await synchronizeIfPossible()
        return !needsBackgroundSync
    }

    func clearForAccountDeletion() async {
        try? await repository?.clear()
        userDefaults.removeObject(forKey: pendingUploadKey)
        storedProfile = nil
        state = .ready
        syncState = .localOnly
        remoteRepository = nil
    }

    private func synchronizeIfPossible() async {
        guard let repository, let remoteRepository else {
            syncState = .localOnly
            return
        }
        syncState = .syncing
        do {
            let result = try await ProfileSyncEngine(local: repository, remote: remoteRepository)
                .synchronize(localHasPendingChanges: userDefaults.bool(forKey: pendingUploadKey))
            storedProfile = result.localProfile
            userDefaults.set(false, forKey: pendingUploadKey)
            syncState = .synced(result.action)
            writeDevelopmentSyncProbe(state: "synced", action: result.action.rawValue)
        } catch let error as APIErrorEnvelope where error.code == .conflict {
            syncState = .pending("Your profile changed elsewhere. FamilyChef will retry after refreshing it.")
            writeDevelopmentSyncProbe(state: "pending", action: "conflict")
        } catch {
            syncState = .pending("Saved on this device. FamilyChef will sync when the service is available.")
            writeDevelopmentSyncProbe(state: "pending", action: "unavailable")
        }
    }

    private func writeDevelopmentSyncProbe(state: String, action: String) {
        #if DEBUG
        let payload: [String: Any] = [
            "state": state,
            "action": action,
            "localRevision": storedProfile?.revision ?? 0,
        ]
        guard
            let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]),
            let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        else { return }
        try? data.write(to: documentsURL.appendingPathComponent("profile-sync-probe.json"), options: .atomic)
        #endif
    }
}
