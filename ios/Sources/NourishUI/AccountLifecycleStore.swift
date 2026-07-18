import Foundation
import NourishAPI
import StoreKit

@MainActor
final class AccountLifecycleStore: ObservableObject {
    enum State: Equatable {
        case signedOut
        case loading
        case ready
        case requestingExport
        case deleting
        case failed(String)
    }

    @Published private(set) var state: State = .signedOut
    @Published private(set) var entitlement: EntitlementSnapshot?
    @Published private(set) var exportReceipt: AccountExportReceipt?
    @Published private(set) var deletionReceipt: AccountDeletionReceipt?

    private var userID: String?
    private var remote: (any AccountRemote)?
    private var transactionUpdatesTask: Task<Void, Never>?
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func connect(userID: String, remote: any AccountRemote) async {
        self.userID = userID
        self.remote = remote
        state = .loading
        startTransactionUpdates()
        await refreshEntitlement()
    }

    func disconnect() {
        userID = nil
        remote = nil
        transactionUpdatesTask?.cancel()
        transactionUpdatesTask = nil
        entitlement = nil
        exportReceipt = nil
        deletionReceipt = nil
        state = .signedOut
    }

    func refreshEntitlement() async {
        guard let remote else { state = .signedOut; return }
        do {
            entitlement = try await remote.readEntitlement()
            state = .ready
        } catch let error as APIErrorEnvelope {
            state = .failed(error.userSafeMessage)
        } catch {
            state = .failed("Subscription status could not be refreshed. Existing server access is unchanged.")
        }
    }

    func prepareAppStorePurchase() async throws -> UUID {
        guard let remote else { throw AccountLifecycleError.signedOut }
        return try await remote.issueAppStoreAccountToken().appAccountToken
    }

    func bindAppStoreTransaction(signedTransactionInfo: String) async throws {
        guard let remote else { throw AccountLifecycleError.signedOut }
        entitlement = try await remote.bindAppStoreTransaction(signedTransactionInfo: signedTransactionInfo)
        state = .ready
    }

    func requestExport() async -> Bool {
        guard let remote, let userID else { return false }
        state = .requestingExport
        let keyName = exportKey(userID)
        let idempotencyKey = defaults.string(forKey: keyName) ?? UUID().uuidString
        defaults.set(idempotencyKey, forKey: keyName)
        do {
            exportReceipt = try await remote.requestExport(idempotencyKey: idempotencyKey)
            defaults.removeObject(forKey: keyName)
            state = .ready
            return true
        } catch let error as APIErrorEnvelope {
            state = .failed(error.userSafeMessage)
            return false
        } catch {
            state = .failed("The export request was not confirmed. You can safely retry.")
            return false
        }
    }

    func deleteAccount(reason: String?) async -> Bool {
        guard let remote, let userID else { return false }
        state = .deleting
        let keyName = deletionKey(userID)
        let idempotencyKey = defaults.string(forKey: keyName) ?? UUID().uuidString
        defaults.set(idempotencyKey, forKey: keyName)
        do {
            deletionReceipt = try await remote.deleteAccount(
                AccountDeletionRequest(
                    acknowledgement: "DELETE",
                    reason: reason?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
                ),
                idempotencyKey: idempotencyKey
            )
            defaults.removeObject(forKey: keyName)
            state = .ready
            return true
        } catch let error as APIErrorEnvelope {
            state = .failed(error.userSafeMessage)
            return false
        } catch {
            state = .failed("Deletion was not confirmed. Your account remains available; please retry.")
            return false
        }
    }

    var failureMessage: String? {
        guard case let .failed(message) = state else { return nil }
        return message
    }

    private func startTransactionUpdates() {
        transactionUpdatesTask?.cancel()
        transactionUpdatesTask = Task { [weak self] in
            for await result in Transaction.updates {
                guard !Task.isCancelled, let self, case let .verified(transaction) = result else { continue }
                do {
                    try await self.bindAppStoreTransaction(signedTransactionInfo: result.jwsRepresentation)
                    await transaction.finish()
                } catch {
                    // Keep the transaction unfinished so StoreKit can deliver it again after server recovery.
                }
            }
        }
    }

    private func exportKey(_ userID: String) -> String { "nourish.account.export.\(userID)" }
    private func deletionKey(_ userID: String) -> String { "nourish.account.delete.\(userID)" }
}

private enum AccountLifecycleError: Error {
    case signedOut
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
