import { createPostgresPool } from "./database.mjs";
import { checkMigrationState, runMigrations } from "./migrations.mjs";
import { provisionAdmin } from "./admin-provisioning.mjs";
import { validateRuntimeConfiguration } from "./runtime-configuration.mjs";

const runtimeConfiguration = validateRuntimeConfiguration(process.env, { processType: "admin-provision" });

const pool = await createPostgresPool({
  connectionString: runtimeConfiguration.databaseURL,
  requireTLS: runtimeConfiguration.databaseRequireTLS,
  maximumConnections: 2,
  applicationName: runtimeConfiguration.databaseApplicationName,
});

try {
  if (runtimeConfiguration.production) await checkMigrationState(pool);
  else await runMigrations(pool);
  const result = await provisionAdmin(pool, {
    provider: process.env.NOURISH_ADMIN_IDENTITY_PROVIDER,
    subject: process.env.NOURISH_ADMIN_IDENTITY_SUBJECT,
    verifiedEmail: process.env.NOURISH_ADMIN_VERIFIED_EMAIL,
    displayName: process.env.NOURISH_ADMIN_DISPLAY_NAME,
    roles: (process.env.NOURISH_ADMIN_ROLES ?? "").split(",").map((role) => role.trim()).filter(Boolean),
    reason: process.env.NOURISH_ADMIN_GRANT_REASON,
    provisionedBySubject: process.env.NOURISH_ADMIN_PROVISIONED_BY ?? "deployment",
  });
  process.stdout.write(`Provisioned FamilyChef administrator ${result.verifiedEmail} with roles ${result.roles.join(", ")}\n`);
} finally {
  await pool.end();
}
