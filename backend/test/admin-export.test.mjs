import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { AdminExportService, PostgresAdminExportService } from "../src/admin-export-service.mjs";
import { MemoryPrivateObjectStore } from "../src/private-object-store.mjs";
import { createNourishServer } from "../src/server.mjs";
import { migrationBody } from "../src/migrations.mjs";

const now = new Date("2026-07-16T08:00:00.000Z");
const operator = { id: "ops-1", roles: ["operator"] };
const securityAdmin = { id: "security-1", roles: ["operator", "security_admin"] };

function dependencies() {
  const analyticsService = {
    async kpis(filters) {
      return {
        filters: { ...filters, timeZone: filters.timeZone ?? "Asia/Kolkata" }, freshnessAt: now,
        metrics: [{ id: "activation_rate", label: "Activation", value: 0.5, format: "percentage", numerator: 5, denominator: 10, formula: "activated / registered", suppressed: false }],
      };
    },
    async cohorts(filters) {
      return {
        filters, tableColumns: [{ id: "cohort", label: "Cohort" }, { id: "adoptionRate", label: "Adoption" }],
        rows: [{ cohort: "2026-W27", adoptionRate: null, suppressed: true }],
      };
    },
  };
  const userSupportService = {
    calls: [],
    async lookup(input) {
      this.calls.push(structuredClone(input));
      return {
        identity: { userID: "internal-user-7", verifiedEmail: "person@example.test", status: "active", createdAt: now },
        account: { onboardingStatus: "complete", profileRevision: 4, activeSessionCount: 2 },
        subscription: { state: "active", hasAccess: true, productID: "nourish.monthly", periodEndsAt: now, reconciliationStatus: "current" },
        planning: { latestJobState: "succeeded", adoptedPlanCount: 3, latestAdoptionAt: now, latestWeeklyReviewAt: now },
        privacyRequests: { latestExport: null, latestDeletion: null },
        deliberatelyExcluded: { profileAnswers: "secret", refreshTokens: "secret" },
      };
    },
  };
  return { analyticsService, userSupportService };
}

test("authorized exports are idempotent, minimized, expiring, and audited", async () => {
  const deps = dependencies();
  const store = new MemoryPrivateObjectStore();
  const service = new AdminExportService({ ...deps, objectStore: store, now: () => now });
  const aggregate = await service.create({ exportType: "kpis", filters: { startDate: "2026-07-01" } }, {
    actor: operator, idempotencyKey: "aggregate-key-1", correlationID: "correlation-1",
  });
  const replay = await service.create({ exportType: "kpis" }, { actor: operator, idempotencyKey: "aggregate-key-1" });
  assert.equal(replay.id, aggregate.id);
  const aggregateCSV = await service.download(aggregate.id, { actor: operator, correlationID: "correlation-2" });
  assert.match(aggregateCSV.content, /activated \/ registered/);
  assert.match(aggregateCSV.content, /"activation_rate"/);

  await assert.rejects(
    () => service.create({ exportType: "support_account", verifiedEmail: "person@example.test", reason: "Investigating account access" }, { actor: operator, idempotencyKey: "support-key-1" }),
    (error) => error.status === 403,
  );
  const userExport = await service.create({
    exportType: "support_account", verifiedEmail: "person@example.test", reason: "Investigating verified account access",
  }, { actor: securityAdmin, idempotencyKey: "support-key-2", correlationID: "correlation-3" });
  assert.equal(userExport.dataScope, "user");
  assert.equal(userExport.subjectReference.length, 12);
  assert.equal("objectKey" in userExport, false);
  await assert.rejects(() => service.download(userExport.id, { actor: securityAdmin }), (error) => error.status === 400);
  const userCSV = await service.download(userExport.id, {
    actor: securityAdmin, reason: "Delivering to approved support case", correlationID: "correlation-4",
  });
  assert.match(userCSV.content, /person@example\.test/);
  assert.doesNotMatch(userCSV.content, /profileAnswers|refreshTokens|secret/);
  assert.deepEqual(service.auditLog().map((event) => event.action), ["created", "delivered", "created", "delivered"]);
  assert.equal(deps.userSupportService.calls[0].reason, "Investigating verified account access");
});

test("admin export endpoints return private CSV content with accountable headers", async (context) => {
  const deps = dependencies();
  const adminExportService = new AdminExportService({ ...deps, now: () => now });
  const app = createNourishServer({ ...deps, adminExportService, adminKey: "test-admin-key" });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => app.server.close(resolve)));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const headers = { "x-nourish-admin-key": "test-admin-key", "x-nourish-admin-id": "security-1" };
  const createdResponse = await fetch(`${base}/admin/v1/exports`, {
    method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": "http-export-key" },
    body: JSON.stringify({ exportType: "cohorts", filters: { timeZone: "Asia/Kolkata" } }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  const listResponse = await fetch(`${base}/admin/v1/exports`, { headers });
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).exports[0].id, created.id);
  const contentResponse = await fetch(`${base}/admin/v1/exports/${created.id}/content`, { headers });
  assert.equal(contentResponse.status, 200);
  assert.match(contentResponse.headers.get("content-type"), /^text\/csv/);
  assert.match(contentResponse.headers.get("content-disposition"), /^attachment;/);
  assert.equal(contentResponse.headers.get("cache-control"), "no-store");
  assert.match(await contentResponse.text(), /"suppressed"/);
});

test("admin export migration enforces reasoned user scope and append-only audit", async () => {
  const source = await readFile(new URL("../migrations/019_admin_exports.sql", import.meta.url), "utf8");
  const body = migrationBody(source);
  assert.match(body, /CREATE TABLE admin_export_requests/);
  assert.match(body, /data_scope <> 'user'.*length\(trim\(reason\)\) BETWEEN 12 AND 500/s);
  assert.match(body, /admin_export_audit_append_only/);
  assert.match(body, /BEFORE UPDATE OR DELETE ON admin_export_audit_logs/);
});

test("PostgreSQL admin exports persist request and audit in one transaction after private storage", async () => {
  const calls = []; const client = {
    async query(text, values) { calls.push({ scope: "client", text, values }); return { rows: [] }; },
    release() { calls.push({ scope: "release" }); },
  };
  const pool = {
    async query(text, values) { calls.push({ scope: "pool", text, values }); return { rows: [] }; },
    async connect() { calls.push({ scope: "connect" }); return client; },
  };
  const store = new MemoryPrivateObjectStore(); const deps = dependencies();
  const service = new PostgresAdminExportService({ pool, ...deps, objectStore: store, now: () => now });
  const created = await service.create({ exportType: "kpis", filters: { timeZone: "Asia/Kolkata" } }, {
    actor: operator, idempotencyKey: "postgres-export-key", correlationID: "postgres-correlation",
  });
  assert.equal(created.status, "ready");
  assert.equal(created.rowCount, 1);
  assert.equal("objectKey" in created, false);
  assert.match(await store.getText(`admin-exports/${created.id}/export.csv`), /activated \/ registered/);
  assert.equal(calls.filter((call) => /INSERT INTO admin_export_requests/.test(call.text || "")).length, 1);
  assert.equal(calls.filter((call) => /INSERT INTO admin_export_audit_logs/.test(call.text || "")).length, 1);
  assert.equal(calls.filter((call) => call.text === "BEGIN").length, 1);
  assert.equal(calls.filter((call) => call.text === "COMMIT").length, 1);
  assert.equal(calls.filter((call) => call.scope === "release").length, 1);
});
