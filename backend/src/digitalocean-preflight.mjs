import { validateRuntimeConfiguration } from "./runtime-configuration.mjs";

const INPUTS = Object.freeze({
  CHANGE_ME_GITHUB_REPOSITORY: "NOURISH_DO_GITHUB_REPOSITORY",
  CHANGE_ME_EXISTING_MANAGED_POSTGRES_CLUSTER: "NOURISH_DO_POSTGRES_CLUSTER",
  CHANGE_ME_PRIVATE_SPACE_NAME: "NOURISH_DO_SPACE_NAME",
  CHANGE_ME_REVIEWED_VERSION: "NOURISH_DO_NUTRITION_VERSION",
  CHANGE_ME_CONTROL_ROOM_ORIGIN: "NOURISH_DO_CONTROL_ROOM_ORIGIN",
  CHANGE_ME_ENCRYPTION_ACTIVE_KEY_ID: "NOURISH_DO_ENCRYPTION_ACTIVE_KEY_ID",
  CHANGE_ME_JSON_ENCRYPTION_KEYRING: "NOURISH_DO_ENCRYPTION_KEYS",
  CHANGE_ME_SPACES_READ_ACCESS_KEY: "NOURISH_DO_API_SPACES_ACCESS_KEY_ID",
  CHANGE_ME_SPACES_READ_SECRET_KEY: "NOURISH_DO_API_SPACES_SECRET_ACCESS_KEY",
  CHANGE_ME_SPACES_WRITE_DELETE_ACCESS_KEY: "NOURISH_DO_WORKER_SPACES_ACCESS_KEY_ID",
  CHANGE_ME_SPACES_WRITE_DELETE_SECRET_KEY: "NOURISH_DO_WORKER_SPACES_SECRET_ACCESS_KEY",
});

export class DigitalOceanPreflightError extends Error {
  constructor(issues) {
    super(`DigitalOcean staging preflight failed: ${issues.join("; ")}`);
    this.name = "DigitalOceanPreflightError";
    this.code = "DIGITALOCEAN_PREFLIGHT_ERROR";
    this.issues = Object.freeze([...issues]);
  }
}

export function renderDigitalOceanStagingSpec({ template, environment = process.env } = {}) {
  const issues = [];
  if (typeof template !== "string" || !template.trim()) {
    throw new DigitalOceanPreflightError(["the staging app-spec template is empty"]);
  }
  validateTemplateTopology(template, issues);

  const values = {};
  for (const [placeholder, variable] of Object.entries(INPUTS)) {
    const value = nonEmpty(environment[variable]);
    if (!value) issues.push(`${variable} is required`);
    else if (value.includes("\n") || value.includes("\r")) issues.push(`${variable} must be a single line`);
    else values[placeholder] = value;
  }

  validateDeploymentInputs(values, issues);
  if (issues.length) throw new DigitalOceanPreflightError(issues);

  let rendered = template;
  for (const [placeholder, value] of Object.entries(values)) {
    rendered = rendered.replaceAll(placeholder, yamlString(value));
  }
  if (rendered.split("\n").some((line) => !line.trimStart().startsWith("#") && line.includes("CHANGE_ME"))) {
    issues.push("the rendered app spec still contains a CHANGE_ME placeholder");
  }

  validateRuntime("api", values, issues);
  validateRuntime("worker", values, issues);
  if (issues.length) throw new DigitalOceanPreflightError(issues);

  return Object.freeze({
    rendered,
    summary: Object.freeze({
      status: "ok",
      region: "blr",
      components: Object.freeze(["nourish-api", "nourish-worker", "nourish-migrate"]),
      managedDatabaseBound: true,
      privateSpaceConfigured: true,
      applicationEncryptionConfigured: true,
      separateSpaceAccessKeys: true,
      automaticDeployments: false,
    }),
  });
}

function validateTemplateTopology(template, issues) {
  const required = [
    "region: blr",
    "name: nourish-api",
    "name: nourish-worker",
    "name: nourish-migrate",
    "kind: PRE_DEPLOY",
    "value: ${nourish-postgres.DATABASE_PRIVATE_URL}",
    "value: https://blr1.digitaloceanspaces.com",
    "key: NOURISH_PRIVATE_OBJECT_ENCRYPTION_KEYS",
    "value: none",
    "production: true",
  ];
  for (const marker of required) {
    if (!template.includes(marker)) issues.push(`the staging app-spec template is missing ${JSON.stringify(marker)}`);
  }
  const automaticDeployments = template.match(/deploy_on_push:\s*true/g) ?? [];
  if (automaticDeployments.length) issues.push("automatic source deployment must remain disabled for staging");
}

function validateDeploymentInputs(values, issues) {
  const repository = values.CHANGE_ME_GITHUB_REPOSITORY;
  if (repository && !/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    issues.push("NOURISH_DO_GITHUB_REPOSITORY must use owner/repository format");
  }
  const cluster = values.CHANGE_ME_EXISTING_MANAGED_POSTGRES_CLUSTER;
  if (cluster && !/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test(cluster)) {
    issues.push("NOURISH_DO_POSTGRES_CLUSTER must be a safe DigitalOcean cluster name");
  }
  const space = values.CHANGE_ME_PRIVATE_SPACE_NAME;
  if (space && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(space)) {
    issues.push("NOURISH_DO_SPACE_NAME must be a lowercase DNS-compatible bucket name");
  }
  const nutritionVersion = values.CHANGE_ME_REVIEWED_VERSION;
  if (nutritionVersion && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(nutritionVersion)) {
    issues.push("NOURISH_DO_NUTRITION_VERSION must be a safe reviewed version identifier");
  }
  const origin = values.CHANGE_ME_CONTROL_ROOM_ORIGIN;
  if (origin) validateHTTPSOrigin(origin, "NOURISH_DO_CONTROL_ROOM_ORIGIN", issues);
  const activeKeyID = values.CHANGE_ME_ENCRYPTION_ACTIVE_KEY_ID;
  const encodedKeyRing = values.CHANGE_ME_JSON_ENCRYPTION_KEYRING;
  if (encodedKeyRing) {
    try {
      const keyRing = JSON.parse(encodedKeyRing);
      if (!keyRing || Array.isArray(keyRing) || typeof keyRing !== "object" || !Object.keys(keyRing).length) throw new Error();
      for (const [keyID, encodedKey] of Object.entries(keyRing)) {
        const decoded = Buffer.from(String(encodedKey), "base64");
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(keyID)
            || typeof encodedKey !== "string" || decoded.length !== 32
            || decoded.toString("base64") !== encodedKey) throw new Error();
      }
      if (!activeKeyID || !keyRing[activeKeyID]) {
        issues.push("NOURISH_DO_ENCRYPTION_ACTIVE_KEY_ID must identify a configured encryption key");
      }
    } catch {
      issues.push("NOURISH_DO_ENCRYPTION_KEYS must be a non-empty JSON object of safe key IDs to base64-encoded 256-bit keys");
    }
  }
  if (values.CHANGE_ME_SPACES_READ_ACCESS_KEY
      && values.CHANGE_ME_SPACES_READ_ACCESS_KEY === values.CHANGE_ME_SPACES_WRITE_DELETE_ACCESS_KEY) {
    issues.push("API and worker Spaces access key IDs must be different");
  }
}

function validateRuntime(processType, values, issues) {
  try {
    validateRuntimeConfiguration({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://preflight:secret@private-db.example.test:25060/nourish",
      DATABASE_REQUIRE_TLS: "true",
      DATABASE_AUTO_MIGRATE: "false",
      NOURISH_PRIVATE_OBJECT_STORE: "s3",
      NOURISH_PRIVATE_OBJECT_BUCKET: values.CHANGE_ME_PRIVATE_SPACE_NAME,
      NOURISH_PRIVATE_OBJECT_REGION: "us-east-1",
      NOURISH_PRIVATE_OBJECT_ENDPOINT: "https://blr1.digitaloceanspaces.com",
      NOURISH_PRIVATE_OBJECT_PREFIX: "nourish/staging",
      NOURISH_PRIVATE_OBJECT_SSE: "none",
      NOURISH_PRIVATE_OBJECT_FORCE_PATH_STYLE: "false",
      NOURISH_PRIVATE_OBJECT_ENCRYPTION_ACTIVE_KEY_ID: values.CHANGE_ME_ENCRYPTION_ACTIVE_KEY_ID,
      NOURISH_PRIVATE_OBJECT_ENCRYPTION_KEYS: values.CHANGE_ME_JSON_ENCRYPTION_KEYRING,
      NOURISH_PLANNER_ELIGIBLE_LOCALES: "en-IN",
      NOURISH_PLANNER_NUTRITION_CALCULATION_VERSIONS: values.CHANGE_ME_REVIEWED_VERSION,
    }, { processType });
  } catch (error) {
    for (const issue of error?.issues ?? ["runtime configuration validation failed"]) {
      issues.push(`${processType}: ${issue}`);
    }
  }
}

function validateHTTPSOrigin(value, name, issues) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password
        || url.pathname !== "/" || url.search || url.hash) throw new Error();
  } catch {
    issues.push(`${name} must be an HTTPS origin without credentials, path, query, or fragment`);
  }
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function nonEmpty(value) {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}
