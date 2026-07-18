import { randomUUID } from "node:crypto";
import { withTransaction } from "./database.mjs";

const DEFAULT_BATCH_SIZE = 100;
const SYSTEM_ACTOR = "system:export-retention";
const SYSTEM_REASON = "Automated expiry retention cleanup";
const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export async function cleanupExpiredExportObjects({
  pool,
  objectStore,
  now = () => new Date(),
  batchSize = DEFAULT_BATCH_SIZE,
} = {}) {
  if (!pool?.query || !pool?.connect) throw new Error("A PostgreSQL pool is required for export retention.");
  if (!objectStore?.deleteObject) throw new Error("An exact-delete private object store is required for export retention.");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error("Export retention batch size must be between 1 and 500.");

  const cutoff = now();
  const [adminResult, accountResult] = await Promise.all([
    pool.query(
      `SELECT id, object_key
         FROM admin_export_requests
        WHERE object_key IS NOT NULL
          AND physically_deleted_at IS NULL
          AND expires_at <= $1
          AND status IN ('ready', 'expired')
        ORDER BY expires_at, id
        LIMIT $2`,
      [cutoff, batchSize],
    ),
    pool.query(
      `SELECT id, object_key
         FROM account_export_requests
        WHERE object_key IS NOT NULL
          AND physically_deleted_at IS NULL
          AND expires_at <= $1
          AND status IN ('ready', 'expired')
        ORDER BY expires_at, id
        LIMIT $2`,
      [cutoff, batchSize],
    ),
  ]);

  const summary = { selected: 0, physicallyDeleted: 0, failed: 0, raced: 0 };
  for (const candidate of adminResult.rows) {
    summary.selected += 1;
    addOutcome(summary, await purgeAdminExport({ pool, objectStore, candidate, cutoff }));
  }
  for (const candidate of accountResult.rows) {
    summary.selected += 1;
    addOutcome(summary, await purgeAccountExport({ pool, objectStore, candidate, cutoff }));
  }
  return summary;
}

async function purgeAdminExport({ pool, objectStore, candidate, cutoff }) {
  try {
    requireAdminObjectKey(candidate.id, candidate.object_key);
    await objectStore.deleteObject(candidate.object_key);
  } catch (error) {
    await recordAdminFailure(pool, candidate, cutoff, retentionFailureCode(error));
    return "failed";
  }

  return withTransaction(pool, async (client) => {
    const updated = await client.query(
      `UPDATE admin_export_requests
          SET status = 'expired', object_key = NULL, physically_deleted_at = $2,
              purge_attempt_count = purge_attempt_count + 1, last_purge_failure_code = NULL
        WHERE id = $1 AND object_key = $3 AND physically_deleted_at IS NULL
      RETURNING export_type, data_scope`,
      [candidate.id, cutoff, candidate.object_key],
    );
    if (!updated.rows[0]) return "raced";
    await insertAdminAudit(client, {
      exportID: candidate.id,
      exportType: updated.rows[0].export_type,
      dataScope: updated.rows[0].data_scope,
      action: "physically_deleted",
      occurredAt: cutoff,
    });
    return "physicallyDeleted";
  });
}

async function purgeAccountExport({ pool, objectStore, candidate, cutoff }) {
  try {
    requireAccountObjectKey(candidate.id, candidate.object_key);
    await objectStore.deleteObject(candidate.object_key);
  } catch (error) {
    await recordAccountFailure(pool, candidate, cutoff, retentionFailureCode(error));
    return "failed";
  }

  return withTransaction(pool, async (client) => {
    const updated = await client.query(
      `UPDATE account_export_requests
          SET status = 'expired', object_key = NULL, physically_deleted_at = $2,
              purge_attempt_count = purge_attempt_count + 1, last_purge_failure_code = NULL
        WHERE id = $1 AND object_key = $3 AND physically_deleted_at IS NULL
      RETURNING id`,
      [candidate.id, cutoff, candidate.object_key],
    );
    if (!updated.rows[0]) return "raced";
    await insertAccountAudit(client, candidate.id, "physically_deleted", null, cutoff);
    return "physicallyDeleted";
  });
}

async function recordAdminFailure(pool, candidate, occurredAt, failureCode) {
  await withTransaction(pool, async (client) => {
    const updated = await client.query(
      `UPDATE admin_export_requests
          SET status = 'expired', purge_attempt_count = purge_attempt_count + 1,
              last_purge_failure_code = $2
        WHERE id = $1 AND object_key = $3 AND physically_deleted_at IS NULL
      RETURNING export_type, data_scope`,
      [candidate.id, failureCode, candidate.object_key],
    );
    if (updated.rows[0]) {
      await insertAdminAudit(client, {
        exportID: candidate.id,
        exportType: updated.rows[0].export_type,
        dataScope: updated.rows[0].data_scope,
        action: "cleanup_failed",
        occurredAt,
      });
    }
  });
}

async function recordAccountFailure(pool, candidate, occurredAt, failureCode) {
  await withTransaction(pool, async (client) => {
    const updated = await client.query(
      `UPDATE account_export_requests
          SET status = 'expired', purge_attempt_count = purge_attempt_count + 1,
              last_purge_failure_code = $2
        WHERE id = $1 AND object_key = $3 AND physically_deleted_at IS NULL
      RETURNING id`,
      [candidate.id, failureCode, candidate.object_key],
    );
    if (updated.rows[0]) await insertAccountAudit(client, candidate.id, "cleanup_failed", failureCode, occurredAt);
  });
}

async function insertAdminAudit(client, event) {
  await client.query(
    `INSERT INTO admin_export_audit_logs (
        id, export_id, export_type, data_scope, actor_reference, action, reason, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [randomUUID(), event.exportID, event.exportType, event.dataScope, SYSTEM_ACTOR, event.action, SYSTEM_REASON, event.occurredAt],
  );
}

async function insertAccountAudit(client, exportID, action, failureCode, occurredAt) {
  await client.query(
    `INSERT INTO account_export_retention_audit_logs (
        id, export_id, actor_reference, action, failure_code, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), exportID, SYSTEM_ACTOR, action, failureCode, occurredAt],
  );
}

function requireAdminObjectKey(id, key) {
  requireUUID(id);
  const expected = new RegExp(`^admin-exports/${escapeRegularExpression(id)}/export\\.csv$`, "i");
  if (!expected.test(String(key ?? ""))) throw invalidObjectKey();
}

function requireAccountObjectKey(id, key) {
  requireUUID(id);
  const expected = new RegExp(`^account-exports/[0-9a-f]{64}/${escapeRegularExpression(id)}\\.json$`, "i");
  if (!expected.test(String(key ?? ""))) throw invalidObjectKey();
}

function requireUUID(id) {
  if (!new RegExp(`^${UUID_PATTERN}$`, "i").test(String(id ?? ""))) throw invalidObjectKey();
}

function invalidObjectKey() {
  const error = new Error("The stored export object key does not match its protected namespace.");
  error.code = "INVALID_OBJECT_KEY";
  return error;
}

function retentionFailureCode(error) {
  return error?.code === "INVALID_OBJECT_KEY" ? "INVALID_OBJECT_KEY" : "OBJECT_DELETE_FAILED";
}

function escapeRegularExpression(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function addOutcome(summary, outcome) {
  if (outcome === "physicallyDeleted") summary.physicallyDeleted += 1;
  else if (outcome === "failed") summary.failed += 1;
  else summary.raced += 1;
}
