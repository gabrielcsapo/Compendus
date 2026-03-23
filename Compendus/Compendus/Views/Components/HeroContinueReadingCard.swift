//
//  HeroContinueReadingCard.swift
//  Compendus
//
//  Full-width hero card for the top continue reading item
//

import SwiftUI
import SwiftData

struct HeroContinueReadingCard: View {
    let item: ContinueReadingItem
    var onTap: () -> Void
    var onDownload: (() -> Void)?

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 16) {
                // Cover image
                coverImage
                    .frame(width: 90, height: 135)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .shadow(color: .black.opacity(0.15), radius: 4, x: 0, y: 2)

                // Info
                VStack(alignment: .leading, spacing: 6) {
                    Text(item.isDownloaded ? "CONTINUE READING" : "NEEDS DOWNLOAD")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .kerning(0.5)

                    Text(item.title)
                        .font(.title3)
                        .fontWeight(.bold)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(authorText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)

                    Spacer(minLength: 4)

                    if item.readingProgress > 0 {
                        ProgressView(value: item.readingProgress)
                            .tint(.accentColor)

                        Text(progressLabel)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }

                    if item.isDownloaded {
                        Button(action: onTap) {
                            Text(item.isAudiobook ? "Continue Listening" : "Continue")
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                    } else {
                        Button {
                            onDownload?()
                        } label: {
                            Label("Download", systemImage: "arrow.down.circle")
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(16)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color(.secondarySystemGroupedBackground))
                    .shadow(color: .black.opacity(0.08), radius: 6, x: 0, y: 2)
            )
        }
        .buttonStyle(.plain)
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

    private var progressLabel: String {
        if let duration = item.duration, duration > 0 {
            let remaining = Int(Double(duration) * (1 - item.readingProgress))
            let hours = remaining / 3600
            let minutes = (remaining % 3600) / 60
            let timeText = hours > 0 ? "\(hours)h \(minutes)m" : "\(minutes)m"
            return "\(timeText) left"
        } else if let pageCount = item.pageCount, pageCount > 0 {
            let pagesLeft = pageCount - Int(item.readingProgress * Double(pageCount))
            return "\(pagesLeft) pages left"
        }
        return "\(Int(item.readingProgress * 100))% complete"
    }

    private var authorText: String {
        switch item {
        case .downloaded(let book): return book.authorsDisplay
        case .remote(let book): return book.authorsDisplay
        }
    }
}
