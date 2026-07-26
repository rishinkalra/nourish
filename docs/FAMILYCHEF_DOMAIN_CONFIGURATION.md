# FamilyChef domain configuration

## Approved hostname map

Nourish remains the product/app name. `familychef.in` is the owned internet domain.

| Purpose | Production | Staging |
|---|---|---|
| Public website and policy pages | `https://www.familychef.in` | optional preview URL |
| API | `https://api.familychef.in` | `https://api-staging.familychef.in` |
| Private Control Room | `https://control.familychef.in` | `https://control-staging.familychef.in` |
| Transactional sender | `Nourish <sign-in@familychef.in>` | same verified sender initially |
| Support mailbox | `support@familychef.in` | not used for automated testing |
| Privacy/grievance mailbox | `privacy@familychef.in` | not used for automated testing |

The apex `https://familychef.in` should redirect permanently to `https://www.familychef.in`. Do not serve the API or Control Room from the apex or `www`.

The iOS Release build is pinned to `https://api.familychef.in`. Debug builds retain their local development origin. The existing bundle identifier `com.projectnourish.app` and `nourish://` callback are intentionally unchanged: changing either would disrupt signing, Keychain continuity, APNs and installed test builds. After the paid Apple organization is available, add a verified `applinks:www.familychef.in` associated domain and an Apple App Site Association file, validate it on physical devices, and only then move email sign-in to `https://www.familychef.in/auth/magic-link?token=`.

## DNS records

The exact App Platform target is generated only after the app exists. When using the current registrar/DNS provider:

1. Add `api-staging.familychef.in` to the staging App Platform app as its primary custom domain.
2. Copy the CNAME target ending in `.ondigitalocean.app` that DigitalOcean displays.
3. Create a CNAME record for host `api-staging` pointing to that exact target.
4. Repeat later for `api.familychef.in` on the production app.
5. Point `www` only to the selected public-site host. Configure the apex redirect using the registrar, DNS/edge provider or public-site host.
6. Create separate hosting for `control-staging` and `control`; do not expose the static Control Room from the public website.
7. If CAA records exist, allow both `letsencrypt.org` and `pki.goog`, which DigitalOcean App Platform uses for certificates.
8. Wait for DNS and certificate status to become active before changing any live client or sender.

Do not use a wildcard record for these services. Explicit records keep the public site, API and privileged Control Room independently routable and removable.

## Email domain records

Create `sign-in@familychef.in`, `support@familychef.in` and `privacy@familychef.in` as real monitored or routed mailboxes before displaying them publicly. In Brevo:

1. add and authenticate `familychef.in`;
2. publish the exact SPF and DKIM records Brevo supplies;
3. publish a DMARC record initially in monitoring mode and review aggregate reports before enforcement;
4. enable anonymous transactional tracking, prohibit recipient-level tracking and approve a short provider retention period;
5. verify representative Gmail, Outlook, iCloud and business inbox delivery;
6. keep magic-link and operational messages on the authenticated `sign-in@familychef.in` sender.

## Verification

Before staging submission:

- run the complete release gate;
- run the DigitalOcean preflight and confirm its summary reports `api-staging.familychef.in`;
- verify the iOS Release build contains `https://api.familychef.in` and no placeholder API origin;
- check DNS, TLS certificate, API readiness and Control Room CORS independently;
- keep all provider verification tokens and credentials outside source control.
