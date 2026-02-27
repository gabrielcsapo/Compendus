//
//  ImageCache.swift
//  Compendus
//
//  Book-session-scoped image cache for the native EPUB reader.
//  Uses NSCache for automatic memory pressure eviction.
//  Keyed by absolute file path.
//

import UIKit
import ImageIO

final class EPUBImageCache: @unchecked Sendable {
    static let shared = EPUBImageCache()

    private let cache = NSCache<NSString, UIImage>()

    /// Cache for image dimensions read from file headers (CGImageSource).
    /// Avoids full pixel decode — only reads width/height from the file header.
    private let dimensionsCache = NSCache<NSString, NSValue>()

    /// Unique ID of the currently active book session.
    /// When this changes, the cache is cleared.
    private var activeSessionID: String?

    init() {
        cache.countLimit = 100
        cache.totalCostLimit = 100 * 1024 * 1024
    }

    /// Begin a new book session. Clears any cached images from the previous book.
    func beginSession(id: String) {
        if activeSessionID != id {
            cache.removeAllObjects()
            dimensionsCache.removeAllObjects()
            activeSessionID = id
        }
    }

    /// End the current session, clearing the cache.
    func endSession() {
        cache.removeAllObjects()
        dimensionsCache.removeAllObjects()
        activeSessionID = nil
    }

    /// Read image dimensions from the file header without decoding pixel data.
    /// Uses CGImageSource which reads only the first few hundred bytes of the file.
    func imageDimensions(forPath path: String) -> CGSize? {
        // Check dimensions cache
        if let cached = dimensionsCache.object(forKey: path as NSString) {
            return cached.cgSizeValue
        }

        // If the full image is already cached, use its size
        if let image = image(forPath: path) {
            let size = image.size
            dimensionsCache.setObject(NSValue(cgSize: size), forKey: path as NSString)
            return size
        }

        // Read dimensions from file header only (no pixel decode)
        let url = URL(fileURLWithPath: path)
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }

        let options: [CFString: Any] = [kCGImageSourceShouldCache: false]
        guard let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, options as CFDictionary) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? CGFloat,
              let height = properties[kCGImagePropertyPixelHeight] as? CGFloat else {
            return nil
        }

        let size = CGSize(width: width, height: height)
        dimensionsCache.setObject(NSValue(cgSize: size), forKey: path as NSString)
        return size
    }

    /// Retrieve a cached image by absolute file path.
    func image(forPath path: String) -> UIImage? {
        cache.object(forKey: path as NSString)
    }

    /// Store an image in the cache.
    func setImage(_ image: UIImage, forPath path: String) {
        let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
        cache.setObject(image, forKey: path as NSString, cost: cost)
    }
}
