import assert from "node:assert/strict";
import test from "node:test";
import { AccountService, MemoryAccountStore } from "../src/account-service.mjs";
import { AuthError, AuthService, MemoryAuthStore, MemoryMagicLinkDelivery } from "../src/auth-service.mjs";
import { CatalogueService, MemoryCatalogueStore } from "../src/catalogue-service.mjs";
import { PlannerService } from "../src/planner-service.mjs";
import { MemoryProfileStore, ProfileService } from "../src/profile-service.mjs";
import { createNourishServer } from "../src/server.mjs";
import { AdminAuthService, MemoryAdminIdentityVerifier } from "../src/admin-auth-service.mjs";
import { AnalyticsOperationsService } from "../src/analytics-operations-service.mjs";
import { UserSupportService } from "../src/user-support-service.mjs";
import { FeatureFlagService, stableBucket } from "../src/feature-flag-service.mjs";

const fixedNow = new Date("2026-07-13T12:00:00.000Z");

test("magic links are one-time and sessions rotate without storing raw tokens", async () => {
  const store = new MemoryAuthStore();
  const delivery = new MemoryMagicLinkDelivery();
  const auth = new AuthService({ store, delivery, now: () => fixedNow });

  const receipt = await auth.requestMagicLink(" RHEA@Example.Test ");
  assert.equal(receipt.requestID, delivery.latest().requestID);
  assert.equal(delivery.latest().email, "rhea@example.test");

  const first = await auth.completeMagicLink(delivery.latest().token);
  assert.equal(first.identity.verifiedEmail, "rhea@example.test");
  assert.equal(store.sessionByAccessHash.has(first.accessToken), false);
  assert.equal(store.sessionsByRefreshHash.has(first.refreshToken), false);

  await assert.rejects(() => auth.completeMagicLink(delivery.latest().token), AuthError);
  const rotated = await auth.refresh(first.refreshToken);
  assert.notEqual(rotated.accessToken, first.accessToken);
  await assert.rejects(() => auth.refresh(first.refreshToken), AuthError);

  await auth.revoke(rotated.accessToken);
  await assert.rejects(() => auth.authenticate(rotated.accessToken), AuthError);
});

test("profile revisions reject stale writes", async () => {
  const profiles = new ProfileService({ store: new MemoryProfileStore(), now: () => fixedNow });
  const request = { profile: sampleProfile(), changeScope: "currentAndFuturePlans", expectedRevision: 0 };
  const stored = await profiles.update("user-1", request);
  assert.equal(stored.revision, 1);
  await assert.rejects(() => profiles.update("user-1", request), (error) => error.code === "CONFLICT");
});

test("verified entitlements retain access during transient reconciliation failure", async () => {
  const accounts = new AccountService({ store: new MemoryAccountStore(), now: () => fixedNow });
  const active = await accounts.recordVerifiedAppStoreEvent("user-1", {
    verified: true,
    eventID: "apple-event-1",
    source: "app_store_server_notification_v2",
    state: "active",
    productID: "nourish.monthly",
    environment: "sandbox",
    willAutoRenew: true,
    signedPayloadSHA256: "a".repeat(64),
  });
  assert.equal(active.hasAccess, true);
  assert.equal(active.verificationStatus, "verified");
  const delayed = await accounts.recordReconciliationFailure("user-1");
  assert.equal(delayed.state, "active");
  assert.equal(delayed.hasAccess, true);
  assert.equal(delayed.reconciliationStatus, "delayed");
  const replay = await accounts.recordVerifiedAppStoreEvent("user-1", {
    verified: true,
    eventID: "apple-event-1",
    source: "app_store_server_notification_v2",
    state: "expired",
    signedPayloadSHA256: "a".repeat(64),
  });
  assert.equal(replay.state, "active");
});

test("operator subscription cases expose curated evidence and queue only verified retries", async (context) => {
  const store = new MemoryAccountStore();
  const accounts = new AccountService({ store, now: () => fixedNow });
  const userID = "subscription-user-1";
  const originalTransactionID = "20000000000000987654";
  const appAccountToken = "91a8d94c-4fc8-42b8-a959-bf08a8f2f006";
  await accounts.recordVerifiedAppStoreEvent(userID, {
    verified: true, source: "app_store_server_api", eventID: "subscription-event-private-1",
    state: "active", productID: "nourish.monthly", environment: "production",
    originalTransactionID, transactionID: "transaction-private-1", appAccountToken,
    willAutoRenew: true, signedPayloadSHA256: "e".repeat(64),
  });
  await accounts.recordReconciliationMismatch(userID, "APPLE_APP_ACCOUNT_TOKEN_MISMATCH");
  const app = createNourishServer({ accountService: accounts, adminKey: "test-admin-key" });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => app.server.close(resolve)));
  const baseURL = `http://127.0.0.1:${app.server.address().port}`;

  const listResponse = await fetch(`${baseURL}/admin/v1/subscriptions?status=attention`, {
    headers: adminHeaders("subscription-operator"),
  });
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.equal(list.subscriptions[0].reconciliation.status, "mismatch");
  assert.equal(list.subscriptions[0].hasAccess, true);
  assert.equal(JSON.stringify(list).includes(originalTransactionID), false);
  assert.equal(JSON.stringify(list).includes(appAccountToken), false);

  const detailResponse = await fetch(`${baseURL}/admin/v1/subscriptions/${encodeURIComponent(userID)}`, {
    headers: adminHeaders("subscription-operator"),
  });
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json();
  assert.equal(detail.timeline.some((event) => event.kind === "server_entitlement"), true);
  assert.equal(detail.identity.appAccountTokenSHA256.length, 64);

  const retryResponse = await fetch(`${baseURL}/admin/v1/subscriptions/${encodeURIComponent(userID)}/actions/retry`, {
    method: "POST", headers: adminHeaders("subscription-operator"),
    body: JSON.stringify({ reason: "Identity evidence reviewed; request a fresh verified Apple status check." }),
  });
  assert.equal(retryResponse.status, 200);
  const retried = await retryResponse.json();
  assert.equal(retried.reconciliation.status, "pending");
  assert.equal(retried.latestJob.state, "queued");
  assert.equal(retried.timeline.some((event) => event.kind === "operator_action"), true);

  const repeat = await fetch(`${baseURL}/admin/v1/subscriptions/${encodeURIComponent(userID)}/actions/retry`, {
    method: "POST", headers: adminHeaders("subscription-operator"),
    body: JSON.stringify({ reason: "Try to queue the same pending case a second time for safety." }),
  });
  assert.equal(repeat.status, 409);
});

test("aggregated owner KPIs expose formulas, freshness, filters, cohorts, and small-group suppression", async () => {
  const users = Array.from({ length: 6 }, (_, index) => ({ id: `analytics-user-${index + 1}`, createdAt: `2026-07-0${index + 1}T08:00:00Z` }));
  const dataset = {
    users,
    profiles: users.slice(0, 5).map((user, index) => ({ userID: user.id, dietType: index < 3 ? "vegetarian" : "vegan", createdAt: `2026-07-0${index + 2}T08:00:00Z`, updatedAt: `2026-07-0${index + 2}T08:00:00Z` })),
    subscriptions: users.map((user, index) => ({ userID: user.id, state: index < 4 ? "active" : "expired", updatedAt: "2026-07-10T08:00:00Z" })),
    dimensions: users.map((user, index) => ({ userID: user.id, latestAppVersion: index === 5 ? "1.1-beta" : "1.0.0", acquisitionSource: "organic" })),
    planJobs: [
      ...users.slice(0, 4).map((user, index) => ({ userID: user.id, state: "succeeded", createdAt: `2026-07-0${index + 3}T08:00:00Z`, completedAt: `2026-07-0${index + 3}T08:01:00Z` })),
      { userID: users[4].id, state: "rejected", createdAt: "2026-07-08T08:00:00Z", completedAt: "2026-07-08T08:01:00Z" },
    ],
    planAdoptions: users.slice(0, 3).map((user, index) => ({ userID: user.id, adoptedAt: `2026-07-0${index + 4}T08:00:00Z` })),
    weeklyReviews: users.slice(0, 2).map((user, index) => ({ userID: user.id, submittedAt: `2026-07-0${index + 8}T08:00:00Z` })),
    mealStates: [
      { userID: users[0].id, completionState: "completed", updatedAt: "2026-07-09T08:00:00Z" },
      { userID: users[1].id, completionState: "completed", updatedAt: "2026-07-09T08:00:00Z" },
      { userID: users[2].id, completionState: "completed", updatedAt: "2026-07-09T08:00:00Z" },
      { userID: users[3].id, completionState: "skipped", updatedAt: "2026-07-09T08:00:00Z" },
    ],
  };
  const analytics = new AnalyticsOperationsService({ dataset, now: () => new Date("2026-07-15T10:00:00Z") });
  const kpis = await analytics.kpis({ startDate: "2026-07-01", endDate: "2026-07-14", timeZone: "Asia/Kolkata", acquisitionSource: "organic" });
  assert.equal(kpis.metrics.find((metric) => metric.id === "registered_users").value, 6);
  assert.equal(kpis.metrics.find((metric) => metric.id === "plan_generation_success_rate").value, 0.8);
  assert.equal(kpis.metrics.find((metric) => metric.id === "meal_completion_rate").value, 0.75);
  assert.equal(kpis.metrics.every((metric) => metric.formula && metric.label && metric.format), true);
  assert.equal(kpis.privacy.identifiableFieldsReturned.length, 0);
  const cohorts = await analytics.cohorts({ startDate: "2026-07-01", endDate: "2026-07-14", timeZone: "Asia/Kolkata" });
  assert.equal(cohorts.rows[0].registeredUsers, 5);
  assert.equal(cohorts.rows[1].suppressed, true);
  assert.equal(cohorts.funnel.find((step) => step.id === "registered").count, 6);
  assert.equal(cohorts.funnel.find((step) => step.id === "adopted").count, 3);
  assert.ok(cohorts.tableColumns.length > 0);
  const suppressed = await analytics.kpis({ startDate: "2026-07-01", endDate: "2026-07-14", appVersion: "1.1-beta" });
  assert.equal(suppressed.privacy.suppressed, true);
  assert.equal(suppressed.metrics.every((metric) => metric.value === null && metric.suppressed), true);
});

test("support lookup is exact-match, minimized, read-only, and audited even when no account matches", async () => {
  const support = new UserSupportService({
    now: () => fixedNow,
    dataset: {
      users: [{ id: "support-user-1", verifiedEmail: "rhea@example.test", createdAt: "2026-06-01T08:00:00Z" }],
      profiles: [{ userID: "support-user-1", revision: 3, updatedAt: "2026-07-01T08:00:00Z", profile: { allergyIDs: ["private"] } }],
      subscriptions: [{ userID: "support-user-1", state: "active", productID: "nourish.monthly", reconciliationStatus: "current", lastVerifiedAt: "2026-07-12T08:00:00Z" }],
      planJobs: [{ id: "support-job-1", userID: "support-user-1", state: "succeeded", createdAt: "2026-07-10T08:00:00Z" }],
      planAdoptions: [{ userID: "support-user-1", adoptedAt: "2026-07-11T08:00:00Z" }],
      weeklyReviews: [{ userID: "support-user-1", submittedAt: "2026-07-14T08:00:00Z" }],
    },
  });
  const actor = { id: "support-operator-1" };
  const result = await support.lookup({
    verifiedEmail: " RHEA@Example.Test ", reason: "Investigating the user-reported plan access issue.",
    actor, correlationID: "support-found",
  });
  assert.equal(result.identity.userID, "support-user-1");
  assert.equal(result.account.profileRevision, 3);
  assert.equal(result.subscription.hasAccess, true);
  assert.equal(result.supportBoundary.impersonationAvailable, false);
  assert.equal(result.supportBoundary.readOnly, true);
  assert.equal(JSON.stringify(result).includes("allergyIDs"), false);
  assert.equal(JSON.stringify(result).includes("accessToken"), false);
  await assert.rejects(() => support.lookup({
    internalUserID: "missing-user", reason: "Checking an exact identifier supplied in a support ticket.",
    actor, correlationID: "support-missing",
  }), (error) => error.code === "NOT_FOUND" && error.status === 404);
  assert.equal(support.auditLog().length, 2);
  assert.deepEqual(support.auditLog().map((event) => event.outcome), ["found", "not_found"]);
  assert.equal(JSON.stringify(support.auditLog()).includes("rhea@example.test"), false);
  await assert.rejects(() => support.lookup({
    internalUserID: "support-user-1", verifiedEmail: "rhea@example.test",
    reason: "Attempting an invalid broad lookup request.", actor,
  }), (error) => error.code === "VALIDATION_ERROR");
});

test("feature flags enforce deterministic rollout, version gates, allowlists, emergency disable, and optimistic audit", async () => {
  const flags = new FeatureFlagService({ now: () => fixedNow });
  const actor = { id: "security-admin-1" };
  const created = await flags.save({
    key: "weekly_insights", description: "Show the new weekly insights experience.", enabled: true,
    emergencyDisabled: false, rolloutPercentage: 0, minimumAppVersion: "1.4.0", maximumAppVersion: "2.0.0",
    allowlistedUserIDs: ["allowlisted-user"], value: { layout: "guided" }, reason: "Start with the internal support validation group.",
  }, { actor, correlationID: "flag-create" });
  assert.equal(created.flag.version, 1);
  assert.equal((await flags.evaluate({ userID: "allowlisted-user", appVersion: "1.4.0" })).flags[0].reasonCode, "allowlisted");
  assert.equal((await flags.evaluate({ userID: "allowlisted-user", appVersion: "1.3.9" })).flags[0].reasonCode, "below_minimum_app_version");
  assert.equal((await flags.evaluate({ userID: "outside-user", appVersion: "1.4.0" })).flags[0].reasonCode, "outside_rollout");
  assert.equal(stableBucket("weekly_insights", "outside-user"), stableBucket("weekly_insights", "outside-user"));
  const disabled = await flags.save({
    ...created.flag, emergencyDisabled: true, expectedVersion: 1,
    reason: "Disable immediately while the crash report is investigated.",
  }, { actor, correlationID: "flag-emergency" });
  assert.equal(disabled.flag.version, 2);
  assert.equal(disabled.audit.action, "emergency_disabled");
  assert.equal((await flags.evaluate({ userID: "allowlisted-user", appVersion: "1.4.0" })).flags[0].reasonCode, "emergency_disabled");
  await assert.rejects(() => flags.save({
    ...created.flag, expectedVersion: 1, reason: "Attempt a stale update after another operator changed it.",
  }, { actor }), (error) => error.code === "CONFLICT");
  const listing = await flags.list();
  assert.equal(listing.auditEvents.length, 2);
  assert.equal(listing.evaluationContract.allowlistBypassesEmergencyDisable, false);
});

test("HTTP feature-flag administration and authenticated evaluation keep emergency disable server-owned", async (context) => {
  const delivery = new MemoryMagicLinkDelivery();
  const featureFlags = new FeatureFlagService({ now: () => fixedNow });
  const app = createNourishServer({ delivery, featureFlagService: featureFlags, adminKey: "test-admin-key" });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => app.server.close(resolve)));
  const baseURL = `http://127.0.0.1:${app.server.address().port}`;
  const created = await fetch(`${baseURL}/admin/v1/flags`, {
    method: "POST", headers: adminHeaders("flag-security-admin"),
    body: JSON.stringify({
      key: "guided_review", description: "Enable the guided weekly review.", enabled: true,
      emergencyDisabled: false, rolloutPercentage: 100, minimumAppVersion: "1.0.0", maximumAppVersion: null,
      allowlistedUserIDs: [], value: { steps: 3 }, reason: "Release the reviewed experience to supported app versions.",
    }),
  });
  assert.equal(created.status, 201);
  await fetch(`${baseURL}/v1/auth/magic-link`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "flags@example.test" }),
  });
  const completed = await fetch(`${baseURL}/v1/auth/magic-link/complete`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: delivery.latest().token }),
  });
  const session = await completed.json();
  const evaluated = await fetch(`${baseURL}/v1/feature-flags?appVersion=1.2.0`, { headers: { authorization: `Bearer ${session.accessToken}` } });
  assert.equal(evaluated.status, 200);
  assert.deepEqual((await evaluated.json()).flags[0].value, { steps: 3 });
  const updated = await fetch(`${baseURL}/admin/v1/flags`, {
    method: "POST", headers: adminHeaders("flag-security-admin"),
    body: JSON.stringify({
      key: "guided_review", description: "Enable the guided weekly review.", enabled: true,
      emergencyDisabled: true, rolloutPercentage: 100, minimumAppVersion: "1.0.0", maximumAppVersion: null,
      allowlistedUserIDs: [], value: { steps: 3 }, expectedVersion: 1,
      reason: "Emergency disable after a verified production regression report.",
    }),
  });
  assert.equal(updated.status, 200);
  const disabled = await fetch(`${baseURL}/v1/feature-flags?appVersion=1.2.0`, { headers: { authorization: `Bearer ${session.accessToken}` } });
  const disabledFlag = (await disabled.json()).flags[0];
  assert.equal(disabledFlag.enabled, false);
  assert.equal(disabledFlag.value, null);
  assert.equal(disabledFlag.reasonCode, "emergency_disabled");
});

test("HTTP contract completes magic login and protects profile routes", async (context) => {
  const delivery = new MemoryMagicLinkDelivery();
  let appAccountToken = null;
  const appStoreServerClient = {
    async verifyTransaction() {
      return {
        verified: true, source: "app_store_transaction", eventID: "http-initial-transaction",
        notificationType: "INITIAL_TRANSACTION_BINDING", state: "trial", productID: "nourish.monthly",
        environment: "sandbox", originalTransactionID: "200000000000006", transactionID: "transaction-http-1",
        appAccountToken, signedPayloadSHA256: "c".repeat(64),
      };
    },
    async verifyNotification() {
      return {
        verified: true, actionable: true, source: "app_store_server_notification_v2",
        eventID: "http-notification", notificationType: "DID_RENEW", state: "active", productID: "nourish.monthly",
        environment: "sandbox", originalTransactionID: "200000000000006", transactionID: "transaction-http-2",
        appAccountToken, willAutoRenew: true, signedPayloadSHA256: "d".repeat(64),
      };
    },
  };
  const app = createNourishServer({ delivery, appStoreServerClient });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => app.server.close(resolve)));
  const address = app.server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;

  const requested = await fetch(`${baseURL}/v1/auth/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "rhea@example.test" }),
  });
  assert.equal(requested.status, 202);

  const completed = await fetch(`${baseURL}/v1/auth/magic-link/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: delivery.latest().token }),
  });
  assert.equal(completed.status, 200);
  const session = await completed.json();

  const unauthorized = await fetch(`${baseURL}/v1/profile`);
  assert.equal(unauthorized.status, 401);

  const emptyProfile = await fetch(`${baseURL}/v1/profile`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  assert.equal(emptyProfile.status, 200);
  assert.equal(await emptyProfile.json(), null);

  const updated = await fetch(`${baseURL}/v1/profile`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ profile: sampleProfile(), changeScope: "currentAndFuturePlans", expectedRevision: 0 }),
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).revision, 1);

  const restored = await fetch(`${baseURL}/v1/profile`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).profile.countryRegionCode, "IN");

  const entitlement = await fetch(`${baseURL}/v1/entitlement`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  assert.equal(entitlement.status, 200);
  const entitlementBody = await entitlement.json();
  assert.equal(entitlementBody.state, "unknown");
  assert.equal(entitlementBody.verificationStatus, "notConfigured");

  const unauthorizedBinding = await fetch(`${baseURL}/v1/entitlement/app-account-token`, { method: "POST" });
  assert.equal(unauthorizedBinding.status, 401);
  const tokenResponse = await fetch(`${baseURL}/v1/entitlement/app-account-token`, {
    method: "POST", headers: { authorization: `Bearer ${session.accessToken}` },
  });
  assert.equal(tokenResponse.status, 200);
  appAccountToken = (await tokenResponse.json()).appAccountToken;
  const transactionBinding = await fetch(`${baseURL}/v1/entitlement/transactions`, {
    method: "POST",
    headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ signedTransactionInfo: "device-storekit-jws" }),
  });
  assert.equal(transactionBinding.status, 200);
  assert.equal((await transactionBinding.json()).state, "trial");
  const notification = await fetch(`${baseURL}/v1/app-store/notifications/v2`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedPayload: "apple-notification-jws" }),
  });
  assert.equal(notification.status, 204);
  const refreshedEntitlement = await fetch(`${baseURL}/v1/entitlement`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  assert.equal((await refreshedEntitlement.json()).state, "active");

  const exportHeaders = {
    authorization: `Bearer ${session.accessToken}`,
    "idempotency-key": "export-rhea-v1",
  };
  const exportRequest = await fetch(`${baseURL}/v1/account/export`, { method: "POST", headers: exportHeaders });
  assert.equal(exportRequest.status, 202);
  const exportReceipt = await exportRequest.json();
  assert.equal(exportReceipt.status, "queued");
  const replayedExport = await fetch(`${baseURL}/v1/account/export`, { method: "POST", headers: exportHeaders });
  assert.equal((await replayedExport.json()).requestID, exportReceipt.requestID);

  const deletion = await fetch(`${baseURL}/v1/account`, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "content-type": "application/json",
      "idempotency-key": "delete-rhea-v1",
    },
    body: JSON.stringify({ acknowledgement: "DELETE", reason: "Integration lifecycle check" }),
  });
  assert.equal(deletion.status, 202);
  assert.equal((await deletion.json()).status, "queued");
  const afterDeletion = await fetch(`${baseURL}/v1/profile`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  assert.equal(afterDeletion.status, 401);
});

test("catalogue admin workflow validates sources and keeps published versions immutable", async (context) => {
  const catalogue = new CatalogueService({ store: new MemoryCatalogueStore(), now: () => fixedNow });
  const fixture = catalogueFixture();
  const app = createNourishServer({
    catalogueService: catalogue,
    adminKey: "test-admin-key",
    adminOrigin: "http://127.0.0.1:4173",
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => app.server.close(resolve)));
  const baseURL = `http://127.0.0.1:${app.server.address().port}`;

  const preflight = await fetch(`${baseURL}/admin/v1/catalogue/queue`, {
    method: "OPTIONS",
    headers: { origin: "http://127.0.0.1:4173" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "http://127.0.0.1:4173");

  const ingredientIngestion = await fetch(`${baseURL}/admin/v1/ingredients`, {
    method: "POST",
    headers: adminHeaders("content-reviewer"),
    body: JSON.stringify({ ingredient: fixture.ingredient }),
  });
  assert.equal(ingredientIngestion.status, 201);
  assert.equal((await ingredientIngestion.json()).sourceStatus, "verified");
  const nutrientIngestion = await fetch(`${baseURL}/admin/v1/nutrient-records`, {
    method: "POST",
    headers: adminHeaders("nutrition-reviewer"),
    body: JSON.stringify({ record: fixture.nutrientRecord }),
  });
  assert.equal(nutrientIngestion.status, 201);
  assert.equal((await nutrientIngestion.json()).reviewedBy, "nutrition-reviewer");

  const inventory = await fetch(`${baseURL}/admin/v1/catalogue/content`, {
    headers: adminHeaders("content-reviewer"),
  });
  assert.equal(inventory.status, 200);
  const savedContent = await inventory.json();
  assert.equal(savedContent.ingredients[0].id, fixture.ingredient.id);
  assert.equal(savedContent.ingredients[0].conversions[0].grams, 60);
  assert.equal(savedContent.nutrientRecords[0].source.licenseStatus, "approvedForProduction");

  const unauthorized = await fetch(`${baseURL}/admin/v1/recipes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipe: fixture.recipe, content: fixture.content }),
  });
  assert.equal(unauthorized.status, 403);

  const created = await fetch(`${baseURL}/admin/v1/recipes`, {
    method: "POST",
    headers: adminHeaders("author-1"),
    body: JSON.stringify({ recipe: fixture.recipe, content: fixture.content }),
  });
  assert.equal(created.status, 201);
  const draft = await created.json();
  assert.equal(draft.workflowState, "draft");
  const queuedDrafts = await fetch(`${baseURL}/admin/v1/catalogue/queue`, {
    headers: { ...adminHeaders("reviewer-1"), origin: "http://127.0.0.1:4173" },
  });
  assert.equal(queuedDrafts.status, 200);
  assert.equal((await queuedDrafts.json()).items[0].id, draft.id);

  const submitted = await fetch(`${baseURL}/admin/v1/recipes/${fixture.recipe.id}/submit`, {
    method: "POST",
    headers: adminHeaders("author-1"),
  });
  assert.equal(submitted.status, 200);
  assert.equal((await submitted.json()).workflowState, "inReview");

  const selfApproval = await fetch(`${baseURL}/admin/v1/recipe-versions/${draft.id}/approve`, {
    method: "POST",
    headers: adminHeaders("author-1"),
  });
  assert.equal(selfApproval.status, 403);

  const approved = await fetch(`${baseURL}/admin/v1/recipe-versions/${draft.id}/approve`, {
    method: "POST",
    headers: adminHeaders("reviewer-1"),
  });
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).workflowState, "published");

  const editPublished = await fetch(`${baseURL}/admin/v1/recipes`, {
    method: "PATCH",
    headers: adminHeaders("author-1"),
    body: JSON.stringify({ versionID: draft.id, content: fixture.content }),
  });
  assert.equal(editPublished.status, 409);
  const nextDraft = await fetch(`${baseURL}/admin/v1/recipes`, {
    method: "POST",
    headers: adminHeaders("author-1"),
    body: JSON.stringify({ recipe: fixture.recipe, content: fixture.content }),
  });
  assert.equal(nextDraft.status, 201);
  const versionTwo = await nextDraft.json();
  assert.equal(versionTwo.version, 2);
  assert.equal(catalogue.version(draft.id).workflowState, "published");
  const activity = await fetch(`${baseURL}/admin/v1/catalogue/audit`, { headers: adminHeaders("reviewer-1") });
  assert.equal(activity.status, 200);
  assert.equal((await activity.json()).events.some((event) => event.action === "nutrient_record.reviewed"), true);
  assert.deepEqual(catalogue.auditLog().map((event) => event.action), [
    "recipe_version.created",
    "recipe_version.submitted",
    "recipe_version.published",
    "recipe_version.created",
  ]);
});

test("admin HTTP sessions require MFA and authorize every route from persisted roles", async (context) => {
  const verifier = new MemoryAdminIdentityVerifier(new Map([
    ["reviewer-mfa", {
      provider: "workforce-oidc", subject: "reviewer-subject", verifiedEmail: "reviewer@example.test",
      displayName: "Recipe Reviewer", authenticationMethods: ["password", "mfa"],
    }],
    ["reviewer-no-mfa", {
      provider: "workforce-oidc", subject: "reviewer-subject", verifiedEmail: "reviewer@example.test",
      displayName: "Recipe Reviewer", authenticationMethods: ["password"],
    }],
    ["author-mfa", {
      provider: "workforce-oidc", subject: "author-subject", verifiedEmail: "author@example.test",
      displayName: "Recipe Author", authenticationMethods: ["password", "mfa"],
    }],
    ["operator-mfa", {
      provider: "workforce-oidc", subject: "operator-subject", verifiedEmail: "operator@example.test",
      displayName: "Plan Operator", authenticationMethods: ["password", "mfa"],
    }],
    ["security-mfa", {
      provider: "workforce-oidc", subject: "security-subject", verifiedEmail: "security@example.test",
      displayName: "Security Administrator", authenticationMethods: ["password", "mfa"],
    }],
  ]));
  const adminAuth = new AdminAuthService({ verifier, now: () => fixedNow });
  adminAuth.provision({
    provider: "workforce-oidc", subject: "reviewer-subject", verifiedEmail: "reviewer@example.test",
    displayName: "Recipe Reviewer", roles: ["reviewer"],
  });
  adminAuth.provision({
    provider: "workforce-oidc", subject: "author-subject", verifiedEmail: "author@example.test",
    displayName: "Recipe Author", roles: ["author"],
  });
  adminAuth.provision({
    provider: "workforce-oidc", subject: "operator-subject", verifiedEmail: "operator@example.test",
    displayName: "Plan Operator", roles: ["operator"],
  });
  adminAuth.provision({
    provider: "workforce-oidc", subject: "security-subject", verifiedEmail: "security@example.test",
    displayName: "Security Administrator", roles: ["security_admin"],
  });
  const userSupport = new UserSupportService({
    now: () => fixedNow,
    dataset: { users: [{ id: "support-http-user", verifiedEmail: "support-http@example.test", createdAt: fixedNow }] },
  });
  const app = createNourishServer({ adminAuthService: adminAuth, catalogueService: new CatalogueService(), userSupportService: userSupport });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => app.server.close(resolve)));
  const baseURL = `http://127.0.0.1:${app.server.address().port}`;

  const withoutMFA = await fetch(`${baseURL}/admin/v1/auth/session`, {
    method: "POST", headers: { "content-type": "application/json", "x-correlation-id": "admin-no-mfa" },
    body: JSON.stringify({ identityToken: "reviewer-no-mfa" }),
  });
  assert.equal(withoutMFA.status, 403);

  const exchange = await fetch(`${baseURL}/admin/v1/auth/session`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ identityToken: "reviewer-mfa" }),
  });
  assert.equal(exchange.status, 200);
  const session = await exchange.json();
  assert.deepEqual(session.identity.roles, ["reviewer"]);
  const bearer = { authorization: `Bearer ${session.accessToken}` };

  const queue = await fetch(`${baseURL}/admin/v1/catalogue/queue`, { headers: bearer });
  assert.equal(queue.status, 200);
  const forbiddenAuthoring = await fetch(`${baseURL}/admin/v1/recipes`, {
    method: "POST", headers: { ...bearer, "content-type": "application/json", "x-correlation-id": "admin-role-denied" },
    body: JSON.stringify({ recipe: {}, content: {} }),
  });
  assert.equal(forbiddenAuthoring.status, 403);
  assert.equal(adminAuth.auditLog().some((event) => event.correlationID === "admin-role-denied" && event.requiredRole === "author" && event.outcome === "denied"), true);

  const authorExchange = await fetch(`${baseURL}/admin/v1/auth/session`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ identityToken: "author-mfa" }),
  });
  const authorSession = await authorExchange.json();
  const authorBearer = { authorization: `Bearer ${authorSession.accessToken}` };
  const authorIdentity = await fetch(`${baseURL}/admin/v1/auth/session`, { headers: authorBearer });
  assert.equal(authorIdentity.status, 200);
  assert.deepEqual((await authorIdentity.json()).roles, ["author"]);
  assert.equal((await fetch(`${baseURL}/admin/v1/catalogue/queue`, { headers: authorBearer })).status, 403);

  const operatorExchange = await fetch(`${baseURL}/admin/v1/auth/session`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ identityToken: "operator-mfa" }),
  });
  const operatorSession = await operatorExchange.json();
  const operatorBearer = { authorization: `Bearer ${operatorSession.accessToken}` };
  assert.equal((await fetch(`${baseURL}/admin/v1/plan-runs`, { headers: operatorBearer })).status, 200);
  assert.equal((await fetch(`${baseURL}/admin/v1/subscriptions`, { headers: operatorBearer })).status, 200);
  assert.equal((await fetch(`${baseURL}/admin/v1/kpis`, { headers: operatorBearer })).status, 200);
  assert.equal((await fetch(`${baseURL}/admin/v1/cohorts`, { headers: operatorBearer })).status, 200);
  assert.equal((await fetch(`${baseURL}/admin/v1/flags`, { headers: operatorBearer })).status, 403);
  const securityExchange = await fetch(`${baseURL}/admin/v1/auth/session`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identityToken: "security-mfa" }),
  });
  const securitySession = await securityExchange.json();
  const securityBearer = { authorization: `Bearer ${securitySession.accessToken}` };
  assert.equal((await fetch(`${baseURL}/admin/v1/flags`, { headers: securityBearer })).status, 200);
  const supportLookup = await fetch(`${baseURL}/admin/v1/users/lookup`, {
    method: "POST", headers: { ...operatorBearer, "content-type": "application/json", "x-correlation-id": "support-http-found" },
    body: JSON.stringify({ verifiedEmail: "support-http@example.test", reason: "Investigating a verified account access support ticket." }),
  });
  assert.equal(supportLookup.status, 200);
  assert.equal((await supportLookup.json()).identity.userID, "support-http-user");
  const directSupportView = await fetch(`${baseURL}/admin/v1/users/support-http-user`, {
    headers: { ...operatorBearer, "x-support-access-reason": "Following up on the same verified support ticket." },
  });
  assert.equal(directSupportView.status, 200);
  assert.equal((await fetch(`${baseURL}/admin/v1/catalogue/queue`, { headers: operatorBearer })).status, 403);
  assert.equal((await fetch(`${baseURL}/admin/v1/subscriptions`, { headers: bearer })).status, 403);
  assert.equal((await fetch(`${baseURL}/admin/v1/kpis`, { headers: bearer })).status, 403);
  assert.equal((await fetch(`${baseURL}/admin/v1/users/lookup`, {
    method: "POST", headers: { ...bearer, "content-type": "application/json" },
    body: JSON.stringify({ internalUserID: "support-http-user", reason: "A reviewer must not access identifiable support data." }),
  })).status, 403);
  assert.equal(userSupport.auditLog().length, 2);

  const revoked = await fetch(`${baseURL}/admin/v1/auth/revoke`, { method: "POST", headers: bearer });
  assert.equal(revoked.status, 204);
  assert.equal((await fetch(`${baseURL}/admin/v1/catalogue/queue`, { headers: bearer })).status, 403);
});

test("authenticated plan jobs are deterministic, idempotent, safe, and adoptable", async (context) => {
  const delivery = new MemoryMagicLinkDelivery();
  const planService = new PlannerService({ recipeProvider: () => plannerRecipes(), now: () => fixedNow });
  const app = createNourishServer({ delivery, planService, adminKey: "test-admin-key" });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => app.server.close(resolve)));
  const baseURL = `http://127.0.0.1:${app.server.address().port}`;

  await fetch(`${baseURL}/v1/auth/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "planner@example.test" }),
  });
  const completed = await fetch(`${baseURL}/v1/auth/magic-link/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: delivery.latest().token }),
  });
  const session = await completed.json();
  const authorization = { authorization: `Bearer ${session.accessToken}` };
  await fetch(`${baseURL}/v1/profile`, {
    method: "PATCH",
    headers: { ...authorization, "content-type": "application/json" },
    body: JSON.stringify({ profile: sampleProfile(), changeScope: "currentAndFuturePlans", expectedRevision: 0 }),
  });

  const requestBody = {
    weekStartLocalDate: "2026-07-20",
    deterministicSeed: "planner-user|2026-07-20|profile-r1",
    trigger: "weekly_review",
    favoriteRecipeIDs: ["unsafe-favorite", "planner-recipe-1"],
    recentRecipeIDs: ["planner-recipe-0"],
  };
  const createHeaders = {
    ...authorization,
    "content-type": "application/json",
    "idempotency-key": "week-2026-07-20-v1",
  };
  const created = await fetch(`${baseURL}/v1/plans`, {
    method: "POST",
    headers: createHeaders,
    body: JSON.stringify(requestBody),
  });
  assert.equal(created.status, 202);
  const job = await created.json();
  assert.equal(job.state, "succeeded");

  const replayed = await fetch(`${baseURL}/v1/plans`, {
    method: "POST",
    headers: createHeaders,
    body: JSON.stringify(requestBody),
  });
  assert.equal((await replayed.json()).id, job.id);

  const read = await fetch(`${baseURL}/v1/plans/${job.id}`, { headers: authorization });
  assert.equal(read.status, 200);
  const generated = await read.json();
  assert.equal(generated.plan.days.length, 7);
  assert.ok(generated.plan.days.every((day) => day.items.length === 3));
  assert.equal(generated.diagnostics.variety.passed, true);
  assert.equal(generated.diagnostics.variety.intentionalLeftovers, 9);
  assert.equal(generated.plan.scoringVersion, "wellness-score-v3");
  assert.equal(generated.plan.generatorVersion, "whole-week-serving-planner-v2");
  assert.equal(generated.diagnostics.toleranceEvaluation.contractVersion, "planner-tolerance-v1");
  assert.equal(generated.plan.targetSnapshot.optionalDailyProteinGrams, 90);
  assert.ok(Number.isFinite(generated.diagnostics.meanAbsoluteDailyProteinDeviation));
  assert.ok(generated.diagnostics.totalCostPenalty >= 0);
  assert.ok(Number.isFinite(generated.diagnostics.totalIngredientReusePenalty));
  assert.ok(generated.plan.days.flatMap((day) => day.items).every((item) => (
    item.servingMultiplier >= item.recipeSnapshot.minimumServingMultiplier
      && item.servingMultiplier <= item.recipeSnapshot.maximumServingMultiplier
  )));
  assert.ok(generated.diagnostics.rejectedCandidateCounts.allergenConflict > 0);
  assert.ok(generated.diagnostics.rejectedCandidateCounts.dislikedIngredient > 0);
  assert.ok(generated.plan.days.flatMap((day) => day.items).every((item) => !["unsafe-favorite", "disliked-mushroom"].includes(item.recipeSnapshot.recipeID)));

  const adminRuns = await fetch(`${baseURL}/admin/v1/plan-runs`, { headers: adminHeaders("plan-operator") });
  assert.equal(adminRuns.status, 200);
  const runList = await adminRuns.json();
  assert.equal(runList.runs[0].id, job.id);
  assert.equal(runList.runs[0].versions.rules, "eligibility-rules-v1");
  assert.equal(runList.runs[0].diagnostics.candidatePoolSize, generated.diagnostics.candidatePoolSize);
  assert.equal(runList.runs[0].diagnostics.toleranceEvaluation.contractVersion, "planner-tolerance-v1");
  assert.equal(JSON.stringify(runList).includes("profileSnapshot"), false);
  assert.equal(JSON.stringify(runList).includes(requestBody.deterministicSeed), false);
  const adminRunDetail = await fetch(`${baseURL}/admin/v1/plan-runs/${encodeURIComponent(job.id)}`, { headers: adminHeaders("plan-operator") });
  assert.equal(adminRunDetail.status, 200);
  assert.equal((await adminRunDetail.json()).correlationID, job.correlationID);

  const adopted = await fetch(`${baseURL}/v1/plans/${job.planID}/adopt`, {
    method: "POST",
    headers: { ...authorization, "idempotency-key": "adopt-week-2026-07-20" },
  });
  assert.equal(adopted.status, 200);
  assert.equal((await adopted.json()).status, "adopted");

  const activeResponse = await fetch(`${baseURL}/v1/plans/active`, { headers: authorization });
  assert.equal(activeResponse.status, 200);
  const active = await activeResponse.json();
  assert.equal(active.plan.id, generated.plan.id);
  assert.equal(active.groceryList.planID, generated.plan.id);
  assert.ok(active.prepTimeline.tasks.length > 0);

  const lockableItem = generated.plan.days.flatMap((day) => day.items)
    .find((item) => !item.leftoverRelationship.plannedReuse);
  assert.ok(lockableItem);
  const regeneratedResponse = await fetch(`${baseURL}/v1/plans`, {
    method: "POST",
    headers: { ...authorization, "content-type": "application/json", "idempotency-key": "regenerate-locked-v1" },
    body: JSON.stringify({
      ...requestBody,
      deterministicSeed: "planner-user|2026-07-20|regenerated",
      trigger: "manual_regeneration",
      regenerationReason: "More variety",
      lockedPlanItemIDs: [lockableItem.id],
    }),
  });
  assert.equal(regeneratedResponse.status, 202);
  const regeneratedJob = await regeneratedResponse.json();
  assert.equal(regeneratedJob.state, "succeeded");
  const regenerated = await (await fetch(`${baseURL}/v1/plans/${regeneratedJob.id}`, { headers: authorization })).json();
  assert.ok(regenerated.plan.days.flatMap((day) => day.items).some((item) => item.id === lockableItem.id));
  assert.ok(regenerated.diagnostics.explanations.some((item) => item.planItemID === lockableItem.id && item.code === "lockedByUser"));

  const historyResponse = await fetch(`${baseURL}/v1/plans/history`, { headers: authorization });
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json();
  assert.ok(history.some((entry) => entry.plan.id === regenerated.plan.id && entry.supersedesPlanID === generated.plan.id));

  const operationalMeal = active.plan.days[0].items[0];
  const mealStateResponse = await fetch(`${baseURL}/v1/plan-items/${encodeURIComponent(operationalMeal.id)}/status`, {
    method: "PATCH",
    headers: { ...authorization, "content-type": "application/json" },
    body: JSON.stringify({ state: "completed", expectedRevision: 0 }),
  });
  assert.equal(mealStateResponse.status, 200);
  assert.equal((await mealStateResponse.json()).state, "completed");

  const feedbackResponse = await fetch(`${baseURL}/v1/feedback`, {
    method: "POST",
    headers: { ...authorization, "content-type": "application/json" },
    body: JSON.stringify({
      subjectType: "meal",
      planItemID: operationalMeal.id,
      recipeID: operationalMeal.recipeSnapshot.recipeID,
      rating: 4,
      reasonTags: ["taste", "effort"],
      note: "Good flavor; weekday prep felt manageable.",
    }),
  });
  assert.equal(feedbackResponse.status, 201);
  assert.equal((await feedbackResponse.json()).status, "recorded");

  const weeklyReviewResponse = await fetch(`${baseURL}/v1/feedback`, {
    method: "POST",
    headers: { ...authorization, "content-type": "application/json" },
    body: JSON.stringify({
      subjectType: "weeklyReview",
      planID: generated.plan.id,
      completionRate: 1 / generated.plan.days.flatMap((day) => day.items).length,
      changesRequested: ["moreVariety", "lessEffort"],
    }),
  });
  assert.equal(weeklyReviewResponse.status, 201);
  assert.equal((await weeklyReviewResponse.json()).status, "recorded");

  const nextWeekResponse = await fetch(`${baseURL}/v1/plans`, {
    method: "POST",
    headers: { ...authorization, "content-type": "application/json", "idempotency-key": "next-week-v1" },
    body: JSON.stringify({ ...requestBody, weekStartLocalDate: "2026-07-27", deterministicSeed: "planner-user|2026-07-27" }),
  });
  const nextWeekJob = await nextWeekResponse.json();
  assert.equal(nextWeekJob.state, "succeeded");
  const scheduledResponse = await fetch(`${baseURL}/v1/plans/${nextWeekJob.planID}/adopt`, {
    method: "POST",
    headers: { ...authorization, "idempotency-key": "adopt-week-2026-07-27" },
  });
  assert.equal((await scheduledResponse.json()).status, "scheduled");
  const activeBeforeRenewal = await (await fetch(`${baseURL}/v1/plans/active`, { headers: authorization })).json();
  assert.equal(activeBeforeRenewal.plan.id, generated.plan.id);

  const prepTask = active.prepTimeline.tasks[0];
  const prepStateResponse = await fetch(`${baseURL}/v1/prep-tasks/${encodeURIComponent(prepTask.id)}`, {
    method: "PATCH",
    headers: { ...authorization, "content-type": "application/json" },
    body: JSON.stringify({ isComplete: true, expectedRevision: 0 }),
  });
  assert.equal(prepStateResponse.status, 200);
  assert.equal((await prepStateResponse.json()).isComplete, true);

  const activeWithOperations = await (await fetch(`${baseURL}/v1/plans/active`, { headers: authorization })).json();
  assert.equal(activeWithOperations.plan.days[0].items[0].completionState, "completed");
  assert.equal(activeWithOperations.prepTimeline.tasks[0].isComplete, true);

  const allItems = generated.plan.days.flatMap((day) => day.items);
  const linkedSourceIDs = new Set(allItems.flatMap((item) => item.leftoverRelationship.plannedReuse?.sourcePlanItemID ?? []));
  const swappable = allItems.find((item) => item.leftoverRelationship.batchSource && !linkedSourceIDs.has(item.id));
  assert.ok(swappable);
  const candidatesResponse = await fetch(`${baseURL}/v1/plan-items/${encodeURIComponent(swappable.id)}/swaps`, { headers: authorization });
  assert.equal(candidatesResponse.status, 200);
  const candidates = await candidatesResponse.json();
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((candidate) => candidate.recipe.recipeID !== "unsafe-favorite"));
  assert.ok(candidates.every((candidate) => (
    candidate.servingMultiplier >= candidate.recipe.minimumServingMultiplier
      && candidate.servingMultiplier <= candidate.recipe.maximumServingMultiplier
  )));

  const swapHeaders = { ...authorization, "content-type": "application/json", "idempotency-key": "safe-swap-1" };
  const swappedResponse = await fetch(`${baseURL}/v1/plan-items/${encodeURIComponent(swappable.id)}/swap`, {
    method: "POST",
    headers: swapHeaders,
    body: JSON.stringify({ replacementRecipeID: candidates[0].recipe.recipeID }),
  });
  assert.equal(swappedResponse.status, 200);
  const swapped = await swappedResponse.json();
  assert.notEqual(swapped.plan.id, generated.plan.id);
  assert.equal(swapped.supersedesPlanID, generated.plan.id);
  assert.ok(swapped.groceryList.items.length > 0);
  assert.ok(swapped.prepTimeline.tasks.length > 0);
  const swappedItem = swapped.plan.days.flatMap((day) => day.items).find((item) => item.recipeSnapshot.recipeID === candidates[0].recipe.recipeID);
  assert.equal(swappedItem?.servingMultiplier, candidates[0].servingMultiplier);

  const replayedSwap = await fetch(`${baseURL}/v1/plan-items/${encodeURIComponent(swappable.id)}/swap`, {
    method: "POST",
    headers: swapHeaders,
    body: JSON.stringify({ replacementRecipeID: candidates[0].recipe.recipeID }),
  });
  assert.equal((await replayedSwap.json()).plan.id, swapped.plan.id);

  const oldPlanAfterSwap = await (await fetch(`${baseURL}/v1/plans/${generated.plan.id}`, { headers: authorization })).json();
  assert.ok(oldPlanAfterSwap.plan.days.flatMap((day) => day.items).some((item) => item.id === swappable.id && item.recipeSnapshot.recipeID === swappable.recipeSnapshot.recipeID));

  const groceryResponse = await fetch(`${baseURL}/v1/grocery-lists/${encodeURIComponent(swapped.groceryList.id)}`, { headers: authorization });
  assert.equal(groceryResponse.status, 200);
  const grocery = await groceryResponse.json();
  const updatedGroceryResponse = await fetch(`${baseURL}/v1/grocery-lists/${encodeURIComponent(grocery.id)}`, {
    method: "PATCH",
    headers: { ...authorization, "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: grocery.revision, changes: [{ itemID: grocery.items[0].id, disposition: "checked" }] }),
  });
  assert.equal(updatedGroceryResponse.status, 200);
  const updatedGrocery = await updatedGroceryResponse.json();
  assert.equal(updatedGrocery.revision, grocery.revision + 1);
  assert.equal(updatedGrocery.items[0].disposition, "checked");
});

function sampleProfile() {
  return {
    countryRegionCode: "IN",
    unitSystem: "metric",
    timeZoneIdentifier: "Asia/Kolkata",
    preferredAuthenticationMethod: "emailMagicLink",
    goal: "maintain",
    calorieTarget: 1850,
    optionalDailyProteinTargetGrams: 90,
    targetSource: "userProvided",
    targetEstimatorVersion: null,
    diet: "vegetarian",
    allergens: ["peanuts"],
    ingredientExclusions: [],
    dislikedFoods: ["mushrooms"],
    cuisines: ["North Indian", "South Indian"],
    enabledMealSlots: ["breakfast", "lunch", "dinner"],
    snackPreference: "optional",
    budget: "medium",
    availableEquipment: ["stovetop", "pan", "pot", "pressure-cooker", "microwave", "blender"],
    maximumActiveMinutes: 35,
    cookingDays: [1, 3, 5, 7],
    leftoverPreference: "planned",
    batchPrepSessionsPerWeek: 1,
    wellnessConsent: { policyVersion: "wellness-v1.0", acceptedAt: fixedNow.toISOString() },
  };
}

function adminHeaders(id) {
  return {
    "content-type": "application/json",
    "x-nourish-admin-key": "test-admin-key",
    "x-nourish-admin-id": id,
  };
}

function catalogueFixture() {
  const source = {
    id: "source-spinach-v1",
    provider: "Licensed fixture provider",
    dataset: "Test nutrients",
    datasetVersion: "2026.1",
    sourceRecordID: "spinach-raw",
    licenseStatus: "approvedForProduction",
    retrievedAt: fixedNow.toISOString(),
  };
  const ingredient = {
    id: "spinach",
    canonicalName: "Spinach",
    aliases: ["palak"],
    category: "produce",
    compatibleDiets: ["vegan", "vegetarian", "eggetarian"],
    allergenIDs: [],
    conversions: [{ householdUnit: "cup", householdQuantity: 1, grams: 60 }],
    sourceStatus: "verified",
  };
  const nutrientRecord = {
    id: "nutrient-spinach-v1",
    ingredientID: ingredient.id,
    nutritionPer100Grams: { calories: 23, proteinGrams: 2.9, carbohydrateGrams: 3.6, fatGrams: 0.4, fibreGrams: 2.2 },
    source,
    confidence: "high",
    effectiveFrom: new Date(fixedNow.getTime() - 86_400_000).toISOString(),
    effectiveUntil: null,
    reviewedBy: "nutrient-reviewer",
    reviewedAt: fixedNow.toISOString(),
  };
  const recipe = {
    id: "sauteed-spinach",
    localeIdentifier: "en-IN",
    cuisine: "Indian",
    eligibleSlots: ["lunch", "dinner"],
    activePreparationMinutes: 10,
    totalMinutes: 15,
    equipment: ["pan"],
    costBand: "value",
    lifecycleStatus: "active",
  };
  const content = {
    displayName: "Sautéed spinach",
    ingredients: [{ ingredientID: ingredient.id, householdQuantity: 2, householdUnit: "cups", grams: 120 }],
    methodSteps: ["Wash, dry, and sauté the spinach until just wilted."],
    servings: 1,
    servingSizeGrams: 120,
    minimumServingMultiplier: 0.75,
    maximumServingMultiplier: 1.25,
    nutritionPerServing: { calories: 28, proteinGrams: 3.5, carbohydrateGrams: 4.3, fatGrams: 0.5, fibreGrams: 2.6 },
    dietType: "vegan",
    declaredAllergenIDs: [],
    dominantIngredientIDs: [ingredient.id],
    tags: ["quick", "dinner"],
    nutrientRecordIDs: [nutrientRecord.id],
    nutritionCalculationVersion: "weighted-grams-v1",
  };
  return { ingredient, nutrientRecord, recipe, content };
}

function plannerRecipes() {
  const recipes = Array.from({ length: 13 }, (_, index) => ({
    recipeID: `planner-recipe-${index}`,
    version: 1,
    displayName: `Planner recipe ${index}`,
    ingredients: [{
      ingredientID: `ingredient-${index}`,
      displayName: `Ingredient ${index}`,
      householdQuantity: 1,
      householdUnit: "cup",
      grams: 180,
      allergenIDs: [],
    }],
    methodSteps: ["Cook the reviewed synthetic fixture."],
    servingSizeGrams: 350,
    minimumServingMultiplier: 0.75,
    maximumServingMultiplier: 1.25,
    nutritionPerServing: {
      calories: 500 + index * 12,
      proteinGrams: 25,
      carbohydrateGrams: 60,
      fatGrams: 18,
      fibreGrams: 10,
    },
    activePreparationMinutes: 25,
    totalMinutes: 35,
    equipment: ["pan"],
    costBand: index % 3 === 0 ? "value" : "medium",
    tags: ["cuisine:north indian"],
    allergenIDs: [],
    dietType: "vegetarian",
    eligibleSlots: ["breakfast", "lunch", "dinner"],
    dominantIngredientIDs: [`ingredient-${index}`],
    nutritionSourceSummary: "Reviewed synthetic test fixture",
    nutritionCalculationVersion: "test-v1",
    reviewStatus: "approved",
    publicationStatus: "published",
  }));
  recipes.push({
    ...structuredClone(recipes[0]),
    recipeID: "unsafe-favorite",
    displayName: "Unsafe favorite fixture",
    ingredients: [{ ...structuredClone(recipes[0].ingredients[0]), ingredientID: "peanut", allergenIDs: ["peanuts"] }],
    allergenIDs: ["peanuts"],
    dominantIngredientIDs: ["peanut"],
  });
  recipes.push({
    ...structuredClone(recipes[1]),
    recipeID: "disliked-mushroom",
    displayName: "Disliked mushroom fixture",
    ingredients: [{ ...structuredClone(recipes[1].ingredients[0]), ingredientID: "mushrooms", displayName: "Mushrooms" }],
    dominantIngredientIDs: ["mushrooms"],
  });
  return recipes;
}
