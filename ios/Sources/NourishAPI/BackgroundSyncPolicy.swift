import Foundation

public enum BackgroundSyncPolicy {
    public static let minimumRetryDelay: TimeInterval = 15 * 60
    public static let maximumRetryDelay: TimeInterval = 6 * 60 * 60

    public static func retryDelay(forAttempt attempt: Int) -> TimeInterval {
        let boundedAttempt = max(0, min(attempt, 5))
        return min(minimumRetryDelay * pow(2, Double(boundedAttempt)), maximumRetryDelay)
    }

    public static func shouldSchedule(profilePending: Bool, weeklyLoopPending: Bool) -> Bool {
        profilePending || weeklyLoopPending
    }
}
