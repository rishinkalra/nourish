import { randomUUID } from "node:crypto";
import { createPostgresPool } from "./database.mjs";
import { PostgresAuthService } from "./postgres-auth-service.mjs";

const baseURL = new URL(process.env.NOURISH_LOCAL_BASE_URL ?? "http://api:8080");
assertLocalEnvironment();
const pool = await createPostgresPool({
  connectionString: process.env.DATABASE_URL,
  requireTLS: false,
  applicationName: "project-nourish-local-e2e",
});
const runID = randomUUID();
const token = `local-e2e-token-${runID}-nourish`;

try {
  await getJSON("/healthz");
  const ready = await getJSON("/readyz");
  if (ready.status !== "ready" || ready.dependency?.schema?.status !== "current") {
    throw new Error("API readiness did not confirm the current PostgreSQL schema.");
  }

  await requestJSON("/v1/auth/magic-link", {
    method: "POST",
    body: { email: `local-probe-${runID}@nourish.invalid` },
    expectedStatus: 202,
  });

  const auth = new PostgresAuthService({
    pool,
    tokenFactory: () => token,
    delivery: { send: async () => {} },
  });
  await auth.requestMagicLink(`local-e2e-${runID}@nourish.invalid`);
  const session = await requestJSON("/v1/auth/magic-link/complete", {
    method: "POST",
    body: { token },
  });
  const authorization = { authorization: `Bearer ${session.accessToken}` };

  await requestJSON("/v1/profile", {
    method: "PATCH",
    headers: authorization,
    body: {
      profile: localProfile(),
      changeScope: "currentAndFuturePlans",
      expectedRevision: 0,
    },
  });

  const weekStartLocalDate = nextMondayInIndia();
  const created = await requestJSON("/v1/plans", {
    method: "POST",
    headers: { ...authorization, "idempotency-key": `local-plan-${runID}` },
    expectedStatus: 202,
    body: {
      weekStartLocalDate,
      deterministicSeed: `local-e2e|${runID}|${weekStartLocalDate}`,
      trigger: "initial",
    },
  });
  const generated = await waitForPlan(created.id, authorization);
  if (!generated.plan || generated.plan.days.length !== 7) {
    throw new Error("The worker did not materialize a complete seven-day plan.");
  }
  const mealCount = generated.plan.days.flatMap((day) => day.items).length;
  if (mealCount !== 21) throw new Error(`Expected 21 planned meals, received ${mealCount}.`);

  await requestJSON(`/v1/plans/${generated.plan.id}/adopt`, {
    method: "POST",
    headers: { ...authorization, "idempotency-key": `local-adopt-${runID}` },
    body: {},
  });
  const active = await requestJSON("/v1/plans/active", { headers: authorization });
  if (active.plan?.id !== generated.plan.id || !active.groceryList?.items?.length || !active.prepTimeline?.tasks?.length) {
    throw new Error("The adopted plan did not produce groceries and prep tasks.");
  }

  process.stdout.write(`${JSON.stringify({
    status: "ok",
    checks: ["postgres", "migrations", "api", "authentication", "profile", "worker", "weekly-plan", "groceries", "prep"],
    planID: generated.plan.id,
    meals: mealCount,
    groceryItems: active.groceryList.items.length,
    prepTasks: active.prepTimeline.tasks.length,
  })}\n`);
} finally {
  await pool.end();
}

async function waitForPlan(jobID, headers) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const result = await requestJSON(`/v1/plans/${jobID}`, { headers });
    if (result.job?.state === "succeeded") return result;
    if (["rejected", "failed"].includes(result.job?.state)) {
      throw new Error(`Plan generation ended in ${result.job.state}: ${JSON.stringify(result)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Plan generation did not finish within 45 seconds.");
}

async function getJSON(path) {
  return requestJSON(path, { method: "GET" });
}

async function requestJSON(path, { method = "GET", headers = {}, body, expectedStatus = 200 } = {}) {
  const response = await fetch(new URL(path, baseURL), {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "x-correlation-id": `local-e2e-${runID}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  if (response.status !== expectedStatus) {
    throw new Error(`${method} ${path} returned HTTP ${response.status}: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

function localProfile() {
  return {
    countryRegionCode: "IN",
    unitSystem: "metric",
    timeZoneIdentifier: "Asia/Kolkata",
    preferredAuthenticationMethod: "emailMagicLink",
    goal: "maintain",
    calorieTarget: 1800,
    optionalDailyProteinTargetGrams: 90,
    targetSource: "userProvided",
    targetEstimatorVersion: null,
    diet: "vegetarian",
    allergens: [],
    ingredientExclusions: [],
    dislikedFoods: [],
    cuisines: ["North Indian", "South Indian", "West Indian"],
    enabledMealSlots: ["breakfast", "lunch", "dinner"],
    snackPreference: "none",
    budget: "medium",
    availableEquipment: ["stovetop", "pan"],
    maximumActiveMinutes: 35,
    cookingDays: [1, 3, 5, 7],
    leftoverPreference: "planned",
    batchPrepSessionsPerWeek: 1,
    wellnessConsent: { policyVersion: "wellness-v1.0", acceptedAt: new Date().toISOString() },
  };
}

function nextMondayInIndia() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  const daysUntilMonday = (8 - date.getUTCDay()) % 7;
  date.setUTCDate(date.getUTCDate() + daysUntilMonday);
  return date.toISOString().slice(0, 10);
}

function assertLocalEnvironment() {
  if (process.env.NODE_ENV === "production" || process.env.NOURISH_ENABLE_LOCAL_E2E !== "true") {
    throw new Error("Local end-to-end testing is disabled.");
  }
  const database = new URL(process.env.DATABASE_URL ?? "invalid://missing");
  if (!["db", "localhost", "127.0.0.1"].includes(database.hostname) || database.pathname !== "/nourish_local") {
    throw new Error("Refusing to run local end-to-end checks against a non-local database.");
  }
  if (!["api", "localhost", "127.0.0.1"].includes(baseURL.hostname)) {
    throw new Error("Refusing to run local end-to-end checks against a remote API.");
  }
}
