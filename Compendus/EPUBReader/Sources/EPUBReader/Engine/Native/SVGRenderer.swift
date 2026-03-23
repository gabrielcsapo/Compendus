//
//  SVGRenderer.swift
//  Compendus
//
//  Renders SVG data to UIImage via CoreSVG (Apple's native vector engine).
//  Results are cached by content hash to avoid re-rendering identical SVGs.
//

import Foundation
import UIKit
import CryptoKit

public final class SVGRenderer: NSObject {

    // MARK: - Shared instance

    public static let shared = SVGRenderer()

    // MARK: - State

    private let memoryCache = NSCache<NSString, UIImage>()
    /// Disk cache directory for rendered SVG images.
    private let cacheDir: URL = {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let dir = docs.appendingPathComponent("svg-render-cache", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    private override init() {
        memoryCache.countLimit = 50
    }

    // MARK: - Public API

    /// Render `svgData` into a `UIImage` at the requested display size.
    /// Returns `nil` if rendering fails; callers should fall back to alt text.
    public func render(_ svgData: Data, size: CGSize) async -> UIImage? {
        let key = cacheKey(for: svgData, size: size)
        let nsKey = key as NSString

        // 1. Memory cache
        if let cached = memoryCache.object(forKey: nsKey) { return cached }

        // 2. Disk cache
        let diskURL = cacheDir.appendingPathComponent("\(key).png")
        if let diskData = try? Data(contentsOf: diskURL),
           let diskImage = UIImage(data: diskData) {
            memoryCache.setObject(diskImage, forKey: nsKey)
            return diskImage
        }

        // 3. Render via CoreSVG (off main thread, no WKWebView)
        guard let image = await Task.detached(priority: .userInitiated) { [diskURL] in
            guard let doc = SVGDocument(svgData) else { return UIImage?.none }
            let rendered = doc.image(size: size)
            if let pngData = rendered?.pngData() {
                try? pngData.write(to: diskURL)
            }
            return rendered
        }.value else { return nil }

        memoryCache.setObject(image, forKey: nsKey)
        return image
    }

    // MARK: - Private

    private func cacheKey(for data: Data, size: CGSize) -> String {
        let hash = SHA256.hash(data: data)
        let hashHex = hash.map { String(format: "%02x", $0) }.joined()
        return "\(hashHex)_\(Int(size.width))x\(Int(size.height))"
    }
}
