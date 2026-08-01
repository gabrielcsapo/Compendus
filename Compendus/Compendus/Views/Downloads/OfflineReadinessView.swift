import SwiftUI
import SwiftData

struct OfflineReadinessCard: View {
    let books: [DownloadedBook]

    @Environment(DownloadManager.self) private var downloadManager
    @Environment(ServerConfig.self) private var serverConfig
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \PendingDownload.queuedAt, order: .reverse)
    private var allPendingDownloads: [PendingDownload]
    @State private var showingDetails = false
    @State private var repairingBookIds: Set<String> = []
    @State private var repairError: String?

    private var verified: Int { books.filter { $0.verificationStatus == "verified" }.count }
    private var failures: [DownloadedBook] {
        books.filter { $0.verificationStatus == "missing" || $0.verificationStatus == "corrupt" }
    }
    private var incompleteTransfers: [PendingDownload] {
        let profileId = serverConfig.selectedProfileId ?? ""
        return allPendingDownloads.filter {
            ($0.profileId == profileId || $0.profileId.isEmpty) && $0.status != "completed"
        }
    }
    private var isReady: Bool {
        !books.isEmpty && verified == books.count && failures.isEmpty && incompleteTransfers.isEmpty
    }
    private var oldestVerification: Date? { books.compactMap(\.verifiedAt).min() }

    var body: some View {
        Button { showingDetails = true } label: {
            HStack(spacing: 12) {
                Image(systemName: isReady ? "checkmark.shield.fill" : "exclamationmark.shield.fill")
                    .font(.title2)
                    .foregroundStyle(isReady ? .green : .orange)
                VStack(alignment: .leading, spacing: 3) {
                    Text(isReady ? "Offline Ready" : "Verify Offline Library")
                        .font(.headline)
                        .foregroundStyle(.primary)
                    Text(downloadManager.isVerifyingLibrary
                         ? "Checking \(downloadManager.verificationCompleted) of \(downloadManager.verificationTotal)…"
                         : readinessSubtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if downloadManager.isVerifyingLibrary {
                    ProgressView()
                } else {
                    Image(systemName: "chevron.right").foregroundStyle(.tertiary)
                }
            }
            .padding(14)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 20)
        .sheet(isPresented: $showingDetails) {
            NavigationStack {
                List {
                    Section {
                        LabeledContent("Downloaded", value: "\(books.count)")
                        LabeledContent("Verified", value: "\(verified)")
                        LabeledContent("Needs attention", value: "\(failures.count)")
                        LabeledContent("Incomplete transfers", value: "\(incompleteTransfers.count)")
                        if let oldestVerification {
                            LabeledContent("Oldest check", value: oldestVerification.formatted(date: .abbreviated, time: .shortened))
                        }
                    } footer: {
                        Text("Verification is entirely local: file size, SHA-256, archive structure, CCD manifest, and referenced resources.")
                    }
                    if !failures.isEmpty {
                        Section("Needs Attention") {
                            ForEach(failures) { book in
                                HStack {
                                    Label(book.title, systemImage: book.verificationStatus == "missing" ? "doc.questionmark" : "xmark.octagon")
                                    Spacer()
                                    Button(repairingBookIds.contains(book.id) ? "Repairing…" : "Repair") {
                                        repair(book)
                                    }
                                    .buttonStyle(.bordered)
                                    .disabled(repairingBookIds.contains(book.id) || !ConnectivityMonitor.shared.permitsNetworkRequests)
                                }
                            }
                        }
                    }
                    if !incompleteTransfers.isEmpty {
                        Section {
                            ForEach(incompleteTransfers) { pending in
                                LabeledContent(pending.title, value: pending.status.capitalized)
                            }
                        } header: {
                            Text("Incomplete Transfers")
                        } footer: {
                            Text("Finish, retry, or cancel every transfer before relying on this device offline.")
                        }
                    }
                    if let repairError {
                        Section {
                            Label(repairError, systemImage: "exclamationmark.triangle")
                                .foregroundStyle(.red)
                        }
                    }
                    Section {
                        Button {
                            Task { await downloadManager.verifyAllDownloads(modelContext: modelContext) }
                        } label: {
                            Label(downloadManager.isVerifyingLibrary ? "Verifying…" : "Verify All Now", systemImage: "checkmark.shield")
                        }
                        .disabled(downloadManager.isVerifyingLibrary || books.isEmpty)
                    }
                }
                .navigationTitle("Offline Ready")
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { showingDetails = false }
                    }
                }
            }
        }
    }

    private var readinessSubtitle: String {
        if !incompleteTransfers.isEmpty {
            return "\(incompleteTransfers.count) transfer\(incompleteTransfers.count == 1 ? "" : "s") still incomplete"
        }
        if let oldestVerification, verified == books.count {
            return "\(verified) verified · checked \(oldestVerification.formatted(.relative(presentation: .named)))"
        }
        return "\(verified) of \(books.count) verified on this device"
    }

    private func repair(_ book: DownloadedBook) {
        repairError = nil
        repairingBookIds.insert(book.id)
        Task { @MainActor in
            defer { repairingBookIds.remove(book.id) }
            do {
                if book.epubLocalPath != nil, book.epubVerificationStatus != "verified" {
                    try await downloadManager.downloadEpubVersion(bookId: book.id, modelContext: modelContext)
                    await downloadManager.verifyAllDownloads(modelContext: modelContext)
                } else {
                    try await downloadManager.repairDownload(book, modelContext: modelContext)
                }
            } catch {
                repairError = error.localizedDescription
            }
        }
    }
}
