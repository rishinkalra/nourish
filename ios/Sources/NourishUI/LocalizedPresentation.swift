import SwiftUI
import NourishCore

extension WellnessGoal {
    var localizedLabel: LocalizedStringKey {
        switch self {
        case .maintain: "Maintain"
        case .gradualLoss: "Gradual loss"
        case .gradualGain: "Gradual gain"
        }
    }
}

extension TargetSource {
    var localizedLabel: LocalizedStringKey {
        switch self {
        case .userProvided: "My target"
        case .reviewedEstimate: "Reviewed estimate"
        }
    }
}

extension DietType {
    var localizedLabel: LocalizedStringKey {
        switch self {
        case .vegetarian: "Vegetarian"
        case .eggetarian: "Eggetarian"
        case .vegan: "Vegan"
        case .nonVegetarian: "Non-vegetarian"
        }
    }
}

extension UnitSystem {
    var localizedLabel: LocalizedStringKey {
        switch self {
        case .metric: "Metric"
        case .imperial: "Imperial"
        }
    }
}

extension BudgetBand {
    var localizedLabel: LocalizedStringKey {
        switch self {
        case .value: "Value"
        case .medium: "Medium"
        case .flexible: "Flexible"
        }
    }
}

extension KitchenEquipment {
    var localizedLabel: LocalizedStringKey {
        switch self {
        case .stovetop: "Stovetop"
        case .pan: "Pan or kadai"
        case .pot: "Pot"
        case .pressureCooker: "Pressure cooker"
        case .oven: "Oven"
        case .microwave: "Microwave"
        case .blender: "Mixer or blender"
        case .airFryer: "Air fryer"
        }
    }
}

extension LeftoverPreference {
    var localizedLabel: LocalizedStringKey {
        switch self {
        case .avoid: "Avoid"
        case .planned: "Planned"
        case .often: "Often"
        }
    }
}

extension MealSlot {
    var localizedLabel: LocalizedStringKey {
        switch self {
        case .breakfast: "Breakfast"
        case .lunch: "Lunch"
        case .dinner: "Dinner"
        }
    }
}

extension SnackPreference {
    var localizedLabel: LocalizedStringKey {
        switch self {
        case .none: "None"
        case .optional: "Optional"
        case .planned: "Planned"
        }
    }
}

extension RecipePublicationStatus {
    var localizedLabel: LocalizedStringKey {
        switch self {
        case .draft: "Draft"
        case .review: "In review"
        case .published: "Published"
        case .archived: "Archived"
        }
    }
}

extension RecipeReviewStatus {
    var localizedLabel: LocalizedStringKey {
        switch self {
        case .pending: "Pending"
        case .approved: "Approved"
        case .rejected: "Rejected"
        case .stale: "Stale"
        }
    }
}

func localizedRuntimeMessage(_ message: String) -> Text {
    Text(LocalizedStringKey(message))
}

func localizedPlanLifecycle(_ status: String, isRegenerated: Bool) -> Text {
    let statusText: Text
    switch status.lowercased() {
    case "active": statusText = Text("Active")
    case "scheduled": statusText = Text("Scheduled")
    case "history": statusText = Text("History")
    case "draft": statusText = Text("Draft")
    default: statusText = Text(verbatim: status)
    }
    return isRegenerated ? statusText + Text(" · regenerated successor") : statusText
}

func localizedReconciliationStatus(_ status: String) -> Text {
    switch status.lowercased() {
    case "current": Text("Current")
    case "pending": Text("Pending")
    case "delayed": Text("Delayed")
    case "mismatch": Text("Mismatch")
    default: Text(verbatim: status)
    }
}
