# Transactional magic-link email method

## Outcome

Nourish has a provider-neutral delivery interface with production Brevo and Postmark REST adapters. Brevo is selected in the initial DigitalOcean staging template; Postmark remains a configuration-only fallback. Development retains in-memory capture so local phone testing does not send external email or require provider credentials.

Production startup fails closed unless all of the following are present:

- `NOURISH_EMAIL_PROVIDER=brevo` or `postmark`
- a provider-verified `NOURISH_EMAIL_FROM`
- the matching `NOURISH_BREVO_API_KEY` or `NOURISH_POSTMARK_SERVER_TOKEN` injected through the secret manager
- a valid `NOURISH_MAGIC_LINK_URL_PREFIX` using the registered `nourish:` scheme or HTTPS and ending in `token=`

## Message and privacy contract

- One recipient is sent one one-time 15-minute link.
- Both plain-text and restrained responsive HTML bodies are supplied.
- Postmark open and link tracking are explicitly disabled per message.
- Brevo provider idempotency is keyed by the opaque request ID. Before live use, Brevo account settings must enable anonymous transactional tracking and the shortest reviewed transactional log/content retention. These account controls cannot be proven by application configuration alone.
- The provider receives only the recipient, message content, and an opaque request identifier required to deliver and support the transaction.
- No recipient, token, provider credential, or upstream diagnostic is returned in API errors.
- The application accepts delivery only when the provider returns a message identifier.
- If delivery fails after token creation, the undelivered token is deleted. The shared one-minute limiter still prevents hammering a failing provider.

## Provider choice

Brevo is the preferred initial adapter because its free tier supports early beta volume, the transactional endpoint returns a message identifier, and provider-side idempotency reduces duplicate sends. Postmark remains supported because it offers a narrowly focused transactional stream and stronger request-level tracking controls. The Nourish interface exposes neither provider's shapes to authentication code, so switching is configuration-only.

AWS SES remains attractive at materially larger volume, but it adds region, account-sandbox, sender verification, signing/SDK, quota, and deliverability operations. That tradeoff should be revisited using measured send volume after staging.

## Staging acceptance

The chosen sending domain is `familychef.in`, with `Nourish <sign-in@familychef.in>` as the transactional identity. Reserve monitored `support@familychef.in` and `privacy@familychef.in` mailboxes for public support and privacy/grievance handling.

Before enabling live users:

1. Register `familychef.in` in Brevo and publish the provider-issued SPF and DKIM records.
2. Publish a DMARC policy with aggregate reporting, beginning conservatively and tightening after validation.
3. Inject a server-scoped send token; never use an account-management token.
4. For Brevo, enable anonymous transactional tracking so opens/clicks cannot be tied to a recipient, and set an explicitly reviewed short retention period for logs and message previews; Brevo's identifiable tracking and indefinite default retention are not acceptable for sign-in links.
5. Send to representative Gmail, Outlook, Apple/iCloud, and business-domain inboxes and verify latency, spam placement, dark mode, and link opening on a physical iPhone.
6. Confirm provider retention settings, subprocessors, data region, deletion behavior, and the launch privacy notice.
7. Configure delivery, bounce, and suppression monitoring without copying message bodies or raw sign-in tokens into Nourish logs.
8. Rotate the provider token and repeat delivery to prove the runbook.

The future universal-link prefix is `https://www.familychef.in/auth/magic-link?token=`. Enable it only after `www.familychef.in` serves the Apple App Site Association file and the paid Apple organization can sign the associated-domain entitlement. The registered `nourish:` custom-scheme callback remains the explicit interim configuration.
