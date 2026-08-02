# FamilyChef staging cost boundary

## Decision

The recommended always-on FamilyChef staging topology has an estimated DigitalOcean base cost of **USD 35.15 per month**, before taxes, third-party services and usage overages. This estimate was reviewed on 2 August 2026 against DigitalOcean's current published pricing.

No cloud resource may be created until the account owner explicitly approves this estimate, confirms the billing team/project and enables a billing alert. A DigitalOcean billing alert is notification-only; it is not a spending cap.

## Resource estimate

| Resource | Checked-in or proposed size | Monthly base |
|---|---|---:|
| App Platform API | `apps-s-1vcpu-1gb-fixed`, one instance | USD 10.00 |
| App Platform worker | `apps-s-1vcpu-0.5gb`, one instance | USD 5.00 |
| Managed PostgreSQL | Basic Regular, 1 GiB RAM, 1 vCPU, 10 GiB, single node | USD 15.15 |
| Spaces Standard Storage | one private BLR1 subscription/bucket | USD 5.00 |
| Pre-deploy migration job | `apps-s-1vcpu-0.5gb`, billed only while running | usage-based |
| **Expected base total** | | **USD 35.15/month** |

The API and worker prices map directly to `.do/app.staging.yaml`. The migration job uses the 512 MiB container but App Platform bills jobs only while they run, with a one-minute minimum; it is therefore excluded from the always-on subtotal. The database estimate deliberately uses the smallest managed production PostgreSQL node rather than an App Platform development database because the release method requires managed backups and restore evidence. The single-node staging database is not a production high-availability design.

## Approval envelope

Approve an initial **USD 45/month staging envelope** to allow short migration runs and modest transfer/storage overage without silently authorizing a larger architecture. Configure the DigitalOcean team billing alert at **USD 40** and review month-to-date spend weekly. Because the alert does not stop resources, the accountable owner must investigate immediately and manually scale down or remove unintended resources.

This envelope excludes:

- applicable GST, card conversion and foreign-exchange costs;
- Brevo, OpenAI API, domain renewal or external monitoring charges;
- App Platform transfer beyond the included container allowances;
- Spaces storage or transfer beyond the subscription allowance;
- a database standby/high-availability node, dedicated egress IP or production environment.

Any one of those additions requires a fresh written cost review. Production must receive its own cost boundary after staging measurements exist.

## Owner approval record

- Account/team owner: pending
- DigitalOcean team and project: pending
- Billing email: pending
- Approved monthly envelope: pending (recommended USD 45)
- Approval date: pending
- Billing alert configured and tested: pending
- First weekly review date: pending

## Published sources

- DigitalOcean App Platform pricing: https://docs.digitalocean.com/products/app-platform/details/pricing/
- DigitalOcean Managed Databases pricing: https://www.digitalocean.com/pricing/managed-databases
- DigitalOcean Spaces pricing: https://docs.digitalocean.com/products/spaces/details/pricing/
- DigitalOcean billing alerts: https://docs.digitalocean.com/platform/billing/billing-alerts/

