import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const retryableAppleCodes = new Set([4040002, 4040004, 4040006, 5000001]);
const supportedEnvironments = new Set(["sandbox", "production"]);

export class AppStoreServerError extends Error {
  constructor(code, message, { retryable = false, status = null } = {}) {
    super(message);
    this.name = "AppStoreServerError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

export class OfficialAppStoreSubscriptionClient {
  constructor({ clientsByEnvironment, verifiersByEnvironment, allowedProductIDs = [] }) {
    this.clientsByEnvironment = clientsByEnvironment;
    this.verifiersByEnvironment = verifiersByEnvironment;
    this.allowedProductIDs = new Set(allowedProductIDs);
  }

  async fetchSubscriptionStatus({ originalTransactionID, environment }) {
    const normalizedEnvironment = normalizeEnvironment(environment);
    const client = this.clientsByEnvironment[normalizedEnvironment];
    const verifier = this.verifiersByEnvironment[normalizedEnvironment];
    if (!client?.getAllSubscriptionStatuses || !verifier?.verifyAndDecodeTransaction || !verifier?.verifyAndDecodeRenewalInfo) {
      throw new AppStoreServerError("APP_STORE_SERVER_NOT_CONFIGURED", `App Store ${normalizedEnvironment} reconciliation is not configured.`);
    }
    let response;
    try {
      response = await client.getAllSubscriptionStatuses(originalTransactionID);
    } catch (error) {
      throw normalizeAppleError(error);
    }
    if (normalizeEnvironment(response?.environment) !== normalizedEnvironment) {
      throw new AppStoreServerError("APPLE_ENVIRONMENT_MISMATCH", "Apple returned a subscription from a different environment.");
    }
    const candidates = [];
    for (const group of response.data ?? []) {
      for (const item of group.lastTransactions ?? []) {
        if (!item.signedTransactionInfo || !item.signedRenewalInfo) continue;
        let transaction;
        let renewal;
        try {
          [transaction, renewal] = await Promise.all([
            verifier.verifyAndDecodeTransaction(item.signedTransactionInfo),
            verifier.verifyAndDecodeRenewalInfo(item.signedRenewalInfo),
          ]);
        } catch (error) {
          throw new AppStoreServerError("APPLE_SIGNATURE_INVALID", "Apple subscription data could not be cryptographically verified.", { retryable: isRetryableVerification(error) });
        }
        if (String(transaction.originalTransactionId) !== String(originalTransactionID)
          || String(item.originalTransactionId) !== String(originalTransactionID)) continue;
        candidates.push({ item, transaction, renewal });
      }
    }
    if (!candidates.length) {
      throw new AppStoreServerError("APPLE_SUBSCRIPTION_IDENTITY_MISMATCH", "Apple returned no verified subscription matching the saved original transaction.");
    }
    candidates.sort(compareCandidates);
    const event = normalizedVerifiedEvent(candidates[0], normalizedEnvironment);
    this.#requireAllowedProduct(event.productID);
    return event;
  }

  async verifyNotification(signedPayload) {
    requireSignedJWS(signedPayload, "notification");
    const verified = await verifyAcrossEnvironments(this.verifiersByEnvironment, async (verifier) => {
      if (!verifier?.verifyAndDecodeNotification || !verifier?.verifyAndDecodeTransaction) {
        throw new AppStoreServerError("APP_STORE_SERVER_NOT_CONFIGURED", "App Store notification verification is not configured.");
      }
      const notification = await verifier.verifyAndDecodeNotification(signedPayload);
      const data = notification?.data;
      if (!data?.signedTransactionInfo) return { notification, transaction: null, renewal: null };
      const transaction = await verifier.verifyAndDecodeTransaction(data.signedTransactionInfo);
      const renewal = data.signedRenewalInfo && verifier.verifyAndDecodeRenewalInfo
        ? await verifier.verifyAndDecodeRenewalInfo(data.signedRenewalInfo)
        : null;
      return { notification, transaction, renewal };
    });
    const { notification, transaction, renewal, environment } = verified;
    if (!notification?.notificationUUID || !notification?.notificationType) {
      throw new AppStoreServerError("APPLE_NOTIFICATION_INVALID", "Apple notification identity is incomplete.");
    }
    if (!transaction) {
      return {
        verified: true,
        actionable: false,
        source: "app_store_server_notification_v2",
        eventID: String(notification.notificationUUID),
        notificationType: String(notification.notificationType),
        environment,
        signedPayloadSHA256: sha256(signedPayload),
      };
    }
    const event = normalizedNotificationEvent({ notification, transaction, renewal, environment, signedPayload });
    this.#requireAllowedProduct(event.productID);
    return event;
  }

  async verifyTransaction(signedTransactionInfo, { now = new Date() } = {}) {
    requireSignedJWS(signedTransactionInfo, "transaction");
    const verified = await verifyAcrossEnvironments(this.verifiersByEnvironment, async (verifier) => {
      if (!verifier?.verifyAndDecodeTransaction) {
        throw new AppStoreServerError("APP_STORE_SERVER_NOT_CONFIGURED", "App Store transaction verification is not configured.");
      }
      return verifier.verifyAndDecodeTransaction(signedTransactionInfo);
    });
    const transaction = verified.value;
    if (!transaction?.originalTransactionId || !transaction?.transactionId || !transaction?.appAccountToken) {
      throw new AppStoreServerError("APPLE_TRANSACTION_IDENTITY_INCOMPLETE", "The verified transaction is missing its subscription or app-account identity.");
    }
    const event = {
      verified: true,
      source: "app_store_transaction",
      eventID: `transaction:${transaction.transactionId}:${Number(transaction.signedDate ?? 0)}`,
      notificationType: "INITIAL_TRANSACTION_BINDING",
      state: transactionState(transaction, now),
      productID: transaction.productId ?? null,
      environment: verified.environment,
      periodEndsAt: finiteDate(transaction.expiresDate),
      purchasedAt: finiteDate(transaction.purchaseDate),
      offerType: normalizedOfferType(transaction),
      trialPeriod: transaction.offerDiscountType === "FREE_TRIAL" ? "free_trial" : null,
      willAutoRenew: null,
      originalTransactionID: String(transaction.originalTransactionId),
      transactionID: String(transaction.transactionId),
      appAccountToken: String(transaction.appAccountToken).toLowerCase(),
      signedPayloadSHA256: sha256(signedTransactionInfo),
    };
    this.#requireAllowedProduct(event.productID);
    return event;
  }

  #requireAllowedProduct(productID) {
    if (!productID || !this.allowedProductIDs.has(productID)) {
      throw new AppStoreServerError("APPLE_PRODUCT_NOT_CONFIGURED", "The verified transaction is not for a configured FamilyChef subscription product.");
    }
  }
}

export async function createOfficialAppStoreSubscriptionClientFromEnvironment(environment = process.env) {
  const required = [
    "NOURISH_APP_STORE_PRIVATE_KEY_PATH",
    "NOURISH_APP_STORE_KEY_ID",
    "NOURISH_APP_STORE_ISSUER_ID",
    "NOURISH_APP_BUNDLE_ID",
    "NOURISH_APPLE_ROOT_CA_PATHS",
  ];
  const missing = required.filter((name) => !environment[name]);
  if (missing.length) {
    throw new AppStoreServerError("APP_STORE_SERVER_NOT_CONFIGURED", `Missing App Store reconciliation configuration: ${missing.join(", ")}`);
  }
  const { library, verifiersByEnvironment, allowedProductIDs } = await loadVerificationBoundary(environment);
  const privateKey = await readFile(environment.NOURISH_APP_STORE_PRIVATE_KEY_PATH, "utf8");
  const shared = [privateKey, environment.NOURISH_APP_STORE_KEY_ID, environment.NOURISH_APP_STORE_ISSUER_ID, environment.NOURISH_APP_BUNDLE_ID];
  return new OfficialAppStoreSubscriptionClient({
    clientsByEnvironment: {
      sandbox: new library.AppStoreServerAPIClient(...shared, library.Environment.SANDBOX),
      production: new library.AppStoreServerAPIClient(...shared, library.Environment.PRODUCTION),
    },
    verifiersByEnvironment,
    allowedProductIDs,
  });
}

export async function createOfficialAppStoreVerifierFromEnvironment(environment = process.env) {
  const { verifiersByEnvironment, allowedProductIDs } = await loadVerificationBoundary(environment);
  return new OfficialAppStoreSubscriptionClient({ clientsByEnvironment: {}, verifiersByEnvironment, allowedProductIDs });
}

async function loadVerificationBoundary(environment) {
  const required = ["NOURISH_APP_BUNDLE_ID", "NOURISH_APPLE_ROOT_CA_PATHS", "NOURISH_APP_APPLE_ID", "NOURISH_APP_STORE_PRODUCT_IDS"];
  const missing = required.filter((name) => !environment[name]);
  if (missing.length) {
    throw new AppStoreServerError("APP_STORE_SERVER_NOT_CONFIGURED", `Missing App Store verification configuration: ${missing.join(", ")}`);
  }
  let library;
  try {
    library = await import("@apple/app-store-server-library");
  } catch (error) {
    throw new AppStoreServerError("APP_STORE_SERVER_NOT_CONFIGURED", `Install the official Apple server library before enabling App Store verification: ${error.message}`);
  }
  const rootPaths = environment.NOURISH_APPLE_ROOT_CA_PATHS.split(",").map((path) => path.trim()).filter(Boolean);
  if (!rootPaths.length) throw new AppStoreServerError("APP_STORE_SERVER_NOT_CONFIGURED", "At least one Apple root certificate path is required.");
  const rootCAs = await Promise.all(rootPaths.map((path) => readFile(path)));
  const productionAppleID = requirePositiveInteger(environment.NOURISH_APP_APPLE_ID, "NOURISH_APP_APPLE_ID");
  const allowedProductIDs = environment.NOURISH_APP_STORE_PRODUCT_IDS.split(",").map((value) => value.trim()).filter(Boolean);
  if (!allowedProductIDs.length) throw new AppStoreServerError("APP_STORE_SERVER_NOT_CONFIGURED", "At least one App Store subscription product ID is required.");
  return {
    library,
    allowedProductIDs,
    verifiersByEnvironment: {
      sandbox: new library.SignedDataVerifier(rootCAs, true, library.Environment.SANDBOX, environment.NOURISH_APP_BUNDLE_ID, undefined),
      production: new library.SignedDataVerifier(rootCAs, true, library.Environment.PRODUCTION, environment.NOURISH_APP_BUNDLE_ID, productionAppleID),
    },
  };
}

function normalizedVerifiedEvent(candidate, environment) {
  const { item, transaction, renewal } = candidate;
  const status = Number(item.status);
  const signedAt = Math.max(Number(transaction.signedDate ?? 0), Number(renewal.signedDate ?? 0));
  return {
    verified: true,
    source: "app_store_server_api",
    eventID: `reconcile:${transaction.transactionId}:${status}:${signedAt}`,
    notificationType: "RECONCILIATION",
    state: entitlementState(status, transaction),
    productID: transaction.productId ?? null,
    environment,
    periodEndsAt: finiteDate(transaction.expiresDate),
    purchasedAt: finiteDate(transaction.purchaseDate),
    offerType: normalizedOfferType(transaction),
    trialPeriod: transaction.offerDiscountType === "FREE_TRIAL" ? "free_trial" : null,
    willAutoRenew: Number(renewal.autoRenewStatus) === 1,
    originalTransactionID: String(transaction.originalTransactionId),
    transactionID: String(transaction.transactionId),
    appAccountToken: transaction.appAccountToken ?? null,
    signedPayloadSHA256: createHash("sha256").update(`${item.signedTransactionInfo}.${item.signedRenewalInfo}`).digest("hex"),
  };
}

function entitlementState(status, transaction) {
  if (status === 1 && transaction.offerDiscountType === "FREE_TRIAL") return "trial";
  if (status === 1) return "active";
  if (status === 2) return "expired";
  if (status === 3 || status === 4) return "graceOrBillingRetry";
  if (status === 5) return "revokedOrRefunded";
  return "unknown";
}

function normalizedNotificationEvent({ notification, transaction, renewal, environment, signedPayload }) {
  if (!transaction.originalTransactionId || !transaction.transactionId || !notification.data?.status) {
    throw new AppStoreServerError("APPLE_NOTIFICATION_IDENTITY_INCOMPLETE", "The verified subscription notification is missing status or transaction identity.");
  }
  return {
    verified: true,
    actionable: true,
    source: "app_store_server_notification_v2",
    eventID: String(notification.notificationUUID),
    notificationType: String(notification.notificationType),
    notificationSubtype: notification.subtype ? String(notification.subtype) : null,
    state: entitlementState(Number(notification.data.status), transaction),
    productID: transaction.productId ?? null,
    environment,
    periodEndsAt: finiteDate(transaction.expiresDate),
    purchasedAt: finiteDate(transaction.purchaseDate),
    offerType: normalizedOfferType(transaction),
    trialPeriod: transaction.offerDiscountType === "FREE_TRIAL" ? "free_trial" : null,
    willAutoRenew: renewal?.autoRenewStatus == null ? null : Number(renewal.autoRenewStatus) === 1,
    originalTransactionID: String(transaction.originalTransactionId),
    transactionID: String(transaction.transactionId),
    appAccountToken: transaction.appAccountToken ? String(transaction.appAccountToken).toLowerCase() : null,
    signedPayloadSHA256: sha256(signedPayload),
  };
}

function transactionState(transaction, now) {
  if (transaction.revocationDate) return "revokedOrRefunded";
  const expiresAt = Number(transaction.expiresDate ?? 0);
  if (expiresAt > 0 && expiresAt <= now.getTime()) return "expired";
  if (transaction.offerDiscountType === "FREE_TRIAL") return "trial";
  return "active";
}

function normalizedOfferType(transaction) {
  if (transaction.offerDiscountType === "FREE_TRIAL") return "free_trial";
  const type = Number(transaction.offerType ?? 0);
  if (type === 1) return "introductory";
  if (type === 2) return "promotional";
  if (type === 3) return "offer_code";
  if (type === 4) return "win_back";
  return "standard";
}

async function verifyAcrossEnvironments(verifiers, operation) {
  let configurationError = null;
  let retryableError = null;
  for (const environment of ["production", "sandbox"]) {
    const verifier = verifiers?.[environment];
    if (!verifier) continue;
    try {
      const result = await operation(verifier);
      if (result?.notification?.data?.environment
        && normalizeEnvironment(result.notification.data.environment) !== environment) continue;
      return result?.notification ? { ...result, environment } : { value: result, environment };
    } catch (error) {
      if (error instanceof AppStoreServerError && error.code === "APP_STORE_SERVER_NOT_CONFIGURED") configurationError = error;
      else if (isRetryableVerification(error)) retryableError = error;
    }
  }
  if (configurationError && !Object.values(verifiers ?? {}).some(Boolean)) throw configurationError;
  throw new AppStoreServerError("APPLE_SIGNATURE_INVALID", "Apple signed data could not be cryptographically verified.", { retryable: Boolean(retryableError) });
}

function requireSignedJWS(value, label) {
  if (typeof value !== "string" || value.length < 32 || value.length > 1_000_000 || value.split(".").length !== 3) {
    throw new AppStoreServerError("APPLE_SIGNED_DATA_INVALID", `The App Store ${label} JWS is malformed.`);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function compareCandidates(left, right) {
  const accessRank = (candidate) => ({ 1: 5, 4: 4, 3: 3, 2: 2, 5: 1 }[Number(candidate.item.status)] ?? 0);
  return accessRank(right) - accessRank(left)
    || Number(right.transaction.expiresDate ?? 0) - Number(left.transaction.expiresDate ?? 0)
    || String(right.transaction.transactionId).localeCompare(String(left.transaction.transactionId));
}

function normalizeAppleError(error) {
  if (error instanceof AppStoreServerError) return error;
  const status = Number(error?.httpStatusCode ?? error?.status ?? 0) || null;
  const appleCode = Number(error?.apiError ?? error?.errorCode ?? 0) || null;
  const retryable = status === 429 || (status !== null && status >= 500) || retryableAppleCodes.has(appleCode);
  return new AppStoreServerError(
    appleCode ? `APPLE_${appleCode}` : "APPLE_SERVER_UNAVAILABLE",
    retryable ? "Apple subscription status is temporarily unavailable." : "Apple rejected the subscription status request.",
    { retryable, status },
  );
}

function isRetryableVerification(error) {
  return String(error?.status ?? error?.code ?? "").toLowerCase().includes("retry");
}

function normalizeEnvironment(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!supportedEnvironments.has(normalized)) {
    throw new AppStoreServerError("APPLE_ENVIRONMENT_UNSUPPORTED", "Only Apple sandbox and production subscriptions can be reconciled by the server.");
  }
  return normalized;
}

function finiteDate(milliseconds) {
  const value = Number(milliseconds);
  return Number.isFinite(value) && value > 0 ? new Date(value) : null;
}

function requirePositiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new AppStoreServerError("APP_STORE_SERVER_NOT_CONFIGURED", `${name} must be a positive integer.`);
  return number;
}
