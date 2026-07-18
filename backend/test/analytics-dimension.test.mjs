import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AnalyticsOperationsService, PostgresAnalyticsOperationsService } from "../src/analytics-operations-service.mjs";
import { AuthService, MemoryMagicLinkDelivery } from "../src/auth-service.mjs";
import { migrationBody } from "../src/migrations.mjs";
import { createNourishServer } from "../src/server.mjs";

const now = new Date("2026-07-16T10:00:00.000Z");

test("analytics dimensions retain first version, advance latest version, and preserve first known acquisition", async () => {
  const service = new AnalyticsOperationsService({ now: () => now });
  const initial = await service.recordDimensions({ userID: "user-1", appVersion: "1.0", acquisitionSource: "unknown" });
  assert.equal(initial.firstAppVersion, "1.0");
  assert.equal(initial.latestAppVersion, "1.0");
  assert.equal(initial.acquisitionSource, "unknown");
  const attributed = await service.recordDimensions({ userID: "user-1", appVersion: "1.1.0", acquisitionSource: "referral" });
  assert.equal(attributed.firstAppVersion, "1.0");
  assert.equal(attributed.latestAppVersion, "1.1.0");
  assert.equal(attributed.acquisitionSource, "referral");
  const replay = await service.recordDimensions({ userID: "user-1", appVersion: "1.1.0", acquisitionSource: "paid_social" });
  assert.equal(replay.acquisitionSource, "referral");
  await assert.rejects(
    () => service.recordDimensions({ userID: "user-1", appVersion: "build-private", acquisitionSource: "fingerprint" }),
    (error) => error.code === "VALIDATION_ERROR",
  );
});

test("authenticated analytics-dimension endpoint derives user identity from the session", async (context) => {
  const delivery = new MemoryMagicLinkDelivery();
  const authService = new AuthService({ delivery, now: () => now });
  const analyticsOperationsService = new AnalyticsOperationsService({ now: () => now });
  const app = createNourishServer({ authService, analyticsOperationsService });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => app.server.close(resolve)));
  await authService.requestMagicLink("dimension@example.test");
  const session = await authService.completeMagicLink(delivery.latest().token);
  const response = await fetch(`http://127.0.0.1:${app.server.address().port}/v1/analytics/dimensions`, {
    method: "POST",
    headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ userID: "forged-user", appVersion: "1.0", acquisitionSource: "app_store_search" }),
  });
  assert.equal(response.status, 200);
  const receipt = await response.json();
  assert.equal(receipt.acquisitionSource, "app_store_search");
  assert.equal("userID" in receipt, false);
  assert.equal(analyticsOperationsService.dataset.dimensions[0].userID, session.identity.userID);
});

test("PostgreSQL analytics-dimension ingestion is parameterized and first-touch safe", async () => {
  const calls = [];
  const pool = {
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [{
        user_id: "user-1", first_app_version: "1.0", latest_app_version: "1.2.0",
        acquisition_source: "organic", first_seen_at: now, updated_at: now,
      }] };
    },
  };
  const service = new PostgresAnalyticsOperationsService({ pool, now: () => now });
  const receipt = await service.recordDimensions({ userID: "user-1", appVersion: "1.2.0", acquisitionSource: "paid_social" });
  assert.equal(receipt.firstAppVersion, "1.0");
  assert.equal(receipt.latestAppVersion, "1.2.0");
  assert.equal(receipt.acquisitionSource, "organic");
  assert.deepEqual(calls[0].values, ["user-1", "1.2.0", "paid_social", now]);
  assert.match(calls[0].text, /ON CONFLICT \(user_id\) DO UPDATE/);
  assert.match(calls[0].text, /acquisition_source = 'unknown'/);
  assert.doesNotMatch(calls[0].text, /verified_email|advertising|device_id|profile_json/);
});

test("analytics-dimension migration constrains semantic versions and bounded acquisition sources", async () => {
  const source = await readFile(new URL("../migrations/020_analytics_dimension_contract.sql", import.meta.url), "utf8");
  const body = migrationBody(source);
  assert.match(body, /user_analytics_dimensions_first_version_format/);
  assert.match(body, /app_store_search/);
  assert.match(body, /paid_social/);
  assert.doesNotMatch(body, /advertising_id|idfa|device_fingerprint/);
});
