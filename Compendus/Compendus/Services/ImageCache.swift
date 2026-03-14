//
//  ImageCache.swift
//  Compendus
//
//  Disk + memory cache for cover images
//

import Foundation
import UIKit

@Observable
@MainActor
class ImageCache {
    private let memoryCache = NSCache<NSString, UIImage>()
    private let fileManager = FileManager.default
    // Thread safety: all access to inFlightRequests is on @MainActor
    private var inFlightRequests: [String: Task<UIImage?, Never>] = [:]
    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 10
        return URLSession(configuration: config, delegate: LocalNetworkSessionDelegate.shared, delegateQueue: nil)
    }()

    /// Cover cache directory URL
    var cacheURL: URL {
        let docs = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first!
        return docs.appendingPathComponent("cover-cache", isDirectory: true)
    }

    init() {
        memoryCache.countLimit = 200
        try? fileManager.createDirectory(at: cacheURL, withIntermediateDirectories: true)
    }

    /// Get a cover image, checking memory → disk → network in that order.
    func image(for bookId: String, url: URL) async -> UIImage? {
        let key = bookId as NSString

        // 1. Memory cache
        if let cached = memoryCache.object(forKey: key) {
            return cached
        }

        // 2. Disk cache (off main thread to avoid blocking UI during scroll)
        let diskURL = cacheURL.appendingPathComponent("\(bookId).jpg")
        let diskImage: UIImage? = await Task.detached(priority: .userInitiated) {
            guard let data = try? Data(contentsOf: diskURL) else { return nil }
            return UIImage(data: data)
        }.value
        if let diskImage {
            memoryCache.setObject(diskImage, forKey: key)
            return diskImage
        }

        // 3. Deduplicate in-flight requests
        if let existing = inFlightRequests[bookId] {
            return await existing.value
        }

        let task = Task<UIImage?, Never> {
            defer { inFlightRequests.removeValue(forKey: bookId) }

            do {
                let (data, _) = try await session.data(from: url)
                guard let image = UIImage(data: data) else { return nil }

                // Save to disk
                try? data.write(to: diskURL)

                // Save to memory
                memoryCache.setObject(image, forKey: key)

                return image
            } catch {
                return nil
            }
        }

        inFlightRequests[bookId] = task
        return await task.value
    }

    /// Preload a cover into the cache without returning it.
    func preload(bookId: String, url: URL) {
        let key = bookId as NSString
        if memoryCache.object(forKey: key) != nil { return }

        let diskURL = cacheURL.appendingPathComponent("\(bookId).jpg")
        if fileManager.fileExists(atPath: diskURL.path) {
            // Already on disk — load into memory on access
            return
        }

        guard inFlightRequests[bookId] == nil else { return }

        let task = Task<UIImage?, Never> {
            defer { inFlightRequests.removeValue(forKey: bookId) }
            do {
                let (data, _) = try await session.data(from: url)
                guard let image = UIImage(data: data) else { return nil }
                try? data.write(to: diskURL)
                memoryCache.setObject(image, forKey: key)
                return image
            } catch {
                return nil
            }
        }
        inFlightRequests[bookId] = task
    }

    /// Evict a specific cover from both caches.
    func evict(bookId: String) {
        memoryCache.removeObject(forKey: bookId as NSString)
        let diskURL = cacheURL.appendingPathComponent("\(bookId).jpg")
        try? fileManager.removeItem(at: diskURL)
    }

    /// Clear the entire memory cache.
    func clearMemoryCache() {
        memoryCache.removeAllObjects()
    }
}
