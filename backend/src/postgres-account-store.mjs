import { randomUUID } from "node:crypto";
import { accountSubjectHash } from "./account-service.mjs";
import { withTransaction } from "./database.mjs";

const accessStates = new Set(["active", "trial", "graceOrBillingRetry", "upgraded", "downgraded"]);

export class PostgresAccountStore {
  constructor({ pool, now = () => new Date() }) {
    if (!pool?.query || !pool?.connect) throw new Error("A PostgreSQL pool is required.");
    this.pool = pool;
    this.now = now;
  }

  async readEntitlement(userID) {
    return this.#readEntitlement(this.pool, userID);
  }

  async applyVerifiedEntitlement(userID, event, snapshot) {
    return withTransaction(this.pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO app_store_events (
            id, app_store_event_id, user_id, notification_type, environment,
            signed_payload_sha256, verified_at, processing_state,
            original_transaction_id, transaction_id, app_account_token
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'received', $8, $9, $10)
         ON CONFLICT (app_store_event_id) DO NOTHING
         RETURNING id`,
        [
          randomUUID(), event.eventID, userID, event.notificationType ?? event.state,
          event.environment ?? "unknown", event.signedPayloadSHA256.toLowerCase(), snapshot.lastVerifiedAt,
          event.originalTransactionID ?? null, event.transactionID ?? null, event.appAccountToken ?? null,
        ],
      );
      if (!inserted.rows[0]) {
        const owner = await client.query("SELECT user_id FROM app_store_events WHERE app_store_event_id = $1", [event.eventID]);
        if (owner.rows[0]?.user_id !== userID) throw storeError("APPLE_EVENT_OWNERSHIP_MISMATCH", "This verified App Store event belongs to another account.");
        const refreshed = await client.query(
          `UPDATE subscriptions
              SET last_verified_at = $2, next_reconciliation_at = $3,
                  reconciliation_status = 'current', last_reconciled_at = $2,
                  reconciliation_attempt_count = 0,
                  last_reconciliation_error_code = NULL, updated_at = $2
            WHERE user_id = $1
              AND ($4::text IS NULL OR original_transaction_id = $4)
          RETURNING *`,
          [userID, snapshot.lastVerifiedAt, snapshot.nextReconciliationAt, snapshot.originalTransactionID],
        );
        return refreshed.rows[0] ? mapEntitlement(refreshed.rows[0]) : this.#readEntitlement(client, userID);
      }
      const saved = await client.query(
        `INSERT INTO subscriptions (
            user_id, state, product_id, environment, period_ends_at,
            will_auto_renew, source_event_id, last_verified_at,
            next_reconciliation_at, reconciliation_status, updated_at,
            original_transaction_id, app_account_token, last_reconciled_at,
            reconciliation_attempt_count, last_reconciliation_error_code
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'current', $8,
                   $10, $11, $8, 0, NULL)
         ON CONFLICT (user_id) DO UPDATE SET
            state = EXCLUDED.state,
            product_id = EXCLUDED.product_id,
            environment = EXCLUDED.environment,
            period_ends_at = EXCLUDED.period_ends_at,
            will_auto_renew = EXCLUDED.will_auto_renew,
            source_event_id = EXCLUDED.source_event_id,
            last_verified_at = EXCLUDED.last_verified_at,
            next_reconciliation_at = EXCLUDED.next_reconciliation_at,
            reconciliation_status = 'current',
            original_transaction_id = COALESCE(EXCLUDED.original_transaction_id, subscriptions.original_transaction_id),
            app_account_token = COALESCE(EXCLUDED.app_account_token, subscriptions.app_account_token),
            last_reconciled_at = EXCLUDED.last_reconciled_at,
            reconciliation_attempt_count = 0,
            last_reconciliation_error_code = NULL,
            updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          userID, snapshot.state, snapshot.productID, snapshot.environment,
          snapshot.periodEndsAt, snapshot.willAutoRenew, snapshot.sourceEventID,
          snapshot.lastVerifiedAt, snapshot.nextReconciliationAt,
          snapshot.originalTransactionID, snapshot.appAccountToken,
        ],
      );
      await client.query(
        `UPDATE app_store_events
            SET processing_state = 'applied', processed_at = $2
          WHERE id = $1`,
        [inserted.rows[0].id, snapshot.lastVerifiedAt],
      );
      return mapEntitlement(saved.rows[0]);
    });
  }

  async retainAfterReconciliationFailure(userID, fallback, nextReconciliationAt, errorCode) {
    const now = this.now();
    const result = await this.pool.query(
      `INSERT INTO subscriptions (
          user_id, state, environment, next_reconciliation_at,
          reconciliation_status, updated_at, reconciliation_attempt_count,
          last_reconciliation_error_code, last_reconciled_at
       ) VALUES ($1, 'unknown', 'unknown', $2, 'delayed', $3, 1, $4, $3)
       ON CONFLICT (user_id) DO UPDATE SET
          next_reconciliation_at = EXCLUDED.next_reconciliation_at,
          reconciliation_status = 'delayed',
          reconciliation_attempt_count = subscriptions.reconciliation_attempt_count + 1,
          last_reconciliation_error_code = EXCLUDED.last_reconciliation_error_code,
          last_reconciled_at = EXCLUDED.last_reconciled_at,
          updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [userID, nextReconciliationAt, now, errorCode],
    );
    return result.rows[0] ? mapEntitlement(result.rows[0]) : fallback;
  }

  async retainAfterReconciliationMismatch(userID, fallback, nextReconciliationAt, errorCode) {
    const now = this.now();
    const result = await this.pool.query(
      `INSERT INTO subscriptions (
          user_id, state, environment, next_reconciliation_at,
          reconciliation_status, updated_at, reconciliation_attempt_count,
          last_reconciliation_error_code, last_reconciled_at
       ) VALUES ($1, 'unknown', 'unknown', $2, 'mismatch', $3, 1, $4, $3)
       ON CONFLICT (user_id) DO UPDATE SET
          next_reconciliation_at = EXCLUDED.next_reconciliation_at,
          reconciliation_status = 'mismatch',
          reconciliation_attempt_count = subscriptions.reconciliation_attempt_count + 1,
          last_reconciliation_error_code = EXCLUDED.last_reconciliation_error_code,
          last_reconciled_at = EXCLUDED.last_reconciled_at,
          updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [userID, nextReconciliationAt, now, errorCode],
    );
    return result.rows[0] ? mapEntitlement(result.rows[0]) : fallback;
  }

  async getOrCreateAppAccountToken(userID, proposedToken, createdAt) {
    const result = await this.pool.query(
      `INSERT INTO app_store_account_bindings (user_id, app_account_token, created_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING app_account_token, created_at`,
      [userID, proposedToken, createdAt],
    );
    return { appAccountToken: result.rows[0].app_account_token, createdAt: new Date(result.rows[0].created_at) };
  }

  async resolveAppStoreUser({ originalTransactionID, appAccountToken }) {
    const result = await this.pool.query(
      `SELECT
          (SELECT user_id FROM subscriptions WHERE original_transaction_id = $1) AS original_user_id,
          (SELECT user_id FROM app_store_account_bindings WHERE app_account_token = $2::uuid) AS token_user_id`,
      [originalTransactionID ?? null, appAccountToken ?? null],
    );
    const row = result.rows[0] ?? {};
    return {
      userID: row.original_user_id ?? row.token_user_id ?? null,
      mismatch: Boolean(row.original_user_id && row.token_user_id && row.original_user_id !== row.token_user_id),
    };
  }

  async saveVerifiedNotification(event, receivedAt) {
    const inserted = await this.pool.query(
      `INSERT INTO app_store_notification_inbox (
          app_store_event_id, original_transaction_id, transaction_id, app_account_token,
          notification_type, environment, normalized_event_json, signed_payload_sha256,
          received_at, processing_state
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, 'pending')
       ON CONFLICT (app_store_event_id) DO NOTHING
       RETURNING *`,
      [
        event.eventID, event.originalTransactionID, event.transactionID, event.appAccountToken ?? null,
        event.notificationType, event.environment, JSON.stringify(event), event.signedPayloadSHA256.toLowerCase(), receivedAt,
      ],
    );
    const row = inserted.rows[0] ?? (await this.pool.query(
      "SELECT * FROM app_store_notification_inbox WHERE app_store_event_id = $1",
      [event.eventID],
    )).rows[0];
    if (!row || row.signed_payload_sha256 !== event.signedPayloadSHA256.toLowerCase()) {
      throw storeError("APPLE_NOTIFICATION_REPLAY_MISMATCH", "A notification identifier was reused with different signed data.");
    }
    return mapNotificationInbox(row);
  }

  async pendingVerifiedNotifications({ originalTransactionID, appAccountToken }) {
    const result = await this.pool.query(
      `SELECT normalized_event_json
         FROM app_store_notification_inbox
        WHERE processing_state = 'pending'
          AND (original_transaction_id = $1 OR ($2::uuid IS NOT NULL AND app_account_token = $2::uuid))
        ORDER BY received_at, app_store_event_id`,
      [originalTransactionID, appAccountToken ?? null],
    );
    return result.rows.map((row) => normalizeStoredEvent(row.normalized_event_json));
  }

  async markVerifiedNotification(eventID, { processingState, userID = null, processedAt, failureCode = null }) {
    await this.pool.query(
      `UPDATE app_store_notification_inbox
          SET processing_state = $2, user_id = $3, processed_at = $4, failure_code = $5
        WHERE app_store_event_id = $1`,
      [eventID, processingState, userID, processedAt, failureCode],
    );
  }

  async markReconciliationDue(userID, dueAt) {
    const result = await this.pool.query(
      `UPDATE subscriptions
          SET next_reconciliation_at = $2, reconciliation_status = 'pending', updated_at = $2
        WHERE user_id = $1
      RETURNING *`,
      [userID, dueAt],
    );
    return result.rows[0] ? mapEntitlement(result.rows[0]) : null;
  }

  async createExport(userID, idempotencyKey, receipt) {
    return withTransaction(this.pool, async (client) => {
      const result = await client.query(
        `INSERT INTO account_export_requests (
            id, user_id, idempotency_key, status, format, requested_at
         ) VALUES ($1, $2, $3, 'queued', 'json', $4)
         ON CONFLICT (user_id, idempotency_key) DO UPDATE
            SET idempotency_key = EXCLUDED.idempotency_key
         RETURNING *`,
        [receipt.requestID, userID, idempotencyKey, receipt.requestedAt],
      );
      const row = result.rows[0];
      await enqueueJob(client, {
        type: "account.export",
        userID,
        idempotencyKey: `export:${idempotencyKey}`,
        payload: { requestID: row.id, userID },
        now: receipt.requestedAt,
      });
      return mapExport(row);
    });
  }

  async createDeletion(userID, idempotencyKey, receipt) {
    return withTransaction(this.pool, async (client) => {
      const subjectHash = accountSubjectHash(userID);
      const result = await client.query(
        `INSERT INTO account_deletion_requests (
            id, user_id, user_subject_sha256, idempotency_key, status,
            reason, requested_at, account_access_revoked_at
         ) VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7)
         ON CONFLICT (user_subject_sha256, idempotency_key) DO UPDATE
            SET idempotency_key = EXCLUDED.idempotency_key
         RETURNING *`,
        [
          receipt.requestID, userID, subjectHash, idempotencyKey, receipt.reason,
          receipt.requestedAt, receipt.accountAccessRevokedAt,
        ],
      );
      const row = result.rows[0];
      await enqueueJob(client, {
        type: "account.delete",
        userID,
        idempotencyKey: `delete:${idempotencyKey}`,
        payload: { requestID: row.id, subjectHash },
        now: receipt.requestedAt,
      });
      return mapDeletion(row);
    });
  }

  async #readEntitlement(executor, userID) {
    const result = await executor.query("SELECT * FROM subscriptions WHERE user_id = $1", [userID]);
    return result.rows[0] ? mapEntitlement(result.rows[0]) : null;
  }
}

function storeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function enqueueJob(client, { type, userID, idempotencyKey, payload, now }) {
  await client.query(
    `INSERT INTO background_jobs (
        id, job_type, user_id, idempotency_key, state, payload_json,
        max_attempts, available_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'queued', $5::jsonb, 8, $6, $6, $6)
     ON CONFLICT (job_type, idempotency_key) DO NOTHING`,
    [randomUUID(), type, userID, idempotencyKey, JSON.stringify(payload), now],
  );
}

function mapEntitlement(row) {
  return {
    userID: row.user_id,
    state: row.state,
    hasAccess: accessStates.has(row.state),
    productID: row.product_id,
    environment: row.environment,
    periodEndsAt: row.period_ends_at ? new Date(row.period_ends_at) : null,
    willAutoRenew: row.will_auto_renew,
    verificationStatus: row.last_verified_at ? "verified" : "notConfigured",
    lastVerifiedAt: row.last_verified_at ? new Date(row.last_verified_at) : null,
    nextReconciliationAt: new Date(row.next_reconciliation_at),
    reconciliationStatus: row.reconciliation_status,
    sourceEventID: row.source_event_id,
    originalTransactionID: row.original_transaction_id ?? null,
    appAccountToken: row.app_account_token ?? null,
    lastReconciledAt: row.last_reconciled_at ? new Date(row.last_reconciled_at) : null,
    reconciliationAttemptCount: Number(row.reconciliation_attempt_count ?? 0),
    lastReconciliationErrorCode: row.last_reconciliation_error_code ?? null,
  };
}

function mapNotificationInbox(row) {
  return {
    event: normalizeStoredEvent(row.normalized_event_json),
    processingState: row.processing_state,
    userID: row.user_id,
    receivedAt: new Date(row.received_at),
    processedAt: row.processed_at ? new Date(row.processed_at) : null,
    failureCode: row.failure_code,
  };
}

function normalizeStoredEvent(value) {
  const event = typeof value === "string" ? JSON.parse(value) : structuredClone(value);
  if (event.periodEndsAt) event.periodEndsAt = new Date(event.periodEndsAt);
  return event;
}

function mapExport(row) {
  return {
    requestID: row.id,
    status: row.status,
    requestedAt: new Date(row.requested_at),
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    format: row.format,
    message: "Your portable export is queued. A private expiring download will be created after processing.",
  };
}

function mapDeletion(row) {
  return {
    requestID: row.id,
    status: row.status,
    requestedAt: new Date(row.requested_at),
    reason: row.reason,
    accountAccessRevokedAt: new Date(row.account_access_revoked_at),
    message: "Account access is disabled and deletion is queued. App Store subscription cancellation is managed separately by Apple.",
  };
}
