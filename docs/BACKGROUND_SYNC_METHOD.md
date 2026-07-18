# Background and offline synchronization

## Local-first boundary

The current adopted weekly plan, embedded immutable recipe snapshots, grocery list, prep timeline, and operational state are stored together in a protected per-user document. Profile changes use a separate protected document and pending-upload marker. A grocery, meal, prep, or profile edit is persisted before any network call, so closing the app or losing connectivity does not discard the user's latest accepted action.

Weekly-loop mutations carry a stable mutation ID, base/result revision, timestamp, and typed payload. The replay engine sends them in revision order, updates remote revision tokens after every acknowledgement, and removes only acknowledged journal entries. The backend contract applies optimistic revisions and idempotent mutation boundaries. Safe swaps remain deliberately online because they require whole-plan safety revalidation.

## Retry lifecycle

The app registers `com.projectnourish.app.sync` at launch through `BGTaskScheduler` and declares that identifier plus background fetch in the application Info.plist. A task delivered during cold launch is retained until the SwiftUI synchronization operation is attached. Pending profile or weekly-loop state submits one `BGAppRefreshTaskRequest`. Returning to the foreground also triggers synchronization immediately.

The earliest background retry starts at 15 minutes and doubles to a six-hour cap. A successful run resets the attempt counter and cancels the scheduled request. A transient failure retains the exact local journal and schedules another attempt. Task expiration cancels the in-flight Swift task and reports unsuccessful completion to iOS.

## Conflict behavior

Revision conflicts never silently apply last-write-wins. Weekly-loop conflicts become a visible review-needed state and stop automatic background retry. Profile conflicts retain the local pending edit and may retry after reading the latest server revision. The production PostgreSQL adapter must enforce the same compare-and-set boundary inside a transaction.

## Release boundary

The retry policy and registration compile in Debug and Release, the built app contains the permitted identifier and background-fetch declaration, and the simulator launch has no registration errors. iOS controls actual execution time. Release QA must still cover physical devices, low-power mode, poor connectivity, Background App Refresh disabled, force-quit behavior, protected-data availability, long offline periods, multiple-device conflicts, and energy/network budgets.
