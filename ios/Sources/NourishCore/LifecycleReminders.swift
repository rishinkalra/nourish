import Foundation

public enum ReminderDestination: String, Codable, CaseIterable, Sendable {
    case groceries
    case prep
    case breakfast
    case lunch
    case dinner
    case weeklyReview
    case nextPlan

    public var deepLink: URL {
        URL(string: "nourish://open/\(rawValue)")!
    }
}

public struct ReminderClock: Codable, Equatable, Sendable {
    public var hour: Int
    public var minute: Int

    public init(hour: Int, minute: Int = 0) {
        self.hour = hour
        self.minute = minute
    }

    public var isValid: Bool { (0...23).contains(hour) && (0...59).contains(minute) }
}

public struct WeeklyReminder: Codable, Equatable, Sendable {
    public var isEnabled: Bool
    public var weekday: Int
    public var time: ReminderClock

    public init(isEnabled: Bool, weekday: Int, time: ReminderClock) {
        self.isEnabled = isEnabled
        self.weekday = weekday
        self.time = time
    }

    public var isValid: Bool { (1...7).contains(weekday) && time.isValid }
}

public struct MealReminder: Codable, Equatable, Identifiable, Sendable {
    public var slot: MealSlot
    public var isEnabled: Bool
    public var time: ReminderClock

    public var id: MealSlot { slot }

    public init(slot: MealSlot, isEnabled: Bool, time: ReminderClock) {
        self.slot = slot
        self.isEnabled = isEnabled
        self.time = time
    }
}

public struct LifecycleReminderSettings: Codable, Equatable, Sendable {
    public var planStartWeekday: Int
    public var shopping: WeeklyReminder
    public var prep: WeeklyReminder
    public var meals: [MealReminder]
    public var weeklyReview: WeeklyReminder
    public var nextPlan: WeeklyReminder

    public init(
        planStartWeekday: Int = 2,
        shopping: WeeklyReminder = WeeklyReminder(isEnabled: false, weekday: 1, time: ReminderClock(hour: 10)),
        prep: WeeklyReminder = WeeklyReminder(isEnabled: false, weekday: 1, time: ReminderClock(hour: 16)),
        meals: [MealReminder] = [
            MealReminder(slot: .breakfast, isEnabled: false, time: ReminderClock(hour: 8)),
            MealReminder(slot: .lunch, isEnabled: false, time: ReminderClock(hour: 13)),
            MealReminder(slot: .dinner, isEnabled: false, time: ReminderClock(hour: 19, minute: 30)),
        ],
        weeklyReview: WeeklyReminder = WeeklyReminder(isEnabled: false, weekday: 1, time: ReminderClock(hour: 18)),
        nextPlan: WeeklyReminder = WeeklyReminder(isEnabled: false, weekday: 1, time: ReminderClock(hour: 18, minute: 30))
    ) {
        self.planStartWeekday = planStartWeekday
        self.shopping = shopping
        self.prep = prep
        self.meals = meals
        self.weeklyReview = weeklyReview
        self.nextPlan = nextPlan
    }

    public var isValid: Bool {
        (1...7).contains(planStartWeekday)
            && shopping.isValid
            && prep.isValid
            && weeklyReview.isValid
            && nextPlan.isValid
            && Set(meals.map(\.slot)).count == meals.count
            && meals.allSatisfy { $0.time.isValid }
    }

    public var hasEnabledReminders: Bool {
        shopping.isEnabled || prep.isEnabled || weeklyReview.isEnabled || nextPlan.isEnabled
            || meals.contains(where: \.isEnabled)
    }
}

public struct ReminderDescriptor: Codable, Equatable, Sendable {
    public enum Recurrence: Codable, Equatable, Sendable {
        case daily(ReminderClock)
        case weekly(weekday: Int, time: ReminderClock)
    }

    public var identifier: String
    public var title: String
    public var body: String
    public var destination: ReminderDestination
    public var recurrence: Recurrence

    public init(identifier: String, title: String, body: String, destination: ReminderDestination, recurrence: Recurrence) {
        self.identifier = identifier
        self.title = title
        self.body = body
        self.destination = destination
        self.recurrence = recurrence
    }
}

public enum LifecycleReminderPlanner {
    public static func nextPlanStart(
        onOrAfter date: Date,
        weekday: Int,
        timeZoneIdentifier: String
    ) -> LocalDate? {
        guard (1...7).contains(weekday), let timeZone = TimeZone(identifier: timeZoneIdentifier) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let currentWeekday = calendar.component(.weekday, from: date)
        let daysUntilStart = (weekday - currentWeekday + 7) % 7
        guard let start = calendar.date(byAdding: .day, value: daysUntilStart, to: date) else { return nil }
        let values = calendar.dateComponents([.year, .month, .day], from: start)
        guard let year = values.year, let month = values.month, let day = values.day else { return nil }
        return LocalDate(year: year, month: month, day: day)
    }

    public static func descriptors(settings: LifecycleReminderSettings, profile: UserProfile) -> [ReminderDescriptor] {
        guard settings.isValid else { return [] }
        var result: [ReminderDescriptor] = []
        if settings.shopping.isEnabled {
            result.append(weekly(
                id: "shopping",
                title: "Shopping for your week",
                body: "Your grocery list is ready to check before the new plan begins.",
                destination: .groceries,
                reminder: settings.shopping
            ))
        }
        if settings.prep.isEnabled {
            result.append(weekly(
                id: "prep",
                title: "A little prep for an easier week",
                body: "Review today's batch-prep tasks and storage notes.",
                destination: .prep,
                reminder: settings.prep
            ))
        }
        for meal in settings.meals where meal.isEnabled && profile.enabledMealSlots.contains(meal.slot) {
            result.append(ReminderDescriptor(
                identifier: "meal-\(meal.slot.rawValue)",
                title: "Your \(meal.slot.rawValue) plan",
                body: "Open the reviewed meal and preparation steps.",
                destination: destination(for: meal.slot),
                recurrence: .daily(meal.time)
            ))
        }
        if settings.weeklyReview.isEnabled {
            result.append(weekly(
                id: "weekly-review",
                title: "How did this week fit?",
                body: "Review completion and tune what Nourish plans next.",
                destination: .weeklyReview,
                reminder: settings.weeklyReview
            ))
        }
        if settings.nextPlan.isEnabled {
            result.append(weekly(
                id: "next-plan",
                title: "Plan the week ahead",
                body: "Generate and review your next week before adopting it.",
                destination: .nextPlan,
                reminder: settings.nextPlan
            ))
        }
        return result
    }

    private static func weekly(
        id: String,
        title: String,
        body: String,
        destination: ReminderDestination,
        reminder: WeeklyReminder
    ) -> ReminderDescriptor {
        ReminderDescriptor(
            identifier: id,
            title: title,
            body: body,
            destination: destination,
            recurrence: .weekly(weekday: reminder.weekday, time: reminder.time)
        )
    }

    private static func destination(for slot: MealSlot) -> ReminderDestination {
        switch slot {
        case .breakfast: .breakfast
        case .lunch: .lunch
        case .dinner: .dinner
        }
    }
}
