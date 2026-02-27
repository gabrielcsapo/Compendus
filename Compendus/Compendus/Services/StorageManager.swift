//
//  StorageManager.swift
//  Compendus
//
//  Manages local storage for downloaded books
//

import Foundation
import SwiftData

@Observable
class StorageManager {
    private let fileManager = FileManager.default

    /// Documents directory URL
    var documentsURL: URL {
        fileManager.urls(for: .documentDirectory, in: .userDomainMask).first!
    }

    /// Books directory URL
    var booksURL: URL {
        documentsURL.appendingPathComponent("books", isDirectory: true)
    }

    /// Comic cache directory URL
    var comicCacheURL: URL {
        documentsURL.appendingPathComponent("comic-cache", isDirectory: true)
    }

    /// Cover cache directory URL
    var coverCacheURL: URL {
        documentsURL.appendingPathComponent("cover-cache", isDirectory: true)
    }

    /// TTS audio cache directory URL
    var ttsCacheURL: URL {
        documentsURL.appendingPathComponent("tts-cache", isDirectory: true)
    }

    init() {
        // Create directories if needed
        try? fileManager.createDirectory(at: booksURL, withIntermediateDirectories: true)
        try? fileManager.createDirectory(at: comicCacheURL, withIntermediateDirectories: true)
        try? fileManager.createDirectory(at: coverCacheURL, withIntermediateDirectories: true)
    }

    /// Get total storage used by downloaded books
    func totalBooksStorageUsed() -> Int64 {
        return directorySize(at: booksURL)
    }

    /// Get total storage used by comic cache
    func comicCacheSize() -> Int64 {
        return directorySize(at: comicCacheURL)
    }

    /// Get total storage used by cover cache
    func coverCacheSize() -> Int64 {
        return directorySize(at: coverCacheURL)
    }

    /// Get total storage used by TTS audio cache
    func ttsCacheSize() -> Int64 {
        return directorySize(at: ttsCacheURL)
    }

    /// Get total storage used by the app
    func totalStorageUsed() -> Int64 {
        return totalBooksStorageUsed() + comicCacheSize() + coverCacheSize() + ttsCacheSize()
    }

    /// Get formatted storage string
    func totalStorageUsedDisplay() -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: totalStorageUsed())
    }

    /// Get storage used by a specific book
    func storageUsed(for book: DownloadedBook) -> Int64 {
        guard let fileURL = book.fileURL else { return 0 }
        return fileSize(at: fileURL)
    }

    /// Clear comic cache
    func clearComicCache() throws {
        let contents = try fileManager.contentsOfDirectory(at: comicCacheURL, includingPropertiesForKeys: nil)
        for url in contents {
            try fileManager.removeItem(at: url)
        }
    }

    /// Clear cover cache
    func clearCoverCache() throws {
        let contents = try fileManager.contentsOfDirectory(at: coverCacheURL, includingPropertiesForKeys: nil)
        for url in contents {
            try fileManager.removeItem(at: url)
        }
    }

    /// Clear TTS audio cache
    func clearTTSCache() throws {
        guard fileManager.fileExists(atPath: ttsCacheURL.path) else { return }
        let contents = try fileManager.contentsOfDirectory(at: ttsCacheURL, includingPropertiesForKeys: nil)
        for url in contents {
            try fileManager.removeItem(at: url)
        }
    }

    /// Get available disk space
    func availableDiskSpace() -> Int64 {
        let homeURL = URL(fileURLWithPath: NSHomeDirectory())
        do {
            let values = try homeURL.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
            return values.volumeAvailableCapacityForImportantUsage ?? 0
        } catch {
            return 0
        }
    }

    /// Get available disk space as formatted string
    func availableDiskSpaceDisplay() -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: availableDiskSpace())
    }

    // MARK: - Comic Cache

    /// Get cached comic page URL
    func cachedComicPageURL(bookId: String, page: Int) -> URL {
        let bookDir = comicCacheURL.appendingPathComponent(bookId, isDirectory: true)
        return bookDir.appendingPathComponent("\(page).jpg")
    }

    /// Check if comic page is cached
    func isComicPageCached(bookId: String, page: Int) -> Bool {
        let url = cachedComicPageURL(bookId: bookId, page: page)
        return fileManager.fileExists(atPath: url.path)
    }

    /// Cache a comic page
    func cacheComicPage(bookId: String, page: Int, data: Data) throws {
        let bookDir = comicCacheURL.appendingPathComponent(bookId, isDirectory: true)
        try fileManager.createDirectory(at: bookDir, withIntermediateDirectories: true)

        let url = cachedComicPageURL(bookId: bookId, page: page)
        try data.write(to: url)
    }

    /// Get cached comic page data
    func getCachedComicPage(bookId: String, page: Int) -> Data? {
        let url = cachedComicPageURL(bookId: bookId, page: page)
        return try? Data(contentsOf: url)
    }

    /// Clear comic cache for a specific book
    func clearComicCache(for bookId: String) throws {
        let bookDir = comicCacheURL.appendingPathComponent(bookId, isDirectory: true)
        if fileManager.fileExists(atPath: bookDir.path) {
            try fileManager.removeItem(at: bookDir)
        }
    }

    // MARK: - Helpers

    private func directorySize(at url: URL) -> Int64 {
        guard let enumerator = fileManager.enumerator(
            at: url,
            includingPropertiesForKeys: [.fileSizeKey],
            options: [.skipsHiddenFiles]
        ) else { return 0 }

        var totalSize: Int64 = 0
        for case let fileURL as URL in enumerator {
            totalSize += fileSize(at: fileURL)
        }
        return totalSize
    }

    private func fileSize(at url: URL) -> Int64 {
        do {
            let attributes = try fileManager.attributesOfItem(atPath: url.path)
            return attributes[.size] as? Int64 ?? 0
        } catch {
            return 0
        }
    }
}
