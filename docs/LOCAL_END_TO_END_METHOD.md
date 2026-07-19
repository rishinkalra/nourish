# Local end-to-end environment

The local environment runs the same durable boundaries intended for staging: PostgreSQL, ordered migrations, the API, the leased background worker, private filesystem object storage, reviewed synthetic catalogue content, and the web interface.

## Start and verify

Docker Desktop must be installed and running. From the repository root:

```sh
scripts/local-stack up
scripts/local-stack test
```

The web app is available at `http://127.0.0.1:4173`, the API at `http://127.0.0.1:8080`, and PostgreSQL is bound only to `127.0.0.1:5432`.

The end-to-end check uses a fresh synthetic account on every run. It verifies health/readiness, the current migration state, email authentication persistence, profile/onboarding persistence, queued worker execution, a seven-day 21-meal plan, adoption, grocery generation, and prep generation.

## Safety boundaries

- Local database credentials are intentionally local-only and are committed solely for this disposable environment.
- Synthetic recipe and nutrition records are visibly labelled and must never be promoted to staging or production.
- Both seed and end-to-end commands reject production mode, remote hosts, and any database name other than `nourish_local`.
- PostgreSQL data and private exports live in Docker volumes. `scripts/local-stack down` keeps them; `scripts/local-stack reset` removes them.
- The phone Debug build may use an HTTP private-LAN address. Release builds retain the HTTPS-only API policy.

## Phone testing

Keep the Mac and iPhone on the same Wi-Fi network. Read the Mac's Bonjour name with `scutil --get LocalHostName`, then build the Debug app with `NOURISH_API_BASE_URL` set to that `.local` host, for example `http://Nourish-Mac.local:8080`. Using the Bonjour host aligns with iOS Local Network and App Transport Security behavior and avoids an address change after DHCP renewal. No machine-specific host is committed to source control.
