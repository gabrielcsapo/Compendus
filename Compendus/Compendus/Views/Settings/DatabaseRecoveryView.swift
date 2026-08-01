import SwiftUI

struct DatabaseRecoveryView: View {
    let errorMessage: String

    @State private var showingArchiveConfirmation = false
    @State private var archivedLocation: URL?
    @State private var archiveError: String?

    private var storeURL: URL {
        URL.applicationSupportDirectory.appending(path: "default.store")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    Image(systemName: "externaldrive.badge.exclamationmark")
                        .font(.system(size: 52))
                        .foregroundStyle(.orange)
                    Text("Your Offline Library Is Preserved")
                        .font(.title2.bold())
                    Text("Compendus could not open its catalog, so it did not delete or modify the database or downloaded books.")
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)

                    if FileManager.default.fileExists(atPath: storeURL.path) {
                        ShareLink(item: storeURL) {
                            Label("Export Database for Recovery", systemImage: "square.and.arrow.up")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                    }

                    Button("Archive Catalog and Start Fresh", role: .destructive) {
                        showingArchiveConfirmation = true
                    }
                    .buttonStyle(.bordered)

                    if let archivedLocation {
                        Text("Catalog archived at \(archivedLocation.lastPathComponent). Close and reopen Compendus to create a fresh catalog. Your downloaded files remain in place.")
                            .font(.callout)
                            .foregroundStyle(.green)
                    }
                    if let archiveError {
                        Text(archiveError).font(.callout).foregroundStyle(.red)
                    }

                    DisclosureGroup("Technical Details") {
                        Text(errorMessage)
                            .font(.caption.monospaced())
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.top, 8)
                    }
                }
                .padding(24)
            }
            .navigationTitle("Catalog Recovery")
            .confirmationDialog(
                "Archive the unreadable catalog?",
                isPresented: $showingArchiveConfirmation,
                titleVisibility: .visible
            ) {
                Button("Archive Catalog", role: .destructive) { archiveStore() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("The database will be moved to a recoverable backup folder, never deleted. Downloaded books are not moved.")
            }
        }
    }

    private func archiveStore() {
        do {
            let fm = FileManager.default
            let formatter = ISO8601DateFormatter()
            let stamp = formatter.string(from: Date()).replacingOccurrences(of: ":", with: "-")
            let backup = URL.applicationSupportDirectory
                .appending(path: "Database Backups", directoryHint: .isDirectory)
                .appending(path: stamp, directoryHint: .isDirectory)
            try fm.createDirectory(at: backup, withIntermediateDirectories: true)
            for suffix in ["", "-shm", "-wal"] {
                let source = URL(fileURLWithPath: storeURL.path + suffix)
                guard fm.fileExists(atPath: source.path) else { continue }
                try fm.moveItem(at: source, to: backup.appending(path: source.lastPathComponent))
            }
            archivedLocation = backup
            archiveError = nil
        } catch {
            archiveError = "The catalog could not be archived: \(error.localizedDescription)"
        }
    }
}
