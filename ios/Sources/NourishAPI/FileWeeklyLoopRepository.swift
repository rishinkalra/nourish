import Foundation
import NourishCore

public enum WeeklyLoopLocalMutation: Codable, Equatable, Sendable {
    case groceryDisposition(itemID: String, disposition: GroceryItemDisposition)
    case groceryQuantity(itemID: String, grams: Decimal?)
    case prepCompletion(taskID: String, isComplete: Bool)
    case mealCompletion(itemID: String, state: MealCompletionState)
    case swap(itemID: String, replacementRecipeID: String)
}

public struct PendingWeeklyLoopMutation: Codable, Equatable, Sendable {
    public var id: String
    public var baseRevision: Int
    public var resultingRevision: Int
    public var createdAt: Date
    public var mutation: WeeklyLoopLocalMutation

    public init(id: String, baseRevision: Int, resultingRevision: Int, createdAt: Date, mutation: WeeklyLoopLocalMutation) {
        self.id = id
        self.baseRevision = baseRevision
        self.resultingRevision = resultingRevision
        self.createdAt = createdAt
        self.mutation = mutation
    }
}

public struct StoredWeeklyLoop: Codable, Equatable, Sendable {
    public var snapshot: WeeklyLoopSnapshot
    public var pendingMutations: [PendingWeeklyLoopMutation]
    public var lastSyncedRevision: Int
    public var remoteGroceryRevision: Int?
    public var remoteMealRevisions: [String: Int]?
    public var remotePrepRevisions: [String: Int]?

    public init(
        snapshot: WeeklyLoopSnapshot,
        pendingMutations: [PendingWeeklyLoopMutation] = [],
        lastSyncedRevision: Int = 0,
        remoteGroceryRevision: Int? = nil,
        remoteMealRevisions: [String: Int]? = nil,
        remotePrepRevisions: [String: Int]? = nil
    ) {
        self.snapshot = snapshot
        self.pendingMutations = pendingMutations
        self.lastSyncedRevision = lastSyncedRevision
        self.remoteGroceryRevision = remoteGroceryRevision
        self.remoteMealRevisions = remoteMealRevisions
        self.remotePrepRevisions = remotePrepRevisions
    }
}

public enum FileWeeklyLoopRepositoryError: Error, Equatable, Sendable {
    case applicationSupportUnavailable
    case noStoredPlan
    case revisionConflict(expected: Int, actual: Int)
    case groceryItemNotFound
    case prepTaskNotFound
    case mealNotFound
    case invalidQuantity
    case swapRequiresValidatedSnapshot
}

public actor FileWeeklyLoopRepository {
    private let fileURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(fileURL: URL) {
        self.fileURL = fileURL
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
    }

    public static func applicationSupport(
        fileManager: FileManager = .default,
        directoryName: String = "ProjectNourish"
    ) throws -> FileWeeklyLoopRepository {
        guard let applicationSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            throw FileWeeklyLoopRepositoryError.applicationSupportUnavailable
        }
        return FileWeeklyLoopRepository(
            fileURL: applicationSupport.appending(path: directoryName).appending(path: "weekly-loop.json")
        )
    }

    public func read() throws -> StoredWeeklyLoop? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        return try decoder.decode(StoredWeeklyLoop.self, from: Data(contentsOf: fileURL))
    }

    public func clear() throws {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        try FileManager.default.removeItem(at: fileURL)
    }

    @discardableResult
    public func replace(
        with snapshot: WeeklyLoopSnapshot,
        markSynced: Bool,
        remoteGroceryRevision: Int? = nil,
        remoteMealRevisions: [String: Int]? = nil,
        remotePrepRevisions: [String: Int]? = nil
    ) throws -> StoredWeeklyLoop {
        let stored = StoredWeeklyLoop(
            snapshot: snapshot,
            pendingMutations: [],
            lastSyncedRevision: markSynced ? snapshot.revision : 0,
            remoteGroceryRevision: remoteGroceryRevision,
            remoteMealRevisions: remoteMealRevisions,
            remotePrepRevisions: remotePrepRevisions
        )
        try persist(stored)
        return stored
    }

    @discardableResult
    public func applyLocal(
        id mutationID: String,
        mutation: WeeklyLoopLocalMutation,
        expectedRevision: Int,
        at createdAt: Date = .now
    ) throws -> StoredWeeklyLoop {
        guard var stored = try read() else { throw FileWeeklyLoopRepositoryError.noStoredPlan }
        if stored.pendingMutations.contains(where: { $0.id == mutationID }) { return stored }
        guard expectedRevision == stored.snapshot.revision else {
            throw FileWeeklyLoopRepositoryError.revisionConflict(expected: expectedRevision, actual: stored.snapshot.revision)
        }
        switch mutation {
        case let .groceryDisposition(itemID, disposition):
            guard let index = stored.snapshot.groceryList.items.firstIndex(where: { $0.id == itemID }) else {
                throw FileWeeklyLoopRepositoryError.groceryItemNotFound
            }
            stored.snapshot.groceryList.items[index].disposition = disposition
        case let .groceryQuantity(itemID, grams):
            if let grams, grams <= 0 { throw FileWeeklyLoopRepositoryError.invalidQuantity }
            guard let index = stored.snapshot.groceryList.items.firstIndex(where: { $0.id == itemID }) else {
                throw FileWeeklyLoopRepositoryError.groceryItemNotFound
            }
            stored.snapshot.groceryList.items[index].userAdjustedGrams = grams
        case let .prepCompletion(taskID, isComplete):
            guard let index = stored.snapshot.prepTimeline.tasks.firstIndex(where: { $0.id == taskID }) else {
                throw FileWeeklyLoopRepositoryError.prepTaskNotFound
            }
            stored.snapshot.prepTimeline.tasks[index].isComplete = isComplete
        case let .mealCompletion(itemID, state):
            guard let position = mealPosition(itemID: itemID, in: stored.snapshot.plan) else {
                throw FileWeeklyLoopRepositoryError.mealNotFound
            }
            stored.snapshot.plan.days[position.day].items[position.item].completionState = state
        case .swap:
            // Swap snapshots are produced by WeeklyLoopEngine and stored through applySwap.
            throw FileWeeklyLoopRepositoryError.swapRequiresValidatedSnapshot
        }
        append(mutationID: mutationID, mutation: mutation, createdAt: createdAt, to: &stored)
        try persist(stored)
        return stored
    }

    @discardableResult
    public func applySwap(
        id mutationID: String,
        itemID: String,
        replacement: RecipeSnapshot,
        profile: UserProfile,
        expectedRevision: Int,
        recentRecipeIDs: Set<String> = [],
        at createdAt: Date = .now
    ) throws -> StoredWeeklyLoop {
        guard var stored = try read() else { throw FileWeeklyLoopRepositoryError.noStoredPlan }
        if stored.pendingMutations.contains(where: { $0.id == mutationID }) { return stored }
        guard expectedRevision == stored.snapshot.revision else {
            throw FileWeeklyLoopRepositoryError.revisionConflict(expected: expectedRevision, actual: stored.snapshot.revision)
        }
        let result = try WeeklyLoopEngine.applySwap(
            to: stored.snapshot,
            expectedRevision: expectedRevision,
            mutationID: mutationID,
            itemID: itemID,
            replacement: replacement,
            profile: profile,
            recentRecipeIDs: recentRecipeIDs
        )
        stored.snapshot = result.snapshot
        stored.pendingMutations.append(PendingWeeklyLoopMutation(
            id: mutationID,
            baseRevision: expectedRevision,
            resultingRevision: result.snapshot.revision,
            createdAt: createdAt,
            mutation: .swap(itemID: itemID, replacementRecipeID: replacement.recipeID)
        ))
        try persist(stored)
        return stored
    }

    @discardableResult
    public func markSynced(through revision: Int) throws -> StoredWeeklyLoop {
        guard var stored = try read() else { throw FileWeeklyLoopRepositoryError.noStoredPlan }
        let boundedRevision = min(revision, stored.snapshot.revision)
        stored.pendingMutations.removeAll { $0.resultingRevision <= boundedRevision }
        stored.lastSyncedRevision = max(stored.lastSyncedRevision, boundedRevision)
        try persist(stored)
        return stored
    }

    @discardableResult
    public func updateRemoteRevisions(
        groceryRevision: Int? = nil,
        mealRevisions: [String: Int]? = nil,
        prepRevisions: [String: Int]? = nil
    ) throws -> StoredWeeklyLoop {
        guard var stored = try read() else { throw FileWeeklyLoopRepositoryError.noStoredPlan }
        if let groceryRevision { stored.remoteGroceryRevision = groceryRevision }
        if let mealRevisions { stored.remoteMealRevisions = mealRevisions }
        if let prepRevisions { stored.remotePrepRevisions = prepRevisions }
        try persist(stored)
        return stored
    }

    private func append(
        mutationID: String,
        mutation: WeeklyLoopLocalMutation,
        createdAt: Date,
        to stored: inout StoredWeeklyLoop
    ) {
        let baseRevision = stored.snapshot.revision
        stored.snapshot.revision += 1
        stored.snapshot.lastMutationID = mutationID
        stored.pendingMutations.append(PendingWeeklyLoopMutation(
            id: mutationID,
            baseRevision: baseRevision,
            resultingRevision: stored.snapshot.revision,
            createdAt: createdAt,
            mutation: mutation
        ))
    }

    private func mealPosition(itemID: String, in plan: WeeklyPlan) -> (day: Int, item: Int)? {
        guard let day = plan.days.firstIndex(where: { $0.items.contains(where: { $0.id == itemID }) }),
              let item = plan.days[day].items.firstIndex(where: { $0.id == itemID }) else { return nil }
        return (day, item)
    }

    private func persist(_ stored: StoredWeeklyLoop) throws {
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try encoder.encode(stored).write(
            to: fileURL,
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
        )
    }
}
