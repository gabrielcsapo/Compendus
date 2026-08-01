//
//  ContinueReadingSection.swift
//  Compendus
//
//  Horizontal scroll of recently read books for quick access
//

import SwiftUI
import SwiftData

/// A book in the Continue Reading section — either downloaded locally or available on the server
enum ContinueReadingItem: Identifiable {
    case downloaded(DownloadedBook)
    case remote(Book)

    var id: String {
        switch self {
        case .downloaded(let book): return book.id
        case .remote(let book): return book.id
        }
    }

    var title: String {
        switch self {
        case .downloaded(let book): return book.title
        case .remote(let book): return book.title
        }
    }

    var format: String {
        switch self {
        case .downloaded(let book): return book.format
        case .remote(let book): return book.format
        }
    }

    var readingProgress: Double {
        switch self {
        case .downloaded(let book): return book.readingProgress
        case .remote(let book): return book.readingProgress ?? 0
        }
    }

    var isAudiobook: Bool {
        switch self {
        case .downloaded(let book): return book.isAudiobook
        case .remote(let book): return book.isAudiobook
        }
    }

    /// Total pages (ebooks only)
    var pageCount: Int? {
        switch self {
        case .downloaded(let book): return book.isAudiobook ? nil : book.pageCount
        case .remote(let book): return book.isAudiobook ? nil : book.pageCount
        }
    }

    /// Total duration in seconds (audiobooks only)
    var duration: Int? {
        switch self {
        case .downloaded(let book): return book.isAudiobook ? book.duration : nil
        case .remote(let book): return book.isAudiobook ? book.duration : nil
        }
    }

    var isDownloaded: Bool {
        if case .downloaded = self { return true }
        return false
    }

    var lastReadAt: Date? {
        switch self {
        case .downloaded(let book):
            return book.lastReadAt
        case .remote(let book):
            guard let str = book.lastReadAt else { return nil }
            return ISO8601DateFormatter().date(from: str)
        }
    }

    /// CCD readiness gate for reflowable ebooks. Returns nil when the book is
    /// readable now (ready/native) — only non-nil for processing/failed
    /// reflowable books so the card can show a subtle state instead of
    /// inviting a tap into a misleading error.
    var ccdGate: (text: String, icon: String)? {
        switch self {
        case .downloaded(let book):
            guard book.isReflowable else { return nil }
            if book.isCcdFailed { return ("Couldn't be prepared", "exclamationmark.triangle") }
            if book.isCcdProcessing { return ("Preparing…", "clock") }
            return nil
        case .remote(let book):
            guard book.isReflowable else { return nil }
            if book.isCcdFailed { return ("Couldn't be prepared", "exclamationmark.triangle") }
            if book.isCcdProcessing { return ("Preparing…", "clock") }
            return nil
        }
    }
}

/// A horizontal scrolling section showing recently read books
struct ContinueReadingSection: View {
    let items: [ContinueReadingItem]
    var onLocalBookTap: ((DownloadedBook) -> Void)?
    var onRemoteBookTap: ((Book) -> Void)?
    var onDownloadBook: ((Book) -> Void)?
    var onMarkAsRead: ((DownloadedBook) -> Void)?
    var onSetAside: ((ContinueReadingItem) -> Void)?
    var onViewDetails: ((DownloadedBook) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // First item as hero card
            if let first = items.first {
                HeroContinueReadingCard(item: first, onTap: {
                    switch first {
                    case .downloaded(let book):
                        onLocalBookTap?(book)
                    case .remote(let book):
                        onRemoteBookTap?(book)
                    }
                }, onDownload: {
                    if case .remote(let book) = first {
                        onDownloadBook?(book)
                    }
                })
                .contextMenu {
                    contextMenuItems(for: first)
                }
                .padding(.horizontal, 20)
            }

            // Remaining items as horizontal scroll
            if items.count > 1 {
                HStack {
                    Text("Also Reading")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(.horizontal, 20)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(items.dropFirst().prefix(9)) { item in
                            ContinueReadingCard(item: item)
                                .onTapGesture {
                                    switch item {
                                    case .downloaded(let book):
                                        onLocalBookTap?(book)
                                    case .remote(let book):
                                        onDownloadBook?(book)
                                    }
                                }
                                .contextMenu {
                                    contextMenuItems(for: item)
                                }
                        }
                    }
                    .padding(.horizontal, 20)
                }
            }
        }
    }

    @ViewBuilder
    private func contextMenuItems(for item: ContinueReadingItem) -> some View {
        switch item {
        case .downloaded(let book):
            Button {
                onLocalBookTap?(book)
            } label: {
                Label(
                    book.isAudiobook ? "Continue Listening" : "Continue Reading",
                    systemImage: book.isAudiobook ? "headphones" : "book"
                )
            }

            Button {
                onMarkAsRead?(book)
            } label: {
                Label(
                    book.isRead ? "Mark as Unread" : "Mark as Read",
                    systemImage: book.isRead ? "checkmark.circle.fill" : "checkmark.circle"
                )
            }

            Button {
                onViewDetails?(book)
            } label: {
                Label("View Details", systemImage: "info.circle")
            }

            Button {
                onSetAside?(item)
            } label: {
                Label("Set Aside", systemImage: "archivebox")
            }

        case .remote(let book):
            Button {
                onDownloadBook?(book)
            } label: {
                Label("Download", systemImage: "arrow.down.circle")
            }

            Button {
                onRemoteBookTap?(book)
            } label: {
                Label("View Details", systemImage: "info.circle")
            }


            Button {
                onSetAside?(item)
            } label: {
                Label("Set Aside", systemImage: "archivebox")
            }
        }
    }
}

/// A compact card for the continue reading section
struct ContinueReadingCard: View {
    let item: ContinueReadingItem

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var coverWidth: CGFloat { LibraryLayout.carouselCoverWidth(horizontalSizeClass) }
    private var coverHeight: CGFloat { LibraryLayout.carouselCoverHeight(horizontalSizeClass) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Cover with progress overlay and download indicator
            ZStack(alignment: .bottom) {
                // Cover image
                coverImage
                    .frame(width: coverWidth, height: coverHeight)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .shadow(color: .black.opacity(0.15), radius: 3, x: 0, y: 2)

                // Progress bar overlay
                if item.readingProgress > 0 {
                    VStack(spacing: 0) {
                        Spacer()
                        GeometryReader { geometry in
                            ZStack(alignment: .leading) {
                                Rectangle()
                                    .fill(Color.black.opacity(0.3))

                                Rectangle()
                                    .fill(Color.accentColor)
                                    .frame(width: geometry.size.width * item.readingProgress)
                            }
                        }
                        .frame(height: 4)
                        .clipShape(RoundedRectangle(cornerRadius: 2))
                    }
                    .padding(4)
                }
            }
            .frame(width: coverWidth, height: coverHeight)
            .overlay(alignment: .topTrailing) {
                // Download badge for remote (not downloaded) books
                if !item.isDownloaded {
                    Image(systemName: "arrow.down.circle.fill")
                        .font(.system(size: 22))
                        .foregroundStyle(.white, Color.accentColor)
                        .padding(4)
                }
            }
            .overlay(alignment: .bottom) {
                // CCD readiness gate — subtle "Preparing…"/"Couldn't be
                // prepared" pill for reflowable books that aren't yet readable.
                if let gate = item.ccdGate {
                    Label(gate.text, systemImage: gate.icon)
                        .font(.caption2.weight(.medium))
                        .lineLimit(1)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(.ultraThinMaterial, in: Capsule())
                        .foregroundStyle(.secondary)
                        .padding(6)
                }
            }

            // Title and progress text
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.caption)
                    .fontWeight(.medium)
                    .lineLimit(2)

                Text(progressLabel)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .frame(width: coverWidth, height: 44, alignment: .topLeading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.title), \(progressLabel)\(item.isDownloaded ? "" : ", available for download")")
        .accessibilityHint(item.isDownloaded
            ? (item.isAudiobook ? "Double tap to continue listening" : "Double tap to continue reading")
            : "Double tap to download book")
    }

    private var progressLabel: String {
        if let duration = item.duration, duration > 0 {
            let remaining = Int(Double(duration) * (1 - item.readingProgress))
            let hours = remaining / 3600
            let minutes = (remaining % 3600) / 60
            return hours > 0 ? "\(hours)h \(minutes)m" : "\(minutes)m"
        } else if let pageCount = item.pageCount, pageCount > 0 {
            let pagesLeft = pageCount - Int(item.readingProgress * Double(pageCount))
            return "\(pagesLeft)p left"
        }
        return "\(Int(item.readingProgress * 100))%"
    }

    @ViewBuilder
    private var coverImage: some View {
        switch item {
        case .downloaded(let book):
            LocalCoverImage(bookId: book.id, coverData: book.coverData, format: book.format)
        case .remote(let book):
            CachedCoverImage(bookId: book.id, hasCover: book.coverUrl != nil, format: book.format)
        }
    }
}

#Preview {
    ContinueReadingSection(
        items: [],
        onLocalBookTap: { book in
            print("Tapped local: \(book.title)")
        },
        onRemoteBookTap: { book in
            print("Tapped remote: \(book.title)")
        }
    )
    .padding(.vertical)
}
