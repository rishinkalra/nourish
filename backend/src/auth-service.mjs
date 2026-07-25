import { createHash, randomBytes, randomUUID } from "node:crypto";

export const hashOpaqueToken = (value) => createHash("sha256").update(value, "utf8").digest("hex");
export const createOpaqueToken = () => randomBytes(32).toString("base64url");

export class AuthError extends Error {
  constructor(code, message, status = 400, retryAfterSeconds) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class MemoryAuthStore {
  usersByID = new Map();
  userIDByEmail = new Map();
  userIDByAppleSubject = new Map();
  magicLinksByHash = new Map();
  lastMagicRequestByEmail = new Map();
  sessionsByRefreshHash = new Map();
  sessionByAccessHash = new Map();
}

export class MemoryMagicLinkDelivery {
  deliveries = [];

  async send(delivery) {
    this.deliveries.push(delivery);
  }

  latest() {
    return this.deliveries.at(-1);
  }
}

export class ConfigurationGatedAppleVerifier {
  async verify() {
    throw new AuthError(
      "TEMPORARY_FAILURE",
      "Sign in with Apple is not configured for this environment.",
      503,
    );
  }
}

export class AuthService {
  constructor({
    store = new MemoryAuthStore(),
    delivery = new MemoryMagicLinkDelivery(),
    appleVerifier = new ConfigurationGatedAppleVerifier(),
    now = () => new Date(),
    tokenFactory = createOpaqueToken,
  } = {}) {
    this.store = store;
    this.delivery = delivery;
    this.appleVerifier = appleVerifier;
    this.now = now;
    this.tokenFactory = tokenFactory;
  }

  async requestMagicLink(email) {
    const normalizedEmail = normalizeEmail(email);
    const now = this.now();
    const lastRequest = this.store.lastMagicRequestByEmail.get(normalizedEmail);
    if (lastRequest && now.getTime() - lastRequest.getTime() < 60_000) {
      const retryAfterSeconds = Math.max(1, Math.ceil((60_000 - (now.getTime() - lastRequest.getTime())) / 1_000));
      throw new AuthError("RATE_LIMITED", "Please wait before requesting another link.", 429, retryAfterSeconds);
    }

    const token = this.tokenFactory();
    const requestID = randomUUID();
    const expiresAt = new Date(now.getTime() + 15 * 60_000);
    const resendAvailableAt = new Date(now.getTime() + 60_000);
    this.store.magicLinksByHash.set(hashOpaqueToken(token), {
      requestID,
      email: normalizedEmail,
      expiresAt,
      consumedAt: null,
    });
    this.store.lastMagicRequestByEmail.set(normalizedEmail, now);
    await this.delivery.send({ email: normalizedEmail, token, requestID, expiresAt });
    return { requestID, resendAvailableAt };
  }

  async completeMagicLink(token) {
    if (typeof token !== "string" || token.length < 20) {
      throw new AuthError("VALIDATION_ERROR", "This sign-in link is invalid or incomplete.");
    }
    const record = this.store.magicLinksByHash.get(hashOpaqueToken(token));
    const now = this.now();
    if (!record || record.consumedAt || record.expiresAt <= now) {
      throw new AuthError("VALIDATION_ERROR", "This sign-in link is invalid or has expired.");
    }
    record.consumedAt = now;
    const user = this.#findOrCreateEmailUser(record.email, now);
    return this.#issueSession(user, now);
  }

  async authenticateWithApple(exchange) {
    if (!exchange?.identityToken || !exchange?.authorizationCode || !exchange?.nonce) {
      throw new AuthError("VALIDATION_ERROR", "The Apple credential is incomplete.");
    }
    const verified = await this.appleVerifier.verify(exchange);
    const now = this.now();
    let userID = this.store.userIDByAppleSubject.get(verified.subject);
    let user = userID ? this.store.usersByID.get(userID) : null;
    if (!user) {
      user = {
        id: randomUUID(),
        verifiedEmail: verified.email ?? null,
        createdAt: now,
        disabledAt: null,
      };
      this.store.usersByID.set(user.id, user);
      this.store.userIDByAppleSubject.set(verified.subject, user.id);
      if (verified.email) this.store.userIDByEmail.set(normalizeEmail(verified.email), user.id);
    }
    return this.#issueSession(user, now);
  }

  async refresh(refreshToken) {
    const record = this.store.sessionsByRefreshHash.get(hashOpaqueToken(refreshToken ?? ""));
    const now = this.now();
    if (!record || record.revokedAt || record.refreshExpiresAt <= now) {
      throw new AuthError("AUTHENTICATION_REQUIRED", "Please sign in again.", 401);
    }
    this.#revokeRecord(record, now);
    const user = this.store.usersByID.get(record.userID);
    if (!user || user.disabledAt) {
      throw new AuthError("AUTHENTICATION_REQUIRED", "Please sign in again.", 401);
    }
    return this.#issueSession(user, now);
  }

  async revoke(accessToken) {
    const record = this.store.sessionByAccessHash.get(hashOpaqueToken(accessToken ?? ""));
    if (record && !record.revokedAt) this.#revokeRecord(record, this.now());
  }

  async disableUserAndRevokeSessions(userID) {
    const user = this.store.usersByID.get(userID);
    if (!user) throw new AuthError("AUTHENTICATION_REQUIRED", "Please sign in again.", 401);
    const now = this.now();
    user.disabledAt = user.disabledAt ?? now;
    for (const record of this.store.sessionByAccessHash.values()) {
      if (record.userID === userID && !record.revokedAt) this.#revokeRecord(record, now);
    }
    return { userID, disabledAt: user.disabledAt };
  }

  async authenticate(accessToken) {
    const record = this.store.sessionByAccessHash.get(hashOpaqueToken(accessToken ?? ""));
    const now = this.now();
    if (!record || record.revokedAt || record.accessExpiresAt <= now) {
      throw new AuthError("AUTHENTICATION_REQUIRED", "Please sign in again.", 401);
    }
    const user = this.store.usersByID.get(record.userID);
    if (!user || user.disabledAt) {
      throw new AuthError("AUTHENTICATION_REQUIRED", "Please sign in again.", 401);
    }
    return { userID: user.id, verifiedEmail: user.verifiedEmail, createdAt: user.createdAt };
  }

  #findOrCreateEmailUser(email, now) {
    const existingID = this.store.userIDByEmail.get(email);
    if (existingID) return this.store.usersByID.get(existingID);
    const user = { id: randomUUID(), verifiedEmail: email, createdAt: now, disabledAt: null };
    this.store.usersByID.set(user.id, user);
    this.store.userIDByEmail.set(email, user.id);
    return user;
  }

  #issueSession(user, now) {
    const accessToken = this.tokenFactory();
    const refreshToken = this.tokenFactory();
    const record = {
      id: randomUUID(),
      userID: user.id,
      accessHash: hashOpaqueToken(accessToken),
      refreshHash: hashOpaqueToken(refreshToken),
      accessExpiresAt: new Date(now.getTime() + 15 * 60_000),
      refreshExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      createdAt: now,
      revokedAt: null,
    };
    this.store.sessionByAccessHash.set(record.accessHash, record);
    this.store.sessionsByRefreshHash.set(record.refreshHash, record);
    return {
      identity: { userID: user.id, verifiedEmail: user.verifiedEmail, createdAt: user.createdAt },
      accessToken,
      refreshToken,
      accessTokenExpiresAt: record.accessExpiresAt,
    };
  }

  #revokeRecord(record, now) {
    record.revokedAt = now;
  }
}

export function normalizeEmail(value) {
  if (typeof value !== "string") throw new AuthError("VALIDATION_ERROR", "Enter a valid email address.");
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) {
    throw new AuthError("VALIDATION_ERROR", "Enter a valid email address.");
  }
  return normalized;
}
