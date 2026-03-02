//
//  RelatedBooksSection.swift
//  Compendus
//
//  Horizontal scroll of related books (series or author)
//

import SwiftUI

struct RelatedBooksSection: View {
    let title: String
    let books: [Book]
    let currentBookId: String
    var onBookTap: ((Book) -> Void)?

    /// Standard book cover aspect ratio (2:3)
    private let bookAspectRatio: CGFloat = 2/3

    private var filteredBooks: [Book] {
        books.filter { $0.id != currentBookId }
    }

    var body: some View {
        if !filteredBooks.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text(title)
                    .font(.headline)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(filteredBooks) { book in
                            relatedBookItem(book)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func relatedBookItem(_ book: Book) -> some View {
        Button {
            onBookTap?(book)
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                CachedCoverImage(bookId: book.id, hasCover: book.coverUrl != nil, format: book.format)
                    .aspectRatio(bookAspectRatio, contentMode: .fit)
                    .frame(width: 100)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.medium))
                    .shadow(Shadow.light)

                Text(book.title)
                    .font(.caption)
                    .fontWeight(.medium)
                    .lineLimit(2)
                    .foregroundStyle(.primary)

                Text(book.authorsDisplay)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .frame(width: 100)
        }
        .buttonStyle(.plain)
    }
}
