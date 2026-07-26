import { createHash, randomUUID } from "node:crypto";

const entitlementStates = new Set([
  "active",
  "trial",
  "graceOrBillingRetry",
  "expired",
  "revokedOrRefunded",
  "upgraded",
  "downgraded",
  "unknown",
]);
const accessStates = new Set(["active", "trial", "graceOrBillingRetry", "upgraded", "downgraded"]);

export class AccountError extends Error {
  constructor(code, message, status = 400, retryable = false) {
    super(message);
    this.name = "AccountError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export class MemoryAccountStore {
  entitlementsByUserID = new Map();
  appStoreEventIDs = new Map();
  appAccountTokenByUserID = new Map();
  userIDByAppAccountToken = new Map();
  notificationInbox = new Map();
  exportByIdempotencyKey = new Map();
  exportsByUserID = new Map();
  deletionByIdempotencyKey = new Map();
  deletionsByUserID = new Map();

  async readEntitlement(userID) {
    return this.entitlementsByUserID.get(userID) ?? null;
  }

  async applyVerifiedEntitlement(userID, event, snapshot) {
    if (this.appStoreEventIDs.has(event.eventID)) {
      if (this.appStoreEventIDs.get(event.eventID) !== userID) {
        throw storeError("APPLE_EVENT_OWNERSHIP_MISMATCH", "This verified App Store event belongs to another account.");
      }
      const existing = await this.readEntitlement(userID);
      if (!existing) return null;
      const refreshed = {
        ...existing,
        reconciliationStatus: "current",
        lastVerifiedAt: snapshot.lastVerifiedAt,
        nextReconciliationAt: snapshot.nextReconciliationAt,
        lastReconciliationErrorCode: null,
      };
      this.entitlementsByUserID.set(userID, refreshed);
      return refreshed;
    }
    this.appStoreEventIDs.set(event.eventID, userID);
    this.entitlementsByUserID.set(userID, snapshot);
    return snapshot;
  }

  async retainAfterReconciliationFailure(userID, fallback, nextReconciliationAt, errorCode) {
    const existing = this.entitlementsByUserID.get(userID) ?? fallback;
    const retained = { ...existing, reconciliationStatus: "delayed", nextReconciliationAt, lastReconciliationErrorCode: errorCode };
    this.entitlementsByUserID.set(userID, retained);
    return retained;
  }

  async retainAfterReconciliationMismatch(userID, fallback, nextReconciliationAt, errorCode) {
    const existing = this.entitlementsByUserID.get(userID) ?? fallback;
    const retained = { ...existing, reconciliationStatus: "mismatch", nextReconciliationAt, lastReconciliationErrorCode: errorCode };
    this.entitlementsByUserID.set(userID, retained);
    return retained;
  }

  async getOrCreateAppAccountToken(userID, proposedToken, createdAt) {
    const existing = this.appAccountTokenByUserID.get(userID);
    if (existing) return { appAccountToken: existing, createdAt: this.appAccountTokenCreatedAt.get(userID) };
    const owner = this.userIDByAppAccountToken.get(proposedToken);
    if (owner && owner !== userID) throw storeError("APPLE_APP_ACCOUNT_TOKEN_COLLISION", "Unable to allocate an App Store account token.");
    this.appAccountTokenByUserID.set(userID, proposedToken);
    this.userIDByAppAccountToken.set(proposedToken, userID);
    this.appAccountTokenCreatedAt.set(userID, createdAt);
    return { appAccountToken: proposedToken, createdAt };
  }

  appAccountTokenCreatedAt = new Map();

  async resolveAppStoreUser({ originalTransactionID, appAccountToken }) {
    let originalUserID = null;
    for (const [userID, entitlement] of this.entitlementsByUserID) {
      if (String(entitlement.originalTransactionID ?? "") === String(originalTransactionID ?? "")) originalUserID = userID;
    }
    const tokenUserID = appAccountToken ? this.userIDByAppAccountToken.get(String(appAccountToken).toLowerCase()) ?? null : null;
    return {
      userID: originalUserID ?? tokenUserID,
      mismatch: Boolean(originalUserID && tokenUserID && originalUserID !== tokenUserID),
    };
  }

  async saveVerifiedNotification(event, receivedAt) {
    const existing = this.notificationInbox.get(event.eventID);
    if (existing) {
      if (existing.event.signedPayloadSHA256 !== event.signedPayloadSHA256) {
        throw storeError("APPLE_NOTIFICATION_REPLAY_MISMATCH", "A notification identifier was reused with different signed data.");
      }
      return structuredClone(existing);
    }
    const row = { event: structuredClone(event), processingState: "pending", userID: null, receivedAt, processedAt: null, failureCode: null };
    this.notificationInbox.set(event.eventID, row);
    return structuredClone(row);
  }

  async pendingVerifiedNotifications({ originalTransactionID, appAccountToken }) {
    return [...this.notificationInbox.values()]
      .filter((row) => row.processingState === "pending"
        && (String(row.event.originalTransactionID) === String(originalTransactionID)
          || (appAccountToken && row.event.appAccountToken === String(appAccountToken).toLowerCase())))
      .sort((left, right) => left.receivedAt - right.receivedAt)
      .map((row) => structuredClone(row.event));
  }

  async markVerifiedNotification(eventID, { processingState, userID = null, processedAt, failureCode = null }) {
    const row = this.notificationInbox.get(eventID);
    if (!row) return;
    Object.assign(row, { processingState, userID, processedAt, failureCode });
  }

  async markReconciliationDue(userID, dueAt) {
    const existing = this.entitlementsByUserID.get(userID);
    if (!existing) return null;
    const due = { ...existing, nextReconciliationAt: dueAt, reconciliationStatus: "pending" };
    this.entitlementsByUserID.set(userID, due);
    return due;
  }

  async createExport(userID, idempotencyKey, receipt) {
    const compoundKey = `${userID}:${idempotencyKey}`;
    const replay = this.exportByIdempotencyKey.get(compoundKey);
    if (replay) return replay;
    this.exportByIdempotencyKey.set(compoundKey, receipt);
    const values = this.exportsByUserID.get(userID) ?? [];
    values.push(receipt);
    this.exportsByUserID.set(userID, values);
    return receipt;
  }

  async createDeletion(userID, idempotencyKey, receipt) {
    const compoundKey = `${userID}:${idempotencyKey}`;
    const replay = this.deletionByIdempotencyKey.get(compoundKey);
    if (replay) return replay;
    this.deletionByIdempotencyKey.set(compoundKey, receipt);
    const values = this.deletionsByUserID.get(userID) ?? [];
    values.push(receipt);
    this.deletionsByUserID.set(userID, values);
    return receipt;
  }
}

export class AccountService {
  constructor({ store = new MemoryAccountStore(), analyticsEventService = null, now = () => new Date() } = {}) {
    this.store = store;
    this.analyticsEventService = analyticsEventService;
    this.now = now;
  }

  async readEntitlement(userID) {
    return structuredClone(await this.store.readEntitlement(userID) ?? this.#unknownEntitlement(userID));
  }

  async issueAppAccountToken(userID) {
    const issued = await this.store.getOrCreateAppAccountToken(userID, randomUUID().toLowerCase(), this.now());
    return structuredClone(issued);
  }

  async bindVerifiedAppStoreTransaction(userID, event) {
    this.#validateVerifiedEvent(event, "app_store_transaction");
    if (!event.originalTransactionID || !event.transactionID || !event.appAccountToken) {
      throw new AccountError("VALIDATION_ERROR", "The verified App Store transaction identity is incomplete.");
    }
    const issued = await this.issueAppAccountToken(userID);
    if (event.appAccountToken.toLowerCase() !== issued.appAccountToken.toLowerCase()) {
      throw new AccountError("APPLE_APP_ACCOUNT_TOKEN_MISMATCH", "This App Store transaction is not linked to the signed-in FamilyChef account.", 409);
    }
    const resolution = await this.store.resolveAppStoreUser(event);
    if (resolution.mismatch || (resolution.userID && resolution.userID !== userID)) {
      throw new AccountError("APPLE_SUBSCRIPTION_OWNERSHIP_MISMATCH", "This App Store subscription is already linked to another FamilyChef account.", 409);
    }
    const existing = await this.store.readEntitlement(userID);
    if (!existing?.lastVerifiedAt || String(existing.originalTransactionID ?? "") !== String(event.originalTransactionID)) {
      await this.recordVerifiedAppStoreEvent(userID, event);
    }
    const entitlement = await this.store.markReconciliationDue(userID, this.now());
    const pending = await this.store.pendingVerifiedNotifications(event);
    for (const notification of pending) await this.recordVerifiedAppStoreNotification(notification);
    return structuredClone(await this.store.readEntitlement(userID) ?? entitlement);
  }

  async recordVerifiedAppStoreNotification(event) {
    if (!event?.actionable) return { status: "ignored" };
    this.#validateVerifiedEvent(event, "app_store_server_notification_v2");
    if (!event.originalTransactionID || !event.transactionID) {
      throw new AccountError("VALIDATION_ERROR", "The verified App Store notification identity is incomplete.");
    }
    const receivedAt = this.now();
    const inbox = await this.store.saveVerifiedNotification(event, receivedAt);
    if (inbox.processingState === "applied") return { status: "applied", replay: true };
    const resolution = await this.store.resolveAppStoreUser(inbox.event);
    if (resolution.mismatch) {
      await this.store.markVerifiedNotification(event.eventID, {
        processingState: "failed", processedAt: receivedAt, failureCode: "APPLE_SUBSCRIPTION_OWNERSHIP_MISMATCH",
      });
      throw new AccountError("APPLE_SUBSCRIPTION_OWNERSHIP_MISMATCH", "The verified Apple identities resolve to different FamilyChef accounts.", 409);
    }
    if (!resolution.userID) return { status: "pending" };
    try {
      const previous = await this.store.readEntitlement(resolution.userID);
      const entitlement = await this.recordVerifiedAppStoreEvent(resolution.userID, inbox.event);
      await this.store.markVerifiedNotification(event.eventID, {
        processingState: "applied", userID: resolution.userID, processedAt: receivedAt,
      });
      return {
        status: "applied",
        userID: resolution.userID,
        previousState: previous?.state ?? "unknown",
        entitlement,
      };
    } catch (error) {
      await this.store.markVerifiedNotification(event.eventID, {
        processingState: "failed", userID: resolution.userID, processedAt: receivedAt,
        failureCode: boundedErrorCode(error.code ?? "APPLE_NOTIFICATION_APPLICATION_FAILED"),
      });
      throw error;
    }
  }

  async recordVerifiedAppStoreEvent(userID, event) {
    this.#validateVerifiedEvent(event);
    const now = this.now();
    const previous = this.analyticsEventService ? await this.store.readEntitlement(userID) : null;
    const snapshot = {
      userID,
      state: event.state,
      hasAccess: accessStates.has(event.state),
      productID: event.productID ?? null,
      environment: event.environment ?? "unknown",
      periodEndsAt: event.periodEndsAt ?? null,
      willAutoRenew: event.willAutoRenew ?? null,
      verificationStatus: "verified",
      lastVerifiedAt: now,
      nextReconciliationAt: new Date(now.getTime() + 6 * 60 * 60_000),
      reconciliationStatus: "current",
      sourceEventID: event.eventID,
      originalTransactionID: event.originalTransactionID ?? null,
      transactionID: event.transactionID ?? null,
      appAccountToken: event.appAccountToken ?? null,
    };
    const entitlement = await this.store.applyVerifiedEntitlement(userID, event, snapshot);
    await this.#recordVerifiedSubscriptionAnalytics(userID, event, previous?.state ?? "unknown", entitlement);
    return structuredClone(entitlement);
  }

  async #recordVerifiedSubscriptionAnalytics(userID, event, previousState, entitlement) {
    const service = this.analyticsEventService;
    if (!service?.recordServerEvent || !entitlement) return;
    const productID = analyticsToken(event.productID ?? entitlement.productID, "unknown_product", 120);
    const events = [];
    if (event.source === "app_store_transaction") {
      events.push({
        eventName: "purchase_completed",
        dedupeKey: analyticsDedupe("purchase", event.transactionID ?? event.eventID),
        occurredAt: event.purchasedAt ?? undefined,
        properties: { product_id: productID, offer_type: analyticsToken(event.offerType, "standard") },
      });
    }
    if (entitlement.state === "trial") {
      events.push({
        eventName: "trial_started",
        dedupeKey: analyticsDedupe("trial", event.originalTransactionID ?? event.eventID),
        occurredAt: event.purchasedAt ?? undefined,
        properties: { product_id: productID, period: analyticsToken(event.trialPeriod, "free_trial") },
      });
    }
    if (previousState !== entitlement.state) {
      events.push({
        eventName: "subscription_state_changed",
        dedupeKey: analyticsDedupe("subscription-state", event.eventID),
        properties: {
          from_state: analyticsToken(previousState, "unknown"),
          to_state: analyticsToken(entitlement.state, "unknown"),
          notification_type: analyticsToken(event.notificationType, "VERIFIED_TRANSACTION"),
        },
      });
    }
    for (const analyticsEvent of events) {
      try {
        await service.recordServerEvent({ userID, ...analyticsEvent });
      } catch {
        // Verified entitlement application remains authoritative if optional measurement is unavailable.
      }
    }
  }

  #validateVerifiedEvent(event, requiredSource = null) {
    if (!event?.verified || !event.eventID || !entitlementStates.has(event.state) || !/^[a-f0-9]{64}$/i.test(event.signedPayloadSHA256 ?? "")) {
      throw new AccountError("VALIDATION_ERROR", "The verified App Store event is incomplete.");
    }
    const trustedSources = ["app_store_server_api", "app_store_server_notification_v2", "app_store_transaction"];
    if (!trustedSources.includes(event.source) || (requiredSource && event.source !== requiredSource)) {
      throw new AccountError("VALIDATION_ERROR", "The entitlement source is not trusted.");
    }
  }

  async recordReconciliationFailure(userID, errorCode = "APPLE_SERVER_UNAVAILABLE") {
    const nextReconciliationAt = new Date(this.now().getTime() + 30 * 60_000);
    return structuredClone(await this.store.retainAfterReconciliationFailure(
      userID,
      this.#unknownEntitlement(userID),
      nextReconciliationAt,
      boundedErrorCode(errorCode),
    ));
  }

  async recordReconciliationMismatch(userID, errorCode = "APPLE_SUBSCRIPTION_IDENTITY_MISMATCH") {
    const nextReconciliationAt = new Date(this.now().getTime() + 24 * 60 * 60_000);
    return structuredClone(await this.store.retainAfterReconciliationMismatch(
      userID,
      this.#unknownEntitlement(userID),
      nextReconciliationAt,
      boundedErrorCode(errorCode),
    ));
  }

  async requestExport(userID, idempotencyKey, { correlationID = null } = {}) {
    requireIdempotencyKey(idempotencyKey);
    const requestedAt = this.now();
    const receipt = {
      requestID: randomUUID(),
      status: "queued",
      requestedAt,
      expiresAt: null,
      format: "json",
      message: "Your portable export is queued. A private expiring download will be created after processing.",
    };
    return structuredClone(await this.store.createExport(userID, idempotencyKey, receipt, { correlationID }));
  }

  async requestDeletion(userID, request, idempotencyKey, { correlationID = null } = {}) {
    requireIdempotencyKey(idempotencyKey);
    if (request?.acknowledgement !== "DELETE") {
      throw new AccountError("VALIDATION_ERROR", "Type DELETE to confirm permanent account deletion.");
    }
    if (request.reason != null && (typeof request.reason !== "string" || request.reason.length > 500)) {
      throw new AccountError("VALIDATION_ERROR", "The optional deletion reason is too long.");
    }
    const requestedAt = this.now();
    const receipt = {
      requestID: randomUUID(),
      status: "queued",
      requestedAt,
      reason: request.reason?.trim() || null,
      accountAccessRevokedAt: requestedAt,
      message: "Account access is disabled and deletion is queued. App Store subscription cancellation is managed separately by Apple.",
    };
    return structuredClone(await this.store.createDeletion(userID, idempotencyKey, receipt, { correlationID }));
  }

  #unknownEntitlement(userID) {
    const now = this.now();
    return {
      userID,
      state: "unknown",
      hasAccess: false,
      productID: null,
      environment: "unknown",
      periodEndsAt: null,
      willAutoRenew: null,
      verificationStatus: "notConfigured",
      lastVerifiedAt: null,
      nextReconciliationAt: new Date(now.getTime() + 30 * 60_000),
      reconciliationStatus: "pending",
      sourceEventID: null,
    };
  }
}

export const accountSubjectHash = (userID) => createHash("sha256").update(userID, "utf8").digest("hex");

function requireIdempotencyKey(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new AccountError("VALIDATION_ERROR", "An idempotency key is required.");
  }
}

function boundedErrorCode(value) {
  return String(value ?? "APPLE_RECONCILIATION_FAILED").replace(/[^A-Z0-9_:-]/gi, "_").slice(0, 120);
}

function analyticsDedupe(prefix, ...parts) {
  return `${prefix}:${createHash("sha256").update(parts.map((part) => String(part ?? "")).join("|")).digest("hex")}`;
}

function analyticsToken(value, fallback, maximumLength = 80) {
  const token = String(value ?? "").replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, maximumLength);
  return token || fallback;
}

function storeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
