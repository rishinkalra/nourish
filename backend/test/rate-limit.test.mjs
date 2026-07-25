import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MemoryRateLimitService,
  PostgresRateLimitService,
  RateLimitError,
  privateIdentifier,
} from "../src/rate-limit-service.mjs";
import { createNourishServer, requestSourceAddress } from "../src/server.mjs";

const secret = "test-rate-limit-secret-that-is-long-enough";
const fixedNow = new Date("2026-07-25T10:00:00.000Z");

test("memory rate limits reset on schedule and provide a bounded retry interval", async () => {
  let now = fixedNow;
  const limiter = new MemoryRateLimitService({ secret, now: () => now });
  const policy = { scope: "auth.test", identifier: "person@example.test", limit: 2, windowSeconds: 60 };
  assert.equal((await limiter.consume(policy)).remaining, 1);
  assert.equal((await limiter.consume(policy)).remaining, 0);
  await assert.rejects(
    () => limiter.consume(policy),
    (error) => error instanceof RateLimitError && error.retryAfterSeconds === 60,
  );
  now = new Date(fixedNow.getTime() + 60_000);
  assert.equal((await limiter.consume(policy)).remaining, 1);
});

test("PostgreSQL counters receive only a keyed digest, never a raw identifier", async () => {
  const calls = [];
  const pool = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      return { rows: [{ request_count: 1, expires_at: new Date(fixedNow.getTime() + 60_000) }] };
    },
  };
  const limiter = new PostgresRateLimitService({ pool, secret, now: () => fixedNow });
  await limiter.consume({
    scope: "auth.magic_link.identity.hour",
    identifier: "private@example.test",
    limit: 5,
    windowSeconds: 60,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].parameters.includes("private@example.test"), false);
  assert.equal(calls[0].parameters[1], privateIdentifier(secret, "auth.magic_link.identity.hour", "private@example.test"));
  assert.match(calls[0].sql, /ON CONFLICT/);
});

test("HTTP auth throttling returns a safe 429 contract and Retry-After", async (context) => {
  const authService = {
    async requestMagicLink() {
      return { requestID: "test-request", resendAvailableAt: fixedNow.toISOString() };
    },
  };
  const app = createNourishServer({
    authService,
    rateLimitService: new MemoryRateLimitService({ secret, now: () => fixedNow }),
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => app.server.close(resolve)));
  const url = `http://127.0.0.1:${app.server.address().port}/v1/auth/magic-link`;
  const accepted = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "person@example.test" }),
  });
  assert.equal(accepted.status, 202);
  const blocked = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "person@example.test" }),
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "60");
  const body = await blocked.json();
  assert.deepEqual(
    { code: body.code, retryable: body.retryable, retryAfterSeconds: body.retryAfterSeconds },
    { code: "RATE_LIMITED", retryable: true, retryAfterSeconds: 60 },
  );
  assert.equal(JSON.stringify(body).includes("person@example.test"), false);
});

test("forwarded addresses are trusted only when deployment configuration enables it", () => {
  const request = {
    headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.2" },
    socket: { remoteAddress: "::ffff:127.0.0.1" },
  };
  assert.equal(requestSourceAddress(request), "127.0.0.1");
  assert.equal(requestSourceAddress(request, { trustProxy: true }), "203.0.113.9");
});

test("rate-limit migration stores privacy-safe bounded counters", async () => {
  const migration = await readFile(new URL("../migrations/024_distributed_rate_limits.sql", import.meta.url), "utf8");
  assert.match(migration, /key_hmac_sha256 CHAR\(64\)/);
  assert.match(migration, /PRIMARY KEY \(scope, key_hmac_sha256\)/);
  assert.doesNotMatch(migration, /\bemail\b|\bip_address\b/i);
});
