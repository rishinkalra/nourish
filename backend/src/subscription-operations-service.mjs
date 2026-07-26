import { createHash, randomUUID } from "node:crypto";
import { AccountError } from "./account-service.mjs";
import { withTransaction } from "./database.mjs";
import { MemoryJobQueue } from "./job-queue.mjs";
import { isUUID } from "./stable-identifiers.mjs";

const accessStates = new Set(["active", "trial", "graceOrBillingRetry", "upgraded", "downgraded"]);
const permittedStatuses = new Set(["current", "pending", "delayed", "mismatch"]);
const retryableStatuses = new Set(["delayed", "mismatch"]);

export class SubscriptionOperationsService {
  constructor({ accountService, jobQueue = new MemoryJobQueue(), now = () => new Date() } = {}) {
    if (!accountService?.store?.entitlementsByUserID) throw new Error("A memory account service is required.");
    this.accountService = accountService;
    this.jobQueue = jobQueue;
    this.now = now;
    this.actions = [];
  }

  async list({ status = "all", search = "", limit = 100 } = {}) {
    validateStatus(status);
    const query = String(search).trim().toLowerCase();
    const subscriptions = [...this.accountService.store.entitlementsByUserID.values()]
      .map((entitlement) => memorySubscription(entitlement, this.jobQueue))
      .filter((item) => statusMatches(item.reconciliation.status, status))
      .filter((item) => !query || [item.userID, item.productID, item.environment, item.reconciliation.errorCode]
        .some((value) => String(value ?? "").toLowerCase().includes(query)))
      .sort((left, right) => new Date(right.updatedAt ?? 0) - new Date(left.updatedAt ?? 0))
      .slice(0, boundedLimit(limit));
    return { subscriptions, total: subscriptions.length };
  }

  async detail(userID) {
    const entitlement = await this.accountService.store.readEntitlement(userID);
    if (!entitlement) throw notFound();
    const summary = memorySubscription(entitlement, this.jobQueue);
    const notifications = [...this.accountService.store.notificationInbox.values()]
      .filter((row) => row.userID === userID || row.event?.originalTransactionID === entitlement.originalTransactionID)
      .map((row) => notificationTimeline(row));
    const jobs = memoryJobs(this.jobQueue, userID).map(jobTimeline);
    const actions = this.actions.filter((action) => action.userID === userID).map(actionTimeline);
    const verified = entitlement.lastVerifiedAt ? [{
      id: `verified:${entitlement.sourceEventID ?? userID}`,
      kind: "server_entitlement", source: "FamilyChef", at: entitlement.lastVerifiedAt,
      title: "Verified entitlement applied", outcome: "succeeded",
      detail: `${titleCase(entitlement.state)} · ${entitlement.hasAccess ? "access retained" : "no access"}`,
      reference: safeReference(entitlement.sourceEventID),
    }] : [];
    return { ...summary, timeline: sortTimeline([...notifications, ...jobs, ...actions, ...verified]) };
  }

  async retry(userID, { reason, actor, correlationID } = {}) {
    validateResolution(reason, actor, correlationID);
    const entitlement = await this.accountService.store.readEntitlement(userID);
    if (!entitlement) throw notFound();
    if (!retryableStatuses.has(entitlement.reconciliationStatus)) throw notRetryable();
    const now = this.now();
    await this.accountService.store.markReconciliationDue(userID, now);
    const job = await this.jobQueue.enqueue({
      type: "entitlement.reconcile", userID,
      idempotencyKey: `operator:${userID}:${correlationID}`,
      payload: { userID }, availableAt: now, maxAttempts: 8,
    });
    this.actions.push({
      id: randomUUID(), userID, action: "retry_verified_check", reason: reason.trim(),
      actorID: actor.id, correlationID, beforeStatus: entitlement.reconciliationStatus,
      afterStatus: "pending", backgroundJobID: job.id, occurredAt: now,
    });
    return this.detail(userID);
  }
}

export class PostgresSubscriptionOperationsService {
  constructor({ pool, now = () => new Date() } = {}) {
    if (!pool?.query || !pool?.connect) throw new Error("A PostgreSQL pool is required.");
    this.pool = pool;
    this.now = now;
  }

  async list({ status = "all", search = "", limit = 100 } = {}) {
    validateStatus(status);
    const values = [];
    const where = [];
    if (status === "attention") where.push("subscription.reconciliation_status IN ('delayed', 'mismatch')");
    else if (status !== "all") {
      values.push(status);
      where.push(`subscription.reconciliation_status = $${values.length}`);
    }
    const query = String(search).trim();
    if (query) {
      values.push(`%${query}%`);
      where.push(`(subscription.user_id::text ILIKE $${values.length}
        OR COALESCE(subscription.product_id, '') ILIKE $${values.length}
        OR COALESCE(subscription.original_transaction_id, '') ILIKE $${values.length}
        OR COALESCE(subscription.source_event_id, '') ILIKE $${values.length}
        OR COALESCE(subscription.last_reconciliation_error_code, '') ILIKE $${values.length})`);
    }
    values.push(boundedLimit(limit));
    const result = await this.pool.query(`${baseSubscriptionQuery()}
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY subscription.updated_at DESC, subscription.user_id
      LIMIT $${values.length}`, values);
    return { subscriptions: result.rows.map(mapPostgresSubscription), total: result.rows.length };
  }

  async detail(userID) {
    if (!isUUID(userID)) throw notFound();
    const subscriptionResult = await this.pool.query(`${baseSubscriptionQuery()} WHERE subscription.user_id = $1`, [userID]);
    if (!subscriptionResult.rows[0]) throw notFound();
    const [events, notifications, jobs, actions] = await Promise.all([
      this.pool.query(
        `SELECT app_store_event_id, notification_type, environment, verified_at,
                processing_state, processed_at, failure_code, transaction_id,
                original_transaction_id, signed_payload_sha256
           FROM app_store_events WHERE user_id = $1
          ORDER BY verified_at DESC LIMIT 100`, [userID],
      ),
      this.pool.query(
        `SELECT app_store_event_id, notification_type, environment, received_at,
                processing_state, processed_at, failure_code, transaction_id,
                original_transaction_id, signed_payload_sha256
           FROM app_store_notification_inbox WHERE user_id = $1
          ORDER BY received_at DESC LIMIT 100`, [userID],
      ),
      this.pool.query(
        `SELECT id, state, attempt_count, max_attempts, available_at, locked_at,
                locked_until, worker_id, last_error_code, last_error_message,
                created_at, updated_at, completed_at
           FROM background_jobs
          WHERE job_type = 'entitlement.reconcile' AND user_id = $1
          ORDER BY created_at DESC LIMIT 100`, [userID],
      ),
      this.pool.query(
        `SELECT id, action, reason, actor_id, correlation_id, before_status,
                after_status, background_job_id, occurred_at
           FROM subscription_operation_events WHERE user_id = $1
          ORDER BY occurred_at DESC LIMIT 100`, [userID],
      ),
    ]);
    return {
      ...mapPostgresSubscription(subscriptionResult.rows[0]),
      timeline: sortTimeline([
        ...events.rows.map(appStoreEventTimeline),
        ...notifications.rows.map(postgresNotificationTimeline),
        ...jobs.rows.map(postgresJobTimeline),
        ...actions.rows.map(postgresActionTimeline),
      ]),
    };
  }

  async retry(userID, { reason, actor, correlationID } = {}) {
    if (!isUUID(userID)) throw notFound();
    validateResolution(reason, actor, correlationID);
    const now = this.now();
    await withTransaction(this.pool, async (client) => {
      const current = await client.query(
        "SELECT reconciliation_status FROM subscriptions WHERE user_id = $1 FOR UPDATE", [userID],
      );
      if (!current.rows[0]) throw notFound();
      if (!retryableStatuses.has(current.rows[0].reconciliation_status)) throw notRetryable();
      const jobID = randomUUID();
      await client.query(
        `UPDATE subscriptions SET reconciliation_status = 'pending',
             next_reconciliation_at = $2, updated_at = $2 WHERE user_id = $1`,
        [userID, now],
      );
      await client.query(
        `INSERT INTO background_jobs (
            id, job_type, user_id, idempotency_key, state, payload_json,
            max_attempts, available_at, created_at, updated_at
         ) VALUES ($1, 'entitlement.reconcile', $2, $3, 'queued', $4::jsonb, 8, $5, $5, $5)
         ON CONFLICT (job_type, idempotency_key) DO NOTHING`,
        [
          jobID,
          userID,
          `operator:${userID}:${correlationID}`,
          JSON.stringify({ userID, correlationID }),
          now,
        ],
      );
      await client.query(
        `INSERT INTO subscription_operation_events (
            id, user_id, action, reason, actor_id, correlation_id,
            before_status, after_status, background_job_id, occurred_at
         ) VALUES ($1, $2, 'retry_verified_check', $3, $4, $5, $6, 'pending', $7, $8)`,
        [randomUUID(), userID, reason.trim(), actor.id, correlationID,
          current.rows[0].reconciliation_status, jobID, now],
      );
    });
    return this.detail(userID);
  }
}

function baseSubscriptionQuery() {
  return `SELECT subscription.*,
                 latest_job.id AS latest_job_id, latest_job.state AS latest_job_state,
                 latest_job.attempt_count AS latest_job_attempt_count,
                 latest_job.max_attempts AS latest_job_max_attempts,
                 latest_job.available_at AS latest_job_available_at,
                 latest_job.locked_at AS latest_job_locked_at,
                 latest_job.locked_until AS latest_job_locked_until,
                 latest_job.worker_id AS latest_job_worker_id,
                 latest_job.last_error_code AS latest_job_error_code,
                 latest_job.last_error_message AS latest_job_error_message,
                 latest_job.created_at AS latest_job_created_at,
                 latest_job.updated_at AS latest_job_updated_at,
                 latest_job.completed_at AS latest_job_completed_at
            FROM subscriptions subscription
            LEFT JOIN LATERAL (
              SELECT job.id, job.state, job.attempt_count, job.max_attempts,
                     job.available_at, job.locked_at, job.locked_until, job.worker_id,
                     job.last_error_code, job.last_error_message, job.created_at,
                     job.updated_at, job.completed_at
                FROM background_jobs job
               WHERE job.job_type = 'entitlement.reconcile'
                 AND job.user_id = subscription.user_id
               ORDER BY job.created_at DESC LIMIT 1
            ) latest_job ON true`;
}

function memorySubscription(entitlement, jobQueue) {
  const jobs = memoryJobs(jobQueue, entitlement.userID);
  const latestJob = jobs.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))[0] ?? null;
  return {
    userID: entitlement.userID, state: entitlement.state,
    hasAccess: entitlement.hasAccess ?? accessStates.has(entitlement.state),
    productID: entitlement.productID ?? null, environment: entitlement.environment ?? "unknown",
    periodEndsAt: entitlement.periodEndsAt ?? null, willAutoRenew: entitlement.willAutoRenew ?? null,
    verificationStatus: entitlement.verificationStatus ?? (entitlement.lastVerifiedAt ? "verified" : "notConfigured"),
    identity: {
      originalTransactionReference: safeReference(entitlement.originalTransactionID),
      appAccountTokenSHA256: sha256(entitlement.appAccountToken),
      sourceEventReference: safeReference(entitlement.sourceEventID),
    },
    reconciliation: {
      status: entitlement.reconciliationStatus, attemptCount: Number(entitlement.reconciliationAttemptCount ?? 0),
      errorCode: entitlement.lastReconciliationErrorCode ?? null,
      lastVerifiedAt: entitlement.lastVerifiedAt ?? null, lastReconciledAt: entitlement.lastReconciledAt ?? null,
      nextReconciliationAt: entitlement.nextReconciliationAt ?? null,
    },
    latestJob: latestJob ? publicJob(latestJob) : null,
    updatedAt: entitlement.updatedAt ?? entitlement.lastReconciledAt ?? entitlement.lastVerifiedAt ?? entitlement.nextReconciliationAt,
  };
}

function mapPostgresSubscription(row) {
  return {
    userID: String(row.user_id), state: row.state, hasAccess: accessStates.has(row.state),
    productID: row.product_id ?? null, environment: row.environment,
    periodEndsAt: row.period_ends_at, willAutoRenew: row.will_auto_renew,
    verificationStatus: row.last_verified_at ? "verified" : "notConfigured",
    identity: {
      originalTransactionReference: safeReference(row.original_transaction_id),
      appAccountTokenSHA256: sha256(row.app_account_token),
      sourceEventReference: safeReference(row.source_event_id),
    },
    reconciliation: {
      status: row.reconciliation_status, attemptCount: Number(row.reconciliation_attempt_count ?? 0),
      errorCode: row.last_reconciliation_error_code ?? null,
      lastVerifiedAt: row.last_verified_at, lastReconciledAt: row.last_reconciled_at,
      nextReconciliationAt: row.next_reconciliation_at,
    },
    latestJob: row.latest_job_id ? {
      id: String(row.latest_job_id), state: row.latest_job_state,
      attemptCount: Number(row.latest_job_attempt_count ?? 0), maxAttempts: Number(row.latest_job_max_attempts ?? 0),
      availableAt: row.latest_job_available_at, lockedAt: row.latest_job_locked_at,
      lockedUntil: row.latest_job_locked_until, workerID: row.latest_job_worker_id,
      errorCode: row.latest_job_error_code, errorMessage: row.latest_job_error_message,
      createdAt: row.latest_job_created_at, updatedAt: row.latest_job_updated_at,
      completedAt: row.latest_job_completed_at,
    } : null,
    updatedAt: row.updated_at,
  };
}

function memoryJobs(queue, userID) {
  if (!queue?.jobs) return [];
  return [...queue.jobs.values()].filter((job) => job.type === "entitlement.reconcile" && job.userID === userID);
}

function publicJob(job) {
  return {
    id: job.id, state: job.state, attemptCount: Number(job.attemptCount ?? 0), maxAttempts: Number(job.maxAttempts ?? 0),
    availableAt: job.availableAt, lockedAt: job.lockedAt, lockedUntil: job.lockedUntil,
    workerID: job.workerID, errorCode: job.lastErrorCode, errorMessage: job.lastErrorMessage,
    createdAt: job.createdAt, updatedAt: job.updatedAt, completedAt: job.completedAt,
  };
}

function appStoreEventTimeline(row) {
  return {
    id: `apple:${row.app_store_event_id}`, kind: "apple_event", source: "Apple verified event",
    at: row.verified_at, title: titleCase(row.notification_type), outcome: row.processing_state,
    detail: row.failure_code ? `Failure: ${row.failure_code}` : `${titleCase(row.environment)} event processed by FamilyChef`,
    reference: safeReference(row.transaction_id ?? row.original_transaction_id),
    payloadSHA256Prefix: prefixHash(row.signed_payload_sha256),
  };
}

function notificationTimeline(row) {
  const event = row.event ?? {};
  return {
    id: `notification:${event.eventID}`, kind: "apple_notification", source: "App Store notification",
    at: row.receivedAt, title: titleCase(event.notificationType ?? "Notification received"), outcome: row.processingState,
    detail: row.failureCode ? `Failure: ${row.failureCode}` : `${titleCase(event.environment ?? "unknown")} notification`,
    reference: safeReference(event.transactionID ?? event.originalTransactionID),
    payloadSHA256Prefix: prefixHash(event.signedPayloadSHA256),
  };
}

function postgresNotificationTimeline(row) {
  return {
    id: `notification:${row.app_store_event_id}`, kind: "apple_notification", source: "App Store notification",
    at: row.received_at, title: titleCase(row.notification_type), outcome: row.processing_state,
    detail: row.failure_code ? `Failure: ${row.failure_code}` : `${titleCase(row.environment)} notification`,
    reference: safeReference(row.transaction_id ?? row.original_transaction_id),
    payloadSHA256Prefix: prefixHash(row.signed_payload_sha256),
  };
}

function jobTimeline(job) {
  return {
    id: `job:${job.id}`, kind: "reconciliation_job", source: "FamilyChef worker",
    at: job.updatedAt ?? job.createdAt, title: `Reconciliation ${titleCase(job.state)}`, outcome: job.state,
    detail: job.lastErrorCode ? `${job.lastErrorCode} · attempt ${job.attemptCount}/${job.maxAttempts}` : `Attempt ${job.attemptCount}/${job.maxAttempts}`,
    reference: safeReference(job.id),
  };
}

function postgresJobTimeline(row) {
  return jobTimeline({
    id: row.id, state: row.state, attemptCount: Number(row.attempt_count ?? 0), maxAttempts: Number(row.max_attempts ?? 0),
    lastErrorCode: row.last_error_code, updatedAt: row.updated_at, createdAt: row.created_at,
  });
}

function actionTimeline(action) {
  return {
    id: `action:${action.id}`, kind: "operator_action", source: action.actorID,
    at: action.occurredAt, title: "Verified check queued", outcome: action.afterStatus,
    detail: action.reason, reference: safeReference(action.correlationID),
  };
}

function postgresActionTimeline(row) {
  return actionTimeline({
    id: row.id, actorID: row.actor_id, occurredAt: row.occurred_at,
    afterStatus: row.after_status, reason: row.reason, correlationID: row.correlation_id,
  });
}

function sortTimeline(items) {
  return items.sort((left, right) => new Date(right.at ?? 0) - new Date(left.at ?? 0));
}

function validateStatus(status) {
  if (status !== "all" && status !== "attention" && !permittedStatuses.has(status)) {
    throw new AccountError("VALIDATION_ERROR", "Subscription reconciliation status filter is invalid.", 400);
  }
}

function statusMatches(value, filter) {
  return filter === "all" || (filter === "attention" ? retryableStatuses.has(value) : value === filter);
}

function validateResolution(reason, actor, correlationID) {
  if (typeof reason !== "string" || reason.trim().length < 10 || reason.trim().length > 500) {
    throw new AccountError("VALIDATION_ERROR", "Give a specific operational reason between 10 and 500 characters.", 400);
  }
  if (!actor?.id || !correlationID) throw new AccountError("VALIDATION_ERROR", "Operator and correlation identity are required.", 400);
}

function notFound() { return new AccountError("VALIDATION_ERROR", "Subscription case not found.", 404); }
function notRetryable() { return new AccountError("CONFLICT", "Only delayed or mismatched cases can be queued for a verified retry.", 409); }
function boundedLimit(value) { const parsed = Number(value); return Number.isInteger(parsed) ? Math.min(200, Math.max(1, parsed)) : 100; }
function sha256(value) { return value ? createHash("sha256").update(String(value), "utf8").digest("hex") : null; }
function prefixHash(value) { return value ? String(value).slice(0, 12) : null; }
function safeReference(value) {
  if (!value) return null;
  const text = String(value);
  return `${text.length > 6 ? `…${text.slice(-6)}` : "withheld"} · ${sha256(text).slice(0, 12)}`;
}
function titleCase(value = "") { return String(value).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
