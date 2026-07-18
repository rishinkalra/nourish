import Foundation
import NourishAPI

#if os(iOS) && canImport(BackgroundTasks)
import BackgroundTasks

@MainActor
public final class BackgroundSyncCoordinator {
    public static let shared = BackgroundSyncCoordinator()
    public static let taskIdentifier = "com.projectnourish.app.sync"

    private typealias Operation = @MainActor () async -> Bool

    private let scheduler: BGTaskScheduler
    private let defaults: UserDefaults
    private var operation: Operation?
    private var deferredTask: BGTask?
    private var isRegistered = false
    private let retryAttemptKey = "nourish.background-sync.retry-attempt"

    private init(scheduler: BGTaskScheduler = .shared, defaults: UserDefaults = .standard) {
        self.scheduler = scheduler
        self.defaults = defaults
    }

    @discardableResult
    public func register() -> Bool {
        guard !isRegistered else { return true }
        isRegistered = scheduler.register(
            forTaskWithIdentifier: Self.taskIdentifier,
            using: nil
        ) { task in
            Task { @MainActor in
                BackgroundSyncCoordinator.shared.receive(task)
            }
        }
        return isRegistered
    }

    public func configure(operation: @escaping @MainActor () async -> Bool) {
        self.operation = operation
        if let deferredTask {
            self.deferredTask = nil
            handle(deferredTask)
        }
    }

    public func scheduleRetry() {
        guard isRegistered else { return }
        scheduler.cancel(taskRequestWithIdentifier: Self.taskIdentifier)
        let request = BGAppRefreshTaskRequest(identifier: Self.taskIdentifier)
        request.earliestBeginDate = Date().addingTimeInterval(
            BackgroundSyncPolicy.retryDelay(forAttempt: defaults.integer(forKey: retryAttemptKey))
        )
        do {
            try scheduler.submit(request)
        } catch {
            // Foreground synchronization remains available if iOS declines a request.
        }
    }

    public func cancelScheduledRetry() {
        defaults.set(0, forKey: retryAttemptKey)
        scheduler.cancel(taskRequestWithIdentifier: Self.taskIdentifier)
    }

    private func receive(_ task: BGTask) {
        guard operation != nil else {
            deferredTask = task
            return
        }
        handle(task)
    }

    private func handle(_ task: BGTask) {
        guard let refreshTask = task as? BGAppRefreshTask, let operation else {
            task.setTaskCompleted(success: false)
            return
        }
        let work = Task { @MainActor in
            let succeeded = await operation()
            guard !Task.isCancelled else { return }
            if succeeded {
                cancelScheduledRetry()
            } else {
                defaults.set(defaults.integer(forKey: retryAttemptKey) + 1, forKey: retryAttemptKey)
                scheduleRetry()
            }
            refreshTask.setTaskCompleted(success: succeeded)
        }
        refreshTask.expirationHandler = {
            work.cancel()
            refreshTask.setTaskCompleted(success: false)
        }
    }
}

#else

@MainActor
public final class BackgroundSyncCoordinator {
    public static let shared = BackgroundSyncCoordinator()
    public static let taskIdentifier = "com.projectnourish.app.sync"

    private init() {}
    @discardableResult public func register() -> Bool { false }
    public func configure(operation: @escaping @MainActor () async -> Bool) {}
    public func scheduleRetry() {}
    public func cancelScheduledRetry() {}
}

#endif
