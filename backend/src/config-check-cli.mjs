import { validateRuntimeConfiguration } from "./runtime-configuration.mjs";

const processType = process.env.NOURISH_PROCESS_TYPE ?? "api";
const configuration = validateRuntimeConfiguration(process.env, { processType });
const summary = {
  status: "ok",
  processType: configuration.processType,
  environment: configuration.production ? "production" : "development",
  host: configuration.host,
  port: configuration.port,
  durableDatabaseConfigured: Boolean(configuration.databaseURL),
  databaseTLSRequired: configuration.databaseRequireTLS,
  privateObjectStorageConfigured: Boolean(configuration.privateObjectStoreType),
  privateObjectStorageType: configuration.privateObjectStoreType ?? "none",
  applicationObjectEncryptionConfigured: Boolean(configuration.privateObjectEncryptionActiveKeyID),
  automaticMigrations: configuration.databaseAutoMigrate,
  transactionalEmailConfigured: Boolean(configuration.emailProvider),
};
process.stdout.write(`${JSON.stringify(summary)}\n`);
