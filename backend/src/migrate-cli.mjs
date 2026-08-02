import { createPostgresPool } from "./database.mjs";
import { runMigrations } from "./migrations.mjs";
import { validateRuntimeConfiguration } from "./runtime-configuration.mjs";

const runtimeConfiguration = validateRuntimeConfiguration(process.env, { processType: "migration" });

const pool = await createPostgresPool({
  connectionString: runtimeConfiguration.databaseURL,
  maximumConnections: 2,
  requireTLS: runtimeConfiguration.databaseRequireTLS,
  caCertificate: runtimeConfiguration.databaseCACertificate,
  applicationName: runtimeConfiguration.databaseApplicationName,
});

try {
  const applied = await runMigrations(pool);
  process.stdout.write(applied.length ? `Applied migrations: ${applied.join(", ")}\n` : "Database schema is current.\n");
} finally {
  await pool.end();
}
