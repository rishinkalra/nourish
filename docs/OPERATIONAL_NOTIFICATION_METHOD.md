# Operational notification method

Nourish uses a bounded server-owned template registry. Background jobs carry only a template identifier, user ID, opaque reference ID, and correlation ID. They never carry export contents, profile answers, email addresses, meal history, signed Apple data, or storage keys.

## Implemented delivery

- A completed portable export transactionally queues `notification.operational` with `export_ready`.
- The worker reads active account-owned device registrations and sends a no-detail APNs alert that deep-links to Account settings.
- Invalid APNs tokens are retired through the same boundary used by plan-ready delivery.
- Collapse identifiers contain only the template and opaque request reference.
- The native router supports export, subscription, and account-security destinations.

Account deletion deliberately does not queue a push after erasure: deletion removes the account and its device registrations. The in-app deletion receipt remains authoritative. Material security notifications require a separately defined, verified security event before their template may be queued.

## Trial-ending boundary

The `trial_ending` template and secure subscription destination are implemented, but automated scheduling remains disabled. It may be enabled only after approved StoreKit products and trial terms exist, Apple/platform messaging rules are confirmed, and the user has provided explicit subscription-notification consent. General plan-reminder or APNs permission is not treated as that consent.

## Production verification

Live delivery still requires the paid Apple team, APNs key, Release entitlement, sandbox device registration, notification-copy approval, and delivery/open telemetry validation.
