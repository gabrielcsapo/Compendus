//
//  BookCoverView.swift
//  Compendus
//
//  Async cover image view with caching
//

import SwiftUI

struct BookCoverView: View {
    let bookId: String
    let format: String
    var hasCover: Bool = true

    /// Standard book cover aspect ratio (2:3)
    private let bookAspectRatio: CGFloat = 2/3

    var body: some View {
        CachedCoverImage(bookId: bookId, hasCover: hasCover, format: format)
            .aspectRatio(bookAspectRatio, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .shadow(color: .black.opacity(0.15), radius: 3, x: 0, y: 2)
    }
}

/// Cover view for downloaded books using cached data
struct DownloadedBookCoverView: View {
    let book: DownloadedBook

    /// Standard book cover aspect ratio (2:3)
    private let bookAspectRatio: CGFloat = 2/3

    var body: some View {
        Group {
            if let coverData = book.coverData, let uiImage = UIImage(data: coverData) {
                Color.clear
                    .overlay {
                        Image(uiImage: uiImage)
                            .resizable()
                            .scaledToFill()
                    }
                    .clipped()
            } else {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color(.systemGray5))
                    .overlay {
                        Image(systemName: iconForFormat)
                            .font(.largeTitle)
                            .foregroundStyle(.secondary)
                    }
            }
        }
        .aspectRatio(bookAspectRatio, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .shadow(color: .black.opacity(0.15), radius: 3, x: 0, y: 2)
    }

    private var iconForFormat: String {
        switch book.format.lowercased() {
        case "m4b", "mp3", "m4a":
            return "headphones"
        case "cbr", "cbz":
            return "book.pages"
        case "pdf":
            return "doc.richtext"
        default:
            return "book.closed"
        }
    }
}

#Preview {
    VStack {
        BookCoverView(bookId: "test", format: "epub")
            .frame(width: 150, height: 200)
            .clipShape(RoundedRectangle(cornerRadius: 8))

        BookCoverView(bookId: "test", format: "m4b")
            .frame(width: 150, height: 200)
            .clipShape(RoundedRectangle(cornerRadius: 8))
    }
    .environment(ServerConfig())
    .environment(ImageCache())
    .padding()
}
