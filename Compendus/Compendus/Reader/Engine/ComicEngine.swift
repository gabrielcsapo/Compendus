//
//  ComicEngine.swift
//  Compendus
//
//  ReaderEngine implementation for comic books (CBZ/CBR).
//  Displays comic pages as full-screen images with zoom/pan support.
//  Supports single-page and two-page spread layouts.
//

import UIKit
import EPUBReader

@Observable
@MainActor
class ComicEngine: ReaderEngine {

    // MARK: - ReaderEngine Protocol Properties

    var currentLocation: ReaderLocation?
    var totalPositions: Int = 0
    var isReady: Bool = false
    var errorMessage: String?
    var isPDF: Bool { false }
    var isComic: Bool { true }

    var onSelectionChanged: ((ReaderSelection?) -> Void)?
    var onHighlightTapped: ((String) -> Void)?

    /// Center tap zone callback (toggle overlay)
    var onCenterTap: (() -> Void)?

    // MARK: - Comic State

    private(set) var currentPage: Int = 0
    private(set) var pagesPerSpread: Int = 1
    private(set) var isOfflineMode: Bool = false

    private let book: DownloadedBook
    private let comicExtractor: ComicExtractor
    private let storageManager: StorageManager
    private let apiService: APIService

    private var pageViewController: ComicPageViewController?
    private(set) var currentSettings: ReaderSettings?

    /// In-memory page image cache, bounded by NSCache eviction policy
    private let pageImageCache = NSCache<NSNumber, UIImage>()

    // MARK: - Initialization

    init(book: DownloadedBook, comicExtractor: ComicExtractor, storageManager: StorageManager, apiService: APIService) {
        self.book = book
        self.comicExtractor = comicExtractor
        self.storageManager = storageManager
        self.apiService = apiService
        pageImageCache.countLimit = 10
    }

    // MARK: - Loading

    func load(initialPage: Int? = nil) async {
        let canExtractLocally = comicExtractor.supportsLocalExtraction(format: book.format)
        let hasLocalFile = book.fileURL != nil && FileManager.default.fileExists(atPath: book.fileURL!.path)

        if canExtractLocally && hasLocalFile {
            await loadLocally()
        } else {
            await loadFromServer()
        }

        guard errorMessage == nil else { return }

        // Restore last position
        if let page = initialPage {
            currentPage = min(page, max(0, totalPositions - 1))
        }

        updateLocation()
        isReady = true

        // Load initial page
        await displayCurrentPage()
    }

    private func loadLocally() async {
        guard let fileURL = book.fileURL else {
            errorMessage = "Book file not found"
            return
        }

        do {
            // Run ZIP extraction off the main thread to avoid UI freeze
            let extractor = comicExtractor
            let format = book.format
            let count = try await Task.detached(priority: .userInitiated) {
                try extractor.getPageCount(from: fileURL, format: format)
            }.value
            totalPositions = count
            if totalPositions == 0 {
                errorMessage = "Comic has no pages"
                return
            }
            isOfflineMode = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadFromServer() async {
        do {
            let info = try await apiService.fetchComicInfo(bookId: book.id, format: book.format)
            totalPositions = info.pageCount
            if totalPositions == 0 {
                errorMessage = "Comic has no pages"
                return
            }
            isOfflineMode = false
        } catch {
            if book.format.lowercased() == "cbr" {
                errorMessage = "CBR files require server connection for reading. Please connect to your server or download books in CBZ format for offline reading."
            } else {
                errorMessage = "Failed to load comic: \(error.localizedDescription)"
            }
        }
    }

    // MARK: - Page Loading

    /// Load a page image using the cache hierarchy: memory → disk → local extraction → server
    func loadPageImage(_ page: Int) async -> UIImage? {
        guard page >= 0 && page < totalPositions else { return nil }

        // 1. Check in-memory cache
        if let cached = pageImageCache.object(forKey: NSNumber(value: page)) {
            return cached
        }

        // 2. Check disk cache
        if let cachedData = await storageManager.getCachedComicPage(bookId: book.id, page: page),
           let image = UIImage(data: cachedData) {
            pageImageCache.setObject(image, forKey: NSNumber(value: page))
            return image
        }

        // 3. Try local extraction (CBZ)
        let canExtractLocally = comicExtractor.supportsLocalExtraction(format: book.format)
        let hasLocalFile = book.fileURL != nil && FileManager.default.fileExists(atPath: book.fileURL!.path)

        if canExtractLocally && hasLocalFile, let fileURL = book.fileURL {
            do {
                // Run page extraction off the main thread to avoid UI freeze
                let extractor = comicExtractor
                let format = book.format
                let data = try await Task.detached(priority: .userInitiated) {
                    try extractor.extractPage(from: fileURL, format: format, pageIndex: page)
                }.value
                if let image = UIImage(data: data) {
                    pageImageCache.setObject(image, forKey: NSNumber(value: page))
                    try? storageManager.cacheComicPage(bookId: book.id, page: page, data: data)
                    return image
                }
            } catch {
                // Fall through to server
            }
        }

        // 4. Fetch from server
        do {
            let data = try await apiService.fetchComicPage(bookId: book.id, format: book.format, page: page)
            if let image = UIImage(data: data) {
                pageImageCache.setObject(image, forKey: NSNumber(value: page))
                try? storageManager.cacheComicPage(bookId: book.id, page: page, data: data)
                return image
            }
        } catch {
            // Page load failed
        }

        return nil
    }

    // MARK: - Spread Mode

    func updateSpreadMode(for viewportSize: CGSize, settings: ReaderSettings) {
        let resolved = settings.resolvedLayout(for: viewportSize.width)
        let newPagesPerSpread = resolved == .twoPage ? 2 : 1
        if newPagesPerSpread != pagesPerSpread {
            pagesPerSpread = newPagesPerSpread
            if pagesPerSpread == 2 {
                currentPage = alignToSpread(currentPage)
            }
            pageViewController?.updateLayout(pagesPerSpread: pagesPerSpread)
            Task { await displayCurrentPage() }
        }
    }

    private func alignToSpread(_ page: Int) -> Int {
        pagesPerSpread == 2 ? page - (page % 2) : page
    }

    // MARK: - ReaderEngine Navigation

    func goForward() async {
        let advance = pagesPerSpread
        let newPage = currentPage + advance
        guard newPage < totalPositions else { return }
        currentPage = alignToSpread(newPage)
        await displayCurrentPage()
        updateLocation()
    }

    func goBackward() async {
        let retreat = pagesPerSpread
        let newPage = currentPage - retreat
        guard newPage >= 0 else { return }
        currentPage = alignToSpread(newPage)
        await displayCurrentPage()
        updateLocation()
    }

    func go(to location: ReaderLocation) async {
        if let pageIndex = location.pageIndex {
            currentPage = alignToSpread(min(max(0, pageIndex), totalPositions - 1))
            await displayCurrentPage()
            updateLocation()
        }
    }

    func go(toProgression progression: Double) async {
        let page = Int(progression * Double(totalPositions - 1))
        currentPage = alignToSpread(min(max(0, page), totalPositions - 1))
        await displayCurrentPage()
        updateLocation()
    }

    // MARK: - ViewController

    func makeViewController() -> UIViewController {
        let vc = ComicPageViewController(engine: self)
        self.pageViewController = vc
        return vc
    }

    // MARK: - TOC (empty for comics — thumbnail grid replaces this)

    func tableOfContents() async -> [TOCItem] { [] }

    // MARK: - Highlights (no-op for comics; bookmarks handled separately)

    func applyHighlights(_ highlights: [BookHighlight]) { }

    func clearSelection() { }

    // MARK: - Settings

    func applySettings(_ settings: ReaderSettings) {
        currentSettings = settings
        pageViewController?.applyTheme(settings.theme)
        updateSpreadMode(
            for: pageViewController?.view.bounds.size ?? UIScreen.main.bounds.size,
            settings: settings
        )
    }

    // MARK: - Serialization

    func serializeLocation() -> String? {
        let progress = totalPositions > 1
            ? Double(currentPage) / Double(totalPositions - 1)
            : 0.0
        let dict: [String: Any] = [
            "type": "comic",
            "page": currentPage,
            "progress": min(1.0, progress)
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: dict) else {
            return String(currentPage) // fallback
        }
        return String(data: data, encoding: .utf8)
    }

    // MARK: - Snapshots (for carousel)

    func snapshotPage(at offset: Int) -> UIImage? {
        let targetPage = currentPage + (offset * pagesPerSpread)
        guard targetPage >= 0, targetPage < totalPositions else { return nil }
        return pageImageCache.object(forKey: NSNumber(value: targetPage))
    }

    // MARK: - Internal

    func setCurrentPage(_ page: Int) {
        guard page != currentPage else { return }
        currentPage = page
        updateLocation()
    }

    func displayCurrentPage() async {
        let leftImage = await loadPageImage(currentPage)
        var rightImage: UIImage? = nil
        if pagesPerSpread == 2 && currentPage + 1 < totalPositions {
            rightImage = await loadPageImage(currentPage + 1)
        }
        pageViewController?.displayPages(left: leftImage, right: rightImage)

        // Prefetch adjacent pages
        prefetchAdjacentPages()
    }

    private func updateLocation() {
        let progression = totalPositions > 0
            ? Double(currentPage + 1) / Double(totalPositions)
            : 0
        currentLocation = ReaderLocation(
            href: nil,
            pageIndex: currentPage,
            progression: progression,
            totalProgression: progression,
            title: "Page \(currentPage + 1)"
        )
    }

    private func prefetchAdjacentPages() {
        let pagesToPrefetch = [
            currentPage - pagesPerSpread,
            currentPage + pagesPerSpread,
            currentPage + pagesPerSpread + 1,
        ]
        for page in pagesToPrefetch where page >= 0 && page < totalPositions {
            if pageImageCache.object(forKey: NSNumber(value: page)) == nil {
                Task { _ = await loadPageImage(page) }
            }
        }
    }
}
