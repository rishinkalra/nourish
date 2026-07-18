import { randomUUID } from "node:crypto";
import { createOpaqueToken, hashOpaqueToken } from "./auth-service.mjs";
import { AdminAuthError, ConfigurationGatedAdminIdentityVerifier, requireMFA } from "./admin-auth-service.mjs";
import { withTransaction } from "./database.mjs";

export class PostgresAdminAuthService {
  constructor({ pool, verifier = new ConfigurationGatedAdminIdentityVerifier(), now = () => new Date(), tokenFactory = createOpaqueToken } = {}) {
    if (!pool?.query || !pool?.connect) throw new Error("A PostgreSQL pool is required.");
    this.pool = pool;
    this.verifier = verifier;
    this.now = now;
    this.tokenFactory = tokenFactory;
  }

  async exchange(identityToken, context = {}) {
    let verified;
    try {
      verified = await this.verifier.verify(identityToken);
      requireMFA(verified.authenticationMethods);
    } catch (error) {
      await insertAccessAudit(this.pool, null, verified?.subject ?? null, "admin.session.exchange", context.route, null, "denied", context.correlationID, this.now());
      throw error;
    }
    const now = this.now();
    let auditUserID = null;
    try {
      return await withTransaction(this.pool, async (client) => {
        const selected = await client.query(
          `SELECT id, provider, provider_subject, verified_email, display_name, status, mfa_required
             FROM admin_users
            WHERE provider = $1 AND provider_subject = $2
            FOR UPDATE`,
          [verified.provider, verified.subject],
        );
        const user = selected.rows[0];
        auditUserID = user?.id ?? null;
        if (!user || user.status !== "active") throw new AdminAuthError("AUTHENTICATION_REQUIRED", "This administrator has no active Nourish access.", 403);
        const grants = await activeRoles(client, user.id);
        if (!grants.length) throw new AdminAuthError("AUTHENTICATION_REQUIRED", "This administrator has no active role grants.", 403);
        const accessToken = this.tokenFactory();
        const expiresAt = new Date(now.getTime() + 8 * 60 * 60_000);
        await client.query(
          `INSERT INTO admin_sessions (
              id, admin_user_id, access_token_sha256, identity_provider,
              authentication_methods, issued_at, expires_at, last_seen_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $6)`,
          [randomUUID(), user.id, hashOpaqueToken(accessToken), verified.provider, verified.authenticationMethods, now, expiresAt],
        );
        await client.query("UPDATE admin_users SET last_access_at = $2, updated_at = $2 WHERE id = $1", [user.id, now]);
        await insertAccessAudit(client, user.id, user.provider_subject, "admin.session.exchange", context.route, null, "succeeded", context.correlationID, now);
        return { accessToken, expiresAt, identity: mapIdentity(user, grants, verified.authenticationMethods) };
      });
    } catch (error) {
      if (error instanceof AdminAuthError) {
        await insertAccessAudit(this.pool, auditUserID, verified.subject, "admin.session.exchange", context.route, null, "denied", context.correlationID, now);
      }
      throw error;
    }
  }

  async authenticate(accessToken, requiredRole, context = {}) {
    const now = this.now();
    const result = await this.pool.query(
      `SELECT session.id AS session_id, session.admin_user_id, session.revoked_at,
              session.expires_at, session.authentication_methods,
              user.provider_subject, user.verified_email, user.display_name, user.status
         FROM admin_sessions session
         JOIN admin_users user ON user.id = session.admin_user_id
        WHERE session.access_token_sha256 = $1`,
      [hashOpaqueToken(accessToken ?? "")],
    );
    const record = result.rows[0];
    const roles = record ? await activeRoles(this.pool, record.admin_user_id) : [];
    const sessionValid = record && !record.revoked_at && record.status === "active" && new Date(record.expires_at) > now;
    const roleValid = sessionValid && (
      requiredRole == null ? roles.length > 0 : roles.includes(requiredRole) || roles.includes("security_admin")
    );
    await insertAccessAudit(
      this.pool, record?.admin_user_id ?? null, record?.provider_subject ?? null,
      "admin.route.access", context.route, requiredRole, roleValid ? "granted" : "denied", context.correlationID, now,
    );
    if (!roleValid) {
      throw new AdminAuthError("AUTHENTICATION_REQUIRED", sessionValid ? "Your administrator role does not allow this action." : "Administrator sign-in has expired.", 403);
    }
    await this.pool.query("UPDATE admin_sessions SET last_seen_at = $2 WHERE id = $1", [record.session_id, now]);
    return {
      id: record.admin_user_id, subject: record.provider_subject, verifiedEmail: record.verified_email,
      displayName: record.display_name, roles, authenticationMethods: record.authentication_methods,
    };
  }

  current(accessToken, context = {}) {
    return this.authenticate(accessToken, null, context);
  }

  async revoke(accessToken, context = {}) {
    const now = this.now();
    const revoked = await this.pool.query(
      `UPDATE admin_sessions SET revoked_at = COALESCE(revoked_at, $2)
        WHERE access_token_sha256 = $1
      RETURNING admin_user_id`,
      [hashOpaqueToken(accessToken ?? ""), now],
    );
    await insertAccessAudit(this.pool, revoked.rows[0]?.admin_user_id ?? null, null, "admin.session.revoke", context.route, null, "succeeded", context.correlationID, now);
  }
}

async function activeRoles(client, adminUserID) {
  const result = await client.query(
    `SELECT role FROM admin_role_grants
      WHERE admin_user_id = $1 AND revoked_at IS NULL
      ORDER BY role`,
    [adminUserID],
  );
  return result.rows.map((row) => row.role);
}

async function insertAccessAudit(client, adminUserID, subject, action, route, requiredRole, outcome, correlationID, occurredAt) {
  await client.query(
    `INSERT INTO admin_access_audit_logs (
        id, admin_user_id, actor_subject, action, route, required_role,
        outcome, correlation_id, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [randomUUID(), adminUserID, subject, action, route ?? "unknown", requiredRole, outcome, correlationID ?? null, occurredAt],
  );
}

function mapIdentity(user, roles, authenticationMethods) {
  return {
    adminUserID: user.id, subject: user.provider_subject, verifiedEmail: user.verified_email,
    displayName: user.display_name, roles, authenticationMethods,
  };
}
