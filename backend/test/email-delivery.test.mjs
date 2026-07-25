import assert from "node:assert/strict";
import test from "node:test";
import { AuthService, MemoryAuthStore } from "../src/auth-service.mjs";
import {
  EmailDeliveryError,
  PostmarkMagicLinkDelivery,
  createMagicLinkDelivery,
} from "../src/email-delivery-service.mjs";
import { PostgresAuthService } from "../src/postgres-auth-service.mjs";

const fixedNow = new Date("2026-07-25T10:00:00.000Z");
const deliveryInput = Object.freeze({
  email: "person@example.test",
  token: "safe_test_token_1234567890",
  requestID: "request-123",
  expiresAt: new Date(fixedNow.getTime() + 15 * 60_000),
});

test("Postmark delivery sends a one-time Nourish link with tracking disabled", async () => {
  const calls = [];
  const delivery = new PostmarkMagicLinkDelivery({
    serverToken: "postmark-test-server-token-long-enough",
    from: "Nourish <sign-in@nourish.example>",
    endpoint: "https://email.example.test/send",
    fetchImplementation: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ MessageID: "provider-message-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const result = await delivery.send(deliveryInput);
  assert.deepEqual(result, { provider: "postmark", providerMessageID: "provider-message-1" });
  assert.equal(calls[0].url, "https://email.example.test/send");
  assert.equal(calls[0].options.headers["x-postmark-server-token"], "postmark-test-server-token-long-enough");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.To, deliveryInput.email);
  assert.equal(body.TrackOpens, false);
  assert.equal(body.TrackLinks, "None");
  assert.equal(body.MessageStream, "outbound");
  assert.match(body.TextBody, /nourish:\/\/auth\/magic-link\?token=safe_test_token/);
  assert.match(body.HtmlBody, /Open Nourish/);
  assert.equal(JSON.stringify(body).includes("accessToken"), false);
});

test("provider failures expose no token, recipient, credential, or response body", async () => {
  const delivery = new PostmarkMagicLinkDelivery({
    serverToken: "postmark-private-server-token-value",
    from: "sign-in@nourish.example",
    fetchImplementation: async () => new Response(
      JSON.stringify({ Message: "private upstream diagnostic", recipient: deliveryInput.email }),
      { status: 422 },
    ),
  });
  await assert.rejects(
    () => delivery.send(deliveryInput),
    (error) => error instanceof EmailDeliveryError
      && !error.message.includes(deliveryInput.token)
      && !error.message.includes(deliveryInput.email)
      && !error.message.includes("private upstream"),
  );
});

test("failed memory delivery removes the unusable token and permits a clean retry", async () => {
  const store = new MemoryAuthStore();
  let attempts = 0;
  const delivery = {
    async send() {
      attempts += 1;
      if (attempts === 1) throw new EmailDeliveryError();
    },
  };
  const auth = new AuthService({ store, delivery, now: () => fixedNow });
  await assert.rejects(() => auth.requestMagicLink(deliveryInput.email), EmailDeliveryError);
  assert.equal(store.magicLinksByHash.size, 0);
  assert.equal(store.lastMagicRequestByEmail.size, 0);
  await auth.requestMagicLink(deliveryInput.email);
  assert.equal(store.magicLinksByHash.size, 1);
});

test("failed PostgreSQL delivery deletes only its undelivered token", async () => {
  const queries = [];
  const pool = {
    async query(sql, parameters) {
      queries.push({ sql, parameters });
      if (sql.includes("SELECT created_at")) return { rows: [] };
      return { rows: [], rowCount: 1 };
    },
    async connect() {
      throw new Error("not used");
    },
  };
  const auth = new PostgresAuthService({
    pool,
    delivery: { async send() { throw new EmailDeliveryError(); } },
    now: () => fixedNow,
    tokenFactory: () => deliveryInput.token,
  });
  await assert.rejects(() => auth.requestMagicLink(deliveryInput.email), EmailDeliveryError);
  const cleanup = queries.find(({ sql }) => sql.includes("DELETE FROM magic_link_tokens"));
  assert.ok(cleanup);
  assert.equal(cleanup.parameters.length, 1);
  assert.equal(JSON.stringify(queries).includes(deliveryInput.token), false);
});

test("delivery factory retains local capture and selects Postmark only when configured", () => {
  assert.equal(createMagicLinkDelivery({ production: false }).constructor.name, "MemoryMagicLinkDelivery");
  assert.equal(createMagicLinkDelivery({
    production: true,
    emailProvider: "postmark",
    emailFrom: "sign-in@nourish.example",
    postmarkServerToken: "postmark-test-server-token-long-enough",
    magicLinkPrefix: "nourish://auth/magic-link?token=",
  }).constructor.name, "PostmarkMagicLinkDelivery");
});
