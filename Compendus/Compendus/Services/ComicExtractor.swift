//
//  ComicExtractor.swift
//  Compendus
//
//  Local extraction of comic pages from CBZ files for offline reading
//  CBR (RAR) files require server extraction as iOS lacks native RAR support
//
//  Optimization: Archives are extracted once and cached in a temp directory.
//  Subsequent page reads use the cached files directly without re-extraction.
//

import Foundation
import ZIPFoundation

enum ComicExtractorError: LocalizedError {
    case fileNotFound
    case invalidFormat
    case extractionFailed(String)
    case noPages
    case pageOutOfRange(Int, Int)
    case rarNotSupported

    var errorDescription: String? {
        switch self {
        case .fileNotFound:
            return "Comic file not found"
        case .invalidFormat:
            return "Invalid comic format"
        case .extractionFailed(let reason):
            return "Failed to extract: \(reason)"
        case .noPages:
            return "No pages found in comic"
        case .pageOutOfRange(let requested, let total):
            return "Page \(requested) out of range (total: \(total))"
        case .rarNotSupported:
            return "CBR files require server connection for reading. Download as CBZ for offline support."
        }
    }
}

struct ComicPageInfo {
    let index: Int
    let name: String
}

@Observable
class ComicExtractor {

    // Supported image extensions for comic pages
    private let imageExtensions = ["jpg", "jpeg", "png", "gif", "webp", "bmp"]

    // Cache of page lists per book to avoid re-reading archive
    private var pageListCache: [String: [ComicPageInfo]] = [:]

    // Cache of extracted archive locations (file path -> extracted temp dir)
    // This avoids re-extracting the archive for each page read
    private var extractedArchiveCache: [String: URL] = [:]

    /// Check if a format supports local extraction
    func supportsLocalExtraction(format: String) -> Bool {
        return format.lowercased() == "cbz"
    }

    /// Get page count from a local comic file
    func getPageCount(from fileURL: URL, format: String) throws -> Int {
        let pages = try getPageList(from: fileURL, format: format)
        return pages.count
    }

    /// Get list of pages from a local comic file
    func getPageList(from fileURL: URL, format: String) throws -> [ComicPageInfo] {
        let cacheKey = fileURL.path

        // Return cached if available
        if let cached = pageListCache[cacheKey] {
            return cached
        }

        let lowercasedFormat = format.lowercased()

        guard lowercasedFormat == "cbz" else {
            throw ComicExtractorError.rarNotSupported
        }

        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            throw ComicExtractorError.fileNotFound
        }

        // Get or create extracted directory
        let extractedDir = try getOrExtractArchive(fileURL: fileURL)

        // Build page list from extracted directory
        let pages = try buildPageList(from: extractedDir)

        if pages.isEmpty {
            throw ComicExtractorError.noPages
        }

        // Cache the result
        pageListCache[cacheKey] = pages

        return pages
    }

    /// Extract a specific page from a local comic file
    func extractPage(from fileURL: URL, format: String, pageIndex: Int) throws -> Data {
        let lowercasedFormat = format.lowercased()

        guard lowercasedFormat == "cbz" else {
            throw ComicExtractorError.rarNotSupported
        }

        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            throw ComicExtractorError.fileNotFound
        }

        // Get page list to find the correct entry
        let pages = try getPageList(from: fileURL, format: format)

        guard pageIndex >= 0 && pageIndex < pages.count else {
            throw ComicExtractorError.pageOutOfRange(pageIndex, pages.count)
        }

        // Get the cached extracted directory
        let extractedDir = try getOrExtractArchive(fileURL: fileURL)

        let page = pages[pageIndex]
        let pageURL = extractedDir.appendingPathComponent(page.name)

        guard FileManager.default.fileExists(atPath: pageURL.path) else {
            throw ComicExtractorError.extractionFailed("Page not found: \(page.name)")
        }

        do {
            return try Data(contentsOf: pageURL)
        } catch {
            throw ComicExtractorError.extractionFailed("Failed to read page: \(error.localizedDescription)")
        }
    }

    /// Clear all caches and remove extracted directories
    func clearCache() {
        // Remove all extracted directories
        for (_, extractedDir) in extractedArchiveCache {
            try? FileManager.default.removeItem(at: extractedDir)
        }
        extractedArchiveCache.removeAll()
        pageListCache.removeAll()
    }

    /// Clear cache for a specific book
    func clearCache(for fileURL: URL) {
        let cacheKey = fileURL.path

        // Remove extracted directory
        if let extractedDir = extractedArchiveCache[cacheKey] {
            try? FileManager.default.removeItem(at: extractedDir)
        }

        extractedArchiveCache.removeValue(forKey: cacheKey)
        pageListCache.removeValue(forKey: cacheKey)
    }

    // MARK: - Private Extraction

    /// Get the extracted directory for an archive, extracting if necessary
    private func getOrExtractArchive(fileURL: URL) throws -> URL {
        let cacheKey = fileURL.path

        // Check if we already have an extracted directory
        if let cachedDir = extractedArchiveCache[cacheKey] {
            // Verify it still exists (could have been cleaned up by system)
            if FileManager.default.fileExists(atPath: cachedDir.path) {
                return cachedDir
            }
            // Directory was removed, clean up cache entry
            extractedArchiveCache.removeValue(forKey: cacheKey)
        }

        // Create a new temporary directory for extraction
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ComicExtractor")
            .appendingPathComponent(UUID().uuidString)

        do {
            try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
            try FileManager.default.unzipItem(at: fileURL, to: tempDir)
        } catch {
            try? FileManager.default.removeItem(at: tempDir)
            throw ComicExtractorError.extractionFailed("Cannot extract archive: \(error.localizedDescription)")
        }

        // Cache the extracted directory
        extractedArchiveCache[cacheKey] = tempDir

        return tempDir
    }

    /// Build page list from an extracted directory
    private func buildPageList(from extractedDir: URL) throws -> [ComicPageInfo] {
        var imageEntries: [(name: String, path: String)] = []

        if let enumerator = FileManager.default.enumerator(at: extractedDir, includingPropertiesForKeys: [.isRegularFileKey]) {
            while let fileURL = enumerator.nextObject() as? URL {
                let fileName = fileURL.lastPathComponent
                let ext = fileURL.pathExtension.lowercased()

                // Only include image files
                guard imageExtensions.contains(ext) else { continue }

                // Skip hidden files and macOS resource forks
                guard !fileName.hasPrefix(".") else { continue }
                guard !fileURL.path.contains("__MACOSX") else { continue }

                // Get relative path from extracted dir
                let relativePath = fileURL.path.replacingOccurrences(of: extractedDir.path + "/", with: "")
                imageEntries.append((name: fileName, path: relativePath))
            }
        }

        // Sort naturally (handles page1, page2, page10 correctly)
        let sortedEntries = imageEntries.sorted { entry1, entry2 in
            return entry1.name.localizedStandardCompare(entry2.name) == .orderedAscending
        }

        return sortedEntries.enumerated().map { index, entry in
            ComicPageInfo(index: index, name: entry.path)
        }
    }
}
