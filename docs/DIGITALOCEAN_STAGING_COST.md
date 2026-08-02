# FamilyChef staging cost boundary

## Decision

The owner-approved FamilyChef staging topology has an estimated DigitalOcean base cost of **USD 22.00 per month**, before taxes, third-party services and usage overages. This estimate was revised and approved by Rishin on 2 August 2026 against DigitalOcean's current published pricing.

The approved staging envelope is **USD 30 per month**. No cloud resource may be created until the billing team/project is confirmed and a USD 25 billing alert is enabled. A DigitalOcean billing alert is notification-only; it is not a spending cap.

## Resource estimate

| Resource | Checked-in or proposed size | Monthly base |
|---|---|---:|
| App Platform API | `apps-s-1vcpu-0.5gb`, one instance | USD 5.00 |
| App Platform worker | `apps-s-1vcpu-0.5gb`, one instance | USD 5.00 |
| App Platform PostgreSQL | development database, 512 MiB | USD 7.00 |
| Spaces Standard Storage | one private SYD1 subscription/bucket | USD 5.00 |
| Pre-deploy migration job | `apps-s-1vcpu-0.5gb`, billed only while running | usage-based |
| **Expected base total** | | **USD 22.00/month** |

The API and worker prices map directly to `.do/app.staging.yaml`. The migration job uses the 512 MiB container but App Platform bills jobs only while they run, with a one-minute minimum; it is therefore excluded from the always-on subtotal.

The development database has no built-in backup feature and must contain disposable test data only. It is appropriate for this budget-limited pre-production environment, not for production or real customer data. Managed PostgreSQL backup, point-in-time recovery, failover and isolated-restore evidence remain mandatory production gates. DigitalOcean supports upgrading an App Platform development database to a managed database later.

## Approval envelope

Rishin approved a **USD 30/month staging envelope** on 2 August 2026. The USD 8 difference between the steady base and the envelope allows short migration runs and modest transfer/storage overage without authorizing a larger architecture. Configure the DigitalOcean team billing alert at **USD 25** and review month-to-date spend weekly. Because the alert does not stop resources, the accountable owner must investigate immediately and manually scale down or remove unintended resources.

This envelope excludes:

- applicable GST, card conversion and foreign-exchange costs;
- Brevo, OpenAI API, domain renewal or external monitoring charges;
- App Platform transfer beyond the included container allowances;
- Spaces storage or transfer beyond the subscription allowance;
- managed-database conversion, a database standby/high-availability node, dedicated egress IP or production environment.

Any one of those additions requires a fresh written cost review. Production must receive its own cost boundary after staging measurements exist.

## Owner approval record

- Account/team owner: Rishin (DigitalOcean team identity pending confirmation)
- DigitalOcean team and project: My Team / FamilyChef Staging (`7f260330-c626-494b-bfcf-21e26c5063f8`)
- Billing email: pending
- Approved monthly envelope: USD 30
- Approval date: 2 August 2026
- Billing alert configured: USD 25 monthly budget, 50%/75%/100% thresholds, team owners/billers
- Billing alert delivery tested: pending until first threshold or controlled test
- First weekly review date: pending

## Published sources

- DigitalOcean App Platform pricing: https://docs.digitalocean.com/products/app-platform/details/pricing/
- DigitalOcean Managed Databases pricing: https://www.digitalocean.com/pricing/managed-databases
- DigitalOcean Spaces pricing: https://docs.digitalocean.com/products/spaces/details/pricing/
- DigitalOcean billing alerts: https://docs.digitalocean.com/platform/billing/billing-alerts/
