//
//  LibraryView.swift
//  Compendus
//
//  Browse books from the server library
//

import SwiftUI
import SwiftData
import EPUBReader

enum LibraryViewMode: String, CaseIterable {
    case books = "Books"
    case series = "Series"

    var icon: String {
        switch self {
        case .books: return "book.closed"
        case .series: return "books.vertical"
        }
    }
}

enum BookFilter: String, CaseIterable {
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

    /// API type parameter for server-side filtering
    var apiType: String? {
        switch self {
        case .all: return nil
        case .ebooks: return "ebook"
        case .audiobooks: return "audiobook"
        case .comics: return "comic"
        }
    }
}

enum BookSort: String, CaseIterable {
    case recent = "Recently Added"
    case titleAsc = "Title A-Z"
    case titleDesc = "Title Z-A"
    case oldest = "Oldest First"

    var icon: String {
        switch self {
        case .recent: return "clock"
        case .titleAsc: return "textformat.abc"
        case .titleDesc: return "textformat.abc"
        case .oldest: return "calendar"
        }
    }

    /// API orderBy parameter
    var apiOrderBy: String {
        switch self {
        case .recent, .oldest: return "createdAt"
        case .titleAsc, .titleDesc: return "title"
        }
    }

    /// API order parameter
    var apiOrder: String {
        switch self {
        case .recent, .titleDesc: return "desc"
        case .titleAsc, .oldest: return "asc"
        }
    }
}

private struct SeriesSheet: Identifiable {
    let id: String  // series name
}

struct LibraryView: View {
    @Environment(APIService.self) private var apiService
    @Environment(ServerConfig.self) private var serverConfig
    @Environment(AppNavigation.self) private var appNavigation
    @Environment(AudiobookPlayer.self) private var audiobookPlayer
    @Environment(DownloadManager.self) private var downloadManager
    @Environment(ReaderSettings.self) private var readerSettings
    @Environment(HighlightColorManager.self) private var highlightColorManager
    @Environment(StorageManager.self) private var storageManager
    @Environment(OnDeviceTranscriptionService.self) private var transcriptionService
    @Environment(ReadAlongService.self) private var readAlongService
    @Environment(PocketTTSModelManager.self) private var pocketTTSModelManager
    @Environment(TTSAudioCache.self) private var ttsAudioCache
    @Environment(BackgroundProcessingManager.self) private var backgroundProcessingManager
    @Environment(ComicExtractor.self) private var comicExtractor
    @Environment(\.modelContext) private var modelContext

    // Query for all downloaded books (to check download status)
    @Query private var allDownloadedBooks: [DownloadedBook]

    private var downloadedBooks: [DownloadedBook] {
        let pid = serverConfig.selectedProfileId ?? ""
        return allDownloadedBooks.filter { $0.profileId == pid || $0.profileId.isEmpty }
    }

    @State private var books: [Book] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var searchText = ""
    @State private var hasMore = true
    @State private var offset = 0
    @State private var totalCount: Int = 0
    @State private var selectedBook: Book?
    @State private var selectedFilter: BookFilter = .all
    @State private var selectedSort: BookSort = .recent
    @State private var bookToRead: DownloadedBook?
    @State private var downloadingBooks: Set<String> = []
    @State private var viewMode: LibraryViewMode = .books
    @State private var seriesItems: [SeriesItem] = []
    @State private var seriesSheet: SeriesSheet? = nil
    @State private var isLoadingSeries = false
    @State private var searchTask: Task<Void, Never>?
    @State private var showingDownloadError = false
    @State private var downloadError: String?
    @State private var seriesErrorMessage: String?
    @State private var paginationFailed = false
    /// Book IDs that should auto-open in the reader once their download completes
    @State private var pendingReadBookIds: Set<String> = []
    @State private var showingSortSheet = false
    @FocusState private var isSearchFocused: Bool

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private let limit = 50
    private var columns: [GridItem] {
        let count = horizontalSizeClass == .compact ? 2 : 4
        return Array(repeating: GridItem(.flexible(), spacing: 16), count: count)
    }

    private var isExploreChipSelected: Bool { appNavigation.libraryFilterChipId == "explore" }
    private var isSeriesChipSelected: Bool { appNavigation.libraryFilterChipId == "series" }

    private var chipDrivenFilter: BookFilter {
        switch appNavigation.libraryFilterChipId {
        case "ebooks": return .ebooks
        case "audiobooks": return .audiobooks
        case "comics": return .comics
        default: return .all
        }
    }

    private var libraryChips: [FilterChip] {
        [
            FilterChip(id: "explore", label: "Explore", systemImage: "sparkles"),
            FilterChip(id: "all", label: "All", systemImage: nil),
            FilterChip(id: "ebooks", label: "Ebooks", systemImage: "book.closed"),
            FilterChip(id: "audiobooks", label: "Audiobooks", systemImage: "headphones"),
            FilterChip(id: "comics", label: "Comics", systemImage: "book.pages"),
            FilterChip(id: "series", label: "Series", systemImage: "books.vertical"),
        ]
    }

    private var sortChipView: AnyView {
        AnyView(
            Button {
                showingSortSheet = true
            } label: {
                HStack(spacing: 4) {
                    Text("Sort: \(selectedSort.rawValue)")
                    Image(systemName: "chevron.down")
                        .font(.caption2)
                }
                .font(.subheadline)
                .fontWeight(.medium)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(Capsule().fill(Color(.secondarySystemFill)))
                .foregroundStyle(Color.primary)
            }
            .buttonStyle(.plain)
        )
    }

    var body: some View {
        NavigationStack {
            libraryContent
        }
    }

    private var libraryContent: some View {
        libraryBase
            .onChange(of: downloadManager.activeDownloads.count) {
                cleanupFinishedDownloads()
            }
            .sheet(isPresented: $showingSortSheet) {
                SortBottomSheet(selectedSort: $selectedSort)
            }
            .sheet(item: $selectedBook) { book in
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
                    },
                    onSeriesTap: { seriesName in
                        seriesSheet = SeriesSheet(id: seriesName)
                    },
                    onBookTap: { tappedBook in
                        selectedBook = tappedBook
                    }
                )
            }
            .sheet(item: $seriesSheet) { sheet in
                SeriesDetailView(seriesName: sheet.id)
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
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
                    .environment(pocketTTSModelManager)
                    .environment(ttsAudioCache)
                    .environment(backgroundProcessingManager)
                    .environment(comicExtractor)
            }
            .alert("Download Failed", isPresented: $showingDownloadError) {
                Button("OK", role: .cancel) { }
            } message: {
                Text(downloadError ?? "An error occurred while downloading the book.")
            }
    }

    private var libraryBase: some View {
        librarySearchable
            .onChange(of: appNavigation.pendingSeriesFilter) { _, _ in
                applyPendingSeriesFilter()
            }
            .onAppear { applyPendingSeriesFilter() }
            .refreshable {
                if isSeriesChipSelected {
                    await loadSeries()
                } else {
                    await loadBooks()
                }
            }
            .task {
                if books.isEmpty && !isSeriesChipSelected {
                    await loadBooks()
                }
                await downloadManager.syncDownloadedBooksMetadata(modelContext: modelContext)
            }
    }

    @ViewBuilder
    private var librarySearchable: some View {
        @Bindable var nav = appNavigation
        mainContent
            #if targetEnvironment(macCatalyst)
            .searchable(text: $searchText, prompt: searchPrompt)
            .navigationTitle(macSectionTitle)
            #else
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
                                // Return to explore if we left it to search
                                if appNavigation.libraryFilterChipId == "all" {
                                    appNavigation.libraryFilterChipId = "explore"
                                }
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

                    FilterChipBar(chips: libraryChips, selectedId: $nav.libraryFilterChipId, trailingContent: (isSeriesChipSelected || isExploreChipSelected) ? nil : sortChipView)
                        .padding(.vertical, 4)
                    Divider()
                }
                .background(.ultraThinMaterial)
            }
            #endif
            .onChange(of: searchText) { _, newValue in
                searchTask?.cancel()
                guard !isSeriesChipSelected else { return }
                // When typing from explore, switch to all-books view to show results
                if isExploreChipSelected && !newValue.isEmpty {
                    appNavigation.libraryFilterChipId = "all"
                }
                let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else {
                    searchTask = Task { await loadBooks() }
                    return
                }
                searchTask = Task {
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    guard !Task.isCancelled else { return }
                    await searchBooks(query: trimmed)
                }
            }
            .onChange(of: appNavigation.libraryFilterChipId) { _, newId in
                if newId == "explore" {
                    // No-op: ExploreView manages its own data
                } else if newId == "series" {
                    viewMode = .series
                    Task { await loadSeries() }
                } else {
                    viewMode = .books
                    selectedFilter = chipDrivenFilter
                    Task { await loadBooks() }
                }
            }
            .onChange(of: selectedSort) { _, _ in
                if !isSeriesChipSelected {
                    Task { await loadBooks() }
                }
            }
    }

    private var searchPrompt: String {
        isSeriesChipSelected ? "Search series..." : "Search books..."
    }

    // MARK: - Main Content

    @ViewBuilder
    private var mainContent: some View {
        if isExploreChipSelected {
            ExploreView(
                onBookTap: { book in selectedBook = book },
                onSeriesTap: { name in seriesSheet = SeriesSheet(id: name) },
                onSeeAllSeries: { name in seriesSheet = SeriesSheet(id: name) }
            )
        } else if isSeriesChipSelected {
            seriesGridContent
        } else if books.isEmpty && isLoading {
            SkeletonBookGrid(count: 8)
        } else if books.isEmpty && errorMessage != nil {
            ErrorStateView(message: errorMessage ?? "Unknown error") {
                Task { await loadBooks() }
            }
        } else if books.isEmpty {
            LibraryEmptyStateView(
                state: emptyState,
                refreshAction: selectedFilter == .all ? { Task { await loadBooks() } } : nil
            )
        } else {
            booksScrollContent
        }
    }

    // MARK: - Books Scroll Content

    private var booksScrollContent: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 16) {
                ForEach(Array(books.enumerated()), id: \.element.id) { index, book in
                    bookGridCell(book: book, index: index)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 20)

            if isLoading && !books.isEmpty {
                ProgressView()
                    .padding()
            }

            if paginationFailed && !isLoading {
                Button {
                    paginationFailed = false
                    hasMore = true
                    Task { await loadMoreBooks() }
                } label: {
                    Label("Failed to load more. Tap to retry.", systemImage: "arrow.clockwise")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding()
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func bookGridCell(book: Book, index: Int) -> some View {
        BookGridItem(book: book, isDownloaded: downloadedBook(for: book.id) != nil, onSeriesTap: { seriesName in
                seriesSheet = SeriesSheet(id: seriesName)
            })
            .onTapGesture {
                selectedBook = book
            }
            .onAppear {
                if index >= books.count - 10 && hasMore && !isLoading {
                    Task { await loadMoreBooks() }
                }
            }
            .contextMenu {
                if let downloaded = downloadedBook(for: book.id) {
                    Button {
                        if downloaded.isAudiobook {
                            Task {
                                await audiobookPlayer.loadBook(downloaded)
                                audiobookPlayer.isFullPlayerPresented = true
                            }
                        } else {
                            bookToRead = downloaded
                        }
                    } label: {
                        Label(book.isAudiobook ? "Play" : "Read", systemImage: book.isAudiobook ? "headphones" : "book.fill")
                    }
                } else if downloadingBooks.contains(book.id) {
                    Button(role: .destructive) {
                        downloadManager.cancelDownload(bookId: book.id)
                        downloadingBooks.remove(book.id)
                        pendingReadBookIds.remove(book.id)
                    } label: {
                        Label("Cancel Download", systemImage: "xmark.circle")
                    }
                } else {
                    // Show "Continue Reading" if the book has server-side reading progress
                    if book.hasServerProgress {
                        Button {
                            downloadAndRead(book)
                        } label: {
                            Label(
                                book.isAudiobook ? "Continue Listening" : "Continue Reading",
                                systemImage: book.isAudiobook ? "headphones" : "book"
                            )
                        }
                    }

                    Button {
                        downloadBook(book)
                    } label: {
                        Label("Download", systemImage: "arrow.down.circle")
                    }
                }

                Button {
                    selectedBook = book
                } label: {
                    Label("View Details", systemImage: "info.circle")
                }
            }
    }

    // MARK: - Navigation Title

    private var navigationTitle: String { "Library" }

    #if targetEnvironment(macCatalyst)
    private var macSectionTitle: String {
        switch appNavigation.libraryFilterChipId {
        case "explore": return "Explore"
        case "ebooks": return "Ebooks"
        case "audiobooks": return "Audiobooks"
        case "comics": return "Comics"
        case "series": return "Series"
        default: return "All"
        }
    }
    #endif

    // MARK: - Series Grid

    @ViewBuilder
    private var seriesGridContent: some View {
        if isLoadingSeries && seriesItems.isEmpty {
            SkeletonBookGrid(count: 6)
        } else if seriesItems.isEmpty && seriesErrorMessage != nil {
            ErrorStateView(message: seriesErrorMessage ?? "Unknown error") {
                Task { await loadSeries() }
            }
        } else if filteredSeriesItems.isEmpty {
            ScrollView {
                VStack(spacing: 12) {
                    Image(systemName: "books.vertical")
                        .font(.system(size: 40))
                        .foregroundStyle(.secondary)
                    Text(searchText.isEmpty ? "No series found" : "No matching series")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                    Text(searchText.isEmpty ? "Books with series metadata will appear here." : "Try a different search term.")
                        .font(.subheadline)
                        .foregroundStyle(.tertiary)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 80)
            }
        } else {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(filteredSeriesItems) { series in
                        SeriesGridItem(series: series)
                            .onTapGesture {
                                seriesSheet = SeriesSheet(id: series.name)
                            }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 20)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }

    private var filteredSeriesItems: [SeriesItem] {
        if searchText.isEmpty {
            return seriesItems
        }
        return seriesItems.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
    }

    private func applyPendingSeriesFilter() {
        if let seriesName = appNavigation.pendingSeriesFilter {
            appNavigation.pendingSeriesFilter = nil
            appNavigation.libraryFilterChipId = "series"
            seriesSheet = SeriesSheet(id: seriesName)
        }
    }

    /// Returns a human-readable error message, replacing raw HTML server responses with
    /// a friendly string (e.g. 502 "Starting Up" pages).
    private func friendlyErrorMessage(from error: Error) -> String {
        let raw: String
        if let apiError = error as? APIError {
            raw = apiError.errorDescription ?? error.localizedDescription
        } else if let urlError = error as? URLError {
            return "Connection error: \(urlError.localizedDescription)"
        } else {
            return error.localizedDescription
        }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("<") {
            return "The server is temporarily unavailable. It may still be starting up — please try again in a moment."
        }
        return raw
    }

    private func loadBooks() async {
        isLoading = true
        errorMessage = nil
        offset = 0

        do {
            let response = try await apiService.fetchBooks(limit: limit, offset: 0, type: selectedFilter.apiType, orderBy: selectedSort.apiOrderBy, order: selectedSort.apiOrder)
            books = response.books
            totalCount = response.totalCount ?? response.books.count
            hasMore = response.books.count >= limit
            offset = response.books.count
        } catch {
            errorMessage = friendlyErrorMessage(from: error)
        }

        isLoading = false
    }

    private func loadMoreBooks() async {
        guard hasMore, !isLoading else { return }

        isLoading = true

        do {
            let response = try await apiService.fetchBooks(limit: limit, offset: offset, type: selectedFilter.apiType, orderBy: selectedSort.apiOrderBy, order: selectedSort.apiOrder)
            let newBooks = response.books
            books.append(contentsOf: newBooks)
            hasMore = newBooks.count >= limit
            offset += newBooks.count
        } catch {
            paginationFailed = true
        }

        isLoading = false
    }

    private func loadSeries() async {
        isLoadingSeries = true
        seriesErrorMessage = nil

        do {
            let response = try await apiService.fetchSeries()
            seriesItems = response.series
        } catch {
            seriesErrorMessage = friendlyErrorMessage(from: error)
        }

        isLoadingSeries = false
    }

    private func searchBooks(query: String) async {
        isLoading = true
        errorMessage = nil

        do {
            let response = try await apiService.searchBooks(query: query)
            books = response.books  // Use computed property that extracts books from results
            totalCount = response.books.count  // Show search result count
            hasMore = false  // Search doesn't support pagination
        } catch {
            errorMessage = friendlyErrorMessage(from: error)
        }

        isLoading = false
    }

    /// Determine the appropriate empty state based on the current filter
    private var emptyState: LibraryEmptyState {
        switch selectedFilter {
        case .all:
            return .empty
        case .ebooks:
            return .noEbooks
        case .audiobooks:
            return .noAudiobooks
        case .comics:
            return .noComics
        }
    }

    /// Check if a book is downloaded
    private func downloadedBook(for id: String) -> DownloadedBook? {
        downloadedBooks.first { $0.id == id }
    }

    /// Download a book
    private func downloadBook(_ book: Book) {
        downloadingBooks.insert(book.id)

        Task {
            do {
                let result = try await downloadManager.downloadBook(book, modelContext: modelContext)
                await MainActor.run {
                    if result != nil {
                        // Already downloaded, done immediately
                        downloadingBooks.remove(book.id)
                    }
                    // If nil, download started in background — will be removed
                    // when activeDownloads state changes to completed
                }
            } catch {
                await MainActor.run {
                    downloadingBooks.remove(book.id)
                    downloadError = error.localizedDescription
                    showingDownloadError = true
                }
            }
        }
    }

    /// Download a book and automatically open the reader when the download completes
    private func downloadAndRead(_ book: Book) {
        pendingReadBookIds.insert(book.id)
        downloadingBooks.insert(book.id)

        Task {
            do {
                let result = try await downloadManager.downloadBook(book, modelContext: modelContext)
                await MainActor.run {
                    if let downloaded = result {
                        // Already downloaded — open immediately
                        downloadingBooks.remove(book.id)
                        pendingReadBookIds.remove(book.id)
                        openDownloadedBook(downloaded)
                    }
                    // If nil, download started in background — cleanupFinishedDownloads
                    // will handle auto-opening when the download completes
                }
            } catch {
                await MainActor.run {
                    downloadingBooks.remove(book.id)
                    pendingReadBookIds.remove(book.id)
                    downloadError = error.localizedDescription
                    showingDownloadError = true
                }
            }
        }
    }

    /// Open a downloaded book in the appropriate reader/player
    private func openDownloadedBook(_ downloaded: DownloadedBook) {
        if downloaded.isAudiobook {
            Task {
                await audiobookPlayer.loadBook(downloaded)
                audiobookPlayer.isFullPlayerPresented = true
            }
        } else {
            bookToRead = downloaded
        }
    }

    private func cleanupFinishedDownloads() {
        for bookId in downloadingBooks {
            let download = downloadManager.activeDownloads[bookId]
            if download == nil || download?.state.isCompleted == true {
                downloadingBooks.remove(bookId)

                // Auto-open books that were queued via "Continue Reading"
                if pendingReadBookIds.contains(bookId) {
                    pendingReadBookIds.remove(bookId)
                    if let downloaded = downloadedBook(for: bookId) {
                        openDownloadedBook(downloaded)
                    }
                }
            }
        }
    }
}

#Preview {
    LibraryView()
        .environment(ServerConfig())
        .environment(AppNavigation())
        .environment(AudiobookPlayer())
        .environment(APIService(config: ServerConfig()))
        .modelContainer(for: DownloadedBook.self, inMemory: true)
}
