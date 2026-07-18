# Authenticated profile synchronization verification

Verified on 13 July 2026 with Xcode 26.6, the iOS 26.5 iPhone 17 Pro Simulator, and the dependency-free local Nourish HTTP service.

## Journey verified

1. Started a fresh in-memory authentication/profile service.
2. Created a one-time email link for `rhea.sync@example.test`.
3. Launched the Debug app with a protected local onboarding fixture and the callback URL.
4. Confirmed the callback created an authenticated Keychain session.
5. Confirmed the app called authenticated `GET /v1/profile`, received JSON `null`, and uploaded the local profile with `PATCH /v1/profile` at expected revision 0.
6. Confirmed the service returned revision 1 and the app cleared its pending-upload flag.
7. Terminated and relaunched the app without callback or fixture arguments.
8. Confirmed Keychain restoration succeeded and profile reconciliation returned `alreadyCurrent` without a duplicate update.

The first run's non-sensitive Debug probes reported:

```json
{"email":"rhea.sync@example.test","state":"authenticated"}
{"action":"uploadedLocal","localRevision":1,"state":"synced"}
```

The clean relaunch reported:

```json
{"action":"alreadyCurrent","localRevision":1,"state":"synced"}
```

## Regression found and fixed

The first real run found that an account without a profile returned an empty `200` response. The client correctly retained a pending local copy because an empty body is not the documented JSON representation. The service now returns JSON `null`; the HTTP test suite covers this case.

All launch fixtures and probe files are compiled only in Debug builds. Release builds contain neither the injected profile nor the probe behavior.
