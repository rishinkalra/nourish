import { hostname } from "node:os";
import { createPostgresPool } from "./database.mjs";
import { LeasedJobWorker, PostgresJobQueue } from "./job-queue.mjs";
import { runMigrations } from "./migrations.mjs";
import { createPlanJobHandler } from "./plan-job-handler.mjs";
import { PostgresCatalogueReader } from "./postgres-catalogue-reader.mjs";
import { PostgresPlannerService } from "./postgres-plan-service.mjs";
import { createPrivateObjectStore } from "./private-object-store.mjs";
import { createPrivacyJobHandlers } from "./privacy-job-handlers.mjs";
import { AccountService } from "./account-service.mjs";
import { PostgresAccountStore } from "./postgres-account-store.mjs";
import { createOfficialAppStoreSubscriptionClientFromEnvironment } from "./app-store-server-client.mjs";
import { createEntitlementReconciliationHandler, scheduleDueEntitlementReconciliations } from "./entitlement-reconciliation.mjs";
import { cleanupExpiredExportObjects } from "./export-retention.mjs";
import { deleteExpiredAnalyticsEvents, PostgresAnalyticsEventService } from "./analytics-event-service.mjs";
import { plannerConfigurationFromEnvironment } from "./planner-service.mjs";
import { validateRuntimeConfiguration } from "./runtime-configuration.mjs";
import {
  PostgresPushRegistrationService,
  createAPNsPushProviderFromEnvironment,
  createPlanReadyNotificationHandler,
} from "./push-notification-service.mjs";

const runtimeConfiguration = validateRuntimeConfiguration(process.env, { processType: "worker" });

const pool = await createPostgresPool({
  connectionString: runtimeConfiguration.databaseURL,
  maximumConnections: runtimeConfiguration.databasePoolMaximum,
  requireTLS: runtimeConfiguration.databaseRequireTLS,
  applicationName: runtimeConfiguration.databaseApplicationName,
});
if (runtimeConfiguration.databaseAutoMigrate) await runMigrations(pool);

const objectStore = await createPrivateObjectStore(runtimeConfiguration);
const planService = new PostgresPlannerService({ pool });
const scoringConfiguration = plannerConfigurationFromEnvironment();
const analyticsEventService = new PostgresAnalyticsEventService({
  pool,
  retentionDays: runtimeConfiguration.analyticsRetentionDays,
});
const handlers = {
  ...createPrivacyJobHandlers({ pool, objectStore }),
  "plan.generate": createPlanJobHandler({
    pool,
    catalogueReader: new PostgresCatalogueReader({ pool }),
    planService,
    analyticsEventService,
    scoringConfiguration,
  }),
};
handlers["notification.plan-ready"] = createPlanReadyNotificationHandler({
  registrationService: new PostgresPushRegistrationService({
    pool, appBundleID: runtimeConfiguration.apnsBundleID,
  }),
  pushProvider: createAPNsPushProviderFromEnvironment(),
});
const reconciliationEnabled = process.env.NOURISH_APP_STORE_RECONCILIATION_ENABLED === "true";
if (reconciliationEnabled) {
  const appStoreClient = await createOfficialAppStoreSubscriptionClientFromEnvironment();
  handlers["entitlement.reconcile"] = createEntitlementReconciliationHandler({
    pool,
    appStoreClient,
    accountService: new AccountService({
      store: new PostgresAccountStore({ pool }), analyticsEventService,
    }),
  });
}
const worker = new LeasedJobWorker({
  queue: new PostgresJobQueue({ pool }),
  workerID: process.env.NOURISH_WORKER_ID ?? `${hostname()}:${process.pid}`,
  handlers,
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => { stopping = true; });
}

try {
  let nextReconciliationScanAt = 0;
  let nextExportRetentionScanAt = 0;
  let nextAnalyticsRetentionScanAt = 0;
  while (!stopping) {
    if (reconciliationEnabled && Date.now() >= nextReconciliationScanAt) {
      await scheduleDueEntitlementReconciliations({ pool });
      nextReconciliationScanAt = Date.now() + 60_000;
    }
    if (Date.now() >= nextExportRetentionScanAt) {
      try {
        await cleanupExpiredExportObjects({ pool, objectStore });
      } catch (error) {
        process.stderr.write(`${JSON.stringify({ event: "export_retention_scan_failed", code: error?.code ?? "TEMPORARY_FAILURE" })}\n`);
      }
      nextExportRetentionScanAt = Date.now() + 60_000;
    }
    if (Date.now() >= nextAnalyticsRetentionScanAt) {
      try {
        await deleteExpiredAnalyticsEvents({ pool });
      } catch (error) {
        process.stderr.write(`${JSON.stringify({ event: "analytics_retention_scan_failed", code: error?.code ?? "TEMPORARY_FAILURE" })}\n`);
      }
      nextAnalyticsRetentionScanAt = Date.now() + 60 * 60_000;
    }
    const result = await worker.runOnce();
    if (!result) await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
} finally {
  await pool.end();
}
