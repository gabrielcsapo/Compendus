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
    /// Current zoom scale of the comic page (1.0 = fit, up to 4.0 max).
    /// Published so the reader's bottom bar can show a zoom chip.
    private(set) var zoomScale: CGFloat = 1.0

    // MARK: - Guided View

    /// Pan-and-zoom panel-by-panel reading mode. Phase A uses a 2×3 grid
    /// heuristic; later phases can swap in Vision-detected panels.
    var guidedViewEnabled: Bool = false {
        didSet { pageViewController?.applyGuidedView(currentPanel: currentPanel) }
    }
    private(set) var currentPanel: Int = 0

    /// Raw detected panel rects for the CURRENT page, in 0..1 normalized
    /// image coordinates, in reading order. Empty until detection completes;
    /// the view controller falls back to a heuristic grid while empty. Wide
    /// panels are not pre-split — splitting happens orientation-aware via
    /// `detectedPanels` / `detectedPanelsRight`.
    private var rawDetectedPanels: [CGRect] = []
    private var rawDetectedPanelsRight: [CGRect] = []

    /// When true, wide panels are NOT split (whole wide panels fit naturally
    /// in landscape orientation). When false, wide panels are split into
    /// reading-order sub-panels for portrait. Set by the view controller on
    /// layout.
    var isLandscape: Bool = false {
        didSet {
            guard oldValue != isLandscape else { return }
            // Clamp currentPanel into the new panel count.
            if currentPanel >= panelsPerPage, panelsPerPage > 0 {
                currentPanel = panelsPerPage - 1
            }
            pageViewController?.panelDetectionDidUpdate()
        }
    }

    /// Effective panel rects: raw in landscape, split-when-wide in portrait.
    var detectedPanels: [CGRect] {
        isLandscape ? rawDetectedPanels : PanelDetector.splitWidePanels(rawDetectedPanels)
    }
    var detectedPanelsRight: [CGRect] {
        isLandscape ? rawDetectedPanelsRight : PanelDetector.splitWidePanels(rawDetectedPanelsRight)
    }

    /// Total panel count for the visible page(s). Detected counts when
    /// detection has completed; falls back to a 2×3 grid otherwise.
    var panelsPerPage: Int {
        let left = detectedPanels.isEmpty ? 6 : detectedPanels.count
        let right = (pagesPerSpread == 2)
            ? (detectedPanelsRight.isEmpty ? 6 : detectedPanelsRight.count)
            : 0
        return left + right
    }

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
        // Landscape comics always render as a single page (fit-to-width with
        // vertical scroll) — that's the only mode the view controller
        // supports in landscape. Force single-page here so settings-driven
        // applySettings() / re-application can't switch us back to spread
        // mode behind the VC's back.
        let isLandscape = viewportSize.width > viewportSize.height
        let resolved = settings.resolvedLayout(for: viewportSize.width)
        let newPagesPerSpread = isLandscape ? 1 : (resolved == .twoPage ? 2 : 1)
        setSpreadMode(pagesPerSpread: newPagesPerSpread)
    }

    /// Explicitly set spread mode, bypassing settings resolution. Used when
    /// the view controller picks a render mode (e.g. landscape fit-to-width
    /// single page) that should override the settings-derived spread.
    func setSpreadMode(pagesPerSpread newValue: Int) {
        let clamped = newValue == 2 ? 2 : 1
        guard clamped != pagesPerSpread else { return }
        pagesPerSpread = clamped
        if pagesPerSpread == 2 {
            currentPage = alignToSpread(currentPage)
        } else {
            // Dropping spread state: discard the right-page panel data so
            // navigation and overlay counts can't reference stale rects.
            rawDetectedPanelsRight = []
        }
        pageViewController?.updateLayout(pagesPerSpread: pagesPerSpread)
        Task { await displayCurrentPage() }
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
        currentPanel = 0
        await displayCurrentPage()
        updateLocation()
    }

    func goBackward() async {
        let retreat = pagesPerSpread
        let newPage = currentPage - retreat
        guard newPage >= 0 else { return }
        currentPage = alignToSpread(newPage)
        // When stepping backward in guided view, land on the last panel so
        // continuing taps feel like a smooth left-to-right reverse.
        currentPanel = guidedViewEnabled ? max(0, panelsPerPage - 1) : 0
        await displayCurrentPage()
        updateLocation()
    }

    // MARK: - Guided View navigation

    /// Advance to the next panel within the current page. Returns true when
    /// it consumed the tap; false when at the end of the page (caller should
    /// advance to the next page).
    func goNextPanel() -> Bool {
        guard guidedViewEnabled else { return false }
        if currentPanel + 1 < panelsPerPage {
            currentPanel += 1
            pageViewController?.applyGuidedView(currentPanel: currentPanel)
            return true
        }
        return false
    }

    /// Retreat to the previous panel. Returns true if it consumed the tap.
    func goPreviousPanel() -> Bool {
        guard guidedViewEnabled else { return false }
        if currentPanel > 0 {
            currentPanel -= 1
            pageViewController?.applyGuidedView(currentPanel: currentPanel)
            return true
        }
        return false
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

    /// Called by the page view controller when its scrollView zoom changes.
    func setZoomScale(_ scale: CGFloat) {
        zoomScale = scale
    }

    /// Reset zoom to fit the page (animated).
    func resetZoom() {
        pageViewController?.resetZoom(animated: true)
    }

    // MARK: - TOC (empty for comics — thumbnail grid replaces this)

    func tableOfContents() async -> [TOCItem] { [] }

    // MARK: - Highlights (no-op for comics; bookmarks handled separately)

    func applyHighlights(_ highlights: [HighlightRenderInfo]) { }

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

    /// Thumbnail for the scrubber preview. Lookups go through ThumbnailCache
    /// first so scrubbing doesn't compete with the full-page cache. Downscaled
    /// to the requested size on first miss.
    func thumbnail(forPage page: Int, size: CGSize) async -> UIImage? {
        guard page >= 0, page < totalPositions else { return nil }
        if let cached = ThumbnailCache.shared.image(bookId: book.id, page: page) {
            return cached
        }
        guard let full = await loadPageImage(page) else { return nil }
        let scaled = full.thumbnail(maxDimension: max(size.width, size.height) * UIScreen.main.scale) ?? full
        ThumbnailCache.shared.store(scaled, bookId: book.id, page: page)
        return scaled
    }

    // MARK: - Internal

    func setCurrentPage(_ page: Int) {
        guard page != currentPage else { return }
        currentPage = page
        updateLocation()
    }

    func displayCurrentPage() async {
        // Clear any previous detected panels so the overlay reverts to the
        // heuristic grid until detection on the new page completes.
        rawDetectedPanels = []
        rawDetectedPanelsRight = []

        let leftImage = await loadPageImage(currentPage)
        var rightImage: UIImage? = nil
        if pagesPerSpread == 2 && currentPage + 1 < totalPositions {
            rightImage = await loadPageImage(currentPage + 1)
        }
        pageViewController?.displayPages(left: leftImage, right: rightImage)

        // Detect panels off-main so the overlay can switch from heuristic to
        // real panel rects without blocking. The view controller redraws when
        // detection completes.
        Task { await detectPanelsForCurrentPage(left: leftImage, right: rightImage) }

        // Prefetch adjacent pages
        prefetchAdjacentPages()
    }

    private func detectPanelsForCurrentPage(left: UIImage?, right: UIImage?) async {
        let leftPanels: [CGRect]
        if let left {
            leftPanels = await PanelDetector.detectPanels(in: left)
        } else {
            leftPanels = []
        }
        let rightPanels: [CGRect]
        if let right {
            rightPanels = await PanelDetector.detectPanels(in: right)
        } else {
            rightPanels = []
        }

        // Skip the update if the user has navigated to a different page while
        // detection was running.
        await MainActor.run {
            self.rawDetectedPanels = leftPanels
            self.rawDetectedPanelsRight = rightPanels
            // Clamp current panel to detected range so existing index doesn't
            // point past the end on a sparsely-detected page.
            if currentPanel >= panelsPerPage, panelsPerPage > 0 {
                currentPanel = panelsPerPage - 1
            }
            pageViewController?.panelDetectionDidUpdate()
        }
    }

    /// Debug-only: load every page in the book, run panel detection on each,
    /// and log anomalies (no panels, suspiciously few, suspiciously many,
    /// single huge panel that's likely an under-detection). For flagged
    /// pages, also dumps the full panel rect(s) so we can distinguish a
    /// full-bleed splash (panel covers ~100% of width+height) from a
    /// partial under-detection (panel is offset / has unusual aspect).
    func auditAllPagesPanelDetection() async {
        let title = book.title
        NSLog("[PanelAudit] [\(title)] starting audit of \(totalPositions) pages")
        var anomalies = 0
        var fullBleed = 0
        var partial = 0
        for page in 0..<totalPositions {
            guard let image = await loadPageImage(page) else { continue }
            let panels = await PanelDetector.detectPanels(in: image)
            let count = panels.count
            let biggest = panels.max(by: { $0.width * $0.height < $1.width * $1.height })
            let biggestFrac = biggest.map { Double($0.width * $0.height) } ?? 0
            var flags: [String] = []
            if count == 0 { flags.append("ZERO") }
            if count == 1 && biggestFrac > 0.85 { flags.append("SINGLE-GIANT") }
            if count > 12 { flags.append("MANY") }
            if !flags.isEmpty {
                if let r = biggest {
                    // Classify: if the single panel spans ≥95% width AND ≥95%
                    // height, it's a full-bleed page (correct). Otherwise it
                    // might be an under-detection.
                    let isFullBleed = count == 1 && r.width >= 0.95 && r.height >= 0.95
                    if isFullBleed { fullBleed += 1 } else { partial += 1 }
                    let rectStr = String(format: "(%.2f, %.2f, %.2fx%.2f)", r.minX, r.minY, r.width, r.height)
                    let kind = isFullBleed ? "BLEED" : "PARTIAL"
                    NSLog("[PanelAudit] [\(title)] page=\(page + 1) panels=\(count) rect=\(rectStr) flags=\(flags.joined(separator: ",")) class=\(kind)")
                } else {
                    NSLog("[PanelAudit] [\(title)] page=\(page + 1) panels=\(count) flags=\(flags.joined(separator: ","))")
                }
                anomalies += 1
            }
        }
        NSLog("[PanelAudit] [\(title)] complete. anomalies=\(anomalies)/\(totalPositions) (fullBleed=\(fullBleed), partial=\(partial))")
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
