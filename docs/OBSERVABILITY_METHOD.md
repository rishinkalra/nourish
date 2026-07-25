# Production observability method

## Implemented telemetry boundary

The API and worker emit one-line JSON records to standard output for collection by the deployment platform. The contract is deliberately allowlisted rather than a generic object logger.

API completion records contain only:

- timestamp, service and environment;
- HTTP method and a known route template, with identifiers replaced by `:id`;
- status code and bounded request duration;
- a validated opaque correlation ID; and
- a bounded application error code and retryable flag when applicable.

Worker completion records contain only:

- opaque job ID and bounded job type;
- terminal or retry state and attempt count;
- queue delay and handler duration;
- propagated opaque correlation ID when available; and
- bounded failure code.

Plan generation, plan-ready delivery, account export, account deletion, operator-requested subscription reconciliation, and scheduled subscription reconciliation now carry correlation identity into background jobs. Retention-scan failures use separate structured operational events.

## Privacy and safety

The telemetry API has no arbitrary-field logging method. It cannot accept request or response bodies, profile or meal data, allergies, email addresses, authentication tokens, device tokens, App Store signed payloads, private object keys, provider credentials, database URLs, or upstream response bodies.

Incoming correlation headers are accepted only when they are canonical opaque UUIDs; unsafe values are replaced before they are echoed or logged. Unknown paths are recorded as `unmatched`, so attacker-controlled path text is never reflected. Telemetry write failure never changes an API response, job acknowledgement, or retry decision.

Local development retains its explicit terminal-only magic-link callback to support physical-phone testing without a mail provider. That callback is outside the structured telemetry stream, is disabled in production, and must never be forwarded to a shared log destination.

## Initial staging thresholds

Use these as the first staging alert contract, then calibrate them with measured traffic without weakening the release targets:

| Signal | Initial alert |
| --- | --- |
| `/readyz` uptime | two consecutive failures |
| API 5xx rate | greater than 1% for 5 minutes, with at least 50 requests |
| API p95 duration | greater than 1.5 seconds for 10 minutes |
| Worker dead jobs | any occurrence |
| Oldest queued job | greater than 5 minutes |
| Subscription webhook verification/application failures | 3 within 5 minutes |
| Export/deletion/analytics/rate-limit retention failure | any occurrence |
| API or worker restarts | more than 2 within 10 minutes |
| API or worker CPU | greater than 80% for 10 minutes |
| API or worker memory | greater than 85% for 10 minutes |

The checked-in DigitalOcean template implements restart, CPU, memory, deployment, and domain alerts. External uptime/latency checks, log-derived error/queue/webhook alerts, routing destinations, on-call contacts, and escalation schedules require the selected monitoring account and remain production gates.

## Staging validation

1. Select an approved log destination and configure it outside source control.
2. Confirm API and worker JSON records parse without multiline joins.
3. Search by one iOS correlation ID and prove it links the API request to the resulting worker job without exposing account content.
4. Trigger controlled 4xx, 5xx, retry, dead-job, retention-failure, and invalid-webhook cases.
5. Confirm each alert reaches the named staging responder and includes only safe fields.
6. Run a latency alert drill and record acknowledgement and recovery time.
7. Set log retention and access roles, then verify deletion at expiry.

No monitoring SDK may be added until the required privacy review is complete.
