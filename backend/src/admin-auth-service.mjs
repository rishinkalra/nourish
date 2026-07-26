import { randomUUID } from "node:crypto";
import { createOpaqueToken, hashOpaqueToken, normalizeEmail } from "./auth-service.mjs";

export class AdminAuthError extends Error {
  constructor(code, message, status = 403) {
    super(message);
    this.name = "AdminAuthError";
    this.code = code;
    this.status = status;
  }
}

export class ConfigurationGatedAdminIdentityVerifier {
  async verify() {
    throw new AdminAuthError("TEMPORARY_FAILURE", "Administrator identity is not configured.", 503);
  }
}

export class MemoryAdminIdentityVerifier {
  constructor(assertions = new Map()) {
    this.assertions = assertions;
  }

  async verify(identityToken) {
    const identity = this.assertions.get(identityToken);
    if (!identity) throw new AdminAuthError("AUTHENTICATION_REQUIRED", "Administrator sign-in could not be verified.", 401);
    return structuredClone(identity);
  }
}

export class MemoryAdminAuthStore {
  usersByID = new Map();
  userIDByProviderSubject = new Map();
  grantsByUserID = new Map();
  sessionsByHash = new Map();
  accessAudit = [];
}

export class AdminAuthService {
  constructor({
    store = new MemoryAdminAuthStore(),
    verifier = new ConfigurationGatedAdminIdentityVerifier(),
    now = () => new Date(),
    tokenFactory = createOpaqueToken,
  } = {}) {
    this.store = store;
    this.verifier = verifier;
    this.now = now;
    this.tokenFactory = tokenFactory;
  }

  provision({ provider, subject, verifiedEmail, displayName, roles, mfaRequired = true }) {
    if (!provider || !subject || !displayName || !roles?.length) throw new AdminAuthError("VALIDATION_ERROR", "Complete administrator identity and roles are required.", 400);
    const id = randomUUID();
    const user = {
      id, provider, subject, verifiedEmail: normalizeEmail(verifiedEmail), displayName,
      status: "active", mfaRequired, createdAt: this.now(), lastAccessAt: null,
    };
    this.store.usersByID.set(id, user);
    this.store.userIDByProviderSubject.set(`${provider}:${subject}`, id);
    this.store.grantsByUserID.set(id, new Set(roles));
    return publicIdentity(user, roles, []);
  }

  async exchange(identityToken, context = {}) {
    let verified;
    try {
      verified = await this.verifier.verify(identityToken);
      requireMFA(verified.authenticationMethods);
    } catch (error) {
      this.#audit(null, verified?.subject ?? null, "admin.session.exchange", context.route, null, "denied", context.correlationID);
      throw error;
    }
    const userID = this.store.userIDByProviderSubject.get(`${verified.provider}:${verified.subject}`);
    const user = userID ? this.store.usersByID.get(userID) : null;
    if (!user || user.status !== "active") {
      this.#audit(null, verified.subject, "admin.session.exchange", context.route, null, "denied", context.correlationID);
      throw new AdminAuthError("AUTHENTICATION_REQUIRED", "This administrator has no active FamilyChef access.", 403);
    }
    const roles = [...(this.store.grantsByUserID.get(user.id) ?? [])];
    if (!roles.length) {
      this.#audit(user.id, user.subject, "admin.session.exchange", context.route, null, "denied", context.correlationID);
      throw new AdminAuthError("AUTHENTICATION_REQUIRED", "This administrator has no active role grants.", 403);
    }
    const now = this.now();
    const accessToken = this.tokenFactory();
    const session = {
      id: randomUUID(), adminUserID: user.id, accessTokenHash: hashOpaqueToken(accessToken),
      identityProvider: verified.provider, authenticationMethods: [...verified.authenticationMethods],
      issuedAt: now, expiresAt: new Date(now.getTime() + 8 * 60 * 60_000), lastSeenAt: now, revokedAt: null,
    };
    this.store.sessionsByHash.set(session.accessTokenHash, session);
    user.lastAccessAt = now;
    this.#audit(user.id, user.subject, "admin.session.exchange", context.route, null, "succeeded", context.correlationID);
    return { accessToken, expiresAt: session.expiresAt, identity: publicIdentity(user, roles, session.authenticationMethods) };
  }

  async authenticate(accessToken, requiredRole, context = {}) {
    const session = this.store.sessionsByHash.get(hashOpaqueToken(accessToken ?? ""));
    const now = this.now();
    const user = session ? this.store.usersByID.get(session.adminUserID) : null;
    const roles = user ? [...(this.store.grantsByUserID.get(user.id) ?? [])] : [];
    const sessionValid = session && !session.revokedAt && session.expiresAt > now && user?.status === "active";
    const roleValid = sessionValid && (
      requiredRole == null ? roles.length > 0 : roles.includes(requiredRole) || roles.includes("security_admin")
    );
    if (!roleValid) {
      this.#audit(user?.id ?? null, user?.subject ?? null, "admin.route.access", context.route, requiredRole, "denied", context.correlationID);
      throw new AdminAuthError("AUTHENTICATION_REQUIRED", sessionValid ? "Your administrator role does not allow this action." : "Administrator sign-in has expired.", 403);
    }
    session.lastSeenAt = now;
    this.#audit(user.id, user.subject, "admin.route.access", context.route, requiredRole, "granted", context.correlationID);
    return { id: user.id, subject: user.subject, verifiedEmail: user.verifiedEmail, displayName: user.displayName, roles, authenticationMethods: session.authenticationMethods };
  }

  async current(accessToken) {
    return this.authenticate(accessToken, null, { route: "/admin/v1/auth/session" });
  }

  async revoke(accessToken, context = {}) {
    const session = this.store.sessionsByHash.get(hashOpaqueToken(accessToken ?? ""));
    if (session && !session.revokedAt) session.revokedAt = this.now();
    const user = session ? this.store.usersByID.get(session.adminUserID) : null;
    this.#audit(user?.id ?? null, user?.subject ?? null, "admin.session.revoke", context.route, null, "succeeded", context.correlationID);
  }

  auditLog() {
    return structuredClone(this.store.accessAudit);
  }

  #audit(adminUserID, subject, action, route, requiredRole, outcome, correlationID) {
    this.store.accessAudit.push({
      id: randomUUID(), adminUserID, actorSubject: subject, action, route: route ?? "unknown",
      requiredRole, outcome, correlationID: correlationID ?? null, occurredAt: this.now(),
    });
  }
}

export function requireMFA(methods) {
  if (!Array.isArray(methods) || !methods.includes("mfa")) {
    throw new AdminAuthError("AUTHENTICATION_REQUIRED", "Multi-factor authentication is required for administrator access.", 403);
  }
}

function publicIdentity(user, roles, authenticationMethods) {
  return {
    adminUserID: user.id, subject: user.subject, verifiedEmail: user.verifiedEmail,
    displayName: user.displayName, roles: [...roles], authenticationMethods: [...authenticationMethods],
  };
}
