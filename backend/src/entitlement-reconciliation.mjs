import { randomUUID } from "node:crypto";
import { AppStoreServerError } from "./app-store-server-client.mjs";
import { withTransaction } from "./database.mjs";

export async function scheduleDueEntitlementReconciliations({ pool, now = () => new Date(), limit = 100 } = {}) {
  if (!pool?.connect) throw new Error("A PostgreSQL pool is required.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error("The reconciliation scheduling limit is invalid.");
  const scheduledAt = now();
  return withTransaction(pool, async (client) => {
    const due = await client.query(
      `SELECT subscription.user_id, subscription.next_reconciliation_at
         FROM subscriptions subscription
         JOIN users account ON account.id = subscription.user_id
        WHERE subscription.original_transaction_id IS NOT NULL
          AND subscription.environment IN ('sandbox', 'production')
          AND subscription.next_reconciliation_at <= $1
          AND account.disabled_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM background_jobs job
             WHERE job.job_type = 'entitlement.reconcile'
               AND job.user_id = subscription.user_id
               AND job.state IN ('queued', 'running')
          )
        ORDER BY subscription.next_reconciliation_at, subscription.user_id
        FOR UPDATE OF subscription SKIP LOCKED
        LIMIT $2`,
      [scheduledAt, limit],
    );
    const scheduled = [];
    for (const row of due.rows) {
      const dueAt = new Date(row.next_reconciliation_at);
      const idempotencyKey = `entitlement:${row.user_id}:${dueAt.toISOString()}`;
      const inserted = await client.query(
        `INSERT INTO background_jobs (
            id, job_type, user_id, idempotency_key, state, payload_json,
            max_attempts, available_at, created_at, updated_at
         ) VALUES ($1, 'entitlement.reconcile', $2, $3, 'queued', $4::jsonb, 8, $5, $5, $5)
         ON CONFLICT (job_type, idempotency_key) DO NOTHING
         RETURNING id`,
        [randomUUID(), row.user_id, idempotencyKey, JSON.stringify({ dueAt: dueAt.toISOString() }), scheduledAt],
      );
      if (!inserted.rows[0]) continue;
      await client.query(
        `UPDATE subscriptions
            SET reconciliation_status = 'pending', updated_at = $2
          WHERE user_id = $1`,
        [row.user_id, scheduledAt],
      );
      scheduled.push({ jobID: inserted.rows[0].id, userID: row.user_id, dueAt });
    }
    return scheduled;
  });
}

export function createEntitlementReconciliationHandler({ pool, appStoreClient, accountService, analyticsEventService = null, now = () => new Date() }) {
  if (!pool?.query) throw new Error("A PostgreSQL pool is required.");
  if (!appStoreClient?.fetchSubscriptionStatus) throw new Error("An App Store server client is required.");
  if (!accountService?.recordVerifiedAppStoreEvent || !accountService?.recordReconciliationFailure || !accountService?.recordReconciliationMismatch) {
    throw new Error("A durable account service is required.");
  }
  const accounts = accountService;
  return async (job, lease = {}) => {
    const target = await pool.query(
      `SELECT user_id, original_transaction_id, app_account_token, environment, state
         FROM subscriptions
        WHERE user_id = $1`,
      [job.userID],
    );
    const subscription = target.rows[0];
    if (!subscription?.original_transaction_id || !["sandbox", "production"].includes(subscription.environment)) {
      return { userID: job.userID, status: "superseded" };
    }
    await lease.extendLease?.(2 * 60_000);
    try {
      const event = await appStoreClient.fetchSubscriptionStatus({
        originalTransactionID: subscription.original_transaction_id,
        environment: subscription.environment,
      });
      const mismatch = reconciliationMismatch(subscription, event);
      if (mismatch) {
        await accounts.recordReconciliationMismatch(job.userID, mismatch);
        return { userID: job.userID, status: "mismatch", code: mismatch };
      }
      const entitlement = await accounts.recordVerifiedAppStoreEvent(job.userID, event);
      await recordSubscriptionAnalytics(analyticsEventService, {
        userID: job.userID,
        event,
        previousState: subscription.state ?? "unknown",
        entitlement,
      });
      return {
        userID: job.userID,
        status: "reconciled",
        entitlementState: entitlement.state,
        hasAccess: entitlement.hasAccess,
        nextReconciliationAt: entitlement.nextReconciliationAt,
      };
    } catch (error) {
      const normalized = normalizeHandlerError(error);
      if (normalized.code === "APP_STORE_SERVER_NOT_CONFIGURED") throw normalized;
      if (normalized.retryable) {
        await accounts.recordReconciliationFailure(job.userID, normalized.code);
        throw normalized;
      }
      await accounts.recordReconciliationMismatch(job.userID, normalized.code);
      return { userID: job.userID, status: "mismatch", code: normalized.code };
    }
  };
}

async function recordSubscriptionAnalytics(service, { userID, event, previousState, entitlement }) {
  if (!service?.recordServerEvent) return;
  const events = [];
  if (entitlement.state === "trial") {
    events.push({
      eventName: "trial_started",
      dedupeKey: `trial:${String(event.originalTransactionID ?? event.eventID).slice(0, 140)}`,
      occurredAt: event.purchasedAt ?? undefined,
      properties: {
        product_id: analyticsToken(event.productID ?? entitlement.productID, "unknown_product", 120),
        period: analyticsToken(event.trialPeriod, "free_trial"),
      },
    });
  }
  if (previousState !== entitlement.state) {
    events.push({
      eventName: "subscription_state_changed",
      dedupeKey: `subscription-state:${String(event.eventID).slice(0, 130)}`,
      properties: {
        from_state: analyticsToken(previousState, "unknown"),
        to_state: analyticsToken(entitlement.state, "unknown"),
        notification_type: analyticsToken(event.notificationType, "RECONCILIATION"),
      },
    });
  }
  for (const analyticsEvent of events) {
    try {
      await service.recordServerEvent({ userID, ...analyticsEvent });
    } catch {
      // Reconciliation remains authoritative when optional measurement is unavailable.
    }
  }
}

function analyticsToken(value, fallback, maximumLength = 80) {
  const token = String(value ?? "").replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, maximumLength);
  return token || fallback;
}

function reconciliationMismatch(subscription, event) {
  if (!event?.verified || event.source !== "app_store_server_api") return "APPLE_UNVERIFIED_RECONCILIATION";
  if (String(event.originalTransactionID) !== String(subscription.original_transaction_id)) return "APPLE_SUBSCRIPTION_IDENTITY_MISMATCH";
  if (String(event.environment).toLowerCase() !== String(subscription.environment).toLowerCase()) return "APPLE_ENVIRONMENT_MISMATCH";
  if (subscription.app_account_token && String(event.appAccountToken ?? "").toLowerCase() !== String(subscription.app_account_token).toLowerCase()) {
    return "APPLE_APP_ACCOUNT_TOKEN_MISMATCH";
  }
  return null;
}

function normalizeHandlerError(error) {
  if (error instanceof AppStoreServerError) return error;
  const normalized = new AppStoreServerError(error?.code ?? "APPLE_RECONCILIATION_FAILED", "Apple subscription reconciliation failed.", {
    retryable: Boolean(error?.retryable),
  });
  normalized.cause = error;
  return normalized;
}
