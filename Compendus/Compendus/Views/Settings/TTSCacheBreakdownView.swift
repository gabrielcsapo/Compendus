//
//  TTSCacheBreakdownView.swift
//  Compendus
//
//  Shows per-book TTS cache and transcription data with swipe-to-delete
//

import SwiftUI
import SwiftData

struct TTSCacheBreakdownView: View {
    @Environment(StorageManager.self) private var storageManager
    @Environment(ServerConfig.self) private var serverConfig
    @Environment(\.modelContext) private var modelContext

    @Query private var allBooks: [DownloadedBook]

    private var books: [DownloadedBook] {
        let pid = serverConfig.selectedProfileId ?? ""
        return allBooks.filter { $0.profileId == pid || $0.profileId.isEmpty }
    }

    @State private var ttsCachedBooks: [CachedBookInfo] = []
    @State private var transcribedBooks: [TranscribedBookInfo] = []
    @State private var bookToDeleteTTS: CachedBookInfo?
    @State private var bookToDeleteTranscript: TranscribedBookInfo?
    @State private var showingDeleteTTSConfirmation = false
    @State private var showingDeleteTranscriptConfirmation = false
    @State private var showingClearAllConfirmation = false

    struct CachedBookInfo: Identifiable {
        let id: String
        let title: String
        let authors: String
        let cacheSize: Int64
        let chapterCount: Int
    }

    struct TranscribedBookInfo: Identifiable {
        let id: String
        let title: String
        let authors: String
        let dataSize: Int
        let book: DownloadedBook
        let isWhisper: Bool // true = audiobook transcript, false = TTS transcript
    }

    private var totalSize: Int64 {
        let ttsBytes = storageManager.ttsCacheSize()
        let transcriptBytes = Int64(transcribedBooks.reduce(0) { $0 + $1.dataSize })
        return ttsBytes + transcriptBytes
    }

    var body: some View {
        List {
            // Summary
            Section {
                HStack {
                    Text("Total Generated Data")
                    Spacer()
                    Text(ByteCountFormatter.string(fromByteCount: totalSize, countStyle: .file))
                        .fontWeight(.semibold)
                }
            }

            // TTS Audio Cache
            Section {
                if ttsCachedBooks.isEmpty {
                    Text("No cached TTS audio")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(ttsCachedBooks) { entry in
                        CacheBookRow(
                            icon: "waveform",
                            iconColor: .orange,
                            title: entry.title,
                            subtitle: "\(entry.authors) · \(entry.chapterCount) chapter\(entry.chapterCount == 1 ? "" : "s")",
                            size: entry.cacheSize
                        )
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                bookToDeleteTTS = entry
                                showingDeleteTTSConfirmation = true
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                }
            } header: {
                Text("Text-to-Speech Audio")
            } footer: {
                Text("Pre-generated read-aloud audio for eBooks. Runs on-device while connected to power.")
            }

            // Transcription Data
            Section {
                if transcribedBooks.isEmpty {
                    Text("No transcription data")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(transcribedBooks) { entry in
                        CacheBookRow(
                            icon: entry.isWhisper ? "ear" : "text.quote",
                            iconColor: entry.isWhisper ? .blue : .green,
                            title: entry.title,
                            subtitle: "\(entry.authors) · \(entry.isWhisper ? "Whisper" : "TTS") transcript",
                            size: Int64(entry.dataSize)
                        )
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                bookToDeleteTranscript = entry
                                showingDeleteTranscriptConfirmation = true
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                }
            } header: {
                Text("Transcriptions")
            } footer: {
                Text("Word-level transcripts for read-along sync. Whisper transcriptions run on-device while connected to power.")
            }

            // Clear all
            if !ttsCachedBooks.isEmpty || !transcribedBooks.isEmpty {
                Section {
                    Button(role: .destructive) {
                        showingClearAllConfirmation = true
                    } label: {
                        Label("Clear All Generated Data", systemImage: "trash.fill")
                    }
                }
            }
        }
        .navigationTitle("Generated Data")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { refreshLists() }
        .confirmationDialog(
            "Delete TTS Cache?",
            isPresented: $showingDeleteTTSConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let entry = bookToDeleteTTS {
                    try? storageManager.clearTTSCache(for: entry.id)
                    refreshLists()
                }
                bookToDeleteTTS = nil
            }
            Button("Cancel", role: .cancel) {
                bookToDeleteTTS = nil
            }
        } message: {
            if let entry = bookToDeleteTTS {
                Text("This will remove cached read-along audio for \"\(entry.title)\" and free up \(ByteCountFormatter.string(fromByteCount: entry.cacheSize, countStyle: .file)).")
            }
        }
        .confirmationDialog(
            "Delete Transcript?",
            isPresented: $showingDeleteTranscriptConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let entry = bookToDeleteTranscript {
                    if entry.isWhisper {
                        entry.book.transcriptData = nil
                    } else {
                        entry.book.ttsTranscriptData = nil
                        entry.book.ttsVoiceId = nil
                    }
                    try? modelContext.save()
                    refreshLists()
                }
                bookToDeleteTranscript = nil
            }
            Button("Cancel", role: .cancel) {
                bookToDeleteTranscript = nil
            }
        } message: {
            if let entry = bookToDeleteTranscript {
                Text("This will remove the \(entry.isWhisper ? "Whisper" : "TTS") transcript for \"\(entry.title)\". It can be regenerated.")
            }
        }
        .confirmationDialog(
            "Clear All Generated Data?",
            isPresented: $showingClearAllConfirmation,
            titleVisibility: .visible
        ) {
            Button("Clear All", role: .destructive) {
                try? storageManager.clearTTSCache()
                for book in books {
                    book.transcriptData = nil
                    book.ttsTranscriptData = nil
                    book.ttsVoiceId = nil
                }
                try? modelContext.save()
                refreshLists()
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This will remove all TTS audio cache and transcription data. They can be regenerated when needed.")
        }
    }

    // MARK: - Data Loading

    private func refreshLists() {
        refreshTTSCache()
        refreshTranscriptions()
    }

    private func refreshTTSCache() {
        let bookIds = storageManager.ttsCacheBookIds()
        let bookMap = Dictionary(uniqueKeysWithValues: books.map { ($0.id, $0) })

        ttsCachedBooks = bookIds.compactMap { bookId in
            let size = storageManager.ttsCacheSize(for: bookId)
            guard size > 0 else { return nil }

            let book = bookMap[bookId]
            let title = book?.title ?? "Unknown Book"
            let authors = book?.authors.joined(separator: ", ") ?? bookId

            let cacheDir = storageManager.ttsCacheURL.appendingPathComponent(bookId, isDirectory: true)
            let chapterCount = (try? FileManager.default.contentsOfDirectory(at: cacheDir, includingPropertiesForKeys: nil))?
                .filter { $0.pathExtension == "pcm" }.count ?? 0

            return CachedBookInfo(
                id: bookId,
                title: title,
                authors: authors,
                cacheSize: size,
                chapterCount: chapterCount
            )
        }
        .sorted { $0.cacheSize > $1.cacheSize }
    }

    private func refreshTranscriptions() {
        var results: [TranscribedBookInfo] = []

        for book in books {
            let authors = book.authors.isEmpty ? "Unknown Author" : book.authors.joined(separator: ", ")

            if let data = book.transcriptData {
                results.append(TranscribedBookInfo(
                    id: "\(book.id)-whisper",
                    title: book.title,
                    authors: authors,
                    dataSize: data.count,
                    book: book,
                    isWhisper: true
                ))
            }

            if let data = book.ttsTranscriptData {
                results.append(TranscribedBookInfo(
                    id: "\(book.id)-tts",
                    title: book.title,
                    authors: authors,
                    dataSize: data.count,
                    book: book,
                    isWhisper: false
                ))
            }
        }

        transcribedBooks = results.sorted { $0.dataSize > $1.dataSize }
    }
}

// MARK: - Shared Row

private struct CacheBookRow: View {
    let icon: String
    let iconColor: Color
    let title: String
    let subtitle: String
    let size: Int64

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(iconColor)
                .frame(width: 32)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline)
                    .lineLimit(1)

                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            Text(ByteCountFormatter.string(fromByteCount: size, countStyle: .file))
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    NavigationStack {
        TTSCacheBreakdownView()
            .environment(StorageManager())
            .modelContainer(for: DownloadedBook.self, inMemory: true)
    }
}
