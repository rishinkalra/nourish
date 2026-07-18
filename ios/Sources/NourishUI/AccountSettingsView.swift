import SwiftUI

struct DeleteAccountView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var accountStore: AccountLifecycleStore
    @EnvironmentObject private var authenticationStore: AuthenticationStore
    @EnvironmentObject private var profileStore: AppProfileStore
    @EnvironmentObject private var weeklyLoopStore: ActiveWeeklyLoopStore
    @EnvironmentObject private var planGenerationStore: PlanGenerationStore
    @EnvironmentObject private var reminderStore: LifecycleReminderStore
    @State private var confirmation = ""
    @State private var reason = ""
    @State private var isDeleting = false
    @State private var message: String?
    let onDeleted: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("Before you delete") {
                    Label("All Nourish sessions will be invalidated immediately.", systemImage: "lock.slash")
                    Label("Scheduled Nourish notifications will be cancelled on this device.", systemImage: "bell.slash")
                    Label("Your server data will enter the deletion queue.", systemImage: "trash")
                    Text("Deleting Nourish does not cancel an App Store subscription. Manage or cancel the subscription separately through Apple.")
                        .font(.footnote.bold())
                        .foregroundStyle(.red)
                }
                Section("Optional reason") {
                    TextField("Why are you leaving?", text: $reason, axis: .vertical)
                        .lineLimit(2...5)
                }
                Section("Permanent confirmation") {
                    Text("Type DELETE to continue.")
                    TextField("DELETE", text: $confirmation)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("delete-account.confirmation")
                    Button("Permanently delete account", role: .destructive, action: deleteAccount)
                        .disabled(confirmation != "DELETE" || isDeleting)
                        .accessibilityIdentifier("delete-account.submit")
                    if isDeleting { ProgressView("Disabling account and clearing this device…") }
                    if let message { localizedRuntimeMessage(message).font(.footnote).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Delete account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .interactiveDismissDisabled(isDeleting)
        }
    }

    private func deleteAccount() {
        isDeleting = true
        message = nil
        Task {
            guard await accountStore.deleteAccount(reason: reason) else {
                message = accountStore.failureMessage ?? "Deletion could not be confirmed."
                isDeleting = false
                return
            }
            await reminderStore.cancelAll()
            await weeklyLoopStore.clearForAccountDeletion()
            planGenerationStore.clearForAccountDeletion()
            await profileStore.clearForAccountDeletion()
            await authenticationStore.signOut()
            isDeleting = false
            dismiss()
            onDeleted()
        }
    }
}

struct SupportRequestView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var includesDiagnostics = false

    var body: some View {
        NavigationStack {
            Form {
                Section("How support works") {
                    Text("Describe the issue in your preferred mail or messaging app. Do not include passwords, sign-in links, health records, or payment details.")
                    Text("The final launch support address and service-level policy are not configured in this development build.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("Diagnostic context") {
                    Toggle("Include anonymized app diagnostics", isOn: $includesDiagnostics)
                        .accessibilityIdentifier("support.diagnostics")
                    Text("Diagnostics contain only app version, operating-system version, and build channel. They never include email, internal user ID, meal history, profile answers, or authentication tokens.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section {
                    ShareLink(item: supportText) {
                        Label("Create support request", systemImage: "square.and.arrow.up")
                    }
                    .accessibilityIdentifier("support.create")
                } footer: {
                    if includesDiagnostics {
                        Text("You confirmed that anonymized diagnostics may be attached.")
                    } else {
                        Text("No diagnostic context will be attached.")
                    }
                }
            }
            .navigationTitle("Support")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .accessibilityIdentifier("support.done")
                }
            }
        }
    }

    private var supportText: String {
        var text = "Nourish support request\n\nWhat happened:\n\nWhat I expected:\n"
        if includesDiagnostics {
            let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
            let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"
            text += "\nConfirmed anonymized diagnostics:\nApp version: \(version) (\(build))\nOS: \(ProcessInfo.processInfo.operatingSystemVersionString)\nChannel: \(_isDebugAssertConfiguration() ? "development" : "release")\n"
        }
        return text
    }
}

struct LegalInformationView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                legalSection("Privacy summary", icon: "hand.raised") {
                    Text("Nourish stores account identity, planning preferences, adopted plans, grocery and prep state, feedback, subscription state, and security/audit records needed to operate the service. Sensitive tokens stay in Keychain. Export and deletion are available in-app. Nourish does not sell personal data.")
                    Text("Processor list, retention periods, cross-border basis, grievance contact, and counsel-approved launch policy remain pending business decisions.")
                        .foregroundStyle(.secondary)
                }
                legalSection("Terms summary", icon: "doc.text") {
                    Text("Nourish is for adults using meal organization for general wellness. It is not medical advice, diagnosis, or treatment. Users remain responsible for checking ingredients, allergens, food condition, and suitability.")
                    Text("Final commercial terms, governing law, pricing, trials, and dispute language require approval before release.")
                        .foregroundStyle(.secondary)
                }
                legalSection("Wellness disclaimer", icon: "heart.text.square") {
                    Text("Nutrition values and targets are estimates. Do not use Nourish for pregnancy, eating-disorder care, kidney disease, diabetes treatment, therapeutic diets, or another condition requiring individualized clinical advice without a qualified professional.")
                }
                legalSection("Nutrition-data methodology", icon: "scalemass") {
                    Text("Ingredient quantities retain household units and grams. Nutrients are calculated from versioned per-100g source records, serving multipliers, and immutable recipe snapshots. Production plans require licensed evidence and separate nutrition review.")
                }
            }
            .navigationTitle("Legal & wellness")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .accessibilityIdentifier("legal.done")
                }
            }
        }
    }

    private func legalSection<Content: View>(
        _ title: LocalizedStringKey,
        icon: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        Section {
            Label(title, systemImage: icon)
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            content().font(.footnote)
        }
    }
}
