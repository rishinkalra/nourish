const PROCESS_TYPES = new Set(["api", "worker", "migration", "admin-provision"]);

export class RuntimeConfigurationError extends Error {
  constructor(issues) {
    super(`Invalid ${issues.length === 1 ? "setting" : "settings"}: ${issues.join("; ")}`);
    this.name = "RuntimeConfigurationError";
    this.code = "RUNTIME_CONFIGURATION_ERROR";
    this.issues = Object.freeze([...issues]);
  }
}

export function validateRuntimeConfiguration(environment = process.env, { processType = "api" } = {}) {
  if (!PROCESS_TYPES.has(processType)) {
    throw new RuntimeConfigurationError([`unsupported process type ${JSON.stringify(processType)}`]);
  }

  const production = environment.NODE_ENV === "production";
  const issues = [];
  const databaseURL = nonEmpty(environment.DATABASE_URL);
  const privateObjectRoot = nonEmpty(environment.NOURISH_PRIVATE_OBJECT_ROOT);
  const privateObjectBucket = nonEmpty(environment.NOURISH_PRIVATE_OBJECT_BUCKET);
  const requestedPrivateObjectStoreType = nonEmpty(environment.NOURISH_PRIVATE_OBJECT_STORE);
  const privateObjectStoreType = requestedPrivateObjectStoreType
    ?? (privateObjectBucket ? "s3" : privateObjectRoot ? "filesystem" : undefined);
  const requiresDatabase = production || processType !== "api";
  const requiresPrivateObjects = processType === "worker" || (production && processType === "api");

  if (requiresDatabase && !databaseURL) issues.push("DATABASE_URL is required");
  if (production && environment.DATABASE_REQUIRE_TLS !== "true") {
    issues.push("DATABASE_REQUIRE_TLS must be true in production");
  }
  if (production && environment.DATABASE_AUTO_MIGRATE === "true") {
    issues.push("DATABASE_AUTO_MIGRATE must not be true in production; run the migration command as a release step");
  }
  if (privateObjectStoreType && !["filesystem", "s3"].includes(privateObjectStoreType)) {
    issues.push("NOURISH_PRIVATE_OBJECT_STORE must be filesystem or s3");
  }
  if (requiresPrivateObjects && !privateObjectStoreType) {
    issues.push("NOURISH_PRIVATE_OBJECT_STORE must configure private export storage");
  }
  if (privateObjectStoreType === "filesystem") {
    if (!privateObjectRoot) issues.push("NOURISH_PRIVATE_OBJECT_ROOT is required for filesystem private storage");
    if (privateObjectBucket) issues.push("filesystem private storage must not configure NOURISH_PRIVATE_OBJECT_BUCKET");
    if (production && environment.NOURISH_ALLOW_STAGING_FILESYSTEM_OBJECT_STORE !== "true") {
      issues.push("production filesystem storage requires the explicit staging-only NOURISH_ALLOW_STAGING_FILESYSTEM_OBJECT_STORE=true override");
    }
  }
  const privateObjectRegion = nonEmpty(environment.NOURISH_PRIVATE_OBJECT_REGION);
  const privateObjectEndpoint = validatedEndpoint(environment.NOURISH_PRIVATE_OBJECT_ENDPOINT, { production, issues });
  const privateObjectPrefix = validatedPrefix(environment.NOURISH_PRIVATE_OBJECT_PREFIX, issues);
  const privateObjectSSE = nonEmpty(environment.NOURISH_PRIVATE_OBJECT_SSE);
  const privateObjectKMSKeyID = nonEmpty(environment.NOURISH_PRIVATE_OBJECT_KMS_KEY_ID);
  const privateObjectEncryptionActiveKeyID = nonEmpty(environment.NOURISH_PRIVATE_OBJECT_ENCRYPTION_ACTIVE_KEY_ID);
  const privateObjectEncryptionKeys = encryptionKeyRing(environment.NOURISH_PRIVATE_OBJECT_ENCRYPTION_KEYS, issues);
  if (privateObjectEncryptionActiveKeyID && !validEncryptionKeyID(privateObjectEncryptionActiveKeyID)) {
    issues.push("NOURISH_PRIVATE_OBJECT_ENCRYPTION_ACTIVE_KEY_ID must be a safe identifier of at most 64 characters");
  }
  if (privateObjectEncryptionActiveKeyID && !privateObjectEncryptionKeys[privateObjectEncryptionActiveKeyID]) {
    issues.push("NOURISH_PRIVATE_OBJECT_ENCRYPTION_ACTIVE_KEY_ID must identify a configured encryption key");
  }
  if (Object.keys(privateObjectEncryptionKeys).length && !privateObjectEncryptionActiveKeyID) {
    issues.push("NOURISH_PRIVATE_OBJECT_ENCRYPTION_ACTIVE_KEY_ID is required when encryption keys are configured");
  }
  if (production && requiresPrivateObjects && !Object.keys(privateObjectEncryptionKeys).length) {
    issues.push("NOURISH_PRIVATE_OBJECT_ENCRYPTION_KEYS must configure application-level private object encryption in production");
  }
  if (privateObjectStoreType === "s3") {
    if (privateObjectRoot) issues.push("S3 private storage must not configure NOURISH_PRIVATE_OBJECT_ROOT");
    if (!privateObjectBucket) issues.push("NOURISH_PRIVATE_OBJECT_BUCKET is required for S3 private storage");
    if (!privateObjectRegion) issues.push("NOURISH_PRIVATE_OBJECT_REGION is required for S3 private storage");
    if (!privateObjectSSE || !["none", "AES256", "aws:kms"].includes(privateObjectSSE)) {
      issues.push("NOURISH_PRIVATE_OBJECT_SSE must be none, AES256, or aws:kms for S3 private storage");
    }
    if (privateObjectSSE === "aws:kms" && !privateObjectKMSKeyID) {
      issues.push("NOURISH_PRIVATE_OBJECT_KMS_KEY_ID is required when S3 encryption uses aws:kms");
    }
  }
  if (production && nonEmpty(environment.NOURISH_ADMIN_KEY)) {
    issues.push("NOURISH_ADMIN_KEY is a development-only credential and must be unset in production");
  }

  if (production && (processType === "api" || processType === "worker")) {
    if (!configuredList(environment.NOURISH_PLANNER_ELIGIBLE_LOCALES).length) {
      issues.push("NOURISH_PLANNER_ELIGIBLE_LOCALES must contain at least one locale");
    }
    if (!configuredList(environment.NOURISH_PLANNER_NUTRITION_CALCULATION_VERSIONS).length) {
      issues.push("NOURISH_PLANNER_NUTRITION_CALCULATION_VERSIONS must contain at least one version");
    }
  }

  const port = integerSetting(environment.PORT, 8080, { name: "PORT", minimum: 1, maximum: 65_535, issues });
  const defaultPoolMaximum = processType === "worker" ? 5 : 10;
  const databasePoolMaximum = integerSetting(environment.DATABASE_POOL_MAX, defaultPoolMaximum, {
    name: "DATABASE_POOL_MAX", minimum: 1, maximum: 100, issues,
  });
  const analyticsRetentionDays = integerSetting(environment.NOURISH_ANALYTICS_RETENTION_DAYS, 90, {
    name: "NOURISH_ANALYTICS_RETENTION_DAYS", minimum: 1, maximum: 400, issues,
  });

  if (issues.length) throw new RuntimeConfigurationError(issues);

  return Object.freeze({
    processType,
    production,
    host: nonEmpty(environment.HOST) ?? (production ? "0.0.0.0" : "127.0.0.1"),
    port,
    databaseURL,
    databaseRequireTLS: environment.DATABASE_REQUIRE_TLS === "true",
    databasePoolMaximum,
    databaseApplicationName: `project-nourish-${processType}`,
    databaseAutoMigrate: environment.DATABASE_AUTO_MIGRATE === "true",
    privateObjectStoreType,
    privateObjectRoot,
    privateObjectBucket,
    privateObjectRegion,
    privateObjectEndpoint,
    privateObjectPrefix,
    privateObjectSSE,
    privateObjectKMSKeyID,
    privateObjectEncryptionActiveKeyID,
    privateObjectEncryptionKeys,
    privateObjectForcePathStyle: environment.NOURISH_PRIVATE_OBJECT_FORCE_PATH_STYLE === "true",
    analyticsRetentionDays,
  });
}

function validatedEndpoint(value, { production, issues }) {
  const endpoint = nonEmpty(value);
  if (!endpoint) return undefined;
  try {
    const url = new URL(endpoint);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    if (url.username || url.password) {
      issues.push("NOURISH_PRIVATE_OBJECT_ENDPOINT must not embed credentials");
    }
    if (production && url.protocol !== "https:") issues.push("NOURISH_PRIVATE_OBJECT_ENDPOINT must use HTTPS in production");
    return url.toString().replace(/\/$/, "");
  } catch {
    issues.push("NOURISH_PRIVATE_OBJECT_ENDPOINT must be an absolute HTTP or HTTPS URL");
    return undefined;
  }
}

function validatedPrefix(value, issues) {
  const prefix = nonEmpty(value);
  if (!prefix) return "";
  if (prefix.startsWith("/") || prefix.endsWith("/") || prefix.includes("\\")
      || prefix.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    issues.push("NOURISH_PRIVATE_OBJECT_PREFIX must be slash-separated safe path segments without leading or trailing slash");
    return "";
  }
  return prefix;
}

function integerSetting(value, fallback, { name, minimum, maximum, issues }) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) {
    issues.push(`${name} must be an integer from ${minimum} to ${maximum}`);
    return fallback;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    issues.push(`${name} must be an integer from ${minimum} to ${maximum}`);
    return fallback;
  }
  return parsed;
}

function configuredList(value) {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function encryptionKeyRing(value, issues) {
  const encoded = nonEmpty(value);
  if (!encoded) return Object.freeze({});
  try {
    const parsed = JSON.parse(encoded);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" || !Object.keys(parsed).length) throw new Error();
    const keys = {};
    for (const [keyID, keyValue] of Object.entries(parsed)) {
      if (!validEncryptionKeyID(keyID) || typeof keyValue !== "string") throw new Error();
      const key = Buffer.from(keyValue, "base64");
      if (key.length !== 32 || key.toString("base64") !== keyValue) throw new Error();
      keys[keyID] = key;
    }
    return Object.freeze(keys);
  } catch {
    issues.push("NOURISH_PRIVATE_OBJECT_ENCRYPTION_KEYS must be a non-empty JSON object of safe key IDs to base64-encoded 256-bit keys");
    return Object.freeze({});
  }
}

function validEncryptionKeyID(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(value ?? ""));
}

function nonEmpty(value) {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}
