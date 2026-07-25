import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MemoryMagicLinkDelivery } from "../src/auth-service.mjs";
import { MemoryJobQueue } from "../src/job-queue.mjs";
import {
  APNsPushProvider,
  MemoryPushRegistrationService,
  PostgresPushRegistrationService,
  createPlanReadyNotificationHandler,
} from "../src/push-notification-service.mjs";
import { createNourishServer } from "../src/server.mjs";

const tokenA = "ab".repeat(32);
const tokenB = "cd".repeat(32);

test("push registrations move with the authenticated account and unregister exactly", async () => {
  const service = new MemoryPushRegistrationService({
    now: () => new Date("2026-07-25T05:30:00.000Z"),
  });
  const receipt = await service.register("user-1", { deviceToken: tokenA, environment: "sandbox" });
  assert.equal(receipt.environment, "sandbox");
  assert.equal((await service.activeRegistrations("user-1")).length, 1);

  await service.register("user-2", { deviceToken: tokenA, environment: "sandbox" });
  assert.equal((await service.activeRegistrations("user-1")).length, 0);
  assert.equal((await service.activeRegistrations("user-2")).length, 1);
  await service.unregister("user-1", { deviceToken: tokenA, environment: "sandbox" });
  assert.equal((await service.activeRegistrations("user-2")).length, 1);
  await service.unregister("user-2", { deviceToken: tokenA, environment: "sandbox" });
  assert.equal((await service.activeRegistrations("user-2")).length, 0);
});

test("plan-ready delivery retires invalid APNs tokens without exposing meal data", async () => {
  const registrations = new MemoryPushRegistrationService();
  await registrations.register("user-1", { deviceToken: tokenA, environment: "sandbox" });
  await registrations.register("user-1", { deviceToken: tokenB, environment: "sandbox" });
  const deliveries = [];
  const handler = createPlanReadyNotificationHandler({
    registrationService: registrations,
    pushProvider: {
      async send(registration, notification) {
        deliveries.push({ registration, notification });
        return registration.deviceToken === tokenA
          ? { status: "sent" }
          : { status: "invalidToken", reason: "Unregistered" };
      },
    },
  });
  const result = await handler({
    userID: "user-1",
    payload: { planJobID: "plan-job-1", planID: "plan-1" },
  });
  assert.deepEqual(result, { registrations: 2, sent: 1, invalidated: 1, disabled: 0 });
  assert.deepEqual(deliveries[0].notification, {
    templateID: "plan_ready",
    title: "Your Nourish plan is ready",
    body: "Review your seven-day plan before making it active.",
    destination: "nourish://open/plan",
    analyticsDestination: "plan_studio",
    planJobID: "plan-job-1",
  });
  assert.equal((await registrations.activeRegistrations("user-1")).length, 1);
});

test("APNs provider signs an HTTP/2 alert with a safe collapsed plan payload", async () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  let capturedHeaders;
  let capturedPayload;
  const client = Object.assign(new EventEmitter(), {
    request(headers) {
      capturedHeaders = headers;
      const request = new EventEmitter();
      request.setEncoding = () => {};
      request.end = (payload) => {
        capturedPayload = payload;
        queueMicrotask(() => {
          request.emit("response", { ":status": 200, "apns-id": "apns-1" });
          request.emit("end");
        });
      };
      return request;
    },
    close() {},
  });
  const provider = new APNsPushProvider({
    teamID: "TEAM1234",
    keyID: "KEY1234",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
    appBundleID: "com.projectnourish.app",
    connectHTTP2: () => client,
    now: () => new Date("2026-07-25T05:30:00.000Z"),
  });
  const result = await provider.send({
    deviceToken: tokenA,
    environment: "sandbox",
    appBundleID: "com.projectnourish.app",
  }, {
    templateID: "plan_ready",
    title: "Your Nourish plan is ready",
    body: "Review your seven-day plan before making it active.",
    destination: "nourish://open/plan",
    analyticsDestination: "plan_studio",
    planJobID: "plan-job-1",
  });
  assert.deepEqual(result, { status: "sent", apnsID: "apns-1" });
  assert.equal(capturedHeaders[":path"], `/3/device/${tokenA}`);
  assert.equal(capturedHeaders["apns-topic"], "com.projectnourish.app");
  assert.match(capturedHeaders.authorization, /^bearer [^.]+\.[^.]+\.[^.]+$/);
  assert.equal(capturedHeaders["apns-collapse-id"], "plan-ready-plan-job-1");
  const payload = JSON.parse(capturedPayload);
  assert.equal(payload.destination, "nourish://open/plan");
  assert.equal(JSON.stringify(payload).includes("plan-job-1"), false);
});

test("APNs provider surfaces a failed HTTP/2 session without crashing the worker", async () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const client = Object.assign(new EventEmitter(), {
    request() {
      const request = new EventEmitter();
      request.setEncoding = () => {};
      request.end = () => queueMicrotask(() => client.emit("error", new Error("connection failed")));
      return request;
    },
    close() {},
  });
  const provider = new APNsPushProvider({
    teamID: "TEAM1234",
    keyID: "KEY1234",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
    appBundleID: "com.projectnourish.app",
    connectHTTP2: () => client,
  });
  await assert.rejects(
    provider.send({
      deviceToken: tokenA,
      environment: "sandbox",
      appBundleID: "com.projectnourish.app",
    }, {
      templateID: "plan_ready",
      title: "Your Nourish plan is ready",
      body: "Review your seven-day plan before making it active.",
      destination: "nourish://open/plan",
      analyticsDestination: "plan_studio",
      planJobID: "plan-job-1",
    }),
    /connection failed/,
  );
});

test("authenticated HTTP push registration never accepts or returns another account token", async (context) => {
  const delivery = new MemoryMagicLinkDelivery();
  const registrations = new MemoryPushRegistrationService();
  const app = createNourishServer({ delivery, pushRegistrationService: registrations });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => app.server.close(resolve)));
  const baseURL = `http://127.0.0.1:${app.server.address().port}`;

  await fetch(`${baseURL}/v1/auth/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "push@example.test" }),
  });
  const authenticated = await fetch(`${baseURL}/v1/auth/magic-link/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: delivery.latest().token }),
  });
  const session = await authenticated.json();
  const unauthorized = await fetch(`${baseURL}/v1/push-registrations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceToken: tokenA, environment: "sandbox" }),
  });
  assert.equal(unauthorized.status, 401);

  const registered = await fetch(`${baseURL}/v1/push-registrations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({ deviceToken: tokenA, environment: "sandbox" }),
  });
  assert.equal(registered.status, 200);
  const body = await registered.json();
  assert.equal(body.environment, "sandbox");
  assert.equal(JSON.stringify(body).includes(tokenA), false);

  const removed = await fetch(`${baseURL}/v1/push-registrations`, {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({ deviceToken: tokenA, environment: "sandbox" }),
  });
  assert.equal(removed.status, 204);
  assert.equal((await registrations.activeRegistrations(session.identity.userID)).length, 0);
});

test("PostgreSQL push registration is parameterized and migration queues plan-ready jobs", async () => {
  const calls = [];
  const pool = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("RETURNING id, environment")) {
        return {
          rows: [{
            id: "registration-1",
            environment: "sandbox",
            app_bundle_id: "com.projectnourish.app",
            last_registered_at: new Date("2026-07-25T05:30:00.000Z"),
          }],
        };
      }
      return { rows: [] };
    },
  };
  const service = new PostgresPushRegistrationService({ pool });
  await service.register("00000000-0000-4000-8000-000000000001", {
    deviceToken: tokenA,
    environment: "sandbox",
  });
  assert.ok(calls[0].text.includes("ON CONFLICT (token_sha256, environment, app_bundle_id)"));
  assert.equal(calls[0].text.includes(tokenA), false);
  assert.equal(calls[0].values[3], tokenA);

  const migration = await readFile(new URL("../migrations/023_push_notifications.sql", import.meta.url), "utf8");
  assert.match(migration, /notification\.plan-ready/);
  assert.match(migration, /REFERENCES users\(id\) ON DELETE CASCADE/);

  const queue = new MemoryJobQueue();
  const job = await queue.enqueue({
    type: "notification.plan-ready",
    userID: "user-1",
    idempotencyKey: "plan-ready:1",
    payload: { planJobID: "plan-job-1" },
  });
  assert.equal(job.type, "notification.plan-ready");
});
