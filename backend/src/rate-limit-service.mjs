import { createHmac } from "node:crypto";

export class RateLimitError extends Error {
  constructor(retryAfterSeconds) {
    super("Please wait before trying again.");
    this.name = "RateLimitError";
    this.code = "RATE_LIMITED";
    this.status = 429;
    this.retryable = true;
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

export class MemoryRateLimitService {
  constructor({ secret = "nourish-development-rate-limit-secret", now = () => new Date() } = {}) {
    this.secret = requireSecret(secret);
    this.now = now;
    this.counters = new Map();
  }

  async consume({ scope, identifier, limit, windowSeconds }) {
    const policy = validatePolicy({ scope, identifier, limit, windowSeconds });
    const now = this.now();
    const key = `${policy.scope}:${privateIdentifier(this.secret, policy.scope, policy.identifier)}`;
    let counter = this.counters.get(key);
    if (!counter || counter.expiresAt <= now) {
      counter = {
        count: 0,
        expiresAt: new Date(now.getTime() + policy.windowSeconds * 1_000),
      };
      this.counters.set(key, counter);
    }
    counter.count += 1;
    if (counter.count > policy.limit) {
      throw new RateLimitError((counter.expiresAt.getTime() - now.getTime()) / 1_000);
    }
    return {
      remaining: Math.max(0, policy.limit - counter.count),
      resetsAt: counter.expiresAt,
    };
  }
}

export class PostgresRateLimitService {
  constructor({ pool, secret, now = () => new Date() } = {}) {
    if (!pool?.query) throw new Error("A PostgreSQL pool is required.");
    this.pool = pool;
    this.secret = requireSecret(secret);
    this.now = now;
  }

  async consume({ scope, identifier, limit, windowSeconds }) {
    const policy = validatePolicy({ scope, identifier, limit, windowSeconds });
    const now = this.now();
    const keyHash = privateIdentifier(this.secret, policy.scope, policy.identifier);
    const result = await this.pool.query(
      `INSERT INTO api_rate_limit_counters (
          scope, key_hmac_sha256, request_count, window_started_at, expires_at
       ) VALUES (
         $1, $2, 1, $3::timestamptz,
         $3::timestamptz + ($4::integer * interval '1 second')
       )
       ON CONFLICT (scope, key_hmac_sha256) DO UPDATE
       SET request_count = CASE
             WHEN api_rate_limit_counters.expires_at <= EXCLUDED.window_started_at THEN 1
             ELSE LEAST(api_rate_limit_counters.request_count + 1, $5 + 1)
           END,
           window_started_at = CASE
             WHEN api_rate_limit_counters.expires_at <= EXCLUDED.window_started_at
               THEN EXCLUDED.window_started_at
             ELSE api_rate_limit_counters.window_started_at
           END,
           expires_at = CASE
             WHEN api_rate_limit_counters.expires_at <= EXCLUDED.window_started_at
               THEN EXCLUDED.expires_at
             ELSE api_rate_limit_counters.expires_at
           END
       RETURNING request_count, expires_at`,
      [policy.scope, keyHash, now, policy.windowSeconds, policy.limit],
    );
    const counter = result.rows[0];
    const count = Number(counter.request_count);
    const expiresAt = new Date(counter.expires_at);
    if (count > policy.limit) {
      throw new RateLimitError((expiresAt.getTime() - now.getTime()) / 1_000);
    }
    return { remaining: Math.max(0, policy.limit - count), resetsAt: expiresAt };
  }

  async deleteExpired({ limit = 500 } = {}) {
    return deleteExpiredRateLimitCounters({ pool: this.pool, now: this.now, limit });
  }
}

export async function deleteExpiredRateLimitCounters({
  pool, now = () => new Date(), limit = 500,
} = {}) {
  if (!pool?.query) throw new Error("A PostgreSQL pool is required.");
  const boundedLimit = Number.isSafeInteger(limit) && limit > 0 && limit <= 10_000 ? limit : 500;
  const result = await pool.query(
    `DELETE FROM api_rate_limit_counters
      WHERE ctid IN (
        SELECT ctid
          FROM api_rate_limit_counters
         WHERE expires_at <= $1
         ORDER BY expires_at
         LIMIT $2
      )`,
    [now(), boundedLimit],
  );
  return result.rowCount;
}

export function privateIdentifier(secret, scope, identifier) {
  return createHmac("sha256", requireSecret(secret))
    .update(`${String(scope)}\0${String(identifier)}`, "utf8")
    .digest("hex");
}

function requireSecret(secret) {
  if (typeof secret !== "string" || secret.length < 16) {
    throw new Error("Rate-limit secret must contain at least 16 characters.");
  }
  return secret;
}

function validatePolicy({ scope, identifier, limit, windowSeconds }) {
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(String(scope ?? ""))) {
    throw new Error("Rate-limit scope is invalid.");
  }
  if (typeof identifier !== "string" || !identifier || identifier.length > 1_000) {
    throw new Error("Rate-limit identifier is invalid.");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100_000) {
    throw new Error("Rate-limit maximum is invalid.");
  }
  if (!Number.isSafeInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 86_400) {
    throw new Error("Rate-limit window is invalid.");
  }
  return { scope, identifier, limit, windowSeconds };
}
