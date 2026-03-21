//
//  LazyImageAttachment.swift
//  Compendus
//
//  NSTextAttachment subclass that stores image URL and dimensions but does NOT
//  load pixel data until explicitly asked. Used during pagination so CTFramesetter
//  computes correct page breaks without decoding full images. Actual pixel data
//  is loaded at render time via loadImageIfNeeded().
//

import UIKit

public final class LazyImageAttachment: NSTextAttachment {
    /// File URL of the image on disk (extracted EPUB temp directory).
    public let imageURL: URL

    /// Intrinsic pixel dimensions read from the image header.
    public let intrinsicSize: CGSize

    /// Thread-safety lock for lazy image loading.
    private let lock = NSLock()

    /// Whether the actual UIImage has been loaded into `self.image`.
    public var isLoaded: Bool { image != nil }

    public init(imageURL: URL, intrinsicSize: CGSize, displayBounds: CGRect) {
        self.imageURL = imageURL
        self.intrinsicSize = intrinsicSize
        super.init(data: nil, ofType: nil)
        self.bounds = displayBounds
    }

    required public init?(coder: NSCoder) {
        fatalError("init(coder:) not supported")
    }

    /// Load the actual UIImage from cache or disk. Thread-safe.
    /// SVG files are not decoded here — they require the async path via SVGRenderer.
    /// Call this at render time, not pagination time.
    public func loadImageIfNeeded() {
        lock.lock()
        defer { lock.unlock() }
        guard image == nil else { return }

        // SVGs require async rendering; skip the sync path so the async path handles them.
        guard imageURL.pathExtension.lowercased() != "svg" else { return }

        if let cached = EPUBImageCache.shared.image(forPath: imageURL.path) {
            image = cached
        } else if let loaded = UIImage(contentsOfFile: imageURL.path) {
            EPUBImageCache.shared.setImage(loaded, forPath: imageURL.path)
            image = loaded
        }
    }

    /// Asynchronously load the image off the main thread. Returns true if the image
    /// was loaded (or was already loaded). Callers on the main thread should use this
    /// to avoid blocking the UI during disk I/O and image decoding.
    public func loadImageAsync() async -> Bool {
        // Fast path: already loaded
        lock.lock()
        if image != nil { lock.unlock(); return true }
        lock.unlock()

        let url = imageURL
        let displaySize = bounds.size

        // SVG files: render via WKWebView snapshot (must run on MainActor)
        if url.pathExtension.lowercased() == "svg" {
            guard let data = (try? Data(contentsOf: url)) else { return false }
            let rendered = await SVGRenderer.shared.render(data, size: displaySize)
            guard let rendered else { return false }
            lock.lock()
            if image == nil { image = rendered }
            lock.unlock()
            return true
        }

        // Raster images: decode off main thread
        let loaded: UIImage? = await Task.detached(priority: .userInitiated) {
            if let cached = EPUBImageCache.shared.image(forPath: url.path) {
                return cached
            } else if let img = UIImage(contentsOfFile: url.path) {
                EPUBImageCache.shared.setImage(img, forPath: url.path)
                return img
            }
            return nil
        }.value

        guard let loaded else { return false }
        lock.lock()
        if image == nil { image = loaded }
        lock.unlock()
        return true
    }
}
