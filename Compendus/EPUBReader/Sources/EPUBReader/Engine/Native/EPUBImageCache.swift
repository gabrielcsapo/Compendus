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
import Foundation

public final class EPUBImageCache: @unchecked Sendable {
    public static let shared = EPUBImageCache()

    private let cache = NSCache<NSString, UIImage>()

    /// Cache for image dimensions read from file headers (CGImageSource).
    /// Avoids full pixel decode — only reads width/height from the file header.
    private let dimensionsCache = NSCache<NSString, NSValue>()

    /// Unique ID of the currently active book session.
    /// When this changes, the cache is cleared.
    private var activeSessionID: String?

    public init() {
        cache.countLimit = 100
        cache.totalCostLimit = 100 * 1024 * 1024
    }

    /// Begin a new book session. Clears any cached images from the previous book.
    public func beginSession(id: String) {
        if activeSessionID != id {
            cache.removeAllObjects()
            dimensionsCache.removeAllObjects()
            activeSessionID = id
        }
    }

    /// End the current session, clearing the cache.
    public func endSession() {
        cache.removeAllObjects()
        dimensionsCache.removeAllObjects()
        activeSessionID = nil
    }

    /// Read image dimensions from the file header without decoding pixel data.
    /// Uses CGImageSource which reads only the first few hundred bytes of the file.
    /// For SVG files, parses viewBox / width+height XML attributes instead.
    public func imageDimensions(forPath path: String) -> CGSize? {
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

        let url = URL(fileURLWithPath: path)

        // SVG: CGImageSource cannot decode SVG — parse XML attributes directly
        if path.lowercased().hasSuffix(".svg") {
            let size = svgDimensions(at: url) ?? CGSize(width: 400, height: 300)
            dimensionsCache.setObject(NSValue(cgSize: size), forKey: path as NSString)
            return size
        }

        // Raster: read dimensions from file header only (no pixel decode)
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

    /// Parse SVG `width`/`height` or `viewBox` attributes from the first ~512 bytes.
    private func svgDimensions(at url: URL) -> CGSize? {
        // Read just enough to find the root <svg> tag attributes
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        let data = handle.readData(ofLength: 1024)
        try? handle.close()
        guard let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else { return nil }

        // Try viewBox="0 0 W H"
        if let vbRange = text.range(of: #"viewBox\s*=\s*["'][^"']*["']"#, options: .regularExpression) {
            let vbAttr = String(text[vbRange])
            let nums = vbAttr.components(separatedBy: .init(charactersIn: " ,\t"))
                .compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
            if nums.count >= 4, nums[2] > 0, nums[3] > 0 {
                return CGSize(width: nums[2], height: nums[3])
            }
        }

        // Try width="N" height="N" (numeric, ignoring units for now)
        func extractAttr(_ name: String) -> CGFloat? {
            let pattern = "\(name)\\s*=\\s*[\"']([0-9.]+)"
            if let r = text.range(of: pattern, options: .regularExpression) {
                let attrStr = String(text[r])
                if let numR = attrStr.range(of: #"[0-9.]+"#, options: .regularExpression) {
                    return CGFloat(Double(attrStr[numR]) ?? 0)
                }
            }
            return nil
        }
        if let w = extractAttr("width"), let h = extractAttr("height"), w > 0, h > 0 {
            return CGSize(width: w, height: h)
        }

        return nil
    }

    /// Retrieve a cached image by absolute file path.
    public func image(forPath path: String) -> UIImage? {
        cache.object(forKey: path as NSString)
    }

    /// Store an image in the cache.
    public func setImage(_ image: UIImage, forPath path: String) {
        let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
        cache.setObject(image, forKey: path as NSString, cost: cost)
    }
}
