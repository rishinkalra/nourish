import assert from "node:assert/strict";
import test from "node:test";
import {
  createStructuredTelemetry,
  normalizeCorrelationID,
  routeTemplate,
} from "../src/observability.mjs";
import { LeasedJobWorker, MemoryJobQueue } from "../src/job-queue.mjs";

test("API telemetry is structured, route-templated, and privacy-minimized", () => {
  const lines = [];
  const telemetry = createStructuredTelemetry({
    service: "nourish-api",
    environment: "test",
    now: () => new Date("2026-07-25T10:00:00.000Z"),
    destination: { write: (line) => lines.push(line) },
  });
  telemetry.recordAPIRequest({
    method: "POST",
    route: "/v1/plans/6bdc2b83-27b6-47fd-a345-6bdce0fa6ec9/adopt",
    statusCode: 503,
    durationMilliseconds: 125.6,
    correlationID: "78afca84-f50d-46d7-b11f-da7bbbc28fa1",
    errorCode: "TEMPORARY_FAILURE",
    retryable: true,
    email: "must-not-appear@example.test",
    token: "must-not-appear",
  });
  const record = JSON.parse(lines[0]);
  assert.deepEqual(record, {
    timestamp: "2026-07-25T10:00:00.000Z",
    service: "nourish-api",
    environment: "test",
    event: "api_request_completed",
    level: "error",
    method: "POST",
    route: "/v1/plans/:id/adopt",
    status_code: 503,
    duration_ms: 126,
    correlation_id: "78afca84-f50d-46d7-b11f-da7bbbc28fa1",
    error_code: "TEMPORARY_FAILURE",
    retryable: true,
  });
  assert.doesNotMatch(lines[0], /example\.test|must-not-appear|6bdc2b83/);
});

test("worker telemetry exposes queue and execution evidence without job payloads", () => {
  const lines = [];
  const telemetry = createStructuredTelemetry({
    service: "nourish-worker",
    destination: { write: (line) => lines.push(line) },
  });
  telemetry.recordJobRun({
    jobID: "job-1",
    jobType: "account.export",
    state: "dead",
    attemptCount: 8,
    queueDelayMilliseconds: 400,
    durationMilliseconds: 90,
    correlationID: "78411aa4-ae60-478e-9c68-62b1bdb890c2",
    errorCode: "PRIVATE_STORAGE_UNAVAILABLE",
    payload: { verifiedEmail: "private@example.test" },
  });
  const record = JSON.parse(lines[0]);
  assert.equal(record.event, "worker_job_completed");
  assert.equal(record.level, "error");
  assert.equal(record.job_type, "account.export");
  assert.equal(record.queue_delay_ms, 400);
  assert.equal(record.duration_ms, 90);
  assert.equal(record.error_code, "PRIVATE_STORAGE_UNAVAILABLE");
  assert.doesNotMatch(lines[0], /private@example\.test|payload|verifiedEmail/);
});

test("unsafe correlation values and unmatched paths are never reflected", () => {
  assert.equal(
    normalizeCorrelationID("78afca84-f50d-46d7-b11f-da7bbbc28fa1", "fallback"),
    "78afca84-f50d-46d7-b11f-da7bbbc28fa1",
  );
  assert.equal(normalizeCorrelationID("safe.request-1", "fallback"), "fallback");
  assert.equal(normalizeCorrelationID("person@example.test", "fallback"), "fallback");
  assert.equal(routeTemplate("/v1/profile"), "/v1/profile");
  assert.equal(
    routeTemplate("/admin/v1/recipe-generations/715cf4f1-8c81-5ab6-bb75-e5c89efeb582/image"),
    "/admin/v1/recipe-generations/:id/image",
  );
  assert.equal(routeTemplate("/v1/unknown/person@example.test"), "unmatched");
});

test("leased jobs emit one correlated terminal telemetry record", async () => {
  let now = new Date("2026-07-25T10:00:00.000Z");
  const records = [];
  const queue = new MemoryJobQueue({ now: () => now });
  await queue.enqueue({
    type: "account.export",
    idempotencyKey: "export-1",
    payload: {
      requestID: "request-1",
      correlationID: "3a4ef239-94c8-42a6-bd24-d7ccf90201a2",
    },
  });
  now = new Date(now.getTime() + 250);
  const worker = new LeasedJobWorker({
    queue,
    workerID: "worker-1",
    now: () => now,
    telemetry: { recordJobRun: (record) => records.push(record) },
    handlers: {
      "account.export": async () => {
        now = new Date(now.getTime() + 50);
        return { status: "ready" };
      },
    },
  });
  assert.equal((await worker.runOnce()).state, "succeeded");
  assert.equal(records.length, 1);
  assert.equal(records[0].correlationID, "3a4ef239-94c8-42a6-bd24-d7ccf90201a2");
  assert.equal(records[0].queueDelayMilliseconds, 250);
  assert.equal(records[0].durationMilliseconds, 50);
});
