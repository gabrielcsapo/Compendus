//
//  DownloadsView.swift
//  Compendus
//
//  View for managing downloaded books
//

import SwiftUI
import SwiftData
import CCReader

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
    @Environment(HighlightColorManager.self) private var highlightColorManager
    @Environment(OnDeviceTranscriptionService.self) private var transcriptionService
    @Environment(ReadAlongService.self) private var readAlongService
    @Environment(KokoroModelManager.self) private var kokoroModelManager
    @Environment(TTSAudioCache.self) private var ttsAudioCache
    @Environment(BackgroundProcessingManager.self) private var backgroundProcessingManager
    @Environment(ComicExtractor.self) private var comicExtractor
    @Environment(ServerConfig.self) private var serverConfig
    @Environment(SyncService.self) private var syncService
    @Environment(AppNavigation.self) private var appNavigation

    @Query(sort: \DownloadedBook.downloadedAt, order: .reverse)
    private var allBooks: [DownloadedBook]

    @Query(
        filter: #Predicate<DownloadedBook> { $0.lastReadAt != nil && !$0.isRead && !$0.isSetAside },
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

    @State private var bookToRead: DownloadedBook?
    @State private var seriesSheet: DownloadSeriesSheet? = nil
    @State private var showingDeleteError = false
    @State private var deleteError: String?
    @State private var navigationPath = NavigationPath()
    @State private var selectedRemoteBook: Book? = nil
    @State private var suggestedBooks: [Book] = []
    @FocusState private var isSearchFocused: Bool

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var effectiveFilter: DownloadFilter {
        switch appNavigation.homeFilterChipId {
        case "ebooks": return .ebooks
        case "audiobooks": return .audiobooks
        case "comics": return .comics
        default: return .all
        }
    }

    private var isSeriesMode: Bool { appNavigation.homeFilterChipId == "series" }

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

    /// Merge local recently-read books with remote books that have progress or highlights but aren't downloaded
    private var continueReadingItems: [ContinueReadingItem] {
        let localIds = Set(recentlyReadBooks.map(\.id))
        let progressIds = Set(syncService.remoteBooksWithProgress.map(\.id))

        // All downloaded books for this profile, keyed by id. A book that has been
        // downloaded (even if not yet read) must NOT show the remote "needs
        // download" badge — surface it as a downloaded, tappable item instead.
        let downloadedById = Dictionary(books.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })

        let localItems = recentlyReadBooks.map { ContinueReadingItem.downloaded($0) }

        // A remote book that's since been downloaded becomes a downloaded item.
        func item(for book: Book) -> ContinueReadingItem {
            if let downloaded = downloadedById[book.id] {
                return .downloaded(downloaded)
            }
            return .remote(book)
        }

        let progressRemoteItems = syncService.remoteBooksWithProgress
            .filter { !localIds.contains($0.id) && $0.isSetAside != true }
            .map(item(for:))

        let highlightOnlyRemoteItems = syncService.remoteBooksWithHighlights
            .filter {
                !localIds.contains($0.id) &&
                !progressIds.contains($0.id) &&
                $0.isSetAside != true
            }
            .map(item(for:))

        return (localItems + progressRemoteItems + highlightOnlyRemoteItems)
            .sorted { ($0.lastReadAt ?? .distantPast) > ($1.lastReadAt ?? .distantPast) }
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            mainContent
                #if targetEnvironment(macCatalyst)
                .searchable(text: $searchText, prompt: searchPrompt)
                .navigationTitle("")
                #else
                .toolbar(.hidden, for: .navigationBar)
                #endif
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
                        .environment(highlightColorManager)
                        .environment(readAlongService)
                        .environment(audiobookPlayer)
                        .environment(transcriptionService)
                        .environment(apiService)
                        .environment(storageManager)
                        .environment(kokoroModelManager)
                        .environment(ttsAudioCache)
                        .environment(backgroundProcessingManager)
                        .environment(comicExtractor)
                }
                .sheet(item: $seriesSheet) { sheet in
                    DownloadedSeriesDetailView(seriesName: sheet.id)
                        .environment(serverConfig)
                        .environment(audiobookPlayer)
                        .environment(downloadManager)
                        .environment(readerSettings)
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
                    if ConnectivityMonitor.shared.permitsNetworkRequests {
                        await loadSuggestions()
                        await downloadManager.syncDownloadedBooksMetadata(modelContext: modelContext)
                    }
                    // Clean up stale failed download entries on launch
                    downloadManager.cleanupStaleFailedDownloads()
                }
                .onChange(of: searchText) { _, _ in recomputeFilteredBooks() }
                .onChange(of: appNavigation.homeFilterChipId) { _, _ in
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
                    if ConnectivityMonitor.shared.permitsNetworkRequests {
                        downloadManager.retryFailedDownloads(modelContext: modelContext)
                    }
                }
                .alert("Delete Failed", isPresented: $showingDeleteError) {
                    Button("OK", role: .cancel) { }
                } message: {
                    Text(deleteError ?? "An error occurred while deleting the book.")
                }
        }
    }

    private var searchPrompt: String {
        if isSeriesMode {
            return "Search series..."
        }
        return "Search your books..."
    }

    // MARK: - Main Content

    /// The Continue Reading / Also Reading section (local + remote books with
    /// progress or highlights) only renders on the unfiltered, non-search home.
    /// Selecting a specific filter or searching hides it, so an empty filtered
    /// result must fall through to the filter's empty state rather than a blank
    /// scroll view.
    private var showsContinueReading: Bool {
        !continueReadingItems.isEmpty && searchText.isEmpty && effectiveFilter == .all && !isSeriesMode
    }

    private var showsSuggestions: Bool {
        !suggestedBooks.isEmpty && searchText.isEmpty && effectiveFilter == .all && !isSeriesMode
    }

    @ViewBuilder
    private var mainContent: some View {
        if books.isEmpty && !hasActiveDownloads && !transcriptionService.isActive && syncService.remoteBooksWithProgress.isEmpty && syncService.remoteBooksWithHighlights.isEmpty && suggestedBooks.isEmpty {
            DownloadsEmptyStateView {
                appNavigation.selectedTab = 1
            }
        } else if isSeriesMode {
            seriesGridContent
        } else if cachedFilteredBooks.isEmpty && !hasActiveDownloads && !transcriptionService.isActive && !showsContinueReading && !showsSuggestions {
            filteredEmptyState
        } else {
            booksScrollContent
        }
    }

    @ViewBuilder
    private var filteredEmptyState: some View {
        VStack(spacing: 0) {
            deviceBrowseControls
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
    }

    // MARK: - Series Grid

    @ViewBuilder
    private var seriesGridContent: some View {
        if filteredSeriesItems.isEmpty {
            VStack(spacing: 0) {
                deviceBrowseControls
                if !searchText.isEmpty {
                    SearchEmptyStateView(query: searchText)
                } else {
                    EmptyStateView(
                        icon: "books.vertical",
                        title: "No Series",
                        description: "Downloaded books with series metadata will appear here."
                    )
                }
            }
        } else {
            ScrollView {
                deviceBrowseControls

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
            VStack(alignment: .leading, spacing: 5) {
                Text(Date.now, format: .dateTime.weekday(.wide).month(.wide).day())
                    .font(.caption.weight(.semibold))
                    .textCase(.uppercase)
                    .tracking(1.2)
                    .foregroundStyle(.tint)
                Text("Make a little room.")
                    .font(.system(.largeTitle, design: .serif, weight: .medium))
                    .tracking(-0.8)
                Text("Your books are waiting where you left them.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.top, 22)
            .padding(.bottom, 4)

            // Continue Reading section (local + remote books with progress)
            if showsContinueReading {
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
                    onDownloadBook: { book in
                        Task {
                            _ = try? await downloadManager.downloadBook(book, modelContext: modelContext)
                        }
                    },
                    onMarkAsRead: { book in
                        toggleReadStatus(for: book)
                    },
                    onSetAside: { item in
                        setAside(item)
                    },
                    onViewDetails: { book in
                        navigationPath.append(book)
                    }
                )
                .padding(.top, 16)
                .padding(.bottom, 8)
            }

            if showsSuggestions {
                maybeNextSection
            }

            // Active downloads section
            if hasActiveDownloads {
                activeDownloadsSection
            }

            // Active transcription section
            if transcriptionService.isActive {
                activeTranscriptionSection
            }

            if !books.isEmpty {
                Text("Downloaded books stay available from Library, even when you’re offline.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 20)
                    .padding(.top, 10)
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: - Toolbar

    private var homeFilterBinding: Binding<String> {
        Binding(
            get: { appNavigation.homeFilterChipId },
            set: { appNavigation.homeFilterChipId = $0 }
        )
    }

    private var deviceBrowseControls: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("On This Device")
                    .font(.title3.weight(.semibold))
                Spacer()
                if downloadManager.isSyncingMetadata {
                    ProgressView().controlSize(.small)
                }
            }
            .padding(.horizontal, 20)

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
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(Color(.secondarySystemFill))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .padding(.horizontal, 20)

            FilterChipBar(chips: homeChips, selectedId: homeFilterBinding)
        }
        .padding(.top, 16)
    }

    private var maybeNextSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("On your shelf")
                    .font(.title3.weight(.semibold))
                Text("Not a feed. Just the books you’ve already chosen.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 20)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(suggestedBooks) { book in
                        Button {
                            openSuggestedBook(book)
                        } label: {
                            TodaySuggestionCard(book: book)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 20)
            }
        }
        .padding(.vertical, 8)
    }

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
        return "This will remove \"\(book.title)\" from your device, including all highlights and bookmarks. You can download it again from your library."
    }

    private func toggleReadStatus(for book: DownloadedBook) {
        book.isRead.toggle()
        do {
            try modelContext.save()
        } catch {
            print("[DownloadsView] Failed to save read status: \(error)")
        }

        // Sync to server
        if let edit = PendingBookEdit.toggleRead(bookId: book.id, isRead: book.isRead) {
            modelContext.insert(edit)
            do { try modelContext.save() } catch { print("[DownloadsView] Failed to queue sync: \(error)") }
        }
    }

    private func setAside(_ item: ContinueReadingItem) {
        switch item {
        case .downloaded(let book):
            book.isSetAside = true
            book.localProgressUpdatedAt = Date()
            queueSetAsideEdit(bookId: book.id, isSetAside: true)
        case .remote(let book):
            syncService.hideRemoteBookFromToday(bookId: book.id)
            queueSetAsideEdit(bookId: book.id, isSetAside: true)
        }
    }

    private func restoreToToday(_ book: DownloadedBook) {
        book.isSetAside = false
        book.localProgressUpdatedAt = Date()
        queueSetAsideEdit(bookId: book.id, isSetAside: false)
    }

    private func queueSetAsideEdit(bookId: String, isSetAside: Bool) {
        guard let edit = PendingBookEdit.setAside(bookId: bookId, isSetAside: isSetAside) else {
            return
        }
        edit.profileId = serverConfig.selectedProfileId ?? ""
        modelContext.insert(edit)
        do {
            try modelContext.save()
        } catch {
            print("[DownloadsView] Failed to queue Set Aside edit: \(error)")
        }
    }

    private func loadSuggestions() async {
        guard let explore = try? await apiService.fetchExplore() else { return }
        let activeIds = Set(continueReadingItems.map(\.id))
        let preferredSections = ["read_next_in_series", "recently_added"]
        var seen = Set<String>()
        var result: [Book] = []

        for sectionId in preferredSections {
            guard let section = explore.sections.first(where: { $0.id == sectionId }) else { continue }
            for book in section.books where
                !activeIds.contains(book.id) &&
                book.isRead != true &&
                book.isSetAside != true &&
                (book.readingProgress ?? 0) == 0 &&
                seen.insert(book.id).inserted {
                result.append(book)
                if result.count == 6 { break }
            }
            if result.count == 6 { break }
        }

        suggestedBooks = result
    }

    private func openSuggestedBook(_ book: Book) {
        if let downloaded = books.first(where: { $0.id == book.id }) {
            if downloaded.isAudiobook {
                Task {
                    await audiobookPlayer.loadBook(downloaded)
                    audiobookPlayer.isFullPlayerPresented = true
                }
            } else {
                bookToRead = downloaded
            }
        } else {
            selectedRemoteBook = book
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

private struct TodaySuggestionCard: View {
    let book: Book

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var width: CGFloat { LibraryLayout.carouselCoverWidth(horizontalSizeClass) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            CachedCoverImage(bookId: book.id, hasCover: book.coverUrl != nil, format: book.format)
                .aspectRatio(LibraryLayout.coverAspect, contentMode: .fit)
                .frame(width: width)
                .bookObjectStyle()

            Text(book.title)
                .font(.caption.weight(.medium))
                .foregroundStyle(.primary)
                .lineLimit(2)

            Text(book.authorsDisplay)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(width: width, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(book.title), by \(book.authorsDisplay)")
        .accessibilityHint("Opens book details")
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
