import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import test from "node:test";
import {
  AnalyticsEventService,
  PostgresAnalyticsEventService,
  analyticsEventCatalogue,
  deleteExpiredAnalyticsEvents,
} from "../src/analytics-event-service.mjs";
import { AuthService, MemoryMagicLinkDelivery } from "../src/auth-service.mjs";
import { AccountService, MemoryAccountStore } from "../src/account-service.mjs";
import { createNourishServer } from "../src/server.mjs";
import { migrationBody } from "../src/migrations.mjs";

const now = new Date("2026-07-16T12:00:00.000Z");

test("the versioned catalogue covers all 26 PRD events with strict authority and properties", async () => {
  assert.equal(Object.keys(analyticsEventCatalogue).length, 26);
  const service = new AnalyticsEventService({ now: () => now, retentionDays: 30 });
  const input = {
    userID: "user-1",
    eventID: "11111111-1111-4111-8111-111111111111",
    eventName: "app_opened",
    schemaVersion: "1",
    occurredAt: now,
    properties: { source: "foreground", app_version: "1.0", days_since_signup: 3 },
  };
  await assert.rejects(() => service.recordClientEvent(input), (error) => error.status === 403);
  const consent = await service.setConsent({ userID: "user-1", enabled: true });
  assert.equal(consent.enabled, true);
  assert.equal(consent.contractVersion, "analytics-consent-v1");
  const accepted = await service.recordClientEvent(input);
  const replay = await service.recordClientEvent(input);
  assert.equal(accepted.replay, false);
  assert.equal(replay.eventID, accepted.eventID);
  assert.equal(replay.replay, true);
  assert.equal(accepted.retentionExpiresAt.toISOString(), "2026-08-15T12:00:00.000Z");
  assert.equal(service.events[0].dedupeSHA256.length, 64);
  assert.equal("eventID" in service.events[0].properties, false);

  await assert.rejects(
    () => service.recordClientEvent({
      ...input, eventID: "22222222-2222-4222-8222-222222222222",
      eventName: "purchase_completed", properties: { product_id: "nourish.monthly", offer_type: "standard" },
    }),
    (error) => error.status === 403,
  );
  await assert.rejects(
    () => service.recordClientEvent({
      ...input, eventID: "33333333-3333-4333-8333-333333333333",
      properties: { ...input.properties, email: "person@example.test" },
    }),
    (error) => error.code === "VALIDATION_ERROR",
  );
  await assert.rejects(
    () => service.recordClientEvent({
      ...input, eventID: "44444444-4444-4444-8444-444444444444",
      properties: { ...input.properties, source: "free text is rejected" },
    }),
    (error) => error.code === "VALIDATION_ERROR",
  );
});

test("authenticated event ingestion derives identity and server actions cannot be forged", async () => {
  const delivery = new MemoryMagicLinkDelivery();
  const authService = new AuthService({ delivery, now: () => now });
  const analyticsEventService = new AnalyticsEventService({ now: () => now });
  let feedbackSequence = 0;
  const feedbackService = {
    async submit() {
      feedbackSequence += 1;
      return { id: `feedback-${feedbackSequence}`, status: "recorded", submittedAt: now };
    },
  };
  const app = createNourishServer({ authService, analyticsEventService, feedbackService });
  await authService.requestMagicLink("events@example.test");
  const session = await authService.completeMagicLink(delivery.latest().token);
  const headers = { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" };

  const eventBody = {
    userID: "forged-user",
    eventID: "55555555-5555-4555-8555-555555555555",
    eventName: "grocery_list_opened",
    schemaVersion: "1",
    occurredAt: now,
    properties: { item_count: 12, checked_count: 4 },
  };
  const disabled = await requestJSON(app.server, "/v1/analytics/events", {
    method: "POST", headers,
    body: JSON.stringify(eventBody),
  });
  assert.equal(disabled.status, 403);

  const consentResponse = await requestJSON(app.server, "/v1/analytics/consent", {
    method: "PATCH", headers, body: JSON.stringify({ enabled: true, userID: "forged-user" }),
  });
  assert.equal(consentResponse.status, 200);
  assert.deepEqual(await consentResponse.json(), {
    enabled: true,
    updatedAt: now.toISOString(),
    contractVersion: "analytics-consent-v1",
  });

  const response = await requestJSON(app.server, "/v1/analytics/events", {
    method: "POST", headers, body: JSON.stringify(eventBody),
  });
  assert.equal(response.status, 202);
  const receipt = await response.json();
  assert.equal(receipt.contractVersion, "analytics-events-v1");
  assert.equal("userID" in receipt, false);
  assert.equal(analyticsEventService.events[0].userID, session.identity.userID);

  const forgedRevenue = await requestJSON(app.server, "/v1/analytics/events", {
    method: "POST", headers,
    body: JSON.stringify({
      eventID: "66666666-6666-4666-8666-666666666666",
      eventName: "purchase_completed",
      properties: { product_id: "nourish.monthly", offer_type: "trial" },
    }),
  });
  assert.equal(forgedRevenue.status, 403);

  const mealFeedback = await requestJSON(app.server, "/v1/feedback", {
    method: "POST", headers,
    body: JSON.stringify({
      subjectType: "meal", planItemID: "item-1", recipeID: "recipe-1",
      rating: 4, reasonTags: ["taste", "effort", "taste"], note: "never copied to analytics",
    }),
  });
  assert.equal(mealFeedback.status, 201);
  const mealFeedbackEvent = analyticsEventService.events.find((event) => event.eventName === "recipe_feedback_submitted");
  assert.deepEqual(mealFeedbackEvent.properties, { rating: 4, reason_tags: ["taste", "effort"] });

  const weeklyReview = await requestJSON(app.server, "/v1/feedback", {
    method: "POST", headers,
    body: JSON.stringify({
      subjectType: "weeklyReview", planID: "plan-1", completionRate: 0.75,
      changesRequested: ["moreVariety", "lessEffort", "moreVariety"],
    }),
  });
  assert.equal(weeklyReview.status, 201);
  const weeklyReviewEvent = analyticsEventService.events.find((event) => event.eventName === "weekly_review_completed");
  assert.deepEqual(weeklyReviewEvent.properties, {
    completion_rate: 0.75, changes_requested: ["moreVariety", "lessEffort"],
  });

  const exported = await requestJSON(app.server, "/v1/account/export", {
    method: "POST", headers: { ...headers, "idempotency-key": "event-export-key" },
  });
  assert.equal(exported.status, 202);
  assert.equal(analyticsEventService.events.some((event) => (
    event.eventName === "account_export_requested"
      && event.eventSource === "server"
      && event.userID === session.identity.userID
  )), true);
});

test("authoritative product outcomes emit the remaining bounded server events", async () => {
  const delivery = new MemoryMagicLinkDelivery();
  const authService = new AuthService({ delivery, now: () => now });
  const analyticsEventService = new AnalyticsEventService({ now: () => now });
  const sourceItem = {
    id: "item-1", slot: "dinner", recipeSnapshot: { recipeID: "recipe-old" },
  };
  const active = {
    plan: { id: "plan-1", days: [{ items: [sourceItem] }] },
    groceryList: {
      id: "grocery-1", revision: 1,
      items: [{ id: "grocery-item-1", category: "vegetables" }],
    },
  };
  const planResult = {
    job: {
      id: "job-analytics-1", state: "succeeded", createdAt: new Date(Date.now() - 500), error: null,
    },
    plan: { id: "plan-generated", days: [{ items: [sourceItem] }] },
    diagnostics: { meanAbsoluteDailyCalorieDeviation: 42, candidatePoolSize: 18 },
  };
  const planService = {
    async create() { return { ...planResult.job, planID: planResult.plan.id, generatorVersion: "deterministic-planner-v1" }; },
    async read(id) {
      if (id === "job-failed") {
        return {
          job: {
            id, state: "rejected", createdAt: new Date(Date.now() - 250),
            error: { code: "CONTENT_INSUFFICIENT", retryable: false },
          },
          plan: null,
          diagnostics: { candidatePoolSize: 0 },
        };
      }
      return structuredClone(planResult);
    },
  };
  const weeklyLoopService = {
    async readActive() { return structuredClone(active); },
    async swapCandidates() {
      return [{
        recipe: { recipeID: "recipe-new" }, calorieDelta: -55.5, proteinDeltaGrams: 6.25,
      }];
    },
    async applySwap() { return { plan: { id: "plan-2" }, revision: 1 }; },
    async readGroceryList() { return structuredClone(active.groceryList); },
    async updateGroceryList() { return { ...structuredClone(active.groceryList), revision: 2 }; },
    async updateMealStatus({ itemID, state }) { return { itemID, state, revision: 1, updatedAt: now }; },
  };
  const accountService = {
    async readEntitlement() { return { state: "unknown", productID: null }; },
    async bindVerifiedAppStoreTransaction() {
      return { state: "trial", productID: "nourish.monthly", hasAccess: true };
    },
    async recordVerifiedAppStoreNotification() {
      return {
        status: "applied", replay: false, userID: null, previousState: "trial",
        entitlement: { state: "active", productID: "nourish.monthly", hasAccess: true },
      };
    },
  };
  const appStoreServerClient = {
    async verifyTransaction() {
      return {
        eventID: "transaction-event-1", transactionID: "transaction-1",
        originalTransactionID: "original-1", notificationType: "INITIAL_TRANSACTION_BINDING",
        productID: "nourish.monthly", state: "trial", offerType: "free_trial",
        trialPeriod: "free_trial", purchasedAt: now,
      };
    },
    async verifyNotification() {
      return {
        eventID: "notification-event-1", notificationType: "DID_RENEW",
        productID: "nourish.monthly", state: "active",
      };
    },
  };
  const app = createNourishServer({
    authService, analyticsEventService, planService, weeklyLoopService, accountService, appStoreServerClient,
    planOperationsService: {}, subscriptionOperationsService: {},
    profileService: { async read() { return { revision: 1, profile: { dietType: "omnivore" } }; } },
    feedbackService: { async submit() { return { id: "unused" }; } },
  });
  await authService.requestMagicLink("outcomes@example.test");
  const session = await authService.completeMagicLink(delivery.latest().token);
  const userID = session.identity.userID;
  accountService.recordVerifiedAppStoreNotification = async () => ({
    status: "applied", replay: false, userID, previousState: "trial",
    entitlement: { state: "active", productID: "nourish.monthly", hasAccess: true },
  });
  await analyticsEventService.setConsent({ userID, enabled: true });
  const headers = { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" };

  assert.equal((await requestJSON(app.server, "/v1/plans", {
    method: "POST", headers: { ...headers, "idempotency-key": "plan-outcome-key" },
    body: JSON.stringify({ weekStartLocalDate: "2026-07-20", trigger: "initial" }),
  })).status, 202);
  assert.equal((await requestJSON(app.server, "/v1/plans/job-failed", { headers })).status, 200);
  assert.equal((await requestJSON(app.server, "/v1/plan-items/item-1/swap", {
    method: "POST", headers: { ...headers, "idempotency-key": "swap-outcome-key" },
    body: JSON.stringify({ replacementRecipeID: "recipe-new" }),
  })).status, 200);
  assert.equal((await requestJSON(app.server, "/v1/grocery-lists/grocery-1", {
    method: "PATCH", headers,
    body: JSON.stringify({
      expectedRevision: 1,
      changes: [{ itemID: "grocery-item-1", disposition: "checked", userAdjustedGrams: 350 }],
    }),
  })).status, 200);
  assert.equal((await requestJSON(app.server, "/v1/plan-items/item-1/status", {
    method: "PATCH", headers,
    body: JSON.stringify({ state: "completed", expectedRevision: 0 }),
  })).status, 200);
  assert.equal((await requestJSON(app.server, "/v1/entitlement/transactions", {
    method: "POST", headers, body: JSON.stringify({ signedTransactionInfo: "verified-jws" }),
  })).status, 200);
  assert.equal((await requestJSON(app.server, "/v1/app-store/notifications/v2", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ signedPayload: "verified-notification-jws" }),
  })).status, 204);

  const named = (name) => analyticsEventService.events.filter((event) => event.eventName === name);
  const succeeded = named("plan_generation_succeeded")[0].properties;
  assert.equal(succeeded.calorie_deviation, 42);
  assert.equal(succeeded.recipe_count, 1);
  assert.ok(succeeded.latency_ms >= 400 && succeeded.latency_ms < 5_000);
  assert.deepEqual(named("plan_generation_failed")[0].properties, {
    error_code: "CONTENT_INSUFFICIENT", retryable: false, candidate_pool_size: 0,
  });
  assert.deepEqual(named("meal_swapped")[0].properties, {
    from_recipe: "recipe-old", to_recipe: "recipe-new", calorie_delta: -55.5, protein_delta: 6.25,
  });
  assert.deepEqual(named("meal_status_changed")[0].properties, {
    status: "completed", slot: "dinner", day_index: 0,
  });
  assert.deepEqual(named("grocery_item_changed").map((event) => event.properties.action), [
    "disposition_checked", "quantity_updated",
  ]);
  assert.deepEqual(named("trial_started")[0].properties, {
    product_id: "nourish.monthly", period: "free_trial",
  });
  assert.deepEqual(named("purchase_completed")[0].properties, {
    product_id: "nourish.monthly", offer_type: "free_trial",
  });
  assert.deepEqual(named("subscription_state_changed").map((event) => event.properties), [
    { from_state: "unknown", to_state: "trial", notification_type: "INITIAL_TRANSACTION_BINDING" },
    { from_state: "trial", to_state: "active", notification_type: "DID_RENEW" },
  ]);
});

test("verified Apple transitions emit purchase, trial, and lifecycle events inside the entitlement boundary", async () => {
  const userID = "verified-analytics-user";
  const analyticsEventService = new AnalyticsEventService({ now: () => now });
  await analyticsEventService.setConsent({ userID, enabled: true });
  const accounts = new AccountService({
    store: new MemoryAccountStore(), analyticsEventService, now: () => now,
  });
  const issued = await accounts.issueAppAccountToken(userID);
  await accounts.recordVerifiedAppStoreEvent(userID, {
    verified: true, source: "app_store_transaction", eventID: "verified-transaction-event",
    notificationType: "INITIAL_TRANSACTION_BINDING", state: "trial", productID: "nourish.monthly",
    environment: "sandbox", originalTransactionID: "original-verified-1", transactionID: "transaction-verified-1",
    appAccountToken: issued.appAccountToken, signedPayloadSHA256: "a".repeat(64),
    offerType: "free_trial", trialPeriod: "free_trial", purchasedAt: now,
  });
  await accounts.recordVerifiedAppStoreNotification({
    verified: true, actionable: true, source: "app_store_server_notification_v2",
    eventID: "verified-renewal-event", notificationType: "DID_RENEW", state: "active",
    productID: "nourish.monthly", environment: "sandbox",
    originalTransactionID: "original-verified-1", transactionID: "transaction-verified-2",
    appAccountToken: issued.appAccountToken, signedPayloadSHA256: "b".repeat(64),
  });

  const named = (name) => analyticsEventService.events.filter((event) => event.eventName === name);
  assert.equal(named("purchase_completed").length, 1);
  assert.equal(named("trial_started").length, 1);
  assert.deepEqual(named("subscription_state_changed").map((event) => event.properties), [
    { from_state: "unknown", to_state: "trial", notification_type: "INITIAL_TRANSACTION_BINDING" },
    { from_state: "trial", to_state: "active", notification_type: "DID_RENEW" },
  ]);
});

test("PostgreSQL ingestion is parameterized, idempotent, minimized, and expiring", async () => {
  const calls = [];
  const row = {
    id: "77777777-7777-4777-8777-777777777777",
    event_name: "notification_opened", schema_version: "1",
    received_at: now, expires_at: new Date("2026-10-14T12:00:00.000Z"),
  };
  const pool = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("SELECT enabled FROM analytics_measurement_consents")) {
        return { rows: [{ enabled: true }] };
      }
      return { rows: [row] };
    },
  };
  const service = new PostgresAnalyticsEventService({ pool, now: () => now, retentionDays: 90 });
  const receipt = await service.recordClientEvent({
    userID: "real-user",
    eventID: "88888888-8888-4888-8888-888888888888",
    eventName: "notification_opened",
    properties: { template_id: "weekly_ready", destination: "week" },
  });
  assert.equal(receipt.eventName, "notification_opened");
  assert.deepEqual(calls[0].values, ["real-user"]);
  assert.equal(calls[1].values[1], "real-user");
  assert.equal(calls[1].values[5].length, 64);
  assert.deepEqual(JSON.parse(calls[1].values[9]), { template_id: "weekly_ready", destination: "week" });
  assert.match(calls[1].text, /ON CONFLICT \(user_id, event_name, dedupe_sha256\) DO NOTHING/);
  assert.doesNotMatch(calls[1].text, /verified_email|profile_json|meal_history|advertising|device_id/);

  const consentCalls = [];
  const consentPool = {
    async query(text, values) {
      consentCalls.push({ text, values });
      return { rows: [{ enabled: values[1], updated_at: values[2] }] };
    },
  };
  const consentService = new PostgresAnalyticsEventService({ pool: consentPool, now: () => now });
  const consent = await consentService.setConsent({ userID: "real-user", enabled: true });
  assert.equal(consent.enabled, true);
  assert.deepEqual(consentCalls[0].values, ["real-user", true, now]);
  assert.match(consentCalls[0].text, /ON CONFLICT \(user_id\) DO UPDATE/);
});

test("analytics event migration closes the catalogue and enforces privacy retention", async () => {
  const source = await readFile(new URL("../migrations/022_analytics_events.sql", import.meta.url), "utf8");
  const body = migrationBody(source);
  for (const name of Object.keys(analyticsEventCatalogue)) assert.match(body, new RegExp(`'${name}'`));
  assert.match(body, /CREATE TABLE analytics_measurement_consents/);
  assert.match(body, /enabled boolean NOT NULL DEFAULT false/);
  assert.match(body, /event_source = 'server' OR event_name IN/);
  assert.match(body, /ON DELETE CASCADE/);
  assert.match(body, /octet_length\(properties_json::text\) <= 4096/);
  assert.match(body, /analytics_events_retention_idx/);
  assert.doesNotMatch(body, /email|idfa|advertising_id|device_fingerprint/);
});

test("expired analytics rows are deleted in bounded parameterized batches", async () => {
  const calls = [];
  const pool = {
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [{ id: "event-1" }, { id: "event-2" }] };
    },
  };
  assert.deepEqual(await deleteExpiredAnalyticsEvents({ pool, now: () => now, batchSize: 500 }), { deleted: 2 });
  assert.deepEqual(calls[0].values, [now, 500]);
  assert.match(calls[0].text, /DELETE FROM analytics_events/);
  assert.match(calls[0].text, /LIMIT \$2/);
});

function requestJSON(server, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(body ? [Buffer.from(body)] : []);
    Object.assign(request, { method, url: path, headers });
    const responseHeaders = {};
    const response = {
      statusCode: 200,
      setHeader(name, value) { responseHeaders[name.toLowerCase()] = value; },
      end(data = "") {
        const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        resolve({
          status: this.statusCode,
          headers: responseHeaders,
          json: async () => JSON.parse(text),
        });
      },
    };
    request.on("error", reject);
    server.emit("request", request, response);
  });
}
