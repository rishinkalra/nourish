import NourishAPI
import StoreKit
import SwiftUI

@MainActor
struct SubscriptionPurchaseView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var analyticsEventStore: AnalyticsEventStore
    @EnvironmentObject private var featureFlagStore: FeatureFlagStore
    @ObservedObject var accountStore: AccountLifecycleStore
    @State private var products: [Product] = []
    @State private var isLoading = true
    @State private var purchasingProductID: String?
    @State private var message: String?
    @State private var recordedPaywall = false

    private var configuredProductIDs: [String] {
        (Bundle.main.object(forInfoDictionaryKey: "NourishSubscriptionProductIDs") as? [String] ?? [])
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    private var presentation: PaywallPresentation? {
        featureFlagStore.flags.paywallPresentation
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if let headline = presentation?.headline {
                        Text(verbatim: headline).font(.headline)
                    }
                    if let disclosure = presentation?.disclosure {
                        Text(verbatim: disclosure)
                            .font(.subheadline)
                            .accessibilityIdentifier("paywall.disclosure")
                    } else {
                        Text("Choose the plan that fits your routine. Apple shows the final local price, billing period, trial terms, and renewal details before purchase.")
                            .font(.subheadline)
                            .accessibilityIdentifier("paywall.disclosure")
                    }
                    if let trialMessage = presentation?.trialMessage {
                        Label {
                            Text(verbatim: trialMessage)
                        } icon: {
                            Image(systemName: "calendar.badge.clock")
                        }
                    }
                    Label("Cancel any time in App Store subscription settings", systemImage: "checkmark.circle")
                    Label("Your meal history never changes your price", systemImage: "lock.shield")
                }

                Section("Plans") {
                    if isLoading {
                        HStack { Spacer(); ProgressView("Loading App Store plans…"); Spacer() }
                    } else if configuredProductIDs.isEmpty {
                        ContentUnavailableView(
                            "Subscriptions not configured",
                            systemImage: "shippingbox",
                            description: Text("Add the approved App Store product identifiers before testing purchases.")
                        )
                    } else if products.isEmpty {
                        ContentUnavailableView(
                            "Plans unavailable",
                            systemImage: "wifi.exclamationmark",
                            description: Text("The App Store did not return the configured plans. Please try again later.")
                        )
                    } else {
                        ForEach(products, id: \.id) { product in
                            Button {
                                Task { await purchase(product) }
                            } label: {
                                HStack(alignment: .center, spacing: 12) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(verbatim: product.displayName).font(.headline)
                                        Text(verbatim: product.description).font(.footnote).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if purchasingProductID == product.id {
                                        ProgressView()
                                    } else {
                                        Text(verbatim: product.displayPrice).font(.headline)
                                    }
                                }
                            }
                            .disabled(purchasingProductID != nil)
                        }
                    }
                }

                if let message {
                    Section { localizedRuntimeMessage(message).font(.footnote).foregroundStyle(.secondary) }
                }
            }
            .navigationTitle("Nourish membership")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                        .accessibilityIdentifier("paywall.close")
                }
            }
            .task {
                await loadProducts()
                guard !recordedPaywall else { return }
                recordedPaywall = await analyticsEventStore.record(
                    .paywallViewed,
                    properties: [
                        "placement": .string("profile_settings"),
                        "products": .strings(products.map(\.id)),
                    ]
                )
            }
        }
    }

    private func loadProducts() async {
        defer { isLoading = false }
        guard !configuredProductIDs.isEmpty else { return }
        do {
            let order = presentation?.productOrder ?? []
            products = try await Product.products(for: configuredProductIDs)
                .filter { $0.type == .autoRenewable }
                .sorted { left, right in
                    let leftIndex = order.firstIndex(of: left.id)
                    let rightIndex = order.firstIndex(of: right.id)
                    switch (leftIndex, rightIndex) {
                    case let (.some(left), .some(right)): return left < right
                    case (.some, .none): return true
                    case (.none, .some): return false
                    case (.none, .none): return left.price < right.price
                    }
                }
        } catch {
            message = "App Store plans could not be loaded. No purchase was started."
        }
    }

    private func purchase(_ product: Product) async {
        purchasingProductID = product.id
        defer { purchasingProductID = nil }
        do {
            let token = try await accountStore.prepareAppStorePurchase()
            let result = try await product.purchase(options: [.appAccountToken(token)])
            switch result {
            case let .success(verification):
                guard case let .verified(transaction) = verification else {
                    message = "Apple could not verify this transaction. No Nourish access was changed."
                    return
                }
                try await accountStore.bindAppStoreTransaction(signedTransactionInfo: verification.jwsRepresentation)
                await transaction.finish()
                message = "Purchase verified. Your Nourish access is now linked to this account."
            case .pending:
                message = "The purchase is awaiting approval. Access will update after Apple confirms it."
            case .userCancelled:
                message = "Purchase cancelled."
            @unknown default:
                message = "The App Store returned an unknown purchase result. No access was changed."
            }
        } catch {
            message = "The purchase could not be verified by the Nourish server. Existing access is unchanged."
        }
    }
}
