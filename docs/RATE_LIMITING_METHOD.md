# Authentication rate-limiting method

## Outcome

Nourish applies shared, server-owned fixed-window limits before expensive or identity-sensitive authentication work. PostgreSQL makes each counter atomic across API replicas; the in-memory adapter preserves the same contract for isolated tests.

## Protected operations

| Operation | Dimension | Default limit |
| --- | --- | --- |
| Request email magic link | Source address | 20 per hour |
| Request email magic link | Normalized email | 1 per minute and 5 per hour |
| Complete email magic link | Source address | 30 per 15 minutes |
| Sign in with Apple | Source address | 30 per 15 minutes |
| Refresh session | Source address | 120 per 15 minutes |
| Exchange administrator identity | Source address | 20 per 15 minutes |

The one-minute magic-link resend cooldown is enforced by the shared atomic limiter, with the authentication service retaining a second defense-in-depth check. Thresholds are deliberately conservative defaults and must be calibrated against staging and production telemetry without weakening the one-time-token controls.

## Privacy and trust boundaries

- Raw email and network identifiers never enter the counter table. The API derives a scope-bound HMAC-SHA256 digest using the independent `NOURISH_RATE_LIMIT_SECRET`.
- Production API startup fails closed if that secret is absent or shorter than 32 characters. Rotation should overlap with a deployment boundary; changing the secret safely resets short-lived counters.
- `X-Forwarded-For` is ignored by default. `NOURISH_TRUST_PROXY=true` is used only behind a controlled ingress that replaces the header; otherwise the socket peer is authoritative.
- Counter responses contain a safe error code, correlation ID, retryable flag, and bounded `retryAfterSeconds`. HTTP also returns `Retry-After`.
- Expired counters are removed hourly by the worker in bounded batches.

## Deployment validation

Before public staging traffic:

1. Inject a random secret through the platform secret manager and enable trusted-proxy handling only on the API component.
2. Apply migration `024_distributed_rate_limits.sql`.
3. Generate concurrent requests through the real ingress and verify one shared ceiling across at least two API instances.
4. Confirm spoofed forwarding headers cannot change the effective source identity.
5. Observe legitimate sign-in completion and refresh success rates, then adjust thresholds only through a reviewed code/configuration change.
6. Exercise database failover and confirm temporary limiter database failures fail closed through the normal safe `TEMPORARY_FAILURE` response.

This slice does not replace provider-level DDoS protection, ingress connection limits, anomaly alerts, or incident response. Those remain deployment controls.
