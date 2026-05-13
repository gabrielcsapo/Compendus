//
//  ThumbnailCache.swift
//  Compendus
//
//  Session-scoped cache for scrubber thumbnails. Separate from the per-engine
//  page-image caches so scrubbing through pages doesn't evict the user's
//  current-reading hot pages.
//

import UIKit

@MainActor
final class ThumbnailCache {
    static let shared = ThumbnailCache()

    private let cache = NSCache<Key, UIImage>()

    private init() {
        cache.countLimit = 60
        NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.cache.removeAllObjects()
        }
    }

    func image(bookId: String, page: Int) -> UIImage? {
        cache.object(forKey: Key(bookId: bookId, page: page))
    }

    func store(_ image: UIImage, bookId: String, page: Int) {
        cache.setObject(image, forKey: Key(bookId: bookId, page: page))
    }

    func clear(bookId: String) {
        // NSCache has no per-key wildcard; cheapest correct behavior is full clear.
        cache.removeAllObjects()
    }

    final class Key: NSObject {
        let bookId: String
        let page: Int

        init(bookId: String, page: Int) {
            self.bookId = bookId
            self.page = page
        }

        override var hash: Int {
            var hasher = Hasher()
            hasher.combine(bookId)
            hasher.combine(page)
            return hasher.finalize()
        }

        override func isEqual(_ object: Any?) -> Bool {
            guard let other = object as? Key else { return false }
            return bookId == other.bookId && page == other.page
        }
    }
}

extension UIImage {
    /// Downscale so the larger dimension is at most `maxDimension` (in pixels).
    /// Returns `self` unchanged when already smaller.
    func thumbnail(maxDimension: CGFloat) -> UIImage? {
        let widthPx = size.width * scale
        let heightPx = size.height * scale
        let largest = max(widthPx, heightPx)
        guard largest > maxDimension else { return self }
        let ratio = maxDimension / largest
        let newSize = CGSize(width: size.width * ratio, height: size.height * ratio)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = scale
        format.opaque = false
        let renderer = UIGraphicsImageRenderer(size: newSize, format: format)
        return renderer.image { _ in
            draw(in: CGRect(origin: .zero, size: newSize))
        }
    }
}
