import Foundation
import NourishCore

public enum WeeklyLoopSyncOutcome: Equatable, Sendable {
    case noActivePlan
    case synced(StoredWeeklyLoop)
    case localPending(StoredWeeklyLoop, message: String)
}

public actor WeeklyLoopSyncEngine {
    private let repository: FileWeeklyLoopRepository
    private let remote: any WeeklyLoopRemote

    public init(repository: FileWeeklyLoopRepository, remote: any WeeklyLoopRemote) {
        self.repository = repository
        self.remote = remote
    }

    public func restoreAndSynchronize() async -> WeeklyLoopSyncOutcome {
        // A missing or unreadable cache must not prevent an authenticated account
        // from restoring its adopted plan from the service.
        let local = try? await repository.read()
        do {
            if let local, !local.pendingMutations.isEmpty {
                try await replay(local)
            }
            let active = try await remote.readActiveWeeklyLoop()
            let stored = try await persist(active)
            return .synced(stored)
        } catch let error as APIErrorEnvelope where isNoActivePlan(error) {
            try? await repository.clear()
            return .noActivePlan
        } catch let error as APIErrorEnvelope where error.code == .conflict {
            if let current = try? await repository.read() {
                return .localPending(current, message: "This week changed elsewhere. Review it before retrying your saved changes.")
            }
            return .noActivePlan
        } catch {
            if let current = try? await repository.read() {
                return .localPending(current, message: "Saved on this device. Nourish will retry when the service is available.")
            }
            return .noActivePlan
        }
    }

    private func replay(_ initial: StoredWeeklyLoop) async throws {
        var groceryRevision = initial.remoteGroceryRevision ?? 1
        var mealRevisions = initial.remoteMealRevisions ?? [:]
        var prepRevisions = initial.remotePrepRevisions ?? [:]
        for pending in initial.pendingMutations.sorted(by: { $0.resultingRevision < $1.resultingRevision }) {
            switch pending.mutation {
            case let .groceryDisposition(itemID, disposition):
                let updated = try await remote.updateGroceryList(
                    id: initial.snapshot.groceryList.id,
                    patch: GroceryListPatch(
                        expectedRevision: groceryRevision,
                        changes: [GroceryItemPatch(itemID: itemID, disposition: disposition)]
                    )
                )
                groceryRevision = updated.revision
            case let .groceryQuantity(itemID, grams):
                guard let grams else { continue }
                let updated = try await remote.updateGroceryList(
                    id: initial.snapshot.groceryList.id,
                    patch: GroceryListPatch(
                        expectedRevision: groceryRevision,
                        changes: [GroceryItemPatch(itemID: itemID, userAdjustedGrams: grams)]
                    )
                )
                groceryRevision = updated.revision
            case let .mealCompletion(itemID, state):
                let receipt = try await remote.updateMealStatus(
                    planItemID: itemID,
                    state: state,
                    expectedRevision: mealRevisions[itemID, default: 0]
                )
                mealRevisions[itemID] = receipt.revision
            case let .prepCompletion(taskID, isComplete):
                let receipt = try await remote.updatePrepTask(
                    id: taskID,
                    isComplete: isComplete,
                    expectedRevision: prepRevisions[taskID, default: 0]
                )
                prepRevisions[taskID] = receipt.revision
            case .swap:
                throw APIErrorEnvelope(
                    code: .conflict,
                    userSafeMessage: "An offline swap needs review before it can be confirmed.",
                    correlationID: "offline-swap-review",
                    retryable: true
                )
            }
            _ = try await repository.updateRemoteRevisions(
                groceryRevision: groceryRevision,
                mealRevisions: mealRevisions,
                prepRevisions: prepRevisions
            )
            _ = try await repository.markSynced(through: pending.resultingRevision)
        }
    }

    private func persist(_ active: ActiveWeeklyLoopEnvelope) async throws -> StoredWeeklyLoop {
        let groceries = GroceryList(
            id: active.groceryList.id,
            planID: active.groceryList.planID,
            items: active.groceryList.items
        )
        let snapshot = WeeklyLoopSnapshot(
            plan: active.plan,
            groceryList: groceries,
            prepTimeline: active.prepTimeline,
            revision: max(1, active.revision)
        )
        return try await repository.replace(
            with: snapshot,
            markSynced: true,
            remoteGroceryRevision: active.operationalRevisions.grocery,
            remoteMealRevisions: active.operationalRevisions.meals,
            remotePrepRevisions: active.operationalRevisions.prep
        )
    }

    private func isNoActivePlan(_ error: APIErrorEnvelope) -> Bool {
        error.code == .validationError && error.userSafeMessage.localizedCaseInsensitiveContains("no active plan")
    }
}
