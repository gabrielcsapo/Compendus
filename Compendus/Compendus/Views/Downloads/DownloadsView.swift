//
//  DownloadsView.swift
//  Compendus
//
//  View for managing downloaded books
//

import SwiftUI
import SwiftData
import EPUBReader

enum DownloadFilter: String, CaseIterable {
    case all = "All"
    case ebooks = "Ebooks"
    case audiobooks = "Audiobooks"
    case comics = "Comics"

    var icon: String {
        switch self {
        case .all: return "books.vertical"
        case .ebooks: return "book.closed"
        case .audiobooks: return "headphones"
        case .comics: return "book.pages"
        }
    }

    func matches(format: String) -> Bool {
        let fmt = format.lowercased()
        switch self {
        case .all: return true
        case .ebooks: return ["epub", "pdf", "mobi", "azw", "azw3"].contains(fmt)
        case .audiobooks: return ["m4b", "mp3", "m4a"].contains(fmt)
        case .comics: return ["cbr", "cbz"].contains(fmt)
        }
    }
}

enum DownloadViewMode: String, CaseIterable {
    case books = "Books"
    case series = "Series"

    var icon: String {
        switch self {
        case .books: return "book.closed"
        case .series: return "books.vertical"
        }
    }
}

private struct DownloadSeriesSheet: Identifiable {
    let id: String  // series name
}

struct DownloadsView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(APIService.self) private var apiService
    @Environment(DownloadManager.self) private var downloadManager
    @Environment(StorageManager.self) private var storageManager
    @Environment(AudiobookPlayer.self) private var audiobookPlayer
    @Environment(ReaderSettings.self) private var readerSettings
    @Environment(OnDeviceTranscriptionService.self) private var transcriptionService
    @Environment(ServerConfig.self) private var serverConfig
    @Environment(SyncService.self) private var syncService

    @Query(sort: \DownloadedBook.downloadedAt, order: .reverse)
    private var allBooks: [DownloadedBook]

    @Query(
        filter: #Predicate<DownloadedBook> { $0.lastReadAt != nil },
        sort: \DownloadedBook.lastReadAt,
        order: .reverse
    )
    private var allRecentlyReadBooks: [DownloadedBook]

    @Query(sort: \PendingDownload.queuedAt, order: .reverse)
    private var allPendingDownloads: [PendingDownload]

    private var books: [DownloadedBook] {
        let pid = serverConfig.selectedProfileId ?? ""
        return allBooks.filter { $0.profileId == pid || $0.profileId.isEmpty }
    }

    private var recentlyReadBooks: [DownloadedBook] {
        let pid = serverConfig.selectedProfileId ?? ""
        return allRecentlyReadBooks.filter { $0.profileId == pid || $0.profileId.isEmpty }
    }

    private var pendingDownloads: [PendingDownload] {
        let pid = serverConfig.selectedProfileId ?? ""
        return allPendingDownloads.filter { $0.profileId == pid || $0.profileId.isEmpty }
    }

    @State private var bookToDelete: DownloadedBook?
    @State private var showingDeleteConfirmation = false
    @State private var searchText = ""
    @State private var selectedChipId: String = "all"

    @State private var bookToRead: DownloadedBook?
    @State private var seriesSheet: DownloadSeriesSheet? = nil
    @State private var showingDeleteError = false
    @State private var deleteError: String?
    @State private var navigationPath = NavigationPath()
    @State private var selectedRemoteBook: Book? = nil
    @State private var greetingText: String = ""
    @FocusState private var isSearchFocused: Bool

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var effectiveFilter: DownloadFilter {
        switch selectedChipId {
        case "ebooks": return .ebooks
        case "audiobooks": return .audiobooks
        case "comics": return .comics
        default: return .all
        }
    }

    private var isSeriesMode: Bool { selectedChipId == "series" }

    private var homeChips: [FilterChip] {
        [
            FilterChip(id: "all", label: "All", systemImage: nil),
            FilterChip(id: "ebooks", label: "Ebooks", systemImage: "book.closed"),
            FilterChip(id: "audiobooks", label: "Audiobooks", systemImage: "headphones"),
            FilterChip(id: "comics", label: "Comics", systemImage: "book.pages"),
            FilterChip(id: "series", label: "Series", systemImage: "books.vertical"),
        ]
    }

    private var columns: [GridItem] {
        let count = horizontalSizeClass == .compact ? 2 : 4
        return Array(repeating: GridItem(.flexible(), spacing: 16), count: count)
    }

    @State private var cachedFilteredBooks: [DownloadedBook] = []
    @State private var cachedSeriesItems: [DownloadedSeriesItem] = []

    private var filteredSeriesItems: [DownloadedSeriesItem] {
        if searchText.isEmpty {
            return cachedSeriesItems
        }
        return cachedSeriesItems.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
    }

    /// Pending downloads that are still active (not yet completed as DownloadedBook)
    private var activePendingDownloads: [PendingDownload] {
        pendingDownloads.filter { $0.status != "completed" }
    }

    private var hasActiveDownloads: Bool {
        !activePendingDownloads.isEmpty || !downloadManager.activeDownloads.isEmpty
    }

    /// Merge local recently-read books with remote books that have progress but aren't downloaded
    private var continueReadingItems: [ContinueReadingItem] {
        let localIds = Set(recentlyReadBooks.map(\.id))

        let localItems = recentlyReadBooks.map { ContinueReadingItem.downloaded($0) }

        let remoteItems = syncService.remoteBooksWithProgress
            .filter { !localIds.contains($0.id) }
            .map { ContinueReadingItem.remote($0) }

        return (localItems + remoteItems)
            .sorted { ($0.lastReadAt ?? .distantPast) > ($1.lastReadAt ?? .distantPast) }
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            mainContent
                .toolbar(.hidden, for: .navigationBar)
                .safeAreaInset(edge: .top, spacing: 0) {
                    VStack(spacing: 0) {
                        HStack(spacing: 8) {
                            Image(systemName: "magnifyingglass")
                                .foregroundStyle(.secondary)
                                .font(.subheadline)
                            TextField(searchPrompt, text: $searchText)
                                .textFieldStyle(.plain)
                                .font(.subheadline)
                                .submitLabel(.search)
                                .focused($isSearchFocused)
                            if !searchText.isEmpty || isSearchFocused {
                                Button("Cancel") {
                                    searchText = ""
                                    isSearchFocused = false
                                }
                                .font(.subheadline)
                                .transition(.move(edge: .trailing).combined(with: .opacity))
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Color(.secondarySystemFill))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .animation(.easeInOut(duration: 0.2), value: isSearchFocused || !searchText.isEmpty)

                        if downloadManager.isSyncingMetadata {
                            HStack(spacing: 4) {
                                ProgressView().controlSize(.mini)
                                Text("Syncing...").font(.caption2).foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 20)
                            .padding(.top, 4)
                        }

                        FilterChipBar(chips: homeChips, selectedId: $selectedChipId)
                            .padding(.vertical, 4)
                        Divider()
                    }
                    .background(.ultraThinMaterial)
                }
                .navigationDestination(for: DownloadedBook.self) { book in
                    DownloadedBookDetailView(book: book) { seriesName in
                        seriesSheet = DownloadSeriesSheet(id: seriesName)
                    }
                }
                .confirmationDialog(
                    deleteDialogTitle,
                    isPresented: $showingDeleteConfirmation,
                    titleVisibility: .visible
                ) {
                    Button("Delete", role: .destructive) {
                        performDelete()
                    }
                    Button("Cancel", role: .cancel) {
                        bookToDelete = nil
                    }
                } message: {
                    Text(deleteDialogMessage)
                }
                .fullScreenCover(item: $bookToRead) { book in
                    ReaderContainerView(book: book)
                        .environment(readerSettings)
                }
                .sheet(item: $seriesSheet) { sheet in
                    DownloadedSeriesDetailView(seriesName: sheet.id)
                        .presentationDetents([.large])
                        .presentationDragIndicator(.visible)
                }
                .sheet(item: $selectedRemoteBook) { book in
                    BookDetailView(
                        book: book,
                        onRead: { downloaded in
                            if downloaded.isAudiobook {
                                Task {
                                    await audiobookPlayer.loadBook(downloaded)
                                    audiobookPlayer.isFullPlayerPresented = true
                                }
                            } else {
                                bookToRead = downloaded
                            }
                        }
                    )
                }
                .refreshable {
                    await downloadManager.syncDownloadedBooksMetadata(modelContext: modelContext, force: true)
                }
                .task {
                    recomputeFilteredBooks()
                    recomputeSeriesItems()
                    await downloadManager.syncDownloadedBooksMetadata(modelContext: modelContext)
                    // Clean up stale failed download entries on launch
                    downloadManager.cleanupStaleFailedDownloads()
                    // Set greeting
                    let hour = Calendar.current.component(.hour, from: Date())
                    greetingText = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
                }
                .onChange(of: searchText) { _, _ in recomputeFilteredBooks() }
                .onChange(of: selectedChipId) { _, _ in
                    if !isSeriesMode {
                        recomputeFilteredBooks()
                    } else {
                        recomputeSeriesItems()
                    }
                }
                .onChange(of: allBooks.count) { _, _ in
                    recomputeFilteredBooks()
                    recomputeSeriesItems()
                }
                .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
                    // Retry failed downloads when app returns to foreground (network may have recovered)
                    downloadManager.retryFailedDownloads(modelContext: modelContext)
                }
                .alert("Delete Failed", isPresented: $showingDeleteError) {
                    Button("OK", role: .cancel) { }
                } message: {
                    Text(deleteError ?? "An error occurred while deleting the book.")
                }
        }
    }

    // MARK: - Navigation Title

    private var navigationTitle: String {
        "Home"
    }

    private var searchPrompt: String {
        if isSeriesMode {
            return "Search series..."
        }
        return "Search your books..."
    }

    // MARK: - Main Content

    @ViewBuilder
    private var mainContent: some View {
        if books.isEmpty && !hasActiveDownloads && !transcriptionService.isActive && syncService.remoteBooksWithProgress.isEmpty {
            DownloadsEmptyStateView()
        } else if isSeriesMode {
            seriesGridContent
        } else if cachedFilteredBooks.isEmpty && !hasActiveDownloads && !transcriptionService.isActive && syncService.remoteBooksWithProgress.isEmpty {
            filteredEmptyState
        } else {
            booksScrollContent
        }
    }

    @ViewBuilder
    private var filteredEmptyState: some View {
        if !searchText.isEmpty {
            SearchEmptyStateView(query: searchText)
        } else {
            EmptyStateView(
                icon: effectiveFilter.icon,
                title: "No \(effectiveFilter.rawValue)",
                description: "No \(effectiveFilter.rawValue.lowercased()) found in your downloads."
            )
        }
    }

    // MARK: - Series Grid

    @ViewBuilder
    private var seriesGridContent: some View {
        if filteredSeriesItems.isEmpty {
            VStack(spacing: 12) {
                Image(systemName: "books.vertical")
                    .font(.system(size: 40))
                    .foregroundStyle(.secondary)
                Text(searchText.isEmpty ? "No series found" : "No matching series")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                Text(searchText.isEmpty ? "Downloaded books with series metadata will appear here." : "Try a different search term.")
                    .font(.subheadline)
                    .foregroundStyle(.tertiary)
            }
            .padding(.top, 80)
        } else {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(filteredSeriesItems) { series in
                        DownloadedSeriesGridItem(series: series)
                            .onTapGesture {
                                seriesSheet = DownloadSeriesSheet(id: series.name)
                            }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 20)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }

    // MARK: - Books Scroll Content

    private var booksScrollContent: some View {
        ScrollView {
            // Continue Reading section (local + remote books with progress)
            if !continueReadingItems.isEmpty && searchText.isEmpty && effectiveFilter == .all && !isSeriesMode {
                ContinueReadingSection(
                    items: continueReadingItems,
                    onLocalBookTap: { book in
                        if book.isAudiobook {
                            Task {
                                await audiobookPlayer.loadBook(book)
                                audiobookPlayer.isFullPlayerPresented = true
                            }
                        } else {
                            bookToRead = book
                        }
                    },
                    onRemoteBookTap: { book in
                        selectedRemoteBook = book
                    },
                    onMarkAsRead: { book in
                        toggleReadStatus(for: book)
                    },
                    onViewDetails: { book in
                        navigationPath.append(book)
                    }
                )
                .padding(.top, 16)
                .padding(.bottom, 8)
            }

            // Active downloads section
            if hasActiveDownloads {
                activeDownloadsSection
            }

            // Active transcription section
            if transcriptionService.isActive {
                activeTranscriptionSection
            }

            // My Library section header
            if searchText.isEmpty {
                HStack {
                    Text("My Library")
                        .font(.title3).fontWeight(.semibold)
                    Spacer()
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
            }

            LazyVGrid(columns: columns, spacing: 16) {
                ForEach(cachedFilteredBooks) { book in
                    NavigationLink(value: book) {
                        DownloadedBookGridItem(book: book, onSeriesTap: { seriesName in
                            seriesSheet = DownloadSeriesSheet(id: seriesName)
                        })
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button {
                            toggleReadStatus(for: book)
                        } label: {
                            Label(
                                book.isRead ? "Mark as Unread" : "Mark as Read",
                                systemImage: book.isRead ? "checkmark.circle.fill" : "checkmark.circle"
                            )
                        }

                        Button(role: .destructive) {
                            bookToDelete = book
                            showingDeleteConfirmation = true
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 20)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: - Toolbar

    // MARK: - Active Downloads Section

    private var activeDownloadsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Section header
            HStack {
                Label("Downloading (\(activePendingDownloads.count))", systemImage: "arrow.down.circle")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)

                Spacer()

                if activePendingDownloads.count > 1 {
                    Button("Cancel All", role: .destructive) {
                        downloadManager.cancelAllDownloads(modelContext: modelContext)
                    }
                    .font(.caption)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 8)

            // Download rows
            VStack(spacing: 0) {
                ForEach(activePendingDownloads, id: \.id) { pending in
                    ActiveDownloadRow(
                        pending: pending,
                        progress: downloadManager.activeDownloads[pending.id],
                        onCancel: {
                            downloadManager.cancelDownload(bookId: pending.id, modelContext: modelContext)
                        },
                        onRetry: {
                            downloadManager.retryDownload(pending, modelContext: modelContext)
                        }
                    )

                    if pending.id != activePendingDownloads.last?.id {
                        Divider()
                            .padding(.leading, 78)
                    }
                }
            }
            .background(Color(.secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .padding(.horizontal, 20)
        }
    }

    // MARK: - Active Transcription Section

    private var activeTranscriptionSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Section header
            HStack {
                Label("Transcribing", systemImage: "waveform")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)

                Spacer()

                Button("Cancel", role: .destructive) {
                    transcriptionService.cancel()
                }
                .font(.caption)
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 8)

            // Transcription row
            HStack(spacing: 12) {
                // Cover thumbnail
                LocalCoverImage(
                    bookId: transcriptionService.activeBookId ?? "",
                    coverData: transcriptionService.activeBookCoverData,
                    format: "m4b"
                )
                .aspectRatio(2/3, contentMode: .fit)
                .frame(width: 50)
                .clipShape(RoundedRectangle(cornerRadius: 4))
                .shadow(color: .black.opacity(0.1), radius: 2, x: 0, y: 1)

                // Info + progress
                VStack(alignment: .leading, spacing: 4) {
                    Text(transcriptionService.activeBookTitle ?? "")
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .lineLimit(1)

                    switch transcriptionService.state {
                    case .preparing:
                        HStack(spacing: 6) {
                            ProgressView()
                                .scaleEffect(0.6)
                                .frame(width: 12, height: 12)
                            Text("Preparing...")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }

                    case .transcribing(let progress, let message):
                        VStack(alignment: .leading, spacing: 2) {
                            ProgressView(value: progress)
                                .progressViewStyle(LinearProgressViewStyle())

                            HStack {
                                Text(message)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                Spacer()
                                Text("\(Int(progress * 100))%")
                                    .font(.caption2)
                                    .fontWeight(.medium)
                                    .foregroundStyle(.secondary)
                                    .monospacedDigit()
                            }
                        }

                    default:
                        EmptyView()
                    }
                }

                Spacer(minLength: 0)

                // Cancel button
                Button {
                    transcriptionService.cancel()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 16)
            .background(Color(.secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .padding(.horizontal, 20)
        }
    }

    // MARK: - Delete Helpers

    private var deleteDialogTitle: String { "Delete Book?" }

    private var deleteDialogMessage: String {
        guard let book = bookToDelete else { return "" }
        return "This will remove \"\(book.title)\" from your device. You can download it again from your library."
    }

    private func toggleReadStatus(for book: DownloadedBook) {
        book.isRead.toggle()
        try? modelContext.save()

        // Sync to server
        if let edit = PendingBookEdit.toggleRead(bookId: book.id, isRead: book.isRead) {
            modelContext.insert(edit)
            try? modelContext.save()
        }
    }

    private func recomputeFilteredBooks() {
        var result = books
        if effectiveFilter != .all {
            result = result.filter { effectiveFilter.matches(format: $0.format) }
        }
        if !searchText.isEmpty {
            let query = searchText.lowercased()
            result = result.filter { book in
                book.title.lowercased().contains(query) ||
                book.authors.joined(separator: " ").lowercased().contains(query)
            }
        }
        cachedFilteredBooks = result
    }

    private func recomputeSeriesItems() {
        let booksWithSeries = books.filter { $0.series != nil }
        let grouped = Dictionary(grouping: booksWithSeries) { $0.series! }
        cachedSeriesItems = grouped.map { name, seriesBooks in
            let coverBooks = seriesBooks
                .sorted { ($0.seriesNumber ?? .infinity) < ($1.seriesNumber ?? .infinity) }
                .prefix(3)
                .map { DownloadedSeriesCoverBook(id: $0.id, coverData: $0.coverData) }
            return DownloadedSeriesItem(
                name: name,
                bookCount: seriesBooks.count,
                coverBooks: Array(coverBooks)
            )
        }
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private func performDelete() {
        guard let book = bookToDelete else { return }
        do {
            try downloadManager.deleteBook(book, modelContext: modelContext)
        } catch {
            deleteError = error.localizedDescription
            showingDeleteError = true
        }
        bookToDelete = nil
    }
}

#Preview {
    let config = ServerConfig()
    let api = APIService(config: config)

    DownloadsView()
        .environment(config)
        .environment(AppNavigation())
        .environment(api)
        .environment(DownloadManager(config: config, apiService: api))
        .environment(StorageManager())
        .environment(AudiobookPlayer())
        .environment(ReaderSettings())
        .environment(OnDeviceTranscriptionService())
        .environment(SyncService(apiService: api))
        .modelContainer(for: [DownloadedBook.self, PendingDownload.self], inMemory: true)
}
