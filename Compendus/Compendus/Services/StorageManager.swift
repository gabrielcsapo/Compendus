//
//  StorageManager.swift
//  Compendus
//
//  Manages local storage for downloaded books
//

import Foundation
import SwiftData

@Observable
final class StorageManager: @unchecked Sendable {
    nonisolated(unsafe) private let fileManager = FileManager.default

    /// Documents directory URL
    nonisolated var documentsURL: URL {
        fileManager.urls(for: .documentDirectory, in: .userDomainMask).first!
    }

    /// Books directory URL
    nonisolated var booksURL: URL {
        documentsURL.appendingPathComponent("books", isDirectory: true)
    }

    nonisolated var ccdPacksURL: URL {
        documentsURL.appendingPathComponent("ccd-packs", isDirectory: true)
    }

    nonisolated var downloadStagingURL: URL {
        documentsURL.appendingPathComponent(".download-staging", isDirectory: true)
    }

    /// Comic cache directory URL
    nonisolated var comicCacheURL: URL {
        documentsURL.appendingPathComponent("comic-cache", isDirectory: true)
    }

    /// Cover cache directory URL
    nonisolated var coverCacheURL: URL {
        documentsURL.appendingPathComponent("cover-cache", isDirectory: true)
    }

    /// TTS audio cache directory URL
    nonisolated var ttsCacheURL: URL {
        documentsURL.appendingPathComponent("tts-cache", isDirectory: true)
    }

    init() {
        // Create directories if needed
        try? fileManager.createDirectory(at: booksURL, withIntermediateDirectories: true)
        try? fileManager.createDirectory(at: comicCacheURL, withIntermediateDirectories: true)
        try? fileManager.createDirectory(at: coverCacheURL, withIntermediateDirectories: true)
        try? fileManager.createDirectory(at: ccdPacksURL, withIntermediateDirectories: true)
        try? fileManager.createDirectory(at: ttsCacheURL, withIntermediateDirectories: true)
        try? fileManager.createDirectory(at: downloadStagingURL, withIntermediateDirectories: true)
        for url in [booksURL, ccdPacksURL, comicCacheURL, coverCacheURL, ttsCacheURL, downloadStagingURL] {
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var mutable = url
            try? mutable.setResourceValues(values)
            try? fileManager.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                ofItemAtPath: url.path
            )
        }
    }

    /// Get total storage used by downloaded books
    nonisolated func totalBooksStorageUsed() -> Int64 {
        return directorySize(at: booksURL) + directorySize(at: ccdPacksURL) + directorySize(at: downloadStagingURL)
    }

    /// Get total storage used by comic cache
    nonisolated func comicCacheSize() -> Int64 {
        return directorySize(at: comicCacheURL)
    }

    /// Get total storage used by cover cache
    nonisolated func coverCacheSize() -> Int64 {
        return directorySize(at: coverCacheURL)
    }

    /// Get total storage used by TTS audio cache
    nonisolated func ttsCacheSize() -> Int64 {
        return directorySize(at: ttsCacheURL)
    }

    /// Get total storage used by the app
    nonisolated func totalStorageUsed() -> Int64 {
        return totalBooksStorageUsed() + comicCacheSize() + coverCacheSize() + ttsCacheSize()
    }

    /// Get formatted storage string
    nonisolated func totalStorageUsedDisplay() -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: totalStorageUsed())
    }

    /// Get storage used by a specific book
    func storageUsed(for book: DownloadedBook) -> Int64 {
        guard let fileURL = book.fileURL else { return 0 }
        var isDirectory: ObjCBool = false
        if fileManager.fileExists(atPath: fileURL.path, isDirectory: &isDirectory), isDirectory.boolValue {
            return directorySize(at: fileURL)
        }
        return fileSize(at: fileURL)
    }

    /// Clear comic cache
    nonisolated func clearComicCache() throws {
        let contents = try fileManager.contentsOfDirectory(at: comicCacheURL, includingPropertiesForKeys: nil)
        for url in contents {
            try fileManager.removeItem(at: url)
        }
    }

    /// Clear cover cache
    nonisolated func clearCoverCache() throws {
        let contents = try fileManager.contentsOfDirectory(at: coverCacheURL, includingPropertiesForKeys: nil)
        for url in contents {
            try fileManager.removeItem(at: url)
        }
    }

    /// Clear TTS audio cache
    nonisolated func clearTTSCache() throws {
        guard fileManager.fileExists(atPath: ttsCacheURL.path) else { return }
        let contents = try fileManager.contentsOfDirectory(at: ttsCacheURL, includingPropertiesForKeys: nil)
        for url in contents {
            try fileManager.removeItem(at: url)
        }
    }

    /// List book IDs that have TTS cache directories.
    nonisolated func ttsCacheBookIds() -> [String] {
        guard fileManager.fileExists(atPath: ttsCacheURL.path),
              let contents = try? fileManager.contentsOfDirectory(
                  at: ttsCacheURL,
                  includingPropertiesForKeys: [.isDirectoryKey],
                  options: [.skipsHiddenFiles]
              ) else { return [] }
        return contents.compactMap { url in
            let values = try? url.resourceValues(forKeys: [.isDirectoryKey])
            return values?.isDirectory == true ? url.lastPathComponent : nil
        }
    }

    /// Get TTS cache size for a specific book.
    nonisolated func ttsCacheSize(for bookId: String) -> Int64 {
        let bookDir = ttsCacheURL.appendingPathComponent(bookId, isDirectory: true)
        return directorySize(at: bookDir)
    }

    /// Clear TTS cache for a specific book.
    nonisolated func clearTTSCache(for bookId: String) throws {
        let bookDir = ttsCacheURL.appendingPathComponent(bookId, isDirectory: true)
        guard fileManager.fileExists(atPath: bookDir.path) else { return }
        try fileManager.removeItem(at: bookDir)
    }

    /// Get available disk space
    nonisolated func availableDiskSpace() -> Int64 {
        let homeURL = URL(fileURLWithPath: NSHomeDirectory())
        do {
            let values = try homeURL.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
            return values.volumeAvailableCapacityForImportantUsage ?? 0
        } catch {
            return 0
        }
    }

    /// Get available disk space as formatted string
    nonisolated func availableDiskSpaceDisplay() -> String {
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

    /// Get cached comic page data (async to avoid blocking main thread with large files)
    func getCachedComicPage(bookId: String, page: Int) async -> Data? {
        let url = cachedComicPageURL(bookId: bookId, page: page)
        return await Task.detached(priority: .userInitiated) {
            try? Data(contentsOf: url)
        }.value
    }

    /// Clear comic cache for a specific book
    func clearComicCache(for bookId: String) throws {
        let bookDir = comicCacheURL.appendingPathComponent(bookId, isDirectory: true)
        if fileManager.fileExists(atPath: bookDir.path) {
            try fileManager.removeItem(at: bookDir)
        }
    }

    // MARK: - Helpers

    nonisolated private func directorySize(at url: URL) -> Int64 {
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

    nonisolated private func fileSize(at url: URL) -> Int64 {
        do {
            let attributes = try fileManager.attributesOfItem(atPath: url.path)
            return attributes[.size] as? Int64 ?? 0
        } catch {
            return 0
        }
    }
}
