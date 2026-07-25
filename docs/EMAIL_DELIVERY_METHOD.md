# Transactional magic-link email method

## Outcome

Nourish has a provider-neutral delivery interface and a production Postmark REST adapter. Development retains in-memory capture so local phone testing does not send external email or require provider credentials.

Production startup fails closed unless all of the following are present:

- `NOURISH_EMAIL_PROVIDER=postmark`
- a provider-verified `NOURISH_EMAIL_FROM`
- `NOURISH_POSTMARK_SERVER_TOKEN` injected through the secret manager
- a valid `NOURISH_MAGIC_LINK_URL_PREFIX` using the registered `nourish:` scheme or HTTPS and ending in `token=`

## Message and privacy contract

- One recipient is sent one one-time 15-minute link.
- Both plain-text and restrained responsive HTML bodies are supplied.
- Open and link tracking are explicitly disabled.
- The provider receives only the recipient, message content, and an opaque request identifier required to deliver and support the transaction.
- No recipient, token, provider credential, or upstream diagnostic is returned in API errors.
- The application accepts delivery only when the provider returns a message identifier.
- If delivery fails after token creation, the undelivered token is deleted. The shared one-minute limiter still prevents hammering a failing provider.

## Provider choice

Postmark is the first adapter because its API has a dedicated transactional message stream, direct success/error responses, tracking controls, and a permanent developer allowance suitable for staging. The Nourish interface does not expose Postmark shapes to authentication code. An SES or Resend adapter can therefore be added later without changing token creation, rate limiting, or the iOS callback.

AWS SES remains attractive at materially larger volume, but it adds region, account-sandbox, sender verification, signing/SDK, quota, and deliverability operations. That tradeoff should be revisited using measured send volume after staging.

## Staging acceptance

Before enabling live users:

1. Register the chosen sending domain and publish provider-issued SPF and DKIM records.
2. Publish a DMARC policy with aggregate reporting, beginning conservatively and tightening after validation.
3. Inject a server-scoped send token; never use an account-management token.
4. Send to representative Gmail, Outlook, Apple/iCloud, and business-domain inboxes and verify latency, spam placement, dark mode, and link opening on a physical iPhone.
5. Confirm provider retention settings, subprocessors, data region, deletion behavior, and the launch privacy notice.
6. Configure delivery, bounce, and suppression monitoring without copying message bodies or raw sign-in tokens into Nourish logs.
7. Rotate the provider token and repeat delivery to prove the runbook.

An HTTPS universal link is preferable for the final public experience, but it depends on the final domain and Apple associated-domain configuration. The registered custom-scheme callback remains the explicit interim production configuration.
