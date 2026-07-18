# Administrator identity and authorization method

## Trust boundary

The Control Room now has a server-owned administrator session boundary. A configured workforce identity verifier must validate the external identity assertion before Nourish sees it. The verified result must contain a stable provider subject, verified email, display name, provider name, and authentication methods including `mfa`. Nourish never treats dashboard fields or headers as proof of production identity.

The selected production identity provider is still a deployment decision. Until its verifier and redirect/callback UI are configured, the shared `NOURISH_ADMIN_KEY` remains an explicit local-development fallback only.

## Durable identity and roles

PostgreSQL stores administrator identities separately from consumer users. Role grants are independent, reasoned records supporting `author`, `reviewer`, `operator`, and `security_admin`; revoked grants remain historical. Provisioning is a deployment operation using `npm run admin:provision` and requires provider, subject, verified email, display name, approved roles, grant reason, and provisioning actor environment values.

There is no administrator-to-consumer impersonation mechanism.

## Session controls

Verified MFA identity exchange creates an eight-hour administrator session. Only the SHA-256 token hash is stored. Sessions retain the identity provider, authentication methods, issue/expiry/last-seen timestamps, and revocation time. There is no long-lived admin refresh token: expiry requires a new MFA-backed identity exchange.

Every admin route declares its required role. Authors can draft/edit/submit. Reviewers can ingest reviewed evidence, inspect queues/audit, and approve/reject. Operators can inspect aggregate/product operations and audited support state. Feature-flag visibility and mutation require `security_admin` because emergency disable and user allowlists are release/security controls. A `security_admin` grant can satisfy other protected route checks but still cannot bypass catalogue rules such as author/reviewer separation or immutable publication.

## Audit

Identity exchange, route authorization, denial, revocation, and provisioning write correlation-aware access events. Identifiable support lookups additionally require a reason and record found or not-found outcomes using a hash of the normalized lookup value rather than raw email. Both PostgreSQL audit tables are append-only by trigger. Catalogue content and recipe decisions remain in their separate durable audit streams, allowing access evidence and business decisions to be reviewed independently. See `USER_SUPPORT_METHOD.md`.

## Remaining production gates

- Select and configure the workforce identity provider, issuer/audience verification, key rotation, callback URLs, and company sign-in UI.
- Define joiner/mover/leaver provisioning ownership, dual control for `security_admin`, role review cadence, emergency suspension, and retention policy.
- Add live PostgreSQL tests for expiry, concurrent revocation, grant removal, provider outage, and audit export.
- Add alerts for repeated denied access, disabled-account attempts, and anomalous security-admin activity.
