const correlationPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeTokenPattern = /^[A-Za-z0-9._:-]{1,160}$/;

const staticRoutes = new Set([
  "/healthz",
  "/readyz",
  "/v1/auth/magic-link",
  "/v1/auth/magic-link/complete",
  "/v1/auth/apple",
  "/v1/auth/refresh",
  "/v1/auth/revoke",
  "/v1/profile",
  "/v1/feature-flags",
  "/v1/analytics/dimensions",
  "/v1/analytics/events",
  "/v1/analytics/consent",
  "/v1/push-registrations",
  "/v1/plans",
  "/v1/plans/active",
  "/v1/plans/history",
  "/v1/feedback",
  "/v1/entitlement",
  "/v1/entitlement/app-account-token",
  "/v1/entitlement/transactions",
  "/v1/app-store/notifications/v2",
  "/v1/account/export",
  "/v1/account",
  "/admin/v1/auth/session",
  "/admin/v1/auth/revoke",
  "/admin/v1/recipes",
  "/admin/v1/recipe-generations",
  "/admin/v1/ingredients",
  "/admin/v1/nutrient-records",
  "/admin/v1/catalogue/queue",
  "/admin/v1/catalogue/audit",
  "/admin/v1/catalogue/content",
  "/admin/v1/plan-runs",
  "/admin/v1/subscriptions",
  "/admin/v1/kpis",
  "/admin/v1/cohorts",
  "/admin/v1/exports",
  "/admin/v1/users/lookup",
  "/admin/v1/flags",
]);

const dynamicRoutes = Object.freeze([
  [/^\/v1\/plans\/[^/]+$/, "/v1/plans/:id"],
  [/^\/v1\/plans\/[^/]+\/adopt$/, "/v1/plans/:id/adopt"],
  [/^\/v1\/plan-items\/[^/]+\/swaps$/, "/v1/plan-items/:id/swaps"],
  [/^\/v1\/plan-items\/[^/]+\/swap$/, "/v1/plan-items/:id/swap"],
  [/^\/v1\/plan-items\/[^/]+\/status$/, "/v1/plan-items/:id/status"],
  [/^\/v1\/grocery-lists\/[^/]+$/, "/v1/grocery-lists/:id"],
  [/^\/v1\/prep-tasks\/[^/]+$/, "/v1/prep-tasks/:id"],
  [/^\/admin\/v1\/plan-runs\/[^/]+$/, "/admin/v1/plan-runs/:id"],
  [/^\/admin\/v1\/subscriptions\/[^/]+$/, "/admin/v1/subscriptions/:id"],
  [/^\/admin\/v1\/subscriptions\/[^/]+\/actions\/retry$/, "/admin/v1/subscriptions/:id/actions/retry"],
  [/^\/admin\/v1\/exports\/[^/]+\/content$/, "/admin/v1/exports/:id/content"],
  [/^\/admin\/v1\/users\/[^/]+$/, "/admin/v1/users/:id"],
  [/^\/admin\/v1\/recipes\/[^/]+\/submit$/, "/admin/v1/recipes/:id/submit"],
  [/^\/admin\/v1\/recipe-generations\/[^/]+$/, "/admin/v1/recipe-generations/:id"],
  [/^\/admin\/v1\/recipe-generations\/[^/]+\/image$/, "/admin/v1/recipe-generations/:id/image"],
  [/^\/admin\/v1\/recipe-generations\/[^/]+\/actions\/import$/, "/admin/v1/recipe-generations/:id/actions/import"],
  [/^\/admin\/v1\/recipe-generations\/[^/]+\/actions\/discard$/, "/admin/v1/recipe-generations/:id/actions/discard"],
  [/^\/admin\/v1\/recipe-versions\/[^/]+\/approve$/, "/admin/v1/recipe-versions/:id/approve"],
  [/^\/admin\/v1\/recipe-versions\/[^/]+\/reject$/, "/admin/v1/recipe-versions/:id/reject"],
]);

export function normalizeCorrelationID(value, fallback) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" && correlationPattern.test(candidate)
    ? candidate
    : fallback;
}

export function routeTemplate(pathname) {
  if (staticRoutes.has(pathname)) return pathname;
  for (const [pattern, template] of dynamicRoutes) {
    if (pattern.test(pathname)) return template;
  }
  return "unmatched";
}

export function createStructuredTelemetry({
  service,
  environment = "development",
  destination = process.stdout,
  now = () => new Date(),
} = {}) {
  const serviceName = safeToken(service, "nourish");
  const environmentName = safeToken(environment, "unknown");

  function write(record) {
    try {
      destination.write(`${JSON.stringify({
        timestamp: now().toISOString(),
        service: serviceName,
        environment: environmentName,
        ...record,
      })}\n`);
    } catch {
      // Telemetry must never change the product outcome.
    }
  }

  return Object.freeze({
    recordAPIRequest({
      method,
      route,
      statusCode,
      durationMilliseconds,
      correlationID,
      errorCode = null,
      retryable = false,
    }) {
      const status = boundedInteger(statusCode, 100, 599);
      write({
        event: "api_request_completed",
        level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
        method: safeMethod(method),
        route: routeTemplate(route),
        status_code: status,
        duration_ms: boundedInteger(durationMilliseconds, 0, 86_400_000),
        correlation_id: safeCorrelation(correlationID),
        ...(errorCode ? { error_code: safeToken(errorCode, "UNCLASSIFIED") } : {}),
        ...(retryable ? { retryable: true } : {}),
      });
    },

    recordJobRun({
      jobID,
      jobType,
      state,
      attemptCount,
      queueDelayMilliseconds,
      durationMilliseconds,
      correlationID = null,
      errorCode = null,
    }) {
      const outcome = ["succeeded", "queued", "dead"].includes(state) ? state : "unknown";
      write({
        event: "worker_job_completed",
        level: outcome === "dead" ? "error" : outcome === "queued" ? "warn" : "info",
        job_id: safeToken(jobID, "unknown"),
        job_type: safeToken(jobType, "unknown"),
        state: outcome,
        attempt_count: boundedInteger(attemptCount, 0, 1_000),
        queue_delay_ms: boundedInteger(queueDelayMilliseconds, 0, 2_592_000_000),
        duration_ms: boundedInteger(durationMilliseconds, 0, 86_400_000),
        ...(safeCorrelation(correlationID) ? { correlation_id: safeCorrelation(correlationID) } : {}),
        ...(errorCode ? { error_code: safeToken(errorCode, "UNCLASSIFIED") } : {}),
      });
    },

    recordOperationalFailure({ event, errorCode }) {
      write({
        event: safeToken(event, "operational_failure"),
        level: "error",
        error_code: safeToken(errorCode, "TEMPORARY_FAILURE"),
      });
    },
  });
}

function safeMethod(value) {
  const method = String(value ?? "").toUpperCase();
  return ["DELETE", "GET", "OPTIONS", "PATCH", "POST", "PUT"].includes(method) ? method : "OTHER";
}

function safeCorrelation(value) {
  return typeof value === "string" && correlationPattern.test(value) ? value : null;
}

function safeToken(value, fallback) {
  const candidate = String(value ?? "");
  return safeTokenPattern.test(candidate) ? candidate : fallback;
}

function boundedInteger(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.round(Math.min(maximum, Math.max(minimum, number)));
}
