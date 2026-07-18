import { createHash, randomUUID } from "node:crypto";
import { MemoryPrivateObjectStore } from "./private-object-store.mjs";
import { withTransaction } from "./database.mjs";

const EXPORT_TTL_MILLISECONDS = 24 * 60 * 60_000;
const EXPORT_TYPES = new Set(["kpis", "cohorts", "support_account"]);

export class AdminExportError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AdminExportError";
    this.code = code;
    this.status = status;
  }
}

export class AdminExportService {
  constructor({ analyticsService, userSupportService, objectStore = new MemoryPrivateObjectStore(), now = () => new Date() } = {}) {
    if (!analyticsService || !userSupportService) throw new Error("Analytics and user-support services are required.");
    this.analyticsService = analyticsService;
    this.userSupportService = userSupportService;
    this.objectStore = objectStore;
    this.now = now;
    this.requests = new Map();
    this.idempotency = new Map();
    this.auditEvents = [];
  }

  async list({ actor }) {
    requireActor(actor);
    const securityAdmin = actor.roles?.includes("security_admin");
    const exports = [...this.requests.values()]
      .filter((item) => item.dataScope === "aggregate" || item.requestedBy === actor.id || securityAdmin)
      .sort((a, b) => b.requestedAt - a.requestedAt).slice(0, 100).map((item) => publicExport(expire(item, this.now())));
    return { exports, retentionHours: 24, userLevelRequiresReason: true, deliveryIsAudited: true };
  }

  async create(input, context = {}) {
    const request = normalizeRequest(input, context);
    const replay = this.idempotency.get(`${request.actorID}:${request.idempotencyKey}`);
    if (replay) return publicExport(this.requests.get(replay));
    const built = await buildCSV(request, this.analyticsService, this.userSupportService, context.actor, context.correlationID);
    const now = this.now(); const id = randomUUID();
    const record = exportRecord(id, request, built, now);
    await putCSV(this.objectStore, record.objectKey, built.csv);
    this.requests.set(id, record); this.idempotency.set(`${request.actorID}:${request.idempotencyKey}`, id);
    this.auditEvents.push(makeAudit(record, "created", request.actorID, request.reason, context.correlationID, now));
    return publicExport(record);
  }

  async download(id, context = {}) {
    const actor = requireActor(context.actor);
    const record = this.requests.get(id);
    if (!record) throw notFound();
    expire(record, this.now());
    authorizeDelivery(record, actor, context.reason);
    if (record.status !== "ready") throw new AdminExportError("VALIDATION_ERROR", "This export is no longer available.", 410);
    const content = await getCSV(this.objectStore, record.objectKey);
    const now = this.now(); record.deliveredAt = now;
    this.auditEvents.push(makeAudit(record, "delivered", actor.id, context.reason, context.correlationID, now));
    return { filename: record.filename, content, contentSHA256: record.contentSHA256 };
  }

  auditLog() { return structuredClone(this.auditEvents); }
}

export class PostgresAdminExportService {
  constructor({ pool, analyticsService, userSupportService, objectStore, now = () => new Date() } = {}) {
    if (!pool?.query || !pool?.connect) throw new Error("A PostgreSQL pool is required.");
    if (!analyticsService || !userSupportService || !objectStore) throw new Error("Analytics, user-support, and private object-store services are required.");
    this.pool = pool; this.analyticsService = analyticsService; this.userSupportService = userSupportService;
    this.objectStore = objectStore; this.now = now;
  }

  async list({ actor }) {
    const identity = requireActor(actor); const securityAdmin = identity.roles?.includes("security_admin") ?? false;
    const result = await this.pool.query(
      `${SELECT_EXPORT} WHERE data_scope = 'aggregate' OR requested_by = $1 OR $2 = true
        ORDER BY requested_at DESC LIMIT 100`, [identity.id, securityAdmin],
    );
    return { exports: result.rows.map(mapExport).map(publicExport), retentionHours: 24, userLevelRequiresReason: true, deliveryIsAudited: true };
  }

  async create(input, context = {}) {
    const request = normalizeRequest(input, context);
    const replay = await this.pool.query(
      `${SELECT_EXPORT} WHERE requested_by = $1 AND idempotency_key = $2`,
      [request.actorID, request.idempotencyKey],
    );
    if (replay.rows[0]) return publicExport(mapExport(replay.rows[0]));
    const built = await buildCSV(request, this.analyticsService, this.userSupportService, context.actor, context.correlationID);
    const now = this.now(); const id = randomUUID(); const record = exportRecord(id, request, built, now);
    try { await putCSV(this.objectStore, record.objectKey, built.csv); }
    catch { throw new AdminExportError("TEMPORARY_FAILURE", "Private export storage is temporarily unavailable.", 503); }
    try {
      await withTransaction(this.pool, async (client) => {
        await client.query(
          `INSERT INTO admin_export_requests (
              id, export_type, data_scope, status, requested_by, reason, filters_json,
              subject_sha256, filename, object_key, content_sha256, row_count,
              idempotency_key, requested_at, ready_at, expires_at
           ) VALUES ($1, $2, $3, 'ready', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13, $14)`,
          [record.id, record.exportType, record.dataScope, record.requestedBy, record.reason,
            record.filters, record.subjectSHA256, record.filename, record.objectKey, record.contentSHA256,
            record.rowCount, record.idempotencyKey, record.requestedAt, record.expiresAt],
        );
        await insertAudit(client, makeAudit(record, "created", request.actorID, request.reason, context.correlationID, now));
      });
    } catch (error) {
      await this.objectStore.deletePrefix(`admin-exports/${record.id}/`).catch(() => {});
      throw error;
    }
    return publicExport(record);
  }

  async download(id, context = {}) {
    const actor = requireActor(context.actor); const now = this.now();
    const selected = await this.pool.query(`${SELECT_EXPORT} WHERE id = $1`, [id]);
    const record = selected.rows[0] ? mapExport(selected.rows[0]) : null;
    if (!record) throw notFound();
    authorizeDelivery(record, actor, context.reason);
    if (record.expiresAt <= now || record.status === "expired") {
      await this.pool.query("UPDATE admin_export_requests SET status = 'expired' WHERE id = $1 AND status = 'ready'", [id]);
      throw new AdminExportError("VALIDATION_ERROR", "This export is no longer available.", 410);
    }
    if (record.status !== "ready") throw new AdminExportError("VALIDATION_ERROR", "This export is not ready.", 409);
    let content;
    try { content = await getCSV(this.objectStore, record.objectKey); }
    catch { throw new AdminExportError("TEMPORARY_FAILURE", "Private export delivery is temporarily unavailable.", 503); }
    await withTransaction(this.pool, async (client) => {
      await client.query("UPDATE admin_export_requests SET delivered_at = $2 WHERE id = $1", [id, now]);
      await insertAudit(client, makeAudit(record, "delivered", actor.id, context.reason, context.correlationID, now));
    });
    return { filename: record.filename, content, contentSHA256: record.contentSHA256 };
  }
}

const SELECT_EXPORT = `SELECT id, export_type, data_scope, status, requested_by, reason, filters_json,
  subject_sha256, filename, object_key, content_sha256, row_count, idempotency_key,
  requested_at, ready_at, expires_at, delivered_at, failure_code FROM admin_export_requests`;

async function buildCSV(request, analytics, userSupport, actor, correlationID) {
  if (request.exportType === "kpis") {
    const result = await analytics.kpis(request.filters);
    const headers = ["metric_id", "label", "value", "format", "numerator", "denominator", "formula", "freshness_at", "suppressed"];
    const rows = result.metrics.map((metric) => [metric.id, metric.label, metric.value, metric.format, metric.numerator, metric.denominator, metric.formula, result.freshnessAt, Boolean(metric.suppressed)]);
    return { csv: csv(headers, rows), rowCount: rows.length, subjectSHA256: null, filters: result.filters };
  }
  if (request.exportType === "cohorts") {
    const result = await analytics.cohorts(request.filters);
    const headers = [...result.tableColumns.map((column) => column.id), "suppressed"];
    const rows = result.rows.map((row) => [...result.tableColumns.map((column) => row[column.id]), Boolean(row.suppressed)]);
    return { csv: csv(headers, rows), rowCount: rows.length, subjectSHA256: null, filters: result.filters };
  }
  const support = await userSupport.lookup({
    internalUserID: request.internalUserID, verifiedEmail: request.verifiedEmail,
    reason: request.reason, actor, correlationID,
  });
  const headers = [
    "internal_user_id", "verified_email", "account_status", "created_at", "onboarding_status",
    "profile_revision", "active_session_count", "subscription_state", "has_access", "product_id",
    "period_ends_at", "reconciliation_status", "latest_plan_job_state", "adopted_plan_count",
    "latest_adoption_at", "latest_weekly_review_at", "latest_export_status", "latest_deletion_status",
  ];
  const rows = [[
    support.identity.userID, support.identity.verifiedEmail, support.identity.status, support.identity.createdAt,
    support.account.onboardingStatus, support.account.profileRevision, support.account.activeSessionCount,
    support.subscription.state, support.subscription.hasAccess, support.subscription.productID,
    support.subscription.periodEndsAt, support.subscription.reconciliationStatus, support.planning.latestJobState,
    support.planning.adoptedPlanCount, support.planning.latestAdoptionAt, support.planning.latestWeeklyReviewAt,
    support.privacyRequests.latestExport?.status, support.privacyRequests.latestDeletion?.status,
  ]];
  return { csv: csv(headers, rows), rowCount: 1, subjectSHA256: sha256(String(support.identity.userID)), filters: { exactMatch: true, projection: "support_account_v1" } };
}

function normalizeRequest(input = {}, context = {}) {
  const exportType = String(input.exportType ?? "");
  if (!EXPORT_TYPES.has(exportType)) throw validation("Choose a supported KPI, cohort, or support-account export.");
  const actor = requireActor(context.actor); const dataScope = exportType === "support_account" ? "user" : "aggregate";
  if (dataScope === "user" && !actor.roles?.includes("security_admin")) throw new AdminExportError("AUTHENTICATION_REQUIRED", "User-level exports require security-admin access.", 403);
  const reason = String(input.reason ?? "").trim();
  if (dataScope === "user" && (reason.length < 12 || reason.length > 500)) throw validation("User-level export reason must be 12–500 characters.");
  const idempotencyKey = String(context.idempotencyKey ?? input.idempotencyKey ?? "").trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) throw validation("An 8–128 character idempotency key is required.");
  const hasID = typeof input.internalUserID === "string" && input.internalUserID.trim();
  const hasEmail = typeof input.verifiedEmail === "string" && input.verifiedEmail.trim();
  if (dataScope === "user" && Boolean(hasID) === Boolean(hasEmail)) throw validation("Provide exactly one internal user ID or verified email for a user-level export.");
  return {
    exportType, dataScope, reason: reason || null, actorID: String(actor.id), idempotencyKey,
    filters: dataScope === "aggregate" ? structuredClone(input.filters ?? {}) : {},
    internalUserID: hasID ? input.internalUserID.trim() : null,
    verifiedEmail: hasEmail ? input.verifiedEmail.trim() : null,
  };
}

function exportRecord(id, request, built, now) {
  const date = now.toISOString().slice(0, 10);
  return {
    id, exportType: request.exportType, dataScope: request.dataScope, status: "ready",
    requestedBy: request.actorID, reason: request.reason, filters: built.filters,
    subjectSHA256: built.subjectSHA256, filename: `nourish-${request.exportType.replaceAll("_", "-")}-${date}.csv`,
    objectKey: `admin-exports/${id}/export.csv`, contentSHA256: sha256(built.csv), rowCount: built.rowCount,
    idempotencyKey: request.idempotencyKey, requestedAt: now, readyAt: now,
    expiresAt: new Date(now.getTime() + EXPORT_TTL_MILLISECONDS), deliveredAt: null, failureCode: null,
  };
}

function publicExport(record) {
  return {
    id: record.id, exportType: record.exportType, dataScope: record.dataScope, status: record.status,
    requestedBy: record.requestedBy, reason: record.reason, filters: structuredClone(record.filters),
    subjectReference: record.subjectSHA256 ? record.subjectSHA256.slice(0, 12) : null,
    filename: record.filename, contentSHA256: record.contentSHA256, rowCount: record.rowCount,
    requestedAt: record.requestedAt, readyAt: record.readyAt, expiresAt: record.expiresAt,
    deliveredAt: record.deliveredAt, failureCode: record.failureCode,
  };
}

function mapExport(row) {
  return {
    id: row.id, exportType: row.export_type, dataScope: row.data_scope, status: row.status,
    requestedBy: row.requested_by, reason: row.reason, filters: row.filters_json ?? {},
    subjectSHA256: row.subject_sha256, filename: row.filename, objectKey: row.object_key,
    contentSHA256: row.content_sha256, rowCount: Number(row.row_count), idempotencyKey: row.idempotency_key,
    requestedAt: new Date(row.requested_at), readyAt: row.ready_at ? new Date(row.ready_at) : null,
    expiresAt: new Date(row.expires_at), deliveredAt: row.delivered_at ? new Date(row.delivered_at) : null,
    failureCode: row.failure_code,
  };
}

function authorizeDelivery(record, actor, reason) {
  if (record.dataScope !== "user") return;
  if (!actor.roles?.includes("security_admin")) throw new AdminExportError("AUTHENTICATION_REQUIRED", "User-level export delivery requires security-admin access.", 403);
  const normalized = String(reason ?? "").trim();
  if (normalized.length < 12 || normalized.length > 500) throw validation("A 12–500 character delivery reason is required for user-level exports.");
}

function expire(record, now) {
  if (record.status === "ready" && record.expiresAt <= now) record.status = "expired";
  return record;
}

function makeAudit(record, action, actorID, reason, correlationID, occurredAt) {
  return { id: randomUUID(), exportID: record.id, exportType: record.exportType, dataScope: record.dataScope, actorID: String(actorID), action, reason: reason ?? null, correlationID: correlationID ?? null, occurredAt };
}

async function insertAudit(client, audit) {
  await client.query(
    `INSERT INTO admin_export_audit_logs (
        id, export_id, export_type, data_scope, actor_reference, action, reason, correlation_id, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [audit.id, audit.exportID, audit.exportType, audit.dataScope, audit.actorID, audit.action, audit.reason, audit.correlationID, audit.occurredAt],
  );
}

function csv(headers, rows) { return `${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`; }
function csvCell(value) {
  if (value == null) return "";
  let text = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
async function putCSV(store, key, content) { if (!store?.putText) throw new Error("Private text storage is unavailable."); await store.putText({ key, value: content }); }
async function getCSV(store, key) { if (!store?.getText) throw new Error("Private text storage is unavailable."); return store.getText(key); }
function requireActor(actor) { if (!actor?.id) throw new AdminExportError("AUTHENTICATION_REQUIRED", "An accountable export operator is required.", 403); return actor; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function validation(message) { return new AdminExportError("VALIDATION_ERROR", message); }
function notFound() { return new AdminExportError("NOT_FOUND", "The export could not be found.", 404); }
