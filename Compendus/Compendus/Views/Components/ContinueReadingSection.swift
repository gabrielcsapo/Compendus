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
}

/// A horizontal scrolling section showing recently read books
struct ContinueReadingSection: View {
    let items: [ContinueReadingItem]
    var onLocalBookTap: ((DownloadedBook) -> Void)?
    var onRemoteBookTap: ((Book) -> Void)?
    var onMarkAsRead: ((DownloadedBook) -> Void)?
    var onViewDetails: ((DownloadedBook) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Continue Reading")
                    .font(.title3)
                    .fontWeight(.semibold)

                Spacer()

                if items.count > 3 {
                    Text("\(items.count) books")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 20)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(items.prefix(10)) { item in
                        ContinueReadingCard(item: item)
                            .onTapGesture {
                                switch item {
                                case .downloaded(let book):
                                    onLocalBookTap?(book)
                                case .remote(let book):
                                    onRemoteBookTap?(book)
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

        case .remote(let book):
            Button {
                onRemoteBookTap?(book)
            } label: {
                Label("View Details", systemImage: "info.circle")
            }
        }
    }
}

/// A compact card for the continue reading section
struct ContinueReadingCard: View {
    let item: ContinueReadingItem

    /// Standard book cover aspect ratio (2:3)
    private let bookAspectRatio: CGFloat = 2/3

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Cover with progress overlay and download indicator
            ZStack(alignment: .bottom) {
                // Cover image
                coverImage
                    .frame(width: 100, height: 150)
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
            .frame(width: 100, height: 150)
            .overlay(alignment: .topTrailing) {
                // Download icon for remote (not downloaded) books
                if !item.isDownloaded {
                    Image(systemName: "icloud.and.arrow.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(5)
                        .background(Circle().fill(Color.black.opacity(0.6)))
                        .padding(4)
                }
            }

            // Title and progress text
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.caption)
                    .fontWeight(.medium)
                    .lineLimit(2)

                HStack(spacing: 4) {
                    FormatBadgeView(format: item.format, size: .compact)

                    Text("\(Int(item.readingProgress * 100))%")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 100, height: 44, alignment: .topLeading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.title), \(Int(item.readingProgress * 100))% complete\(item.isDownloaded ? "" : ", available for download")")
        .accessibilityHint(item.isDownloaded
            ? (item.isAudiobook ? "Double tap to continue listening" : "Double tap to continue reading")
            : "Double tap to view book details")
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
