import Foundation
import NourishCore

public struct SwapConfirmationEnvelope: Codable, Equatable, Sendable {
    public var plan: WeeklyPlan
    public var groceryList: GroceryList
    public var prepTimeline: PrepTimeline
    public var revision: Int
    public var supersedesPlanID: String
    public var swappedAt: Date

    public init(plan: WeeklyPlan, groceryList: GroceryList, prepTimeline: PrepTimeline, revision: Int, supersedesPlanID: String, swappedAt: Date) {
        self.plan = plan
        self.groceryList = groceryList
        self.prepTimeline = prepTimeline
        self.revision = revision
        self.supersedesPlanID = supersedesPlanID
        self.swappedAt = swappedAt
    }
}

public struct RemoteGroceryList: Codable, Equatable, Sendable {
    public var id: String
    public var planID: String
    public var items: [GroceryItem]
    public var revision: Int

    public init(id: String, planID: String, items: [GroceryItem], revision: Int) {
        self.id = id
        self.planID = planID
        self.items = items
        self.revision = revision
    }
}

public struct ActiveWeeklyLoopEnvelope: Codable, Equatable, Sendable {
    public var plan: WeeklyPlan
    public var diagnostics: PlannerDiagnostics
    public var groceryList: RemoteGroceryList
    public var prepTimeline: PrepTimeline
    public var revision: Int
    public var operationalRevisions: WeeklyLoopOperationalRevisions

    public init(plan: WeeklyPlan, diagnostics: PlannerDiagnostics, groceryList: RemoteGroceryList, prepTimeline: PrepTimeline, revision: Int, operationalRevisions: WeeklyLoopOperationalRevisions) {
        self.plan = plan
        self.diagnostics = diagnostics
        self.groceryList = groceryList
        self.prepTimeline = prepTimeline
        self.revision = revision
        self.operationalRevisions = operationalRevisions
    }
}

public struct WeeklyLoopOperationalRevisions: Codable, Equatable, Sendable {
    public var grocery: Int
    public var meals: [String: Int]
    public var prep: [String: Int]

    public init(grocery: Int, meals: [String: Int], prep: [String: Int]) {
        self.grocery = grocery
        self.meals = meals
        self.prep = prep
    }
}

public struct MealStatusReceipt: Codable, Equatable, Sendable {
    public var itemID: String
    public var state: MealCompletionState
    public var revision: Int
    public var updatedAt: Date

    public init(itemID: String, state: MealCompletionState, revision: Int, updatedAt: Date) {
        self.itemID = itemID
        self.state = state
        self.revision = revision
        self.updatedAt = updatedAt
    }
}

public struct PrepTaskReceipt: Codable, Equatable, Sendable {
    public var taskID: String
    public var isComplete: Bool
    public var revision: Int
    public var updatedAt: Date

    public init(taskID: String, isComplete: Bool, revision: Int, updatedAt: Date) {
        self.taskID = taskID
        self.isComplete = isComplete
        self.revision = revision
        self.updatedAt = updatedAt
    }
}

public struct GroceryItemPatch: Codable, Equatable, Sendable {
    public var itemID: String
    public var disposition: GroceryItemDisposition?
    public var userAdjustedGrams: Decimal?

    public init(itemID: String, disposition: GroceryItemDisposition? = nil, userAdjustedGrams: Decimal? = nil) {
        self.itemID = itemID
        self.disposition = disposition
        self.userAdjustedGrams = userAdjustedGrams
    }
}

public struct GroceryListPatch: Codable, Equatable, Sendable {
    public var expectedRevision: Int
    public var changes: [GroceryItemPatch]

    public init(expectedRevision: Int, changes: [GroceryItemPatch]) {
        self.expectedRevision = expectedRevision
        self.changes = changes
    }
}

public protocol WeeklyLoopRemote: Sendable {
    func readActiveWeeklyLoop() async throws -> ActiveWeeklyLoopEnvelope
    func swapCandidates(planItemID: String) async throws -> [SwapCandidate]
    func confirmSwap(planItemID: String, replacementRecipeID: String, idempotencyKey: String) async throws -> SwapConfirmationEnvelope
    func readGroceryList(id: String) async throws -> RemoteGroceryList
    func updateGroceryList(id: String, patch: GroceryListPatch) async throws -> RemoteGroceryList
    func updateMealStatus(planItemID: String, state: MealCompletionState, expectedRevision: Int) async throws -> MealStatusReceipt
    func updatePrepTask(id: String, isComplete: Bool, expectedRevision: Int) async throws -> PrepTaskReceipt
}

public struct URLSessionWeeklyLoopRemote: WeeklyLoopRemote {
    private let baseURL: URL
    private let session: URLSession
    private let accessTokenProvider: @Sendable () async throws -> SensitiveToken?
    private let encoder = URLSessionAuthenticationRemote.makeEncoder()
    private let decoder = URLSessionAuthenticationRemote.makeDecoder()

    public init(
        baseURL: URL,
        session: URLSession = .shared,
        accessTokenProvider: @escaping @Sendable () async throws -> SensitiveToken?
    ) {
        self.baseURL = baseURL
        self.session = session
        self.accessTokenProvider = accessTokenProvider
    }

    public func readActiveWeeklyLoop() async throws -> ActiveWeeklyLoopEnvelope {
        try await send(makeRequest(route: .readActivePlan), as: ActiveWeeklyLoopEnvelope.self)
    }

    public func swapCandidates(planItemID: String) async throws -> [SwapCandidate] {
        try await send(makeRequest(route: .readSwapCandidates(planItemID: planItemID)), as: [SwapCandidate].self)
    }

    public func confirmSwap(planItemID: String, replacementRecipeID: String, idempotencyKey: String) async throws -> SwapConfirmationEnvelope {
        var request = try await makeRequest(route: .confirmSwap(planItemID: planItemID), idempotencyKey: idempotencyKey)
        request.httpBody = try encoder.encode(ConfirmSwapBody(replacementRecipeID: replacementRecipeID))
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        return try await send(request, as: SwapConfirmationEnvelope.self)
    }

    public func readGroceryList(id: String) async throws -> RemoteGroceryList {
        try await send(makeRequest(route: .readGroceryList(id: id)), as: RemoteGroceryList.self)
    }

    public func updateGroceryList(id: String, patch: GroceryListPatch) async throws -> RemoteGroceryList {
        var request = try await makeRequest(route: .updateGroceryList(id: id))
        request.httpBody = try encoder.encode(patch)
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        return try await send(request, as: RemoteGroceryList.self)
    }

    public func updateMealStatus(planItemID: String, state: MealCompletionState, expectedRevision: Int) async throws -> MealStatusReceipt {
        var request = try await makeRequest(route: .updateMealStatus(planItemID: planItemID))
        request.httpBody = try encoder.encode(MealStatusBody(state: state, expectedRevision: expectedRevision))
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        return try await send(request, as: MealStatusReceipt.self)
    }

    public func updatePrepTask(id: String, isComplete: Bool, expectedRevision: Int) async throws -> PrepTaskReceipt {
        var request = try await makeRequest(route: .updatePrepTask(id: id))
        request.httpBody = try encoder.encode(PrepTaskBody(isComplete: isComplete, expectedRevision: expectedRevision))
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        return try await send(request, as: PrepTaskReceipt.self)
    }

    private func makeRequest(route: ConsumerRoute, idempotencyKey: String? = nil) async throws -> URLRequest {
        guard let token = try await accessTokenProvider() else {
            throw APIErrorEnvelope(
                code: .authenticationRequired,
                userSafeMessage: "Please sign in again.",
                correlationID: "local-session-required",
                retryable: false
            )
        }
        let descriptor = route.descriptor
        guard let url = URL(string: descriptor.path, relativeTo: baseURL)?.absoluteURL else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.httpMethod = descriptor.method.rawValue
        request.timeoutInterval = 45
        request.setValue("application/json", forHTTPHeaderField: "accept")
        request.setValue("Bearer \(token.rawValue)", forHTTPHeaderField: "authorization")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "x-correlation-id")
        if let idempotencyKey { request.setValue(idempotencyKey, forHTTPHeaderField: "idempotency-key") }
        return request
    }

    private func send<Response: Decodable>(_ request: URLRequest, as type: Response.Type) async throws -> Response {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(http.statusCode) else {
            if let envelope = try? decoder.decode(APIErrorEnvelope.self, from: data) { throw envelope }
            throw URLError(.badServerResponse)
        }
        return try decoder.decode(type, from: data)
    }
}

private struct ConfirmSwapBody: Codable {
    var replacementRecipeID: String
}

private struct MealStatusBody: Codable {
    var state: MealCompletionState
    var expectedRevision: Int
}

private struct PrepTaskBody: Codable {
    var isComplete: Bool
    var expectedRevision: Int
}
