import Foundation

public enum CatalogueRole: String, Codable, Hashable, Sendable {
    case author
    case reviewer
}

public struct CatalogueActor: Codable, Equatable, Sendable {
    public let id: String
    public let roles: Set<CatalogueRole>

    public init(id: String, roles: Set<CatalogueRole>) {
        self.id = id
        self.roles = roles
    }
}

public enum CatalogueValidationIssue: Equatable, Sendable {
    case missingName
    case missingIngredients
    case invalidIngredientQuantity(String)
    case unknownIngredient(String)
    case unverifiedIngredient(String)
    case missingMethod
    case invalidServing
    case invalidNutrition
    case missingNutrientRecord(String)
    case nutrientRecordIngredientMismatch(String)
    case nutrientRecordNotReviewed(String)
    case nutrientRecordNotEffective(String)
    case nutrientSourceNotLicensed(String)
    case allergenDeclarationMismatch(expected: Set<String>, declared: Set<String>)
    case dietIncompatibleIngredient(String)
    case missingCalculationVersion
}

public enum RecipeCatalogueValidator {
    public static func issues(
        for content: RecipeVersionContent,
        ingredients: [String: IngredientDefinition],
        nutrientRecords: [String: IngredientNutrientRecord],
        at date: Date
    ) -> [CatalogueValidationIssue] {
        var issues: [CatalogueValidationIssue] = []
        if content.displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { issues.append(.missingName) }
        if content.ingredients.isEmpty { issues.append(.missingIngredients) }
        if content.methodSteps.isEmpty || content.methodSteps.contains(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
            issues.append(.missingMethod)
        }
        let minimumMultiplier = content.minimumServingMultiplier ?? 1
        let maximumMultiplier = content.maximumServingMultiplier ?? 1
        if content.servings <= 0 || content.servingSizeGrams <= 0
            || minimumMultiplier < Decimal(string: "0.25")!
            || maximumMultiplier > 4
            || minimumMultiplier > 1
            || maximumMultiplier < 1
            || minimumMultiplier > maximumMultiplier {
            issues.append(.invalidServing)
        }
        if hasInvalidNutrition(content.nutritionPerServing) { issues.append(.invalidNutrition) }
        if content.nutritionCalculationVersion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            issues.append(.missingCalculationVersion)
        }

        var derivedAllergens: Set<String> = []
        for recipeIngredient in content.ingredients {
            if recipeIngredient.grams <= 0 || recipeIngredient.householdQuantity <= 0 {
                issues.append(.invalidIngredientQuantity(recipeIngredient.ingredientID))
            }
            guard let ingredient = ingredients[recipeIngredient.ingredientID] else {
                issues.append(.unknownIngredient(recipeIngredient.ingredientID))
                continue
            }
            if ingredient.sourceStatus != .verified { issues.append(.unverifiedIngredient(ingredient.id)) }
            if !ingredient.compatibleDiets.contains(content.dietType) { issues.append(.dietIncompatibleIngredient(ingredient.id)) }
            derivedAllergens.formUnion(ingredient.allergenIDs)
        }
        if derivedAllergens != content.declaredAllergenIDs {
            issues.append(.allergenDeclarationMismatch(expected: derivedAllergens, declared: content.declaredAllergenIDs))
        }

        for recordID in content.nutrientRecordIDs {
            guard let record = nutrientRecords[recordID] else {
                issues.append(.missingNutrientRecord(recordID))
                continue
            }
            if !content.ingredients.contains(where: { $0.ingredientID == record.ingredientID }) {
                issues.append(.nutrientRecordIngredientMismatch(recordID))
            }
            if record.reviewedBy == nil || record.reviewedAt == nil {
                issues.append(.nutrientRecordNotReviewed(recordID))
            }
            if record.effectiveFrom > date || (record.effectiveUntil.map { $0 <= date } ?? false) {
                issues.append(.nutrientRecordNotEffective(recordID))
            }
            if record.source.licenseStatus != .approvedForProduction {
                issues.append(.nutrientSourceNotLicensed(recordID))
            }
        }
        let coveredIngredientIDs = Set(content.nutrientRecordIDs.compactMap { nutrientRecords[$0]?.ingredientID })
        for ingredientID in Set(content.ingredients.map(\.ingredientID)).subtracting(coveredIngredientIDs) {
            issues.append(.missingNutrientRecord(ingredientID))
        }
        return issues
    }

    private static func hasInvalidNutrition(_ nutrition: Nutrition) -> Bool {
        nutrition.calories <= 0 || nutrition.proteinGrams < 0 || nutrition.carbohydrateGrams < 0 || nutrition.fatGrams < 0 || nutrition.fibreGrams < 0
    }
}

public enum CatalogueWorkflowError: Error, Equatable, Sendable {
    case unauthorized
    case recipeNotFound
    case versionNotFound
    case immutablePublishedVersion
    case invalidTransition
    case authorCannotReviewOwnVersion
    case validationFailed([CatalogueValidationIssue])
    case rejectionReasonRequired
}

public struct CatalogueAuditEvent: Codable, Equatable, Sendable {
    public let actorID: String
    public let action: String
    public let recipeVersionID: String
    public let reason: String?
    public let timestamp: Date
}

public actor InMemoryRecipeCatalogue {
    private var ingredients: [String: IngredientDefinition] = [:]
    private var nutrientRecords: [String: IngredientNutrientRecord] = [:]
    private var recipes: [String: RecipeRecord] = [:]
    private var versions: [String: RecipeVersionRecord] = [:]
    private var auditEvents: [CatalogueAuditEvent] = []

    public init() {}

    public func registerIngredient(_ ingredient: IngredientDefinition) {
        ingredients[ingredient.id] = ingredient
    }

    public func registerNutrientRecord(_ record: IngredientNutrientRecord) {
        nutrientRecords[record.id] = record
    }

    public func registerRecipe(_ recipe: RecipeRecord) {
        recipes[recipe.id] = recipe
    }

    public func createDraft(
        recipeID: String,
        content: RecipeVersionContent,
        actor: CatalogueActor,
        at date: Date = .now
    ) throws -> RecipeVersionRecord {
        guard actor.roles.contains(.author) else { throw CatalogueWorkflowError.unauthorized }
        guard recipes[recipeID] != nil else { throw CatalogueWorkflowError.recipeNotFound }
        let version = versions.values.filter { $0.recipeID == recipeID }.map(\.version).max().map { $0 + 1 } ?? 1
        let record = RecipeVersionRecord(
            id: "\(recipeID)-v\(version)",
            recipeID: recipeID,
            version: version,
            content: content,
            workflowState: .draft,
            authoredBy: actor.id,
            createdAt: date
        )
        versions[record.id] = record
        audit(actor, "recipe_version.created", record.id, nil, date)
        return record
    }

    public func editDraft(
        id: String,
        content: RecipeVersionContent,
        actor: CatalogueActor,
        at date: Date = .now
    ) throws -> RecipeVersionRecord {
        guard actor.roles.contains(.author) else { throw CatalogueWorkflowError.unauthorized }
        guard let current = versions[id] else { throw CatalogueWorkflowError.versionNotFound }
        if current.workflowState == .published || current.workflowState == .archived {
            throw CatalogueWorkflowError.immutablePublishedVersion
        }
        guard current.workflowState == .draft || current.workflowState == .rejected else {
            throw CatalogueWorkflowError.invalidTransition
        }
        let updated = RecipeVersionRecord(
            id: current.id,
            recipeID: current.recipeID,
            version: current.version,
            content: content,
            workflowState: .draft,
            authoredBy: current.authoredBy,
            createdAt: current.createdAt
        )
        versions[id] = updated
        audit(actor, "recipe_version.edited", id, nil, date)
        return updated
    }

    public func submit(id: String, actor: CatalogueActor, at date: Date = .now) throws -> RecipeVersionRecord {
        guard actor.roles.contains(.author) else { throw CatalogueWorkflowError.unauthorized }
        guard let current = versions[id] else { throw CatalogueWorkflowError.versionNotFound }
        guard current.workflowState == .draft else { throw CatalogueWorkflowError.invalidTransition }
        let issues = RecipeCatalogueValidator.issues(for: current.content, ingredients: ingredients, nutrientRecords: nutrientRecords, at: date)
        guard issues.isEmpty else { throw CatalogueWorkflowError.validationFailed(issues) }
        let submitted = copy(current, state: .inReview, submittedAt: date)
        versions[id] = submitted
        audit(actor, "recipe_version.submitted", id, nil, date)
        return submitted
    }

    public func approve(id: String, actor: CatalogueActor, at date: Date = .now) throws -> RecipeVersionRecord {
        guard actor.roles.contains(.reviewer) else { throw CatalogueWorkflowError.unauthorized }
        guard let current = versions[id] else { throw CatalogueWorkflowError.versionNotFound }
        guard current.workflowState == .inReview else { throw CatalogueWorkflowError.invalidTransition }
        guard current.authoredBy != actor.id else { throw CatalogueWorkflowError.authorCannotReviewOwnVersion }
        let issues = RecipeCatalogueValidator.issues(for: current.content, ingredients: ingredients, nutrientRecords: nutrientRecords, at: date)
        guard issues.isEmpty else { throw CatalogueWorkflowError.validationFailed(issues) }
        let published = copy(current, state: .published, reviewedBy: actor.id, reviewedAt: date, publishedAt: date)
        versions[id] = published
        audit(actor, "recipe_version.published", id, nil, date)
        return published
    }

    public func reject(id: String, reason: String, actor: CatalogueActor, at date: Date = .now) throws -> RecipeVersionRecord {
        guard actor.roles.contains(.reviewer) else { throw CatalogueWorkflowError.unauthorized }
        guard !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw CatalogueWorkflowError.rejectionReasonRequired
        }
        guard let current = versions[id] else { throw CatalogueWorkflowError.versionNotFound }
        guard current.workflowState == .inReview else { throw CatalogueWorkflowError.invalidTransition }
        let rejected = copy(current, state: .rejected, reviewedBy: actor.id, reviewedAt: date, rejectionReason: reason)
        versions[id] = rejected
        audit(actor, "recipe_version.rejected", id, reason, date)
        return rejected
    }

    public func version(id: String) -> RecipeVersionRecord? { versions[id] }
    public func auditLog() -> [CatalogueAuditEvent] { auditEvents }

    public func publishedSnapshot(id: String) throws -> RecipeSnapshot {
        guard let version = versions[id] else { throw CatalogueWorkflowError.versionNotFound }
        guard version.workflowState == .published else { throw CatalogueWorkflowError.invalidTransition }
        guard let recipe = recipes[version.recipeID] else { throw CatalogueWorkflowError.recipeNotFound }
        let snapshots = try version.content.ingredients.map { item -> IngredientSnapshot in
            guard let ingredient = ingredients[item.ingredientID] else {
                throw CatalogueWorkflowError.validationFailed([.unknownIngredient(item.ingredientID)])
            }
            return IngredientSnapshot(
                ingredientID: ingredient.id,
                displayName: ingredient.canonicalName,
                householdQuantity: item.householdQuantity,
                householdUnit: item.householdUnit,
                grams: item.grams,
                allergenIDs: ingredient.allergenIDs
            )
        }
        let sources = version.content.nutrientRecordIDs.compactMap { nutrientRecords[$0]?.source }
        let sourceSummary = Set(sources.map { "\($0.provider) \($0.dataset) \($0.datasetVersion)" })
            .sorted()
            .joined(separator: "; ")
        return RecipeSnapshot(
            recipeID: recipe.id,
            localeIdentifier: recipe.localeIdentifier,
            version: version.version,
            displayName: version.content.displayName,
            ingredients: snapshots,
            methodSteps: version.content.methodSteps,
            servingSizeGrams: version.content.servingSizeGrams,
            nutritionPerServing: version.content.nutritionPerServing,
            activePreparationMinutes: recipe.activePreparationMinutes,
            totalMinutes: recipe.totalMinutes,
            tags: version.content.tags,
            allergenIDs: version.content.declaredAllergenIDs,
            dietType: version.content.dietType,
            eligibleSlots: recipe.eligibleSlots,
            dominantIngredientIDs: version.content.dominantIngredientIDs,
            nutritionSourceSummary: sourceSummary,
            nutritionCalculationVersion: version.content.nutritionCalculationVersion,
            reviewStatus: .approved,
            publicationStatus: .published,
            equipment: recipe.equipment,
            costBand: recipe.costBand,
            minimumServingMultiplier: version.content.minimumServingMultiplier ?? 1,
            maximumServingMultiplier: version.content.maximumServingMultiplier ?? 1
        )
    }

    private func copy(
        _ current: RecipeVersionRecord,
        state: RecipeVersionWorkflowState,
        submittedAt: Date? = nil,
        reviewedBy: String? = nil,
        reviewedAt: Date? = nil,
        publishedAt: Date? = nil,
        rejectionReason: String? = nil
    ) -> RecipeVersionRecord {
        RecipeVersionRecord(
            id: current.id,
            recipeID: current.recipeID,
            version: current.version,
            content: current.content,
            workflowState: state,
            authoredBy: current.authoredBy,
            createdAt: current.createdAt,
            submittedAt: submittedAt ?? current.submittedAt,
            reviewedBy: reviewedBy,
            reviewedAt: reviewedAt,
            publishedAt: publishedAt,
            rejectionReason: rejectionReason
        )
    }

    private func audit(_ actor: CatalogueActor, _ action: String, _ versionID: String, _ reason: String?, _ date: Date) {
        auditEvents.append(CatalogueAuditEvent(actorID: actor.id, action: action, recipeVersionID: versionID, reason: reason, timestamp: date))
    }
}
