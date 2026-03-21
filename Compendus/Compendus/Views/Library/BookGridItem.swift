//
//  BookGridItem.swift
//  Compendus
//
//  Grid item component for displaying a book
//

import SwiftUI

struct BookGridItem: View {
    let book: Book
    var isDownloaded: Bool = false
    var onSeriesTap: ((String) -> Void)?

    /// Standard book cover aspect ratio (2:3)
    private let bookAspectRatio: CGFloat = 2/3

    /// Whether to show server-side reading progress (only for non-downloaded books)
    private var showServerProgress: Bool {
        !isDownloaded && book.hasServerProgress
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Cover image with overlays
            CachedCoverImage(bookId: book.id, hasCover: book.coverUrl != nil, format: book.format)
            .aspectRatio(bookAspectRatio, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .shadow(color: .black.opacity(0.15), radius: 3, x: 0, y: 2)
            .overlay(alignment: .topTrailing) {
                if isDownloaded {
                    Image(systemName: "arrow.down.circle.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(.white)
                        .background(Circle().fill(Color.accentColor).padding(2))
                        .padding(6)
                }
            }
            .overlay(alignment: .topLeading) {
                if !isDownloaded && book.isRead == true {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(.white)
                        .background(Circle().fill(Color.green).padding(-2))
                        .padding(6)
                }
            }
            .overlay(alignment: .bottom) {
                // Thin progress bar at bottom of cover for undownloaded books with server progress
                if showServerProgress, let progress = book.readingProgress {
                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            Rectangle()
                                .fill(Color.black.opacity(0.3))

                            Rectangle()
                                .fill(Color.accentColor)
                                .frame(width: geometry.size.width * progress)
                        }
                    }
                    .frame(height: 4)
                    .clipShape(RoundedRectangle(cornerRadius: 2))
                    .padding(4)
                }
            }

            // Title and author
            VStack(alignment: .leading, spacing: 2) {
                Text(book.title)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(2)

                Text(book.authorsDisplay)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                if let series = book.series {
                    Text(book.seriesNumber != nil ? "#\(book.seriesNumber!) in \(series)" : series)
                        .font(.caption2)
                        .foregroundStyle(.tint)
                        .lineLimit(1)
                        .onTapGesture {
                            onSeriesTap?(series)
                        }
                }

                HStack(spacing: 4) {
                    formatBadge

                    if book.isAudiobook, let duration = book.durationDisplay {
                        Text(duration)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }

                    if showServerProgress {
                        Text("\(book.readingProgressPercent)%")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }

                if !isDownloaded, let rating = book.rating, rating > 0 {
                    HStack(spacing: 1) {
                        ForEach(1...5, id: \.self) { star in
                            Image(systemName: star <= rating ? "star.fill" : "star")
                                .font(.system(size: 8))
                                .foregroundStyle(star <= rating ? .yellow : .secondary.opacity(0.3))
                        }
                    }
                }
            }
            .frame(height: 80, alignment: .topLeading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
        .accessibilityHint("Double tap to view details")
    }

    private var accessibilityText: String {
        var label = "\(book.title) by \(book.authorsDisplay), \(book.formatDisplay) format"
        if let series = book.series {
            label += ", \(series) series"
        }
        if showServerProgress {
            label += ", \(book.readingProgressPercent)% complete"
        }
        if book.isRead == true {
            label += ", finished"
        }
        return label
    }

    @ViewBuilder
    private var formatBadge: some View {
        let info = FormatInfo.from(format: book.format)
        FormatBadgeView(
            format: book.format,
            size: .standard,
            showConversionHint: info.isConvertible && !book.hasEpubVersion
        )
    }
}

/// Grid item for downloaded books
struct DownloadedBookGridItem: View {
    let book: DownloadedBook
    var onSeriesTap: ((String) -> Void)?

    /// Standard book cover aspect ratio (2:3)
    private let bookAspectRatio: CGFloat = 2/3

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Cover image
            LocalCoverImage(bookId: book.id, coverData: book.coverData, format: book.format)
            .aspectRatio(bookAspectRatio, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .shadow(color: .black.opacity(0.15), radius: 3, x: 0, y: 2)
            .overlay(alignment: .topLeading) {
                if book.isRead {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(.white)
                        .background(Circle().fill(Color.green).padding(-2))
                        .padding(6)
                }
            }
            .overlay(alignment: .bottom) {
                if book.readingProgress > 0 && book.readingProgress < 1.0 {
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
                    .padding(4)
                }
            }

            // Title and author
            VStack(alignment: .leading, spacing: 2) {
                Text(book.title)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(2)

                Text(book.authorsDisplay)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                if let series = book.series {
                    Text(book.seriesNumber != nil ? "#\(Int(book.seriesNumber!)) in \(series)" : series)
                        .font(.caption2)
                        .foregroundStyle(.tint)
                        .lineLimit(1)
                        .onTapGesture {
                            onSeriesTap?(series)
                        }
                }

                HStack(spacing: 4) {
                    formatBadge
                }

                if let rating = book.rating {
                    HStack(spacing: 1) {
                        ForEach(1...5, id: \.self) { star in
                            Image(systemName: star <= rating ? "star.fill" : "star")
                                .font(.system(size: 8))
                                .foregroundStyle(star <= rating ? .yellow : .secondary.opacity(0.3))
                        }
                    }
                }
            }
            .frame(height: 80, alignment: .topLeading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(book.title) by \(book.authorsDisplay), \(book.formatDisplay) format, \(Int(book.readingProgress * 100))% complete\(book.series != nil ? ", \(book.series!) series" : "")")
        .accessibilityHint("Double tap to view details")
    }

    @ViewBuilder
    private var formatBadge: some View {
        FormatBadgeView(format: book.format, size: .standard)
    }
}

#Preview {
    let book = Book(
        id: "1",
        title: "Sample Book Title That Is Very Long",
        subtitle: nil,
        authors: ["Author Name"],
        publisher: nil,
        publishedDate: nil,
        description: nil,
        isbn: nil,
        isbn10: nil,
        isbn13: nil,
        language: nil,
        pageCount: 300,
        format: "epub",
        series: nil,
        seriesNumber: nil,
        coverUrl: nil,
        addedAt: nil,
        fileSize: 1024000
    )

    BookGridItem(book: book)
        .environment(ServerConfig())
        .environment(ImageCache())
        .frame(width: 180)
        .padding()
}
