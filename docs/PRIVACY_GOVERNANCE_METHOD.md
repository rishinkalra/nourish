# Privacy governance method

This file is the engineering source of truth for data minimization and third-party review. It does not replace a counsel-approved privacy policy, DPDP assessment, App Store Connect answers, vendor agreements, or an accountable launch owner.

## Product boundary

- Nourish does not sell health, profile, meal-behavior, or account data.
- Nourish contains no advertising SDK, advertising identifier access, cross-app tracking, fingerprinting, or data-broker integration.
- First-party product measurement is off by default and requires a separate in-app choice. Its event schema rejects free text, email, body metrics, allergens, meal history, device identifiers, advertising identifiers, and fingerprints.
- Body inputs remain optional. Authentication, account ownership, StoreKit entitlement, planning answers, immutable plan history, user-requested feedback, and bounded operational evidence are collected only for the functions described in `privacy_inventory.json`.
- Generic administrator-created recipe briefs may be sent to OpenAI. User profiles, emails, meal histories, account IDs, and feedback must never be included.

## App Store disclosure baseline

`ios/NourishApp/NourishApp/PrivacyInfo.xcprivacy` declares no tracking; declares the app's same-app `UserDefaults` use with Apple's `CA92.1` reason; and records the currently collected email, health/profile, user-ID, purchase-history, product-interaction, and optional user-content categories. The App Store Connect privacy form must match this manifest and `privacy_inventory.json` at every submission. It must be revisited whenever collection, retention, linking, purpose, or a processor changes.

The manifest is a conservative engineering baseline. The accountable owner must verify the final answers in App Store Connect against the production configuration and Apple's current definitions before submission.

## Mandatory change review

Every new runtime dependency, SDK, hosted processor, analytics/attribution tool, support tool, AI vendor, or new data category requires all of the following before merge:

1. Name the business purpose and prove existing first-party components cannot reasonably provide it.
2. List exact data fields, sources, destinations, region, linking, retention, deletion, subprocessors, and any model training or advertising use.
3. Review vendor terms, DPA, security evidence, breach terms, cross-border transfer basis, deletion behavior, and least-privilege credentials.
4. Update `privacy_inventory.json`, the app privacy manifest, App Store/Play disclosures, the public privacy policy, export/deletion coverage, and threat model as applicable.
5. Add an owner, approval date, next review date, production kill switch, and executable regression evidence.

The backend test suite rejects an unreviewed production package, tracking declaration, advertising-data sale declaration, or privacy manifest that omits the app's required-reason API and recorded data categories. Swift currently has no remote package dependency.

## Launch decisions still required

Legal ownership, public policy/grievance destinations, DPDP and other applicable jurisdictional review, processor agreements, retention approvals, cross-border disclosures, and App Store Connect submission are owner/counsel actions. Brevo, DigitalOcean, Apple, and OpenAI production configurations must be reconciled with the inventory before public traffic.
