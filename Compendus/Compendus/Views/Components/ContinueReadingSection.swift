//
//  ContinueReadingSection.swift
//  Compendus
//
//  Horizontal scroll of recently read books for quick access
//

import SwiftUI
import SwiftData

/// A horizontal scrolling section showing recently read books
struct ContinueReadingSection: View {
    let books: [DownloadedBook]
    var onBookTap: ((DownloadedBook) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Continue Reading")
                    .font(.title3)
                    .fontWeight(.semibold)

                Spacer()

                if books.count > 3 {
                    Text("\(books.count) books")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 20)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(books.prefix(10)) { book in
                        ContinueReadingCard(book: book)
                            .onTapGesture {
                                onBookTap?(book)
                            }
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }
}

/// A compact card for the continue reading section
struct ContinueReadingCard: View {
    let book: DownloadedBook

    /// Standard book cover aspect ratio (2:3)
    private let bookAspectRatio: CGFloat = 2/3

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Cover with progress overlay
            ZStack(alignment: .bottom) {
                // Cover image
                Group {
                    if let coverData = book.coverData, let uiImage = UIImage(data: coverData) {
                        Image(uiImage: uiImage)
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    } else {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.gray.opacity(0.2))
                            .overlay {
                                Image(systemName: bookIcon)
                                    .font(.title)
                                    .foregroundStyle(.secondary)
                            }
                    }
                }
                .frame(width: 100, height: 150)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .shadow(color: .black.opacity(0.15), radius: 3, x: 0, y: 2)

                // Progress bar overlay
                if book.readingProgress > 0 {
                    VStack(spacing: 0) {
                        Spacer()
                        GeometryReader { geometry in
                            ZStack(alignment: .leading) {
                                Rectangle()
                                    .fill(Color.black.opacity(0.3))

                                Rectangle()
                                    .fill(Color.accentColor)
                                    .frame(width: geometry.size.width * book.readingProgress)
                            }
                        }
                        .frame(height: 4)
                        .clipShape(RoundedRectangle(cornerRadius: 2))
                    }
                    .padding(4)
                }
            }
            .frame(width: 100, height: 150)

            // Title and progress text
            VStack(alignment: .leading, spacing: 2) {
                Text(book.title)
                    .font(.caption)
                    .fontWeight(.medium)
                    .lineLimit(2)
                    .frame(width: 100, alignment: .leading)

                HStack(spacing: 4) {
                    formatBadge

                    Text("\(Int(book.readingProgress * 100))%")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(book.title), \(Int(book.readingProgress * 100))% complete")
        .accessibilityHint(book.isAudiobook ? "Double tap to continue listening" : "Double tap to continue reading")
    }

    private var bookIcon: String {
        if book.isAudiobook {
            return "headphones"
        } else if book.isComic {
            return "book.pages"
        } else {
            return "book.closed"
        }
    }

    @ViewBuilder
    private var formatBadge: some View {
        FormatBadgeView(format: book.format, size: .compact)
    }
}

#Preview {
    // Create sample downloaded books for preview
    ContinueReadingSection(
        books: [],
        onBookTap: { book in
            print("Tapped: \(book.title)")
        }
    )
    .padding(.vertical)
}
