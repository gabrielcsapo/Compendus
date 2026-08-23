//
//  BookCoverView.swift
//  Compendus
//
//  Async cover image view with caching
//

import SwiftUI

private struct BookObjectModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme

    let cornerRadius: CGFloat

    private var shape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: cornerRadius * 0.72,
            bottomLeadingRadius: cornerRadius * 0.72,
            bottomTrailingRadius: cornerRadius * 1.18,
            topTrailingRadius: cornerRadius * 1.18
        )
    }

    func body(content: Content) -> some View {
        content
            .clipShape(shape)
            .overlay(alignment: .leading) {
                ZStack(alignment: .leading) {
                    LinearGradient(
                        colors: [
                            .black.opacity(colorScheme == .dark ? 0.28 : 0.22),
                            .white.opacity(0.10),
                            .clear
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .frame(width: max(11, cornerRadius * 1.5))

                    Rectangle()
                        .fill(.white.opacity(0.28))
                        .frame(width: 0.75)
                        .offset(x: max(8, cornerRadius * 1.05))
                }
                .allowsHitTesting(false)
            }
            .background(alignment: .bottomTrailing) {
                shape
                    .fill(
                        colorScheme == .dark
                            ? Color(red: 0.58, green: 0.56, blue: 0.51)
                            : Color(red: 0.94, green: 0.91, blue: 0.84)
                    )
                    .overlay {
                        VStack(spacing: 2) {
                            ForEach(0..<5, id: \.self) { _ in
                                Rectangle()
                                    .fill(.black.opacity(0.07))
                                    .frame(height: 0.5)
                            }
                        }
                        .padding(.vertical, cornerRadius)
                    }
                    .clipShape(shape)
                    .offset(x: 3, y: 3)
            }
            .compositingGroup()
            .shadow(color: .black.opacity(colorScheme == .dark ? 0.32 : 0.18), radius: 10, x: 0, y: 8)
            .shadow(color: .black.opacity(0.10), radius: 2, x: 0, y: 2)
    }
}

extension View {
    func bookObjectStyle(cornerRadius: CGFloat = 8) -> some View {
        modifier(BookObjectModifier(cornerRadius: cornerRadius))
    }
}

struct BookCoverView: View {
    let bookId: String
    let format: String
    var hasCover: Bool = true

    /// Standard book cover aspect ratio (2:3)
    private let bookAspectRatio: CGFloat = 2/3

    var body: some View {
        CachedCoverImage(bookId: bookId, hasCover: hasCover, format: format)
            .aspectRatio(bookAspectRatio, contentMode: .fit)
            .bookObjectStyle()
    }
}

/// Cover view for downloaded books using cached data
struct DownloadedBookCoverView: View {
    let book: DownloadedBook

    /// Standard book cover aspect ratio (2:3)
    private let bookAspectRatio: CGFloat = 2/3

    var body: some View {
        LocalCoverImage(bookId: book.id, coverData: book.coverData, format: book.format)
            .aspectRatio(bookAspectRatio, contentMode: .fit)
            .bookObjectStyle()
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
