import Combine
import Foundation
import NourishCore

enum DemoMealStatus: String, CaseIterable, Identifiable, Codable {
    case planned
    case completed
    case skipped
    case replacedOutside = "replaced outside"
    case moved

    var id: Self { self }
    var title: String { rawValue.capitalized }
}

struct DemoIngredient: Hashable, Codable {
    let id: String
    let name: String
    let category: String
    let grams: Int
    let householdDescription: String
}

struct DemoMeal: Identifiable, Hashable, Codable {
    let id: UUID
    let recipeID: String
    let slot: String
    let name: String
    let calories: Int
    let protein: Int
    let carbs: Int
    let fat: Int
    let activeMinutes: Int
    let cuisine: String
    let ingredients: [String]
    let groceryIngredients: [DemoIngredient]
    let method: [String]
    let allergens: [String]
    let intentionalLeftover: Bool
    let sourceMealName: String?
    let catalogueVersion: Int
    let reviewStatus: RecipeReviewStatus
    let publicationStatus: RecipePublicationStatus
    let nutritionSourceSummary: String

    init(
        id: UUID = UUID(),
        recipeID: String,
        slot: String,
        name: String,
        calories: Int,
        protein: Int,
        carbs: Int,
        fat: Int,
        activeMinutes: Int,
        cuisine: String,
        ingredients: [String],
        groceryIngredients: [DemoIngredient] = [],
        method: [String],
        allergens: [String] = [],
        intentionalLeftover: Bool = false,
        sourceMealName: String? = nil,
        catalogueVersion: Int = 1,
        reviewStatus: RecipeReviewStatus = .pending,
        publicationStatus: RecipePublicationStatus = .draft,
        nutritionSourceSummary: String = "Illustrative development fixture; no production nutrient source licensed"
    ) {
        self.id = id
        self.recipeID = recipeID
        self.slot = slot
        self.name = name
        self.calories = calories
        self.protein = protein
        self.carbs = carbs
        self.fat = fat
        self.activeMinutes = activeMinutes
        self.cuisine = cuisine
        self.ingredients = ingredients
        self.groceryIngredients = groceryIngredients
        self.method = method
        self.allergens = allergens
        self.intentionalLeftover = intentionalLeftover
        self.sourceMealName = sourceMealName
        self.catalogueVersion = catalogueVersion
        self.reviewStatus = reviewStatus
        self.publicationStatus = publicationStatus
        self.nutritionSourceSummary = nutritionSourceSummary
    }
}

struct DemoDay: Identifiable, Hashable, Codable {
    let id: Int
    let shortName: String
    let displayDate: String
    let calorieTarget: Int
    var meals: [DemoMeal]

    var plannedCalories: Int { meals.reduce(0) { $0 + $1.calories } }
    var plannedProtein: Int { meals.reduce(0) { $0 + $1.protein } }
}

struct DemoGroceryItem: Identifiable, Hashable, Codable {
    let id: String
    let category: String
    let name: String
    var requiredGrams: Int
    var quantityGrams: Int
    var householdDescription: String
    var changedBySwap: Bool = false
    var newlyAddedBySwap: Bool = false

    var quantity: String {
        NourishFormatting.massGrams(Double(quantityGrams))
    }
}

struct DemoPrepTask: Identifiable, Hashable, Codable {
    let id: String
    let day: String
    let title: String
    let activeMinutes: Int
    let storageNote: String
    let reuseNote: String
}

struct DemoSwapCandidate: Identifiable, Hashable, Codable {
    let id: String
    let meal: DemoMeal
}

private struct DemoPlanState: Codable {
    var days: [DemoDay]
    var mealStatuses: [UUID: DemoMealStatus]
    var groceries: [DemoGroceryItem]
    var checkedGroceryIDs: Set<String>
    var pantryGroceryIDs: Set<String>
    var prepTasks: [DemoPrepTask]
    var completedPrepIDs: Set<String>
}

@MainActor
final class DemoPlanStore: ObservableObject {
    @Published var days: [DemoDay]
    @Published var selectedDayIndex = 0
    @Published private(set) var mealStatuses: [UUID: DemoMealStatus]
    @Published var groceries: [DemoGroceryItem]
    @Published private(set) var checkedGroceryIDs: Set<String>
    @Published private(set) var pantryGroceryIDs: Set<String>
    @Published var prepTasks: [DemoPrepTask]
    @Published private(set) var completedPrepIDs: Set<String>
    @Published private(set) var lastSwappedMealName: String?

    private let persistenceURL: URL?

    init(fileManager: FileManager = .default) {
        persistenceURL = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appending(path: "ProjectNourish")
            .appending(path: "illustrative-weekly-loop.json")
        if let persistenceURL,
           let data = try? Data(contentsOf: persistenceURL),
           let state = try? JSONDecoder().decode(DemoPlanState.self, from: data) {
            days = state.days
            mealStatuses = state.mealStatuses
            groceries = DemoPlanStore.deriveGroceries(from: state.days, preserving: state.groceries)
            checkedGroceryIDs = state.checkedGroceryIDs
            pantryGroceryIDs = state.pantryGroceryIDs
            prepTasks = DemoPlanStore.derivePrepTasks(from: state.days, preserving: state.prepTasks)
            completedPrepIDs = state.completedPrepIDs
        } else {
            let initialDays = DemoPlanStore.makeDays()
            days = initialDays
            mealStatuses = [:]
            groceries = DemoPlanStore.deriveGroceries(from: initialDays)
            checkedGroceryIDs = []
            pantryGroceryIDs = []
            prepTasks = DemoPlanStore.derivePrepTasks(from: initialDays)
            completedPrepIDs = []
        }
    }

    var selectedDay: DemoDay { days[selectedDayIndex] }
    var groceryProgress: Double {
        guard !groceries.isEmpty else { return 0 }
        return Double(checkedGroceryIDs.count + pantryGroceryIDs.count) / Double(groceries.count)
    }

    func status(for meal: DemoMeal) -> DemoMealStatus {
        mealStatuses[meal.id] ?? .planned
    }

    func setStatus(_ status: DemoMealStatus, for meal: DemoMeal) {
        mealStatuses[meal.id] = status
        persist()
    }

    func toggleGrocery(_ item: DemoGroceryItem) {
        pantryGroceryIDs.remove(item.id)
        if checkedGroceryIDs.contains(item.id) {
            checkedGroceryIDs.remove(item.id)
        } else {
            checkedGroceryIDs.insert(item.id)
        }
        persist()
    }

    func togglePantry(_ item: DemoGroceryItem) {
        checkedGroceryIDs.remove(item.id)
        if pantryGroceryIDs.contains(item.id) {
            pantryGroceryIDs.remove(item.id)
        } else {
            pantryGroceryIDs.insert(item.id)
        }
        persist()
    }

    func adjustQuantity(_ item: DemoGroceryItem, by grams: Int) {
        guard let index = groceries.firstIndex(where: { $0.id == item.id }) else { return }
        groceries[index].quantityGrams = max(1, groceries[index].quantityGrams + grams)
        groceries[index].changedBySwap = false
        persist()
    }

    func togglePrep(_ task: DemoPrepTask) {
        if completedPrepIDs.contains(task.id) {
            completedPrepIDs.remove(task.id)
        } else {
            completedPrepIDs.insert(task.id)
        }
        persist()
    }

    func applySwap(replacing original: DemoMeal, with candidate: DemoSwapCandidate) {
        guard let dayIndex = days.firstIndex(where: { day in day.meals.contains(where: { $0.id == original.id }) }),
              let mealIndex = days[dayIndex].meals.firstIndex(where: { $0.id == original.id }) else { return }

        let replacement = DemoMeal(
            id: original.id,
            recipeID: candidate.meal.recipeID,
            slot: original.slot,
            name: candidate.meal.name,
            calories: candidate.meal.calories,
            protein: candidate.meal.protein,
            carbs: candidate.meal.carbs,
            fat: candidate.meal.fat,
            activeMinutes: candidate.meal.activeMinutes,
            cuisine: candidate.meal.cuisine,
            ingredients: candidate.meal.ingredients,
            groceryIngredients: candidate.meal.groceryIngredients,
            method: candidate.meal.method,
            allergens: candidate.meal.allergens,
            catalogueVersion: candidate.meal.catalogueVersion,
            reviewStatus: candidate.meal.reviewStatus,
            publicationStatus: candidate.meal.publicationStatus,
            nutritionSourceSummary: candidate.meal.nutritionSourceSummary
        )
        days[dayIndex].meals[mealIndex] = replacement
        mealStatuses[original.id] = .planned

        groceries = DemoPlanStore.deriveGroceries(from: days, preserving: groceries)
        prepTasks = DemoPlanStore.derivePrepTasks(from: days, preserving: prepTasks)
        completedPrepIDs.formIntersection(Set(prepTasks.map(\.id)))
        checkedGroceryIDs.formIntersection(Set(groceries.map(\.id)))
        pantryGroceryIDs.formIntersection(Set(groceries.map(\.id)))
        lastSwappedMealName = original.name
        persist()
    }

    func clearMessage() {
        lastSwappedMealName = nil
    }

    private func persist() {
        guard let persistenceURL else { return }
        let state = DemoPlanState(
            days: days,
            mealStatuses: mealStatuses,
            groceries: groceries,
            checkedGroceryIDs: checkedGroceryIDs,
            pantryGroceryIDs: pantryGroceryIDs,
            prepTasks: prepTasks,
            completedPrepIDs: completedPrepIDs
        )
        do {
            try FileManager.default.createDirectory(at: persistenceURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(state).write(
                to: persistenceURL,
                options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
            )
        } catch {
            assertionFailure("Unable to persist illustrative weekly loop: \(error)")
        }
    }

    func swapCandidates(for meal: DemoMeal) -> [DemoSwapCandidate] {
        let base: [DemoMeal]
        switch meal.slot {
        case "Breakfast":
            base = [
                DemoPlanStore.mealTemplate("swap-breakfast-1", "Ragi vegetable dosa", 405, 14, 58, 12, 25, "South Indian"),
                DemoPlanStore.mealTemplate("swap-breakfast-2", "Paneer bhurji toast", 430, 24, 42, 17, 20, "Indian")
            ]
        case "Lunch":
            base = [
                DemoPlanStore.mealTemplate("swap-lunch-1", "Chole millet bowl", 595, 25, 88, 16, 25, "North Indian"),
                DemoPlanStore.mealTemplate("swap-lunch-2", "Tofu lemon rice bowl", 575, 29, 73, 18, 25, "South Indian")
            ]
        default:
            base = [
                DemoPlanStore.mealTemplate("swap-dinner-1", "Rajma quinoa bowl", 590, 28, 82, 15, 30, "North Indian"),
                DemoPlanStore.mealTemplate("swap-dinner-2", "Tofu kathi roll", 610, 31, 66, 22, 30, "Indian street food")
            ]
        }
        return base.map { DemoSwapCandidate(id: $0.recipeID, meal: $0) }
    }
}

private extension DemoPlanStore {
    static func mealTemplate(
        _ recipeID: String,
        _ name: String,
        _ calories: Int,
        _ protein: Int,
        _ carbs: Int,
        _ fat: Int,
        _ minutes: Int,
        _ cuisine: String,
        slot: String = "Dinner",
        leftover: Bool = false,
        source: String? = nil
    ) -> DemoMeal {
        let groceryIngredients = fixtureIngredients(recipeID: recipeID, name: name)
        return DemoMeal(
            recipeID: recipeID,
            slot: slot,
            name: name,
            calories: calories,
            protein: protein,
            carbs: carbs,
            fat: fat,
            activeMinutes: minutes,
            cuisine: cuisine,
            ingredients: groceryIngredients.map { "\($0.householdDescription) \($0.name) (\($0.grams) g)" },
            groceryIngredients: groceryIngredients,
            method: ["Prepare and measure the ingredients.", "Cook the base until aromatic.", "Add the remaining ingredients and simmer until done.", "Portion one serving and cool any planned leftovers promptly."],
            allergens: name.localizedCaseInsensitiveContains("paneer") ? ["Milk"] : [],
            intentionalLeftover: leftover,
            sourceMealName: source
        )
    }

    static func makeDays() -> [DemoDay] {
        [
            DemoDay(id: 0, shortName: "Mon", displayDate: "Monday, 13 July", calorieTarget: 1_700, meals: [
                mealTemplate("masala-oats", "Masala oats bowl", 390, 17, 58, 11, 15, "Indian", slot: "Breakfast"),
                mealTemplate("rajma-rice", "Rajma rice bowl", 610, 25, 92, 15, 25, "North Indian", slot: "Lunch"),
                mealTemplate("palak-paneer", "Palak paneer plate", 620, 32, 55, 28, 35, "North Indian")
            ]),
            DemoDay(id: 1, shortName: "Tue", displayDate: "Tuesday, 14 July", calorieTarget: 1_700, meals: [
                mealTemplate("besan-chilla", "Besan chilla with chutney", 410, 20, 48, 15, 20, "North Indian", slot: "Breakfast"),
                mealTemplate("palak-paneer", "Palak paneer lunch", 600, 31, 54, 27, 8, "North Indian", slot: "Lunch", leftover: true, source: "Monday dinner"),
                mealTemplate("veg-biryani", "Vegetable biryani with raita", 650, 21, 96, 20, 35, "Hyderabadi")
            ]),
            DemoDay(id: 2, shortName: "Wed", displayDate: "Wednesday, 15 July", calorieTarget: 1_700, meals: [
                mealTemplate("idli-sambar", "Idli and sambar", 380, 15, 67, 7, 20, "South Indian", slot: "Breakfast"),
                mealTemplate("chole-millet", "Chole millet bowl", 620, 26, 91, 17, 25, "North Indian", slot: "Lunch"),
                mealTemplate("tofu-kathi", "Tofu kathi roll", 590, 30, 64, 21, 30, "Indian street food")
            ]),
            DemoDay(id: 3, shortName: "Thu", displayDate: "Thursday, 16 July", calorieTarget: 1_700, meals: [
                mealTemplate("poha", "Vegetable poha", 400, 13, 63, 12, 18, "Maharashtrian", slot: "Breakfast"),
                mealTemplate("lemon-rice", "Lemon rice and beans", 580, 22, 86, 16, 22, "South Indian", slot: "Lunch"),
                mealTemplate("dal-tadka", "Dal tadka with roti", 630, 29, 88, 18, 30, "North Indian")
            ]),
            DemoDay(id: 4, shortName: "Fri", displayDate: "Friday, 17 July", calorieTarget: 1_700, meals: [
                mealTemplate("upma", "Vegetable upma", 395, 14, 61, 11, 18, "South Indian", slot: "Breakfast"),
                mealTemplate("paneer-wrap", "Paneer tikka wrap", 610, 30, 67, 23, 30, "North Indian", slot: "Lunch"),
                mealTemplate("khichdi", "Moong khichdi with kadhi", 600, 24, 85, 18, 28, "Gujarati")
            ]),
            DemoDay(id: 5, shortName: "Sat", displayDate: "Saturday, 18 July", calorieTarget: 1_700, meals: [
                mealTemplate("moong-chilla", "Moong chilla plate", 430, 24, 47, 16, 25, "North Indian", slot: "Breakfast"),
                mealTemplate("sambar-rice", "Sambar rice bowl", 620, 23, 96, 16, 30, "South Indian", slot: "Lunch"),
                mealTemplate("mushroom-matar", "Mushroom matar with phulka", 610, 25, 76, 22, 30, "North Indian")
            ]),
            DemoDay(id: 6, shortName: "Sun", displayDate: "Sunday, 19 July", calorieTarget: 1_700, meals: [
                mealTemplate("dosa", "Dosa with tomato chutney", 450, 13, 72, 13, 30, "South Indian", slot: "Breakfast"),
                mealTemplate("kala-chana", "Kala chana chaat", 560, 27, 78, 15, 20, "North Indian", slot: "Lunch"),
                mealTemplate("veg-pulao", "Vegetable pulao with raita", 640, 20, 94, 20, 30, "Indian")
            ])
        ]
    }

    static func fixtureIngredients(recipeID: String, name: String) -> [DemoIngredient] {
        let text = "\(recipeID) \(name)".lowercased()
        var ingredients = [
            DemoIngredient(id: "onion", name: "Onions", category: "Produce", grams: 60, householdDescription: "½ cup"),
            DemoIngredient(id: "tomato", name: "Tomatoes", category: "Produce", grams: 80, householdDescription: "½ cup"),
            DemoIngredient(id: "oil", name: "Cooking oil", category: "Pantry", grams: 5, householdDescription: "1 tsp")
        ]
        if text.contains("paneer") { ingredients.append(.init(id: "paneer", name: "Paneer", category: "Dairy", grams: 150, householdDescription: "1 cup")) }
        if text.contains("tofu") { ingredients.append(.init(id: "tofu", name: "Firm tofu", category: "Protein", grams: 180, householdDescription: "1 cup")) }
        if text.contains("palak") || text.contains("spinach") { ingredients.append(.init(id: "spinach", name: "Spinach", category: "Produce", grams: 120, householdDescription: "2 cups")) }
        if ["rice", "biryani", "pulao", "idli", "dosa"].contains(where: text.contains) { ingredients.append(.init(id: "rice", name: "Rice", category: "Grains", grams: 100, householdDescription: "½ cup dry")) }
        if ["rajma", "chole", "chana", "dal", "moong", "sambar", "besan"].contains(where: text.contains) { ingredients.append(.init(id: "pulses", name: "Dals and beans", category: "Protein", grams: 100, householdDescription: "½ cup dry")) }
        if ["roti", "wrap", "kathi", "chilla", "phulka"].contains(where: text.contains) { ingredients.append(.init(id: "atta", name: "Whole-wheat atta", category: "Grains", grams: 80, householdDescription: "⅔ cup")) }
        if text.contains("millet") { ingredients.append(.init(id: "millet", name: "Millet", category: "Grains", grams: 90, householdDescription: "½ cup dry")) }
        if text.contains("oats") { ingredients.append(.init(id: "oats", name: "Rolled oats", category: "Grains", grams: 80, householdDescription: "1 cup")) }
        if ["vegetable", "mushroom", "matar", "poha", "upma"].contains(where: text.contains) { ingredients.append(.init(id: "mixed-vegetables", name: "Mixed vegetables", category: "Produce", grams: 140, householdDescription: "1 cup")) }
        if text.contains("raita") || text.contains("kadhi") { ingredients.append(.init(id: "curd", name: "Plain curd", category: "Dairy", grams: 120, householdDescription: "½ cup")) }
        return ingredients
    }

    static func deriveGroceries(from days: [DemoDay], preserving previous: [DemoGroceryItem]? = nil) -> [DemoGroceryItem] {
        var totals: [String: (name: String, category: String, grams: Int, households: [String: Int])] = [:]
        for meal in days.flatMap(\.meals) where !meal.intentionalLeftover {
            for ingredient in meal.groceryIngredients {
                var total = totals[ingredient.id] ?? (ingredient.name, ingredient.category, 0, [:])
                total.grams += ingredient.grams
                total.households[ingredient.householdDescription, default: 0] += 1
                totals[ingredient.id] = total
            }
        }
        let prior = Dictionary(uniqueKeysWithValues: (previous ?? []).map { ($0.id, $0) })
        return totals.map { id, total in
            let old = prior[id]
            let userAdjustment = old.map { $0.quantityGrams - $0.requiredGrams } ?? 0
            return DemoGroceryItem(
                id: id,
                category: total.category,
                name: total.name,
                requiredGrams: total.grams,
                quantityGrams: max(1, total.grams + userAdjustment),
                householdDescription: total.households.sorted { $0.key < $1.key }.map { description, count in
                    count == 1 ? description : "\(count) × \(description)"
                }.joined(separator: " + "),
                changedBySwap: old.map { $0.requiredGrams != total.grams } ?? false,
                newlyAddedBySwap: previous != nil && old == nil
            )
        }.sorted {
            if $0.category != $1.category { return $0.category < $1.category }
            return $0.name < $1.name
        }
    }

    static func derivePrepTasks(from days: [DemoDay], preserving previous: [DemoPrepTask]? = nil) -> [DemoPrepTask] {
        _ = previous
        var tasks: [DemoPrepTask] = days.flatMap(\.meals).compactMap { meal in
            guard meal.intentionalLeftover else { return nil }
            return DemoPrepTask(
                id: "leftover-\(meal.recipeID)",
                day: meal.sourceMealName ?? "Earlier cooking session",
                title: "Pack \(meal.name) for planned reuse",
                activeMinutes: 3,
                storageNote: "Cool promptly and refrigerate in a shallow sealed container.",
                reuseNote: "Reserved for \(meal.slot.lowercased()); this is intentional reuse, not accidental repetition."
            )
        }
        let recurring = days.flatMap(\.meals).filter { !$0.intentionalLeftover }.flatMap(\.groceryIngredients)
        let recurringCounts = recurring.reduce(into: [String: Int]()) { $0[$1.id, default: 0] += 1 }
        if recurringCounts["onion", default: 0] >= 3 && recurringCounts["tomato", default: 0] >= 3 {
            tasks.insert(.init(
                id: "shared-onion-tomato-base",
                day: "Sunday setup",
                title: "Prepare shared onion-tomato base",
                activeMinutes: 20,
                storageNote: "Cool within 2 hours and refrigerate portions in clean sealed containers.",
                reuseNote: "Shared across the week's meals that use onion and tomato."
            ), at: 0)
        }
        return tasks
    }
}
