//
//  ReaderContainerView.swift
//  Compendus
//
//  Container that routes to the appropriate reader based on book format
//

import SwiftUI
import SwiftData
import WidgetKit

struct ReaderContainerView: View {
    let book: DownloadedBook

    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext

    var body: some View {
        NavigationStack {
            Group {
                switch book.format.lowercased() {
                case "pdf":
                    PDFReaderView(book: book)
                case "epub":
                    EPUBReaderView(book: book)
                case "mobi", "azw", "azw3":
                    // MOBI should be converted to EPUB on server
                    // For now, show placeholder
                    UnsupportedFormatView(format: book.format, message: "MOBI support requires server-side conversion")
                case "cbr", "cbz":
                    ComicReaderView(book: book)
                case "m4b", "mp3", "m4a":
                    AudiobookPlayerView(book: book)
                default:
                    UnsupportedFormatView(format: book.format, message: "This format is not supported")
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
            .onDisappear {
                // Save reading progress
                book.lastReadAt = Date()
                try? modelContext.save()

                // Update widget data
                updateWidgetData()
            }
        }
    }

    private func updateWidgetData() {
        let widgetBook = WidgetBook(
            id: book.id,
            title: book.title,
            author: book.authorsDisplay,
            format: book.format,
            progress: book.readingProgress,
            coverData: book.coverData,
            lastReadAt: book.lastReadAt ?? Date()
        )
        WidgetDataManager.shared.saveCurrentBook(widgetBook)

        // Reload widget timeline
        WidgetCenter.shared.reloadAllTimelines()
    }
}

struct UnsupportedFormatView: View {
    let format: String
    let message: String

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ContentUnavailableView {
            Label("Unsupported Format", systemImage: "doc.questionmark")
        } description: {
            Text(message)
        } actions: {
            Button("Close") {
                dismiss()
            }
        }
        .navigationTitle(format.uppercased())
        .navigationBarTitleDisplayMode(.inline)
    }
}

#Preview {
    let book = DownloadedBook(
        id: "1",
        title: "Sample Book",
        authors: ["Author"],
        format: "epub",
        fileSize: 1024000,
        localPath: "books/1.epub"
    )

    ReaderContainerView(book: book)
        .modelContainer(for: DownloadedBook.self, inMemory: true)
}
