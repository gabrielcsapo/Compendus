//
//  SeriesGridItem.swift
//  Compendus
//
//  Grid item component for displaying a series with fanned book covers
//

import SwiftUI

struct SeriesGridItem: View {
    let series: SeriesItem

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            FannedCoverStack(count: series.coverBooks.count) { index in
                CachedCoverImage(bookId: series.coverBooks[index].id, hasCover: series.coverBooks[index].coverUrl != nil)
            }
            .padding(.horizontal)

            // Series name and count
            VStack(alignment: .leading, spacing: 2) {
                Text(series.name)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(2)

                Text("\(series.bookCount) \(series.bookCount == 1 ? "book" : "books")")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(series.name) series, \(series.bookCount) books")
        .accessibilityHint("Double tap to view books in this series")
    }
}

#Preview {
    let series = SeriesItem(
        name: "The Expanse",
        bookCount: 5,
        coverBooks: [
            SeriesCoverBook(id: "1", coverUrl: nil),
            SeriesCoverBook(id: "2", coverUrl: nil),
            SeriesCoverBook(id: "3", coverUrl: nil),
        ]
    )

    SeriesGridItem(series: series)
        .environment(ServerConfig())
        .environment(ImageCache())
        .frame(width: 180)
        .padding()
}
