//
//  CachedCoverImage.swift
//  Compendus
//
//  Cover image view backed by disk + memory cache
//

import SwiftUI

struct CachedCoverImage: View {
    let bookId: String
    let hasCover: Bool
    var format: String = "epub"
    var useThumbnail: Bool = true

    @Environment(ImageCache.self) private var imageCache
    @Environment(ServerConfig.self) private var serverConfig

    @State private var image: UIImage?
    @State private var isLoading = true
    @State private var hasFailed = false

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else if isLoading && hasCover {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.gray.opacity(0.2))
                    .shimmer()
            } else {
                placeholder
            }
        }
        .task(id: bookId) {
            await loadImage()
        }
    }

    private func loadImage() async {
        let url = useThumbnail
            ? serverConfig.coverThumbnailURL(for: bookId)
            : serverConfig.coverURL(for: bookId)
        guard hasCover, let url else {
            isLoading = false
            hasFailed = true
            return
        }

        isLoading = true
        hasFailed = false

        if let loaded = await imageCache.image(for: bookId, url: url) {
            image = loaded
            isLoading = false
        } else {
            isLoading = false
            hasFailed = true
        }
    }

    private var placeholder: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(Color.gray.opacity(0.2))
            .overlay {
                Image(systemName: iconForFormat)
                    .font(.largeTitle)
                    .foregroundStyle(.secondary)
            }
    }

    private var iconForFormat: String {
        switch format.lowercased() {
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
