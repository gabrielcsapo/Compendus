//
//  SeriesDetailView.swift
//  Compendus
//
//  Full-screen sheet for browsing books in a series (API-backed)
//

import SwiftUI
import SwiftData

struct SeriesDetailView: View {
    let seriesName: String

    @Environment(APIService.self) private var apiService
    @Environment(AudiobookPlayer.self) private var audiobookPlayer
    @Environment(DownloadManager.self) private var downloadManager
    @Environment(ReaderSettings.self) private var readerSettings
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @Query private var downloadedBooks: [DownloadedBook]

    @State private var books: [Book] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var hasMore = true
    @State private var offset = 0
    @State private var totalCount: Int = 0
    @State private var selectedBook: Book?
    @State private var selectedFilter: BookFilter = .all
    @State private var selectedSort: BookSort = .recent
    @State private var bookToRead: DownloadedBook?
    @State private var downloadingBooks: Set<String> = []
    @State private var showingDownloadError = false
    @State private var downloadError: String?

    private let limit = 50
    private let columns = [
        GridItem(.adaptive(minimum: 160, maximum: 200), spacing: 16)
    ]

    var body: some View {
        NavigationStack {
            mainContent
                .navigationTitle(seriesName)
                .navigationBarTitleDisplayMode(.large)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Done") {
                            dismiss()
                        }
                    }
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
                .onChange(of: selectedFilter) { _, _ in
                    Task { await loadBooks() }
                }
                .onChange(of: selectedSort) { _, _ in
                    Task { await loadBooks() }
                }
                .onChange(of: downloadManager.activeDownloads.count) {
                    cleanupFinishedDownloads()
                }
                .task {
                    await loadBooks()
                }
                .refreshable {
                    await loadBooks()
                }
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
                onBookTap: { tappedBook in
                    selectedBook = tappedBook
                }
            )
        }
        .fullScreenCover(item: $bookToRead) { book in
            ReaderContainerView(book: book)
                .environment(readerSettings)
        }
        .alert("Download Failed", isPresented: $showingDownloadError) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(downloadError ?? "An error occurred while downloading the book.")
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var mainContent: some View {
        if books.isEmpty && isLoading {
            SkeletonBookGrid(count: 6)
        } else if books.isEmpty && errorMessage != nil {
            ErrorStateView(message: errorMessage ?? "Unknown error") {
                Task { await loadBooks() }
            }
        } else if books.isEmpty {
            VStack(spacing: 12) {
                Image(systemName: "books.vertical")
                    .font(.system(size: 40))
                    .foregroundStyle(.secondary)
                Text("No books found")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                Text("No books in this series match the current filter.")
                    .font(.subheadline)
                    .foregroundStyle(.tertiary)
            }
            .padding(.top, 80)
        } else {
            ScrollView {
                if totalCount > 0 {
                    Text("\(totalCount) book\(totalCount == 1 ? "" : "s")")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 20)
                        .padding(.top, 12)
                }

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
    }

    private func bookGridCell(book: Book, index: Int) -> some View {
        BookGridItem(book: book, isDownloaded: downloadedBook(for: book.id) != nil)
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

    // MARK: - Data Loading

    private func loadBooks() async {
        isLoading = true
        errorMessage = nil
        offset = 0

        do {
            let response = try await apiService.fetchBooks(limit: limit, offset: 0, type: selectedFilter.apiType, orderBy: selectedSort.apiOrderBy, order: selectedSort.apiOrder, series: seriesName)
            books = response.books
            totalCount = response.totalCount ?? response.books.count
            hasMore = response.books.count >= limit
            offset = response.books.count
        } catch {
            print("[SeriesDetailView] Load error: \(error)")
            if let apiError = error as? APIError {
                errorMessage = apiError.errorDescription ?? error.localizedDescription
            } else if let urlError = error as? URLError {
                errorMessage = "Connection error: \(urlError.localizedDescription)"
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
            let response = try await apiService.fetchBooks(limit: limit, offset: offset, type: selectedFilter.apiType, orderBy: selectedSort.apiOrderBy, order: selectedSort.apiOrder, series: seriesName)
            let newBooks = response.books
            books.append(contentsOf: newBooks)
            hasMore = newBooks.count >= limit
            offset += newBooks.count
        } catch {
            // Silently fail for pagination errors
        }

        isLoading = false
    }

    // MARK: - Helpers

    private func downloadedBook(for id: String) -> DownloadedBook? {
        downloadedBooks.first { $0.id == id }
    }

    private func downloadBook(_ book: Book) {
        downloadingBooks.insert(book.id)

        Task {
            do {
                let result = try await downloadManager.downloadBook(book, modelContext: modelContext)
                await MainActor.run {
                    if result != nil {
                        downloadingBooks.remove(book.id)
                    }
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

    private func cleanupFinishedDownloads() {
        for bookId in downloadingBooks {
            let download = downloadManager.activeDownloads[bookId]
            if download == nil || download?.state.isCompleted == true {
                downloadingBooks.remove(bookId)
            }
        }
    }
}
