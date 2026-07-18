import Foundation
import NourishAPI
import NourishCore

@MainActor
final class ActiveWeeklyLoopStore: ObservableObject {
    enum State: Equatable {
        case signedOut
        case loading
        case noActivePlan
        case synced
        case pending(String)
        case conflict(String)
    }

    @Published private(set) var snapshot: WeeklyLoopSnapshot?
    @Published private(set) var state: State = .signedOut

    private var connectedUserID: String?
    private var repository: FileWeeklyLoopRepository?
    private var syncEngine: WeeklyLoopSyncEngine?
    private var remote: (any WeeklyLoopRemote)?

    func connect(userID: String, remote: any WeeklyLoopRemote, fileManager: FileManager = .default) async {
        if connectedUserID == userID, syncEngine != nil {
            await synchronize()
            return
        }
        guard let applicationSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            state = .pending("Weekly plan storage is unavailable on this device.")
            return
        }
        let safeUserID = userID.map { $0.isLetter || $0.isNumber ? $0 : "_" }.reduce(into: "") { $0.append($1) }
        let repository = FileWeeklyLoopRepository(
            fileURL: applicationSupport
                .appending(path: "ProjectNourish")
                .appending(path: "weekly-loop-\(safeUserID).json")
        )
        connectedUserID = userID
        self.repository = repository
        self.remote = remote
        syncEngine = WeeklyLoopSyncEngine(repository: repository, remote: remote)
        state = .loading
        if let local = try? await repository.read() {
            snapshot = local.snapshot
        }
        await synchronize()
    }

    func disconnect() {
        connectedUserID = nil
        repository = nil
        syncEngine = nil
        remote = nil
        snapshot = nil
        state = .signedOut
    }

    func clearForAccountDeletion() async {
        try? await repository?.clear()
        disconnect()
    }

    @discardableResult
    func retry() async -> Bool {
        await synchronize()
        return !needsBackgroundSync
    }

    var needsBackgroundSync: Bool {
        if case .pending = state { return true }
        return false
    }

    func setMealState(_ completionState: MealCompletionState, itemID: String) async {
        await apply(.mealCompletion(itemID: itemID, state: completionState))
    }

    func toggleGrocery(itemID: String) async {
        guard let item = snapshot?.groceryList.items.first(where: { $0.id == itemID }) else { return }
        let next: GroceryItemDisposition = item.disposition == .checked ? .needed : .checked
        await apply(.groceryDisposition(itemID: itemID, disposition: next))
    }

    func toggleAlreadyHave(itemID: String) async {
        guard let item = snapshot?.groceryList.items.first(where: { $0.id == itemID }) else { return }
        let next: GroceryItemDisposition = item.disposition == .alreadyHave ? .needed : .alreadyHave
        await apply(.groceryDisposition(itemID: itemID, disposition: next))
    }

    func adjustGroceryQuantity(itemID: String, by grams: Decimal) async {
        guard let item = snapshot?.groceryList.items.first(where: { $0.id == itemID }) else { return }
        await apply(.groceryQuantity(itemID: itemID, grams: max(1, item.effectiveGrams + grams)))
    }

    func togglePrep(taskID: String) async {
        guard let task = snapshot?.prepTimeline.tasks.first(where: { $0.id == taskID }) else { return }
        await apply(.prepCompletion(taskID: taskID, isComplete: !task.isComplete))
    }

    func swapCandidates(itemID: String) async -> [SwapCandidate] {
        guard let remote else { return [] }
        do {
            return try await remote.swapCandidates(planItemID: itemID)
        } catch {
            state = .pending("Safe swaps are unavailable offline. Your current week is still available.")
            return []
        }
    }

    func confirmSwap(itemID: String, replacementRecipeID: String) async -> Bool {
        guard let remote, let repository else { return false }
        do {
            let receipt = try await remote.confirmSwap(
                planItemID: itemID,
                replacementRecipeID: replacementRecipeID,
                idempotencyKey: UUID().uuidString
            )
            let updated = WeeklyLoopSnapshot(
                plan: receipt.plan,
                groceryList: receipt.groceryList,
                prepTimeline: receipt.prepTimeline,
                revision: max(1, receipt.revision)
            )
            let stored = try await repository.replace(
                with: updated,
                markSynced: true,
                remoteGroceryRevision: 1,
                remoteMealRevisions: Dictionary(uniqueKeysWithValues: updated.plan.days.flatMap(\.items).map { ($0.id, 0) }),
                remotePrepRevisions: Dictionary(uniqueKeysWithValues: updated.prepTimeline.tasks.map { ($0.id, 0) })
            )
            snapshot = stored.snapshot
            state = .synced
            return true
        } catch let error as APIErrorEnvelope where error.code == .conflict {
            state = .conflict(error.userSafeMessage)
            return false
        } catch {
            state = .pending("The swap was not confirmed. Your existing plan is unchanged.")
            return false
        }
    }

    #if DEBUG
    func installDevelopmentFixture(
        _ fixture: DevelopmentWeeklyLoopFixture,
        isOnline: Bool,
        reset: Bool,
        fileManager: FileManager = .default
    ) async {
        guard let applicationSupport = fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first else {
            state = .pending("Weekly plan storage is unavailable on this device.")
            return
        }
        let repository = FileWeeklyLoopRepository(
            fileURL: applicationSupport
                .appending(path: "ProjectNourish")
                .appending(path: "weekly-loop-ui-fixture.json")
        )
        if reset { try? await repository.clear() }
        do {
            if try await repository.read() == nil {
                _ = try await repository.replace(
                    with: fixture.snapshot,
                    markSynced: true,
                    remoteGroceryRevision: 1,
                    remoteMealRevisions: Dictionary(
                        uniqueKeysWithValues: fixture.snapshot.plan.days
                            .flatMap(\.items)
                            .map { ($0.id, 0) }
                    ),
                    remotePrepRevisions: Dictionary(
                        uniqueKeysWithValues: fixture.snapshot.prepTimeline.tasks.map { ($0.id, 0) }
                    )
                )
            }
        } catch {
            state = .pending("The development week could not be prepared.")
            return
        }

        let remote = DevelopmentWeeklyLoopRemote(fixture: fixture, isOnline: isOnline)
        connectedUserID = "ui-fixture-user"
        self.repository = repository
        self.remote = remote
        syncEngine = WeeklyLoopSyncEngine(repository: repository, remote: remote)
        state = .loading
        if let local = try? await repository.read() {
            snapshot = local.snapshot
        }
        await synchronize()
    }
    #endif

    private func apply(_ mutation: WeeklyLoopLocalMutation) async {
        guard let repository, let snapshot else { return }
        do {
            let stored = try await repository.applyLocal(
                id: UUID().uuidString,
                mutation: mutation,
                expectedRevision: snapshot.revision
            )
            self.snapshot = stored.snapshot
            state = .pending("Saved on this device; synchronizing…")
            await synchronize()
        } catch FileWeeklyLoopRepositoryError.revisionConflict {
            state = .conflict("This week changed on the device. Refresh before trying again.")
        } catch {
            state = .pending("The change could not be saved. Please try again.")
        }
    }

    private func synchronize() async {
        guard let syncEngine else { return }
        if snapshot == nil { state = .loading }
        let outcome = await syncEngine.restoreAndSynchronize()
        switch outcome {
        case .noActivePlan:
            snapshot = nil
            state = .noActivePlan
        case let .synced(stored):
            snapshot = stored.snapshot
            state = .synced
            writeDevelopmentProbe(state: "synced", snapshot: stored.snapshot, pendingCount: 0)
        case let .localPending(stored, message):
            snapshot = stored.snapshot
            state = message.localizedCaseInsensitiveContains("changed elsewhere") ? .conflict(message) : .pending(message)
            writeDevelopmentProbe(state: "pending", snapshot: stored.snapshot, pendingCount: stored.pendingMutations.count)
        }
    }

    private func writeDevelopmentProbe(state: String, snapshot: WeeklyLoopSnapshot, pendingCount: Int) {
        #if DEBUG
        let payload: [String: Any] = [
            "state": state,
            "planID": snapshot.plan.id,
            "revision": snapshot.revision,
            "pendingMutationCount": pendingCount,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]),
              let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        try? data.write(to: documents.appending(path: "weekly-loop-sync-probe.json"), options: .atomic)
        #endif
    }
}
