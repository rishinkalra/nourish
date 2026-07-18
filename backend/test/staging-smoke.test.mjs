import assert from "node:assert/strict";
import test from "node:test";
import { StagingSmokeError, runStagingSmoke } from "../src/staging-smoke.mjs";

function response(body, overrides = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-correlation-id": "test-correlation",
    },
    ...overrides,
  });
}

test("staging smoke verifies liveness, durable readiness, and response safeguards", async () => {
  const paths = [];
  const result = await runStagingSmoke({
    baseURL: "https://staging.example.test/api/",
    fetchImpl: async (url) => {
      paths.push(url.pathname);
      return url.pathname.endsWith("healthz")
        ? response({ status: "ok" })
        : response({ status: "ready", dependency: { status: "ok", schema: { status: "current" } } });
    },
  });
  assert.deepEqual(paths, ["/api/healthz", "/api/readyz"]);
  assert.deepEqual(result.checks.map((check) => check.path), ["/healthz", "/readyz"]);
});

test("staging smoke fails when readiness does not confirm persistence", async () => {
  await assert.rejects(
    runStagingSmoke({
      baseURL: "https://staging.example.test",
      fetchImpl: async (url) => url.pathname === "/healthz"
        ? response({ status: "ok" })
        : response({ status: "ready", dependency: { status: "unknown" } }),
    }),
    (error) => error instanceof StagingSmokeError && error.message.includes("persistence dependency"),
  );
});

test("staging smoke rejects cacheable or uncorrelated responses", async () => {
  await assert.rejects(
    runStagingSmoke({
      baseURL: "https://staging.example.test",
      fetchImpl: async () => response({ status: "ok" }, { headers: { "content-type": "application/json" } }),
    }),
    (error) => error.message.includes("cache-control"),
  );
});

test("staging smoke rejects a reachable database with an unconfirmed schema", async () => {
  await assert.rejects(
    runStagingSmoke({
      baseURL: "https://staging.example.test",
      fetchImpl: async (url) => url.pathname === "/healthz"
        ? response({ status: "ok" })
        : response({ status: "ready", dependency: { status: "ok" } }),
    }),
    (error) => error.message.includes("release schema"),
  );
});
