import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { cleanupExpiredExportObjects } from "../src/export-retention.mjs";
import { MemoryPrivateObjectStore } from "../src/private-object-store.mjs";
import { migrationBody } from "../src/migrations.mjs";

const now = new Date("2026-07-16T10:00:00.000Z");
const adminID = "11111111-1111-4111-8111-111111111111";
const accountID = "22222222-2222-4222-8222-222222222222";
const subjectHash = "a".repeat(64);
const adminKey = `admin-exports/${adminID}/export.csv`;
const accountKey = `account-exports/${subjectHash}/${accountID}.json`;

test("expired customer and administrator exports are physically deleted and audited", async () => {
  const calls = [];
  const client = transactionClient(calls, {
    adminUpdate: [{ export_type: "support_account", data_scope: "user" }],
    accountUpdate: [{ id: accountID }],
  });
  const pool = {
    async query(text, values) {
      calls.push({ scope: "pool", text, values });
      if (text.includes("FROM admin_export_requests")) return { rows: [{ id: adminID, object_key: adminKey }] };
      if (text.includes("FROM account_export_requests")) return { rows: [{ id: accountID, object_key: accountKey }] };
      return { rows: [] };
    },
    async connect() { return client; },
  };
  const store = new MemoryPrivateObjectStore();
  await store.putText({ key: adminKey, value: "private admin csv" });
  await store.putText({ key: accountKey, value: "private customer json" });

  const result = await cleanupExpiredExportObjects({ pool, objectStore: store, now: () => now });

  assert.deepEqual(result, { selected: 2, physicallyDeleted: 2, failed: 0, raced: 0 });
  assert.equal(store.objects.has(adminKey), false);
  assert.equal(store.objects.has(accountKey), false);
  const auditActions = calls
    .filter((call) => call.text?.includes("INSERT INTO admin_export_audit_logs") || call.text?.includes("INSERT INTO account_export_retention_audit_logs"))
    .map((call) => call.values[call.text.includes("admin_export") ? 5 : 3]);
  assert.deepEqual(auditActions, ["physically_deleted", "physically_deleted"]);
  assert.equal(calls.some((call) => call.text?.includes("object_key = NULL")), true);
  assert.equal(calls.filter((call) => call.text === "COMMIT").length, 2);
  assert.equal(calls.some((call) => JSON.stringify(call.values ?? []).includes("private customer json")), false);
});

test("retention rejects a corrupt object key without touching private storage", async () => {
  const corruptKey = `admin-exports/${adminID}/../../outside.csv`;
  const calls = [];
  const client = transactionClient(calls, {
    adminFailure: [{ export_type: "kpis", data_scope: "aggregate" }],
  });
  const pool = {
    async query(text, values) {
      calls.push({ scope: "pool", text, values });
      if (text.includes("FROM admin_export_requests")) return { rows: [{ id: adminID, object_key: corruptKey }] };
      return { rows: [] };
    },
    async connect() { return client; },
  };
  const deleted = [];
  const objectStore = { async deleteObject(key) { deleted.push(key); } };

  const result = await cleanupExpiredExportObjects({ pool, objectStore, now: () => now });

  assert.deepEqual(result, { selected: 1, physicallyDeleted: 0, failed: 1, raced: 0 });
  assert.deepEqual(deleted, []);
  const failureUpdate = calls.find((call) => call.text?.includes("last_purge_failure_code") && call.text?.includes("admin_export_requests"));
  assert.equal(failureUpdate.values[1], "INVALID_OBJECT_KEY");
  const audit = calls.find((call) => call.text?.includes("INSERT INTO admin_export_audit_logs"));
  assert.equal(audit.values[5], "cleanup_failed");
  assert.equal(audit.values.includes(corruptKey), false);
});

test("temporary object-store deletion failure remains retryable and accountable", async () => {
  const calls = [];
  const client = transactionClient(calls, { accountFailure: [{ id: accountID }] });
  const pool = {
    async query(text, values) {
      calls.push({ scope: "pool", text, values });
      if (text.includes("FROM account_export_requests")) return { rows: [{ id: accountID, object_key: accountKey }] };
      return { rows: [] };
    },
    async connect() { return client; },
  };
  const objectStore = { async deleteObject() { throw new Error("storage unavailable"); } };

  const result = await cleanupExpiredExportObjects({ pool, objectStore, now: () => now });

  assert.deepEqual(result, { selected: 1, physicallyDeleted: 0, failed: 1, raced: 0 });
  const failureUpdate = calls.find((call) => call.text?.includes("last_purge_failure_code") && call.text?.includes("account_export_requests"));
  assert.equal(failureUpdate.values[1], "OBJECT_DELETE_FAILED");
  assert.equal(failureUpdate.values[2], accountKey);
  const audit = calls.find((call) => call.text?.includes("INSERT INTO account_export_retention_audit_logs"));
  assert.equal(audit.values[3], "cleanup_failed");
  assert.equal(audit.values[4], "OBJECT_DELETE_FAILED");
  assert.equal(audit.values.includes(accountKey), false);
});

test("retention migration makes physical deletion observable and append-only", async () => {
  const source = await readFile(new URL("../migrations/021_export_retention.sql", import.meta.url), "utf8");
  const body = migrationBody(source);
  assert.match(body, /physically_deleted_at/);
  assert.match(body, /ALTER COLUMN object_key DROP NOT NULL/);
  assert.match(body, /CREATE TABLE account_export_retention_audit_logs/);
  assert.match(body, /REFERENCES account_export_requests\(id\) ON DELETE SET NULL/);
  assert.match(body, /account_export_retention_audit_append_only/);
  assert.match(body, /physically_deleted.*cleanup_failed/s);
  assert.match(body, /WHERE object_key IS NOT NULL AND physically_deleted_at IS NULL/);
});

test("worker schedules export retention independently of product jobs", async () => {
  const source = await readFile(new URL("../src/worker-cli.mjs", import.meta.url), "utf8");
  assert.match(source, /cleanupExpiredExportObjects\(\{ pool, objectStore \}\)/);
  assert.match(source, /nextExportRetentionScanAt = Date\.now\(\) \+ 60_000/);
  assert.match(source, /export_retention_scan_failed/);
});

function transactionClient(calls, rows) {
  return {
    async query(text, values) {
      calls.push({ scope: "client", text, values });
      if (text.includes("UPDATE admin_export_requests") && text.includes("last_purge_failure_code = NULL")) return { rows: rows.adminUpdate ?? [] };
      if (text.includes("UPDATE account_export_requests") && text.includes("last_purge_failure_code = NULL")) return { rows: rows.accountUpdate ?? [] };
      if (text.includes("UPDATE admin_export_requests") && text.includes("last_purge_failure_code = $2")) return { rows: rows.adminFailure ?? [] };
      if (text.includes("UPDATE account_export_requests") && text.includes("last_purge_failure_code = $2")) return { rows: rows.accountFailure ?? [] };
      return { rows: [] };
    },
    release() { calls.push({ scope: "client", text: "RELEASE" }); },
  };
}
