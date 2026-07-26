import Foundation
import NourishAPI
import NourishCore

@MainActor
final class PlanGenerationStore: ObservableObject {
    enum State: Equatable {
        case signedOut
        case idle
        case submitting
        case generating
        case ready
        case adopting
        case adopted
        case failed(String, retryable: Bool)
    }

    @Published private(set) var state: State = .signedOut
    @Published private(set) var draft: PlanReadEnvelope?
    @Published private(set) var feedbackMessageByItemID: [String: String] = [:]
    @Published private(set) var lastAdoptionStatus: String?
    @Published private(set) var history: [PlanHistoryEntry] = []
    @Published private(set) var weeklyReviewMessage: String?
    @Published private(set) var favoriteRecipeIDs: Set<String> = []

    private var userID: String?
    private var remote: (any PlanRemote)?
    private let defaults: UserDefaults
    #if DEBUG
    private var usesDevelopmentAdoption = false
    #endif

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func connect(userID: String, remote: any PlanRemote) async {
        self.userID = userID
        self.remote = remote
        favoriteRecipeIDs = Set(defaults.stringArray(forKey: favoritesKey(userID)) ?? [])
        state = .idle
        await refreshHistory()
        if let jobID = defaults.string(forKey: jobKey(userID)) {
            await poll(jobID: jobID)
        }
    }

    func disconnect() {
        userID = nil
        remote = nil
        draft = nil
        feedbackMessageByItemID = [:]
        lastAdoptionStatus = nil
        history = []
        weeklyReviewMessage = nil
        favoriteRecipeIDs = []
        state = .signedOut
        #if DEBUG
        usesDevelopmentAdoption = false
        #endif
    }

    func clearForAccountDeletion() {
        if let userID {
            defaults.removeObject(forKey: jobKey(userID))
            defaults.removeObject(forKey: favoritesKey(userID))
        }
        disconnect()
    }

    func generate(
        profile: UserProfile,
        activePlan: WeeklyPlan?,
        lockedPlanItemIDs: Set<String> = [],
        regenerationReason: String? = nil,
        includeOptionalSnack: Bool = false,
        planStartWeekday: Int = 2
    ) async {
        guard let remote, let userID else {
            state = .failed("Sign in before creating a reviewed week.", retryable: false)
            return
        }
        let isRegeneration = regenerationReason != nil && activePlan != nil
        let weekStart = isRegeneration
            ? activePlan?.days.first?.localDate
            : nextWeekStart(
                after: activePlan,
                timeZoneIdentifier: profile.timeZoneIdentifier,
                preferredWeekday: planStartWeekday
            )
        guard let weekStart else {
            state = .failed("FamilyChef could not determine the next plan start date.", retryable: false)
            return
        }
        let recentRecipeIDs = Set(activePlan?.days.flatMap(\.items).map(\.recipeSnapshot.recipeID) ?? [])
        let request = PlanGenerationRequest(
            weekStartLocalDate: wireDate(weekStart),
            timeZoneIdentifier: profile.timeZoneIdentifier,
            trigger: isRegeneration ? "manual_regeneration" : (activePlan == nil ? "onboarding_completion" : "weekly_review"),
            lockedPlanItemIDs: isRegeneration ? lockedPlanItemIDs : [],
            deterministicSeed: "\(userID)|\(wireDate(weekStart))|\(UUID().uuidString)",
            recentRecipeIDs: recentRecipeIDs,
            favoriteRecipeIDs: favoriteRecipeIDs,
            includeOptionalSnack: includeOptionalSnack,
            regenerationReason: regenerationReason
        )
        state = .submitting
        do {
            let job = try await remote.createPlan(request, idempotencyKey: UUID().uuidString)
            defaults.set(job.id, forKey: jobKey(userID))
            await resolve(job)
        } catch let error as APIErrorEnvelope {
            state = .failed(guidance(for: error), retryable: error.retryable)
        } catch {
            state = .failed("The plan service is unavailable. Your current week is unchanged.", retryable: true)
        }
    }

    func adoptDraft() async -> Bool {
        #if DEBUG
        if usesDevelopmentAdoption, draft?.plan != nil {
            state = .adopting
            await Task.yield()
            lastAdoptionStatus = "active"
            state = .adopted
            return true
        }
        #endif
        guard let remote, let planID = draft?.plan?.id else { return false }
        state = .adopting
        do {
            let receipt = try await remote.adoptPlan(id: planID, idempotencyKey: UUID().uuidString)
            lastAdoptionStatus = receipt.status
            if let userID { defaults.removeObject(forKey: jobKey(userID)) }
            state = .adopted
            await refreshHistory()
            return true
        } catch let error as APIErrorEnvelope {
            state = .failed(error.userSafeMessage, retryable: error.retryable)
            return false
        } catch {
            state = .failed("This week was not adopted. Your existing plan is unchanged.", retryable: true)
            return false
        }
    }

    func submitFeedback(
        for item: PlanItem,
        rating: Int,
        reasons: Set<MealFeedbackReason>,
        note: String? = nil
    ) async -> Bool {
        guard let remote else { return false }
        do {
            _ = try await remote.submitFeedback(MealFeedbackRequest(
                planItemID: item.id,
                recipeID: item.recipeSnapshot.recipeID,
                rating: rating,
                reasonTags: reasons,
                note: note
            ))
            feedbackMessageByItemID[item.id] = "Feedback saved"
            return true
        } catch let error as APIErrorEnvelope {
            feedbackMessageByItemID[item.id] = error.userSafeMessage
            return false
        } catch {
            feedbackMessageByItemID[item.id] = "Feedback could not be sent. Please try again."
            return false
        }
    }

    func submitWeeklyReview(plan: WeeklyPlan, changes: Set<WeeklyReviewChange>) async -> Bool {
        guard let remote else { return false }
        let items = plan.days.flatMap(\.items)
        let completed = items.filter { $0.completionState == .completed }.count
        let completionRate = items.isEmpty ? 0 : Double(completed) / Double(items.count)
        do {
            _ = try await remote.submitWeeklyReview(WeeklyReviewRequest(
                planID: plan.id,
                completionRate: completionRate,
                changesRequested: changes
            ))
            weeklyReviewMessage = "Weekly review saved"
            return true
        } catch let error as APIErrorEnvelope {
            weeklyReviewMessage = error.userSafeMessage
            return false
        } catch {
            weeklyReviewMessage = "Weekly review could not be sent. Please try again."
            return false
        }
    }

    func clearDraft() {
        if let userID { defaults.removeObject(forKey: jobKey(userID)) }
        draft = nil
        state = remote == nil ? .signedOut : .idle
    }

    func isFavorite(recipeID: String) -> Bool {
        favoriteRecipeIDs.contains(recipeID)
    }

    func toggleFavorite(recipeID: String) {
        guard let userID else { return }
        if favoriteRecipeIDs.contains(recipeID) {
            favoriteRecipeIDs.remove(recipeID)
        } else {
            favoriteRecipeIDs.insert(recipeID)
        }
        defaults.set(favoriteRecipeIDs.sorted(), forKey: favoritesKey(userID))
    }

    #if DEBUG
    func installDevelopmentDraft(plan: WeeklyPlan, diagnostics: PlannerDiagnostics) {
        userID = "ui-fixture-user"
        remote = nil
        draft = PlanReadEnvelope(job: nil, plan: plan, diagnostics: diagnostics)
        state = .ready
        usesDevelopmentAdoption = true
    }
    #endif

    func refreshHistory() async {
        guard let remote else { return }
        if let entries = try? await remote.readPlanHistory() { history = entries }
    }

    private func poll(jobID: String) async {
        guard let remote else { return }
        state = .generating
        for _ in 0..<40 {
            do {
                let envelope = try await remote.readPlan(id: jobID)
                if let job = envelope.job {
                    switch job.state {
                    case .queued, .generating:
                        try await Task.sleep(for: .milliseconds(750))
                        continue
                    case .succeeded:
                        draft = envelope
                        state = .ready
                        await refreshHistory()
                        return
                    case .rejected, .failed:
                        state = .failed(guidance(for: job.error), retryable: job.error?.retryable ?? false)
                        return
                    }
                } else if envelope.plan != nil {
                    draft = envelope
                    state = .ready
                    await refreshHistory()
                    return
                }
            } catch let error as APIErrorEnvelope {
                state = .failed(guidance(for: error), retryable: error.retryable)
                return
            } catch {
                state = .failed("Generation is still pending. Reopen this screen to check again.", retryable: true)
                return
            }
        }
        state = .failed("Generation is taking longer than expected. Reopen this screen to check again.", retryable: true)
    }

    private func resolve(_ job: PlanJob) async {
        switch job.state {
        case .queued, .generating:
            await poll(jobID: job.id)
        case .succeeded:
            await poll(jobID: job.id)
        case .rejected, .failed:
            state = .failed(guidance(for: job.error), retryable: job.error?.retryable ?? false)
        }
    }

    private func guidance(for error: APIErrorEnvelope?) -> String {
        guard let error else { return "FamilyChef could not generate this week." }
        switch error.code {
        case .contentInsufficient:
            return "There are not enough licensed, reviewed recipes for this profile yet. Your current week is unchanged."
        case .noFeasiblePlan:
            return "FamilyChef could not build a safe varied week. Try fewer locks or review cooking constraints."
        case .profileIneligible:
            return "Complete the required planning preferences before generating a week."
        default:
            return error.userSafeMessage
        }
    }

    private func nextWeekStart(
        after activePlan: WeeklyPlan?,
        timeZoneIdentifier: String,
        preferredWeekday: Int
    ) -> LocalDate? {
        if let last = activePlan?.days.last?.localDate {
            return last.adding(days: 1, timeZoneIdentifier: timeZoneIdentifier)
        }
        return LifecycleReminderPlanner.nextPlanStart(
            onOrAfter: .now,
            weekday: preferredWeekday,
            timeZoneIdentifier: timeZoneIdentifier
        )
    }

    private func wireDate(_ date: LocalDate) -> String {
        String(format: "%04d-%02d-%02d", date.year, date.month, date.day)
    }

    private func jobKey(_ userID: String) -> String {
        "nourish.plan-job.\(userID)"
    }

    private func favoritesKey(_ userID: String) -> String {
        "nourish.favorite-recipes.\(userID)"
    }
}
