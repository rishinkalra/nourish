import { AccountService } from "./account-service.mjs";
import { checkDatabase, createPostgresPool } from "./database.mjs";
import { FeedbackService } from "./feedback-service.mjs";
import { PostgresJobQueue } from "./job-queue.mjs";
import { checkMigrationState, runMigrations } from "./migrations.mjs";
import { PostgresAccountStore } from "./postgres-account-store.mjs";
import { PostgresAuthService } from "./postgres-auth-service.mjs";
import { PostgresAdminAuthService } from "./postgres-admin-auth-service.mjs";
import { PostgresCatalogueReader } from "./postgres-catalogue-reader.mjs";
import { PostgresCatalogueService } from "./postgres-catalogue-service.mjs";
import { PostgresFeedbackStore } from "./postgres-feedback-store.mjs";
import { PostgresPlannerService } from "./postgres-plan-service.mjs";
import { PostgresPlanOperationsService } from "./plan-operations-service.mjs";
import { PostgresSubscriptionOperationsService } from "./subscription-operations-service.mjs";
import { PostgresAnalyticsOperationsService } from "./analytics-operations-service.mjs";
import { PostgresUserSupportService } from "./user-support-service.mjs";
import { PostgresFeatureFlagService } from "./feature-flag-service.mjs";
import { PostgresAdminExportService } from "./admin-export-service.mjs";
import { PostgresAnalyticsEventService } from "./analytics-event-service.mjs";
import { PostgresProfileStore } from "./postgres-profile-store.mjs";
import { PostgresWeeklyLoopService } from "./postgres-weekly-loop-service.mjs";
import { ProfileService } from "./profile-service.mjs";
import { ConfigurationGatedPrivateObjectStore } from "./private-object-store.mjs";
import { plannerConfigurationFromEnvironment } from "./planner-service.mjs";
import { PostgresPushRegistrationService } from "./push-notification-service.mjs";
import { PostgresRateLimitService } from "./rate-limit-service.mjs";
import { PostgresRecipeGenerationService } from "./recipe-generation-service.mjs";

export async function createPostgresRuntime({
  connectionString,
  requireTLS = false,
  caCertificate,
  maximumConnections = 10,
  autoMigrate = false,
  applicationName = "project-nourish-api",
  delivery,
  appleVerifier,
  adminIdentityVerifier,
  privateObjectStore = new ConfigurationGatedPrivateObjectStore(),
  scoringConfiguration = plannerConfigurationFromEnvironment(),
  pushAppBundleID = "com.projectnourish.app",
  rateLimitSecret = "nourish-development-rate-limit-secret",
} = {}) {
  const pool = await createPostgresPool({
    connectionString,
    requireTLS,
    caCertificate,
    maximumConnections,
    applicationName,
  });
  try {
    if (autoMigrate) await runMigrations(pool);
    const planService = new PostgresPlannerService({ pool });
    const catalogueReader = new PostgresCatalogueReader({ pool });
    const catalogueService = new PostgresCatalogueService({ pool });
    const analyticsOperationsService = new PostgresAnalyticsOperationsService({ pool });
    const analyticsEventService = new PostgresAnalyticsEventService({
      pool,
      retentionDays: Number.parseInt(process.env.NOURISH_ANALYTICS_RETENTION_DAYS ?? "90", 10),
    });
    const userSupportService = new PostgresUserSupportService({ pool });
    return {
      authService: new PostgresAuthService({ pool, delivery, appleVerifier }),
      rateLimitService: new PostgresRateLimitService({ pool, secret: rateLimitSecret }),
      adminAuthService: new PostgresAdminAuthService({ pool, verifier: adminIdentityVerifier }),
      profileService: new ProfileService({ store: new PostgresProfileStore({ pool }) }),
      accountService: new AccountService({
        store: new PostgresAccountStore({ pool }), analyticsEventService,
      }),
      planService,
      planOperationsService: new PostgresPlanOperationsService({ pool }),
      subscriptionOperationsService: new PostgresSubscriptionOperationsService({ pool }),
      analyticsOperationsService,
      analyticsEventService,
      userSupportService,
      featureFlagService: new PostgresFeatureFlagService({ pool }),
      pushRegistrationService: new PostgresPushRegistrationService({
        pool, appBundleID: pushAppBundleID,
      }),
      adminExportService: new PostgresAdminExportService({
        pool, analyticsService: analyticsOperationsService, userSupportService, objectStore: privateObjectStore,
      }),
      weeklyLoopService: new PostgresWeeklyLoopService({ pool, planService, catalogueReader, scoringConfiguration }),
      feedbackService: new FeedbackService({ planService, store: new PostgresFeedbackStore({ pool }) }),
      catalogueService,
      recipeGenerationService: new PostgresRecipeGenerationService({
        pool, objectStore: privateObjectStore, catalogueService,
      }),
      jobQueue: new PostgresJobQueue({ pool }),
      readinessCheck: async () => ({
        ...(await checkDatabase(pool)),
        schema: await checkMigrationState(pool),
      }),
      databasePool: pool,
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
