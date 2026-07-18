# Audited user-support method

## Purpose

The Control Room provides a narrowly scoped way for an authorized operator to inspect one account while responding to a support case. It satisfies the specification's internal-ID and verified-email lookup requirement without creating a browseable user directory or an impersonation mechanism.

## Lookup contract

- `POST /admin/v1/users/lookup` accepts exactly one `internalUserID` or `verifiedEmail` plus a 12–500 character reason.
- `GET /admin/v1/users/{id}` provides the specification's direct operational-user endpoint and requires the same reason in `x-support-access-reason`.
- Both routes require the `operator` role; `security_admin` retains the existing route-authorization override.
- Email is normalized and compared exactly. Internal IDs are compared exactly. Prefix, substring, fuzzy, bulk, and list searches are deliberately unavailable.
- A generic not-found response avoids revealing whether near matches or alternate identities exist.

## Minimized operational view

The response contains only the verified account identity needed to confirm the case and bounded operational state:

- internal user ID, verified email, creation time, and active/disabled state;
- onboarding completion and profile revision, but no profile answers;
- active-session count, but no session or authentication tokens;
- server-owned subscription/access and reconciliation summary, but no raw Apple transaction or app-account identifiers;
- latest plan-job state, plan-adoption count, and latest weekly-review time, but no plan contents, meal history, feedback notes, or deterministic seeds;
- latest export/deletion request status; and
- the access receipt produced by the lookup.

Every response declares that it is read-only, exact-match only, and offers no impersonation capability.

## Audit behavior

An audit row is written for both `found` and `not_found` outcomes before the response is returned. The row records the accountable operator, action, lookup type, SHA-256 of the normalized lookup value, matched-user pseudonym, outcome, reason, correlation ID, and time. Raw searched email is not copied into the audit stream.

Migration `017_user_support_audit.sql` makes the PostgreSQL audit append-only with a database trigger and adds actor- and subject-time indexes for authorized investigations. Tests verify that a miss commits its audit before returning `404`, all SQL inputs are parameterized, reviewers are denied, and the projection does not include profile answers, meal history, or tokens.

## No impersonation or support mutation

MVP has no "view as user," session minting, password reset, profile editing, plan editing, entitlement override, or privacy-request mutation in the support view. The existing subscription recheck remains a separate reason-required operator action; it queues a fresh verified Apple reconciliation and cannot manually grant or revoke access.

## Remaining production validation

- Run migration and concurrency tests against the selected managed PostgreSQL service.
- Select the workforce identity provider and validate joiner/mover/leaver removal plus operator-role review.
- Set audit retention, authorized audit-export, monitoring, and alerting policy.
- Complete privacy/security review before connecting an external support-ticket vendor or copying ticket identifiers into the reason field.
