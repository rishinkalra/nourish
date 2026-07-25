# Service-level and performance method

The PRD targets are release gates, not claims based on a developer laptop.

## Targets and measurement

| Target | Authoritative measurement | Minimum release evidence |
|---|---|---|
| Cold start to interactive home p95 below 2.5 seconds | Xcode Organizer launch/hang metrics plus signposted beta journeys on the supported reference device; exclude first authentication exactly as the PRD states | At least 100 eligible launches across the agreed beta/device set, segmented by app version and OS |
| Cached plan opening p95 below 1 second | Native signpost from tap/launch intent until the protected cached active-plan view is interactive, measured offline and online | At least 100 cached opens including a production-scale 21-meal plan |
| Plan processing p95 below 8 seconds | Worker `duration_ms` for `plan.generate`; queue delay is reported separately and background completion remains mandatory | At least 100 successful generations on production-shaped catalogue/database capacity |
| API availability at least 99.9% monthly | Independent HTTPS probes plus request telemetry; planned maintenance is not silently excluded | A live monthly SLO dashboard and alert drill |
| Plan success at least 99% | `plan_generation_success_rate`; valid `NO_FEASIBLE_PLAN` outcomes are excluded, while crashes, dead jobs, timeouts, and unexpected failures count against the target | Beta sample and threshold approved before launch |

Percentiles must use the nearest-rank method and must never average per-host percentiles. Reports retain sample count, time window, app/backend version, device/OS or service topology, catalogue version, and exclusions.

## Implemented local evidence

The durable local journey now times worker-backed initial generation and takes 20 repeated active-plan API samples. It fails above the 8-second generation target or 1-second active-read target and records the measurements in its final JSON. This protects obvious regressions; it is not a substitute for native reference-device p95 or production-load evidence.

API and worker completion logs already carry bounded route/job duration, queue delay, outcome, attempt, and correlation identifiers. The Control Room exposes the defined plan-success formula. Production monitoring must alert before the SLO budget is exhausted, and must separately alert on dead jobs, queue delay, database saturation, subscription webhook anomalies, and smoke failures.

## Compatibility window

`api_v1_compatibility_baseline.json` freezes the v1 route fragments, structured errors, response headers, and supported-app policy. Tests require the server and native client to retain that surface. The backend advertises `x-nourish-api-version: 1` on JSON, CSV, image, success, and error responses.

For every public release, set the first real minimum version and support that release plus the immediately preceding public release. Within that window, changes are additive: do not remove required fields/routes, rename enum values, tighten validation for previously valid requests, change authentication/idempotency behavior, or reinterpret stored snapshots. A breaking change requires a new API version, parallel operation, migration telemetry, and an owner-approved retirement date.
