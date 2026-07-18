# Proposed authentication contract extension

The v1.0 product specification defines `POST /v1/auth/apple` and `POST /v1/auth/magic-link`, while also requiring token refresh, account restoration, and secure sign-out. It does not define endpoints for magic-link completion, refresh-token rotation, or session revocation.

The implementation therefore proposes these versioned additions:

| Endpoint | Purpose | Security behavior |
|---|---|---|
| `POST /v1/auth/magic-link/complete` | Exchange a one-time callback token for an app session | Token expires after 15 minutes, is stored hashed, and is consumed once |
| `POST /v1/auth/refresh` | Rotate an unexpired refresh token | Old session is revoked; new access and refresh tokens are issued |
| `POST /v1/auth/revoke` | Revoke the current session during sign-out | Bearer access token identifies the session; repeated revocation is harmless |

The service also proposes `AUTHENTICATION_REQUIRED` as a structured `401` error code, because the documented error catalogue has no authentication-specific category.

These additions are implemented for local integration but remain proposed until the backend/API contract is formally accepted. Raw magic-link and session tokens must never be stored in the database, analytics, or logs. Production storage uses SHA-256 token digests, with TLS providing transport confidentiality.
