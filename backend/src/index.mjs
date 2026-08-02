import { createNourishServer } from "./server.mjs";
import { createPostgresRuntime } from "./postgres-runtime.mjs";
import { createOfficialAppStoreVerifierFromEnvironment } from "./app-store-server-client.mjs";
import { createPrivateObjectStore } from "./private-object-store.mjs";
import { plannerConfigurationFromEnvironment } from "./planner-service.mjs";
import { validateRuntimeConfiguration } from "./runtime-configuration.mjs";
import { createMagicLinkDelivery } from "./email-delivery-service.mjs";
import { createStructuredTelemetry } from "./observability.mjs";

const runtimeConfiguration = validateRuntimeConfiguration(process.env, { processType: "api" });
const { port, host } = runtimeConfiguration;
const telemetry = createStructuredTelemetry({
  service: "nourish-api",
  environment: runtimeConfiguration.production ? "production" : "development",
});
const delivery = createMagicLinkDelivery(runtimeConfiguration);
const scoringConfiguration = plannerConfigurationFromEnvironment();
const privateObjectStore = await createPrivateObjectStore(runtimeConfiguration);
const postgresRuntime = runtimeConfiguration.databaseURL
  ? await createPostgresRuntime({
    connectionString: runtimeConfiguration.databaseURL,
    requireTLS: runtimeConfiguration.databaseRequireTLS,
    caCertificate: runtimeConfiguration.databaseCACertificate,
    maximumConnections: runtimeConfiguration.databasePoolMaximum,
    applicationName: runtimeConfiguration.databaseApplicationName,
    autoMigrate: runtimeConfiguration.databaseAutoMigrate,
    delivery,
    privateObjectStore,
    scoringConfiguration,
    pushAppBundleID: runtimeConfiguration.apnsBundleID,
    rateLimitSecret: runtimeConfiguration.rateLimitSecret,
  })
  : {};
const appStoreServerClient = process.env.NOURISH_APP_STORE_INGRESS_ENABLED === "true"
  ? await createOfficialAppStoreVerifierFromEnvironment()
  : null;
const app = createNourishServer({
  ...postgresRuntime,
  appStoreServerClient,
  delivery,
  adminKey: process.env.NOURISH_ADMIN_KEY,
  adminOrigin: process.env.NOURISH_ADMIN_ORIGIN ?? "http://127.0.0.1:4173",
  scoringConfiguration,
  telemetry,
  trustProxy: runtimeConfiguration.trustProxy,
});
const { server } = app;

if (!runtimeConfiguration.production) {
  const originalSend = delivery.send.bind(delivery);
  delivery.send = async (message) => {
    await originalSend(message);
    const callback = `nourish://auth/magic-link?token=${encodeURIComponent(message.token)}`;
    process.stdout.write(`Development magic link for ${message.email}: ${callback}\n`);
  };
}

server.listen(port, host, () => {
  const persistence = postgresRuntime.databasePool ? "PostgreSQL durable persistence" : "in-memory persistence";
  const environmentName = runtimeConfiguration.production ? "production" : "development";
  process.stdout.write(`FamilyChef ${environmentName} API listening on http://${host}:${port} (${persistence})\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await new Promise((resolve) => server.close(resolve));
    await postgresRuntime.databasePool?.end();
    process.exit(0);
  });
}
