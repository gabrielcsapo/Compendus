//
//  DownloadedSeriesDetailView.swift
//  Compendus
//
//  Full-screen sheet for browsing downloaded books in a series
//

import SwiftUI
import SwiftData
import EPUBReader

struct DownloadedSeriesDetailView: View {
    let seriesName: String

    @Environment(AudiobookPlayer.self) private var audiobookPlayer
    @Environment(DownloadManager.self) private var downloadManager
    @Environment(ReaderSettings.self) private var readerSettings
    @Environment(HighlightColorManager.self) private var highlightColorManager
    @Environment(APIService.self) private var apiService
    @Environment(StorageManager.self) private var storageManager
    @Environment(OnDeviceTranscriptionService.self) private var transcriptionService
    @Environment(ReadAlongService.self) private var readAlongService
    @Environment(PocketTTSModelManager.self) private var pocketTTSModelManager
    @Environment(TTSAudioCache.self) private var ttsAudioCache
    @Environment(BackgroundProcessingManager.self) private var backgroundProcessingManager
    @Environment(ComicExtractor.self) private var comicExtractor
    @Environment(ServerConfig.self) private var serverConfig
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @Query(sort: \DownloadedBook.downloadedAt, order: .reverse)
    private var allBooksQuery: [DownloadedBook]

    private var allBooks: [DownloadedBook] {
        let pid = serverConfig.selectedProfileId ?? ""
        return allBooksQuery.filter { $0.profileId == pid || $0.profileId.isEmpty }
    }

    @State private var selectedFilter: DownloadFilter = .all
    @State private var bookToRead: DownloadedBook?
    @State private var bookToDelete: DownloadedBook?
    @State private var showingDeleteConfirmation = false
    @State private var showingDeleteError = false
    @State private var deleteError: String?

    private let columns = [
        GridItem(.adaptive(minimum: 160, maximum: 200), spacing: 16)
    ]

    private var filteredBooks: [DownloadedBook] {
        var result = allBooks.filter { $0.series == seriesName }

        // Sort by series number
        result.sort { ($0.seriesNumber ?? .infinity) < ($1.seriesNumber ?? .infinity) }

        // Apply type filter
        if selectedFilter != .all {
            result = result.filter { selectedFilter.matches(format: $0.format) }
        }

        return result
    }

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
                .navigationDestination(for: DownloadedBook.self) { book in
                    DownloadedBookDetailView(book: book)
                }
                .confirmationDialog(
                    "Delete Book?",
                    isPresented: $showingDeleteConfirmation,
                    titleVisibility: .visible
                ) {
                    Button("Delete", role: .destructive) {
                        if let book = bookToDelete {
                            do {
                                try downloadManager.deleteBook(book, modelContext: modelContext)
                            } catch {
                                deleteError = error.localizedDescription
                                showingDeleteError = true
                            }
                        }
                        bookToDelete = nil
                    }
                    Button("Cancel", role: .cancel) {
                        bookToDelete = nil
                    }
                } message: {
                    if let book = bookToDelete {
                        Text("This will remove \"\(book.title)\" from your device.")
                    }
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
                .alert("Delete Failed", isPresented: $showingDeleteError) {
                    Button("OK", role: .cancel) { }
                } message: {
                    Text(deleteError ?? "An error occurred while deleting the book.")
                }
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var mainContent: some View {
        if filteredBooks.isEmpty {
            VStack(spacing: 12) {
                Image(systemName: "books.vertical")
                    .font(.system(size: 40))
                    .foregroundStyle(.secondary)
                Text("No books found")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                Text("No downloaded books in this series match the current filter.")
                    .font(.subheadline)
                    .foregroundStyle(.tertiary)
            }
            .padding(.top, 80)
        } else {
            ScrollView {
                Text("\(filteredBooks.count) book\(filteredBooks.count == 1 ? "" : "s")")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.top, 12)

                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(filteredBooks) { book in
                        NavigationLink(value: book) {
                            DownloadedBookGridItem(book: book)
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button {
                                if book.isAudiobook {
                                    Task {
                                        await audiobookPlayer.loadBook(book)
                                        audiobookPlayer.isFullPlayerPresented = true
                                    }
                                } else {
                                    bookToRead = book
                                }
                            } label: {
                                Label(book.isAudiobook ? "Play" : "Read", systemImage: book.isAudiobook ? "headphones" : "book.fill")
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
        }
    }
}
