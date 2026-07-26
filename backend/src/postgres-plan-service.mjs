import { createHash, randomUUID } from "node:crypto";
import { withTransaction } from "./database.mjs";
import { PlanError } from "./planner-service.mjs";
import { deterministicUUID, isUUID } from "./stable-identifiers.mjs";

const generatorVersion = "whole-week-serving-planner-v2";
const scoringVersion = "wellness-score-v3";
const ruleVersion = "eligibility-rules-v1";

export class PostgresPlannerService {
  constructor({ pool, now = () => new Date() }) {
    if (!pool?.query || !pool?.connect) throw new Error("A PostgreSQL pool is required.");
    this.pool = pool;
    this.now = now;
  }

  async create({ userID, profile, profileRevision = 1, request, idempotencyKey, correlationID }) {
    if (!profile) throw new PlanError("PROFILE_INELIGIBLE", "Complete your planning profile first.");
    if (!idempotencyKey) throw new PlanError("VALIDATION_ERROR", "An idempotency key is required.", 400);
    const weekStart = requireDateKey(request?.weekStartLocalDate);
    if (request?.trigger === "manual_regeneration" && weekStart < localDateKey(this.now(), profile.timeZoneIdentifier)) {
      throw new PlanError("VALIDATION_ERROR", "Only a future week can be regenerated. Use meal swaps for the active week.", 400);
    }
    const now = this.now();
    const jobID = randomUUID();
    const backgroundJobID = randomUUID();
    const seed = request?.deterministicSeed || `${userID}|${weekStart}`;
    const correlationUUID = isUUID(correlationID) ? correlationID : deterministicUUID(`correlation|${correlationID ?? randomUUID()}`);
    return withTransaction(this.pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO plan_jobs (
            id, user_id, idempotency_key, state, week_start,
            time_zone_identifier, trigger, regeneration_reason,
            generator_version, scoring_version, rule_version,
            deterministic_seed_sha256, correlation_id, profile_revision,
            request_json, created_at
         ) VALUES ($1, $2, $3, 'queued', $4, $5, $6, $7, $8, $9, $10,
                   $11, $12, $13, $14::jsonb, $15)
         ON CONFLICT (user_id, idempotency_key) DO UPDATE
            SET idempotency_key = EXCLUDED.idempotency_key
         RETURNING *`,
        [
          jobID, userID, idempotencyKey, weekStart, profile.timeZoneIdentifier,
          request?.trigger ?? "initial", request?.regenerationReason ?? null,
          generatorVersion, scoringVersion, ruleVersion, sha256(seed),
          correlationUUID, profileRevision, JSON.stringify({ ...request, deterministicSeed: seed, profileSnapshot: profile }), now,
        ],
      );
      const job = inserted.rows[0];
      await client.query(
        `INSERT INTO background_jobs (
            id, job_type, user_id, idempotency_key, state, payload_json,
            max_attempts, available_at, created_at, updated_at
         ) VALUES ($1, 'plan.generate', $2, $3, 'queued', $4::jsonb, 8, $5, $5, $5)
         ON CONFLICT (job_type, idempotency_key) DO NOTHING`,
        [
          backgroundJobID,
          userID,
          `plan:${userID}:${idempotencyKey}`,
          JSON.stringify({ planJobID: job.id, correlationID: correlationUUID }),
          now,
        ],
      );
      const materialized = await client.query("SELECT id FROM weekly_plans WHERE plan_job_id = $1", [job.id]);
      return mapJob({ ...job, plan_id: materialized.rows[0]?.id ?? null });
    });
  }

  async read(jobOrPlanID, userID) {
    if (!isUUID(jobOrPlanID)) throw new PlanError("VALIDATION_ERROR", "Plan not found.", 404);
    const jobResult = await this.pool.query(
      `SELECT job.*, plan.id AS plan_id
         FROM plan_jobs job
         LEFT JOIN weekly_plans plan ON plan.plan_job_id = job.id
        WHERE job.id = $1 AND job.user_id = $2`,
      [jobOrPlanID, userID],
    );
    if (jobResult.rows[0]) {
      const row = jobResult.rows[0];
      const record = row.plan_id ? await this.#loadPlan(row.plan_id, userID) : null;
      return { job: mapJob(row), plan: record?.plan ?? null, diagnostics: record?.diagnostics ?? row.diagnostics_json ?? null };
    }
    const record = await this.#loadPlan(jobOrPlanID, userID);
    if (!record) throw new PlanError("VALIDATION_ERROR", "Plan not found.", 404);
    return { job: null, plan: record.plan, diagnostics: record.diagnostics };
  }

  async readActive(userID) {
    const adoptions = await this.#adoptions(userID);
    const active = activeAdoption(adoptions, this.now());
    if (!active) throw new PlanError("VALIDATION_ERROR", "No active plan is available.", 404);
    return this.read(active.weekly_plan_id, userID);
  }

  async history(userID) {
    const [plans, adoptions] = await Promise.all([
      this.pool.query("SELECT id, supersedes_weekly_plan_id, created_at FROM weekly_plans WHERE user_id = $1 ORDER BY created_at DESC", [userID]),
      this.#adoptions(userID),
    ]);
    const active = activeAdoption(adoptions, this.now());
    const adoptedByPlan = new Map();
    for (const adoption of adoptions) {
      if (!adoptedByPlan.has(adoption.weekly_plan_id)) adoptedByPlan.set(adoption.weekly_plan_id, adoption);
    }
    return Promise.all(plans.rows.map(async (row) => {
      const record = await this.#loadPlan(row.id, userID);
      const adoption = adoptedByPlan.get(row.id);
      const scheduled = adoption && !adoption.superseded_at
        && dateValue(adoption.activates_on) > localDateKey(this.now(), adoption.time_zone_identifier);
      return {
        plan: record.plan,
        diagnostics: record.diagnostics,
        adoptedAt: adoption?.adopted_at ? new Date(adoption.adopted_at) : null,
        supersedesPlanID: row.supersedes_weekly_plan_id ?? null,
        lifecycleStatus: row.id === active?.weekly_plan_id ? "active" : scheduled ? "scheduled" : adoption ? "history" : "draft",
      };
    }));
  }

  async adopt(planID, userID, idempotencyKey) {
    if (!idempotencyKey) throw new PlanError("VALIDATION_ERROR", "An idempotency key is required.", 400);
    if (!isUUID(planID)) throw new PlanError("VALIDATION_ERROR", "Plan not found.", 404);
    const now = this.now();
    return withTransaction(this.pool, async (client) => {
      const existing = await client.query(
        `SELECT adoption.weekly_plan_id, adoption.adopted_at, adoption.activates_on,
                plan.time_zone_identifier
           FROM plan_adoptions adoption
           JOIN weekly_plans plan ON plan.id = adoption.weekly_plan_id
          WHERE adoption.user_id = $1 AND adoption.idempotency_key = $2`,
        [userID, idempotencyKey],
      );
      if (existing.rows[0]) return adoptionReceipt(existing.rows[0], now);
      const plan = await client.query(
        "SELECT id, week_start, time_zone_identifier FROM weekly_plans WHERE id = $1 AND user_id = $2",
        [planID, userID],
      );
      if (!plan.rows[0]) throw new PlanError("VALIDATION_ERROR", "Plan not found.", 404);
      const alreadyAdopted = await client.query(
        `SELECT adoption.weekly_plan_id, adoption.adopted_at, adoption.activates_on,
                adopted_plan.time_zone_identifier
          FROM plan_adoptions adoption
           JOIN weekly_plans adopted_plan ON adopted_plan.id = adoption.weekly_plan_id
          WHERE adoption.user_id = $1 AND adoption.weekly_plan_id = $2
            AND adoption.superseded_at IS NULL
          ORDER BY adoption.adopted_at DESC LIMIT 1`,
        [userID, planID],
      );
      if (alreadyAdopted.rows[0]) return adoptionReceipt(alreadyAdopted.rows[0], now);
      const priorAdoptions = await client.query(
        `SELECT adoption.weekly_plan_id, adoption.activates_on, adoption.adopted_at,
                adopted_plan.time_zone_identifier
           FROM plan_adoptions adoption
           JOIN weekly_plans adopted_plan ON adopted_plan.id = adoption.weekly_plan_id
          WHERE adoption.user_id = $1 AND adoption.superseded_at IS NULL
          ORDER BY adoption.activates_on DESC, adoption.adopted_at DESC`,
        [userID],
      );
      const today = localDateKey(now, plan.rows[0].time_zone_identifier);
      const hasActivePlan = Boolean(activeAdoption(priorAdoptions.rows, now));
      const activatesOn = hasActivePlan && dateValue(plan.rows[0].week_start) > today
        ? dateValue(plan.rows[0].week_start)
        : today;
      const inserted = await client.query(
        `INSERT INTO plan_adoptions (
            id, user_id, weekly_plan_id, adopted_at, activates_on, idempotency_key
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING weekly_plan_id, adopted_at, activates_on`,
        [randomUUID(), userID, planID, now, activatesOn, idempotencyKey],
      );
      return adoptionReceipt({ ...inserted.rows[0], time_zone_identifier: plan.rows[0].time_zone_identifier }, now);
    });
  }

  async ownsPlanItem(userID, planItemID) {
    if (!isUUID(planItemID)) return false;
    const result = await this.pool.query(
      `SELECT 1 FROM plan_items item
       JOIN weekly_plans plan ON plan.id = item.weekly_plan_id
       WHERE item.id = $1 AND plan.user_id = $2`,
      [planItemID, userID],
    );
    return Boolean(result.rows[0]);
  }

  async ownsPlan(userID, planID) {
    if (!isUUID(planID)) return false;
    const result = await this.pool.query("SELECT 1 FROM weekly_plans WHERE id = $1 AND user_id = $2", [planID, userID]);
    return Boolean(result.rows[0]);
  }

  async lockedItems(userID, planItemIDs) {
    if (!Array.isArray(planItemIDs) || planItemIDs.length === 0) return [];
    if (planItemIDs.some((id) => !isUUID(id))) {
      throw new PlanError("VALIDATION_ERROR", "One or more locked meals are not available for this account.", 400);
    }
    const result = await this.pool.query(
      `SELECT item.*
         FROM plan_items item
         JOIN weekly_plans plan ON plan.id = item.weekly_plan_id
        WHERE plan.user_id = $1 AND item.id = ANY($2::uuid[])`,
      [userID, planItemIDs],
    );
    if (result.rows.length !== new Set(planItemIDs).size) {
      throw new PlanError("VALIDATION_ERROR", "One or more locked meals are not available for this account.", 400);
    }
    return result.rows.map(mapPlanItem);
  }

  async #loadPlan(planID, userID) {
    const [planResult, itemResult] = await Promise.all([
      this.pool.query("SELECT * FROM weekly_plans WHERE id = $1 AND user_id = $2", [planID, userID]),
      this.pool.query(`SELECT item.* FROM plan_items item
        JOIN weekly_plans plan ON plan.id = item.weekly_plan_id
        WHERE item.weekly_plan_id = $1 AND plan.user_id = $2
        ORDER BY item.local_date,
          CASE item.slot WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'dinner' THEN 3 ELSE 4 END`, [planID, userID]),
    ]);
    const row = planResult.rows[0];
    if (!row) return null;
    const items = itemResult.rows.map(mapPlanItem);
    const daysByDate = new Map();
    for (const item of items) {
      const key = localDateObjectKey(item.localDate);
      const day = daysByDate.get(key) ?? { localDate: item.localDate, items: [] };
      day.items.push(item);
      daysByDate.set(key, day);
    }
    return {
      plan: {
        id: row.id,
        timeZoneIdentifier: row.time_zone_identifier,
        days: [...daysByDate.values()],
        targetSnapshot: row.target_snapshot_json,
        generatorVersion: row.generator_version,
        scoringVersion: row.scoring_version,
        ruleVersion: row.rule_version,
      },
      diagnostics: row.diagnostics_json,
      supersedesPlanID: row.supersedes_weekly_plan_id,
      createdAt: new Date(row.created_at),
    };
  }

  async #adoptions(userID) {
    const result = await this.pool.query(
      `SELECT adoption.weekly_plan_id, adoption.adopted_at, adoption.activates_on,
              adoption.superseded_at,
              plan.time_zone_identifier
         FROM plan_adoptions adoption
         JOIN weekly_plans plan ON plan.id = adoption.weekly_plan_id
        WHERE adoption.user_id = $1
        ORDER BY adoption.activates_on DESC, adoption.adopted_at DESC`,
      [userID],
    );
    return result.rows;
  }
}

function mapJob(row) {
  const failed = row.state === "rejected" || row.state === "failed";
  return {
    id: row.id,
    state: row.state,
    correlationID: row.correlation_id,
    planID: row.plan_id ?? null,
    error: failed ? {
      code: row.error_category ?? "TEMPORARY_FAILURE",
      userSafeMessage: userMessage(row.error_category),
      correlationID: row.correlation_id,
      retryable: Boolean(row.retryable),
    } : null,
    diagnostics: row.diagnostics_json ?? null,
    createdAt: new Date(row.created_at),
  };
}

function mapPlanItem(row) {
  return {
    id: row.id,
    localDate: localDateObject(row.local_date),
    slot: row.slot,
    recipeSnapshot: row.recipe_snapshot_json,
    servingMultiplier: Number(row.serving_multiplier),
    servingQuantityGrams: Number(row.serving_quantity_grams),
    nutrition: row.nutrition_snapshot_json,
    leftoverRelationship: row.leftover_relationship_json,
    lockedFromPlanItemID: row.locked_from_plan_item_id ?? null,
    completionState: "planned",
  };
}

function activeAdoption(rows, now) {
  return rows.find((row) => !row.superseded_at && dateValue(row.activates_on) <= localDateKey(now, row.time_zone_identifier));
}

function adoptionReceipt(row, now) {
  const scheduled = dateValue(row.activates_on) > localDateKey(now, row.time_zone_identifier);
  return { planID: row.weekly_plan_id, status: scheduled ? "scheduled" : "adopted", adoptedAt: new Date(row.adopted_at) };
}

function localDateObject(value) {
  const [year, month, day] = dateValue(value).split("-").map(Number);
  return { year, month, day };
}

function localDateObjectKey(value) {
  return typeof value === "string" ? value : `${value.year}-${value.month}-${value.day}`;
}

function dateValue(value) {
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

function requireDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) throw new PlanError("VALIDATION_ERROR", "Use a valid YYYY-MM-DD week start.", 400);
  return value;
}

function localDateKey(date, timeZoneIdentifier) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZoneIdentifier, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function userMessage(code) {
  if (code === "PROFILE_INELIGIBLE") return "Complete your planning profile first.";
  if (code === "CONTENT_INSUFFICIENT") return "There are not enough reviewed recipes for this profile yet.";
  if (code === "NO_FEASIBLE_PLAN") return "FamilyChef could not build a safe varied week with the current choices.";
  if (code === "VALIDATION_ERROR") return "Review the plan request and try again.";
  return "FamilyChef could not complete this plan yet.";
}
