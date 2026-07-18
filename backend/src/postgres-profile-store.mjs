import { ProfileError } from "./profile-service.mjs";

export class PostgresProfileStore {
  constructor({ pool }) {
    if (!pool?.query) throw new Error("A PostgreSQL pool is required.");
    this.pool = pool;
  }

  async read(userID) {
    const result = await this.pool.query(
      `SELECT profile_json, revision, effective_scope, updated_at
         FROM profiles
        WHERE user_id = $1`,
      [userID],
    );
    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  }

  async compareAndSet(userID, request, updatedAt) {
    const values = [userID, JSON.stringify(request.profile), request.changeScope, request.expectedRevision, updatedAt];
    const result = request.expectedRevision === 0
      ? await this.pool.query(
        `INSERT INTO profiles (
            user_id, revision, effective_scope, profile_json, created_at, updated_at
         ) VALUES ($1, 1, $3, $2::jsonb, $5, $5)
         ON CONFLICT (user_id) DO NOTHING
         RETURNING profile_json, revision, effective_scope, updated_at`,
        values,
      )
      : await this.pool.query(
        `UPDATE profiles
            SET revision = revision + 1,
                effective_scope = $3,
                profile_json = $2::jsonb,
                updated_at = $5
          WHERE user_id = $1 AND revision = $4
        RETURNING profile_json, revision, effective_scope, updated_at`,
        values,
      );
    if (!result.rows[0]) {
      throw new ProfileError("CONFLICT", "Your preferences changed elsewhere. Refresh and try again.", 409);
    }
    return mapProfile(result.rows[0]);
  }
}

function mapProfile(row) {
  return {
    profile: typeof row.profile_json === "string" ? JSON.parse(row.profile_json) : row.profile_json,
    revision: row.revision,
    effectiveScope: row.effective_scope,
    updatedAt: new Date(row.updated_at),
  };
}
