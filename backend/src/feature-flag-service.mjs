import { createHash, randomUUID } from "node:crypto";
import { withTransaction } from "./database.mjs";

export class FeatureFlagError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "FeatureFlagError";
    this.code = code;
    this.status = status;
  }
}

export class MemoryFeatureFlagStore {
  flagsByKey = new Map();
  auditEvents = [];
}

export class FeatureFlagService {
  constructor({ store = new MemoryFeatureFlagStore(), now = () => new Date() } = {}) {
    this.store = store;
    this.now = now;
  }

  async list() {
    const flags = [...this.store.flagsByKey.values()].sort((a, b) => a.key.localeCompare(b.key)).map(publicFlag);
    return { flags, auditEvents: this.store.auditEvents.slice(-100).reverse().map(publicAudit), evaluationContract: evaluationContract() };
  }

  async save(input, context = {}) {
    const normalized = normalizeFlag(input, context);
    const existing = this.store.flagsByKey.get(normalized.key);
    if (existing && normalized.expectedVersion !== existing.version) throw conflict();
    if (!existing && normalized.expectedVersion != null) throw conflict();
    const now = this.now();
    const flag = {
      id: existing?.id ?? randomUUID(), key: normalized.key, description: normalized.description,
      enabled: normalized.enabled, emergencyDisabled: normalized.emergencyDisabled,
      rolloutPercentage: normalized.rolloutPercentage, minimumAppVersion: normalized.minimumAppVersion,
      maximumAppVersion: normalized.maximumAppVersion, allowlistedUserIDs: normalized.allowlistedUserIDs,
      value: normalized.value, version: (existing?.version ?? 0) + 1,
      createdBy: existing?.createdBy ?? normalized.actorID, createdAt: existing?.createdAt ?? now,
      updatedBy: normalized.actorID, updatedAt: now,
    };
    const audit = auditEvent(existing, flag, normalized, now);
    this.store.flagsByKey.set(flag.key, flag);
    this.store.auditEvents.push(audit);
    return { flag: publicFlag(flag), audit: publicAudit(audit) };
  }

  async evaluate({ userID, appVersion }) {
    return evaluationResponse([...this.store.flagsByKey.values()], userID, appVersion, this.now());
  }
}

export class PostgresFeatureFlagService {
  constructor({ pool, now = () => new Date() } = {}) {
    if (!pool?.query || !pool?.connect) throw new Error("A PostgreSQL pool is required.");
    this.pool = pool;
    this.now = now;
  }

  async list() {
    const [flags, audit] = await Promise.all([
      this.pool.query(`${SELECT_FLAG_COLUMNS} FROM feature_flags ORDER BY key`),
      this.pool.query(
        `SELECT id, flag_id, flag_key, flag_version, actor_reference, action, reason,
                before_sha256, after_sha256, correlation_id, occurred_at
           FROM feature_flag_audit_logs ORDER BY occurred_at DESC, id DESC LIMIT 100`,
      ),
    ]);
    return { flags: flags.rows.map(mapFlag).map(publicFlag), auditEvents: audit.rows.map(mapAudit).map(publicAudit), evaluationContract: evaluationContract() };
  }

  async save(input, context = {}) {
    const normalized = normalizeFlag(input, context);
    const now = this.now();
    return withTransaction(this.pool, async (client) => {
      const selected = await client.query(`${SELECT_FLAG_COLUMNS} FROM feature_flags WHERE key = $1 FOR UPDATE`, [normalized.key]);
      const existing = selected.rows[0] ? mapFlag(selected.rows[0]) : null;
      if (existing && normalized.expectedVersion !== existing.version) throw conflict();
      if (!existing && normalized.expectedVersion != null) throw conflict();
      const id = existing?.id ?? randomUUID();
      const version = (existing?.version ?? 0) + 1;
      const values = [
        id, normalized.key, normalized.description, normalized.enabled, normalized.emergencyDisabled,
        normalized.rolloutPercentage, normalized.minimumAppVersion, normalized.maximumAppVersion,
        normalized.allowlistedUserIDs, normalized.value, version, normalized.actorID, now,
      ];
      const saved = existing
        ? await client.query(
          `UPDATE feature_flags
              SET description = $3, enabled = $4, emergency_disabled = $5, rollout_percentage = $6,
                  minimum_app_version = $7, maximum_app_version = $8, allowlisted_user_ids = $9,
                  value_json = $10, version = $11, updated_by = $12, updated_at = $13
            WHERE id = $1 AND key = $2
          RETURNING id, key, description, enabled, emergency_disabled, rollout_percentage,
                    minimum_app_version, maximum_app_version, allowlisted_user_ids, value_json,
                    version, created_by, updated_by, created_at, updated_at`, values,
        )
        : await client.query(
          `INSERT INTO feature_flags (
              id, key, description, enabled, emergency_disabled, rollout_percentage,
              minimum_app_version, maximum_app_version, allowlisted_user_ids, value_json,
              version, created_by, updated_by, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13, $13)
           RETURNING id, key, description, enabled, emergency_disabled, rollout_percentage,
                     minimum_app_version, maximum_app_version, allowlisted_user_ids, value_json,
                     version, created_by, updated_by, created_at, updated_at`, values,
        );
      const flag = mapFlag(saved.rows[0]);
      const audit = auditEvent(existing, flag, normalized, now);
      await client.query(
        `INSERT INTO feature_flag_audit_logs (
            id, flag_id, flag_key, flag_version, actor_reference, action, reason,
            before_sha256, after_sha256, correlation_id, occurred_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [audit.id, flag.id, flag.key, flag.version, audit.actorID, audit.action, audit.reason,
          audit.beforeSHA256, audit.afterSHA256, audit.correlationID, audit.occurredAt],
      );
      return { flag: publicFlag(flag), audit: publicAudit(audit) };
    });
  }

  async evaluate({ userID, appVersion }) {
    const result = await this.pool.query(`${SELECT_FLAG_COLUMNS} FROM feature_flags ORDER BY key`);
    return evaluationResponse(result.rows.map(mapFlag), userID, appVersion, this.now());
  }
}

const SELECT_FLAG_COLUMNS = `SELECT id, key, description, enabled, emergency_disabled,
  rollout_percentage, minimum_app_version, maximum_app_version, allowlisted_user_ids,
  value_json, version, created_by, updated_by, created_at, updated_at`;

function normalizeFlag(input = {}, context = {}) {
  const key = String(input.key ?? "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(key)) throw validation("Flag key must be 3–64 lowercase letters, numbers, or underscores.");
  const description = String(input.description ?? "").trim();
  if (!description || description.length > 240) throw validation("Flag description must be 1–240 characters.");
  const reason = String(context.reason ?? input.reason ?? "").trim();
  if (reason.length < 12 || reason.length > 500) throw validation("Change reason must be 12–500 characters.");
  const actorID = context.actor?.id;
  if (!actorID) throw new FeatureFlagError("AUTHENTICATION_REQUIRED", "An accountable flag operator is required.", 403);
  const rolloutPercentage = Number(input.rolloutPercentage);
  if (!Number.isInteger(rolloutPercentage) || rolloutPercentage < 0 || rolloutPercentage > 100) throw validation("Rollout percentage must be a whole number from 0 to 100.");
  const minimumAppVersion = optionalVersion(input.minimumAppVersion);
  const maximumAppVersion = optionalVersion(input.maximumAppVersion);
  if (minimumAppVersion && maximumAppVersion && compareVersions(minimumAppVersion, maximumAppVersion) > 0) throw validation("Minimum app version cannot be greater than maximum app version.");
  const allowlistedUserIDs = [...new Set((input.allowlistedUserIDs ?? []).map((value) => String(value).trim()).filter(Boolean))];
  if (allowlistedUserIDs.length > 500 || allowlistedUserIDs.some((value) => value.length > 128)) throw validation("A flag may contain at most 500 bounded internal user IDs.");
  let serialized;
  try { serialized = JSON.stringify(input.value ?? null); } catch { throw validation("Flag value must be valid JSON."); }
  if (serialized.length > 16_384) throw validation("Flag value must be smaller than 16 KB.");
  const expectedVersion = input.expectedVersion == null ? null : Number(input.expectedVersion);
  if (expectedVersion != null && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) throw validation("Expected version must be a positive integer.");
  return {
    key, description, enabled: Boolean(input.enabled), emergencyDisabled: Boolean(input.emergencyDisabled),
    rolloutPercentage, minimumAppVersion, maximumAppVersion, allowlistedUserIDs,
    value: input.value ?? null, expectedVersion, reason, actorID: String(actorID),
    correlationID: context.correlationID ?? null,
  };
}

function evaluationResponse(flags, userID, appVersion, now) {
  const normalizedUserID = String(userID ?? "").trim();
  if (!normalizedUserID) throw new FeatureFlagError("AUTHENTICATION_REQUIRED", "An authenticated user is required.", 401);
  const normalizedVersion = optionalVersion(appVersion);
  if (!normalizedVersion) throw validation("A valid app version is required for feature evaluation.");
  return {
    appVersion: normalizedVersion, evaluatedAt: now, contractVersion: "feature-flags-v1",
    flags: flags.map((flag) => evaluateFlag(flag, normalizedUserID, normalizedVersion)),
  };
}

export function evaluateFlag(flag, userID, appVersion) {
  let enabled = false; let reasonCode;
  if (flag.emergencyDisabled) reasonCode = "emergency_disabled";
  else if (!flag.enabled) reasonCode = "disabled";
  else if (flag.minimumAppVersion && compareVersions(appVersion, flag.minimumAppVersion) < 0) reasonCode = "below_minimum_app_version";
  else if (flag.maximumAppVersion && compareVersions(appVersion, flag.maximumAppVersion) > 0) reasonCode = "above_maximum_app_version";
  else if (flag.allowlistedUserIDs.includes(userID)) { enabled = true; reasonCode = "allowlisted"; }
  else if (stableBucket(flag.key, userID) < flag.rolloutPercentage) { enabled = true; reasonCode = "percentage_rollout"; }
  else reasonCode = "outside_rollout";
  return { key: flag.key, enabled, value: enabled ? structuredClone(flag.value) : null, version: flag.version, reasonCode };
}

export function stableBucket(key, userID) {
  const hash = createHash("sha256").update(`${key}:${userID}`).digest("hex");
  return (Number.parseInt(hash.slice(0, 8), 16) % 10_000) / 100;
}

function auditEvent(before, after, context, occurredAt) {
  const action = !before ? "created" : !before.emergencyDisabled && after.emergencyDisabled ? "emergency_disabled" : before.emergencyDisabled && !after.emergencyDisabled ? "emergency_restored" : "updated";
  return {
    id: randomUUID(), flagID: after.id, flagKey: after.key, flagVersion: after.version,
    actorID: context.actorID, action, reason: context.reason,
    beforeSHA256: before ? sha256(canonicalFlag(before)) : null,
    afterSHA256: sha256(canonicalFlag(after)), correlationID: context.correlationID, occurredAt,
  };
}

function publicFlag(flag) {
  return {
    id: flag.id, key: flag.key, description: flag.description, enabled: flag.enabled,
    emergencyDisabled: flag.emergencyDisabled, rolloutPercentage: flag.rolloutPercentage,
    minimumAppVersion: flag.minimumAppVersion, maximumAppVersion: flag.maximumAppVersion,
    allowlistedUserIDs: [...flag.allowlistedUserIDs], value: structuredClone(flag.value), version: flag.version,
    createdBy: flag.createdBy, updatedBy: flag.updatedBy, createdAt: flag.createdAt, updatedAt: flag.updatedAt,
    effectiveState: flag.emergencyDisabled ? "emergency_disabled" : flag.enabled ? "active" : "inactive",
  };
}

function publicAudit(event) {
  return {
    id: event.id, flagID: event.flagID, flagKey: event.flagKey, flagVersion: event.flagVersion,
    actorID: event.actorID, action: event.action, reason: event.reason,
    beforeSHA256: event.beforeSHA256, afterSHA256: event.afterSHA256,
    correlationID: event.correlationID, occurredAt: event.occurredAt,
  };
}

function mapFlag(row) {
  return {
    id: row.id, key: row.key, description: row.description, enabled: row.enabled,
    emergencyDisabled: row.emergency_disabled, rolloutPercentage: Number(row.rollout_percentage),
    minimumAppVersion: row.minimum_app_version, maximumAppVersion: row.maximum_app_version,
    allowlistedUserIDs: row.allowlisted_user_ids ?? [], value: row.value_json, version: Number(row.version),
    createdBy: row.created_by, updatedBy: row.updated_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapAudit(row) {
  return {
    id: row.id, flagID: row.flag_id, flagKey: row.flag_key, flagVersion: Number(row.flag_version),
    actorID: row.actor_reference, action: row.action, reason: row.reason,
    beforeSHA256: row.before_sha256, afterSHA256: row.after_sha256,
    correlationID: row.correlation_id, occurredAt: row.occurred_at,
  };
}

function canonicalFlag(flag) {
  return JSON.stringify({
    key: flag.key, description: flag.description, enabled: flag.enabled,
    emergencyDisabled: flag.emergencyDisabled, rolloutPercentage: flag.rolloutPercentage,
    minimumAppVersion: flag.minimumAppVersion, maximumAppVersion: flag.maximumAppVersion,
    allowlistedUserIDs: [...flag.allowlistedUserIDs].sort(), value: flag.value, version: flag.version,
  });
}

function evaluationContract() {
  return {
    order: ["emergency_disable", "enabled_state", "app_version", "user_allowlist", "stable_percentage_bucket"],
    bucket: "SHA-256(flag key + ':' + internal user ID) modulo 10,000, expressed from 0.00 to 99.99.",
    allowlistBypassesPercentage: true, allowlistBypassesVersion: false, allowlistBypassesEmergencyDisable: false,
  };
}

function optionalVersion(value) {
  const version = String(value ?? "").trim();
  if (!version) return null;
  if (!/^\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw validation("App versions must use a numeric semantic form such as 1.4.0 or 1.4.0-beta.1.");
  return version;
}

function compareVersions(left, right) {
  const a = parseVersion(left); const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
  if (a.pre === b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  return a.pre.localeCompare(b.pre, undefined, { numeric: true });
}

function parseVersion(value) {
  const [core, pre = ""] = value.split("-", 2);
  const numbers = core.split(".").map(Number); while (numbers.length < 3) numbers.push(0);
  return { core: numbers, pre };
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function validation(message) { return new FeatureFlagError("VALIDATION_ERROR", message); }
function conflict() { return new FeatureFlagError("CONFLICT", "The flag changed since it was loaded. Refresh before saving.", 409); }
