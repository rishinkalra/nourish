import { withTransaction } from "./database.mjs";
import { PlanError, generatePlan } from "./planner-service.mjs";
import { deriveWeeklyLoop } from "./weekly-loop-service.mjs";
import { deterministicUUID } from "./stable-identifiers.mjs";

export function createPlanJobHandler({
  pool, catalogueReader, planService, analyticsEventService = null,
  scoringConfiguration, now = () => new Date(),
}) {
  if (!pool?.query || !pool?.connect) throw new Error("A PostgreSQL pool is required.");
  if (!catalogueReader?.publishedSnapshots) throw new Error("A PostgreSQL catalogue reader is required.");
  if (!planService?.lockedItems) throw new Error("A PostgreSQL planner service is required.");

  return async (backgroundJob) => {
    const planJobID = backgroundJob.payload.planJobID;
    const selected = await pool.query(
      `SELECT job.*, plan.id AS plan_id
         FROM plan_jobs job
         LEFT JOIN weekly_plans plan ON plan.plan_job_id = job.id
        WHERE job.id = $1 AND job.user_id = $2`,
      [planJobID, backgroundJob.userID],
    );
    const job = selected.rows[0];
    if (!job) throw jobError("PLAN_JOB_UNAVAILABLE", "The plan job is no longer available.");
    if (job.state === "succeeded" || job.state === "rejected") return completedResult(job);

    const startedAt = now();
    await pool.query(
      `UPDATE plan_jobs
          SET state = 'generating', started_at = COALESCE(started_at, $2)
        WHERE id = $1 AND state IN ('queued', 'generating')`,
      [planJobID, startedAt],
    );
    const request = job.request_json ?? {};
    const profile = request.profileSnapshot;
    if (!profile) {
      const error = new PlanError("PROFILE_INELIGIBLE", "Complete your planning profile first.");
      const result = await rejectPlan(pool, job, error, now());
      await recordPlanFailure(analyticsEventService, job, error);
      return result;
    }

    try {
      const [recipes, lockedItems] = await Promise.all([
        catalogueReader.publishedSnapshots(),
        planService.lockedItems(job.user_id, request.lockedPlanItemIDs ?? []),
      ]);
      const generated = generatePlan({ profile, recipes, request, userID: job.user_id, lockedItems, scoringConfiguration });
      const materialized = materializeIdentifiers(generated, job, lockedItems);
      const completedAt = now();
      const result = await persistPlan({ pool, job, generated: materialized, now: completedAt });
      await recordPlanSuccess(analyticsEventService, job, materialized, startedAt, completedAt);
      return result;
    } catch (error) {
      if (error instanceof PlanError) {
        const result = await rejectPlan(pool, job, error, now());
        await recordPlanFailure(analyticsEventService, job, error);
        return result;
      }
      if (backgroundJob.attemptCount >= backgroundJob.maxAttempts) {
        await pool.query(
          `UPDATE plan_jobs
              SET state = 'failed', error_category = 'TEMPORARY_FAILURE',
                  retryable = false, completed_at = $2
            WHERE id = $1 AND state <> 'succeeded'`,
          [job.id, now()],
        );
        await recordPlanFailure(analyticsEventService, job, {
          code: "TEMPORARY_FAILURE",
          retryable: false,
          diagnostics: job.diagnostics_json ?? null,
        });
      }
      throw error;
    }
  };
}

async function recordPlanSuccess(service, job, generated, startedAt, completedAt) {
  await bestEffortAnalytics(service, {
    userID: job.user_id,
    eventName: "plan_generation_succeeded",
    dedupeKey: `plan-succeeded:${job.id}`,
    properties: {
      latency_ms: boundedInteger(completedAt.getTime() - startedAt.getTime(), 0, 3_600_000),
      calorie_deviation: boundedNumber(generated.diagnostics.meanAbsoluteDailyCalorieDeviation, -2_000, 2_000),
      recipe_count: boundedInteger(generated.plan.days.flatMap((day) => day.items).length, 1, 100),
    },
  });
}

async function recordPlanFailure(service, job, error) {
  await bestEffortAnalytics(service, {
    userID: job.user_id,
    eventName: "plan_generation_failed",
    dedupeKey: `plan-failed:${job.id}`,
    properties: {
      error_code: analyticsToken(error.code, "TEMPORARY_FAILURE"),
      retryable: Boolean(error.retryable),
      candidate_pool_size: boundedInteger(error.diagnostics?.candidatePoolSize, 0, 100_000),
    },
  });
}

async function bestEffortAnalytics(service, event) {
  if (!service?.recordServerEvent) return;
  try {
    await service.recordServerEvent(event);
  } catch {
    // The durable product job remains authoritative when optional measurement is unavailable.
  }
}

function analyticsToken(value, fallback) {
  const token = String(value ?? "").replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 80);
  return token || fallback;
}

function boundedInteger(value, minimum, maximum) {
  return Math.round(boundedNumber(value, minimum, maximum));
}

function boundedNumber(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.min(maximum, Math.max(minimum, number));
}

async function persistPlan({ pool, job, generated, now }) {
  return withTransaction(pool, async (client) => {
    const locked = await client.query("SELECT state FROM plan_jobs WHERE id = $1 FOR UPDATE", [job.id]);
    if (locked.rows[0]?.state === "succeeded") return completedResult({ ...job, state: "succeeded" });
    const superseded = job.trigger === "manual_regeneration" ? await client.query(
      `SELECT plan.id
         FROM weekly_plans plan
         LEFT JOIN plan_adoptions adoption ON adoption.weekly_plan_id = plan.id
        WHERE plan.user_id = $1 AND plan.week_start = $2
        ORDER BY adoption.adopted_at DESC NULLS LAST, plan.created_at DESC
        LIMIT 1`,
      [job.user_id, dateValue(job.week_start)],
    ) : { rows: [] };
    const plan = generated.plan;
    await client.query(
      `INSERT INTO weekly_plans (
          id, user_id, plan_job_id, week_start, week_end,
          time_zone_identifier, profile_revision, target_snapshot_json,
          generator_version, scoring_version, rule_version, diagnostics_json,
          supersedes_weekly_plan_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11,
                 $12::jsonb, $13, $14)
       ON CONFLICT (plan_job_id) DO NOTHING`,
      [
        plan.id, job.user_id, job.id, dateValue(job.week_start), addDays(dateValue(job.week_start), 6),
        plan.timeZoneIdentifier, job.profile_revision, JSON.stringify(plan.targetSnapshot),
        plan.generatorVersion, plan.scoringVersion, plan.ruleVersion,
        JSON.stringify(generated.diagnostics), superseded.rows[0]?.id ?? null, now,
      ],
    );
    for (const day of plan.days) {
      for (const item of day.items) {
        if (!item.recipeSnapshot.recipeVersionID) {
          throw new PlanError("CONTENT_INSUFFICIENT", "A reviewed recipe snapshot is missing its immutable version identifier.");
        }
        await client.query(
          `INSERT INTO plan_items (
              id, weekly_plan_id, local_date, slot, recipe_id, recipe_version_id,
              recipe_snapshot_json, serving_multiplier, serving_quantity_grams,
              nutrition_snapshot_json, leftover_relationship_json,
              locked_from_plan_item_id, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb,
                     $11::jsonb, $12, $13)
           ON CONFLICT (id) DO NOTHING`,
          [
            item.id, plan.id, localDateKey(item.localDate), item.slot,
            item.recipeSnapshot.recipeID, item.recipeSnapshot.recipeVersionID,
            JSON.stringify(item.recipeSnapshot), item.servingMultiplier,
            item.servingQuantityGrams, JSON.stringify(item.nutrition),
            JSON.stringify(item.leftoverRelationship), item.lockedFromPlanItemID ?? null, now,
          ],
        );
      }
    }
    await persistWeeklyLoop(client, plan, now);
    await client.query(
      `UPDATE plan_jobs
          SET state = 'succeeded', candidate_pool_size = $2,
              diagnostics_json = $3::jsonb, error_category = NULL,
              retryable = false, completed_at = $4
        WHERE id = $1`,
      [job.id, generated.diagnostics.candidatePoolSize, JSON.stringify(generated.diagnostics), now],
    );
    const notificationJobID = deterministicUUID(`plan-ready-notification|${job.id}`);
    await client.query(
      `INSERT INTO background_jobs (
          id, job_type, user_id, idempotency_key, state, payload_json,
          max_attempts, available_at, created_at, updated_at
       ) VALUES ($1, 'notification.plan-ready', $2, $3, 'queued', $4::jsonb,
                 5, $5, $5, $5)
       ON CONFLICT (job_type, idempotency_key) DO NOTHING`,
      [
        notificationJobID, job.user_id, `plan-ready:${job.id}`,
        JSON.stringify({ planJobID: job.id }), now,
      ],
    );
    return { planJobID: job.id, planID: plan.id, state: "succeeded" };
  });
}

async function persistWeeklyLoop(client, plan, now) {
  const derived = deriveWeeklyLoop(plan);
  const groceryListID = deterministicUUID(`grocery-list|${plan.id}`);
  await client.query(
    `INSERT INTO grocery_lists (id, user_id, weekly_plan_id, revision, created_at, updated_at)
     SELECT $1, user_id, id, 1, $2, $2 FROM weekly_plans WHERE id = $3
     ON CONFLICT (weekly_plan_id) DO NOTHING`,
    [groceryListID, now, plan.id],
  );
  for (const item of derived.groceryList.items) {
    await client.query(
      `INSERT INTO grocery_items (
          id, grocery_list_id, ingredient_id, display_name_snapshot,
          category_snapshot, required_grams, household_quantities_json,
          user_adjusted_grams, disposition, changed_by_swap, newly_added_by_swap
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NULL, 'needed', false, false)
       ON CONFLICT (grocery_list_id, ingredient_id) DO NOTHING`,
      [
        deterministicUUID(`grocery-item|${plan.id}|${item.ingredientID}`), groceryListID,
        item.ingredientID, item.displayName, item.category, item.requiredGrams,
        JSON.stringify(item.householdQuantities),
      ],
    );
  }
  for (const task of derived.prepTimeline.tasks) {
    await client.query(
      `INSERT INTO prep_tasks (
          id, weekly_plan_id, local_date, title, active_minutes, storage_note,
          reuse_note, source_plan_item_ids, is_complete, revision, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid[], false, 1, $9)
       ON CONFLICT (id) DO NOTHING`,
      [
        deterministicUUID(`prep-task|${task.id}`), plan.id, localDateKey(task.localDate),
        task.title, task.activeMinutes, task.storageNote, task.reuseNote,
        task.sourcePlanItemIDs, now,
      ],
    );
  }
}

async function rejectPlan(pool, job, error, completedAt) {
  await pool.query(
    `UPDATE plan_jobs
        SET state = 'rejected', candidate_pool_size = $2,
            diagnostics_json = $3::jsonb, error_category = $4,
            retryable = $5, completed_at = $6
      WHERE id = $1 AND state <> 'succeeded'`,
    [
      job.id, error.diagnostics?.candidatePoolSize ?? null,
      JSON.stringify(error.diagnostics ?? null), error.code,
      Boolean(error.retryable), completedAt,
    ],
  );
  return { planJobID: job.id, planID: null, state: "rejected", errorCategory: error.code };
}

function materializeIdentifiers(generated, job, lockedItems) {
  const result = structuredClone(generated);
  const planID = deterministicUUID(`weekly-plan|${job.id}`);
  const items = result.plan.days.flatMap((day) => day.items);
  const lockedIDs = new Set(lockedItems.map((item) => item.id));
  const idMap = new Map(items.map((item) => [item.id, deterministicUUID(`plan-item|${planID}|${localDateKey(item.localDate)}|${item.slot}`)]));
  result.plan.id = planID;
  for (const item of items) {
    const priorID = item.id;
    item.id = idMap.get(priorID);
    item.lockedFromPlanItemID = lockedIDs.has(priorID) ? priorID : null;
    const reuse = item.leftoverRelationship?.plannedReuse;
    if (reuse && idMap.has(reuse.sourcePlanItemID)) reuse.sourcePlanItemID = idMap.get(reuse.sourcePlanItemID);
  }
  for (const explanation of result.diagnostics.explanations ?? []) {
    if (idMap.has(explanation.planItemID)) explanation.planItemID = idMap.get(explanation.planItemID);
  }
  return result;
}

function completedResult(job) {
  return { planJobID: job.id, planID: job.plan_id ?? null, state: job.state };
}

function localDateKey(value) {
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

function dateValue(value) {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function addDays(value, count) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function jobError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
