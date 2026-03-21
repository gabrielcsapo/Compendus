//
//  DataMigrationView.swift
//  Compendus
//
//  Onboarding view for assigning existing local data (downloaded books,
//  highlights, bookmarks, reading sessions) to the currently selected profile.
//  Shown when SwiftData records with empty profileId exist after profile selection.
//

import SwiftUI
import SwiftData
import EPUBReader

struct DataMigrationView: View {
    @Environment(ServerConfig.self) private var serverConfig
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var bookCount = 0
    @State private var highlightCount = 0
    @State private var bookmarkCount = 0
    @State private var sessionCount = 0
    @State private var pendingDownloadCount = 0
    @State private var pendingEditCount = 0
    @State private var isMigrating = false
    @State private var didFinishMigration = false

    private var totalCount: Int {
        bookCount + highlightCount + bookmarkCount + sessionCount + pendingDownloadCount + pendingEditCount
    }

    private var profileName: String {
        serverConfig.selectedProfileName ?? "Current Profile"
    }

    var body: some View {
        VStack(spacing: Spacing.xxl) {
            Spacer()

            // Icon
            ZStack {
                Circle()
                    .fill(Color.accentColor.opacity(Opacity.light))
                    .frame(width: 120, height: 120)

                Image(systemName: "tray.and.arrow.down.fill")
                    .font(.system(size: 50))
                    .foregroundStyle(.accent)
                    .symbolRenderingMode(.hierarchical)
            }

            // Title and description
            VStack(spacing: Spacing.sm) {
                Text("Data Migration")
                    .font(.title)
                    .fontWeight(.bold)

                Text("You have existing reading data on this device that needs to be assigned to your profile.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, Spacing.xxxl)

            // Item counts
            if totalCount > 0 {
                VStack(spacing: 0) {
                    if bookCount > 0 {
                        migrationRow(icon: "book.closed.fill", label: "Downloaded Books", count: bookCount)
                    }
                    if highlightCount > 0 {
                        migrationRow(icon: "highlighter", label: "Highlights", count: highlightCount)
                    }
                    if bookmarkCount > 0 {
                        migrationRow(icon: "bookmark.fill", label: "Bookmarks", count: bookmarkCount)
                    }
                    if sessionCount > 0 {
                        migrationRow(icon: "clock.fill", label: "Reading Sessions", count: sessionCount)
                    }
                    if pendingDownloadCount > 0 {
                        migrationRow(icon: "arrow.down.circle.fill", label: "Pending Downloads", count: pendingDownloadCount)
                    }
                    if pendingEditCount > 0 {
                        migrationRow(icon: "pencil.circle.fill", label: "Pending Edits", count: pendingEditCount)
                    }
                }
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.sm)
                .background(.ultraThinMaterial)
                .clipShape(RoundedRectangle(cornerRadius: Radius.large))
                .padding(.horizontal, Spacing.xl)
            }

            Spacer()

            // Action buttons
            VStack(spacing: Spacing.lg) {
                Button {
                    Task { await migrateData() }
                } label: {
                    HStack(spacing: Spacing.sm) {
                        if isMigrating {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        }
                        Text(isMigrating ? "Migrating..." : "Assign to \(profileName)")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Spacing.md)
                }
                .buttonStyle(.borderedProminent)
                .disabled(isMigrating || totalCount == 0)

                Button("Skip") {
                    dismiss()
                }
                .foregroundStyle(.secondary)
                .disabled(isMigrating)
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.bottom, Spacing.xxxl)
        }
        .interactiveDismissDisabled(isMigrating)
        .task {
            await loadCounts()
        }
    }

    // MARK: - Row

    private func migrationRow(icon: String, label: String, count: Int) -> some View {
        HStack {
            Image(systemName: icon)
                .foregroundStyle(.accent)
                .frame(width: 28)

            Text(label)
                .font(.subheadline)

            Spacer()

            Text("\(count)")
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.md)
    }

    // MARK: - Data Loading

    private func loadCounts() async {
        let bookDescriptor = FetchDescriptor<DownloadedBook>(predicate: #Predicate { $0.profileId == "" })
        let highlightDescriptor = FetchDescriptor<BookHighlight>(predicate: #Predicate { $0.profileId == "" })
        let bookmarkDescriptor = FetchDescriptor<BookBookmark>(predicate: #Predicate { $0.profileId == "" })
        let sessionDescriptor = FetchDescriptor<ReadingSession>(predicate: #Predicate { $0.profileId == "" })
        let pendingDownloadDescriptor = FetchDescriptor<PendingDownload>(predicate: #Predicate { $0.profileId == "" })
        let pendingEditDescriptor = FetchDescriptor<PendingBookEdit>(predicate: #Predicate { $0.profileId == "" })

        bookCount = (try? modelContext.fetchCount(bookDescriptor)) ?? 0
        highlightCount = (try? modelContext.fetchCount(highlightDescriptor)) ?? 0
        bookmarkCount = (try? modelContext.fetchCount(bookmarkDescriptor)) ?? 0
        sessionCount = (try? modelContext.fetchCount(sessionDescriptor)) ?? 0
        pendingDownloadCount = (try? modelContext.fetchCount(pendingDownloadDescriptor)) ?? 0
        pendingEditCount = (try? modelContext.fetchCount(pendingEditDescriptor)) ?? 0
    }

    // MARK: - Migration

    private func migrateData() async {
        isMigrating = true

        let profileId = serverConfig.selectedProfileId ?? ""

        // Migrate DownloadedBook records
        let bookDescriptor = FetchDescriptor<DownloadedBook>(predicate: #Predicate { $0.profileId == "" })
        if let books = try? modelContext.fetch(bookDescriptor) {
            for book in books {
                book.profileId = profileId
            }
        }

        // Migrate BookHighlight records
        let highlightDescriptor = FetchDescriptor<BookHighlight>(predicate: #Predicate { $0.profileId == "" })
        if let highlights = try? modelContext.fetch(highlightDescriptor) {
            for highlight in highlights {
                highlight.profileId = profileId
            }
        }

        // Migrate BookBookmark records
        let bookmarkDescriptor = FetchDescriptor<BookBookmark>(predicate: #Predicate { $0.profileId == "" })
        if let bookmarks = try? modelContext.fetch(bookmarkDescriptor) {
            for bookmark in bookmarks {
                bookmark.profileId = profileId
            }
        }

        // Migrate ReadingSession records
        let sessionDescriptor = FetchDescriptor<ReadingSession>(predicate: #Predicate { $0.profileId == "" })
        if let sessions = try? modelContext.fetch(sessionDescriptor) {
            for session in sessions {
                session.profileId = profileId
            }
        }

        // Migrate PendingDownload records
        let pendingDownloadDescriptor = FetchDescriptor<PendingDownload>(predicate: #Predicate { $0.profileId == "" })
        if let pendingDownloads = try? modelContext.fetch(pendingDownloadDescriptor) {
            for pending in pendingDownloads {
                pending.profileId = profileId
            }
        }

        // Migrate PendingBookEdit records
        let pendingEditDescriptor = FetchDescriptor<PendingBookEdit>(predicate: #Predicate { $0.profileId == "" })
        if let pendingEdits = try? modelContext.fetch(pendingEditDescriptor) {
            for edit in pendingEdits {
                edit.profileId = profileId
            }
        }

        try? modelContext.save()

        isMigrating = false
        dismiss()
    }
}

#Preview {
    DataMigrationView()
        .environment(ServerConfig())
        .modelContainer(for: [
            DownloadedBook.self,
            BookHighlight.self,
            BookBookmark.self,
            ReadingSession.self,
            PendingDownload.self,
            PendingBookEdit.self,
        ], inMemory: true)
}
