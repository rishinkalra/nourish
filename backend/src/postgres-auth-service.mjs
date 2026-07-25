import { randomUUID } from "node:crypto";
import {
  AuthError,
  ConfigurationGatedAppleVerifier,
  MemoryMagicLinkDelivery,
  createOpaqueToken,
  hashOpaqueToken,
  normalizeEmail,
} from "./auth-service.mjs";
import { withTransaction } from "./database.mjs";

export class PostgresAuthService {
  constructor({
    pool,
    delivery = new MemoryMagicLinkDelivery(),
    appleVerifier = new ConfigurationGatedAppleVerifier(),
    now = () => new Date(),
    tokenFactory = createOpaqueToken,
  }) {
    if (!pool?.query || !pool?.connect) throw new Error("A PostgreSQL pool is required.");
    this.pool = pool;
    this.delivery = delivery;
    this.appleVerifier = appleVerifier;
    this.now = now;
    this.tokenFactory = tokenFactory;
  }

  async requestMagicLink(email) {
    const normalizedEmail = normalizeEmail(email);
    const now = this.now();
    const recent = await this.pool.query(
      `SELECT created_at
         FROM magic_link_tokens
        WHERE email = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [normalizedEmail],
    );
    if (recent.rows[0] && now.getTime() - new Date(recent.rows[0].created_at).getTime() < 60_000) {
      const elapsed = now.getTime() - new Date(recent.rows[0].created_at).getTime();
      throw new AuthError(
        "RATE_LIMITED",
        "Please wait before requesting another link.",
        429,
        Math.max(1, Math.ceil((60_000 - elapsed) / 1_000)),
      );
    }
    const token = this.tokenFactory();
    const requestID = randomUUID();
    const expiresAt = new Date(now.getTime() + 15 * 60_000);
    const resendAvailableAt = new Date(now.getTime() + 60_000);
    await this.pool.query(
      `INSERT INTO magic_link_tokens (
          id, email, token_sha256, expires_at, created_at
       ) VALUES ($1, $2, $3, $4, $5)`,
      [requestID, normalizedEmail, hashOpaqueToken(token), expiresAt, now],
    );
    await this.delivery.send({ email: normalizedEmail, token, requestID, expiresAt });
    return { requestID, resendAvailableAt };
  }

  async completeMagicLink(token) {
    if (typeof token !== "string" || token.length < 20) {
      throw new AuthError("VALIDATION_ERROR", "This sign-in link is invalid or incomplete.");
    }
    const now = this.now();
    return withTransaction(this.pool, async (client) => {
      const consumed = await client.query(
        `UPDATE magic_link_tokens
            SET consumed_at = $2
          WHERE token_sha256 = $1
            AND consumed_at IS NULL
            AND expires_at > $2
        RETURNING email`,
        [hashOpaqueToken(token), now],
      );
      if (!consumed.rows[0]) {
        throw new AuthError("VALIDATION_ERROR", "This sign-in link is invalid or has expired.");
      }
      const user = await this.#findOrCreateEmailUser(client, consumed.rows[0].email, now);
      return (await this.#issueSession(client, user, now)).response;
    });
  }

  async authenticateWithApple(exchange) {
    if (!exchange?.identityToken || !exchange?.authorizationCode || !exchange?.nonce) {
      throw new AuthError("VALIDATION_ERROR", "The Apple credential is incomplete.");
    }
    const verified = await this.appleVerifier.verify(exchange);
    const now = this.now();
    return withTransaction(this.pool, async (client) => {
      let result = await client.query(
        `SELECT users.id, users.verified_email, users.created_at, users.disabled_at
           FROM auth_identities
           JOIN users ON users.id = auth_identities.user_id
          WHERE auth_identities.provider = 'apple'
            AND auth_identities.provider_subject = $1
          FOR UPDATE OF users`,
        [verified.subject],
      );
      let user = result.rows[0];
      if (!user && verified.email) {
        result = await client.query(
          "SELECT id, verified_email, created_at, disabled_at FROM users WHERE verified_email = $1 FOR UPDATE",
          [normalizeEmail(verified.email)],
        );
        user = result.rows[0];
      }
      if (!user) {
        const inserted = await client.query(
          `INSERT INTO users (id, verified_email, created_at)
           VALUES ($1, $2, $3)
           RETURNING id, verified_email, created_at, disabled_at`,
          [randomUUID(), verified.email ? normalizeEmail(verified.email) : null, now],
        );
        user = inserted.rows[0];
      }
      if (user.disabled_at) throw new AuthError("AUTHENTICATION_REQUIRED", "Please sign in again.", 401);
      await client.query(
        `INSERT INTO auth_identities (id, user_id, provider, provider_subject, created_at)
         VALUES ($1, $2, 'apple', $3, $4)
         ON CONFLICT (provider, provider_subject) DO NOTHING`,
        [randomUUID(), user.id, verified.subject, now],
      );
      return (await this.#issueSession(client, user, now)).response;
    });
  }

  async refresh(refreshToken) {
    const now = this.now();
    return withTransaction(this.pool, async (client) => {
      const selected = await client.query(
        `SELECT sessions.id, sessions.user_id, sessions.revoked_at,
                sessions.refresh_expires_at, users.verified_email, users.created_at, users.disabled_at
           FROM sessions
           JOIN users ON users.id = sessions.user_id
          WHERE sessions.refresh_token_sha256 = $1
          FOR UPDATE OF sessions, users`,
        [hashOpaqueToken(refreshToken ?? "")],
      );
      const record = selected.rows[0];
      if (!record || record.revoked_at || record.disabled_at || new Date(record.refresh_expires_at) <= now) {
        throw new AuthError("AUTHENTICATION_REQUIRED", "Please sign in again.", 401);
      }
      const issued = await this.#issueSession(client, {
        id: record.user_id,
        verified_email: record.verified_email,
        created_at: record.created_at,
      }, now);
      await client.query(
        "UPDATE sessions SET revoked_at = $2, replaced_by_session_id = $3 WHERE id = $1",
        [record.id, now, issued.sessionID],
      );
      return issued.response;
    });
  }

  async revoke(accessToken) {
    await this.pool.query(
      `UPDATE sessions
          SET revoked_at = COALESCE(revoked_at, $2)
        WHERE access_token_sha256 = $1`,
      [hashOpaqueToken(accessToken ?? ""), this.now()],
    );
  }

  async disableUserAndRevokeSessions(userID) {
    const now = this.now();
    return withTransaction(this.pool, async (client) => {
      const disabled = await client.query(
        `UPDATE users
            SET disabled_at = COALESCE(disabled_at, $2)
          WHERE id = $1
        RETURNING id, disabled_at`,
        [userID, now],
      );
      if (!disabled.rows[0]) throw new AuthError("AUTHENTICATION_REQUIRED", "Please sign in again.", 401);
      await client.query(
        `UPDATE sessions
            SET revoked_at = COALESCE(revoked_at, $2)
          WHERE user_id = $1`,
        [userID, now],
      );
      return { userID, disabledAt: new Date(disabled.rows[0].disabled_at) };
    });
  }

  async authenticate(accessToken) {
    const now = this.now();
    const selected = await this.pool.query(
      `SELECT sessions.user_id, sessions.revoked_at, sessions.access_expires_at,
              users.verified_email, users.created_at, users.disabled_at
         FROM sessions
         JOIN users ON users.id = sessions.user_id
        WHERE sessions.access_token_sha256 = $1`,
      [hashOpaqueToken(accessToken ?? "")],
    );
    const record = selected.rows[0];
    if (!record || record.revoked_at || record.disabled_at || new Date(record.access_expires_at) <= now) {
      throw new AuthError("AUTHENTICATION_REQUIRED", "Please sign in again.", 401);
    }
    return {
      userID: record.user_id,
      verifiedEmail: record.verified_email,
      createdAt: record.created_at ? new Date(record.created_at) : null,
    };
  }

  async #findOrCreateEmailUser(client, email, now) {
    const normalizedEmail = normalizeEmail(email);
    let selected = await client.query(
      "SELECT id, verified_email, created_at, disabled_at FROM users WHERE verified_email = $1 FOR UPDATE",
      [normalizedEmail],
    );
    let user = selected.rows[0];
    if (!user) {
      selected = await client.query(
        `INSERT INTO users (id, verified_email, created_at)
         VALUES ($1, $2, $3)
         RETURNING id, verified_email, created_at, disabled_at`,
        [randomUUID(), normalizedEmail, now],
      );
      user = selected.rows[0];
      await client.query(
        `INSERT INTO auth_identities (id, user_id, provider, provider_subject, created_at)
         VALUES ($1, $2, 'email', $3, $4)`,
        [randomUUID(), user.id, normalizedEmail, now],
      );
    }
    if (user.disabled_at) throw new AuthError("AUTHENTICATION_REQUIRED", "Please sign in again.", 401);
    return user;
  }

  async #issueSession(client, user, now) {
    const accessToken = this.tokenFactory();
    const refreshToken = this.tokenFactory();
    const sessionID = randomUUID();
    const accessTokenExpiresAt = new Date(now.getTime() + 15 * 60_000);
    const refreshTokenExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
    await client.query(
      `INSERT INTO sessions (
          id, user_id, access_token_sha256, refresh_token_sha256,
          access_expires_at, refresh_expires_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        sessionID, user.id, hashOpaqueToken(accessToken), hashOpaqueToken(refreshToken),
        accessTokenExpiresAt, refreshTokenExpiresAt, now,
      ],
    );
    return {
      sessionID,
      response: {
        identity: {
          userID: user.id,
          verifiedEmail: user.verified_email,
          createdAt: user.created_at ? new Date(user.created_at) : null,
        },
        accessToken,
        refreshToken,
        accessTokenExpiresAt,
      },
    };
  }
}
