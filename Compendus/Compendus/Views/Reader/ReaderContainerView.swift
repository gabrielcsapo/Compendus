//
//  ReaderContainerView.swift
//  Compendus
//
//  Container that routes to the appropriate reader based on book format.
//  ReaderShell provides shared chrome (dismiss button, onDisappear lifecycle)
//  for all reader types.
//

import SwiftUI
import SwiftData
import WidgetKit

// MARK: - Reader Shell

struct ReaderShell<Content: View>: View {
    let book: DownloadedBook
    let showsDismissButton: Bool
    @ViewBuilder let content: () -> Content

    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext

    var body: some View {
        ZStack(alignment: .topLeading) {
            content()

            if showsDismissButton {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.primary)
                        .frame(width: 32, height: 32)
                        .background(.ultraThinMaterial)
                        .clipShape(Circle())
                }
                .padding(.leading, 16)
                .padding(.top, 12)
            }
        }
        .onDisappear {
            book.lastReadAt = Date()
            do {
                try modelContext.save()
            } catch {
                print("[ReaderShell] Failed to save reading progress: \(error)")
            }
            updateWidgetData()
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
        WidgetCenter.shared.reloadAllTimelines()
    }
}

// MARK: - Reader Container

struct ReaderContainerView: View {
    let book: DownloadedBook
    var preferEpub: Bool = false
    /// Optional position to open at (e.g. from a highlight). Overrides lastPosition.
    var initialPosition: String? = nil

    var body: some View {
        switch book.format.lowercased() {
        case "pdf", "epub":
            ReaderShell(book: book, showsDismissButton: false) {
                UnifiedReaderView(book: book, preferEpub: preferEpub, initialPosition: initialPosition)
            }
        case "mobi", "azw", "azw3":
            // MOBI books are converted to EPUB on download. This case handles
            // books downloaded before conversion support was added.
            if book.hasEpubVersion {
                ReaderShell(book: book, showsDismissButton: false) {
                    UnifiedReaderView(book: book, preferEpub: true, initialPosition: initialPosition)
                }
            } else {
                ReaderShell(book: book, showsDismissButton: false) {
                    UnsupportedFormatView(format: book.format, message: "Please re-download this book to convert it to EPUB.")
                }
            }
        case "cbr", "cbz":
            ReaderShell(book: book, showsDismissButton: false) {
                UnifiedReaderView(book: book, initialPosition: initialPosition)
            }
        case "m4b", "mp3", "m4a":
            ReaderShell(book: book, showsDismissButton: true) {
                AudiobookPlayerView(book: book)
            }
        default:
            ReaderShell(book: book, showsDismissButton: false) {
                UnsupportedFormatView(format: book.format, message: "This format is not supported")
            }
        }
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
