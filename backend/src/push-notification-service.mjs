import { createHash, createPrivateKey, randomUUID, sign } from "node:crypto";
import { connect } from "node:http2";

const TOKEN_PATTERN = /^[0-9a-f]+$/;
const BUNDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{2,254}$/;
const ENVIRONMENTS = new Set(["sandbox", "production"]);
const INVALID_TOKEN_REASONS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"]);

export class PushRegistrationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "PushRegistrationError";
    this.code = code;
    this.status = status;
  }
}

export class MemoryPushRegistrationService {
  constructor({ appBundleID = "com.projectnourish.app", now = () => new Date() } = {}) {
    this.appBundleID = normalizedBundleID(appBundleID);
    this.now = now;
    this.registrations = new Map();
  }

  async register(userID, input) {
    const registration = normalizedRegistration(userID, input, this.appBundleID, this.now());
    this.registrations.set(registrationKey(registration), registration);
    return receipt(registration);
  }

  async unregister(userID, input) {
    const normalized = normalizedRegistration(userID, input, this.appBundleID, this.now());
    const key = registrationKey(normalized);
    const existing = this.registrations.get(key);
    if (existing?.userID === userID) this.registrations.delete(key);
  }

  async activeRegistrations(userID) {
    return [...this.registrations.values()]
      .filter((item) => item.userID === userID && item.active)
      .map((item) => structuredClone(item));
  }

  async deactivate(registration, reason) {
    const existing = this.registrations.get(registrationKey(registration));
    if (!existing) return;
    existing.active = false;
    existing.deactivatedAt = this.now();
    existing.deactivationReason = boundedReason(reason);
  }
}

export class PostgresPushRegistrationService {
  constructor({ pool, appBundleID = "com.projectnourish.app", now = () => new Date() }) {
    if (!pool?.query) throw new Error("A PostgreSQL pool is required.");
    this.pool = pool;
    this.appBundleID = normalizedBundleID(appBundleID);
    this.now = now;
  }

  async register(userID, input) {
    const registration = normalizedRegistration(userID, input, this.appBundleID, this.now());
    const result = await this.pool.query(
      `INSERT INTO push_device_registrations (
          id, user_id, token_sha256, device_token, environment, app_bundle_id,
          active, last_registered_at, deactivated_at, deactivation_reason
       ) VALUES ($1, $2, $3, $4, $5, $6, true, $7, NULL, NULL)
       ON CONFLICT (token_sha256, environment, app_bundle_id) DO UPDATE
          SET user_id = EXCLUDED.user_id,
              device_token = EXCLUDED.device_token,
              active = true,
              last_registered_at = EXCLUDED.last_registered_at,
              deactivated_at = NULL,
              deactivation_reason = NULL
       RETURNING id, environment, app_bundle_id, last_registered_at`,
      [
        registration.id, registration.userID, registration.tokenSHA256,
        registration.deviceToken, registration.environment, registration.appBundleID,
        registration.lastRegisteredAt,
      ],
    );
    return receipt({
      ...registration,
      id: result.rows[0]?.id ?? registration.id,
      lastRegisteredAt: result.rows[0]?.last_registered_at
        ? new Date(result.rows[0].last_registered_at) : registration.lastRegisteredAt,
    });
  }

  async unregister(userID, input) {
    const registration = normalizedRegistration(userID, input, this.appBundleID, this.now());
    await this.pool.query(
      `DELETE FROM push_device_registrations
        WHERE user_id = $1 AND token_sha256 = $2
          AND environment = $3 AND app_bundle_id = $4`,
      [userID, registration.tokenSHA256, registration.environment, registration.appBundleID],
    );
  }

  async activeRegistrations(userID) {
    const result = await this.pool.query(
      `SELECT id, user_id, token_sha256, device_token, environment,
              app_bundle_id, last_registered_at
         FROM push_device_registrations
        WHERE user_id = $1 AND active = true
        ORDER BY last_registered_at DESC`,
      [userID],
    );
    return result.rows.map((row) => ({
      id: row.id,
      userID: row.user_id,
      tokenSHA256: row.token_sha256,
      deviceToken: row.device_token,
      environment: row.environment,
      appBundleID: row.app_bundle_id,
      active: true,
      lastRegisteredAt: new Date(row.last_registered_at),
      deactivatedAt: null,
      deactivationReason: null,
    }));
  }

  async deactivate(registration, reason) {
    await this.pool.query(
      `UPDATE push_device_registrations
          SET active = false, deactivated_at = $2, deactivation_reason = $3
        WHERE id = $1 AND active = true`,
      [registration.id, this.now(), boundedReason(reason)],
    );
  }
}

export class ConfigurationGatedPushProvider {
  async send() {
    return { status: "disabled" };
  }
}

export class APNsPushProvider {
  constructor({
    teamID, keyID, privateKey, appBundleID,
    connectHTTP2 = connect, now = () => new Date(),
  }) {
    this.teamID = requiredToken(teamID, "APNs team ID");
    this.keyID = requiredToken(keyID, "APNs key ID");
    this.privateKey = createPrivateKey(String(privateKey ?? "").replaceAll("\\n", "\n"));
    this.appBundleID = normalizedBundleID(appBundleID);
    this.connectHTTP2 = connectHTTP2;
    this.now = now;
    this.cachedAuthorization = null;
  }

  async send(registration, notification) {
    if (registration.appBundleID !== this.appBundleID) {
      throw pushFailure("PUSH_TOPIC_MISMATCH", "The push registration topic is not configured.");
    }
    const authority = registration.environment === "production"
      ? "https://api.push.apple.com"
      : "https://api.sandbox.push.apple.com";
    const client = this.connectHTTP2(authority);
    try {
      const payload = JSON.stringify(notificationPayload(notification));
      const response = await sendHTTP2(client, {
        ":method": "POST",
        ":path": `/3/device/${registration.deviceToken}`,
        authorization: `bearer ${this.#authorizationToken()}`,
        "apns-topic": this.appBundleID,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": "0",
        "apns-collapse-id": requiredIdentifier(notification.collapseID, "notification collapse").slice(0, 64),
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      }, payload);
      const reason = parseAPNsReason(response.body);
      if (response.status === 200) return { status: "sent", apnsID: response.apnsID ?? null };
      if ((response.status === 400 || response.status === 410) && INVALID_TOKEN_REASONS.has(reason)) {
        return { status: "invalidToken", reason };
      }
      const error = pushFailure(
        response.status === 429 || response.status >= 500 ? "TEMPORARY_FAILURE" : "PUSH_REJECTED",
        `APNs rejected the notification with status ${response.status}.`,
      );
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    } finally {
      client.close();
    }
  }

  #authorizationToken() {
    const nowSeconds = Math.floor(this.now().getTime() / 1_000);
    if (this.cachedAuthorization && nowSeconds - this.cachedAuthorization.issuedAt < 50 * 60) {
      return this.cachedAuthorization.value;
    }
    const header = base64URL(JSON.stringify({ alg: "ES256", kid: this.keyID }));
    const claims = base64URL(JSON.stringify({ iss: this.teamID, iat: nowSeconds }));
    const signingInput = `${header}.${claims}`;
    const signature = sign("sha256", Buffer.from(signingInput), {
      key: this.privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url");
    const value = `${signingInput}.${signature}`;
    this.cachedAuthorization = { issuedAt: nowSeconds, value };
    return value;
  }
}

export function createPlanReadyNotificationHandler({ registrationService, pushProvider }) {
  if (!registrationService?.activeRegistrations || !registrationService?.deactivate) {
    throw new Error("A push registration service is required.");
  }
  if (!pushProvider?.send) throw new Error("A push provider is required.");
  return async (job) => {
    const registrations = await registrationService.activeRegistrations(job.userID);
    let sent = 0;
    let invalidated = 0;
    let disabled = 0;
    for (const registration of registrations) {
      const result = await pushProvider.send(registration, {
        templateID: "plan_ready",
        title: "Your Nourish plan is ready",
        body: "Review your seven-day plan before making it active.",
        destination: "nourish://open/plan",
        analyticsDestination: "plan_studio",
        planJobID: requiredIdentifier(job.payload?.planJobID, "plan job"),
        collapseID: `plan-ready-${job.payload?.planJobID}`,
      });
      if (result.status === "sent") sent += 1;
      else if (result.status === "disabled") disabled += 1;
      else if (result.status === "invalidToken") {
        await registrationService.deactivate(registration, result.reason);
        invalidated += 1;
      }
    }
    return { registrations: registrations.length, sent, invalidated, disabled };
  };
}

const OPERATIONAL_NOTIFICATION_TEMPLATES = Object.freeze({
  export_ready: {
    title: "Your Nourish export is ready",
    body: "Open Account settings to access it before it expires.",
    destination: "nourish://open/account-export",
    analyticsDestination: "account_settings",
  },
  trial_ending: {
    title: "Your Nourish trial is ending soon",
    body: "Review Apple’s renewal details or manage your subscription in Account settings.",
    destination: "nourish://open/subscription",
    analyticsDestination: "subscription_settings",
  },
  account_security: {
    title: "Review your Nourish account",
    body: "Open Account settings to review an important security update.",
    destination: "nourish://open/account-security",
    analyticsDestination: "account_settings",
  },
});

export function operationalNotificationTemplate(templateID) {
  const template = OPERATIONAL_NOTIFICATION_TEMPLATES[templateID];
  if (!template) throw new PushRegistrationError("VALIDATION_ERROR", "The notification template is not supported.");
  return { templateID, ...template };
}

export function createOperationalNotificationHandler({ registrationService, pushProvider }) {
  if (!registrationService?.activeRegistrations || !registrationService?.deactivate) {
    throw new Error("A push registration service is required.");
  }
  if (!pushProvider?.send) throw new Error("A push provider is required.");
  return async (job) => {
    const template = operationalNotificationTemplate(job.payload?.templateID);
    const referenceID = requiredIdentifier(job.payload?.referenceID, "notification reference");
    const registrations = await registrationService.activeRegistrations(job.userID);
    let sent = 0;
    let invalidated = 0;
    let disabled = 0;
    for (const registration of registrations) {
      const result = await pushProvider.send(registration, {
        ...template,
        collapseID: `${template.templateID}-${referenceID}`,
      });
      if (result.status === "sent") sent += 1;
      else if (result.status === "disabled") disabled += 1;
      else if (result.status === "invalidToken") {
        await registrationService.deactivate(registration, result.reason);
        invalidated += 1;
      }
    }
    return { templateID: template.templateID, registrations: registrations.length, sent, invalidated, disabled };
  };
}

export function createAPNsPushProviderFromEnvironment(environment = process.env) {
  if (environment.NOURISH_APNS_ENABLED !== "true") return new ConfigurationGatedPushProvider();
  return new APNsPushProvider({
    teamID: environment.NOURISH_APNS_TEAM_ID,
    keyID: environment.NOURISH_APNS_KEY_ID,
    privateKey: environment.NOURISH_APNS_PRIVATE_KEY,
    appBundleID: environment.NOURISH_APNS_BUNDLE_ID,
  });
}

function normalizedRegistration(userID, input, appBundleID, now) {
  const deviceToken = String(input?.deviceToken ?? "").trim().toLowerCase();
  if (!TOKEN_PATTERN.test(deviceToken) || deviceToken.length < 32
      || deviceToken.length > 512 || deviceToken.length % 2 !== 0) {
    throw new PushRegistrationError("VALIDATION_ERROR", "The push registration is invalid.");
  }
  if (!ENVIRONMENTS.has(input?.environment)) {
    throw new PushRegistrationError("VALIDATION_ERROR", "The push environment is invalid.");
  }
  return {
    id: randomUUID(),
    userID: requiredIdentifier(userID, "user"),
    tokenSHA256: createHash("sha256").update(deviceToken, "utf8").digest("hex"),
    deviceToken,
    environment: input.environment,
    appBundleID,
    active: true,
    lastRegisteredAt: now,
    deactivatedAt: null,
    deactivationReason: null,
  };
}

function registrationKey(registration) {
  return `${registration.tokenSHA256}:${registration.environment}:${registration.appBundleID}`;
}

function receipt(registration) {
  return {
    registrationID: registration.id,
    environment: registration.environment,
    registeredAt: registration.lastRegisteredAt,
  };
}

function normalizedBundleID(value) {
  const normalized = String(value ?? "").trim();
  if (!BUNDLE_PATTERN.test(normalized)) throw new Error("A valid APNs bundle ID is required.");
  return normalized;
}

function requiredIdentifier(value, name) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 255) {
    throw new PushRegistrationError("VALIDATION_ERROR", `A valid ${name} identifier is required.`);
  }
  return normalized;
}

function requiredToken(value, name) {
  const normalized = String(value ?? "").trim();
  if (!/^[A-Za-z0-9]{4,64}$/.test(normalized)) throw new Error(`A valid ${name} is required.`);
  return normalized;
}

function boundedReason(value) {
  return String(value ?? "invalid_token").replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 80) || "invalid_token";
}

function notificationPayload(notification) {
  return {
    aps: {
      alert: { title: notification.title, body: notification.body },
      sound: "default",
    },
    template_id: notification.templateID,
    destination: notification.destination,
    analytics_destination: notification.analyticsDestination,
  };
}

function sendHTTP2(client, headers, payload) {
  return new Promise((resolve, reject) => {
    const request = client.request(headers);
    let status = 0;
    let apnsID = null;
    const chunks = [];
    let settled = false;
    const cleanup = () => {
      client.off("error", fail);
      request.off("error", fail);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    request.setEncoding("utf8");
    client.once("error", fail);
    request.on("response", (responseHeaders) => {
      status = Number(responseHeaders[":status"] ?? 0);
      apnsID = responseHeaders["apns-id"] ?? null;
    });
    request.on("data", (chunk) => chunks.push(chunk));
    request.once("error", fail);
    request.on("end", () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ status, apnsID, body: chunks.join("") });
    });
    request.end(payload);
  });
}

function parseAPNsReason(body) {
  try {
    return JSON.parse(body || "{}").reason ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

function base64URL(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function pushFailure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
