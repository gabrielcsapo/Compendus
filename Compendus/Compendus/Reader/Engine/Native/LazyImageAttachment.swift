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

final class LazyImageAttachment: NSTextAttachment {
    /// File URL of the image on disk (extracted EPUB temp directory).
    let imageURL: URL

    /// Intrinsic pixel dimensions read from the image header.
    let intrinsicSize: CGSize

    /// Thread-safety lock for lazy image loading.
    private let lock = NSLock()

    /// Whether the actual UIImage has been loaded into `self.image`.
    var isLoaded: Bool { image != nil }

    init(imageURL: URL, intrinsicSize: CGSize, displayBounds: CGRect) {
        self.imageURL = imageURL
        self.intrinsicSize = intrinsicSize
        super.init(data: nil, ofType: nil)
        self.bounds = displayBounds
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) not supported")
    }

    /// Load the actual UIImage from cache or disk. Thread-safe.
    /// Call this at render time, not pagination time.
    func loadImageIfNeeded() {
        lock.lock()
        defer { lock.unlock() }
        guard image == nil else { return }

        if let cached = EPUBImageCache.shared.image(forPath: imageURL.path) {
            image = cached
        } else if let loaded = UIImage(contentsOfFile: imageURL.path) {
            EPUBImageCache.shared.setImage(loaded, forPath: imageURL.path)
            image = loaded
        }
    }
}
