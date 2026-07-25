import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeConfigurationError, validateRuntimeConfiguration } from "../src/runtime-configuration.mjs";

const applicationEncryptionKey = Buffer.alloc(32, 7).toString("base64");
const validProduction = Object.freeze({
  NODE_ENV: "production",
  DATABASE_URL: "postgres://nourish:secret@database:5432/nourish",
  DATABASE_REQUIRE_TLS: "true",
  NOURISH_PRIVATE_OBJECT_STORE: "s3",
  NOURISH_PRIVATE_OBJECT_BUCKET: "nourish-private-staging",
  NOURISH_PRIVATE_OBJECT_REGION: "ap-south-1",
  NOURISH_PRIVATE_OBJECT_SSE: "AES256",
  NOURISH_PRIVATE_OBJECT_ENCRYPTION_ACTIVE_KEY_ID: "staging-2026-07",
  NOURISH_PRIVATE_OBJECT_ENCRYPTION_KEYS: JSON.stringify({ "staging-2026-07": applicationEncryptionKey }),
  NOURISH_PLANNER_ELIGIBLE_LOCALES: "en-IN",
  NOURISH_PLANNER_NUTRITION_CALCULATION_VERSIONS: "ifct-2017-v1",
});

test("production API configuration requires durable TLS persistence and planner allowlists", () => {
  assert.throws(
    () => validateRuntimeConfiguration({ NODE_ENV: "production" }, { processType: "api" }),
    (error) => error instanceof RuntimeConfigurationError
      && error.issues.includes("DATABASE_URL is required")
      && error.issues.includes("DATABASE_REQUIRE_TLS must be true in production")
      && error.issues.includes("NOURISH_PRIVATE_OBJECT_STORE must configure private export storage")
      && error.issues.some((issue) => issue.startsWith("NOURISH_PLANNER_ELIGIBLE_LOCALES"))
      && error.issues.some((issue) => issue.startsWith("NOURISH_PLANNER_NUTRITION_CALCULATION_VERSIONS")),
  );
});

test("production rejects development admin credentials and automatic schema mutation", () => {
  assert.throws(
    () => validateRuntimeConfiguration({
      ...validProduction,
      NOURISH_ADMIN_KEY: "must-not-deploy",
      DATABASE_AUTO_MIGRATE: "true",
    }),
    (error) => error.issues.includes("NOURISH_ADMIN_KEY is a development-only credential and must be unset in production")
      && error.issues.some((issue) => issue.startsWith("DATABASE_AUTO_MIGRATE")),
  );
});

test("valid production settings are normalized without exposing secrets", () => {
  const configuration = validateRuntimeConfiguration({
    ...validProduction,
    PORT: "9090",
    DATABASE_POOL_MAX: "12",
    NOURISH_ANALYTICS_RETENTION_DAYS: "120",
  });
  assert.equal(configuration.production, true);
  assert.equal(configuration.host, "0.0.0.0");
  assert.equal(configuration.port, 9090);
  assert.equal(configuration.databasePoolMaximum, 12);
  assert.equal(configuration.databaseApplicationName, "project-nourish-api");
  assert.equal(configuration.analyticsRetentionDays, 120);
  assert.equal(configuration.databaseAutoMigrate, false);
  assert.equal(configuration.privateObjectStoreType, "s3");
  assert.equal(configuration.privateObjectBucket, "nourish-private-staging");
  assert.equal(configuration.privateObjectEncryptionActiveKeyID, "staging-2026-07");
  assert.equal(configuration.privateObjectEncryptionKeys["staging-2026-07"].length, 32);
});

test("development API remains intentionally usable with in-memory persistence", () => {
  const configuration = validateRuntimeConfiguration({}, { processType: "api" });
  assert.equal(configuration.production, false);
  assert.equal(configuration.databaseURL, undefined);
  assert.equal(configuration.host, "127.0.0.1");
});

test("workers require database and private export storage in every environment", () => {
  assert.throws(
    () => validateRuntimeConfiguration({}, { processType: "worker" }),
    (error) => error.issues.includes("DATABASE_URL is required")
      && error.issues.includes("NOURISH_PRIVATE_OBJECT_STORE must configure private export storage"),
  );
});

test("production filesystem storage requires an explicit staging-only exception", () => {
  const base = {
    ...validProduction,
    NOURISH_PRIVATE_OBJECT_STORE: "filesystem",
    NOURISH_PRIVATE_OBJECT_ROOT: "/private-objects",
    NOURISH_PRIVATE_OBJECT_BUCKET: undefined,
    NOURISH_PRIVATE_OBJECT_REGION: undefined,
    NOURISH_PRIVATE_OBJECT_SSE: undefined,
  };
  assert.throws(
    () => validateRuntimeConfiguration(base),
    (error) => error.issues.some((issue) => issue.includes("explicit staging-only")),
  );
  const accepted = validateRuntimeConfiguration({
    ...base, NOURISH_ALLOW_STAGING_FILESYSTEM_OBJECT_STORE: "true",
  });
  assert.equal(accepted.privateObjectStoreType, "filesystem");
});

test("S3 storage requires explicit encryption and secure production endpoints", () => {
  assert.throws(
    () => validateRuntimeConfiguration({
      ...validProduction,
      NOURISH_PRIVATE_OBJECT_SSE: "aws:kms",
      NOURISH_PRIVATE_OBJECT_ENDPOINT: "http://objects.example.test",
    }),
    (error) => error.issues.includes("NOURISH_PRIVATE_OBJECT_KMS_KEY_ID is required when S3 encryption uses aws:kms")
      && error.issues.includes("NOURISH_PRIVATE_OBJECT_ENDPOINT must use HTTPS in production"),
  );
});

test("production private storage requires valid application encryption and supports provider-neutral SSE", () => {
  assert.throws(
    () => validateRuntimeConfiguration({
      ...validProduction,
      NOURISH_PRIVATE_OBJECT_ENCRYPTION_ACTIVE_KEY_ID: undefined,
      NOURISH_PRIVATE_OBJECT_ENCRYPTION_KEYS: undefined,
    }),
    (error) => error.issues.some((issue) => issue.startsWith("NOURISH_PRIVATE_OBJECT_ENCRYPTION_KEYS must configure")),
  );
  assert.throws(
    () => validateRuntimeConfiguration({
      ...validProduction,
      NOURISH_PRIVATE_OBJECT_ENCRYPTION_KEYS: JSON.stringify({ "staging-2026-07": "not-a-256-bit-key" }),
    }),
    (error) => error.issues.some((issue) => issue.includes("base64-encoded 256-bit keys")),
  );
  const digitalOcean = validateRuntimeConfiguration({
    ...validProduction,
    NOURISH_PRIVATE_OBJECT_REGION: "blr1",
    NOURISH_PRIVATE_OBJECT_ENDPOINT: "https://blr1.digitaloceanspaces.com",
    NOURISH_PRIVATE_OBJECT_SSE: "none",
  });
  assert.equal(digitalOcean.privateObjectSSE, "none");
});

test("S3 endpoints never accept embedded credentials", () => {
  assert.throws(
    () => validateRuntimeConfiguration({
      ...validProduction,
      NOURISH_PRIVATE_OBJECT_ENDPOINT: "https://access:secret@objects.example.test",
    }),
    (error) => error.issues.includes("NOURISH_PRIVATE_OBJECT_ENDPOINT must not embed credentials"),
  );
});

test("bounded numeric settings fail closed", () => {
  assert.throws(
    () => validateRuntimeConfiguration({ PORT: "0", DATABASE_POOL_MAX: "many", NOURISH_ANALYTICS_RETENTION_DAYS: "401" }),
    (error) => error.issues.length === 3,
  );
});

test("APNs delivery is fail-closed when enabled and optional before credentials exist", () => {
  const disabled = validateRuntimeConfiguration(validProduction);
  assert.equal(disabled.apnsEnabled, false);
  assert.equal(disabled.apnsBundleID, "com.projectnourish.app");
  assert.throws(
    () => validateRuntimeConfiguration({ ...validProduction, NOURISH_APNS_ENABLED: "true" }),
    (error) => error.issues.some((issue) => issue.startsWith("NOURISH_APNS_TEAM_ID"))
      && error.issues.some((issue) => issue.startsWith("NOURISH_APNS_KEY_ID"))
      && error.issues.some((issue) => issue.startsWith("NOURISH_APNS_PRIVATE_KEY")),
  );
});
