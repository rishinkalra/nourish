import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  DigitalOceanPreflightError,
  renderDigitalOceanStagingSpec,
} from "../src/digitalocean-preflight.mjs";

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = await readFile(resolve(backendDirectory, "../.do/app.staging.yaml"), "utf8");
const validEnvironment = Object.freeze({
  NOURISH_DO_GITHUB_REPOSITORY: "project-nourish/app",
  NOURISH_DO_POSTGRES_CLUSTER: "nourish-staging-db",
  NOURISH_DO_SPACE_NAME: "project-nourish-private-staging",
  NOURISH_DO_NUTRITION_VERSION: "ifct-2017-reviewed-v1",
  NOURISH_DO_CONTROL_ROOM_ORIGIN: "https://control-staging.nourish.example",
  NOURISH_DO_ENCRYPTION_ACTIVE_KEY_ID: "staging-2026-07",
  NOURISH_DO_ENCRYPTION_KEYS: JSON.stringify({
    "staging-2026-06": Buffer.alloc(32, 6).toString("base64"),
    "staging-2026-07": Buffer.alloc(32, 7).toString("base64"),
  }),
  NOURISH_DO_API_SPACES_ACCESS_KEY_ID: "api-read-key",
  NOURISH_DO_API_SPACES_SECRET_ACCESS_KEY: "api-read-secret",
  NOURISH_DO_WORKER_SPACES_ACCESS_KEY_ID: "worker-write-key",
  NOURISH_DO_WORKER_SPACES_SECRET_ACCESS_KEY: "worker-write-secret",
});

test("DigitalOcean preflight renders a placeholder-free, fail-closed staging spec", () => {
  const result = renderDigitalOceanStagingSpec({ template, environment: validEnvironment });
  assert.equal(result.summary.status, "ok");
  assert.equal(result.summary.applicationEncryptionConfigured, true);
  assert.doesNotMatch(result.rendered, /CHANGE_ME/);
  assert.match(result.rendered, /repo: "project-nourish\/app"/);
  assert.match(result.rendered, /value: "project-nourish-private-staging"/);
  assert.match(result.rendered, /value: "\{\\"staging-2026-06\\"/);
  assert.doesNotMatch(JSON.stringify(result.summary), /api-read-secret|worker-write-secret|staging-2026/);
});

test("DigitalOcean preflight reports missing inputs without echoing secret values", () => {
  assert.throws(
    () => renderDigitalOceanStagingSpec({ template, environment: {} }),
    (error) => error instanceof DigitalOceanPreflightError
      && error.issues.includes("NOURISH_DO_ENCRYPTION_KEYS is required")
      && !error.message.includes("CHANGE_ME_JSON_ENCRYPTION_KEYRING"),
  );
});

test("DigitalOcean preflight rejects unsafe origins, invalid key rings, and shared provider identities", () => {
  const environment = {
    ...validEnvironment,
    NOURISH_DO_CONTROL_ROOM_ORIGIN: "http://control.example/path",
    NOURISH_DO_ENCRYPTION_KEYS: JSON.stringify({ "staging-2026-07": "short" }),
    NOURISH_DO_WORKER_SPACES_ACCESS_KEY_ID: validEnvironment.NOURISH_DO_API_SPACES_ACCESS_KEY_ID,
  };
  assert.throws(
    () => renderDigitalOceanStagingSpec({ template, environment }),
    (error) => error.issues.some((issue) => issue.includes("HTTPS origin"))
      && error.issues.some((issue) => issue.includes("must be different"))
      && error.issues.some((issue) => issue.includes("base64-encoded 256-bit keys")),
  );
});

test("DigitalOcean preflight refuses templates that enable automatic deployment", () => {
  const unsafeTemplate = template.replace("deploy_on_push: false", "deploy_on_push: true");
  assert.throws(
    () => renderDigitalOceanStagingSpec({ template: unsafeTemplate, environment: validEnvironment }),
    (error) => error.issues.includes("automatic source deployment must remain disabled for staging"),
  );
});
