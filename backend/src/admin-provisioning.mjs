import { randomUUID } from "node:crypto";
import { normalizeEmail } from "./auth-service.mjs";
import { AdminAuthError } from "./admin-auth-service.mjs";
import { withTransaction } from "./database.mjs";

const allowedRoles = new Set(["author", "reviewer", "operator", "security_admin"]);

export async function provisionAdmin(pool, {
  provider,
  subject,
  verifiedEmail,
  displayName,
  roles,
  reason,
  provisionedBySubject = "deployment",
  now = new Date(),
} = {}) {
  const normalizedRoles = [...new Set(roles ?? [])].sort();
  if (!provider?.trim() || !subject?.trim() || !displayName?.trim() || !reason?.trim()
    || !normalizedRoles.length || normalizedRoles.some((role) => !allowedRoles.has(role))) {
    throw new AdminAuthError("VALIDATION_ERROR", "Provider, subject, email, display name, approved roles, and a reason are required.", 400);
  }
  const email = normalizeEmail(verifiedEmail);
  return withTransaction(pool, async (client) => {
    const inserted = await client.query(
      `INSERT INTO admin_users (
          id, provider, provider_subject, verified_email, display_name,
          status, mfa_required, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'active', true, $6, $6)
       ON CONFLICT (provider, provider_subject) DO NOTHING
       RETURNING id, provider, provider_subject, verified_email, display_name, status`,
      [randomUUID(), provider.trim(), subject.trim(), email, displayName.trim(), now],
    );
    let user = inserted.rows[0];
    if (!user) {
      const existing = await client.query(
        `SELECT id, provider, provider_subject, verified_email, display_name, status
           FROM admin_users WHERE provider = $1 AND provider_subject = $2 FOR UPDATE`,
        [provider.trim(), subject.trim()],
      );
      user = existing.rows[0];
      if (!user || user.verified_email !== email) {
        throw new AdminAuthError("CONFLICT", "The administrator identity is already bound to different verified details.", 409);
      }
      if (user.status !== "active") throw new AdminAuthError("CONFLICT", "A suspended or disabled administrator cannot be reprovisioned implicitly.", 409);
    }
    for (const role of normalizedRoles) {
      await client.query(
        `INSERT INTO admin_role_grants (
            admin_user_id, role, granted_by, reason, granted_at
         ) SELECT $1, $2, NULL, $3, $4
          WHERE NOT EXISTS (
            SELECT 1 FROM admin_role_grants
             WHERE admin_user_id = $1 AND role = $2 AND revoked_at IS NULL
          )`,
        [user.id, role, reason.trim(), now],
      );
    }
    await client.query(
      `INSERT INTO admin_access_audit_logs (
          id, admin_user_id, actor_subject, action, route, required_role,
          outcome, detail_json, occurred_at
       ) VALUES ($1, $2, $3, 'admin.identity.provision', 'admin:provision',
                 'security_admin', 'succeeded', $4::jsonb, $5)`,
      [randomUUID(), user.id, provisionedBySubject, JSON.stringify({ roles: normalizedRoles, reason: reason.trim() }), now],
    );
    return {
      adminUserID: user.id, provider: user.provider, subject: user.provider_subject,
      verifiedEmail: user.verified_email, displayName: user.display_name, roles: normalizedRoles,
    };
  });
}
