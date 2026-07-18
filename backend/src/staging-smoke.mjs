export class StagingSmokeError extends Error {
  constructor(message) {
    super(message);
    this.name = "StagingSmokeError";
    this.code = "STAGING_SMOKE_ERROR";
  }
}

export async function runStagingSmoke({ baseURL, fetchImpl = fetch, timeoutMilliseconds = 10_000 } = {}) {
  let normalizedBaseURL;
  try {
    normalizedBaseURL = new URL(baseURL);
  } catch {
    throw new StagingSmokeError("NOURISH_STAGING_BASE_URL must be an absolute HTTP or HTTPS URL.");
  }
  if (!["http:", "https:"].includes(normalizedBaseURL.protocol)) {
    throw new StagingSmokeError("NOURISH_STAGING_BASE_URL must use HTTP or HTTPS.");
  }

  const checks = [];
  for (const [path, expectedStatus] of [["healthz", "ok"], ["readyz", "ready"]]) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
    let response;
    try {
      response = await fetchImpl(new URL(path, withTrailingSlash(normalizedBaseURL)), {
        method: "GET",
        headers: { "x-correlation-id": `staging-smoke-${path}` },
        signal: controller.signal,
      });
    } catch (error) {
      throw new StagingSmokeError(`${path} request failed: ${error?.name === "AbortError" ? "timed out" : error.message}`);
    } finally {
      clearTimeout(timeout);
    }

    if (response.status !== 200) throw new StagingSmokeError(`${path} returned HTTP ${response.status}.`);
    if (response.headers.get("cache-control") !== "no-store") {
      throw new StagingSmokeError(`${path} did not return cache-control: no-store.`);
    }
    if (!response.headers.get("x-correlation-id")) {
      throw new StagingSmokeError(`${path} did not return a correlation ID.`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("application/json")) {
      throw new StagingSmokeError(`${path} did not return JSON.`);
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw new StagingSmokeError(`${path} returned malformed JSON.`);
    }
    if (body?.status !== expectedStatus) {
      throw new StagingSmokeError(`${path} returned unexpected status ${JSON.stringify(body?.status)}.`);
    }
    if (path === "readyz" && body?.dependency?.status !== "ok") {
      throw new StagingSmokeError("readyz did not confirm its persistence dependency.");
    }
    if (path === "readyz" && body?.dependency?.schema?.status !== "current") {
      throw new StagingSmokeError("readyz did not confirm the release schema.");
    }
    checks.push(Object.freeze({ path: `/${path}`, status: "ok" }));
  }
  return Object.freeze({ status: "ok", checks: Object.freeze(checks) });
}

function withTrailingSlash(url) {
  const normalized = new URL(url);
  if (!normalized.pathname.endsWith("/")) normalized.pathname += "/";
  return normalized;
}
