//
//  DownloadsView.swift
//  Compendus
//
//  View for managing downloaded books
//

import SwiftUI
import SwiftData

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

struct DownloadsView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(APIService.self) private var apiService
    @Environment(DownloadManager.self) private var downloadManager
    @Environment(StorageManager.self) private var storageManager

    @Query(sort: \DownloadedBook.downloadedAt, order: .reverse)
    private var books: [DownloadedBook]

    @Query(sort: \PendingDownload.queuedAt, order: .reverse)
    private var pendingDownloads: [PendingDownload]

    @State private var bookToDelete: DownloadedBook?
    @State private var showingDeleteConfirmation = false
    @State private var searchText = ""
    @State private var selectedFilter: DownloadFilter = .all
    @State private var showingStorageBreakdown = false
    @State private var viewMode: DownloadViewMode = .books
    @State private var selectedSeriesName: String? = nil

    private let columns = [
        GridItem(.adaptive(minimum: 160, maximum: 200), spacing: 16)
    ]

    private var filteredBooks: [DownloadedBook] {
        var result = books

        // Apply series filter
        if let seriesName = selectedSeriesName {
            result = result.filter { $0.series == seriesName }
            // Sort by series number when viewing a specific series
            result.sort { ($0.seriesNumber ?? .infinity) < ($1.seriesNumber ?? .infinity) }
        }

        // Apply type filter
        if selectedFilter != .all {
            result = result.filter { selectedFilter.matches(format: $0.format) }
        }

        // Apply search filter
        if !searchText.isEmpty {
            let query = searchText.lowercased()
            result = result.filter { book in
                book.title.lowercased().contains(query) ||
                book.authors.joined(separator: " ").lowercased().contains(query)
            }
        }

        return result
    }

    private var seriesItems: [DownloadedSeriesItem] {
        let booksWithSeries = books.filter { $0.series != nil }

        let grouped = Dictionary(grouping: booksWithSeries) { $0.series! }

        return grouped.map { name, seriesBooks in
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

    private var filteredSeriesItems: [DownloadedSeriesItem] {
        if searchText.isEmpty {
            return seriesItems
        }
        return seriesItems.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
    }

    /// Pending downloads that are still active (not yet completed as DownloadedBook)
    private var activePendingDownloads: [PendingDownload] {
        pendingDownloads.filter { $0.status != "completed" }
    }

    private var hasActiveDownloads: Bool {
        !activePendingDownloads.isEmpty || !downloadManager.activeDownloads.isEmpty
    }

    var body: some View {
        NavigationStack {
            mainContent
                .navigationTitle(navigationTitle)
                .toolbar { downloadsToolbar }
                .navigationDestination(for: DownloadedBook.self) { book in
                    DownloadedBookDetailView(book: book) { seriesName in
                        selectedSeriesName = seriesName
                        viewMode = .books
                    }
                }
                .searchable(text: $searchText, prompt: searchPrompt)
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
                .sheet(isPresented: $showingStorageBreakdown) {
                    StorageBreakdownView()
                }
                .task {
                    await downloadManager.syncDownloadedBooksMetadata(modelContext: modelContext)
                }
        }
    }

    // MARK: - Navigation Title

    private var navigationTitle: String {
        if let seriesName = selectedSeriesName {
            return seriesName
        }
        if viewMode == .series {
            return seriesItems.isEmpty ? "Series" : "Series (\(seriesItems.count))"
        }
        return "Downloads"
    }

    private var searchPrompt: String {
        if viewMode == .series && selectedSeriesName == nil {
            return "Search series..."
        }
        return "Search downloads..."
    }

    // MARK: - Main Content

    @ViewBuilder
    private var mainContent: some View {
        if books.isEmpty && !hasActiveDownloads {
            DownloadsEmptyStateView()
        } else if viewMode == .series && selectedSeriesName == nil {
            seriesGridContent
        } else if filteredBooks.isEmpty && !hasActiveDownloads {
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
                icon: selectedFilter.icon,
                title: "No \(selectedFilter.rawValue)",
                description: "No \(selectedFilter.rawValue.lowercased()) found in your downloads."
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
                                selectedSeriesName = series.name
                                viewMode = .books
                            }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 20)
            }
        }
    }

    // MARK: - Books Scroll Content

    private var booksScrollContent: some View {
        ScrollView {
            if selectedSeriesName != nil {
                Button {
                    selectedSeriesName = nil
                    viewMode = .series
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                            .font(.caption)
                        Text("All Series")
                            .font(.subheadline)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            // Active downloads section
            if hasActiveDownloads && selectedSeriesName == nil {
                activeDownloadsSection
            }

            // Storage summary (only show when not searching, filtering, or in series view)
            if searchText.isEmpty && selectedFilter == .all && selectedSeriesName == nil {
                StorageUsageView {
                    showingStorageBreakdown = true
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)
            }

            LazyVGrid(columns: columns, spacing: 16) {
                ForEach(filteredBooks) { book in
                    NavigationLink(value: book) {
                        DownloadedBookGridItem(book: book, onSeriesTap: { seriesName in
                            selectedSeriesName = seriesName
                            viewMode = .books
                        })
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
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
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var downloadsToolbar: some ToolbarContent {
        if !books.isEmpty {
            ToolbarItem(placement: .topBarLeading) {
                Picker("View", selection: $viewMode) {
                    ForEach(DownloadViewMode.allCases, id: \.self) { mode in
                        Label(mode.rawValue, systemImage: mode.icon)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 160)
            }

            if viewMode == .books || selectedSeriesName != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        ForEach(DownloadFilter.allCases, id: \.self) { filter in
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
            }

            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button(role: .destructive) {
                        bookToDelete = nil  // nil means delete all
                        showingDeleteConfirmation = true
                    } label: {
                        Label("Delete All", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
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

    // MARK: - Delete Helpers

    private var deleteDialogTitle: String {
        if bookToDelete != nil {
            return "Delete Book?"
        } else {
            return "Delete All Books?"
        }
    }

    private var deleteDialogMessage: String {
        if let book = bookToDelete {
            return "This will remove \"\(book.title)\" from your device. You can download it again from your library."
        } else {
            return "This will remove all downloaded books from your device. You can download them again from your library."
        }
    }

    private func performDelete() {
        do {
            if let book = bookToDelete {
                try downloadManager.deleteBook(book, modelContext: modelContext)
            } else {
                try downloadManager.deleteAllBooks(modelContext: modelContext)
            }
        } catch {
            // Handle error silently for now
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
        .modelContainer(for: [DownloadedBook.self, PendingDownload.self], inMemory: true)
}
