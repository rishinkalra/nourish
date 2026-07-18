import Foundation
import NourishCore

public enum HTTPMethod: String, Codable, Sendable {
    case get = "GET"
    case post = "POST"
    case patch = "PATCH"
    case delete = "DELETE"
}

public struct RouteDescriptor: Equatable, Sendable {
    public var method: HTTPMethod
    public var path: String
    public var requiresAuthentication: Bool
    public var requiresIdempotencyKey: Bool

    public init(method: HTTPMethod, path: String, requiresAuthentication: Bool = true, requiresIdempotencyKey: Bool = false) {
        self.method = method
        self.path = path
        self.requiresAuthentication = requiresAuthentication
        self.requiresIdempotencyKey = requiresIdempotencyKey
    }
}

public enum ConsumerRoute: Equatable, Sendable {
    case authenticateWithApple
    case requestMagicLink
    case completeMagicLink
    case refreshSession
    case revokeSession
    case readProfile
    case updateProfile
    case readFeatureFlags
    case updateAnalyticsDimensions
    case updateAnalyticsConsent
    case recordAnalyticsEvent
    case estimateCalories
    case createPlan
    case readActivePlan
    case readPlanHistory
    case readPlan(id: String)
    case adoptPlan(id: String)
    case readSwapCandidates(planItemID: String)
    case confirmSwap(planItemID: String)
    case updateMealStatus(planItemID: String)
    case readGroceryList(id: String)
    case updateGroceryList(id: String)
    case updatePrepTask(id: String)
    case submitFeedback
    case readEntitlement
    case issueAppStoreAccountToken
    case bindAppStoreTransaction
    case requestAccountExport
    case deleteAccount

    public var descriptor: RouteDescriptor {
        switch self {
        case .authenticateWithApple:
            RouteDescriptor(method: .post, path: "/v1/auth/apple", requiresAuthentication: false)
        case .requestMagicLink:
            RouteDescriptor(method: .post, path: "/v1/auth/magic-link", requiresAuthentication: false)
        case .completeMagicLink:
            RouteDescriptor(method: .post, path: "/v1/auth/magic-link/complete", requiresAuthentication: false)
        case .refreshSession:
            RouteDescriptor(method: .post, path: "/v1/auth/refresh", requiresAuthentication: false)
        case .revokeSession:
            RouteDescriptor(method: .post, path: "/v1/auth/revoke")
        case .readProfile:
            RouteDescriptor(method: .get, path: "/v1/profile")
        case .updateProfile:
            RouteDescriptor(method: .patch, path: "/v1/profile")
        case .readFeatureFlags:
            RouteDescriptor(method: .get, path: "/v1/feature-flags")
        case .updateAnalyticsDimensions:
            RouteDescriptor(method: .post, path: "/v1/analytics/dimensions")
        case .updateAnalyticsConsent:
            RouteDescriptor(method: .patch, path: "/v1/analytics/consent")
        case .recordAnalyticsEvent:
            RouteDescriptor(method: .post, path: "/v1/analytics/events")
        case .estimateCalories:
            RouteDescriptor(method: .post, path: "/v1/calorie-estimates")
        case .createPlan:
            RouteDescriptor(method: .post, path: "/v1/plans", requiresIdempotencyKey: true)
        case .readActivePlan:
            RouteDescriptor(method: .get, path: "/v1/plans/active")
        case .readPlanHistory:
            RouteDescriptor(method: .get, path: "/v1/plans/history")
        case let .readPlan(id):
            RouteDescriptor(method: .get, path: "/v1/plans/\(segment(id))")
        case let .adoptPlan(id):
            RouteDescriptor(method: .post, path: "/v1/plans/\(segment(id))/adopt", requiresIdempotencyKey: true)
        case let .readSwapCandidates(planItemID):
            RouteDescriptor(method: .get, path: "/v1/plan-items/\(segment(planItemID))/swaps")
        case let .confirmSwap(planItemID):
            RouteDescriptor(method: .post, path: "/v1/plan-items/\(segment(planItemID))/swap", requiresIdempotencyKey: true)
        case let .updateMealStatus(planItemID):
            RouteDescriptor(method: .patch, path: "/v1/plan-items/\(segment(planItemID))/status")
        case let .readGroceryList(id):
            RouteDescriptor(method: .get, path: "/v1/grocery-lists/\(segment(id))")
        case let .updateGroceryList(id):
            RouteDescriptor(method: .patch, path: "/v1/grocery-lists/\(segment(id))")
        case let .updatePrepTask(id):
            RouteDescriptor(method: .patch, path: "/v1/prep-tasks/\(segment(id))")
        case .submitFeedback:
            RouteDescriptor(method: .post, path: "/v1/feedback")
        case .readEntitlement:
            RouteDescriptor(method: .get, path: "/v1/entitlement")
        case .issueAppStoreAccountToken:
            RouteDescriptor(method: .post, path: "/v1/entitlement/app-account-token")
        case .bindAppStoreTransaction:
            RouteDescriptor(method: .post, path: "/v1/entitlement/transactions")
        case .requestAccountExport:
            RouteDescriptor(method: .post, path: "/v1/account/export", requiresIdempotencyKey: true)
        case .deleteAccount:
            RouteDescriptor(method: .delete, path: "/v1/account", requiresIdempotencyKey: true)
        }
    }

    private func segment(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? value
    }
}

public enum StructuredAPIErrorCode: String, Codable, CaseIterable, Sendable {
    case validationError = "VALIDATION_ERROR"
    case profileIneligible = "PROFILE_INELIGIBLE"
    case noFeasiblePlan = "NO_FEASIBLE_PLAN"
    case contentInsufficient = "CONTENT_INSUFFICIENT"
    case entitlementRequired = "ENTITLEMENT_REQUIRED"
    case conflict = "CONFLICT"
    case rateLimited = "RATE_LIMITED"
    case temporaryFailure = "TEMPORARY_FAILURE"
    case authenticationRequired = "AUTHENTICATION_REQUIRED"
}

public struct APIErrorEnvelope: Error, Codable, Equatable, Sendable {
    public var code: StructuredAPIErrorCode
    public var userSafeMessage: String
    public var correlationID: String
    public var retryable: Bool

    public init(code: StructuredAPIErrorCode, userSafeMessage: String, correlationID: String, retryable: Bool) {
        self.code = code
        self.userSafeMessage = userSafeMessage
        self.correlationID = correlationID
        self.retryable = retryable
    }
}

public struct ProfileUpdateRequest: Codable, Equatable, Sendable {
    public var profile: UserProfile
    public var changeScope: ProfileChangeScope
    public var expectedRevision: Int

    public init(profile: UserProfile, changeScope: ProfileChangeScope, expectedRevision: Int) {
        self.profile = profile
        self.changeScope = changeScope
        self.expectedRevision = expectedRevision
    }
}

public struct CalorieEstimateRequest: Codable, Equatable, Sendable {
    public var ageYears: Int
    public var heightCentimetres: Decimal
    public var weightKilograms: Decimal
    public var activityLevelCode: String
    public var goal: WellnessGoal
    public var formulaVersionRequested: String?

    public init(ageYears: Int, heightCentimetres: Decimal, weightKilograms: Decimal, activityLevelCode: String, goal: WellnessGoal, formulaVersionRequested: String? = nil) {
        self.ageYears = ageYears
        self.heightCentimetres = heightCentimetres
        self.weightKilograms = weightKilograms
        self.activityLevelCode = activityLevelCode
        self.goal = goal
        self.formulaVersionRequested = formulaVersionRequested
    }
}

public struct CalorieEstimateResponse: Codable, Equatable, Sendable {
    public var estimatedDailyCalories: Int
    public var formulaVersion: String
    public var guardrailResultCode: String
    public var approximate: Bool
}

public struct PlanGenerationRequest: Codable, Equatable, Sendable {
    public var weekStartLocalDate: String
    public var timeZoneIdentifier: String
    public var trigger: String
    public var lockedPlanItemIDs: Set<String>
    public var deterministicSeed: String?
    public var recentRecipeIDs: Set<String>
    public var favoriteRecipeIDs: Set<String>
    public var includeOptionalSnack: Bool
    public var regenerationReason: String?

    public init(
        weekStartLocalDate: String,
        timeZoneIdentifier: String,
        trigger: String,
        lockedPlanItemIDs: Set<String> = [],
        deterministicSeed: String? = nil,
        recentRecipeIDs: Set<String> = [],
        favoriteRecipeIDs: Set<String> = [],
        includeOptionalSnack: Bool = false,
        regenerationReason: String? = nil
    ) {
        self.weekStartLocalDate = weekStartLocalDate
        self.timeZoneIdentifier = timeZoneIdentifier
        self.trigger = trigger
        self.lockedPlanItemIDs = lockedPlanItemIDs
        self.deterministicSeed = deterministicSeed
        self.recentRecipeIDs = recentRecipeIDs
        self.favoriteRecipeIDs = favoriteRecipeIDs
        self.includeOptionalSnack = includeOptionalSnack
        self.regenerationReason = regenerationReason
    }
}

public enum PlanJobState: String, Codable, CaseIterable, Sendable {
    case queued
    case generating
    case succeeded
    case rejected
    case failed
}

public struct PlanJob: Codable, Equatable, Sendable {
    public var id: String
    public var state: PlanJobState
    public var correlationID: String
    public var planID: String?
    public var error: APIErrorEnvelope?

    public init(id: String, state: PlanJobState, correlationID: String, planID: String? = nil, error: APIErrorEnvelope? = nil) {
        self.id = id
        self.state = state
        self.correlationID = correlationID
        self.planID = planID
        self.error = error
    }
}

public struct PlanReadEnvelope: Codable, Equatable, Sendable {
    public var job: PlanJob?
    public var plan: WeeklyPlan?
    public var diagnostics: PlannerDiagnostics?

    public init(job: PlanJob?, plan: WeeklyPlan?, diagnostics: PlannerDiagnostics?) {
        self.job = job
        self.plan = plan
        self.diagnostics = diagnostics
    }
}

public struct PlanAdoptionReceipt: Codable, Equatable, Sendable {
    public var planID: String
    public var status: String
    public var adoptedAt: Date

    public init(planID: String, status: String, adoptedAt: Date) {
        self.planID = planID
        self.status = status
        self.adoptedAt = adoptedAt
    }
}

public struct PlanHistoryEntry: Codable, Equatable, Sendable {
    public var plan: WeeklyPlan
    public var diagnostics: PlannerDiagnostics
    public var adoptedAt: Date?
    public var supersedesPlanID: String?
    public var lifecycleStatus: String

    public init(plan: WeeklyPlan, diagnostics: PlannerDiagnostics, adoptedAt: Date?, supersedesPlanID: String?, lifecycleStatus: String) {
        self.plan = plan
        self.diagnostics = diagnostics
        self.adoptedAt = adoptedAt
        self.supersedesPlanID = supersedesPlanID
        self.lifecycleStatus = lifecycleStatus
    }
}

public enum MealFeedbackReason: String, Codable, CaseIterable, Hashable, Sendable {
    case taste
    case effort
    case cost
    case portion
    case ingredientAvailability

    public var displayName: String {
        switch self {
        case .taste: "Taste"
        case .effort: "Effort"
        case .cost: "Cost"
        case .portion: "Portion"
        case .ingredientAvailability: "Ingredients"
        }
    }
}

public struct MealFeedbackRequest: Codable, Equatable, Sendable {
    public var subjectType = "meal"
    public var planItemID: String
    public var recipeID: String
    public var rating: Int
    public var reasonTags: Set<MealFeedbackReason>
    public var note: String?

    public init(planItemID: String, recipeID: String, rating: Int, reasonTags: Set<MealFeedbackReason>, note: String? = nil) {
        self.planItemID = planItemID
        self.recipeID = recipeID
        self.rating = rating
        self.reasonTags = reasonTags
        self.note = note
    }
}

public struct FeedbackReceipt: Codable, Equatable, Sendable {
    public var id: String
    public var status: String
    public var submittedAt: Date

    public init(id: String, status: String, submittedAt: Date) {
        self.id = id
        self.status = status
        self.submittedAt = submittedAt
    }
}

public enum WeeklyReviewChange: String, Codable, CaseIterable, Hashable, Sendable {
    case moreVariety
    case lessEffort
    case lowerCost
    case differentCuisines
    case adjustPortions

    public var displayName: String {
        switch self {
        case .moreVariety: "More variety"
        case .lessEffort: "Less effort"
        case .lowerCost: "Lower cost"
        case .differentCuisines: "Different cuisines"
        case .adjustPortions: "Adjust portions"
        }
    }
}

public struct WeeklyReviewRequest: Codable, Equatable, Sendable {
    public var subjectType = "weeklyReview"
    public var planID: String
    public var completionRate: Double
    public var changesRequested: Set<WeeklyReviewChange>

    public init(planID: String, completionRate: Double, changesRequested: Set<WeeklyReviewChange>) {
        self.planID = planID
        self.completionRate = completionRate
        self.changesRequested = changesRequested
    }
}

public enum EntitlementState: String, Codable, CaseIterable, Sendable {
    case active
    case trial
    case graceOrBillingRetry
    case expired
    case revokedOrRefunded
    case upgraded
    case downgraded
    case unknown
}

public struct EntitlementSnapshot: Codable, Equatable, Sendable {
    public var userID: String
    public var state: EntitlementState
    public var hasAccess: Bool
    public var productID: String?
    public var environment: String
    public var periodEndsAt: Date?
    public var willAutoRenew: Bool?
    public var verificationStatus: String
    public var lastVerifiedAt: Date?
    public var nextReconciliationAt: Date
    public var reconciliationStatus: String
    public var sourceEventID: String?

    public init(
        userID: String,
        state: EntitlementState,
        hasAccess: Bool,
        productID: String? = nil,
        environment: String = "unknown",
        periodEndsAt: Date? = nil,
        willAutoRenew: Bool? = nil,
        verificationStatus: String,
        lastVerifiedAt: Date? = nil,
        nextReconciliationAt: Date,
        reconciliationStatus: String,
        sourceEventID: String? = nil
    ) {
        self.userID = userID
        self.state = state
        self.hasAccess = hasAccess
        self.productID = productID
        self.environment = environment
        self.periodEndsAt = periodEndsAt
        self.willAutoRenew = willAutoRenew
        self.verificationStatus = verificationStatus
        self.lastVerifiedAt = lastVerifiedAt
        self.nextReconciliationAt = nextReconciliationAt
        self.reconciliationStatus = reconciliationStatus
        self.sourceEventID = sourceEventID
    }
}

public struct AppStoreAccountBinding: Codable, Equatable, Sendable {
    public var appAccountToken: UUID
    public var createdAt: Date
}

public struct AppStoreTransactionBindingRequest: Codable, Equatable, Sendable {
    public var signedTransactionInfo: String

    public init(signedTransactionInfo: String) {
        self.signedTransactionInfo = signedTransactionInfo
    }
}

public struct AccountExportReceipt: Codable, Equatable, Sendable {
    public var requestID: String
    public var status: String
    public var requestedAt: Date
    public var expiresAt: Date?
    public var format: String
    public var message: String
}

public struct AccountDeletionRequest: Codable, Equatable, Sendable {
    public var acknowledgement: String
    public var reason: String?

    public init(acknowledgement: String, reason: String? = nil) {
        self.acknowledgement = acknowledgement
        self.reason = reason
    }
}

public struct AccountDeletionReceipt: Codable, Equatable, Sendable {
    public var requestID: String
    public var status: String
    public var requestedAt: Date
    public var reason: String?
    public var accountAccessRevokedAt: Date
    public var message: String
}
