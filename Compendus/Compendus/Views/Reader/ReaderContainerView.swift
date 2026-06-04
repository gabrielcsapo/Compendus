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
            let now = Date()
            book.lastReadAt = now
            book.localProgressUpdatedAt = now
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

    @Environment(\.modelContext) private var modelContext

    /// Gate state: hold the reader until we've decided where to open, so we never
    /// load this device's position and then jump (which would flash/reflow).
    @State private var decided = false
    @State private var resolvedPosition: String?
    @State private var pendingJump: DeviceReadingPosition?

    /// Another device is "meaningfully further" if it leads by more than this.
    private let jumpThreshold: Double = 0.02

    var body: some View {
        Group {
            if decided {
                reader(initialPosition: resolvedPosition)
            } else {
                // Brief neutral placeholder while resolving the start position.
                Color(.systemBackground).ignoresSafeArea()
            }
        }
        .task { resolveStartPosition() }
        .alert(
            "Pick up where you left off?",
            isPresented: Binding(
                get: { pendingJump != nil },
                set: { if !$0 { pendingJump = nil } }
            ),
            presenting: pendingJump
        ) { candidate in
            Button("Go to \(candidate.deviceName) · \(Int(candidate.readingProgress * 100))%") {
                resolvedPosition = candidate.lastPosition
                decided = true
            }
            Button("Stay here · \(Int(book.readingProgress * 100))%", role: .cancel) {
                decided = true
            }
        } message: { candidate in
            Text("Your \(candidate.deviceName) is further along at \(Int(candidate.readingProgress * 100))%.")
        }
    }

    @ViewBuilder
    private func reader(initialPosition: String?) -> some View {
        switch book.format.lowercased() {
        case "pdf", "epub", "mobi", "azw", "azw3":
            // All reflowable formats (incl. mobi/azw3) + PDF read through the CCD
            // pack via UnifiedReaderView — books are converted to CCD server-side,
            // so there's no on-device EPUB conversion. If the pack isn't ready yet,
            // UnifiedReaderView shows the accurate "still being prepared" gate.
            ReaderShell(book: book, showsDismissButton: false) {
                UnifiedReaderView(book: book, preferEpub: preferEpub, initialPosition: initialPosition)
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

    /// Decide where to open. If a specific position was requested (e.g. a
    /// highlight) honor it. Otherwise, if another device is meaningfully further
    /// along, prompt to jump; if not, open this device's own position.
    private func resolveStartPosition() {
        guard !decided, pendingJump == nil else { return }
        resolvedPosition = initialPosition

        // Explicit position (highlight/bookmark) or audiobooks (own player) skip the prompt.
        let fmt = book.format.lowercased()
        let isAudio = ["m4b", "mp3", "m4a"].contains(fmt)
        if initialPosition != nil || isAudio {
            decided = true
            return
        }

        let bookId = book.id
        let ownDeviceId = DeviceIdentity.deviceId
        let descriptor = FetchDescriptor<DeviceReadingPosition>(
            predicate: #Predicate { $0.bookId == bookId && $0.deviceId != ownDeviceId }
        )
        let others = (try? modelContext.fetch(descriptor)) ?? []
        let candidate = others
            .filter { $0.lastPosition != nil && $0.readingProgress > book.readingProgress + jumpThreshold }
            .max { $0.readingProgress < $1.readingProgress }

        if let candidate {
            pendingJump = candidate
        } else {
            decided = true
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
