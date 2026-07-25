import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { AccountError, AccountService } from "./account-service.mjs";
import { AuthError, AuthService, MemoryMagicLinkDelivery } from "./auth-service.mjs";
import { CatalogueError, CatalogueService } from "./catalogue-service.mjs";
import { FeedbackError, FeedbackService } from "./feedback-service.mjs";
import { PlanError, PlannerService } from "./planner-service.mjs";
import { ProfileError, ProfileService } from "./profile-service.mjs";
import { WeeklyLoopService } from "./weekly-loop-service.mjs";
import { AppStoreServerError } from "./app-store-server-client.mjs";
import { AdminAuthError, AdminAuthService } from "./admin-auth-service.mjs";
import { PlanOperationsService } from "./plan-operations-service.mjs";
import { SubscriptionOperationsService } from "./subscription-operations-service.mjs";
import { AnalyticsOperationsService } from "./analytics-operations-service.mjs";
import { AnalyticsEventError, AnalyticsEventService } from "./analytics-event-service.mjs";
import { UserSupportError, UserSupportService } from "./user-support-service.mjs";
import { FeatureFlagError, FeatureFlagService } from "./feature-flag-service.mjs";
import { AdminExportError, AdminExportService } from "./admin-export-service.mjs";
import { MemoryPushRegistrationService, PushRegistrationError } from "./push-notification-service.mjs";

export function createNourishServer({ authService, adminAuthService, profileService, catalogueService, planService, planOperationsService, subscriptionOperationsService, analyticsOperationsService, analyticsEventService, userSupportService, featureFlagService, adminExportService, weeklyLoopService, feedbackService, accountService, pushRegistrationService, appStoreServerClient, delivery, adminKey, adminOrigin, readinessCheck, scoringConfiguration } = {}) {
  const resolvedDelivery = delivery ?? new MemoryMagicLinkDelivery();
  const resolvedAuth = authService ?? new AuthService({ delivery: resolvedDelivery });
  const resolvedAdminAuth = adminAuthService ?? new AdminAuthService();
  const resolvedProfiles = profileService ?? new ProfileService();
  const resolvedCatalogue = catalogueService ?? new CatalogueService();
  const resolvedPlanner = planService ?? new PlannerService({
    recipeProvider: () => resolvedCatalogue.publishedSnapshots(),
    scoringConfiguration,
  });
  const resolvedPlanOperations = planOperationsService ?? new PlanOperationsService({ planService: resolvedPlanner });
  const resolvedWeeklyLoop = weeklyLoopService ?? new WeeklyLoopService({
    planService: resolvedPlanner,
    recipeProvider: () => resolvedPlanner.recipeProvider(),
    scoringConfiguration,
  });
  const resolvedFeedback = feedbackService ?? new FeedbackService({ planService: resolvedPlanner });
  const resolvedAnalyticsEvents = analyticsEventService ?? new AnalyticsEventService();
  const resolvedAccount = accountService ?? new AccountService({ analyticsEventService: resolvedAnalyticsEvents });
  const resolvedSubscriptionOperations = subscriptionOperationsService ?? new SubscriptionOperationsService({ accountService: resolvedAccount });
  const resolvedAnalyticsOperations = analyticsOperationsService ?? new AnalyticsOperationsService();
  const resolvedUserSupport = userSupportService ?? new UserSupportService();
  const resolvedFeatureFlags = featureFlagService ?? new FeatureFlagService();
  const resolvedPushRegistrations = pushRegistrationService ?? new MemoryPushRegistrationService();
  const resolvedAdminExports = adminExportService ?? new AdminExportService({
    analyticsService: resolvedAnalyticsOperations,
    userSupportService: resolvedUserSupport,
  });

  const server = createServer(async (request, response) => {
    const correlationID = request.headers["x-correlation-id"] || randomUUID();
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname.startsWith("/admin/")) {
        applyAdminCORS(request, response, adminOrigin);
        if (request.method === "OPTIONS") return send(response, 204, null, correlationID);
      }
      if (url.pathname === "/admin/v1/auth/session" && request.method === "POST") {
        const body = await readJSON(request);
        return send(response, 200, await resolvedAdminAuth.exchange(body.identityToken, {
          route: url.pathname, correlationID,
        }), correlationID);
      }
      if (url.pathname === "/admin/v1/auth/session" && request.method === "GET") {
        return send(response, 200, await resolvedAdminAuth.current(adminAccessToken(request), {
          route: url.pathname, correlationID,
        }), correlationID);
      }
      if (url.pathname === "/admin/v1/auth/revoke" && request.method === "POST") {
        await resolvedAdminAuth.revoke(adminAccessToken(request), { route: url.pathname, correlationID });
        return send(response, 204, null, correlationID);
      }
      if (request.method === "GET" && url.pathname === "/healthz") {
        return send(response, 200, { status: "ok" }, correlationID);
      }
      if (request.method === "GET" && url.pathname === "/readyz") {
        try {
          const dependency = readinessCheck ? await readinessCheck() : { status: "ok", persistence: "memory" };
          return send(response, 200, { status: "ready", dependency }, correlationID);
        } catch {
          return sendError(response, 503, "TEMPORARY_FAILURE", "Nourish persistence is not ready.", correlationID, true);
        }
      }
      if (request.method === "POST" && url.pathname === "/v1/auth/magic-link") {
        const body = await readJSON(request);
        const receipt = await resolvedAuth.requestMagicLink(body.email);
        return send(response, 202, receipt, correlationID);
      }
      if (request.method === "POST" && url.pathname === "/v1/auth/magic-link/complete") {
        const body = await readJSON(request);
        const session = await resolvedAuth.completeMagicLink(body.token);
        return send(response, 200, session, correlationID);
      }
      if (request.method === "POST" && url.pathname === "/v1/auth/apple") {
        const body = await readJSON(request);
        const session = await resolvedAuth.authenticateWithApple(body);
        return send(response, 200, session, correlationID);
      }
      if (request.method === "POST" && url.pathname === "/v1/auth/refresh") {
        const body = await readJSON(request);
        const session = await resolvedAuth.refresh(body.refreshToken);
        return send(response, 200, session, correlationID);
      }
      if (request.method === "POST" && url.pathname === "/v1/auth/revoke") {
        const token = bearerToken(request);
        await resolvedAuth.revoke(token);
        return send(response, 204, null, correlationID);
      }
      if (url.pathname === "/v1/profile" && request.method === "GET") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        const profile = await resolvedProfiles.read(identity.userID);
        return send(response, 200, profile, correlationID);
      }
      if (url.pathname === "/v1/profile" && request.method === "PATCH") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        const body = await readJSON(request);
        const profile = await resolvedProfiles.update(identity.userID, body);
        return send(response, 200, profile, correlationID);
      }
      if (url.pathname === "/v1/feature-flags" && request.method === "GET") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        return send(response, 200, await resolvedFeatureFlags.evaluate({
          userID: identity.userID, appVersion: url.searchParams.get("appVersion"),
        }), correlationID);
      }
      if (url.pathname === "/v1/analytics/dimensions" && request.method === "POST") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        const body = await readJSON(request);
        return send(response, 200, await resolvedAnalyticsOperations.recordDimensions({
          userID: identity.userID,
          appVersion: body.appVersion,
          acquisitionSource: body.acquisitionSource,
        }), correlationID);
      }
      if (url.pathname === "/v1/analytics/events" && request.method === "POST") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        const body = await readJSON(request);
        return send(response, 202, await resolvedAnalyticsEvents.recordClientEvent({
          userID: identity.userID,
          eventID: body.eventID,
          eventName: body.eventName,
          schemaVersion: body.schemaVersion,
          occurredAt: body.occurredAt,
          properties: body.properties,
        }), correlationID);
      }
      if (url.pathname === "/v1/analytics/consent" && request.method === "PATCH") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        const body = await readJSON(request);
        return send(response, 200, await resolvedAnalyticsEvents.setConsent({
          userID: identity.userID,
          enabled: body.enabled,
        }), correlationID);
      }
      if (url.pathname === "/v1/push-registrations" && request.method === "POST") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        const body = await readJSON(request);
        return send(response, 200, await resolvedPushRegistrations.register(identity.userID, body), correlationID);
      }
      if (url.pathname === "/v1/push-registrations" && request.method === "DELETE") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        const body = await readJSON(request);
        await resolvedPushRegistrations.unregister(identity.userID, body);
        return send(response, 204, null, correlationID);
      }
      if (url.pathname === "/v1/plans" && request.method === "POST") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        const storedProfile = await resolvedProfiles.read(identity.userID);
        const body = await readJSON(request);
        const job = await resolvedPlanner.create({
          userID: identity.userID,
          profile: storedProfile?.profile,
          profileRevision: storedProfile?.revision,
          request: body,
          idempotencyKey: request.headers["idempotency-key"],
          correlationID,
        });
        await recordServerAnalytics(resolvedAnalyticsEvents, {
          userID: identity.userID,
          eventName: "plan_generation_started",
          dedupeKey: `plan-start:${request.headers["idempotency-key"]}`,
          properties: {
            plan_week: body.weekStartLocalDate,
            generator_version: job.generatorVersion ?? "whole-week-serving-planner-v2",
            trigger: body.trigger ?? "initial",
          },
        });
        if (["succeeded", "rejected", "failed"].includes(job.state)) {
          await recordPlanOutcomeAnalytics(
            resolvedAnalyticsEvents,
            identity.userID,
            await resolvedPlanner.read(job.id, identity.userID),
          );
        }
        return send(response, 202, job, correlationID);
      }
      if (url.pathname === "/v1/plans/active" && request.method === "GET") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        return send(response, 200, await resolvedWeeklyLoop.readActive(identity.userID), correlationID);
      }
      if (url.pathname === "/v1/plans/history" && request.method === "GET") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        return send(response, 200, await resolvedPlanner.history(identity.userID), correlationID);
      }
      const readPlanMatch = url.pathname.match(/^\/v1\/plans\/([^/]+)$/);
      if (readPlanMatch && request.method === "GET") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        const result = await resolvedPlanner.read(decodeURIComponent(readPlanMatch[1]), identity.userID);
        await recordPlanOutcomeAnalytics(resolvedAnalyticsEvents, identity.userID, result);
        return send(response, 200, result, correlationID);
      }
      const adoptPlanMatch = url.pathname.match(/^\/v1\/plans\/([^/]+)\/adopt$/);
      if (adoptPlanMatch && request.method === "POST") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        const planID = decodeURIComponent(adoptPlanMatch[1]);
        const adoption = await resolvedPlanner.adopt(
          planID,
          identity.userID,
          request.headers["idempotency-key"],
        );
        await recordServerAnalytics(resolvedAnalyticsEvents, {
          userID: identity.userID,
          eventName: "plan_adopted",
          dedupeKey: `plan-adopt:${request.headers["idempotency-key"]}`,
          properties: { plan_id: planID, plan_version: "1" },
        });
        return send(response, 200, adoption, correlationID);
      }
      const swapCandidatesMatch = url.pathname.match(/^\/v1\/plan-items\/([^/]+)\/swaps$/);
      if (swapCandidatesMatch && request.method === "GET") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        const storedProfile = await resolvedProfiles.read(identity.userID);
        return send(response, 200, await resolvedWeeklyLoop.swapCandidates({
          itemID: decodeURIComponent(swapCandidatesMatch[1]),
          userID: identity.userID,
          profile: storedProfile?.profile,
        }), correlationID);
      }
      const confirmSwapMatch = url.pathname.match(/^\/v1\/plan-items\/([^/]+)\/swap$/);
      if (confirmSwapMatch && request.method === "POST") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        const storedProfile = await resolvedProfiles.read(identity.userID);
        const body = await readJSON(request);
        const itemID = decodeURIComponent(confirmSwapMatch[1]);
        const active = await resolvedWeeklyLoop.readActive(identity.userID);
        const sourceItem = active.plan.days.flatMap((day) => day.items).find((item) => item.id === itemID);
        const candidate = (await resolvedWeeklyLoop.swapCandidates({
          itemID,
          userID: identity.userID,
          profile: storedProfile?.profile,
        })).find((entry) => entry.recipe.recipeID === body.replacementRecipeID);
        const receipt = await resolvedWeeklyLoop.applySwap({
          itemID,
          replacementRecipeID: body.replacementRecipeID,
          userID: identity.userID,
          profile: storedProfile?.profile,
          idempotencyKey: request.headers["idempotency-key"],
        });
        if (sourceItem && candidate) {
          await recordServerAnalytics(resolvedAnalyticsEvents, {
            userID: identity.userID,
            eventName: "meal_swapped",
            dedupeKey: analyticsDedupe("meal-swap", identity.userID, request.headers["idempotency-key"]),
            properties: {
              from_recipe: sourceItem.recipeSnapshot.recipeID,
              to_recipe: candidate.recipe.recipeID,
              calorie_delta: boundedNumber(candidate.calorieDelta, -2_000, 2_000),
              protein_delta: boundedNumber(candidate.proteinDeltaGrams, -500, 500),
            },
          });
        }
        return send(response, 200, receipt, correlationID);
      }
      const groceryMatch = url.pathname.match(/^\/v1\/grocery-lists\/([^/]+)$/);
      if (groceryMatch && request.method === "GET") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        return send(response, 200, await resolvedWeeklyLoop.readGroceryList(
          decodeURIComponent(groceryMatch[1]), identity.userID,
        ), correlationID);
      }
      if (groceryMatch && request.method === "PATCH") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        const body = await readJSON(request);
        const listID = decodeURIComponent(groceryMatch[1]);
        const before = await resolvedWeeklyLoop.readGroceryList(listID, identity.userID);
        const updated = await resolvedWeeklyLoop.updateGroceryList({
          id: listID,
          userID: identity.userID,
          expectedRevision: body.expectedRevision,
          changes: body.changes,
        });
        for (const [changeIndex, change] of (body.changes ?? []).entries()) {
          const item = before.items.find((candidate) => candidate.id === change.itemID);
          if (!item) continue;
          for (const [actionIndex, action] of groceryAnalyticsActions(change).entries()) {
            await recordServerAnalytics(resolvedAnalyticsEvents, {
              userID: identity.userID,
              eventName: "grocery_item_changed",
              dedupeKey: analyticsDedupe("grocery-change", listID, updated.revision, change.itemID, changeIndex, actionIndex),
              properties: { action, category: analyticsToken(item.category, "other") },
            });
          }
        }
        return send(response, 200, updated, correlationID);
      }
      const mealStatusMatch = url.pathname.match(/^\/v1\/plan-items\/([^/]+)\/status$/);
      if (mealStatusMatch && request.method === "PATCH") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        const body = await readJSON(request);
        const itemID = decodeURIComponent(mealStatusMatch[1]);
        const active = await resolvedWeeklyLoop.readActive(identity.userID);
        const context = active.plan.days.flatMap((day, dayIndex) => day.items.map((item) => ({ item, dayIndex })))
          .find((entry) => entry.item.id === itemID);
        const updated = await resolvedWeeklyLoop.updateMealStatus({
          itemID,
          userID: identity.userID,
          state: body.state,
          expectedRevision: body.expectedRevision,
        });
        if (context) {
          await recordServerAnalytics(resolvedAnalyticsEvents, {
            userID: identity.userID,
            eventName: "meal_status_changed",
            dedupeKey: analyticsDedupe("meal-status", identity.userID, itemID, updated.revision),
            properties: {
              status: updated.state,
              slot: context.item.slot,
              day_index: context.dayIndex,
            },
          });
        }
        return send(response, 200, updated, correlationID);
      }
      const prepTaskMatch = url.pathname.match(/^\/v1\/prep-tasks\/([^/]+)$/);
      if (prepTaskMatch && request.method === "PATCH") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        const body = await readJSON(request);
        return send(response, 200, await resolvedWeeklyLoop.updatePrepTask({
          taskID: decodeURIComponent(prepTaskMatch[1]),
          userID: identity.userID,
          isComplete: body.isComplete,
          expectedRevision: body.expectedRevision,
        }), correlationID);
      }
      if (url.pathname === "/v1/feedback" && request.method === "POST") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        const body = await readJSON(request);
        const receipt = await resolvedFeedback.submit(identity.userID, body);
        if (body.subjectType === "weeklyReview") {
          await recordServerAnalytics(resolvedAnalyticsEvents, {
            userID: identity.userID,
            eventName: "weekly_review_completed",
            dedupeKey: `weekly-review:${receipt.id}`,
            properties: {
              completion_rate: Number(body.completionRate),
              changes_requested: [...new Set(body.changesRequested ?? [])],
            },
          });
        } else {
          await recordServerAnalytics(resolvedAnalyticsEvents, {
            userID: identity.userID,
            eventName: "recipe_feedback_submitted",
            dedupeKey: `recipe-feedback:${receipt.id}`,
            properties: {
              rating: Number(body.rating),
              reason_tags: [...new Set(body.reasonTags ?? [])],
            },
          });
        }
        return send(response, 201, receipt, correlationID);
      }
      if (url.pathname === "/v1/entitlement" && request.method === "GET") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        return send(response, 200, await resolvedAccount.readEntitlement(identity.userID), correlationID);
      }
      if (url.pathname === "/v1/entitlement/app-account-token" && request.method === "POST") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        return send(response, 200, await resolvedAccount.issueAppAccountToken(identity.userID), correlationID);
      }
      if (url.pathname === "/v1/entitlement/transactions" && request.method === "POST") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        const body = await readJSON(request);
        const verifier = requireAppStoreClient(appStoreServerClient);
        const event = await verifier.verifyTransaction(body.signedTransactionInfo);
        const previous = await resolvedAccount.readEntitlement(identity.userID);
        const entitlement = await resolvedAccount.bindVerifiedAppStoreTransaction(identity.userID, event);
        await recordVerifiedSubscriptionAnalytics(resolvedAnalyticsEvents, {
          userID: identity.userID,
          event,
          previousState: previous.state,
          entitlement,
          includePurchase: true,
        });
        return send(response, 200, entitlement, correlationID);
      }
      if (url.pathname === "/v1/app-store/notifications/v2" && request.method === "POST") {
        const body = await readJSON(request);
        const verifier = requireAppStoreClient(appStoreServerClient);
        const event = await verifier.verifyNotification(body.signedPayload);
        const application = await resolvedAccount.recordVerifiedAppStoreNotification(event);
        if (application.status === "applied" && !application.replay && application.userID && application.entitlement) {
          await recordVerifiedSubscriptionAnalytics(resolvedAnalyticsEvents, {
            userID: application.userID,
            event,
            previousState: application.previousState,
            entitlement: application.entitlement,
          });
        }
        return send(response, 204, null, correlationID);
      }
      if (url.pathname === "/v1/account/export" && request.method === "POST") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        const receipt = await resolvedAccount.requestExport(
          identity.userID,
          request.headers["idempotency-key"],
        );
        await recordServerAnalytics(resolvedAnalyticsEvents, {
          userID: identity.userID,
          eventName: "account_export_requested",
          dedupeKey: `account-export:${request.headers["idempotency-key"]}`,
          properties: { request_id: receipt.requestID },
        });
        return send(response, 202, receipt, correlationID);
      }
      if (url.pathname === "/v1/account" && request.method === "DELETE") {
        const identity = await resolvedAuth.authenticate(bearerToken(request));
        const body = await readJSON(request);
        const entitlement = await resolvedAccount.readEntitlement(identity.userID);
        const receipt = await resolvedAccount.requestDeletion(
          identity.userID,
          body,
          request.headers["idempotency-key"],
        );
        await recordServerAnalytics(resolvedAnalyticsEvents, {
          userID: identity.userID,
          eventName: "account_deletion_requested",
          dedupeKey: `account-delete:${request.headers["idempotency-key"]}`,
          properties: {
            reason_optional: Boolean(body.reason?.trim()),
            entitlement_state: entitlement.state,
          },
        });
        await resolvedAuth.disableUserAndRevokeSessions(identity.userID);
        return send(response, 202, receipt, correlationID);
      }
      if (url.pathname === "/admin/v1/recipes" && request.method === "POST") {
        const actor = await adminActor(request, resolvedAdminAuth, adminKey, "author", url.pathname, correlationID);
        const body = await readJSON(request);
        return send(response, 201, await resolvedCatalogue.createRecipeDraft(body.recipe, body.content, actor), correlationID);
      }
      if (url.pathname === "/admin/v1/ingredients" && request.method === "POST") {
        const actor = await adminActor(request, resolvedAdminAuth, adminKey, "reviewer", url.pathname, correlationID);
        const body = await readJSON(request);
        return send(response, 201, await resolvedCatalogue.upsertIngredient(body.ingredient, actor), correlationID);
      }
      if (url.pathname === "/admin/v1/nutrient-records" && request.method === "POST") {
        const actor = await adminActor(request, resolvedAdminAuth, adminKey, "reviewer", url.pathname, correlationID);
        const body = await readJSON(request);
        return send(response, 201, await resolvedCatalogue.registerReviewedNutrientRecord(body.record, actor), correlationID);
      }
      if (url.pathname === "/admin/v1/catalogue/queue" && request.method === "GET") {
        await adminActor(request, resolvedAdminAuth, adminKey, "reviewer", url.pathname, correlationID);
        return send(response, 200, { items: await resolvedCatalogue.reviewQueue() }, correlationID);
      }
      if (url.pathname === "/admin/v1/catalogue/audit" && request.method === "GET") {
        await adminActor(request, resolvedAdminAuth, adminKey, "reviewer", url.pathname, correlationID);
        return send(response, 200, { events: await resolvedCatalogue.catalogueAuditLog() }, correlationID);
      }
      if (url.pathname === "/admin/v1/catalogue/content" && request.method === "GET") {
        await adminActor(request, resolvedAdminAuth, adminKey, "reviewer", url.pathname, correlationID);
        return send(response, 200, await resolvedCatalogue.contentInventory(), correlationID);
      }
      if (url.pathname === "/admin/v1/plan-runs" && request.method === "GET") {
        await adminActor(request, resolvedAdminAuth, adminKey, "operator", url.pathname, correlationID);
        return send(response, 200, await resolvedPlanOperations.list({
          state: url.searchParams.get("state") ?? "all",
          search: url.searchParams.get("search") ?? "",
          limit: url.searchParams.get("limit") ?? 100,
        }), correlationID);
      }
      const planRunMatch = url.pathname.match(/^\/admin\/v1\/plan-runs\/([^/]+)$/);
      if (planRunMatch && request.method === "GET") {
        await adminActor(request, resolvedAdminAuth, adminKey, "operator", url.pathname, correlationID);
        return send(response, 200, await resolvedPlanOperations.detail(decodeURIComponent(planRunMatch[1])), correlationID);
      }
      if (url.pathname === "/admin/v1/subscriptions" && request.method === "GET") {
        await adminActor(request, resolvedAdminAuth, adminKey, "operator", url.pathname, correlationID);
        return send(response, 200, await resolvedSubscriptionOperations.list({
          status: url.searchParams.get("status") ?? "all",
          search: url.searchParams.get("search") ?? "",
          limit: url.searchParams.get("limit") ?? 100,
        }), correlationID);
      }
      const subscriptionMatch = url.pathname.match(/^\/admin\/v1\/subscriptions\/([^/]+)$/);
      if (subscriptionMatch && request.method === "GET") {
        await adminActor(request, resolvedAdminAuth, adminKey, "operator", url.pathname, correlationID);
        return send(response, 200, await resolvedSubscriptionOperations.detail(decodeURIComponent(subscriptionMatch[1])), correlationID);
      }
      const subscriptionRetryMatch = url.pathname.match(/^\/admin\/v1\/subscriptions\/([^/]+)\/actions\/retry$/);
      if (subscriptionRetryMatch && request.method === "POST") {
        const actor = await adminActor(request, resolvedAdminAuth, adminKey, "operator", url.pathname, correlationID);
        const body = await readJSON(request);
        return send(response, 200, await resolvedSubscriptionOperations.retry(
          decodeURIComponent(subscriptionRetryMatch[1]),
          { reason: body.reason, actor, correlationID },
        ), correlationID);
      }
      if (url.pathname === "/admin/v1/kpis" && request.method === "GET") {
        await adminActor(request, resolvedAdminAuth, adminKey, "operator", url.pathname, correlationID);
        return send(response, 200, await resolvedAnalyticsOperations.kpis(analyticsRequest(url)), correlationID);
      }
      if (url.pathname === "/admin/v1/cohorts" && request.method === "GET") {
        await adminActor(request, resolvedAdminAuth, adminKey, "operator", url.pathname, correlationID);
        return send(response, 200, await resolvedAnalyticsOperations.cohorts(analyticsRequest(url)), correlationID);
      }
      if (url.pathname === "/admin/v1/exports" && request.method === "GET") {
        const actor = await adminActor(request, resolvedAdminAuth, adminKey, "operator", url.pathname, correlationID);
        return send(response, 200, await resolvedAdminExports.list({ actor }), correlationID);
      }
      if (url.pathname === "/admin/v1/exports" && request.method === "POST") {
        const body = await readJSON(request);
        const requiredRole = body.exportType === "support_account" ? "security_admin" : "operator";
        const actor = await adminActor(request, resolvedAdminAuth, adminKey, requiredRole, url.pathname, correlationID);
        return send(response, 201, await resolvedAdminExports.create(body, {
          actor, correlationID, idempotencyKey: request.headers["idempotency-key"],
        }), correlationID);
      }
      const exportContentMatch = url.pathname.match(/^\/admin\/v1\/exports\/([^/]+)\/content$/);
      if (exportContentMatch && request.method === "GET") {
        const actor = await adminActor(request, resolvedAdminAuth, adminKey, "operator", url.pathname, correlationID);
        const delivered = await resolvedAdminExports.download(decodeURIComponent(exportContentMatch[1]), {
          actor, correlationID, reason: request.headers["x-export-access-reason"],
        });
        return sendCSV(response, delivered, correlationID);
      }
      if (url.pathname === "/admin/v1/users/lookup" && request.method === "POST") {
        const actor = await adminActor(request, resolvedAdminAuth, adminKey, "operator", url.pathname, correlationID);
        const body = await readJSON(request);
        return send(response, 200, await resolvedUserSupport.lookup({
          internalUserID: body.internalUserID, verifiedEmail: body.verifiedEmail,
          reason: body.reason, actor, correlationID,
        }), correlationID);
      }
      const supportUserMatch = url.pathname.match(/^\/admin\/v1\/users\/([^/]+)$/);
      if (supportUserMatch && request.method === "GET") {
        const actor = await adminActor(request, resolvedAdminAuth, adminKey, "operator", url.pathname, correlationID);
        return send(response, 200, await resolvedUserSupport.lookup({
          internalUserID: decodeURIComponent(supportUserMatch[1]),
          reason: request.headers["x-support-access-reason"], actor, correlationID,
        }), correlationID);
      }
      if (url.pathname === "/admin/v1/flags" && request.method === "GET") {
        await adminActor(request, resolvedAdminAuth, adminKey, "security_admin", url.pathname, correlationID);
        return send(response, 200, await resolvedFeatureFlags.list(), correlationID);
      }
      if (url.pathname === "/admin/v1/flags" && request.method === "POST") {
        const actor = await adminActor(request, resolvedAdminAuth, adminKey, "security_admin", url.pathname, correlationID);
        const body = await readJSON(request);
        return send(response, body.expectedVersion == null ? 201 : 200, await resolvedFeatureFlags.save(body, {
          reason: body.reason, actor, correlationID,
        }), correlationID);
      }
      if (url.pathname === "/admin/v1/recipes" && request.method === "PATCH") {
        const actor = await adminActor(request, resolvedAdminAuth, adminKey, "author", url.pathname, correlationID);
        const body = await readJSON(request);
        return send(response, 200, await resolvedCatalogue.editDraft(body.versionID, body.content, actor), correlationID);
      }
      const submitMatch = url.pathname.match(/^\/admin\/v1\/recipes\/([^/]+)\/submit$/);
      if (submitMatch && request.method === "POST") {
        const actor = await adminActor(request, resolvedAdminAuth, adminKey, "author", url.pathname, correlationID);
        return send(response, 200, await resolvedCatalogue.submitLatestDraft(decodeURIComponent(submitMatch[1]), actor), correlationID);
      }
      const approveMatch = url.pathname.match(/^\/admin\/v1\/recipe-versions\/([^/]+)\/approve$/);
      if (approveMatch && request.method === "POST") {
        const actor = await adminActor(request, resolvedAdminAuth, adminKey, "reviewer", url.pathname, correlationID);
        return send(response, 200, await resolvedCatalogue.approve(decodeURIComponent(approveMatch[1]), actor), correlationID);
      }
      const rejectMatch = url.pathname.match(/^\/admin\/v1\/recipe-versions\/([^/]+)\/reject$/);
      if (rejectMatch && request.method === "POST") {
        const actor = await adminActor(request, resolvedAdminAuth, adminKey, "reviewer", url.pathname, correlationID);
        const body = await readJSON(request);
        return send(response, 200, await resolvedCatalogue.reject(decodeURIComponent(rejectMatch[1]), body.reason, actor), correlationID);
      }
      return sendError(response, 404, "VALIDATION_ERROR", "Route not found.", correlationID, false);
    } catch (error) {
      if (error instanceof AuthError || error instanceof AdminAuthError || error instanceof ProfileError || error instanceof CatalogueError || error instanceof PlanError || error instanceof FeedbackError || error instanceof AccountError || error instanceof AnalyticsEventError || error instanceof UserSupportError || error instanceof FeatureFlagError || error instanceof AdminExportError || error instanceof PushRegistrationError) {
        return sendError(response, error.status, error.code, error.message, correlationID, error.retryable ?? error.code === "RATE_LIMITED");
      }
      if (error instanceof AppStoreServerError) {
        const unavailable = error.retryable || error.code === "APP_STORE_SERVER_NOT_CONFIGURED";
        return sendError(
          response,
          unavailable ? 503 : 400,
          unavailable ? "TEMPORARY_FAILURE" : "VALIDATION_ERROR",
          unavailable ? "Apple verification is temporarily unavailable." : "The Apple-signed data could not be verified.",
          correlationID,
          unavailable,
        );
      }
      if (error?.code === "BODY_TOO_LARGE") {
        return sendError(response, 413, "VALIDATION_ERROR", "Request body is too large.", correlationID, false);
      }
      return sendError(response, 500, "TEMPORARY_FAILURE", "Nourish could not complete the request.", correlationID, true);
    }
  });

  return { server, authService: resolvedAuth, adminAuthService: resolvedAdminAuth, profileService: resolvedProfiles, catalogueService: resolvedCatalogue, planService: resolvedPlanner, planOperationsService: resolvedPlanOperations, subscriptionOperationsService: resolvedSubscriptionOperations, analyticsOperationsService: resolvedAnalyticsOperations, analyticsEventService: resolvedAnalyticsEvents, userSupportService: resolvedUserSupport, featureFlagService: resolvedFeatureFlags, adminExportService: resolvedAdminExports, weeklyLoopService: resolvedWeeklyLoop, feedbackService: resolvedFeedback, accountService: resolvedAccount, pushRegistrationService: resolvedPushRegistrations, delivery: resolvedDelivery };
}

async function recordServerAnalytics(service, event) {
  try {
    await service.recordServerEvent(event);
  } catch {
    // Product mutations remain authoritative if optional first-party measurement is unavailable.
  }
}

async function recordPlanOutcomeAnalytics(service, userID, result) {
  const job = result?.job;
  if (!job || !["succeeded", "rejected", "failed"].includes(job.state)) return;
  if (job.state === "succeeded" && result.plan) {
    await recordServerAnalytics(service, {
      userID,
      eventName: "plan_generation_succeeded",
      dedupeKey: analyticsDedupe("plan-succeeded", job.id),
      properties: {
        latency_ms: boundedInteger(Date.now() - new Date(job.createdAt ?? Date.now()).getTime(), 0, 3_600_000),
        calorie_deviation: boundedNumber(result.diagnostics?.meanAbsoluteDailyCalorieDeviation, -2_000, 2_000),
        recipe_count: boundedInteger(result.plan.days.flatMap((day) => day.items).length, 1, 100),
      },
    });
    return;
  }
  await recordServerAnalytics(service, {
    userID,
    eventName: "plan_generation_failed",
    dedupeKey: analyticsDedupe("plan-failed", job.id),
    properties: {
      error_code: analyticsToken(job.error?.code, "TEMPORARY_FAILURE"),
      retryable: Boolean(job.error?.retryable),
      candidate_pool_size: boundedInteger(
        result.diagnostics?.candidatePoolSize ?? job.diagnostics?.candidatePoolSize,
        0,
        100_000,
      ),
    },
  });
}

async function recordVerifiedSubscriptionAnalytics(service, {
  userID, event, previousState = "unknown", entitlement, includePurchase = false,
}) {
  const productID = analyticsToken(event.productID ?? entitlement.productID, "unknown_product", 120);
  if (includePurchase) {
    await recordServerAnalytics(service, {
      userID,
      eventName: "purchase_completed",
      dedupeKey: analyticsDedupe("purchase", event.transactionID ?? event.eventID),
      occurredAt: event.purchasedAt ?? undefined,
      properties: { product_id: productID, offer_type: analyticsToken(event.offerType, "standard") },
    });
  }
  if (entitlement.state === "trial") {
    await recordServerAnalytics(service, {
      userID,
      eventName: "trial_started",
      dedupeKey: analyticsDedupe("trial", event.originalTransactionID ?? event.eventID),
      occurredAt: event.purchasedAt ?? undefined,
      properties: { product_id: productID, period: analyticsToken(event.trialPeriod, "free_trial") },
    });
  }
  if (previousState !== entitlement.state) {
    await recordServerAnalytics(service, {
      userID,
      eventName: "subscription_state_changed",
      dedupeKey: analyticsDedupe("subscription-state", event.eventID),
      properties: {
        from_state: analyticsToken(previousState, "unknown"),
        to_state: analyticsToken(entitlement.state, "unknown"),
        notification_type: analyticsToken(event.notificationType, "VERIFIED_TRANSACTION"),
      },
    });
  }
}

function groceryAnalyticsActions(change) {
  const actions = [];
  if (change.disposition) actions.push(`disposition_${analyticsToken(change.disposition, "updated")}`);
  if (Object.prototype.hasOwnProperty.call(change, "userAdjustedGrams")) {
    actions.push(change.userAdjustedGrams == null ? "quantity_cleared" : "quantity_updated");
  }
  return actions;
}

function analyticsDedupe(prefix, ...parts) {
  return `${prefix}:${createHash("sha256").update(parts.map((part) => String(part ?? "")).join("|")).digest("hex")}`;
}

function analyticsToken(value, fallback, maximumLength = 80) {
  const token = String(value ?? "").replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, maximumLength);
  return token || fallback;
}

function boundedInteger(value, minimum, maximum) {
  return Math.round(boundedNumber(value, minimum, maximum));
}

function boundedNumber(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.min(maximum, Math.max(minimum, number));
}

function analyticsRequest(url) {
  return Object.fromEntries(["startDate", "endDate", "timeZone", "subscriptionState", "appVersion", "acquisitionSource", "dietType", "cohort", "cohortBy"]
    .map((key) => [key, url.searchParams.get(key)]).filter(([, value]) => value != null));
}

function applyAdminCORS(request, response, allowedOrigin) {
  const origin = request.headers.origin;
  if (!allowedOrigin || origin !== allowedOrigin) return;
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-methods", "GET, POST, PATCH, OPTIONS");
  response.setHeader("access-control-allow-headers", "authorization, content-type, idempotency-key, x-nourish-admin-key, x-nourish-admin-id, x-correlation-id, x-support-access-reason, x-export-access-reason");
  response.setHeader("access-control-max-age", "600");
  response.setHeader("vary", "Origin");
}

function requireAppStoreClient(client) {
  if (!client?.verifyNotification || !client?.verifyTransaction) {
    throw new AppStoreServerError("APP_STORE_SERVER_NOT_CONFIGURED", "App Store verification is not configured.");
  }
  return client;
}

async function adminActor(request, adminAuthService, configuredKey, requiredRole, route, correlationID) {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    return adminAuthService.authenticate(authorization.slice("Bearer ".length), requiredRole, { route, correlationID });
  }
  if (!configuredKey) throw new AdminAuthError("AUTHENTICATION_REQUIRED", "Administrator sign-in is required.", 401);
  if (request.headers["x-nourish-admin-key"] !== configuredKey) {
    throw new AdminAuthError("AUTHENTICATION_REQUIRED", "Catalogue administrator authentication failed.", 403);
  }
  const id = request.headers["x-nourish-admin-id"];
  if (typeof id !== "string" || !id.trim()) throw new AdminAuthError("AUTHENTICATION_REQUIRED", "Catalogue administrator identity is required.", 403);
  return {
    id: id.trim(),
    roles: ["author", "reviewer", "operator", "security_admin"],
    authenticationMethods: ["development_key"],
  };
}

function adminAccessToken(request) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) throw new AdminAuthError("AUTHENTICATION_REQUIRED", "Administrator sign-in is required.", 401);
  return authorization.slice("Bearer ".length);
}

function bearerToken(request) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    throw new AuthError("AUTHENTICATION_REQUIRED", "Please sign in again.", 401);
  }
  return authorization.slice("Bearer ".length);
}

async function readJSON(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_048_576) {
      const error = new Error("Request body is too large");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AuthError("VALIDATION_ERROR", "Request body must be valid JSON.");
  }
}

function send(response, status, payload, correlationID) {
  response.statusCode = status;
  response.setHeader("x-correlation-id", correlationID);
  response.setHeader("cache-control", "no-store");
  if (status === 204) return response.end();
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function sendCSV(response, delivered, correlationID) {
  const filename = String(delivered.filename ?? "nourish-export.csv").replace(/[^A-Za-z0-9._-]/g, "-");
  response.statusCode = 200;
  response.setHeader("x-correlation-id", correlationID);
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-type", "text/csv; charset=utf-8");
  response.setHeader("content-disposition", `attachment; filename="${filename}"`);
  response.setHeader("x-content-sha256", delivered.contentSHA256);
  response.end(delivered.content);
}

function sendError(response, status, code, userSafeMessage, correlationID, retryable) {
  return send(response, status, { code, userSafeMessage, correlationID, retryable }, correlationID);
}
