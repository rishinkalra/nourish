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
  const generationStartedAt = performance.now();
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
  const initialPlanGenerationMilliseconds = Math.round(performance.now() - generationStartedAt);
  if (initialPlanGenerationMilliseconds >= 8_000) {
    throw new Error(`Local plan generation exceeded the 8-second processing target: ${initialPlanGenerationMilliseconds}ms.`);
  }
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
  const activeReadSamples = [];
  for (let sample = 0; sample < 20; sample += 1) {
    const startedAt = performance.now();
    await requestJSON("/v1/plans/active", { headers: authorization });
    activeReadSamples.push(performance.now() - startedAt);
  }
  const activePlanReadP95Milliseconds = Math.round(percentile(activeReadSamples, 95));
  if (activePlanReadP95Milliseconds >= 1_000) {
    throw new Error(`Local active-plan read p95 exceeded the 1-second target: ${activePlanReadP95Milliseconds}ms.`);
  }
  const groceryItem = active.groceryList.items[0];
  const concurrentGroceryWrites = await Promise.all([
    requestResult(`/v1/grocery-lists/${active.groceryList.id}`, {
      method: "PATCH",
      headers: authorization,
      body: {
        expectedRevision: active.groceryList.revision,
        changes: [{ itemID: groceryItem.id, disposition: "checked" }],
      },
    }),
    requestResult(`/v1/grocery-lists/${active.groceryList.id}`, {
      method: "PATCH",
      headers: authorization,
      body: {
        expectedRevision: active.groceryList.revision,
        changes: [{ itemID: groceryItem.id, disposition: "alreadyHave" }],
      },
    }),
  ]);
  const concurrentStatuses = concurrentGroceryWrites.map((result) => result.status).sort((left, right) => left - right);
  if (concurrentStatuses[0] !== 200 || concurrentStatuses[1] !== 409) {
    throw new Error(`Concurrent grocery writes did not produce one commit and one conflict: ${concurrentStatuses.join(",")}.`);
  }
  const groceryAfterConcurrency = await requestJSON(`/v1/grocery-lists/${active.groceryList.id}`, {
    headers: authorization,
  });
  if (groceryAfterConcurrency.revision !== active.groceryList.revision + 1) {
    throw new Error("Concurrent grocery writes advanced the revision more than once.");
  }
  const savedGroceryItem = groceryAfterConcurrency.items.find((item) => item.id === groceryItem.id);
  if (!["checked", "alreadyHave"].includes(savedGroceryItem?.disposition)) {
    throw new Error("The successful concurrent grocery state was not retained.");
  }
  const plannedItems = generated.plan.days.flatMap((day) => day.items);
  const lockCandidate = plannedItems.find((item) => item.leftoverRelationship?.none)
    ?? plannedItems.find((item) => item.leftoverRelationship?.batchSource);
  if (!lockCandidate) throw new Error("The generated plan did not contain a safe lock candidate.");
  const lockedPlanItemIDs = lockCandidate.leftoverRelationship?.batchSource
    ? plannedItems
      .filter((item) => item.id === lockCandidate.id
        || item.leftoverRelationship?.plannedReuse?.batchID === lockCandidate.leftoverRelationship.batchSource.batchID)
      .map((item) => item.id)
    : [lockCandidate.id];
  const regenerationRequest = {
    weekStartLocalDate,
    deterministicSeed: `local-e2e-regeneration|${runID}|${weekStartLocalDate}`,
    trigger: "manual_regeneration",
    regenerationReason: "Local PostgreSQL concurrency and locked-lineage verification.",
    lockedPlanItemIDs,
  };
  const regenerationKey = `local-regeneration-${runID}`;
  const concurrentRegenerations = await Promise.all([
    requestResult("/v1/plans", {
      method: "POST",
      headers: { ...authorization, "idempotency-key": regenerationKey },
      body: regenerationRequest,
    }),
    requestResult("/v1/plans", {
      method: "POST",
      headers: { ...authorization, "idempotency-key": regenerationKey },
      body: regenerationRequest,
    }),
  ]);
  if (concurrentRegenerations.some((result) => result.status !== 202)
      || concurrentRegenerations[0].body?.id !== concurrentRegenerations[1].body?.id) {
    throw new Error("Concurrent idempotent regeneration did not resolve to one durable plan job.");
  }
  const regenerated = await waitForPlan(concurrentRegenerations[0].body.id, authorization);
  const preserved = regenerated.plan?.days
    .flatMap((day) => day.items)
    .find((item) => item.lockedFromPlanItemID === lockCandidate.id);
  if (!preserved || preserved.recipeSnapshot?.recipeVersionID !== lockCandidate.recipeSnapshot?.recipeVersionID) {
    throw new Error("Locked regeneration did not preserve immutable recipe lineage.");
  }

  process.stdout.write(`${JSON.stringify({
    status: "ok",
    checks: ["postgres", "migrations", "api", "authentication", "profile", "worker", "weekly-plan", "groceries", "prep", "optimistic-concurrency", "idempotent-regeneration", "locked-lineage"],
    planID: generated.plan.id,
    meals: mealCount,
    groceryItems: active.groceryList.items.length,
    prepTasks: active.prepTimeline.tasks.length,
    performance: {
      initialPlanGenerationMilliseconds,
      activePlanReadP95Milliseconds,
      activePlanReadSamples: activeReadSamples.length,
    },
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
  const result = await requestResult(path, { method, headers, body });
  if (result.status !== expectedStatus) {
    throw new Error(`${method} ${path} returned HTTP ${result.status}: ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

async function requestResult(path, { method = "GET", headers = {}, body } = {}) {
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
  if (response.headers.get("x-nourish-api-version") !== "1") {
    throw new Error(`${method} ${path} did not advertise the stable v1 API contract.`);
  }
  return { status: response.status, body: parsed };
}

function percentile(samples, percentileValue) {
  if (!samples.length) throw new Error("A percentile requires at least one sample.");
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.ceil(percentileValue / 100 * ordered.length) - 1];
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
