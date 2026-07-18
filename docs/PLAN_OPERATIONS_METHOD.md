# Plan operations method

## Purpose and access boundary

The private Control Room gives operators enough evidence to diagnose plan generation without exposing the user's saved profile or the planner's raw deterministic seed. Both plan-run endpoints require the administrator `operator` role; more privileged security administrators retain the existing explicit override. Consumer sessions cannot access this surface.

## Curated operational projection

Each run exposes its state, plan and user identifiers, correlation ID, requested week and timezone, trigger and regeneration reason, profile revision, locked-item count, snack setting, exact generator/scoring/rule versions, SHA-256 seed hash, candidate and rejection counts, selected-item count, calorie percentage/deviation, optional protein differences, ingredient reuse, cooking load, pack-size waste coverage, whole-week tolerance contract/pass/excess/relaxation evidence, variety and explanation summaries, typed failure, timestamps, duration, and background-job lease/retry evidence.

The projection deliberately omits the stored profile snapshot and raw deterministic seed. The seed hash supports replay comparison without disclosing the seed. Search covers run, user, correlation, and error identity; state filtering and bounded result limits keep the list operationally useful.

## Runtime and durability

Memory mode projects the existing in-process plan-job records for local development. PostgreSQL mode reads plan jobs and their resulting weekly plans, then joins leased background-job evidence through the plan-job identifier stored in the durable job payload. The query is parameterized and does not select the profile snapshot or raw seed columns.

## Control Room behavior

The responsive split view shows overall, succeeded, in-progress, and failed counts; searchable run summaries; version evidence; a candidate funnel; outcome or typed failure details; daily/weekly/optional-protein tolerance evidence and documented relaxations; correlation and seed-hash evidence; and a retry timeline. Completed, rejected, retrying, and terminal-failure states have distinct presentations. On small screens, details open as a focused overlay.

## Verification and remaining gates

Backend checks cover operator authorization, list and detail projections, filtering, PostgreSQL parameterization, diagnostic and retry evidence, and exclusion of profile snapshots and raw seed values. Browser checks cover successful, rejected, and in-flight runs, responsive rendering, and a clean console.

Production still requires live PostgreSQL validation, centralized observability and alert links, retention policy confirmation, and workforce identity-provider configuration. Those gates do not change the data-minimization boundary of this operator view.
