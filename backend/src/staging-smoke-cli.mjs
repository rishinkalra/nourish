import { runStagingSmoke } from "./staging-smoke.mjs";

const result = await runStagingSmoke({
  baseURL: process.env.NOURISH_STAGING_BASE_URL,
  timeoutMilliseconds: Number.parseInt(process.env.NOURISH_STAGING_SMOKE_TIMEOUT_MS ?? "10000", 10),
});
process.stdout.write(`${JSON.stringify(result)}\n`);
