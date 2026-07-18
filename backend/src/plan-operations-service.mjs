import { PlanError } from "./planner-service.mjs";
import { isUUID } from "./stable-identifiers.mjs";

const permittedStates = new Set(["queued", "generating", "succeeded", "rejected", "failed"]);

export class PlanOperationsService {
  constructor({ planService } = {}) {
    if (!planService?.store?.jobs || !planService?.store?.plans) throw new Error("A memory planner service is required.");
    this.planService = planService;
  }

  async list({ state = "all", search = "", limit = 100 } = {}) {
    validateState(state);
    const query = String(search).trim().toLowerCase();
    const runs = [...this.planService.store.jobs.values()]
      .map((job) => memoryRun(job, this.planService.store))
      .filter((run) => state === "all" || run.state === state)
      .filter((run) => !query || [run.id, run.userID, run.correlationID, run.error?.code]
        .some((value) => String(value ?? "").toLowerCase().includes(query)))
      .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
      .slice(0, boundedLimit(limit));
    return { runs, total: runs.length };
  }

  async detail(runID) {
    const job = this.planService.store.jobs.get(runID);
    if (!job) throw new PlanError("VALIDATION_ERROR", "Plan run not found.", 404);
    return memoryRun(job, this.planService.store);
  }
}

export class PostgresPlanOperationsService {
  constructor({ pool } = {}) {
    if (!pool?.query) throw new Error("A PostgreSQL pool is required.");
    this.pool = pool;
  }

  async list({ state = "all", search = "", limit = 100 } = {}) {
    validateState(state);
    const values = [];
    const where = [];
    if (state !== "all") {
      values.push(state);
      where.push(`plan.state = $${values.length}`);
    }
    const query = String(search).trim();
    if (query) {
      values.push(`%${query}%`);
      where.push(`(plan.id::text ILIKE $${values.length} OR plan.user_id::text ILIKE $${values.length}
        OR plan.correlation_id::text ILIKE $${values.length} OR COALESCE(plan.error_category, '') ILIKE $${values.length})`);
    }
    values.push(boundedLimit(limit));
    const result = await this.pool.query(`${basePlanRunQuery()}
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY plan.created_at DESC
      LIMIT $${values.length}`, values);
    return { runs: result.rows.map(mapPostgresRun), total: result.rows.length };
  }

  async detail(runID) {
    if (!isUUID(runID)) throw new PlanError("VALIDATION_ERROR", "Plan run not found.", 404);
    const result = await this.pool.query(`${basePlanRunQuery()} WHERE plan.id = $1`, [runID]);
    if (!result.rows[0]) throw new PlanError("VALIDATION_ERROR", "Plan run not found.", 404);
    return mapPostgresRun(result.rows[0]);
  }
}

function basePlanRunQuery() {
  return `SELECT plan.*, weekly.id AS plan_id,
                 background.id AS background_job_id, background.state AS background_state,
                 background.attempt_count, background.max_attempts, background.available_at,
                 background.locked_at, background.locked_until, background.worker_id,
                 background.last_error_code, background.last_error_message,
                 background.updated_at AS background_updated_at,
                 background.completed_at AS background_completed_at
            FROM plan_jobs plan
            LEFT JOIN weekly_plans weekly ON weekly.plan_job_id = plan.id
            LEFT JOIN background_jobs background
              ON background.job_type = 'plan.generate'
             AND background.payload_json->>'planJobID' = plan.id::text`;
}

function memoryRun(job, store) {
  const record = job.planID ? store.plans.get(job.planID) : null;
  const diagnostics = record?.diagnostics ?? job.diagnostics ?? null;
  const plan = record?.plan ?? null;
  return {
    id: job.id, userID: job.userID, state: job.state, planID: job.planID ?? null,
    correlationID: job.correlationID ?? null,
    request: {
      weekStart: plan?.days?.[0] ? localDate(plan.days[0].localDate) : null,
      timeZoneIdentifier: plan?.timeZoneIdentifier ?? null,
      trigger: diagnostics?.trigger ?? "unknown", regenerationReason: diagnostics?.regenerationReason ?? null,
      profileRevision: null, lockedPlanItemCount: diagnostics?.lockedPlanItemCount ?? 0,
    },
    versions: {
      generator: plan?.generatorVersion ?? diagnostics?.generatorVersion ?? null,
      scoring: plan?.scoringVersion ?? diagnostics?.scoringVersion ?? null,
      rules: plan?.ruleVersion ?? diagnostics?.ruleVersion ?? null,
    },
    deterministicSeedSHA256: null,
    diagnostics: curatedDiagnostics(diagnostics),
    error: job.error ? { code: job.error.code, message: job.error.userSafeMessage, retryable: Boolean(job.error.retryable) } : null,
    retry: null, createdAt: job.createdAt, startedAt: job.createdAt,
    completedAt: ["succeeded", "rejected", "failed"].includes(job.state) ? job.createdAt : null,
    durationMilliseconds: 0,
  };
}

function mapPostgresRun(row) {
  const request = row.request_json ?? {};
  const diagnostics = row.diagnostics_json ?? null;
  const failed = row.state === "rejected" || row.state === "failed";
  const startedAt = row.started_at ? new Date(row.started_at) : null;
  const completedAt = row.completed_at ? new Date(row.completed_at) : null;
  return {
    id: String(row.id), userID: String(row.user_id), state: row.state,
    planID: row.plan_id ? String(row.plan_id) : null, correlationID: String(row.correlation_id),
    request: {
      weekStart: dateValue(row.week_start), timeZoneIdentifier: row.time_zone_identifier,
      trigger: row.trigger, regenerationReason: row.regeneration_reason,
      profileRevision: Number(row.profile_revision),
      lockedPlanItemCount: Array.isArray(request.lockedPlanItemIDs) ? request.lockedPlanItemIDs.length : 0,
      includeOptionalSnack: request.includeOptionalSnack === true,
    },
    versions: { generator: row.generator_version, scoring: row.scoring_version, rules: row.rule_version },
    deterministicSeedSHA256: row.deterministic_seed_sha256,
    diagnostics: curatedDiagnostics(diagnostics),
    error: failed ? {
      code: row.error_category ?? "TEMPORARY_FAILURE",
      message: errorMessage(row.error_category), retryable: Boolean(row.retryable),
    } : null,
    retry: row.background_job_id ? {
      jobID: String(row.background_job_id), state: row.background_state,
      attemptCount: Number(row.attempt_count ?? 0), maxAttempts: Number(row.max_attempts ?? 0),
      availableAt: row.available_at, lockedAt: row.locked_at, lockedUntil: row.locked_until,
      workerID: row.worker_id, lastErrorCode: row.last_error_code,
      lastErrorMessage: row.last_error_message, updatedAt: row.background_updated_at,
      completedAt: row.background_completed_at,
    } : null,
    createdAt: new Date(row.created_at), startedAt, completedAt,
    durationMilliseconds: startedAt && completedAt ? Math.max(0, completedAt - startedAt) : null,
  };
}

function curatedDiagnostics(diagnostics) {
  if (!diagnostics) return null;
  return {
    candidatePoolSize: numberOrNull(diagnostics.candidatePoolSize),
    eligibleCandidateCountBySlot: objectNumbers(diagnostics.eligibleCandidateCountBySlot),
    rejectedCandidateCounts: objectNumbers(diagnostics.rejectedCandidateCounts),
    selectedRecipeCount: numberOrNull(diagnostics.selectedRecipeCount),
    meanAbsoluteDailyCalorieDeviation: numberOrNull(diagnostics.meanAbsoluteDailyCalorieDeviation),
    meanAbsoluteDailyProteinDeviation: numberOrNull(diagnostics.meanAbsoluteDailyProteinDeviation),
    totalCostPenalty: numberOrNull(diagnostics.totalCostPenalty),
    totalIngredientReusePenalty: numberOrNull(diagnostics.totalIngredientReusePenalty),
    ingredientReusePercentage: numberOrNull(diagnostics.ingredientReusePercentage),
    activeCookingMinutesByDay: objectNumbers(diagnostics.activeCookingMinutesByDay),
    cookingSessionCount: numberOrNull(diagnostics.cookingSessionCount),
    estimatedWasteGrams: numberOrNull(diagnostics.estimatedWasteGrams),
    estimatedWasteCoveragePercentage: numberOrNull(diagnostics.estimatedWasteCoveragePercentage),
    toleranceEvaluation: curatedToleranceEvaluation(diagnostics.toleranceEvaluation),
    mealTargetShares: objectNumbers(diagnostics.mealTargetShares),
    variety: diagnostics.variety ? {
      passed: Boolean(diagnostics.variety.passed),
      accidentalExactRepeats: numberOrNull(diagnostics.variety.accidentalExactRepeats),
      intentionalLeftovers: numberOrNull(diagnostics.variety.intentionalLeftovers),
      dominantIngredientViolations: numberOrNull(diagnostics.variety.dominantIngredientViolations),
      recentRecipeCount: numberOrNull(diagnostics.variety.recentRecipeCount),
    } : null,
    explanationCounts: countByCode(diagnostics.explanations),
  };
}

function curatedToleranceEvaluation(evaluation) {
  if (!evaluation || typeof evaluation !== "object") return null;
  return {
    contractVersion: String(evaluation.contractVersion ?? ""),
    dailyCalorieTolerancePercent: numberOrNull(evaluation.dailyCalorieTolerancePercent),
    weeklyCalorieTolerancePercent: numberOrNull(evaluation.weeklyCalorieTolerancePercent),
    optionalProteinTolerancePercent: numberOrNull(evaluation.optionalProteinTolerancePercent),
    dailyCaloriesWithinToleranceCount: numberOrNull(evaluation.dailyCaloriesWithinToleranceCount),
    weeklyCaloriesWithinTolerance: Boolean(evaluation.weeklyCaloriesWithinTolerance),
    optionalProteinOutsideToleranceDayCount: numberOrNull(evaluation.optionalProteinOutsideToleranceDayCount),
    dailyCalorieAbsoluteDeviationPercentages: Array.isArray(evaluation.dailyCalorieAbsoluteDeviationPercentages)
      ? evaluation.dailyCalorieAbsoluteDeviationPercentages.map(numberOrNull).filter((value) => value != null).slice(0, 7)
      : [],
    weeklyCalorieAbsoluteDeviationPercent: numberOrNull(evaluation.weeklyCalorieAbsoluteDeviationPercent),
    optionalProteinAbsoluteDeviationGrams: Array.isArray(evaluation.optionalProteinAbsoluteDeviationGrams)
      ? evaluation.optionalProteinAbsoluteDeviationGrams.map(numberOrNull).filter((value) => value != null).slice(0, 7)
      : [],
    dailyCalorieExcess: numberOrNull(evaluation.dailyCalorieExcess),
    weeklyCalorieExcess: numberOrNull(evaluation.weeklyCalorieExcess),
    optimizationPasses: numberOrNull(evaluation.optimizationPasses),
    relaxations: Array.isArray(evaluation.relaxations)
      ? evaluation.relaxations.filter((value) => typeof value === "string").slice(0, 3)
      : [],
  };
}

function validateState(state) {
  if (state !== "all" && !permittedStates.has(state)) throw new PlanError("VALIDATION_ERROR", "Plan-run state filter is invalid.", 400);
}

function boundedLimit(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(200, Math.max(1, parsed)) : 100;
}

function objectNumbers(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, count]) => [key, Number(count) || 0]));
}

function countByCode(explanations) {
  const counts = {};
  for (const explanation of explanations ?? []) counts[explanation.code] = (counts[explanation.code] ?? 0) + 1;
  return counts;
}

function numberOrNull(value) { return value != null && Number.isFinite(Number(value)) ? Number(value) : null; }
function localDate(value) { return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`; }
function dateValue(value) { return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10); }
function errorMessage(code) {
  return ({
    PROFILE_INELIGIBLE: "The stored profile could not support generation.",
    CONTENT_INSUFFICIENT: "The reviewed catalogue did not contain enough eligible recipes.",
    NO_FEASIBLE_PLAN: "No safe varied week could be assembled from the eligible candidates.",
    VALIDATION_ERROR: "The generation request failed validation.",
    TEMPORARY_FAILURE: "Generation stopped after an operational failure.",
  })[code] ?? "Plan generation did not complete.";
}
