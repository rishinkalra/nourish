import { createNourishServer } from "./server.mjs";
import { MemoryMagicLinkDelivery } from "./auth-service.mjs";
import { createPostgresRuntime } from "./postgres-runtime.mjs";
import { createOfficialAppStoreVerifierFromEnvironment } from "./app-store-server-client.mjs";
import { createPrivateObjectStore } from "./private-object-store.mjs";
import { plannerConfigurationFromEnvironment } from "./planner-service.mjs";
import { validateRuntimeConfiguration } from "./runtime-configuration.mjs";

const runtimeConfiguration = validateRuntimeConfiguration(process.env, { processType: "api" });
const { port, host } = runtimeConfiguration;
const delivery = new MemoryMagicLinkDelivery();
const scoringConfiguration = plannerConfigurationFromEnvironment();
const privateObjectStore = await createPrivateObjectStore(runtimeConfiguration);
const postgresRuntime = runtimeConfiguration.databaseURL
  ? await createPostgresRuntime({
    connectionString: runtimeConfiguration.databaseURL,
    requireTLS: runtimeConfiguration.databaseRequireTLS,
    maximumConnections: runtimeConfiguration.databasePoolMaximum,
    applicationName: runtimeConfiguration.databaseApplicationName,
    autoMigrate: runtimeConfiguration.databaseAutoMigrate,
    delivery,
    privateObjectStore,
    scoringConfiguration,
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
  process.stdout.write(`Nourish ${environmentName} API listening on http://${host}:${port} (${persistence})\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await new Promise((resolve) => server.close(resolve));
    await postgresRuntime.databasePool?.end();
    process.exit(0);
  });
}
