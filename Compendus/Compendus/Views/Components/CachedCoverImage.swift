//
//  CachedCoverImage.swift
//  Compendus
//
//  Cover image view backed by disk + memory cache
//

import SwiftUI

// MARK: - Cover Image Decoder (shared memory cache for local cover Data)

/// Memory cache for decoded cover images from local Data.
/// Avoids re-decoding UIImage(data:) on every SwiftUI render.
enum CoverImageDecoder {
    private static let cache: NSCache<NSString, UIImage> = {
        let c = NSCache<NSString, UIImage>()
        c.countLimit = 200
        return c
    }()

    /// Decode and cache a cover image from raw Data.
    static func decode(bookId: String, data: Data?) -> UIImage? {
        let key = bookId as NSString
        if let cached = cache.object(forKey: key) {
            return cached
        }
        guard let data, let image = UIImage(data: data) else { return nil }
        cache.setObject(image, forKey: key)
        return image
    }

    /// Format-appropriate SF Symbol for book cover placeholder.
    static func placeholderIcon(for format: String) -> String {
        switch format.lowercased() {
        case "m4b", "mp3", "m4a": return "headphones"
        case "cbr", "cbz": return "book.pages"
        case "pdf": return "doc.richtext"
        default: return "book.closed"
        }
    }
}

// MARK: - Local Cover Image (for downloaded/offline books)

/// Cover image view for locally-stored cover Data with memory caching.
/// Use for DownloadedBook, PendingDownload, or any local cover data.
struct LocalCoverImage: View {
    let bookId: String
    let coverData: Data?
    var format: String = "epub"

    var body: some View {
        if let image = CoverImageDecoder.decode(bookId: bookId, data: coverData) {
            Color.clear
                .overlay {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                }
                .clipped()
        } else {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(.systemGray5))
                .overlay {
                    Image(systemName: CoverImageDecoder.placeholderIcon(for: format))
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                }
        }
    }
}

// MARK: - Cached Cover Image (for server/online books)

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
                Color.clear
                    .overlay {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFill()
                    }
                    .clipped()
            } else if isLoading && hasCover {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color(.systemGray5))
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

        // Race the image load against a 10-second timeout to avoid infinite spinner
        let loaded = await withTaskGroup(of: UIImage?.self) { group -> UIImage? in
            group.addTask {
                await imageCache.image(for: bookId, url: url)
            }
            group.addTask {
                try? await Task.sleep(for: .seconds(10))
                return nil
            }
            let result = await group.next() ?? nil
            group.cancelAll()
            return result
        }

        if let loaded {
            image = loaded
            isLoading = false
        } else {
            isLoading = false
            hasFailed = true
        }
    }

    private var placeholder: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(Color(.systemGray5))
            .overlay {
                Image(systemName: iconForFormat)
                    .font(.largeTitle)
                    .foregroundStyle(.secondary)
            }
    }

    private var iconForFormat: String {
        CoverImageDecoder.placeholderIcon(for: format)
    }
}
