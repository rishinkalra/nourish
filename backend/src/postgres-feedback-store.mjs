import { randomUUID } from "node:crypto";

export class PostgresFeedbackStore {
  constructor({ pool }) {
    if (!pool?.query) throw new Error("A PostgreSQL pool is required.");
    this.pool = pool;
  }

  async createMeal(entry) {
    const result = await this.pool.query(
      `INSERT INTO meal_feedback (
          id, user_id, plan_item_id, recipe_id, rating,
          reason_tags, note, submitted_at
       ) VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8)
       RETURNING id, submitted_at`,
      [
        randomUUID(), entry.userID, entry.planItemID, entry.recipeID,
        entry.rating, entry.reasonTags, entry.note, entry.submittedAt,
      ],
    );
    return { ...entry, id: result.rows[0].id, submittedAt: new Date(result.rows[0].submitted_at) };
  }

  async createWeeklyReview(entry) {
    const result = await this.pool.query(
      `INSERT INTO weekly_plan_reviews (
          id, user_id, weekly_plan_id, completion_rate,
          changes_requested, submitted_at
       ) VALUES ($1, $2, $3, $4, $5::text[], $6)
       RETURNING id, submitted_at`,
      [randomUUID(), entry.userID, entry.planID, entry.completionRate, entry.changesRequested, entry.submittedAt],
    );
    return { ...entry, id: result.rows[0].id, submittedAt: new Date(result.rows[0].submitted_at) };
  }
}
