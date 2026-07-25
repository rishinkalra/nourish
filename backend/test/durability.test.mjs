import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobQueueError, LeasedJobWorker, MemoryJobQueue, PostgresJobQueue } from "../src/job-queue.mjs";
import { withTransaction } from "../src/database.mjs";
import { migrationBody } from "../src/migrations.mjs";
import { PostgresProfileStore } from "../src/postgres-profile-store.mjs";
import { ProfileService } from "../src/profile-service.mjs";
import { PostgresAuthService } from "../src/postgres-auth-service.mjs";
import { AccountService, MemoryAccountStore, accountSubjectHash } from "../src/account-service.mjs";
import { PostgresAccountStore } from "../src/postgres-account-store.mjs";
import { FilePrivateObjectStore, MemoryPrivateObjectStore } from "../src/private-object-store.mjs";
import { createPrivacyJobHandlers } from "../src/privacy-job-handlers.mjs";
import { PostgresPlannerService } from "../src/postgres-plan-service.mjs";
import { createPlanJobHandler } from "../src/plan-job-handler.mjs";
import { deterministicUUID, isUUID } from "../src/stable-identifiers.mjs";
import { FeedbackService } from "../src/feedback-service.mjs";
import { PostgresFeedbackStore } from "../src/postgres-feedback-store.mjs";
import { PostgresWeeklyLoopService } from "../src/postgres-weekly-loop-service.mjs";
import { buildDurableSwapSuccessor, buildPreservedSwapOperations } from "../src/durable-swap.mjs";
import { deriveWeeklyLoop } from "../src/weekly-loop-service.mjs";
import { AppStoreServerError, OfficialAppStoreSubscriptionClient } from "../src/app-store-server-client.mjs";
import { createEntitlementReconciliationHandler, scheduleDueEntitlementReconciliations } from "../src/entitlement-reconciliation.mjs";
import { PostgresCatalogueReader } from "../src/postgres-catalogue-reader.mjs";
import { PostgresCatalogueService } from "../src/postgres-catalogue-service.mjs";
import { CatalogueService, MemoryCatalogueStore } from "../src/catalogue-service.mjs";
import { AdminAuthService, MemoryAdminIdentityVerifier } from "../src/admin-auth-service.mjs";
import { provisionAdmin } from "../src/admin-provisioning.mjs";
import { PostgresPlanOperationsService } from "../src/plan-operations-service.mjs";
import { PostgresSubscriptionOperationsService } from "../src/subscription-operations-service.mjs";
import { PostgresAnalyticsOperationsService } from "../src/analytics-operations-service.mjs";
import { PostgresUserSupportService } from "../src/user-support-service.mjs";
import { PostgresFeatureFlagService } from "../src/feature-flag-service.mjs";

test("durable jobs are idempotent, leased, retried, and recoverable", async () => {
  let now = new Date("2026-07-14T10:00:00.000Z");
  const queue = new MemoryJobQueue({ now: () => now });
  const first = await queue.enqueue({
    type: "account.export",
    userID: "user-1",
    idempotencyKey: "export-1",
    payload: { requestID: "request-1" },
    maxAttempts: 3,
  });
  const replay = await queue.enqueue({
    type: "account.export",
    userID: "user-1",
    idempotencyKey: "export-1",
    payload: { requestID: "different" },
  });
  assert.equal(replay.id, first.id);
  assert.equal(replay.payload.requestID, "request-1");

  const claimed = await queue.claim({ workerID: "worker-a", leaseMilliseconds: 1_000 });
  assert.equal(claimed.state, "running");
  assert.equal(claimed.attemptCount, 1);
  await assert.rejects(() => queue.complete(claimed.id, "worker-b"), (error) => error instanceof JobQueueError && error.code === "LEASE_LOST");

  now = new Date(now.getTime() + 1_001);
  const recovered = await queue.claim({ workerID: "worker-b", leaseMilliseconds: 1_000 });
  assert.equal(recovered.id, claimed.id);
  assert.equal(recovered.attemptCount, 2);
  const retried = await queue.fail(recovered.id, "worker-b", new Error("temporary"), { baseDelayMilliseconds: 100 });
  assert.equal(retried.state, "queued");
  assert.equal(await queue.claim({ workerID: "worker-c" }), null);

  now = new Date(retried.availableAt.getTime());
  const finalClaim = await queue.claim({ workerID: "worker-c" });
  const completed = await queue.complete(finalClaim.id, "worker-c", { objectKey: "private/export.json" });
  assert.equal(completed.state, "succeeded");
  assert.equal(completed.result.objectKey, "private/export.json");
});

test("leased worker records handler success and bounded failure", async () => {
  const queue = new MemoryJobQueue();
  const unhandled = await queue.enqueue({ type: "plan.generate", payload: { userID: "user-1" }, idempotencyKey: "plan-1" });
  await queue.enqueue({ type: "entitlement.reconcile", payload: { userID: "user-1" }, idempotencyKey: "reconcile-1" });
  const worker = new LeasedJobWorker({
    queue,
    workerID: "worker-1",
    handlers: { "entitlement.reconcile": async (job) => ({ reconciledUserID: job.payload.userID }) },
  });
  assert.equal((await worker.runOnce()).state, "succeeded");
  assert.equal((await queue.read(unhandled.id)).state, "queued");
  assert.equal(await worker.runOnce(), null);
});

test("PostgreSQL queue uses parameterized idempotent enqueue and lease-safe claim", async () => {
  const calls = [];
  const now = new Date("2026-07-14T10:00:00.000Z");
  const row = {
    id: "job-1", job_type: "plan.generate", user_id: "user-1", idempotency_key: "week-1",
    state: "queued", payload_json: { week: "2026-07-20" }, result_json: null,
    attempt_count: 0, max_attempts: 8, available_at: now, locked_at: null,
    locked_until: null, worker_id: null, last_error_code: null, last_error_message: null,
    created_at: now, updated_at: now, completed_at: null,
  };
  const pool = {
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [calls.length === 1 ? row : { ...row, state: "running", attempt_count: 1, worker_id: "worker-1", locked_at: now, locked_until: new Date(now.getTime() + 1_000) }] };
    },
  };
  const queue = new PostgresJobQueue({ pool, now: () => now });
  const enqueued = await queue.enqueue({ type: "plan.generate", userID: "user-1", idempotencyKey: "week-1", payload: { week: "2026-07-20" } });
  assert.equal(enqueued.id, "job-1");
  assert.match(calls[0].text, /ON CONFLICT \(job_type, idempotency_key\)/);
  assert.equal(calls[0].values.includes("week-1"), true);
  const claimed = await queue.claim({ workerID: "worker-1", leaseMilliseconds: 1_000 });
  assert.equal(claimed.state, "running");
  assert.match(calls[1].text, /FOR UPDATE SKIP LOCKED/);
  assert.equal(calls[1].values[2], "worker-1");
});

test("transaction helper commits, rolls back, and always releases one checked-out client", async () => {
  const calls = [];
  const client = { query: async (text) => { calls.push(text); }, release: () => calls.push("RELEASE") };
  const pool = { connect: async () => client };
  assert.equal(await withTransaction(pool, async () => "committed"), "committed");
  assert.deepEqual(calls, ["BEGIN", "COMMIT", "RELEASE"]);

  calls.length = 0;
  await assert.rejects(() => withTransaction(pool, async () => { throw new Error("failed"); }), /failed/);
  assert.deepEqual(calls, ["BEGIN", "ROLLBACK", "RELEASE"]);
  assert.equal(migrationBody("BEGIN;\nCREATE TABLE example(id int);\nCOMMIT;"), "CREATE TABLE example(id int);");
});

test("PostgreSQL profiles use atomic compare-and-set revisions", async () => {
  const now = new Date("2026-07-14T10:00:00.000Z");
  const calls = [];
  const profile = { countryRegionCode: "IN", timeZoneIdentifier: "Asia/Kolkata", calorieTarget: 1800, enabledMealSlots: ["breakfast"], cookingDays: ["monday"], wellnessConsent: { policyVersion: "v1", acceptedAt: now.toISOString() } };
  const pool = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("INSERT INTO profiles")) return { rows: [{ profile_json: profile, revision: 1, effective_scope: "currentAndFuturePlans", updated_at: now }] };
      if (text.includes("UPDATE profiles")) return { rows: [] };
      return { rows: [] };
    },
  };
  const service = new ProfileService({ store: new PostgresProfileStore({ pool }), now: () => now });
  const created = await service.update("user-1", { profile, changeScope: "currentAndFuturePlans", expectedRevision: 0 });
  assert.equal(created.revision, 1);
  assert.match(calls[0].text, /ON CONFLICT \(user_id\) DO NOTHING/);
  assert.match(calls[0].text, /created_at, updated_at[\s\S]*\$4, \$4/);
  assert.equal(calls[0].values.length, 4);
  await assert.rejects(
    () => service.update("user-1", { profile, changeScope: "nextPlanOnly", expectedRevision: 1 }),
    (error) => error.code === "CONFLICT",
  );
  assert.match(calls[1].text, /WHERE user_id = \$1 AND revision = \$4/);
});

test("PostgreSQL authentication looks up only token hashes", async () => {
  const now = new Date("2026-07-14T10:00:00.000Z");
  const calls = [];
  const pool = {
    connect: async () => { throw new Error("not used"); },
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [{ user_id: "user-1", verified_email: "rhea@example.test", revoked_at: null, disabled_at: null, access_expires_at: new Date(now.getTime() + 60_000) }] };
    },
  };
  const auth = new PostgresAuthService({ pool, now: () => now });
  const identity = await auth.authenticate("raw-secret-access-token");
  assert.equal(identity.userID, "user-1");
  assert.equal(calls[0].values[0].length, 64);
  assert.notEqual(calls[0].values[0], "raw-secret-access-token");
  assert.match(calls[0].text, /access_token_sha256 = \$1/);
});

test("administrator sessions require MFA, enforce persisted roles, hash tokens, audit denial, and revoke", async () => {
  let now = new Date("2026-07-15T08:00:00.000Z");
  const verifier = new MemoryAdminIdentityVerifier(new Map([
    ["reviewer-assertion", {
      provider: "workforce-oidc", subject: "reviewer-subject", verifiedEmail: "reviewer@example.test",
      displayName: "Recipe Reviewer", authenticationMethods: ["password", "mfa"],
    }],
    ["no-mfa-assertion", {
      provider: "workforce-oidc", subject: "reviewer-subject", verifiedEmail: "reviewer@example.test",
      displayName: "Recipe Reviewer", authenticationMethods: ["password"],
    }],
  ]));
  const service = new AdminAuthService({
    verifier, now: () => now, tokenFactory: () => "raw-admin-session-token-that-must-never-be-stored",
  });
  service.provision({
    provider: "workforce-oidc", subject: "reviewer-subject", verifiedEmail: "reviewer@example.test",
    displayName: "Recipe Reviewer", roles: ["reviewer"],
  });

  await assert.rejects(
    () => service.exchange("no-mfa-assertion", { route: "/admin/v1/auth/session", correlationID: "corr-mfa" }),
    (error) => error.code === "AUTHENTICATION_REQUIRED" && /Multi-factor/.test(error.message),
  );
  const session = await service.exchange("reviewer-assertion", { route: "/admin/v1/auth/session", correlationID: "corr-login" });
  assert.deepEqual(session.identity.roles, ["reviewer"]);
  assert.deepEqual(session.identity.authenticationMethods, ["password", "mfa"]);
  assert.equal([...service.store.sessionsByHash.keys()].includes(session.accessToken), false);
  assert.equal([...service.store.sessionsByHash.keys()][0].length, 64);

  const actor = await service.authenticate(session.accessToken, "reviewer", { route: "/admin/v1/catalogue/queue", correlationID: "corr-read" });
  assert.equal(actor.subject, "reviewer-subject");
  await assert.rejects(
    () => service.authenticate(session.accessToken, "author", { route: "/admin/v1/recipes", correlationID: "corr-role" }),
    (error) => error.code === "AUTHENTICATION_REQUIRED" && /role/.test(error.message),
  );
  await service.revoke(session.accessToken, { route: "/admin/v1/auth/revoke", correlationID: "corr-revoke" });
  now = new Date(now.getTime() + 1);
  await assert.rejects(() => service.authenticate(session.accessToken, "reviewer"), /expired/);
  assert.equal(service.auditLog().some((event) => event.correlationID === "corr-mfa" && event.outcome === "denied"), true);
  assert.equal(service.auditLog().some((event) => event.correlationID === "corr-role" && event.requiredRole === "author" && event.outcome === "denied"), true);
  assert.equal(service.auditLog().some((event) => event.correlationID === "corr-read" && event.outcome === "granted"), true);
});

test("administrator provisioning grants only approved roles and writes an accountable transaction", async () => {
  const now = new Date("2026-07-15T08:00:00.000Z");
  const adminUserID = deterministicUUID("provisioned-admin");
  const calls = [];
  const client = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (text.includes("INSERT INTO admin_users")) return { rows: [{
        id: adminUserID, provider: values[1], provider_subject: values[2], verified_email: values[3],
        display_name: values[4], status: "active",
      }] };
      return { rows: [] };
    },
    release() { calls.push({ text: "RELEASE", values: [] }); },
  };
  const pool = { connect: async () => client };
  const provisioned = await provisionAdmin(pool, {
    provider: "workforce-oidc", subject: "admin-subject", verifiedEmail: "Admin@Example.test",
    displayName: "Nourish Admin", roles: ["reviewer", "author", "reviewer"],
    reason: "Launch catalogue operations", provisionedBySubject: "security-owner", now,
  });

  assert.deepEqual(provisioned.roles, ["author", "reviewer"]);
  assert.equal(provisioned.verifiedEmail, "admin@example.test");
  assert.deepEqual(calls.filter((call) => ["BEGIN", "COMMIT", "RELEASE"].includes(call.text)).map((call) => call.text), ["BEGIN", "COMMIT", "RELEASE"]);
  assert.deepEqual(calls.filter((call) => call.text.includes("INSERT INTO admin_role_grants")).map((call) => call.values[1]), ["author", "reviewer"]);
  const audit = calls.find((call) => call.text.includes("INSERT INTO admin_access_audit_logs"));
  assert.equal(audit.values[2], "security-owner");
  assert.deepEqual(JSON.parse(audit.values[3]).roles, ["author", "reviewer"]);
  await assert.rejects(
    () => provisionAdmin(pool, {
      provider: "workforce-oidc", subject: "bad", verifiedEmail: "bad@example.test",
      displayName: "Bad Role", roles: ["superuser"], reason: "Not allowed", now,
    }),
    /approved roles/,
  );
});

test("verified entitlement persistence and its event update share one transaction", async () => {
  const now = new Date("2026-07-14T10:00:00.000Z");
  const calls = [];
  const subscriptionRow = {
    user_id: "user-1", state: "active", product_id: "nourish.monthly", environment: "sandbox",
    period_ends_at: null, will_auto_renew: true, source_event_id: "event-1",
    last_verified_at: now, next_reconciliation_at: new Date(now.getTime() + 21_600_000),
    reconciliation_status: "current",
  };
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] };
      if (text.includes("INSERT INTO app_store_events")) return { rows: [{ id: "stored-event-1" }] };
      if (text.includes("INSERT INTO subscriptions")) return { rows: [subscriptionRow] };
      return { rows: [] };
    },
    release() { calls.push({ text: "RELEASE", values: [] }); },
  };
  const pool = { query: (...args) => client.query(...args), connect: async () => client };
  const accounts = new AccountService({ store: new PostgresAccountStore({ pool, now: () => now }), now: () => now });
  const saved = await accounts.recordVerifiedAppStoreEvent("user-1", {
    verified: true,
    eventID: "event-1",
    source: "app_store_server_notification_v2",
    notificationType: "DID_RENEW",
    state: "active",
    productID: "nourish.monthly",
    environment: "sandbox",
    willAutoRenew: true,
    signedPayloadSHA256: "b".repeat(64),
  });
  assert.equal(saved.hasAccess, true);
  assert.deepEqual(calls.map((call) => call.text === "BEGIN" || call.text === "COMMIT" || call.text === "RELEASE" ? call.text : "SQL"), ["BEGIN", "SQL", "SQL", "SQL", "COMMIT", "RELEASE"]);
  assert.equal(calls[1].values.includes("b".repeat(64)), true);
});

test("official Apple status adapter verifies signed payloads and selects the strongest matching entitlement", async () => {
  const transactionID = "200000000000001";
  const calls = [];
  const transactions = {
    "expired-transaction": {
      originalTransactionId: transactionID, transactionId: "expired", productId: "nourish.monthly",
      expiresDate: Date.parse("2026-07-01T00:00:00.000Z"), signedDate: 10,
    },
    "grace-transaction": {
      originalTransactionId: transactionID, transactionId: "grace", productId: "nourish.monthly",
      appAccountToken: deterministicUUID("apple-account-token"),
      expiresDate: Date.parse("2026-07-20T00:00:00.000Z"), signedDate: 20,
    },
  };
  const renewals = {
    "expired-renewal": { autoRenewStatus: 0, signedDate: 11 },
    "grace-renewal": { autoRenewStatus: 1, signedDate: 21 },
  };
  const verifier = {
    async verifyAndDecodeTransaction(value) { calls.push(`transaction:${value}`); return transactions[value]; },
    async verifyAndDecodeRenewalInfo(value) { calls.push(`renewal:${value}`); return renewals[value]; },
  };
  const client = new OfficialAppStoreSubscriptionClient({
    clientsByEnvironment: {
      sandbox: { getAllSubscriptionStatuses: async (id) => {
        calls.push(`status:${id}`);
        return { environment: "Sandbox", data: [{ lastTransactions: [
          { originalTransactionId: transactionID, status: 2, signedTransactionInfo: "expired-transaction", signedRenewalInfo: "expired-renewal" },
          { originalTransactionId: transactionID, status: 4, signedTransactionInfo: "grace-transaction", signedRenewalInfo: "grace-renewal" },
        ] }] };
      } },
    },
    verifiersByEnvironment: { sandbox: verifier }, allowedProductIDs: ["nourish.monthly"],
  });
  const event = await client.fetchSubscriptionStatus({ originalTransactionID: transactionID, environment: "sandbox" });
  assert.equal(event.verified, true);
  assert.equal(event.source, "app_store_server_api");
  assert.equal(event.state, "graceOrBillingRetry");
  assert.equal(event.transactionID, "grace");
  assert.equal(event.willAutoRenew, true);
  assert.equal(event.signedPayloadSHA256.length, 64);
  assert.equal(calls.length, 5);

  const retrying = new OfficialAppStoreSubscriptionClient({
    clientsByEnvironment: { production: { getAllSubscriptionStatuses: async () => { throw { httpStatusCode: 429, apiError: 4290000 }; } } },
    verifiersByEnvironment: { production: verifier }, allowedProductIDs: ["nourish.monthly"],
  });
  await assert.rejects(
    () => retrying.fetchSubscriptionStatus({ originalTransactionID: transactionID, environment: "production" }),
    (error) => error instanceof AppStoreServerError && error.retryable && error.code === "APPLE_4290000",
  );
});

test("official Apple ingress verifies outer, transaction, and renewal signatures without trusting body environment", async () => {
  const outerJWS = `${"a".repeat(16)}.${"b".repeat(16)}.${"c".repeat(16)}`;
  const transactionJWS = `${"d".repeat(16)}.${"e".repeat(16)}.${"f".repeat(16)}`;
  const renewalJWS = `${"g".repeat(16)}.${"h".repeat(16)}.${"i".repeat(16)}`;
  const initialJWS = `${"j".repeat(16)}.${"k".repeat(16)}.${"l".repeat(16)}`;
  const appAccountToken = deterministicUUID("ingress-token");
  const calls = [];
  const verifier = {
    async verifyAndDecodeNotification(value) {
      calls.push(`notification:${value}`);
      return {
        notificationUUID: "notification-1", notificationType: "DID_FAIL_TO_RENEW", subtype: "GRACE_PERIOD",
        data: { environment: "Sandbox", status: 4, signedTransactionInfo: transactionJWS, signedRenewalInfo: renewalJWS },
      };
    },
    async verifyAndDecodeTransaction(value) {
      calls.push(`transaction:${value}`);
      return {
        originalTransactionId: "200000000000003", transactionId: value === initialJWS ? "initial-3" : "renewal-3",
        productId: "nourish.monthly", appAccountToken, expiresDate: Date.parse("2026-08-01T00:00:00.000Z"), signedDate: 99,
      };
    },
    async verifyAndDecodeRenewalInfo(value) { calls.push(`renewal:${value}`); return { autoRenewStatus: 1 }; },
  };
  const client = new OfficialAppStoreSubscriptionClient({
    clientsByEnvironment: {}, verifiersByEnvironment: { sandbox: verifier }, allowedProductIDs: ["nourish.monthly"],
  });
  const notification = await client.verifyNotification(outerJWS);
  assert.equal(notification.source, "app_store_server_notification_v2");
  assert.equal(notification.state, "graceOrBillingRetry");
  assert.equal(notification.environment, "sandbox");
  assert.equal(notification.appAccountToken, appAccountToken);
  assert.equal(notification.signedPayloadSHA256.length, 64);
  assert.deepEqual(calls.slice(0, 3), [
    `notification:${outerJWS}`, `transaction:${transactionJWS}`, `renewal:${renewalJWS}`,
  ]);

  const transaction = await client.verifyTransaction(initialJWS, { now: new Date("2026-07-15T00:00:00.000Z") });
  assert.equal(transaction.source, "app_store_transaction");
  assert.equal(transaction.state, "active");
  assert.equal(transaction.originalTransactionID, "200000000000003");

  const wrongProductClient = new OfficialAppStoreSubscriptionClient({
    clientsByEnvironment: {}, verifiersByEnvironment: { sandbox: verifier }, allowedProductIDs: ["nourish.annual"],
  });
  await assert.rejects(
    () => wrongProductClient.verifyTransaction(initialJWS),
    (error) => error.code === "APPLE_PRODUCT_NOT_CONFIGURED",
  );
});

test("issued account tokens route early verified notifications and later binding cannot replay stale state", async () => {
  const now = new Date("2026-07-15T04:00:00.000Z");
  const store = new MemoryAccountStore();
  const accounts = new AccountService({ store, now: () => now });
  const issued = await accounts.issueAppAccountToken("user-1");
  const notification = {
    verified: true, actionable: true, source: "app_store_server_notification_v2",
    eventID: "notification-before-binding", notificationType: "DID_RENEW", state: "active",
    productID: "nourish.monthly", environment: "sandbox", periodEndsAt: new Date("2026-08-15T00:00:00.000Z"),
    willAutoRenew: true, originalTransactionID: "200000000000004", transactionID: "renewal-4",
    appAccountToken: issued.appAccountToken, signedPayloadSHA256: "7".repeat(64),
  };
  assert.equal((await accounts.recordVerifiedAppStoreNotification(notification)).status, "applied");
  assert.equal((await accounts.readEntitlement("user-1")).state, "active");

  const bound = await accounts.bindVerifiedAppStoreTransaction("user-1", {
    verified: true, source: "app_store_transaction", eventID: "initial-binding-4",
    notificationType: "INITIAL_TRANSACTION_BINDING", state: "active", productID: "nourish.monthly",
    environment: "sandbox", periodEndsAt: new Date("2026-08-01T00:00:00.000Z"), willAutoRenew: null,
    originalTransactionID: "200000000000004", transactionID: "initial-4",
    appAccountToken: issued.appAccountToken, signedPayloadSHA256: "8".repeat(64),
  });
  assert.equal(bound.sourceEventID, "notification-before-binding");
  assert.equal(bound.hasAccess, true);
  assert.equal(store.notificationInbox.get("notification-before-binding").processingState, "applied");
  assert.equal((await accounts.recordVerifiedAppStoreNotification(notification)).replay, true);

  const secondToken = await accounts.issueAppAccountToken("user-2");
  await assert.rejects(
    () => accounts.bindVerifiedAppStoreTransaction("user-2", {
      verified: true, source: "app_store_transaction", eventID: "stolen-binding-4",
      notificationType: "INITIAL_TRANSACTION_BINDING", state: "active", environment: "sandbox",
      originalTransactionID: "200000000000004", transactionID: "stolen-4",
      appAccountToken: secondToken.appAccountToken, signedPayloadSHA256: "9".repeat(64),
    }),
    (error) => error.code === "APPLE_SUBSCRIPTION_OWNERSHIP_MISMATCH",
  );
});

test("PostgreSQL App Store ingress persists stable account identity and a hash-only notification inbox", async () => {
  const now = new Date("2026-07-15T05:00:00.000Z");
  const token = deterministicUUID("postgres-app-account-token");
  const calls = [];
  const inboxRow = {
    app_store_event_id: "notification-pg-1", original_transaction_id: "200000000000005",
    transaction_id: "transaction-pg-1", app_account_token: token, notification_type: "DID_RENEW",
    environment: "production", normalized_event_json: null, signed_payload_sha256: "a".repeat(64),
    received_at: now, processing_state: "pending", user_id: null, processed_at: null, failure_code: null,
  };
  const pool = {
    connect: async () => { throw new Error("not used"); },
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("INSERT INTO app_store_account_bindings")) {
        return { rows: [{ app_account_token: token, created_at: now }] };
      }
      if (text.includes("INSERT INTO app_store_notification_inbox")) {
        inboxRow.normalized_event_json = JSON.parse(values[6]);
        return { rows: [inboxRow] };
      }
      return { rows: [] };
    },
  };
  const store = new PostgresAccountStore({ pool, now: () => now });
  assert.equal((await store.getOrCreateAppAccountToken("user-1", token, now)).appAccountToken, token);
  const event = {
    verified: true, actionable: true, source: "app_store_server_notification_v2",
    eventID: "notification-pg-1", notificationType: "DID_RENEW", state: "active",
    environment: "production", originalTransactionID: "200000000000005", transactionID: "transaction-pg-1",
    appAccountToken: token, signedPayloadSHA256: "a".repeat(64),
  };
  assert.equal((await store.saveVerifiedNotification(event, now)).processingState, "pending");
  assert.match(calls[0].text, /ON CONFLICT \(user_id\)/);
  assert.match(calls[1].text, /ON CONFLICT \(app_store_event_id\) DO NOTHING/);
  assert.equal(calls[1].values.some((value) => String(value).includes("eyJ")), false);
  assert.equal(JSON.parse(calls[1].values[6]).signedPayload, undefined);
});

test("due entitlement scheduler leases rows and enqueues one idempotent job per saved due time", async () => {
  const now = new Date("2026-07-15T03:00:00.000Z");
  const calls = [];
  let insertCount = 0;
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return { rows: [] };
      if (text.includes("FROM subscriptions subscription")) return { rows: [
        { user_id: "user-1", next_reconciliation_at: new Date("2026-07-15T02:00:00.000Z") },
        { user_id: "user-2", next_reconciliation_at: new Date("2026-07-15T02:30:00.000Z") },
      ] };
      if (text.includes("INSERT INTO background_jobs")) {
        insertCount += 1;
        return { rows: insertCount === 1 ? [{ id: deterministicUUID("entitlement-job") }] : [] };
      }
      return { rows: [] };
    },
    release() { calls.push({ text: "RELEASE", values: [] }); },
  };
  const scheduled = await scheduleDueEntitlementReconciliations({
    pool: { connect: async () => client }, now: () => now, limit: 10,
  });
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].userID, "user-1");
  const dueQuery = calls.find((call) => call.text.includes("FROM subscriptions subscription"));
  assert.match(dueQuery.text, /FOR UPDATE OF subscription SKIP LOCKED/);
  assert.match(dueQuery.text, /job\.state IN \('queued', 'running'\)/);
  const insert = calls.find((call) => call.text.includes("INSERT INTO background_jobs"));
  assert.match(insert.text, /ON CONFLICT \(job_type, idempotency_key\) DO NOTHING/);
  assert.equal(calls.filter((call) => call.text.includes("SET reconciliation_status = 'pending'")).length, 1);
  assert.deepEqual(calls.slice(-2).map((call) => call.text), ["COMMIT", "RELEASE"]);
});

test("entitlement worker applies only matching Apple identity and retains access on retryable failure", async () => {
  const appAccountToken = deterministicUUID("worker-app-account-token");
  const targetRow = {
    user_id: "user-1", original_transaction_id: "200000000000002",
    app_account_token: appAccountToken, environment: "production",
  };
  const pool = { query: async () => ({ rows: [targetRow] }) };
  const calls = [];
  const matchingEvent = {
    verified: true, source: "app_store_server_api", eventID: "verified-reconcile-1",
    state: "active", environment: "production", originalTransactionID: targetRow.original_transaction_id,
    transactionID: "transaction-2", appAccountToken, signedPayloadSHA256: "e".repeat(64),
  };
  const accounts = {
    async recordVerifiedAppStoreEvent(userID, event) {
      calls.push({ type: "verified", userID, event });
      return { state: event.state, hasAccess: true, nextReconciliationAt: new Date("2026-07-15T09:00:00.000Z") };
    },
    async recordReconciliationFailure(userID, code) { calls.push({ type: "failure", userID, code }); },
    async recordReconciliationMismatch(userID, code) { calls.push({ type: "mismatch", userID, code }); },
  };
  const handler = createEntitlementReconciliationHandler({
    pool, accountService: accounts,
    appStoreClient: { fetchSubscriptionStatus: async () => matchingEvent },
  });
  const receipt = await handler({ userID: "user-1" }, { extendLease: async (milliseconds) => calls.push({ type: "lease", milliseconds }) });
  assert.equal(receipt.status, "reconciled");
  assert.equal(receipt.hasAccess, true);
  assert.equal(calls.find((call) => call.type === "lease").milliseconds, 120_000);
  assert.equal(calls.filter((call) => call.type === "verified").length, 1);

  calls.length = 0;
  const mismatchHandler = createEntitlementReconciliationHandler({
    pool, accountService: accounts,
    appStoreClient: { fetchSubscriptionStatus: async () => ({ ...matchingEvent, appAccountToken: deterministicUUID("wrong-token") }) },
  });
  assert.equal((await mismatchHandler({ userID: "user-1" })).status, "mismatch");
  assert.equal(calls.find((call) => call.type === "mismatch").code, "APPLE_APP_ACCOUNT_TOKEN_MISMATCH");
  assert.equal(calls.some((call) => call.type === "verified"), false);

  calls.length = 0;
  const retryHandler = createEntitlementReconciliationHandler({
    pool, accountService: accounts,
    appStoreClient: { fetchSubscriptionStatus: async () => { throw new AppStoreServerError("APPLE_5000001", "Try again.", { retryable: true }); } },
  });
  await assert.rejects(() => retryHandler({ userID: "user-1" }), (error) => error.code === "APPLE_5000001" && error.retryable);
  assert.equal(calls.find((call) => call.type === "failure").code, "APPLE_5000001");
  assert.equal(calls.some((call) => call.type === "mismatch"), false);
});

test("PostgreSQL subscription operations curate timelines and transactionally queue accountable retries", async () => {
  const now = new Date("2026-07-15T09:00:00.000Z");
  const userID = deterministicUUID("subscription-operations-user");
  const originalTransactionID = "20000000000000123456";
  const appAccountToken = deterministicUUID("subscription-operations-token");
  const calls = [];
  const subscriptionRow = {
    user_id: userID, state: "active", product_id: "nourish.monthly", environment: "production",
    period_ends_at: new Date("2026-08-15T00:00:00.000Z"), will_auto_renew: true,
    source_event_id: "apple-event-sensitive-reference", last_verified_at: new Date("2026-07-14T09:00:00.000Z"),
    next_reconciliation_at: new Date("2026-07-16T09:00:00.000Z"), reconciliation_status: "mismatch",
    original_transaction_id: originalTransactionID, app_account_token: appAccountToken,
    last_reconciled_at: new Date("2026-07-15T08:50:00.000Z"), reconciliation_attempt_count: 2,
    last_reconciliation_error_code: "APPLE_APP_ACCOUNT_TOKEN_MISMATCH", updated_at: new Date("2026-07-15T08:50:00.000Z"),
    latest_job_id: deterministicUUID("subscription-latest-job"), latest_job_state: "succeeded",
    latest_job_attempt_count: 2, latest_job_max_attempts: 8, latest_job_created_at: new Date("2026-07-15T08:40:00.000Z"),
    latest_job_updated_at: new Date("2026-07-15T08:50:00.000Z"), latest_job_error_code: null,
  };
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return { rows: [] };
      if (text.includes("SELECT reconciliation_status")) return { rows: [{ reconciliation_status: "mismatch" }] };
      return { rows: [] };
    },
    release() { calls.push({ text: "RELEASE", values: [] }); },
  };
  const pool = {
    connect: async () => client,
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("FROM subscriptions subscription")) return { rows: [subscriptionRow] };
      if (text.includes("FROM app_store_events")) return { rows: [{
        app_store_event_id: "event-1", notification_type: "DID_RENEW", environment: "production",
        verified_at: new Date("2026-07-14T09:00:00.000Z"), processing_state: "applied",
        transaction_id: "transaction-sensitive-123456", original_transaction_id: originalTransactionID,
        signed_payload_sha256: "a".repeat(64),
      }] };
      if (text.includes("FROM app_store_notification_inbox")) return { rows: [] };
      if (text.includes("FROM background_jobs")) return { rows: [{
        id: subscriptionRow.latest_job_id, state: "succeeded", attempt_count: 2, max_attempts: 8,
        created_at: new Date("2026-07-15T08:40:00.000Z"), updated_at: new Date("2026-07-15T08:50:00.000Z"),
      }] };
      if (text.includes("FROM subscription_operation_events")) return { rows: [] };
      return { rows: [] };
    },
  };
  const service = new PostgresSubscriptionOperationsService({ pool, now: () => now });
  const listed = await service.list({ status: "attention", search: "nourish.monthly" });
  assert.equal(listed.subscriptions[0].reconciliation.status, "mismatch");
  assert.equal(listed.subscriptions[0].hasAccess, true);
  assert.equal(JSON.stringify(listed).includes(originalTransactionID), false);
  assert.equal(JSON.stringify(listed).includes(appAccountToken), false);
  assert.equal(listed.subscriptions[0].identity.appAccountTokenSHA256.length, 64);

  const detail = await service.detail(userID);
  assert.equal(detail.timeline.some((event) => event.kind === "apple_event"), true);
  assert.equal(detail.timeline.some((event) => event.kind === "reconciliation_job"), true);
  await service.retry(userID, {
    reason: "Verified identity mismatch reviewed; request a fresh Apple status check.",
    actor: { id: "operator.rhea" }, correlationID: "subscription-retry-correlation",
  });
  assert.equal(calls.some((call) => call.text.includes("SET reconciliation_status = 'pending'")), true);
  assert.equal(calls.some((call) => call.text.includes("INSERT INTO background_jobs")), true);
  assert.equal(calls.some((call) => call.text.includes("INSERT INTO subscription_operation_events")), true);
  assert.deepEqual(calls.filter((call) => ["COMMIT", "RELEASE"].includes(call.text)).slice(-2).map((call) => call.text), ["COMMIT", "RELEASE"]);
});

test("PostgreSQL owner analytics parameterize every filter and return defined aggregate-only KPIs and cohorts", async () => {
  const calls = [];
  const pool = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("window_events")) return { rows: [{
        registered_users: 20, onboarded_users: 16, terminal_jobs: 15, succeeded_jobs: 12,
        generated_users: 12, adopted_users: 9, reviewed_users: 6,
        decided_meals: 40, completed_meals: 30, verified_access_users: 11,
        population_users: 20, freshness_at: new Date("2026-07-15T09:30:00Z"),
      }] };
      return { rows: [{
        cohort_start: "2026-07-07", registered_users: 20, onboarded_users: 16,
        generated_users: 12, adopted_users: 9, reviewed_users: 6,
        freshness_at: new Date("2026-07-15T09:30:00Z"),
      }] };
    },
  };
  const service = new PostgresAnalyticsOperationsService({ pool, now: () => new Date("2026-07-15T10:00:00Z") });
  const filters = {
    startDate: "2026-07-01", endDate: "2026-07-14", timeZone: "Asia/Kolkata",
    subscriptionState: "active", appVersion: "1.0.0", acquisitionSource: "organic",
    dietType: "vegetarian", cohort: "subscribers", cohortBy: "registration_week",
  };
  const kpis = await service.kpis(filters);
  assert.equal(kpis.metrics.find((metric) => metric.id === "onboarding_completion_rate").value, 0.8);
  assert.equal(kpis.metrics.every((metric) => metric.formula && !Object.hasOwn(metric, "userID")), true);
  assert.deepEqual(calls[0].values, ["2026-07-01", "2026-07-14", "Asia/Kolkata", "active", "1.0.0", "organic", "vegetarian", "subscribers"]);
  assert.match(calls[0].text, /user_analytics_dimensions/);
  assert.match(calls[0].text, /profile_json->>'diet'/);
  assert.equal(calls[0].text.includes("verified_email"), false);
  const cohorts = await service.cohorts(filters);
  assert.equal(cohorts.rows[0].adoptionRate, 0.75);
  assert.equal(cohorts.tableColumns.some((column) => column.id === "reviewedUsers"), true);
  assert.equal(calls[1].values.length, 9);
  assert.equal(calls[1].values[8], "registration_week");
});

test("PostgreSQL support lookup parameterizes identifiers, minimizes the projection, and commits an append-only audit", async () => {
  const calls = [];
  const now = new Date("2026-07-16T09:00:00.000Z");
  const row = {
    user_id: "1ea36230-1ba4-43ea-8517-da93a32f5319", verified_email: "rhea@example.test",
    created_at: new Date("2026-06-01T08:00:00.000Z"), disabled_at: null,
    profile_revision: 2, profile_updated_at: new Date("2026-07-01T08:00:00.000Z"), active_session_count: 1,
    subscription_state: "active", product_id: "nourish.monthly", period_ends_at: new Date("2026-08-01T08:00:00.000Z"),
    reconciliation_status: "current", last_verified_at: new Date("2026-07-15T08:00:00.000Z"),
    latest_plan_job_id: "plan-job-1", latest_plan_job_state: "succeeded", latest_plan_job_created_at: new Date("2026-07-12T08:00:00.000Z"),
    latest_plan_job_completed_at: new Date("2026-07-12T08:01:00.000Z"), adopted_plan_count: 3,
    latest_adoption_at: new Date("2026-07-13T08:00:00.000Z"), latest_weekly_review_at: new Date("2026-07-14T08:00:00.000Z"),
    latest_export_status: "ready", latest_export_requested_at: new Date("2026-07-10T08:00:00.000Z"),
    latest_deletion_status: null, latest_deletion_requested_at: null,
  };
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return { rows: [] };
      if (text.includes("FROM users user_account")) return { rows: [row] };
      if (text.includes("INSERT INTO support_access_audit_logs")) return { rows: [] };
      throw new Error(`Unexpected support query: ${text}`);
    },
    release() { calls.push({ text: "RELEASE", values: [] }); },
  };
  const service = new PostgresUserSupportService({ pool: { connect: async () => client }, now: () => now });
  const result = await service.lookup({
    verifiedEmail: " RHEA@Example.Test ", reason: "Investigating the verified user's account access report.",
    actor: { id: "support.operator" }, correlationID: "support-pg-found",
  });
  const lookup = calls.find((call) => call.text.includes("FROM users user_account"));
  assert.deepEqual(lookup.values, ["verified_email", "rhea@example.test", now]);
  assert.match(lookup.text, /lower\(user_account\.verified_email\) = \$2/);
  assert.equal(lookup.text.includes("profile_json"), false);
  assert.equal(lookup.text.includes("meal_feedback"), false);
  assert.equal(result.identity.verifiedEmail, "rhea@example.test");
  assert.equal(result.supportBoundary.impersonationAvailable, false);
  const audit = calls.find((call) => call.text.includes("INSERT INTO support_access_audit_logs"));
  assert.equal(audit.values.includes("rhea@example.test"), false);
  assert.equal(audit.values[3].length, 64);
  assert.deepEqual(calls.slice(-2).map((call) => call.text), ["COMMIT", "RELEASE"]);
});

test("PostgreSQL support lookup audits exact-match misses before returning not found", async () => {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text) || text.includes("INSERT INTO support_access_audit_logs")) return { rows: [] };
      if (text.includes("FROM users user_account")) return { rows: [] };
      throw new Error(`Unexpected support query: ${text}`);
    },
    release() { calls.push({ text: "RELEASE", values: [] }); },
  };
  const service = new PostgresUserSupportService({ pool: { connect: async () => client } });
  await assert.rejects(() => service.lookup({
    internalUserID: "missing-user", reason: "Checking the exact identifier supplied by support.",
    actor: { id: "support.operator" }, correlationID: "support-pg-miss",
  }), (error) => error.code === "NOT_FOUND");
  const audit = calls.find((call) => call.text.includes("INSERT INTO support_access_audit_logs"));
  assert.equal(audit.values[6], "not_found");
  assert.deepEqual(calls.slice(-2).map((call) => call.text), ["COMMIT", "RELEASE"]);
});

test("PostgreSQL feature flags save versioned targeting and audit in one transaction", async () => {
  const calls = [];
  const now = new Date("2026-07-16T10:00:00.000Z");
  const row = {
    id: "5153d198-746e-4e12-8c88-80302db9b224", key: "guided_review",
    description: "Enable guided weekly review.", enabled: true, emergency_disabled: false,
    rollout_percentage: 25, minimum_app_version: "1.2.0", maximum_app_version: "2.0.0",
    allowlisted_user_ids: ["internal-user-1"], value_json: { steps: 3 }, version: 1,
    created_by: "security-admin", updated_by: "security-admin", created_at: now, updated_at: now,
  };
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return { rows: [] };
      if (text.includes("FROM feature_flags WHERE key") && text.includes("FOR UPDATE")) return { rows: [] };
      if (text.includes("INSERT INTO feature_flags")) return { rows: [row] };
      if (text.includes("INSERT INTO feature_flag_audit_logs")) return { rows: [] };
      throw new Error(`Unexpected feature flag query: ${text}`);
    },
    release() { calls.push({ text: "RELEASE", values: [] }); },
  };
  const pool = {
    connect: async () => client,
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("FROM feature_flags ORDER BY key")) return { rows: [row] };
      if (text.includes("FROM feature_flag_audit_logs")) return { rows: [] };
      throw new Error(`Unexpected feature flag pool query: ${text}`);
    },
  };
  const service = new PostgresFeatureFlagService({ pool, now: () => now });
  const saved = await service.save({
    key: "guided_review", description: "Enable guided weekly review.", enabled: true,
    emergencyDisabled: false, rolloutPercentage: 25, minimumAppVersion: "1.2.0", maximumAppVersion: "2.0.0",
    allowlistedUserIDs: ["internal-user-1"], value: { steps: 3 },
    reason: "Begin a controlled rollout for the reviewed experience.",
  }, { actor: { id: "security-admin" }, correlationID: "flag-pg-create" });
  assert.equal(saved.flag.version, 1);
  assert.equal(calls.some((call) => call.text.includes("FOR UPDATE")), true);
  const insert = calls.find((call) => call.text.includes("INSERT INTO feature_flags"));
  assert.deepEqual(insert.values.slice(1, 10), ["guided_review", "Enable guided weekly review.", true, false, 25, "1.2.0", "2.0.0", ["internal-user-1"], { steps: 3 }]);
  assert.equal(calls.some((call) => call.text.includes("INSERT INTO feature_flag_audit_logs")), true);
  assert.deepEqual(calls.slice(-2).map((call) => call.text), ["COMMIT", "RELEASE"]);
  const evaluation = await service.evaluate({ userID: "internal-user-1", appVersion: "1.2.0" });
  assert.equal(evaluation.flags[0].reasonCode, "allowlisted");
});

test("privacy workers produce a private export and transactionally erase a user", async () => {
  const now = new Date("2026-07-14T10:00:00.000Z");
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] };
      if (text.includes("UPDATE account_deletion_requests") && text.includes("RETURNING")) {
        return { rows: [{ id: "delete-1", user_id: "user-1", user_subject_sha256: "c".repeat(64) }] };
      }
      return { rows: [] };
    },
    release() { calls.push({ text: "RELEASE", values: [] }); },
  };
  const pool = {
    connect: async () => client,
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("UPDATE account_export_requests") && text.includes("RETURNING")) return { rows: [{ id: "export-1", requested_at: now }] };
      if (text.includes("FROM account_deletion_requests")) return { rows: [{ id: "delete-1", user_subject_sha256: accountSubjectHash("user-1") }] };
      if (text.includes("FROM users")) return { rows: [{ id: "user-1", verified_email: "rhea@example.test", created_at: now, disabled_at: null }] };
      if (text.includes("FROM profiles")) return { rows: [{ revision: 2, profile_json: { diet: "vegetarian" } }] };
      if (text.includes("FROM subscriptions")) return { rows: [{ state: "active" }] };
      return { rows: [] };
    },
  };
  const objectStore = new MemoryPrivateObjectStore();
  const handlers = createPrivacyJobHandlers({ pool, objectStore, now: () => now });
  const exported = await handlers["account.export"]({ id: "job-export", userID: "user-1", payload: { requestID: "export-1", userID: "user-1" } });
  assert.equal(exported.status, "ready");
  assert.equal(objectStore.objects.get(exported.objectKey).account.verified_email, "rhea@example.test");
  assert.equal(JSON.stringify(objectStore.objects.get(exported.objectKey)).includes("access_token"), false);
  assert.equal(calls.some((call) => call.text.includes("FROM meal_feedback")), true);
  assert.equal(calls.some((call) => call.text.includes("FROM weekly_plan_reviews")), true);
  assert.equal(calls.some((call) => call.text.includes("start_local_date") || call.text.includes("FROM feedback ")), false);

  const deleted = await handlers["account.delete"]({ id: "job-delete", payload: { requestID: "delete-1" } });
  assert.equal(deleted.status, "completed");
  assert.equal(objectStore.objects.has(exported.objectKey), false);
  assert.equal(calls.some((call) => call.text === "DELETE FROM users WHERE id = $1"), true);
  assert.equal(calls.some((call) => call.text.includes("set_config('nourish.account_deletion'")), true);
  assert.deepEqual(calls.slice(-2).map((call) => call.text), ["COMMIT", "RELEASE"]);
});

test("filesystem private exports are protected, traversal-safe, and erasable", async (context) => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "nourish-private-"));
  context.after(() => rm(rootDirectory, { recursive: true, force: true }));
  const store = new FilePrivateObjectStore({ rootDirectory });
  const key = "account-exports/subject/export.json";
  await store.putJSON({ key, value: { schemaVersion: "v1", profile: { diet: "vegetarian" } } });
  const path = join(rootDirectory, key);
  assert.equal(JSON.parse(await readFile(path, "utf8")).profile.diet, "vegetarian");
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await assert.rejects(() => store.putJSON({ key: "../escape.json", value: {} }), /invalid/);
  const retainedKey = "account-exports/subject/retained.json";
  await store.putJSON({ key: retainedKey, value: { retained: true } });
  await store.deleteObject(key);
  await assert.rejects(() => access(path), { code: "ENOENT" });
  assert.equal(JSON.parse(await readFile(join(rootDirectory, retainedKey), "utf8")).retained, true);
  await store.deletePrefix("account-exports/subject/");
  await assert.rejects(() => access(join(rootDirectory, retainedKey)), { code: "ENOENT" });
});

test("PostgreSQL plan requests atomically snapshot inputs and enqueue one durable job", async () => {
  const now = new Date("2026-07-14T10:00:00.000Z");
  const calls = [];
  const jobRow = {
    id: deterministicUUID("plan-job"), user_id: "user-1", idempotency_key: "week-1",
    state: "queued", week_start: "2026-07-20", time_zone_identifier: "Asia/Kolkata",
    trigger: "initial", regeneration_reason: null, generator_version: "whole-week-serving-planner-v2",
    scoring_version: "wellness-score-v3", rule_version: "eligibility-rules-v1",
    deterministic_seed_sha256: "d".repeat(64), correlation_id: deterministicUUID("correlation"),
    profile_revision: 3, request_json: {}, diagnostics_json: null, error_category: null,
    retryable: null, created_at: now,
  };
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("INSERT INTO plan_jobs")) return { rows: [jobRow] };
      return { rows: [] };
    },
    release() { calls.push({ text: "RELEASE", values: [] }); },
  };
  const pool = { connect: async () => client, query: (...args) => client.query(...args) };
  const service = new PostgresPlannerService({ pool, now: () => now });
  const profile = durableProfile();
  const job = await service.create({
    userID: "user-1", profile, profileRevision: 3,
    request: { weekStartLocalDate: "2026-07-20", trigger: "initial", deterministicSeed: "stable-seed" },
    idempotencyKey: "week-1", correlationID: "client-correlation",
  });
  assert.equal(job.state, "queued");
  assert.deepEqual(calls.slice(-2).map((call) => call.text), ["COMMIT", "RELEASE"]);
  const insert = calls.find((call) => call.text.includes("INSERT INTO plan_jobs"));
  const requestSnapshot = JSON.parse(insert.values[13]);
  assert.equal(requestSnapshot.profileSnapshot.calorieTarget, profile.calorieTarget);
  assert.equal(insert.values[12], 3);
  assert.equal(insert.values[7], "whole-week-serving-planner-v2");
  assert.equal(insert.values[8], "wellness-score-v3");
  const queueInsert = calls.find((call) => call.text.includes("INSERT INTO background_jobs"));
  assert.deepEqual(Object.keys(JSON.parse(queueInsert.values[3])), ["planJobID", "correlationID"]);
  assert.equal(JSON.parse(queueInsert.values[3]).correlationID, insert.values[11]);
  assert.match(queueInsert.text, /ON CONFLICT \(job_type, idempotency_key\) DO NOTHING/);
});

test("PostgreSQL plan operations expose curated diagnostics and retry evidence without profile snapshots", async () => {
  const now = new Date("2026-07-15T08:00:00.000Z");
  const planJobID = deterministicUUID("operations-plan-job");
  const userID = deterministicUUID("operations-user");
  const correlationID = deterministicUUID("operations-correlation");
  const backgroundJobID = deterministicUUID("operations-background");
  const rows = [{
    id: planJobID, user_id: userID, idempotency_key: "week-ops", state: "rejected",
    week_start: "2026-07-20", time_zone_identifier: "Asia/Kolkata", trigger: "manual_regeneration",
    regeneration_reason: "Preference update", generator_version: "deterministic-planner-v1",
    scoring_version: "wellness-score-v1", rule_version: "eligibility-rules-v1",
    deterministic_seed_sha256: "a".repeat(64), candidate_pool_size: 4,
    diagnostics_json: {
      candidatePoolSize: 4, eligibleCandidateCountBySlot: { breakfast: 2, lunch: 3 },
      rejectedCandidateCounts: { allergenConflict: 5 }, selectedRecipeCount: 0,
      totalIngredientReusePenalty: -14,
      ingredientReusePercentage: 64,
      activeCookingMinutesByDay: { "2026-07-20": 45, "2026-07-21": 0 },
      cookingSessionCount: 8,
      estimatedWasteGrams: null,
      estimatedWasteCoveragePercentage: 0,
      toleranceEvaluation: {
        contractVersion: "planner-tolerance-v1",
        dailyCalorieTolerancePercent: 5,
        weeklyCalorieTolerancePercent: 3,
        optionalProteinTolerancePercent: 10,
        dailyCaloriesWithinToleranceCount: 5,
        dailyCalorieExcess: 82,
        weeklyCaloriesWithinTolerance: true,
        weeklyCalorieExcess: 0,
        optionalProteinOutsideToleranceDayCount: 2,
        dailyCalorieAbsoluteDeviationPercentages: [2, 3, 7, 6, 1, 4, 2],
        weeklyCalorieAbsoluteDeviationPercent: 1.4,
        optionalProteinAbsoluteDeviationGrams: [2, 4, 11, 12, 3, 1, 5],
        relaxations: ["optional_protein", "daily_calories"],
        optimizationPasses: 2,
      },
      explanations: [{ code: "favorite" }, { code: "favorite" }],
    },
    error_category: "NO_FEASIBLE_PLAN", retryable: false, correlation_id: correlationID,
    profile_revision: 7, request_json: {
      lockedPlanItemIDs: [deterministicUUID("locked-item")], includeOptionalSnack: true,
      profileSnapshot: { diet: "vegetarian", calorieTarget: 1900 }, deterministicSeed: "must-not-leak",
    },
    created_at: now, started_at: now, completed_at: new Date(now.getTime() + 1_250), plan_id: null,
    background_job_id: backgroundJobID, background_state: "succeeded", attempt_count: 2, max_attempts: 8,
    available_at: now, locked_at: null, locked_until: null, worker_id: null,
    last_error_code: "CATALOGUE_REFRESH", last_error_message: "Catalogue changed during retry",
    background_updated_at: now, background_completed_at: now,
  }];
  const calls = [];
  const pool = { async query(text, values) { calls.push({ text, values }); return { rows }; } };
  const service = new PostgresPlanOperationsService({ pool });
  const list = await service.list({ state: "rejected", search: String(correlationID), limit: 20 });
  assert.equal(list.runs[0].diagnostics.rejectedCandidateCounts.allergenConflict, 5);
  assert.equal(list.runs[0].diagnostics.totalIngredientReusePenalty, -14);
  assert.equal(list.runs[0].diagnostics.ingredientReusePercentage, 64);
  assert.equal(list.runs[0].diagnostics.activeCookingMinutesByDay["2026-07-20"], 45);
  assert.equal(list.runs[0].diagnostics.cookingSessionCount, 8);
  assert.equal(list.runs[0].diagnostics.estimatedWasteGrams, null);
  assert.equal(list.runs[0].diagnostics.explanationCounts.favorite, 2);
  assert.equal(list.runs[0].diagnostics.toleranceEvaluation.contractVersion, "planner-tolerance-v1");
  assert.equal(list.runs[0].diagnostics.toleranceEvaluation.dailyCaloriesWithinToleranceCount, 5);
  assert.equal(list.runs[0].diagnostics.toleranceEvaluation.dailyCalorieAbsoluteDeviationPercentages.length, 7);
  assert.equal(list.runs[0].diagnostics.toleranceEvaluation.weeklyCalorieAbsoluteDeviationPercent, 1.4);
  assert.deepEqual(list.runs[0].diagnostics.toleranceEvaluation.relaxations, ["optional_protein", "daily_calories"]);
  assert.equal(list.runs[0].retry.attemptCount, 2);
  assert.equal(list.runs[0].durationMilliseconds, 1_250);
  assert.equal(JSON.stringify(list).includes("profileSnapshot"), false);
  assert.equal(JSON.stringify(list).includes("must-not-leak"), false);
  assert.match(calls[0].text, /background\.payload_json->>'planJobID'/);
  assert.match(calls[0].text, /plan\.correlation_id::text ILIKE/);
  assert.deepEqual(calls[0].values, ["rejected", `%${correlationID}%`, 20]);
  const detail = await service.detail(planJobID);
  assert.equal(detail.id, planJobID);
  assert.equal(calls[1].values[0], planJobID);
});

test("durable plan worker materializes a safe varied week and derived operations atomically", async () => {
  const now = new Date("2026-07-14T10:00:00.000Z");
  const calls = [];
  const planJobID = deterministicUUID("worker-plan-job");
  const lockedPlanItemID = deterministicUUID("locked-source-item");
  const lockedRecipe = durableRecipes()[0];
  const lockedItem = {
    id: lockedPlanItemID, localDate: { year: 2026, month: 7, day: 20 }, slot: "breakfast",
    recipeSnapshot: lockedRecipe, servingMultiplier: 1, servingQuantityGrams: lockedRecipe.servingSizeGrams,
    nutrition: lockedRecipe.nutritionPerServing, leftoverRelationship: { none: {} }, completionState: "planned",
  };
  const jobRow = {
    id: planJobID, user_id: "user-1", state: "queued", week_start: "2026-07-20",
    time_zone_identifier: "Asia/Kolkata", trigger: "initial", profile_revision: 2,
    request_json: {
      weekStartLocalDate: "2026-07-20", trigger: "initial", deterministicSeed: "durable-week",
      profileSnapshot: durableProfile(), lockedPlanItemIDs: [lockedPlanItemID],
    },
  };
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("SELECT state FROM plan_jobs")) return { rows: [{ state: "generating" }] };
      return { rows: [] };
    },
    release() { calls.push({ text: "RELEASE", values: [] }); },
  };
  const pool = {
    connect: async () => client,
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("FROM plan_jobs job")) return { rows: [jobRow] };
      return { rows: [] };
    },
  };
  const handler = createPlanJobHandler({
    pool,
    catalogueReader: { publishedSnapshots: async () => durableRecipes() },
    planService: { lockedItems: async () => [lockedItem] },
    now: () => now,
  });
  const result = await handler({ id: deterministicUUID("background"), userID: "user-1", payload: { planJobID } });
  assert.equal(result.state, "succeeded");
  assert.equal(isUUID(result.planID), true);
  const planInsert = calls.find((call) => call.text.includes("INSERT INTO weekly_plans"));
  assert.ok(planInsert);
  const persistedDiagnostics = JSON.parse(planInsert.values[11]);
  assert.equal(persistedDiagnostics.toleranceEvaluation.dailyCalorieAbsoluteDeviationPercentages.length, 7);
  assert.equal(Number.isFinite(persistedDiagnostics.toleranceEvaluation.weeklyCalorieAbsoluteDeviationPercent), true);
  assert.equal(Number.isFinite(persistedDiagnostics.ingredientReusePercentage), true);
  assert.equal(Object.keys(persistedDiagnostics.activeCookingMinutesByDay).length, 7);
  assert.ok(persistedDiagnostics.cookingSessionCount > 0);
  assert.equal(persistedDiagnostics.estimatedWasteGrams, null);
  assert.equal(persistedDiagnostics.estimatedWasteCoveragePercentage, 0);
  const itemInserts = calls.filter((call) => call.text.includes("INSERT INTO plan_items"));
  assert.equal(itemInserts.length, 21);
  assert.equal(new Set(itemInserts.map((call) => call.values[0])).size, 21);
  assert.ok(itemInserts.every((call) => isUUID(call.values[0])));
  const lockedInsert = itemInserts.find((call) => call.values[11] === lockedPlanItemID);
  assert.ok(lockedInsert);
  assert.notEqual(lockedInsert.values[0], lockedPlanItemID);
  assert.ok(calls.some((call) => call.text.includes("INSERT INTO grocery_lists")));
  assert.ok(calls.some((call) => call.text.includes("INSERT INTO prep_tasks")));
  assert.ok(calls.some((call) => call.text.includes("SET state = 'succeeded'")));
  assert.deepEqual(calls.slice(-2).map((call) => call.text), ["COMMIT", "RELEASE"]);
});

test("durable feedback validates ownership before inserting bounded PostgreSQL records", async () => {
  const now = new Date("2026-07-14T10:00:00.000Z");
  const calls = [];
  const pool = {
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [{ id: deterministicUUID("feedback"), submitted_at: now }] };
    },
  };
  const service = new FeedbackService({
    planService: { ownsPlanItem: async () => true, ownsPlan: async () => true },
    store: new PostgresFeedbackStore({ pool }), now: () => now,
  });
  const receipt = await service.submit("user-1", {
    subjectType: "meal", planItemID: deterministicUUID("meal"), recipeID: "recipe-1",
    rating: 4, reasonTags: ["taste", "effort"], note: "Balanced and practical.",
  });
  assert.equal(receipt.status, "recorded");
  assert.match(calls[0].text, /INSERT INTO meal_feedback/);
  assert.deepEqual(calls[0].values[5], ["taste", "effort"]);
});

test("memory feedback remains compatible with the asynchronous service boundary", async () => {
  const service = new FeedbackService({
    planService: { ownsPlanItem: async () => true, ownsPlan: async () => true },
  });
  const receipt = await service.submit("user-1", {
    subjectType: "meal", planItemID: "memory-item", rating: 5, reasonTags: ["taste"],
  });
  assert.equal(receipt.id, "feedback-1");
  assert.equal(receipt.status, "recorded");
});

test("PostgreSQL adoption activates a first plan now and schedules later renewals", async () => {
  const now = new Date("2026-07-14T10:00:00.000Z");
  const planID = deterministicUUID("adoption-plan");
  async function adoptionWith(priorRows) {
    const calls = [];
    const client = {
      async query(text, values) {
        calls.push({ text, values });
        if (text.includes("idempotency_key = $2")) return { rows: [] };
        if (text.startsWith("SELECT id, week_start")) return { rows: [{ id: planID, week_start: "2026-07-20", time_zone_identifier: "Asia/Kolkata" }] };
        if (text.includes("adoption.weekly_plan_id = $2")) return { rows: [] };
        if (text.includes("FROM plan_adoptions adoption") && text.includes("ORDER BY")) return { rows: priorRows };
        if (text.includes("INSERT INTO plan_adoptions")) return { rows: [{ weekly_plan_id: planID, adopted_at: now, activates_on: values[4] }] };
        return { rows: [] };
      },
      release() { calls.push({ text: "RELEASE", values: [] }); },
    };
    const service = new PostgresPlannerService({ pool: { connect: async () => client, query: (...args) => client.query(...args) }, now: () => now });
    return { receipt: await service.adopt(planID, "user-1", `adopt-${priorRows.length}`), calls };
  }
  const first = await adoptionWith([]);
  assert.equal(first.receipt.status, "adopted");
  assert.equal(first.calls.find((call) => call.text.includes("INSERT INTO plan_adoptions")).values[4], "2026-07-14");
  const renewal = await adoptionWith([{
    weekly_plan_id: deterministicUUID("current-plan"), activates_on: "2026-07-14",
    adopted_at: now, time_zone_identifier: "Asia/Kolkata",
  }]);
  assert.equal(renewal.receipt.status, "scheduled");
  assert.equal(renewal.calls.find((call) => call.text.includes("INSERT INTO plan_adoptions")).values[4], "2026-07-20");
});

test("durable meal state uses ownership and optimistic revision checks in one transaction", async () => {
  const now = new Date("2026-07-14T10:00:00.000Z");
  const itemID = deterministicUUID("operational-item");
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("SELECT item.id FROM plan_items")) return { rows: [{ id: itemID }] };
      if (text.includes("SELECT revision FROM plan_item_operational_states")) return { rows: [] };
      if (text.includes("INSERT INTO plan_item_operational_states")) return { rows: [{ revision: 1 }] };
      return { rows: [] };
    },
    release() { calls.push({ text: "RELEASE", values: [] }); },
  };
  const service = new PostgresWeeklyLoopService({
    pool: { connect: async () => client, query: (...args) => client.query(...args) },
    planService: {}, catalogueReader: {}, now: () => now,
  });
  const receipt = await service.updateMealStatus({ itemID, userID: "user-1", state: "completed", expectedRevision: 0 });
  assert.equal(receipt.revision, 1);
  assert.equal(receipt.state, "completed");
  assert.match(calls.find((call) => call.text.includes("INSERT INTO plan_item_operational_states")).text, /ON CONFLICT/);
  assert.deepEqual(calls.slice(-2).map((call) => call.text), ["COMMIT", "RELEASE"]);
});

test("durable swap successor is immutable, variety-safe, and preserves only compatible user state", () => {
  const sourcePlan = durableSwapPlan();
  const sourceItem = sourcePlan.days[2].items[0];
  const replacement = swapRecipe("swap-replacement", "common-spinach", 160);
  replacement.minimumServingMultiplier = 0.75;
  replacement.maximumServingMultiplier = 1.25;
  replacement.ingredients.push({
    ingredientID: "new-lemon", displayName: "Lemon", category: "produce",
    householdQuantity: 1, householdUnit: "piece", grams: 40, allergenIDs: [],
  });
  const successor = buildDurableSwapSuccessor({
    sourcePlan,
    sourceDiagnostics: { explanations: [{ planItemID: sourceItem.id, reasonCodes: ["targetFit"] }] },
    sourceItemID: sourceItem.id,
    replacement,
    servingMultiplier: 1.25,
    userID: "user-1",
    idempotencyKey: "swap-once",
  });
  assert.equal(isUUID(successor.resultPlan.id), true);
  assert.notEqual(successor.resultPlan.id, sourcePlan.id);
  assert.equal(successor.resultPlan.days.flatMap((day) => day.items).every((item) => isUUID(item.id)), true);
  assert.equal(sourcePlan.days[2].items[0].recipeSnapshot.recipeID, "standalone-meal");
  const swapped = successor.resultPlan.days[2].items[0];
  assert.equal(swapped.recipeSnapshot.recipeID, "swap-replacement");
  assert.equal(swapped.completionState, "planned");
  assert.equal(swapped.servingMultiplier, 1.25);
  assert.equal(swapped.nutrition.calories, replacement.nutritionPerServing.calories * 1.25);
  assert.equal(successor.diagnostics.explanations[0].planItemID, swapped.id);
  assert.ok(successor.diagnostics.explanations.some((item) => item.planItemID === swapped.id && item.code === "servingAdjusted"));
  const newReuse = successor.resultPlan.days[1].items[0];
  assert.equal(newReuse.leftoverRelationship.plannedReuse.sourcePlanItemID, successor.oldToNew.get(sourcePlan.days[0].items[0].id));

  const previousDerived = deriveWeeklyLoop(sourcePlan);
  const common = previousDerived.groceryList.items.find((item) => item.ingredientID === "common-spinach");
  common.disposition = "checked";
  common.userAdjustedGrams = 275;
  const priorPrep = previousDerived.prepTimeline;
  priorPrep.tasks[0].isComplete = true;
  priorPrep.tasks[0].revision = 3;
  const operations = buildPreservedSwapOperations({
    resultPlan: successor.resultPlan,
    oldToNew: successor.oldToNew,
    previousGroceryList: previousDerived.groceryList,
    previousPrepTimeline: priorPrep,
  });
  const preserved = operations.groceryList.items.find((item) => item.ingredientID === "common-spinach");
  assert.equal(preserved.disposition, "checked");
  assert.equal(preserved.userAdjustedGrams, 275);
  assert.equal(preserved.changedBySwap, true);
  assert.equal(operations.groceryList.items.find((item) => item.ingredientID === "new-lemon").newlyAddedBySwap, true);
  assert.equal(operations.prepTimeline.tasks[0].isComplete, true);
  assert.equal(operations.prepTimeline.tasks[0].revision, 3);

  assert.throws(() => buildDurableSwapSuccessor({
    sourcePlan,
    sourceDiagnostics: {},
    sourceItemID: sourceItem.id,
    replacement,
    servingMultiplier: 1.5,
    userID: "user-1",
    idempotencyKey: "unreviewed-serving",
  }), (error) => error.code === "VALIDATION_ERROR");
  assert.throws(() => buildDurableSwapSuccessor({
    sourcePlan,
    sourceDiagnostics: {},
    sourceItemID: sourcePlan.days[0].items[0].id,
    replacement,
    userID: "user-1",
    idempotencyKey: "unsafe-batch",
  }), (error) => error.code === "CONFLICT");
  const repeated = structuredClone(sourcePlan.days[0].items[0].recipeSnapshot);
  repeated.recipeVersionID = deterministicUUID("another-version-of-batch");
  assert.throws(() => buildDurableSwapSuccessor({
    sourcePlan,
    sourceDiagnostics: {},
    sourceItemID: sourceItem.id,
    replacement: repeated,
    userID: "user-1",
    idempotencyKey: "repeat-fresh",
  }), (error) => error.code === "NO_FEASIBLE_PLAN");
});

test("confirmed PostgreSQL swap atomically audits an immutable successor and transfers active adoption", async () => {
  const now = new Date("2026-07-14T10:00:00.000Z");
  const sourcePlan = durableSwapPlan();
  const sourceItem = sourcePlan.days[2].items[0];
  const unchangedItem = sourcePlan.days[1].items[0];
  const replacement = swapRecipe("transaction-replacement", "common-spinach", 150);
  const previous = deriveWeeklyLoop(sourcePlan).groceryList;
  const groceryRows = previous.items.map((item) => ({
    id: deterministicUUID(`old-grocery-${item.ingredientID}`),
    ingredient_id: item.ingredientID,
    display_name_snapshot: item.displayName,
    category_snapshot: item.category,
    required_grams: item.requiredGrams,
    household_quantities_json: item.householdQuantities,
    user_adjusted_grams: item.ingredientID === "common-spinach" ? 275 : null,
    disposition: item.ingredientID === "common-spinach" ? "checked" : "needed",
    changed_by_swap: false,
    newly_added_by_swap: false,
  }));
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return { rows: [] };
      if (text.includes("FROM plan_swap_mutations") && text.includes("SELECT")) return { rows: [] };
      if (text.includes("FOR UPDATE OF item")) return { rows: [{ id: sourceItem.id, weekly_plan_id: sourcePlan.id }] };
      if (text.includes("SELECT revision, profile_json FROM profiles")) return { rows: [{ revision: 4, profile_json: durableProfile() }] };
      if (text.includes("FROM grocery_lists WHERE weekly_plan_id")) {
        return { rows: [{ id: deterministicUUID("old-grocery-list"), weekly_plan_id: sourcePlan.id, revision: 3 }] };
      }
      if (text.includes("FROM grocery_items item") && text.includes("list.weekly_plan_id")) return { rows: groceryRows };
      if (text.includes("SELECT task.* FROM prep_tasks")) return { rows: [] };
      if (text.includes("SELECT state.plan_item_id") && text.includes("item.weekly_plan_id")) {
        return { rows: [
          { plan_item_id: sourceItem.id, completion_state: "completed", revision: 2, updated_at: now },
          { plan_item_id: unchangedItem.id, completion_state: "skipped", revision: 3, updated_at: now },
        ] };
      }
      if (text.includes("FROM plan_adoptions") && text.includes("FOR UPDATE")) {
        return { rows: [{ id: deterministicUUID("source-adoption"), adopted_at: new Date(now.getTime() - 60_000), activates_on: "2026-07-14", superseded_at: null }] };
      }
      if (text.includes("UPDATE plan_adoptions SET superseded_at")) return { rows: [{ id: values[0] }] };
      return { rows: [] };
    },
    release() { calls.push({ text: "RELEASE", values: [] }); },
  };
  const pool = {
    connect: async () => client,
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("FROM plan_swap_mutations")) return { rows: [] };
      if (text.includes("SELECT item.weekly_plan_id")) return { rows: [{ weekly_plan_id: sourcePlan.id }] };
      return { rows: [] };
    },
  };
  const service = new PostgresWeeklyLoopService({
    pool,
    planService: { read: async () => ({ plan: structuredClone(sourcePlan), diagnostics: { candidatePoolSize: 3, explanations: [] } }) },
    catalogueReader: { publishedSnapshots: async () => [replacement] },
    now: () => now,
  });
  const receipt = await service.applySwap({
    itemID: sourceItem.id,
    replacementRecipeID: replacement.recipeID,
    userID: "user-1",
    profile: durableProfile(),
    idempotencyKey: "transaction-swap",
  });
  assert.equal(receipt.supersedesPlanID, sourcePlan.id);
  assert.equal(receipt.plan.days[2].items[0].recipeSnapshot.recipeID, replacement.recipeID);
  assert.equal(receipt.plan.days[2].items[0].completionState, "planned");
  assert.equal(receipt.plan.days[1].items[0].completionState, "skipped");
  assert.equal(receipt.groceryList.items.find((item) => item.ingredientID === "common-spinach").disposition, "checked");
  assert.ok(calls.some((call) => call.text.includes("INSERT INTO plan_swap_mutations")));
  assert.ok(calls.some((call) => call.text.includes("pg_advisory_xact_lock")));
  assert.ok(calls.some((call) => call.text.includes("INSERT INTO weekly_plans")));
  assert.ok(calls.some((call) => call.text.includes("UPDATE plan_adoptions SET superseded_at")));
  assert.ok(calls.some((call) => call.text.includes("INSERT INTO plan_adoptions")));
  const stateInserts = calls.filter((call) => call.text.includes("INSERT INTO plan_item_operational_states"));
  assert.equal(stateInserts.length, 1);
  assert.equal(stateInserts[0].values[2], "skipped");
  assert.equal(calls.some((call) => call.text === "ROLLBACK"), false);
  assert.deepEqual(calls.slice(-2).map((call) => call.text), ["COMMIT", "RELEASE"]);
});

test("confirmed PostgreSQL swap idempotency replays the saved successor without another transaction", async () => {
  const createdAt = new Date("2026-07-14T10:00:00.000Z");
  const sourcePlanID = deterministicUUID("replay-source-plan");
  const resultPlan = durableSwapPlan();
  resultPlan.id = deterministicUUID("replay-result-plan");
  const listID = deterministicUUID("replay-grocery-list");
  const calls = [];
  const pool = {
    connect: async () => { throw new Error("idempotent replay must not start a transaction"); },
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("FROM plan_swap_mutations")) return { rows: [{
        source_weekly_plan_id: sourcePlanID,
        result_weekly_plan_id: resultPlan.id,
        created_at: createdAt,
      }] };
      if (text === "SELECT id FROM grocery_lists WHERE weekly_plan_id = $1 AND user_id = $2") return { rows: [{ id: listID }] };
      if (text.includes("SELECT id, weekly_plan_id, revision FROM grocery_lists WHERE id")) {
        return { rows: [{ id: listID, weekly_plan_id: resultPlan.id, revision: 1 }] };
      }
      if (text.includes("FROM grocery_items item") && text.includes("item.grocery_list_id")) return { rows: [] };
      if (text.includes("SELECT task.* FROM prep_tasks")) return { rows: [] };
      if (text.includes("SELECT state.plan_item_id")) return { rows: [] };
      return { rows: [] };
    },
  };
  const service = new PostgresWeeklyLoopService({
    pool,
    planService: { read: async () => ({ plan: structuredClone(resultPlan), diagnostics: {} }) },
    catalogueReader: { publishedSnapshots: async () => { throw new Error("catalogue must not be read on replay"); } },
  });
  const receipt = await service.applySwap({
    itemID: deterministicUUID("irrelevant-replay-item"),
    replacementRecipeID: "irrelevant",
    userID: "user-1",
    profile: durableProfile(),
    idempotencyKey: "already-saved",
  });
  assert.equal(receipt.plan.id, resultPlan.id);
  assert.equal(receipt.supersedesPlanID, sourcePlanID);
  assert.equal(receipt.swappedAt.toISOString(), createdAt.toISOString());
  assert.equal(calls.some((call) => call.text === "BEGIN" || call.text.includes("INSERT INTO")), false);
});

test("plan job records terminal failure only when its durable retry budget is exhausted", async () => {
  const calls = [];
  const planJobID = deterministicUUID("exhausted-plan");
  const pool = {
    connect: async () => { throw new Error("transaction should not start"); },
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("FROM plan_jobs job")) return { rows: [{
        id: planJobID, user_id: "user-1", state: "generating", request_json: { profileSnapshot: durableProfile() },
      }] };
      return { rows: [] };
    },
  };
  const handler = createPlanJobHandler({
    pool,
    catalogueReader: { publishedSnapshots: async () => { throw new Error("database unavailable"); } },
    planService: { lockedItems: async () => [] },
  });
  await assert.rejects(() => handler({
    id: deterministicUUID("exhausted-background"), userID: "user-1",
    payload: { planJobID }, attemptCount: 8, maxAttempts: 8,
  }), /database unavailable/);
  const failed = calls.find((call) => call.text.includes("SET state = 'failed'"));
  assert.ok(failed);
  assert.match(failed.text, /error_category = 'TEMPORARY_FAILURE'/);
});

test("PostgreSQL catalogue creates one auditable draft in a transaction", async () => {
  const now = new Date("2026-07-15T08:00:00.000Z");
  const { recipe, content } = durableCatalogueFixture(now);
  const calls = [];
  const client = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return { rows: [] };
      if (text.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (text.includes("workflow_state IN ('draft', 'in_review', 'rejected')")) return { rows: [] };
      if (text.includes("INSERT INTO recipes")) return { rows: [] };
      if (text.includes("COALESCE(MAX(version)")) return { rows: [{ version: "2" }] };
      if (text.includes("INSERT INTO recipe_versions")) {
        return { rows: [{
          id: values[0], recipe_id: values[1], version: values[2], content_json: JSON.parse(values[19]),
          workflow_state: "draft", authored_by: values[16], created_at: values[17], submitted_at: null,
          reviewed_by: null, reviewed_at: null, published_at: null, rejection_reason: null,
        }] };
      }
      if (text.includes("INSERT INTO catalogue_audit_logs")) return { rows: [] };
      throw new Error(`Unexpected catalogue query: ${text}`);
    },
    release() { calls.push({ text: "RELEASE", values: [] }); },
  };
  const pool = { query: async () => ({ rows: [] }), connect: async () => client };
  const service = new PostgresCatalogueService({ pool, now: () => now });

  const draft = await service.createRecipeDraft(recipe, content, { id: "author-from-idp", roles: ["author"] });

  assert.equal(draft.recipeID, recipe.id);
  assert.equal(draft.version, 3);
  assert.equal(draft.workflowState, "draft");
  assert.deepEqual(draft.content, content);
  assert.deepEqual(calls.filter((call) => ["BEGIN", "COMMIT", "RELEASE"].includes(call.text)).map((call) => call.text), ["BEGIN", "COMMIT", "RELEASE"]);
  assert.equal(calls.some((call) => call.text.includes("pg_advisory_xact_lock")), true);
  const insertedVersion = calls.find((call) => call.text.includes("INSERT INTO recipe_versions"));
  assert.deepEqual(JSON.parse(insertedVersion.values[18]), recipe);
  assert.equal(insertedVersion.values[16], "author-from-idp");
  assert.equal(calls.some((call) => call.text.includes("recipe_version_ingredients")), false);
  const audit = calls.find((call) => call.text.includes("INSERT INTO catalogue_audit_logs"));
  assert.equal(audit.values[1], "author-from-idp");
  assert.equal(audit.values[2], "recipe_version.created");
});

test("PostgreSQL catalogue ingests reviewed ingredients and immutable nutrient provenance", async () => {
  const now = new Date("2026-07-15T08:00:00.000Z");
  const { ingredient, nutrientID } = durableCatalogueFixture(now);
  const sourceID = deterministicUUID("durable-catalogue-source");
  const completeIngredient = {
    ...ingredient, aliases: ["palak"], category: "produce", allergenIDs: [],
    conversions: [{ householdUnit: "cup", householdQuantity: 1, grams: 60 }],
  };
  const record = {
    id: nutrientID, ingredientID: ingredient.id,
    nutritionPer100Grams: { calories: 23, proteinGrams: 2.9, carbohydrateGrams: 3.6, fatGrams: 0.4, fibreGrams: 2.2 },
    source: {
      id: sourceID, provider: "Licensed fixture provider", dataset: "Test nutrients",
      datasetVersion: "2026.1", sourceRecordID: "spinach-raw", sourceURL: "https://example.test/spinach",
      licenseStatus: "approvedForProduction", retrievedAt: now.toISOString(),
    },
    confidence: "high", effectiveFrom: new Date(now.getTime() - 86_400_000).toISOString(), effectiveUntil: null,
  };
  const calls = [];
  const client = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return { rows: [] };
      if (text.includes("SELECT id FROM ingredients")) return { rows: [{ id: ingredient.id }] };
      if (text.includes("SELECT * FROM nutrient_sources")) return { rows: [] };
      if (text.includes("INSERT INTO ingredient_nutrients")) return { rows: [{ id: nutrientID }] };
      return { rows: [] };
    },
    release() { calls.push({ text: "RELEASE", values: [] }); },
  };
  const pool = { query: async () => ({ rows: [] }), connect: async () => client };
  const service = new PostgresCatalogueService({ pool, now: () => now });

  const savedIngredient = await service.upsertIngredient(completeIngredient, { id: "content-reviewer", roles: ["reviewer"] });
  const savedNutrient = await service.registerReviewedNutrientRecord(record, { id: "nutrition-reviewer", roles: ["reviewer"] });

  assert.equal(savedIngredient.sourceStatus, "verified");
  assert.equal(savedIngredient.reviewedBy, "content-reviewer");
  assert.equal(savedNutrient.reviewedBy, "nutrition-reviewer");
  assert.equal(calls.some((call) => call.text.includes("INSERT INTO ingredient_unit_conversions")), true);
  const nutrientInsert = calls.find((call) => call.text.includes("INSERT INTO ingredient_nutrients"));
  assert.equal(nutrientInsert.values[11], "nutrition-reviewer");
  assert.equal(calls.filter((call) => call.text.includes("INSERT INTO catalogue_content_audit_logs")).length, 2);
  assert.deepEqual(
    calls.filter((call) => call.text.includes("INSERT INTO catalogue_content_audit_logs")).map((call) => call.values[2]),
    ["ingredient.verified", "nutrient_record.reviewed"],
  );
});

test("PostgreSQL catalogue inventory restores verified conversions and immutable provenance", async () => {
  const now = new Date("2026-07-15T08:00:00.000Z");
  const nutrientID = deterministicUUID("inventory-nutrient");
  const sourceID = deterministicUUID("inventory-source");
  const pool = {
    connect: async () => { throw new Error("not used"); },
    async query(text) {
      if (text.includes("FROM ingredients")) return { rows: [{
        id: "spinach", canonical_name: "Spinach", aliases: ["palak"], category: "produce",
        compatible_diets: ["vegan", "vegetarian"], allergen_ids: [], source_status: "verified", updated_at: now,
      }] };
      if (text.includes("FROM ingredient_unit_conversions")) return { rows: [{
        ingredient_id: "spinach", household_unit: "cup", household_quantity: "1.0000", grams: "60.0000",
      }] };
      if (text.includes("FROM ingredient_nutrients nutrient")) return { rows: [{
        id: nutrientID, ingredient_id: "spinach", calories_per_100g: "23.0000", protein_g_per_100g: "2.9000",
        carbohydrate_g_per_100g: "3.6000", fat_g_per_100g: "0.4000", fibre_g_per_100g: "2.2000",
        confidence: "high", effective_from: now, effective_until: null, reviewed_by: deterministicUUID("reviewer"), reviewed_at: now,
        source_id: sourceID, provider: "Licensed fixture provider", dataset: "Test nutrients", dataset_version: "2026.1",
        source_record_id: "spinach-raw", source_url: "https://example.test/spinach",
        license_status: "approved_for_production", retrieved_at: now,
      }] };
      return { rows: [] };
    },
  };
  const inventory = await new PostgresCatalogueService({ pool }).contentInventory();
  assert.equal(inventory.ingredients[0].conversions[0].grams, 60);
  assert.equal(inventory.nutrientRecords[0].nutritionPer100Grams.proteinGrams, 2.9);
  assert.equal(inventory.nutrientRecords[0].source.licenseStatus, "approvedForProduction");
  assert.equal(inventory.nutrientRecords[0].source.id, sourceID);
});

test("catalogue dashboard queue exposes validation, evidence, and combined audit without changing workflow", () => {
  const now = new Date("2026-07-15T08:00:00.000Z");
  const { ingredient, recipe, content } = durableCatalogueFixture(now);
  const nutrientRecord = {
    id: content.nutrientRecordIDs[0], ingredientID: ingredient.id,
    nutritionPer100Grams: { calories: 23, proteinGrams: 2.9, carbohydrateGrams: 3.6, fatGrams: 0.4, fibreGrams: 2.2 },
    source: {
      id: "memory-source", provider: "Licensed fixture provider", dataset: "Test nutrients",
      datasetVersion: "2026.1", sourceRecordID: "spinach-raw", licenseStatus: "approvedForProduction",
      retrievedAt: now.toISOString(),
    },
    confidence: "high", effectiveFrom: new Date(now.getTime() - 86_400_000).toISOString(), effectiveUntil: null,
  };
  const service = new CatalogueService({ store: new MemoryCatalogueStore(), now: () => now });
  service.upsertIngredient({
    ...ingredient, aliases: [], category: "produce", allergenIDs: [],
    conversions: [{ householdUnit: "cup", householdQuantity: 1, grams: 60 }],
  }, { id: "content-reviewer", roles: ["reviewer"] });
  service.registerReviewedNutrientRecord(nutrientRecord, { id: "nutrition-reviewer", roles: ["reviewer"] });
  const draft = service.createRecipeDraft(recipe, content, { id: "recipe-author", roles: ["author"] });

  const [queued] = service.reviewQueue();
  assert.equal(queued.id, draft.id);
  assert.deepEqual(queued.validationIssues, []);
  assert.equal(queued.nutrientEvidence[0].source.provider, "Licensed fixture provider");
  assert.equal(queued.workflowState, "draft");
  assert.deepEqual(service.catalogueAuditLog().map((event) => event.action).sort(), [
    "ingredient.verified", "nutrient_record.reviewed", "recipe_version.created",
  ]);
  assert.equal(service.version(draft.id).workflowState, "draft");
});

test("PostgreSQL catalogue validates, separates reviewer authority, and publishes atomically", async () => {
  const now = new Date("2026-07-15T08:00:00.000Z");
  const { ingredient, nutrientID, recipe, content } = durableCatalogueFixture(now);
  const versionID = deterministicUUID("durable-catalogue-version");
  let versionRow = {
    id: versionID, recipe_id: recipe.id, version: 1, content_json: content,
    workflow_state: "draft", authored_by: "author-1", created_at: now,
    submitted_at: null, reviewed_by: null, reviewed_at: null, published_at: null, rejection_reason: null,
  };
  const calls = [];
  const client = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return { rows: [] };
      if (text.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (text.includes("WHERE recipe_id = $1 AND workflow_state = 'draft'")) {
        return { rows: versionRow.workflow_state === "draft" ? [{ ...versionRow }] : [] };
      }
      if (text === "SELECT * FROM recipe_versions WHERE id = $1 FOR UPDATE") return { rows: [{ ...versionRow }] };
      if (text.includes("FROM ingredients WHERE id = ANY")) {
        return { rows: [{
          id: ingredient.id, canonical_name: ingredient.canonicalName,
          compatible_diets: ingredient.compatibleDiets, allergen_ids: ingredient.allergenIDs,
          source_status: "verified",
        }] };
      }
      if (text.includes("FROM ingredient_nutrients nutrient")) {
        return { rows: [{
          id: nutrientID, ingredient_id: ingredient.id,
          effective_from: new Date(now.getTime() - 86_400_000), effective_until: null,
          reviewed_by: "nutrition-reviewer", reviewed_at: now,
          provider: "Licensed fixture provider", dataset: "Test nutrients",
          dataset_version: "2026.1", license_status: "approved_for_production",
        }] };
      }
      if (text.startsWith("DELETE FROM") || text.includes("INSERT INTO recipe_version_ingredients")
        || text.includes("INSERT INTO recipe_version_steps") || text.includes("INSERT INTO recipe_version_nutrient_evidence")) return { rows: [] };
      if (text.includes("workflow_state = 'in_review'")) {
        versionRow = { ...versionRow, workflow_state: "in_review", submitted_at: values[14] };
        return { rows: [{ ...versionRow }] };
      }
      if (text.includes("workflow_state = 'published'")) {
        versionRow = {
          ...versionRow, workflow_state: "published", reviewed_by: values[1], reviewed_at: values[2],
          published_at: values[2], rejection_reason: null,
        };
        return { rows: [{ ...versionRow }] };
      }
      if (text.includes("UPDATE recipes SET current_published_version_id")) return { rows: [] };
      if (text.includes("INSERT INTO catalogue_audit_logs")) return { rows: [] };
      throw new Error(`Unexpected catalogue query: ${text}`);
    },
    release() { calls.push({ text: "RELEASE", values: [] }); },
  };
  const pool = { query: async () => ({ rows: [] }), connect: async () => client };
  const service = new PostgresCatalogueService({ pool, now: () => now });

  const submitted = await service.submitLatestDraft(recipe.id, { id: "author-1", roles: ["author"] });
  assert.equal(submitted.workflowState, "inReview");
  await assert.rejects(
    () => service.approve(versionID, { id: "author-1", roles: ["reviewer"] }),
    (error) => error.code === "VALIDATION_ERROR" && error.status === 403,
  );
  assert.equal(calls.some((call) => call.text === "ROLLBACK"), true);

  const published = await service.approve(versionID, { id: "reviewer-2", roles: ["reviewer"] });
  assert.equal(published.workflowState, "published");
  assert.equal(published.reviewedBy, "reviewer-2");
  const pointerUpdate = calls.find((call) => call.text.includes("UPDATE recipes SET current_published_version_id"));
  assert.deepEqual(pointerUpdate.values.slice(0, 2), [recipe.id, versionID]);
  assert.equal(calls.filter((call) => call.text.includes("INSERT INTO recipe_version_ingredients")).length, 2);
  assert.deepEqual(
    calls.filter((call) => call.text.includes("INSERT INTO catalogue_audit_logs")).map((call) => call.values[2]),
    ["recipe_version.submitted", "recipe_version.published"],
  );
});

test("published catalogue snapshots use immutable version metadata", async () => {
  const versionID = deterministicUUID("catalogue-reader-version");
  const pool = {
    async query(text) {
      if (text.includes("FROM recipe_versions version") && text.includes("version.display_name")) {
        return { rows: [{
          recipe_version_id: versionID, recipe_id: "immutable-recipe", version: 4,
          display_name: "Immutable recipe", serving_size_grams: 300,
          calories_per_serving: 500, protein_g_per_serving: 25, carbohydrate_g_per_serving: 60,
          fat_g_per_serving: 18, fibre_g_per_serving: 10, diet_type: "vegetarian",
          declared_allergen_ids: [], dominant_ingredient_ids: ["spinach"], tags: ["quick"],
          nutrition_calculation_version: "weighted-v2",
          content_json: { minimumServingMultiplier: 0.8, maximumServingMultiplier: 1.3 },
          recipe_metadata_json: { eligibleSlots: ["dinner"], activePreparationMinutes: 8, totalMinutes: 12 },
          locale_identifier: "en-IN",
          eligible_slots: ["breakfast"], active_preparation_minutes: 99, total_minutes: 120,
        }] };
      }
      if (text.includes("FROM recipe_version_ingredients")) return { rows: [{
        recipe_version_id: versionID, position: 0, ingredient_id: "spinach", canonical_name: "Spinach",
        category: "produce", allergen_ids: [], household_quantity: 2, household_unit: "cups", grams: 120,
      }] };
      if (text.includes("FROM recipe_version_steps")) return { rows: [{ recipe_version_id: versionID, position: 0, instruction: "Cook safely." }] };
      if (text.includes("FROM recipe_version_nutrient_evidence")) return { rows: [{
        recipe_version_id: versionID, provider: "Provider", dataset: "Dataset", dataset_version: "2026.1",
      }] };
      throw new Error(`Unexpected catalogue reader query: ${text}`);
    },
  };

  const [snapshot] = await new PostgresCatalogueReader({ pool }).publishedSnapshots();
  assert.deepEqual(snapshot.eligibleSlots, ["dinner"]);
  assert.equal(snapshot.activePreparationMinutes, 8);
  assert.equal(snapshot.totalMinutes, 12);
  assert.equal(snapshot.localeIdentifier, "en-IN");
  assert.equal(snapshot.minimumServingMultiplier, 0.8);
  assert.equal(snapshot.maximumServingMultiplier, 1.3);
  assert.equal(snapshot.recipeVersionID, versionID);
  assert.equal(snapshot.nutritionSourceSummary, "Provider Dataset 2026.1");
});

test("catalogue migration guards open succession and every published child table", async () => {
  const migration = await readFile(new URL("../migrations/012_durable_catalogue_admin.sql", import.meta.url), "utf8");
  assert.match(migration, /recipe_versions_one_open_version_idx/);
  assert.match(migration, /recipe_metadata_json jsonb/);
  assert.match(migration, /content_json jsonb/);
  assert.match(migration, /recipe_version_ingredients_immutable_when_published/);
  assert.match(migration, /recipe_version_steps_immutable_when_published/);
  assert.match(migration, /recipe_version_evidence_immutable_when_published/);
  assert.match(migration, /published recipe version children are immutable/);
  const ingestion = await readFile(new URL("../migrations/013_catalogue_content_ingestion.sql", import.meta.url), "utf8");
  assert.match(ingestion, /canonical_name_snapshot/);
  assert.match(ingestion, /catalogue_content_audit_logs/);
  assert.match(ingestion, /ingredient_nutrients_immutable_when_published/);
  assert.match(ingestion, /nutrient_sources_immutable_when_published/);
  const adminIdentity = await readFile(new URL("../migrations/014_admin_identity_authorization.sql", import.meta.url), "utf8");
  assert.match(adminIdentity, /CREATE TABLE admin_users/);
  assert.match(adminIdentity, /CREATE TABLE admin_role_grants/);
  assert.match(adminIdentity, /CHECK \('mfa' = ANY\(authentication_methods\)\)/);
  assert.match(adminIdentity, /access_token_sha256 char\(64\)/);
  assert.match(adminIdentity, /admin_access_audit_append_only/);
  const subscriptionOperations = await readFile(new URL("../migrations/015_subscription_operations.sql", import.meta.url), "utf8");
  assert.match(subscriptionOperations, /CREATE TABLE subscription_operation_events/);
  assert.match(subscriptionOperations, /before_status IN \('delayed', 'mismatch'\)/);
  assert.match(subscriptionOperations, /subscription_operation_events_append_only/);
  const analyticsDimensions = await readFile(new URL("../migrations/016_analytics_dimensions.sql", import.meta.url), "utf8");
  assert.match(analyticsDimensions, /CREATE TABLE user_analytics_dimensions/);
  assert.match(analyticsDimensions, /latest_app_version/);
  assert.match(analyticsDimensions, /acquisition_source/);
  const supportAudit = await readFile(new URL("../migrations/017_user_support_audit.sql", import.meta.url), "utf8");
  assert.match(supportAudit, /CREATE TABLE support_access_audit_logs/);
  assert.match(supportAudit, /lookup_value_sha256 char\(64\)/);
  assert.match(supportAudit, /outcome IN \('found', 'not_found'\)/);
  assert.match(supportAudit, /support_access_audit_append_only/);
  const featureFlags = await readFile(new URL("../migrations/018_feature_flags.sql", import.meta.url), "utf8");
  assert.match(featureFlags, /CREATE TABLE feature_flags/);
  assert.match(featureFlags, /rollout_percentage smallint/);
  assert.match(featureFlags, /allowlisted_user_ids text\[\]/);
  assert.match(featureFlags, /emergency_disabled boolean/);
  assert.match(featureFlags, /feature_flag_audit_append_only/);
});

function durableProfile() {
  return {
    timeZoneIdentifier: "Asia/Kolkata", calorieTarget: 1800, targetSource: "direct",
    enabledMealSlots: ["breakfast", "lunch", "dinner"], snackPreference: "none",
    cookingDays: [1, 3, 5, 7], leftoverPreference: "prefer",
    maximumActiveMinutes: 45, diet: "vegetarian", allergens: [], ingredientExclusions: [],
    cuisines: ["Indian"],
  };
}

function durableCatalogueFixture(now) {
  const nutrientID = deterministicUUID("durable-catalogue-spinach-nutrient");
  const ingredient = {
    id: "spinach", canonicalName: "Spinach", compatibleDiets: ["vegetarian", "vegan"], allergenIDs: [],
  };
  const recipe = {
    id: "durable-spinach", localeIdentifier: "en-IN", cuisine: "Indian",
    eligibleSlots: ["lunch", "dinner"], activePreparationMinutes: 10, totalMinutes: 15,
    equipment: ["pan"], costBand: "value", lifecycleStatus: "active",
  };
  const content = {
    displayName: "Sautéed spinach",
    ingredients: [{ ingredientID: ingredient.id, householdQuantity: 2, householdUnit: "cups", grams: 120 }],
    methodSteps: ["Wash, dry, and sauté the spinach until just wilted."],
    servings: 1, servingSizeGrams: 120,
    minimumServingMultiplier: 0.75, maximumServingMultiplier: 1.25,
    nutritionPerServing: { calories: 28, proteinGrams: 3.5, carbohydrateGrams: 4.3, fatGrams: 0.5, fibreGrams: 2.6 },
    dietType: "vegetarian", declaredAllergenIDs: [], dominantIngredientIDs: [ingredient.id],
    tags: ["quick", "dinner"], nutrientRecordIDs: [nutrientID], nutritionCalculationVersion: "weighted-grams-v1",
  };
  return { ingredient, nutrientID, recipe, content, now };
}

function durableRecipes() {
  return Array.from({ length: 14 }, (_, index) => ({
    recipeID: `durable-recipe-${index}`,
    recipeVersionID: deterministicUUID(`durable-recipe-version-${index}`),
    version: 1,
    displayName: `Durable recipe ${index + 1}`,
    ingredients: [{
      ingredientID: `ingredient-${index}`, displayName: `Ingredient ${index + 1}`,
      category: "produce", householdQuantity: 1, householdUnit: "portion", grams: 100,
      allergenIDs: [],
    }],
    methodSteps: ["Cook safely."], servingSizeGrams: 300,
    minimumServingMultiplier: 0.8, maximumServingMultiplier: 1.25,
    nutritionPerServing: { calories: 600, proteinGrams: 25, carbohydrateGrams: 70, fatGrams: 18, fibreGrams: 10 },
    activePreparationMinutes: 20, totalMinutes: 30, tags: ["cuisine:Indian"],
    allergenIDs: [], dietType: "vegetarian", eligibleSlots: ["breakfast", "lunch", "dinner"],
    dominantIngredientIDs: [`ingredient-${index}`], nutritionSourceSummary: "Reviewed source v1",
    nutritionCalculationVersion: "v1", reviewStatus: "approved", publicationStatus: "published",
  }));
}

function durableSwapPlan() {
  const batch = swapRecipe("batch-meal", "batch-lentil", 120);
  const standalone = swapRecipe("standalone-meal", "common-spinach", 100);
  const planID = deterministicUUID("durable-swap-source-plan");
  const sourceID = deterministicUUID("durable-swap-batch-source");
  const reuseID = deterministicUUID("durable-swap-reuse");
  return {
    id: planID,
    timeZoneIdentifier: "Asia/Kolkata",
    targetSnapshot: { calorieTarget: 1800, targetSource: "direct" },
    generatorVersion: "deterministic-planner-v1",
    scoringVersion: "wellness-score-v1",
    ruleVersion: "eligibility-rules-v1",
    days: [
      { localDate: { year: 2026, month: 7, day: 14 }, items: [{
        id: sourceID, localDate: { year: 2026, month: 7, day: 14 }, slot: "dinner",
        recipeSnapshot: batch, servingMultiplier: 1, servingQuantityGrams: batch.servingSizeGrams,
        nutrition: batch.nutritionPerServing, leftoverRelationship: { batchSource: { batchID: "batch-1" } }, completionState: "planned",
      }] },
      { localDate: { year: 2026, month: 7, day: 15 }, items: [{
        id: reuseID, localDate: { year: 2026, month: 7, day: 15 }, slot: "dinner",
        recipeSnapshot: structuredClone(batch), servingMultiplier: 1, servingQuantityGrams: batch.servingSizeGrams,
        nutrition: batch.nutritionPerServing,
        leftoverRelationship: { plannedReuse: { batchID: "batch-1", sourcePlanItemID: sourceID } }, completionState: "planned",
      }] },
      { localDate: { year: 2026, month: 7, day: 20 }, items: [{
        id: deterministicUUID("durable-swap-standalone"), localDate: { year: 2026, month: 7, day: 20 }, slot: "lunch",
        recipeSnapshot: standalone, servingMultiplier: 1, servingQuantityGrams: standalone.servingSizeGrams,
        nutrition: standalone.nutritionPerServing, leftoverRelationship: { none: {} }, completionState: "completed",
      }] },
    ],
  };
}

function swapRecipe(recipeID, ingredientID, grams) {
  return {
    recipeID,
    recipeVersionID: deterministicUUID(`swap-recipe-version-${recipeID}`),
    version: 1,
    displayName: recipeID.replaceAll("-", " "),
    ingredients: [{
      ingredientID, displayName: ingredientID.replaceAll("-", " "), category: "produce",
      householdQuantity: 1, householdUnit: "portion", grams, allergenIDs: [],
    }],
    methodSteps: ["Cook safely."], servingSizeGrams: 300,
    nutritionPerServing: { calories: 600, proteinGrams: 25, carbohydrateGrams: 70, fatGrams: 18, fibreGrams: 10 },
    activePreparationMinutes: 20, totalMinutes: 30, tags: ["cuisine:Indian"],
    allergenIDs: [], dietType: "vegetarian", eligibleSlots: ["breakfast", "lunch", "dinner"],
    dominantIngredientIDs: [ingredientID], nutritionSourceSummary: "Reviewed source v1",
    nutritionCalculationVersion: "v1", reviewStatus: "approved", publicationStatus: "published",
  };
}
