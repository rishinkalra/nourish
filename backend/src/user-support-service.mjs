import { createHash, randomUUID } from "node:crypto";
import { normalizeEmail } from "./auth-service.mjs";
import { withTransaction } from "./database.mjs";

const MINIMUM_REASON_LENGTH = 12;
const MAXIMUM_REASON_LENGTH = 500;

export class UserSupportError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "UserSupportError";
    this.code = code;
    this.status = status;
  }
}

export class UserSupportService {
  constructor({ dataset = {}, now = () => new Date() } = {}) {
    this.dataset = {
      users: dataset.users ?? [], profiles: dataset.profiles ?? [], subscriptions: dataset.subscriptions ?? [],
      sessions: dataset.sessions ?? [], planJobs: dataset.planJobs ?? [], planAdoptions: dataset.planAdoptions ?? [],
      weeklyReviews: dataset.weeklyReviews ?? [], accountExportRequests: dataset.accountExportRequests ?? [],
      accountDeletionRequests: dataset.accountDeletionRequests ?? [],
    };
    this.now = now;
    this.auditEvents = [];
  }

  async lookup(request) {
    const normalized = normalizeLookup(request);
    const user = this.dataset.users.find((candidate) => normalized.lookupType === "internal_id"
      ? String(candidate.id) === normalized.lookupValue
      : normalizeEmail(candidate.verifiedEmail ?? "") === normalized.lookupValue);
    const audit = makeAudit({ ...normalized, userID: user?.id, now: this.now() });
    this.auditEvents.push(audit);
    if (!user) throw new UserSupportError("NOT_FOUND", "No Nourish account matched that exact identifier.", 404);
    return projectMemoryUser(this.dataset, user, audit, this.now());
  }

  auditLog() {
    return structuredClone(this.auditEvents);
  }
}

export class PostgresUserSupportService {
  constructor({ pool, now = () => new Date() } = {}) {
    if (!pool?.connect) throw new Error("A PostgreSQL pool is required.");
    this.pool = pool;
    this.now = now;
  }

  async lookup(request) {
    const normalized = normalizeLookup(request);
    const occurredAt = this.now();
    const result = await withTransaction(this.pool, async (client) => {
      const selected = await client.query(USER_LOOKUP_SQL, [normalized.lookupType, normalized.lookupValue, occurredAt]);
      const row = selected.rows[0] ?? null;
      const audit = makeAudit({ ...normalized, userID: row?.user_id, now: occurredAt });
      await client.query(
        `INSERT INTO support_access_audit_logs (
            id, actor_reference, action, lookup_type, lookup_value_sha256,
            matched_user_id, matched_user_id_sha256, outcome, reason, correlation_id, occurred_at
         ) VALUES ($1, $2, 'user.lookup', $3, $4, $5, $6, $7, $8, $9, $10)`,
        [audit.id, audit.actorID, audit.lookupType, audit.lookupValueSHA256, row?.user_id ?? null,
          audit.matchedUserIDSHA256, audit.outcome, audit.reason, audit.correlationID, audit.occurredAt],
      );
      return { row, audit };
    });
    if (!result.row) throw new UserSupportError("NOT_FOUND", "No Nourish account matched that exact identifier.", 404);
    return projectPostgresUser(result.row, result.audit, occurredAt);
  }
}

const USER_LOOKUP_SQL = `
  SELECT user_account.id AS user_id, user_account.verified_email, user_account.created_at,
         user_account.disabled_at, profile.revision AS profile_revision, profile.updated_at AS profile_updated_at,
         subscription.state AS subscription_state, subscription.product_id, subscription.period_ends_at,
         subscription.reconciliation_status, subscription.last_verified_at,
         COALESCE(active_session.count, 0)::int AS active_session_count,
         latest_job.id AS latest_plan_job_id, latest_job.state AS latest_plan_job_state,
         latest_job.created_at AS latest_plan_job_created_at, latest_job.completed_at AS latest_plan_job_completed_at,
         COALESCE(adoption.count, 0)::int AS adopted_plan_count, adoption.latest_at AS latest_adoption_at,
         review.latest_at AS latest_weekly_review_at,
         export_request.status AS latest_export_status, export_request.requested_at AS latest_export_requested_at,
         deletion_request.status AS latest_deletion_status, deletion_request.requested_at AS latest_deletion_requested_at
    FROM users user_account
    LEFT JOIN profiles profile ON profile.user_id = user_account.id
    LEFT JOIN subscriptions subscription ON subscription.user_id = user_account.id
    LEFT JOIN LATERAL (
      SELECT count(*) AS count FROM sessions
       WHERE user_id = user_account.id AND revoked_at IS NULL AND refresh_expires_at > $3
    ) active_session ON true
    LEFT JOIN LATERAL (
      SELECT id, state, created_at, completed_at FROM plan_jobs
       WHERE user_id = user_account.id ORDER BY created_at DESC LIMIT 1
    ) latest_job ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS count, max(adopted_at) AS latest_at FROM plan_adoptions
       WHERE user_id = user_account.id
    ) adoption ON true
    LEFT JOIN LATERAL (
      SELECT max(submitted_at) AS latest_at FROM weekly_plan_reviews
       WHERE user_id = user_account.id
    ) review ON true
    LEFT JOIN LATERAL (
      SELECT status, requested_at FROM account_export_requests
       WHERE user_id = user_account.id ORDER BY requested_at DESC LIMIT 1
    ) export_request ON true
    LEFT JOIN LATERAL (
      SELECT status, requested_at FROM account_deletion_requests
       WHERE user_id = user_account.id ORDER BY requested_at DESC LIMIT 1
    ) deletion_request ON true
   WHERE ($1 = 'internal_id' AND user_account.id::text = $2)
      OR ($1 = 'verified_email' AND lower(user_account.verified_email) = $2)
   LIMIT 1`;

function normalizeLookup({ internalUserID, verifiedEmail, reason, actor, correlationID } = {}) {
  const hasID = typeof internalUserID === "string" && internalUserID.trim().length > 0;
  const hasEmail = typeof verifiedEmail === "string" && verifiedEmail.trim().length > 0;
  if (hasID === hasEmail) throw new UserSupportError("VALIDATION_ERROR", "Provide exactly one internal user ID or verified email.");
  const normalizedReason = String(reason ?? "").trim();
  if (normalizedReason.length < MINIMUM_REASON_LENGTH || normalizedReason.length > MAXIMUM_REASON_LENGTH) {
    throw new UserSupportError("VALIDATION_ERROR", `Support reason must be ${MINIMUM_REASON_LENGTH}–${MAXIMUM_REASON_LENGTH} characters.`);
  }
  if (!actor?.id) throw new UserSupportError("AUTHENTICATION_REQUIRED", "An accountable support operator is required.", 403);
  const lookupType = hasID ? "internal_id" : "verified_email";
  const lookupValue = hasID ? internalUserID.trim() : normalizeEmail(verifiedEmail);
  if (!lookupValue || lookupValue.length > 320) throw new UserSupportError("VALIDATION_ERROR", "The account identifier is invalid.");
  return { lookupType, lookupValue, reason: normalizedReason, actorID: String(actor.id), correlationID: correlationID ?? null };
}

function makeAudit({ lookupType, lookupValue, reason, actorID, correlationID, userID, now }) {
  return {
    id: randomUUID(), actorID, action: "user.lookup", lookupType,
    lookupValueSHA256: sha256(lookupValue), matchedUserIDSHA256: userID ? sha256(String(userID)) : null,
    matchedUserID: userID ?? null, outcome: userID ? "found" : "not_found", reason,
    correlationID, occurredAt: date(now),
  };
}

function projectMemoryUser(dataset, user, audit, now) {
  const byUser = (row) => String(row.userID) === String(user.id);
  const profile = latest(dataset.profiles.filter(byUser), "updatedAt");
  const subscription = latest(dataset.subscriptions.filter(byUser), "updatedAt");
  const sessions = dataset.sessions.filter((session) => byUser(session) && !session.revokedAt && date(session.refreshExpiresAt) > date(now));
  const planJob = latest(dataset.planJobs.filter(byUser), "createdAt");
  const adoptions = dataset.planAdoptions.filter(byUser);
  const weeklyReview = latest(dataset.weeklyReviews.filter(byUser), "submittedAt");
  const exportRequest = latest(dataset.accountExportRequests.filter(byUser), "requestedAt");
  const deletionRequest = latest(dataset.accountDeletionRequests.filter(byUser), "requestedAt");
  return supportProjection({
    userID: user.id, verifiedEmail: user.verifiedEmail, createdAt: user.createdAt, disabledAt: user.disabledAt,
    profileRevision: profile?.revision, profileUpdatedAt: profile?.updatedAt, activeSessionCount: sessions.length,
    subscriptionState: subscription?.state, productID: subscription?.productID, periodEndsAt: subscription?.periodEndsAt,
    reconciliationStatus: subscription?.reconciliationStatus, lastVerifiedAt: subscription?.lastVerifiedAt,
    latestPlanJobID: planJob?.id, latestPlanJobState: planJob?.state, latestPlanJobCreatedAt: planJob?.createdAt,
    latestPlanJobCompletedAt: planJob?.completedAt, adoptedPlanCount: adoptions.length,
    latestAdoptionAt: latest(adoptions, "adoptedAt")?.adoptedAt, latestWeeklyReviewAt: weeklyReview?.submittedAt,
    latestExportStatus: exportRequest?.status, latestExportRequestedAt: exportRequest?.requestedAt,
    latestDeletionStatus: deletionRequest?.status, latestDeletionRequestedAt: deletionRequest?.requestedAt,
  }, audit);
}

function projectPostgresUser(row, audit) {
  return supportProjection({
    userID: row.user_id, verifiedEmail: row.verified_email, createdAt: row.created_at, disabledAt: row.disabled_at,
    profileRevision: row.profile_revision, profileUpdatedAt: row.profile_updated_at, activeSessionCount: row.active_session_count,
    subscriptionState: row.subscription_state, productID: row.product_id, periodEndsAt: row.period_ends_at,
    reconciliationStatus: row.reconciliation_status, lastVerifiedAt: row.last_verified_at,
    latestPlanJobID: row.latest_plan_job_id, latestPlanJobState: row.latest_plan_job_state,
    latestPlanJobCreatedAt: row.latest_plan_job_created_at, latestPlanJobCompletedAt: row.latest_plan_job_completed_at,
    adoptedPlanCount: row.adopted_plan_count, latestAdoptionAt: row.latest_adoption_at,
    latestWeeklyReviewAt: row.latest_weekly_review_at, latestExportStatus: row.latest_export_status,
    latestExportRequestedAt: row.latest_export_requested_at, latestDeletionStatus: row.latest_deletion_status,
    latestDeletionRequestedAt: row.latest_deletion_requested_at,
  }, audit);
}

function supportProjection(value, audit) {
  const accessStates = new Set(["active", "trial", "graceOrBillingRetry", "upgraded", "downgraded"]);
  return {
    identity: { userID: value.userID, verifiedEmail: value.verifiedEmail, createdAt: date(value.createdAt), status: value.disabledAt ? "disabled" : "active" },
    account: { onboardingStatus: value.profileRevision ? "complete" : "not_started", profileRevision: value.profileRevision ?? null, profileUpdatedAt: dateOrNull(value.profileUpdatedAt), activeSessionCount: Number(value.activeSessionCount ?? 0) },
    subscription: { state: value.subscriptionState ?? "unknown", hasAccess: accessStates.has(value.subscriptionState), productID: value.productID ?? null, periodEndsAt: dateOrNull(value.periodEndsAt), reconciliationStatus: value.reconciliationStatus ?? "unknown", lastVerifiedAt: dateOrNull(value.lastVerifiedAt) },
    planning: { latestJobID: value.latestPlanJobID ?? null, latestJobState: value.latestPlanJobState ?? "none", latestJobCreatedAt: dateOrNull(value.latestPlanJobCreatedAt), latestJobCompletedAt: dateOrNull(value.latestPlanJobCompletedAt), adoptedPlanCount: Number(value.adoptedPlanCount ?? 0), latestAdoptionAt: dateOrNull(value.latestAdoptionAt), latestWeeklyReviewAt: dateOrNull(value.latestWeeklyReviewAt) },
    privacyRequests: { latestExport: requestState(value.latestExportStatus, value.latestExportRequestedAt), latestDeletion: requestState(value.latestDeletionStatus, value.latestDeletionRequestedAt) },
    accessReceipt: { id: audit.id, reason: audit.reason, outcome: audit.outcome, correlationID: audit.correlationID, occurredAt: date(audit.occurredAt) },
    supportBoundary: { readOnly: true, impersonationAvailable: false, exactMatchOnly: true, rawProfileAnswersReturned: false, tokensReturned: false, mealHistoryReturned: false },
  };
}

function requestState(status, requestedAt) { return status ? { status, requestedAt: dateOrNull(requestedAt) } : null; }
function latest(values, field) { return [...values].sort((a, b) => date(b[field]) - date(a[field]))[0] ?? null; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function date(value) { return value instanceof Date ? value : new Date(value); }
function dateOrNull(value) { return value == null ? null : date(value); }
