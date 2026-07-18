import { createHash, randomUUID } from "node:crypto";

const DAY_MILLISECONDS = 86_400_000;
const DEFAULT_RETENTION_DAYS = 90;
const clientEventNames = new Set([
  "app_opened",
  "onboarding_started",
  "eligibility_completed",
  "onboarding_step_completed",
  "onboarding_completed",
  "plan_preview_viewed",
  "meal_detail_viewed",
  "swap_list_viewed",
  "grocery_list_opened",
  "prep_plan_opened",
  "paywall_viewed",
  "notification_opened",
]);

const token = (maximumLength = 80) => ({ type: "token", maximumLength });
const integer = (minimum, maximum) => ({ type: "integer", minimum, maximum });
const number = (minimum, maximum) => ({ type: "number", minimum, maximum });
const boolean = () => ({ type: "boolean" });
const date = () => ({ type: "date" });
const tokens = (maximumItems = 10, maximumLength = 80) => ({ type: "tokens", maximumItems, maximumLength });

export const analyticsEventCatalogue = Object.freeze({
  app_opened: { source: "client", properties: { source: token(), app_version: token(), days_since_signup: integer(0, 36_500) } },
  onboarding_started: { source: "client", properties: { entry_point: token(), experiment_variant: { ...token(), optional: true } } },
  eligibility_completed: { source: "client", properties: { eligible: boolean(), reason_code: token() } },
  onboarding_step_completed: { source: "client", properties: { step_name: token(), duration_ms: integer(0, 3_600_000) } },
  onboarding_completed: { source: "client", properties: { diet_type: token(), target_source: token(), cooking_days_count: integer(0, 7) } },
  plan_generation_started: { source: "server", properties: { plan_week: date(), generator_version: token(), trigger: token() } },
  plan_generation_succeeded: { source: "server", properties: { latency_ms: integer(0, 3_600_000), calorie_deviation: number(-2_000, 2_000), recipe_count: integer(1, 100) } },
  plan_generation_failed: { source: "server", properties: { error_code: token(), retryable: boolean(), candidate_pool_size: integer(0, 100_000) } },
  plan_preview_viewed: { source: "client", properties: { days_visible: integer(1, 31), entitlement_state: token() } },
  plan_adopted: { source: "server", properties: { plan_id: token(120), plan_version: token() } },
  meal_detail_viewed: { source: "client", properties: { recipe_version_id: token(120), slot: token(), day_index: integer(0, 30) } },
  swap_list_viewed: { source: "client", properties: { candidate_count: integer(0, 1_000), original_recipe_id: token(120) } },
  meal_swapped: { source: "server", properties: { from_recipe: token(120), to_recipe: token(120), calorie_delta: number(-2_000, 2_000), protein_delta: number(-500, 500) } },
  meal_status_changed: { source: "server", properties: { status: token(), slot: token(), day_index: integer(0, 30) } },
  grocery_list_opened: { source: "client", properties: { item_count: integer(0, 10_000), checked_count: integer(0, 10_000) } },
  grocery_item_changed: { source: "server", properties: { action: token(), category: token() } },
  prep_plan_opened: { source: "client", properties: { task_count: integer(0, 1_000), active_minutes: integer(0, 10_080) } },
  recipe_feedback_submitted: { source: "server", properties: { rating: integer(1, 5), reason_tags: tokens(10) } },
  weekly_review_completed: { source: "server", properties: { completion_rate: number(0, 1), changes_requested: tokens(10) } },
  paywall_viewed: { source: "client", properties: { placement: token(), products: tokens(10), experiment_variant: { ...token(), optional: true } } },
  trial_started: { source: "server", properties: { product_id: token(120), period: token() } },
  purchase_completed: { source: "server", properties: { product_id: token(120), offer_type: token() } },
  subscription_state_changed: { source: "server", properties: { from_state: token(), to_state: token(), notification_type: token() } },
  notification_opened: { source: "client", properties: { template_id: token(), campaign_id: { ...token(), optional: true }, destination: token() } },
  account_export_requested: { source: "server", properties: { request_id: token(120) } },
  account_deletion_requested: { source: "server", properties: { reason_optional: boolean(), entitlement_state: token() } },
});

export class AnalyticsEventError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AnalyticsEventError";
    this.code = code;
    this.status = status;
  }
}

export class AnalyticsEventService {
  constructor({ now = () => new Date(), retentionDays = DEFAULT_RETENTION_DAYS } = {}) {
    this.now = now;
    this.retentionDays = normalizeRetentionDays(retentionDays);
    this.events = [];
    this.byDedupe = new Map();
    this.consents = new Map();
  }

  async setConsent({ userID, enabled }) {
    const normalizedUserID = requireUserID(userID);
    if (typeof enabled !== "boolean") throw validation("Analytics measurement consent must be true or false.");
    const receipt = { enabled, updatedAt: this.now(), contractVersion: "analytics-consent-v1" };
    this.consents.set(normalizedUserID, receipt);
    return structuredClone(receipt);
  }

  async recordClientEvent(input) {
    if (this.consents.get(requireUserID(input?.userID))?.enabled !== true) throw measurementDisabled();
    return this.#record(input, "client");
  }

  async recordServerEvent(input) {
    if (this.consents.get(requireUserID(input?.userID))?.enabled !== true) throw measurementDisabled();
    return this.#record(input, "server");
  }

  #record(input, source) {
    const normalized = normalizeEvent(input, source, this.now(), this.retentionDays);
    const dedupe = `${normalized.userID}:${normalized.eventName}:${normalized.dedupeSHA256}`;
    const existing = this.byDedupe.get(dedupe);
    if (existing) return receipt(existing, true);
    const event = { id: randomUUID(), ...normalized };
    this.events.push(event);
    this.byDedupe.set(dedupe, event);
    return receipt(event, false);
  }
}

export class PostgresAnalyticsEventService {
  constructor({ pool, now = () => new Date(), retentionDays = DEFAULT_RETENTION_DAYS } = {}) {
    if (!pool?.query) throw new Error("A PostgreSQL pool is required.");
    this.pool = pool;
    this.now = now;
    this.retentionDays = normalizeRetentionDays(retentionDays);
  }

  async setConsent({ userID, enabled }) {
    const normalizedUserID = requireUserID(userID);
    if (typeof enabled !== "boolean") throw validation("Analytics measurement consent must be true or false.");
    const updatedAt = this.now();
    const result = await this.pool.query(
      `INSERT INTO analytics_measurement_consents (user_id, enabled, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at
       RETURNING enabled, updated_at`,
      [normalizedUserID, enabled, updatedAt],
    );
    return {
      enabled: result.rows[0]?.enabled === true,
      updatedAt: new Date(result.rows[0]?.updated_at ?? updatedAt),
      contractVersion: "analytics-consent-v1",
    };
  }

  async recordClientEvent(input) {
    await this.#requireConsent(input?.userID);
    return this.#record(input, "client");
  }

  async recordServerEvent(input) {
    await this.#requireConsent(input?.userID);
    return this.#record(input, "server");
  }

  async #requireConsent(userID) {
    const normalizedUserID = requireUserID(userID);
    const result = await this.pool.query(
      "SELECT enabled FROM analytics_measurement_consents WHERE user_id = $1",
      [normalizedUserID],
    );
    if (result.rows[0]?.enabled !== true) throw measurementDisabled();
  }

  async #record(input, source) {
    const normalized = normalizeEvent(input, source, this.now(), this.retentionDays);
    const id = randomUUID();
    const inserted = await this.pool.query(
      `INSERT INTO analytics_events (
          id, user_id, event_name, event_source, schema_version, dedupe_sha256,
          occurred_at, received_at, expires_at, properties_json
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       ON CONFLICT (user_id, event_name, dedupe_sha256) DO NOTHING
       RETURNING id, event_name, schema_version, received_at, expires_at`,
      [
        id, normalized.userID, normalized.eventName, normalized.eventSource, normalized.schemaVersion,
        normalized.dedupeSHA256, normalized.occurredAt, normalized.receivedAt, normalized.expiresAt,
        JSON.stringify(normalized.properties),
      ],
    );
    if (inserted.rows[0]) return rowReceipt(inserted.rows[0], false);
    const replay = await this.pool.query(
      `SELECT id, event_name, schema_version, received_at, expires_at
         FROM analytics_events
        WHERE user_id = $1 AND event_name = $2 AND dedupe_sha256 = $3`,
      [normalized.userID, normalized.eventName, normalized.dedupeSHA256],
    );
    if (!replay.rows[0]) throw new AnalyticsEventError("TEMPORARY_FAILURE", "The analytics event could not be saved.", 503);
    return rowReceipt(replay.rows[0], true);
  }
}

export async function deleteExpiredAnalyticsEvents({ pool, now = () => new Date(), batchSize = 1_000 } = {}) {
  if (!pool?.query) throw new Error("A PostgreSQL pool is required.");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10_000) throw new Error("Analytics retention batch size is invalid.");
  const result = await pool.query(
    `WITH expired AS (
       SELECT id FROM analytics_events
        WHERE expires_at <= $1
        ORDER BY expires_at, id
        LIMIT $2
     )
     DELETE FROM analytics_events event
      USING expired
      WHERE event.id = expired.id
    RETURNING event.id`,
    [now(), batchSize],
  );
  return { deleted: result.rows.length };
}

function normalizeEvent(input = {}, source, receivedAt, retentionDays) {
  const userID = requireUserID(input.userID);
  const eventName = String(input.eventName ?? "");
  const definition = analyticsEventCatalogue[eventName];
  if (!definition) throw validation("Choose a supported analytics event.");
  if (source === "client" && !clientEventNames.has(eventName)) {
    throw new AnalyticsEventError("VALIDATION_ERROR", "This event can only be recorded by the Nourish service.", 403);
  }
  if (source === "server" && definition.source !== "server") {
    throw validation("Client-observed analytics events must use the authenticated ingestion route.");
  }
  const schemaVersion = String(input.schemaVersion ?? "1");
  if (schemaVersion !== "1") throw validation("The analytics event schema version is unsupported.");
  const occurredAt = input.occurredAt == null ? receivedAt : new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())
      || occurredAt > new Date(receivedAt.getTime() + 5 * 60_000)
      || occurredAt < new Date(receivedAt.getTime() - 7 * DAY_MILLISECONDS)) {
    throw validation("The analytics event time is outside the accepted window.");
  }
  const dedupeKey = String(input.dedupeKey ?? input.eventID ?? "").trim();
  if (dedupeKey.length < 8 || dedupeKey.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(dedupeKey)) {
    throw validation("The analytics event identifier is invalid.");
  }
  const properties = normalizeProperties(input.properties, definition.properties);
  return {
    userID, eventName, eventSource: source, schemaVersion,
    dedupeSHA256: createHash("sha256").update(dedupeKey).digest("hex"),
    occurredAt, receivedAt, expiresAt: new Date(receivedAt.getTime() + retentionDays * DAY_MILLISECONDS),
    properties,
  };
}

function normalizeProperties(value, schema) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw validation("Analytics event properties are required.");
  const keys = Object.keys(value);
  const allowed = new Set(Object.keys(schema));
  if (keys.some((key) => !allowed.has(key))) throw validation("The analytics event contains an unsupported property.");
  const result = {};
  for (const [key, descriptor] of Object.entries(schema)) {
    const property = value[key];
    if (property == null) {
      if (!descriptor.optional) throw validation(`The analytics property ${key} is required.`);
      continue;
    }
    result[key] = normalizeProperty(property, descriptor, key);
  }
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 4_096) throw validation("The analytics event is too large.");
  return result;
}

function normalizeProperty(value, descriptor, key) {
  if (descriptor.type === "boolean") {
    if (typeof value !== "boolean") throw invalidProperty(key);
    return value;
  }
  if (descriptor.type === "integer" || descriptor.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)
        || (descriptor.type === "integer" && !Number.isInteger(value))
        || value < descriptor.minimum || value > descriptor.maximum) throw invalidProperty(key);
    return value;
  }
  if (descriptor.type === "date") {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)
        || Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime())) throw invalidProperty(key);
    return value;
  }
  if (descriptor.type === "uuid") {
    if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw invalidProperty(key);
    return value.toLowerCase();
  }
  if (descriptor.type === "tokens") {
    if (!Array.isArray(value) || value.length > descriptor.maximumItems) throw invalidProperty(key);
    return value.map((item) => normalizeToken(item, descriptor.maximumLength, key));
  }
  return normalizeToken(value, descriptor.maximumLength, key);
}

function normalizeToken(value, maximumLength, key) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximumLength
      || !/^[A-Za-z0-9._:-]+$/.test(value)) throw invalidProperty(key);
  return value;
}

function invalidProperty(key) {
  return validation(`The analytics property ${key} is invalid.`);
}

function normalizeRetentionDays(value) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 400) throw new Error("Analytics retention days must be between 1 and 400.");
  return days;
}

function receipt(event, replay) {
  return {
    eventID: event.id, eventName: event.eventName, schemaVersion: event.schemaVersion,
    acceptedAt: event.receivedAt, retentionExpiresAt: event.expiresAt,
    replay, contractVersion: "analytics-events-v1",
  };
}

function rowReceipt(row, replay) {
  return {
    eventID: row.id, eventName: row.event_name, schemaVersion: row.schema_version,
    acceptedAt: new Date(row.received_at), retentionExpiresAt: new Date(row.expires_at),
    replay, contractVersion: "analytics-events-v1",
  };
}

function validation(message) {
  return new AnalyticsEventError("VALIDATION_ERROR", message);
}

function measurementDisabled() {
  return new AnalyticsEventError("VALIDATION_ERROR", "First-party product measurement is disabled for this account.", 403);
}

function requireUserID(value) {
  const userID = String(value ?? "").trim();
  if (!userID) throw new AnalyticsEventError("AUTHENTICATION_REQUIRED", "Please sign in again.", 401);
  return userID;
}
