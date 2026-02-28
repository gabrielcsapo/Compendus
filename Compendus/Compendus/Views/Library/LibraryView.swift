//
//  LibraryView.swift
//  Compendus
//
//  Browse books from the server library
//

import SwiftUI
import SwiftData

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
    @Environment(\.modelContext) private var modelContext

    // Query for all downloaded books (to check download status)
    @Query private var downloadedBooks: [DownloadedBook]

    @State private var books: [Book] = []
    @State private var isLoading = false
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

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private let limit = 50
    private var columns: [GridItem] {
        let count = horizontalSizeClass == .compact ? 2 : 4
        return Array(repeating: GridItem(.flexible(), spacing: 16), count: count)
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
            .sheet(item: $selectedBook) { book in
                BookDetailView(
                    book: book,
                    onRead: { downloaded in
                        if downloaded.isAudiobook {
                            Task {
                                await audiobookPlayer.loadBook(downloaded)
                                audiobookPlayer.play()
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
            }
    }

    private var libraryBase: some View {
        librarySearchable
            .onChange(of: viewMode) { _, newValue in
                Task {
                    if newValue == .series {
                        await loadSeries()
                    } else if newValue == .books {
                        await loadBooks()
                    }
                }
            }
            .onChange(of: appNavigation.pendingSeriesFilter) { _, _ in
                applyPendingSeriesFilter()
            }
            .onAppear { applyPendingSeriesFilter() }
            .refreshable {
                if viewMode == .series {
                    await loadSeries()
                } else {
                    await loadBooks()
                }
            }
            .task {
                if books.isEmpty && viewMode == .books {
                    await loadBooks()
                }
                await downloadManager.syncDownloadedBooksMetadata(modelContext: modelContext)
            }
    }

    private var librarySearchable: some View {
        mainContent
            .navigationTitle(navigationTitle)
            .toolbar { libraryToolbar }
            .searchable(text: $searchText, prompt: searchPrompt)
            .onChange(of: searchText) { _, newValue in
                Task {
                    if viewMode == .series {
                        // Search is handled locally for series
                    } else if newValue.isEmpty {
                        await loadBooks()
                    } else {
                        await searchBooks(query: newValue)
                    }
                }
            }
            .onChange(of: selectedFilter) { _, _ in
                if viewMode == .books {
                    Task { await loadBooks() }
                }
            }
            .onChange(of: selectedSort) { _, _ in
                if viewMode == .books {
                    Task { await loadBooks() }
                }
            }
    }

    private var searchPrompt: String {
        viewMode == .series ? "Search series..." : "Search books..."
    }

    // MARK: - Main Content

    @ViewBuilder
    private var mainContent: some View {
        if viewMode == .series {
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
        }
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
                                audiobookPlayer.play()
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
                    } label: {
                        Label("Cancel Download", systemImage: "xmark.circle")
                    }
                } else {
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

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var libraryToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Picker("View", selection: $viewMode) {
                ForEach(LibraryViewMode.allCases, id: \.self) { mode in
                    Label(mode.rawValue, systemImage: mode.icon)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 160)
        }
        if viewMode == .books {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    ForEach(BookFilter.allCases, id: \.self) { filter in
                        Button {
                            selectedFilter = filter
                        } label: {
                            Label(filter.rawValue, systemImage: filter.icon)
                            if selectedFilter == filter {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                } label: {
                    Label("Filter", systemImage: selectedFilter == .all ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    ForEach(BookSort.allCases, id: \.self) { sort in
                        Button {
                            selectedSort = sort
                        } label: {
                            Label(sort.rawValue, systemImage: sort.icon)
                            if selectedSort == sort {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                } label: {
                    Label("Sort", systemImage: "arrow.up.arrow.down")
                }
            }
        }
    }

    // MARK: - Navigation Title

    private var navigationTitle: String {
        if viewMode == .series {
            return seriesItems.isEmpty ? "Series" : "Series (\(seriesItems.count))"
        }
        return totalCount > 0 ? "Library (\(totalCount))" : "Library"
    }

    // MARK: - Series Grid

    @ViewBuilder
    private var seriesGridContent: some View {
        if isLoadingSeries && seriesItems.isEmpty {
            SkeletonBookGrid(count: 6)
        } else if filteredSeriesItems.isEmpty {
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
            .padding(.top, 80)
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
            seriesSheet = SeriesSheet(id: seriesName)
        }
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
            // Log detailed error for debugging
            print("[LibraryView] Load error: \(error)")
            if let apiError = error as? APIError {
                errorMessage = apiError.errorDescription ?? error.localizedDescription
            } else if let urlError = error as? URLError {
                errorMessage = "Connection error: \(urlError.localizedDescription) (code: \(urlError.code.rawValue))"
            } else {
                errorMessage = error.localizedDescription
            }
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
            // Silently fail for pagination errors
        }

        isLoading = false
    }

    private func loadSeries() async {
        isLoadingSeries = true

        do {
            let response = try await apiService.fetchSeries()
            seriesItems = response.series
        } catch {
            print("[LibraryView] Load series error: \(error)")
            seriesItems = []
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
            errorMessage = error.localizedDescription
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
                }
            }
        }
    }

    private func cleanupFinishedDownloads() {
        for bookId in downloadingBooks {
            let download = downloadManager.activeDownloads[bookId]
            if download == nil || download?.state.isCompleted == true {
                downloadingBooks.remove(bookId)
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
