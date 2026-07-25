import { randomUUID } from "node:crypto";

const permittedJobTypes = new Set([
  "plan.generate",
  "account.export",
  "account.delete",
  "entitlement.reconcile",
  "notification.plan-ready",
  "notification.operational",
  "recipe.generate",
]);

export class JobQueueError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "JobQueueError";
    this.code = code;
  }
}

export class MemoryJobQueue {
  constructor({ now = () => new Date() } = {}) {
    this.now = now;
    this.jobs = new Map();
    this.idempotency = new Map();
  }

  async enqueue(request) {
    validateEnqueue(request);
    const key = request.idempotencyKey ? `${request.type}:${request.idempotencyKey}` : null;
    const replayID = key ? this.idempotency.get(key) : null;
    if (replayID) return clone(this.jobs.get(replayID));
    const now = this.now();
    const job = {
      id: request.id ?? randomUUID(),
      type: request.type,
      userID: request.userID ?? null,
      idempotencyKey: request.idempotencyKey ?? null,
      state: "queued",
      payload: clone(request.payload),
      result: null,
      attemptCount: 0,
      maxAttempts: request.maxAttempts ?? 8,
      availableAt: request.availableAt ?? now,
      lockedAt: null,
      lockedUntil: null,
      workerID: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    this.jobs.set(job.id, job);
    if (key) this.idempotency.set(key, job.id);
    return clone(job);
  }

  async claim({ workerID, leaseMilliseconds = 5 * 60_000, types = null } = {}) {
    if (!workerID) throw new JobQueueError("VALIDATION_ERROR", "A worker ID is required.");
    const now = this.now();
    const job = [...this.jobs.values()]
      .filter((candidate) => (
        (!types || types.includes(candidate.type)) && (
          (candidate.state === "queued" && candidate.availableAt <= now)
          || (candidate.state === "running" && candidate.lockedUntil <= now)
        )
      ))
      .sort((left, right) => left.availableAt - right.availableAt || left.createdAt - right.createdAt)[0];
    if (!job) return null;
    job.state = "running";
    job.attemptCount += 1;
    job.lockedAt = now;
    job.lockedUntil = new Date(now.getTime() + leaseMilliseconds);
    job.workerID = workerID;
    job.updatedAt = now;
    return clone(job);
  }

  async extendLease(jobID, workerID, leaseMilliseconds = 5 * 60_000) {
    const job = this.#ownedRunningJob(jobID, workerID);
    const now = this.now();
    job.lockedUntil = new Date(now.getTime() + leaseMilliseconds);
    job.updatedAt = now;
    return clone(job);
  }

  async complete(jobID, workerID, result = null) {
    const job = this.#ownedRunningJob(jobID, workerID);
    const now = this.now();
    Object.assign(job, {
      state: "succeeded",
      result: clone(result),
      lockedAt: null,
      lockedUntil: null,
      workerID: null,
      updatedAt: now,
      completedAt: now,
    });
    return clone(job);
  }

  async fail(jobID, workerID, error, { baseDelayMilliseconds = 30_000, maximumDelayMilliseconds = 6 * 60 * 60_000 } = {}) {
    const job = this.#ownedRunningJob(jobID, workerID);
    const now = this.now();
    const exhausted = job.attemptCount >= job.maxAttempts;
    const delay = Math.min(baseDelayMilliseconds * (2 ** Math.max(0, job.attemptCount - 1)), maximumDelayMilliseconds);
    Object.assign(job, {
      state: exhausted ? "dead" : "queued",
      availableAt: exhausted ? job.availableAt : new Date(now.getTime() + delay),
      lockedAt: null,
      lockedUntil: null,
      workerID: null,
      lastErrorCode: error?.code ?? "TEMPORARY_FAILURE",
      lastErrorMessage: String(error?.message ?? "Job failed").slice(0, 1_000),
      updatedAt: now,
      completedAt: exhausted ? now : null,
    });
    return clone(job);
  }

  async read(jobID) {
    const job = this.jobs.get(jobID);
    return job ? clone(job) : null;
  }

  #ownedRunningJob(jobID, workerID) {
    const job = this.jobs.get(jobID);
    if (!job || job.state !== "running" || job.workerID !== workerID) {
      throw new JobQueueError("LEASE_LOST", "The job lease is no longer owned by this worker.");
    }
    return job;
  }
}

export class PostgresJobQueue {
  constructor({ pool, now = () => new Date() }) {
    if (!pool?.query) throw new JobQueueError("CONFIGURATION_ERROR", "A PostgreSQL pool is required.");
    this.pool = pool;
    this.now = now;
  }

  async enqueue(request) {
    validateEnqueue(request);
    const now = this.now();
    const result = await this.pool.query(
      `INSERT INTO background_jobs (
          id, job_type, user_id, idempotency_key, state, payload_json,
          max_attempts, available_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'queued', $5::jsonb, $6, $7, $8, $8)
       ON CONFLICT (job_type, idempotency_key) DO UPDATE
          SET idempotency_key = EXCLUDED.idempotency_key
       RETURNING *`,
      [
        request.id ?? randomUUID(), request.type, request.userID ?? null,
        request.idempotencyKey ?? null, JSON.stringify(request.payload),
        request.maxAttempts ?? 8, request.availableAt ?? now, now,
      ],
    );
    return rowToJob(result.rows[0]);
  }

  async claim({ workerID, leaseMilliseconds = 5 * 60_000, types = null } = {}) {
    if (!workerID) throw new JobQueueError("VALIDATION_ERROR", "A worker ID is required.");
    const now = this.now();
    const lockedUntil = new Date(now.getTime() + leaseMilliseconds);
    const result = await this.pool.query(
      `WITH candidate AS (
         SELECT id
           FROM background_jobs
          WHERE (($4::text[] IS NULL) OR job_type = ANY($4::text[]))
            AND ((state = 'queued' AND available_at <= $1)
             OR (state = 'running' AND locked_until <= $1))
          ORDER BY available_at, created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       UPDATE background_jobs AS job
          SET state = 'running', attempt_count = attempt_count + 1,
              locked_at = $1, locked_until = $2, worker_id = $3, updated_at = $1
         FROM candidate
        WHERE job.id = candidate.id
       RETURNING job.*`,
      [now, lockedUntil, workerID, types],
    );
    return result.rows[0] ? rowToJob(result.rows[0]) : null;
  }

  async extendLease(jobID, workerID, leaseMilliseconds = 5 * 60_000) {
    const now = this.now();
    return this.#ownedUpdate(
      `UPDATE background_jobs
          SET locked_until = $3, updated_at = $4
        WHERE id = $1 AND worker_id = $2 AND state = 'running'
      RETURNING *`,
      [jobID, workerID, new Date(now.getTime() + leaseMilliseconds), now],
    );
  }

  async complete(jobID, workerID, result = null) {
    const now = this.now();
    return this.#ownedUpdate(
      `UPDATE background_jobs
          SET state = 'succeeded', result_json = $3::jsonb,
              locked_at = NULL, locked_until = NULL, worker_id = NULL,
              updated_at = $4, completed_at = $4
        WHERE id = $1 AND worker_id = $2 AND state = 'running'
      RETURNING *`,
      [jobID, workerID, JSON.stringify(result), now],
    );
  }

  async fail(jobID, workerID, error, { baseDelayMilliseconds = 30_000, maximumDelayMilliseconds = 6 * 60 * 60_000 } = {}) {
    const now = this.now();
    const result = await this.pool.query(
      `UPDATE background_jobs
          SET state = CASE WHEN attempt_count >= max_attempts THEN 'dead' ELSE 'queued' END,
              available_at = CASE
                WHEN attempt_count >= max_attempts THEN available_at
                ELSE $5 + LEAST($6 * POWER(2, GREATEST(attempt_count - 1, 0)), $7) * INTERVAL '1 millisecond'
              END,
              locked_at = NULL, locked_until = NULL, worker_id = NULL,
              last_error_code = $3, last_error_message = $4,
              updated_at = $5,
              completed_at = CASE WHEN attempt_count >= max_attempts THEN $5 ELSE NULL END
        WHERE id = $1 AND worker_id = $2 AND state = 'running'
      RETURNING *`,
      [
        jobID, workerID, error?.code ?? "TEMPORARY_FAILURE",
        String(error?.message ?? "Job failed").slice(0, 1_000), now,
        baseDelayMilliseconds, maximumDelayMilliseconds,
      ],
    );
    if (!result.rows[0]) throw new JobQueueError("LEASE_LOST", "The job lease is no longer owned by this worker.");
    return rowToJob(result.rows[0]);
  }

  async read(jobID) {
    const result = await this.pool.query("SELECT * FROM background_jobs WHERE id = $1", [jobID]);
    return result.rows[0] ? rowToJob(result.rows[0]) : null;
  }

  async #ownedUpdate(text, values) {
    const result = await this.pool.query(text, values);
    if (!result.rows[0]) throw new JobQueueError("LEASE_LOST", "The job lease is no longer owned by this worker.");
    return rowToJob(result.rows[0]);
  }
}

export class LeasedJobWorker {
  constructor({ queue, workerID, handlers = {}, telemetry = null, now = () => new Date() }) {
    this.queue = queue;
    this.workerID = workerID;
    this.handlers = new Map(Object.entries(handlers));
    this.telemetry = telemetry;
    this.now = now;
  }

  async runOnce() {
    const job = await this.queue.claim({ workerID: this.workerID, types: [...this.handlers.keys()] });
    if (!job) return null;
    const startedAt = this.now();
    const handler = this.handlers.get(job.type);
    if (!handler) {
      const failed = await this.queue.fail(job.id, this.workerID, new JobQueueError("HANDLER_MISSING", `No handler is registered for ${job.type}.`));
      recordJobTelemetry(this.telemetry, job, failed, startedAt, this.now());
      return failed;
    }
    try {
      const result = await handler(job, {
        extendLease: (milliseconds) => this.queue.extendLease(job.id, this.workerID, milliseconds),
      });
      const completed = await this.queue.complete(job.id, this.workerID, result ?? null);
      recordJobTelemetry(this.telemetry, job, completed, startedAt, this.now());
      return completed;
    } catch (error) {
      const failed = await this.queue.fail(job.id, this.workerID, error);
      recordJobTelemetry(this.telemetry, job, failed, startedAt, this.now());
      return failed;
    }
  }
}

function recordJobTelemetry(telemetry, claimed, outcome, startedAt, completedAt) {
  try {
    telemetry?.recordJobRun?.({
      jobID: claimed.id,
      jobType: claimed.type,
      state: outcome.state,
      attemptCount: outcome.attemptCount,
      queueDelayMilliseconds: Math.max(0, startedAt.getTime() - claimed.createdAt.getTime()),
      durationMilliseconds: Math.max(0, completedAt.getTime() - startedAt.getTime()),
      correlationID: claimed.payload?.correlationID ?? null,
      errorCode: outcome.lastErrorCode ?? null,
    });
  } catch {
    // Telemetry must never change job acknowledgement or retry behavior.
  }
}

function validateEnqueue(request) {
  if (!permittedJobTypes.has(request?.type) || request.payload == null) {
    throw new JobQueueError("VALIDATION_ERROR", "The background job is incomplete.");
  }
  if (!Number.isInteger(request.maxAttempts ?? 8) || (request.maxAttempts ?? 8) < 1) {
    throw new JobQueueError("VALIDATION_ERROR", "The background job retry limit is invalid.");
  }
}

function rowToJob(row) {
  return {
    id: row.id,
    type: row.job_type,
    userID: row.user_id,
    idempotencyKey: row.idempotency_key,
    state: row.state,
    payload: row.payload_json,
    result: row.result_json,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    availableAt: new Date(row.available_at),
    lockedAt: row.locked_at ? new Date(row.locked_at) : null,
    lockedUntil: row.locked_until ? new Date(row.locked_until) : null,
    workerID: row.worker_id,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
  };
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}
