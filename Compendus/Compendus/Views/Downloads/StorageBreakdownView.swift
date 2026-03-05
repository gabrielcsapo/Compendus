//
//  StorageBreakdownView.swift
//  Compendus
//
//  Shows storage ring chart with items sorted by size, swipe to delete
//

import SwiftUI
import SwiftData

/// Represents either a downloaded book or a cache category for unified sorting
private enum StorageItem: Identifiable {
    case book(DownloadedBook)
    case cache(CacheEntry)

    var id: String {
        switch self {
        case .book(let book): return "book-\(book.id)"
        case .cache(let entry): return "cache-\(entry.name)"
        }
    }

    var bytes: Int64 {
        switch self {
        case .book(let book): return Int64(book.fileSize)
        case .cache(let entry): return entry.bytes
        }
    }
}

private struct CacheEntry: Identifiable {
    let id = UUID()
    let name: String
    let icon: String
    let color: Color
    let bytes: Int64
    let clearAction: () throws -> Void
}

struct StorageBreakdownView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @Environment(DownloadManager.self) private var downloadManager
    @Environment(StorageManager.self) private var storageManager
    @Environment(ServerConfig.self) private var serverConfig

    @Query(sort: \DownloadedBook.fileSize, order: .reverse)
    private var allBooks: [DownloadedBook]

    private var books: [DownloadedBook] {
        let pid = serverConfig.selectedProfileId ?? ""
        return allBooks.filter { $0.profileId == pid || $0.profileId.isEmpty }
    }

    @State private var bookToDelete: DownloadedBook?
    @State private var cacheToDelete: String?
    @State private var showingDeleteConfirmation = false
    @State private var showingCacheClearConfirmation = false

    // Cached storage data — loaded async to avoid blocking main thread with directory enumeration
    @State private var cachedSegments: [StorageSegment] = []
    @State private var cachedCacheEntries: [CacheEntry] = []
    @State private var cachedAllItems: [StorageItem] = []
    @State private var cachedAvailableBytes: Int64 = 0

    var body: some View {
        NavigationStack {
            List {
                // Ring chart
                Section {
                    if !cachedSegments.isEmpty {
                        StorageRingChart(
                            segments: cachedSegments,
                            availableBytes: cachedAvailableBytes
                        )
                        .frame(maxWidth: .infinity)
                        .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
                    }
                }

                // All items sorted by size
                Section {
                    if cachedAllItems.isEmpty {
                        Text("No downloaded content")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(cachedAllItems) { item in
                            switch item {
                            case .book(let book):
                                StorageBookRow(book: book)
                                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                        Button(role: .destructive) {
                                            bookToDelete = book
                                            showingDeleteConfirmation = true
                                        } label: {
                                            Label("Delete", systemImage: "trash")
                                        }
                                    }
                            case .cache(let entry):
                                StorageCacheRow(entry: entry)
                                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                        Button(role: .destructive) {
                                            cacheToDelete = entry.name
                                            showingCacheClearConfirmation = true
                                        } label: {
                                            Label("Clear", systemImage: "trash")
                                        }
                                    }
                            }
                        }
                    }
                } header: {
                    Text("By Size")
                }
            }
            .navigationTitle("Storage")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
            .confirmationDialog(
                "Delete Book?",
                isPresented: $showingDeleteConfirmation,
                titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) {
                    if let book = bookToDelete {
                        try? downloadManager.deleteBook(book, modelContext: modelContext)
                        refreshStorageData()
                    }
                    bookToDelete = nil
                }
                Button("Cancel", role: .cancel) {
                    bookToDelete = nil
                }
            } message: {
                if let book = bookToDelete {
                    Text("This will remove \"\(book.title)\" and free up \(book.fileSizeDisplay).")
                }
            }
            .confirmationDialog(
                "Clear Cache?",
                isPresented: $showingCacheClearConfirmation,
                titleVisibility: .visible
            ) {
                Button("Clear", role: .destructive) {
                    if let name = cacheToDelete, let entry = cachedCacheEntries.first(where: { $0.name == name }) {
                        try? entry.clearAction()
                        refreshStorageData()
                    }
                    cacheToDelete = nil
                }
                Button("Cancel", role: .cancel) {
                    cacheToDelete = nil
                }
            } message: {
                if let name = cacheToDelete {
                    Text("This will clear all data in \(name).")
                }
            }
            .task {
                refreshStorageData()
            }
            .onChange(of: allBooks.count) { _, _ in
                refreshStorageData()
            }
        }
    }

    /// Compute storage data off the main thread, then update state
    private func refreshStorageData() {
        let sm = storageManager
        let currentBooks = books
        Task.detached(priority: .userInitiated) {
            let comicCacheBytes = sm.comicCacheSize()
            let coverCacheBytes = sm.coverCacheSize()
            let ttsCacheBytes = sm.ttsCacheSize()
            let available = sm.availableDiskSpace()

            // Build segments
            var segs: [StorageSegment] = []
            var ebookBytes: Int64 = 0, audioBytes: Int64 = 0, comicBytes: Int64 = 0, otherBytes: Int64 = 0
            for book in currentBooks {
                let fmt = book.format.lowercased()
                let size = Int64(book.fileSize)
                if ["epub", "pdf"].contains(fmt) { ebookBytes += size }
                else if ["m4b", "mp3", "m4a"].contains(fmt) { audioBytes += size }
                else if ["cbr", "cbz"].contains(fmt) { comicBytes += size }
                else { otherBytes += size }
            }
            if ebookBytes > 0 { segs.append(StorageSegment(category: "Ebooks", bytes: ebookBytes, color: .blue)) }
            if audioBytes > 0 { segs.append(StorageSegment(category: "Audiobooks", bytes: audioBytes, color: .green)) }
            if comicBytes > 0 { segs.append(StorageSegment(category: "Comics", bytes: comicBytes, color: .purple)) }
            if otherBytes > 0 { segs.append(StorageSegment(category: "Other", bytes: otherBytes, color: .orange)) }
            if comicCacheBytes > 0 { segs.append(StorageSegment(category: "Comic Cache", bytes: comicCacheBytes, color: .indigo)) }
            if coverCacheBytes > 0 { segs.append(StorageSegment(category: "Cover Cache", bytes: coverCacheBytes, color: .mint)) }
            if ttsCacheBytes > 0 { segs.append(StorageSegment(category: "TTS Cache", bytes: ttsCacheBytes, color: .teal)) }

            // Build cache entries
            var entries: [CacheEntry] = []
            if comicCacheBytes > 0 {
                entries.append(CacheEntry(name: "Comic Cache", icon: "book.pages", color: .indigo, bytes: comicCacheBytes, clearAction: { try sm.clearComicCache() }))
            }
            if coverCacheBytes > 0 {
                entries.append(CacheEntry(name: "Cover Cache", icon: "photo", color: .mint, bytes: coverCacheBytes, clearAction: { try sm.clearCoverCache() }))
            }
            if ttsCacheBytes > 0 {
                entries.append(CacheEntry(name: "TTS Cache", icon: "waveform", color: .teal, bytes: ttsCacheBytes, clearAction: { try sm.clearTTSCache() }))
            }

            // Build all items
            var items: [StorageItem] = currentBooks.map { .book($0) }
            items.append(contentsOf: entries.map { .cache($0) })
            items.sort { $0.bytes > $1.bytes }

            await MainActor.run {
                cachedSegments = segs
                cachedCacheEntries = entries
                cachedAllItems = items
                cachedAvailableBytes = available
            }
        }
    }
}

private struct StorageCacheRow: View {
    let entry: CacheEntry

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: entry.icon)
                .font(.title2)
                .foregroundStyle(entry.color)
                .frame(width: 32)

            VStack(alignment: .leading, spacing: 2) {
                Text(entry.name)
                    .font(.subheadline)
                    .lineLimit(1)

                Text("Cached data")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Text(ByteCountFormatter.string(fromByteCount: entry.bytes, countStyle: .file))
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

struct StorageBookRow: View {
    let book: DownloadedBook

    var body: some View {
        HStack(spacing: 12) {
            // Format icon
            Image(systemName: formatIcon)
                .font(.title2)
                .foregroundStyle(formatColor)
                .frame(width: 32)

            // Book info
            VStack(alignment: .leading, spacing: 2) {
                Text(book.title)
                    .font(.subheadline)
                    .lineLimit(1)

                Text(book.authors.isEmpty ? "Unknown Author" : book.authors.joined(separator: ", "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            // File size
            Text(book.fileSizeDisplay)
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }

    private var formatIcon: String {
        let fmt = book.format.lowercased()
        if ["m4b", "mp3", "m4a"].contains(fmt) {
            return "headphones"
        } else if ["cbr", "cbz"].contains(fmt) {
            return "book.pages"
        } else {
            return "book.closed"
        }
    }

    private var formatColor: Color {
        let fmt = book.format.lowercased()
        if ["m4b", "mp3", "m4a"].contains(fmt) {
            return .green
        } else if ["cbr", "cbz"].contains(fmt) {
            return .purple
        } else if fmt == "pdf" {
            return .red
        } else if fmt == "epub" {
            return .blue
        } else {
            return .orange
        }
    }
}

#Preview {
    let config = ServerConfig()
    let api = APIService(config: config)

    StorageBreakdownView()
        .environment(DownloadManager(config: config, apiService: api))
        .environment(StorageManager())
        .modelContainer(for: DownloadedBook.self, inMemory: true)
}
