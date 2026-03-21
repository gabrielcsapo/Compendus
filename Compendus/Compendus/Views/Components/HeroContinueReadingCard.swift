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
                    Text("CONTINUE READING")
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

                    ProgressView(value: item.readingProgress)
                        .tint(.accentColor)

                    Text("\(Int(item.readingProgress * 100))% complete")
                        .font(.caption2)
                        .foregroundStyle(.secondary)

                    Button(action: onTap) {
                        Text(item.isAudiobook ? "Continue Listening" : "Continue")
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
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

    private var authorText: String {
        switch item {
        case .downloaded(let book): return book.authorsDisplay
        case .remote(let book): return book.authorsDisplay
        }
    }
}
