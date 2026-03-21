//
//  SVGRenderer.swift
//  Compendus
//
//  Renders SVG data to UIImage via an off-screen WKWebView snapshot.
//  Results are cached by content hash to avoid re-rendering identical SVGs.
//

import Foundation
import UIKit
import WebKit
import CryptoKit

@MainActor
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

        // 3. Render via off-screen WKWebView
        guard let image = await renderOffScreen(svgData: svgData, size: size) else { return nil }

        // Persist to disk (best-effort)
        if let pngData = image.pngData() {
            try? pngData.write(to: diskURL)
        }
        memoryCache.setObject(image, forKey: nsKey)
        return image
    }

    // MARK: - Private

    private func cacheKey(for data: Data, size: CGSize) -> String {
        let hash = SHA256.hash(data: data)
        let hashHex = hash.map { String(format: "%02x", $0) }.joined()
        return "\(hashHex)_\(Int(size.width))x\(Int(size.height))"
    }

    private func renderOffScreen(svgData: Data, size: CGSize) async -> UIImage? {
        guard let svgString = String(data: svgData, encoding: .utf8)
                ?? String(data: svgData, encoding: .isoLatin1) else { return nil }

        // Wrap SVG in minimal HTML that fills the viewport exactly
        let html = """
        <!DOCTYPE html>
        <html>
        <head>
        <meta name="viewport" content="width=\(Int(size.width)), initial-scale=1.0">
        <style>
        * { margin: 0; padding: 0; }
        html, body { width: \(Int(size.width))px; height: \(Int(size.height))px; overflow: hidden; background: transparent; }
        svg { width: 100%; height: 100%; }
        </style>
        </head>
        <body>
        \(svgString)
        </body>
        </html>
        """

        return await withCheckedContinuation { continuation in
            let config = WKWebViewConfiguration()
            config.suppressesIncrementalRendering = true
            // Detached from window — never visible to the user
            let webView = WKWebView(frame: CGRect(origin: .zero, size: size), configuration: config)
            webView.isOpaque = false
            webView.backgroundColor = .clear
            webView.scrollView.isScrollEnabled = false

            let coordinator = SVGSnapshotCoordinator(webView: webView, size: size) { image in
                continuation.resume(returning: image)
            }
            webView.navigationDelegate = coordinator
            // Retain coordinator until snapshot completes via objc association
            objc_setAssociatedObject(webView, &svgCoordinatorKey, coordinator, .OBJC_ASSOCIATION_RETAIN)

            webView.loadHTMLString(html, baseURL: nil)
        }
    }

}

private var svgCoordinatorKey: UInt8 = 0

// MARK: - Snapshot Coordinator

/// Navigation delegate that fires a WKWebView snapshot once the SVG page finishes loading.
private final class SVGSnapshotCoordinator: NSObject, WKNavigationDelegate {
    private let webView: WKWebView
    private let size: CGSize
    private let completion: (UIImage?) -> Void
    private var didComplete = false

    init(webView: WKWebView, size: CGSize, completion: @escaping (UIImage?) -> Void) {
        self.webView = webView
        self.size = size
        self.completion = completion
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !didComplete else { return }
        didComplete = true

        let config = WKSnapshotConfiguration()
        config.rect = CGRect(origin: .zero, size: size)
        config.afterScreenUpdates = true

        webView.takeSnapshot(with: config) { [weak self] image, error in
            self?.completion(error == nil ? image : nil)
            objc_setAssociatedObject(webView, &svgCoordinatorKey, nil, .OBJC_ASSOCIATION_RETAIN)
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard !didComplete else { return }
        didComplete = true
        completion(nil)
        objc_setAssociatedObject(webView, &svgCoordinatorKey, nil, .OBJC_ASSOCIATION_RETAIN)
    }
}
