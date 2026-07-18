export class FeedbackError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "FeedbackError";
    this.code = code;
    this.status = status;
    this.retryable = false;
  }
}

export class MemoryFeedbackStore {
  entries = [];

  async createMeal(entry) {
    const saved = { ...entry, id: entry.id ?? `feedback-${this.entries.length + 1}` };
    this.entries.push(structuredClone(saved));
    return saved;
  }

  async createWeeklyReview(entry) {
    const saved = { ...entry, id: entry.id ?? `feedback-${this.entries.length + 1}` };
    this.entries.push(structuredClone(saved));
    return saved;
  }
}

const allowedReasons = new Set(["taste", "effort", "cost", "portion", "ingredientAvailability"]);
const allowedWeeklyChanges = new Set(["moreVariety", "lessEffort", "lowerCost", "differentCuisines", "adjustPortions"]);

export class FeedbackService {
  constructor({ planService, store = new MemoryFeedbackStore(), now = () => new Date() }) {
    this.planService = planService;
    this.store = store;
    this.now = now;
  }

  async submit(userID, body) {
    if (body?.subjectType === "weeklyReview") return this.submitWeeklyReview(userID, body);
    const rating = Number(body?.rating);
    if (body?.subjectType !== "meal" || typeof body?.planItemID !== "string" || !body.planItemID.trim()) {
      throw new FeedbackError("VALIDATION_ERROR", "Choose a planned meal to rate.");
    }
    if (!await this.planService.ownsPlanItem(userID, body.planItemID)) {
      throw new FeedbackError("VALIDATION_ERROR", "This meal is not available for feedback.", 404);
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new FeedbackError("VALIDATION_ERROR", "Choose a rating from 1 to 5.");
    }
    const reasonTags = [...new Set(body.reasonTags ?? [])];
    if (reasonTags.some((reason) => !allowedReasons.has(reason))) {
      throw new FeedbackError("VALIDATION_ERROR", "One or more feedback reasons are not supported.");
    }
    const note = typeof body.note === "string" ? body.note.trim() : null;
    if ((note?.length ?? 0) > 500) throw new FeedbackError("VALIDATION_ERROR", "Feedback notes must be 500 characters or fewer.");
    const submittedAt = this.now();
    const entry = {
      id: null,
      userID,
      subjectType: "meal",
      planItemID: body.planItemID,
      recipeID: typeof body.recipeID === "string" ? body.recipeID : null,
      rating,
      reasonTags,
      note,
      submittedAt,
    };
    const saved = await this.store.createMeal(entry);
    return { id: saved.id, status: "recorded", submittedAt: saved.submittedAt };
  }

  
  async submitWeeklyReview(userID, body) {
    if (typeof body?.planID !== "string" || !await this.planService.ownsPlan(userID, body.planID)) {
      throw new FeedbackError("VALIDATION_ERROR", "This plan is not available for review.", 404);
    }
    const completionRate = Number(body.completionRate);
    if (!Number.isFinite(completionRate) || completionRate < 0 || completionRate > 1) {
      throw new FeedbackError("VALIDATION_ERROR", "Weekly completion must be between 0 and 1.");
    }
    const changesRequested = [...new Set(body.changesRequested ?? [])];
    if (changesRequested.some((change) => !allowedWeeklyChanges.has(change))) {
      throw new FeedbackError("VALIDATION_ERROR", "One or more weekly review changes are not supported.");
    }
    const submittedAt = this.now();
    const entry = {
      id: null,
      userID,
      subjectType: "weeklyReview",
      planID: body.planID,
      completionRate,
      changesRequested,
      submittedAt,
    };
    const saved = await this.store.createWeeklyReview(entry);
    return { id: saved.id, status: "recorded", submittedAt: saved.submittedAt };
  }
}
