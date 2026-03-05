//
//  DownloadedSeriesGridItem.swift
//  Compendus
//
//  Grid item for displaying a series from downloaded books with fanned covers
//

import SwiftUI

struct DownloadedSeriesCoverBook: Identifiable {
    let id: String
    let coverData: Data?
}

struct DownloadedSeriesItem: Identifiable {
    var id: String { name }
    let name: String
    let bookCount: Int
    let coverBooks: [DownloadedSeriesCoverBook]
}

struct DownloadedSeriesGridItem: View {
    let series: DownloadedSeriesItem

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            FannedCoverStack(count: series.coverBooks.count) { index in
                coverContent(series.coverBooks[index])
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
            .frame(height: 52, alignment: .topLeading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(series.name) series, \(series.bookCount) books")
        .accessibilityHint("Double tap to view books in this series")
    }

    @ViewBuilder
    private func coverContent(_ book: DownloadedSeriesCoverBook) -> some View {
        LocalCoverImage(bookId: book.id, coverData: book.coverData)
    }
}

#Preview {
    let series = DownloadedSeriesItem(
        name: "The Expanse",
        bookCount: 5,
        coverBooks: [
            DownloadedSeriesCoverBook(id: "1", coverData: nil),
            DownloadedSeriesCoverBook(id: "2", coverData: nil),
            DownloadedSeriesCoverBook(id: "3", coverData: nil),
        ]
    )

    DownloadedSeriesGridItem(series: series)
        .frame(width: 180)
        .padding()
}
