//
//  NativeEPUBEngine.swift
//  Compendus
//
//  ReaderEngine implementation for EPUB files using native UITextView rendering.
//  Replaces the WKWebView-based EPUBEngine with Core Text pagination
//  and NSAttributedString-based content display.
//

import UIKit
import CoreText
import SwiftSoup
import os.log

private let logger = Logger(subsystem: "com.compendus.reader", category: "NativeEPUB")

@Observable
@MainActor
class NativeEPUBEngine: ReaderEngine {
    var currentLocation: ReaderLocation?
    var totalPositions: Int = 0
    var isReady: Bool = false
    var errorMessage: String?

    /// Whether the reader is currently in two-page spread mode.
    var isSpreadMode: Bool = false

    /// Whether a chapter is currently being loaded/parsed in the background.
    var isLoadingChapter: Bool = false

    /// Progress of full-book pagination (0.0 to 1.0). Observed by the loading overlay.
    var paginationProgress: Double = 0
    /// Number of chapters paginated so far (for display).
    var paginatedChapterCount: Int = 0
    /// Total chapters to paginate.
    var totalChapterCount: Int = 0

    var onSelectionChanged: ((ReaderSelection?) -> Void)?
    var onHighlightTapped: ((String) -> Void)?
    var onTapZone: ((String) -> Void)?
    var onFootnoteTapped: ((String) -> Void)?
    var onLinkNavigationRequested: ((URL, Bool) -> Void)?  // (url, isExternal)

    private var parser: EPUBParser?
    private var pageViewController: NativePageViewController?
    private let bookURL: URL

    /// Active chapter loading task (cancelled when a new chapter load begins)
    private var chapterLoadTask: Task<Void, Never>?

    /// Background task that pre-paginates all chapters for accurate global page counts.
    private var fullPaginationTask: Task<Void, Never>?

    // Spine/page tracking (same pattern as EPUBEngine)
    private var currentSpineIndex: Int = 0
    private var currentPageIndex: Int = 0
    private var spinePageCounts: [Int] = []
    private var pendingHighlights: [BookHighlight] = []

    // Store a snapshot of settings values (not a reference) so we can detect changes
    private struct SettingsSnapshot {
        let theme: ReaderTheme
        let fontFamily: ReaderFont
        let fontSize: Double
        let lineHeight: Double
        let layout: ReaderLayout
    }
    private var settingsSnapshot: SettingsSnapshot?
    private var currentSettings: ReaderSettings?

    /// Gutter width between pages in spread mode (must match NativePageViewController.gutterWidth)
    private let spreadGutterWidth: CGFloat = 16

    // Content cache
    private var parsedChapters: [Int: [ContentNode]] = [:]
    private var chapterStrings: [Int: NSAttributedString] = [:]
    private var chapterPages: [Int: [PageInfo]] = [:]
    private var chapterOffsetMaps: [Int: OffsetMap] = [:]
    private var chapterPlainTextMaps: [Int: PlainTextToAttrStringMap] = [:]
    private var chapterMediaAttachments: [Int: [MediaAttachment]] = [:]
    private var chapterFloatingElements: [Int: [FloatingElement]] = [:]

    // MARK: - Read-Along Support

    /// Callback fired when the spine index changes (for chapter tracking in read-along).
    var onSpineIndexChanged: ((Int) -> Void)?

    // CSS stylesheet loaded once per book
    private var bookStylesheet: CSSStylesheet?

    /// Fonts registered from EPUB @font-face rules (unregistered on cleanup)
    private var registeredFonts: [CGFont] = []

    // Media attachments for current chapter (for video/audio tap handling)
    private var currentMediaAttachments: [MediaAttachment] = []

    // Floating elements for current chapter (CSS float images)
    private var currentFloatingElements: [FloatingElement] = []

    // Viewport
    private var viewportSize: CGSize = .zero
    private var safeAreaInsets: UIEdgeInsets = .zero

    // Deferred initial load (waits for view to have proper size)
    private var pendingInitialLoad: (spineIndex: Int, progression: Double?)?

    // Pending character offset for cross-device position restoration (universal format)
    private var pendingCharOffset: Int?

    /// Number of pages visible in a single spread (1 or 2).
    private var pagesPerSpread: Int {
        let settings = currentSettings ?? ReaderSettings()
        let resolved = settings.resolvedLayout(for: viewportSize.width)
        return resolved == .twoPage ? 2 : 1
    }

    /// The effective width of a single page for pagination.
    private var effectivePageWidth: CGFloat {
        if pagesPerSpread == 2 {
            return (viewportSize.width - spreadGutterWidth) / 2
        }
        return viewportSize.width
    }

    /// Pagination insets that incorporate device safe area (notch, home indicator).
    private func paginationInsets(for pageWidth: CGFloat, isTwoPage: Bool) -> UIEdgeInsets {
        var insets = NativePaginationEngine.insets(for: pageWidth, isTwoPageMode: isTwoPage)
        insets.top += safeAreaInsets.top
        insets.bottom += safeAreaInsets.bottom
        return insets
    }

    /// Align a page index to spread boundaries (even index in two-page mode).
    private func alignToSpread(_ pageIndex: Int) -> Int {
        if pagesPerSpread == 2 {
            return pageIndex - (pageIndex % 2)
        }
        return pageIndex
    }

    // MARK: - Read-Along Accessors

    /// The current spine index (chapter) being displayed.
    var activeSpineIndex: Int { currentSpineIndex }

    /// The plain text of the currently displayed chapter.
    var currentChapterPlainText: String? {
        guard let nodes = parsedChapters[currentSpineIndex] else { return nil }
        return Self.extractPlainText(from: nodes)
    }

    /// The full attributed string for the currently displayed chapter.
    var currentChapterAttributedString: NSAttributedString? {
        chapterStrings[currentSpineIndex]
    }

    /// Page boundaries for the currently displayed chapter.
    var currentChapterPageInfos: [PageInfo]? {
        chapterPages[currentSpineIndex]
    }

    /// Total number of pages in the currently displayed chapter.
    var currentChapterPageCount: Int {
        chapterPages[currentSpineIndex]?.count ?? 1
    }

    /// Global (book-wide) zero-based page index for the current position.
    var globalPageIndex: Int {
        let pagesBeforeCurrent = (0..<currentSpineIndex).reduce(0) { sum, i in
            sum + (i < spinePageCounts.count ? spinePageCounts[i] : 1)
        }
        return pagesBeforeCurrent + currentPageIndex
    }

    /// Plain text character offset for the start of the currently displayed page.
    /// Uses the PlainTextToAttrStringMap to find the content node at the page boundary,
    /// returning that node's plain text start. Accurate to the paragraph level.
    var currentPagePlainTextOffset: Int? {
        guard let pages = chapterPages[currentSpineIndex],
              currentPageIndex < pages.count,
              let map = chapterPlainTextMaps[currentSpineIndex] else { return nil }
        return map.plainTextOffset(forAttrStringLocation: pages[currentPageIndex].range.location)
    }

    /// Plain-text-to-attributed-string offset map for the current chapter.
    var currentChapterPlainTextMap: PlainTextToAttrStringMap? {
        chapterPlainTextMaps[currentSpineIndex]
    }

    /// The EPUB spine count (total number of chapters).
    var spineCount: Int {
        parser?.package.spine.count ?? 0
    }

    /// The TOC entries from the EPUB package.
    var tocEntries: [EPUBTOCEntry] {
        parser?.package.tocItems ?? []
    }

    /// Chapter title for a given spine index.
    func chapterTitle(forSpineIndex spineIndex: Int) -> String? {
        guard let parser = parser else { return nil }
        let item = parser.manifestItem(forSpineIndex: spineIndex)
        return findChapterTitle(for: item?.href)
    }

    /// Global page index for a given plain text offset within a spine item.
    func globalPageIndex(forPlainTextOffset offset: Int, inSpine spineIndex: Int) -> Int? {
        guard let map = chapterPlainTextMaps[spineIndex],
              let pages = chapterPages[spineIndex] else { return nil }

        // Convert plain text offset to attributed string location
        guard let attrRange = map.attrStringRange(for: NSRange(location: offset, length: 1)) else { return nil }
        let attrLocation = attrRange.location

        // Find which page contains this attributed string location
        var localPage = 0
        for page in pages {
            if NSLocationInRange(attrLocation, page.range) {
                localPage = page.pageIndex
                break
            }
        }

        // Compute global page
        let pagesBeforeCurrent = (0..<spineIndex).reduce(0) { sum, i in
            sum + (i < spinePageCounts.count ? spinePageCounts[i] : 1)
        }
        return pagesBeforeCurrent + localPage
    }

    /// All parsed chapters as (spineIndex, plainText) for reader mode.
    var allChaptersPlainText: [(spineIndex: Int, plainText: String)] {
        let count = spineCount
        var result: [(spineIndex: Int, plainText: String)] = []
        for i in 0..<count {
            guard let nodes = parsedChapters[i] else { continue }
            let text = Self.extractPlainText(from: nodes)
            guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
            result.append((spineIndex: i, plainText: text))
        }
        return result
    }

    /// Whether a search is currently in progress.
    var isSearching: Bool = false

    /// Search all spine items for a phrase (case-insensitive).
    /// Returns the spine index where the phrase was found, or nil.
    /// Performs file I/O and parsing on a background thread to avoid blocking the UI.
    func findSpineIndex(containingPhrase phrase: String) async -> Int? {
        guard let parser = parser, !phrase.isEmpty else { return nil }

        isSearching = true
        defer { isSearching = false }

        let stylesheet = bookStylesheet
        let cachedChapters = parsedChapters

        // Run the search off the main thread
        let result: (spineIndex: Int, parsedUpdates: [(Int, [ContentNode])])? = await Task.detached {
            var parsedUpdates: [(Int, [ContentNode])] = []

            for (spineIndex, _) in parser.package.spine.enumerated() {
                guard !Task.isCancelled else { return nil }

                let nodes: [ContentNode]
                if let cached = cachedChapters[spineIndex] {
                    nodes = cached
                } else {
                    guard let chapterURL = parser.resolveSpineItemURL(at: spineIndex),
                          let data = try? Data(contentsOf: chapterURL) else { continue }
                    let baseURL = chapterURL.deletingLastPathComponent()
                    let contentParser = XHTMLContentParser(data: data, baseURL: baseURL, stylesheet: stylesheet)
                    let parsed = contentParser.parse()
                    parsedUpdates.append((spineIndex, parsed))
                    nodes = parsed
                }

                let plainText = Self.extractPlainText(from: nodes)
                guard plainText.count > 10 else { continue }

                if plainText.range(of: phrase, options: .caseInsensitive) != nil {
                    return (spineIndex, parsedUpdates)
                }
            }
            return nil
        }.value

        // Cache any newly parsed chapters
        if let result {
            for (index, nodes) in result.parsedUpdates {
                parsedChapters[index] = nodes
            }
            return result.spineIndex
        }
        return nil
    }

    init(bookURL: URL) {
        self.bookURL = bookURL
    }

    /// Release resources when the reader is dismissed.
    /// IMPORTANT: Must be called from onDisappear — @MainActor prevents deinit cleanup.
    func cleanup() {
        chapterLoadTask?.cancel()
        chapterLoadTask = nil
        fullPaginationTask?.cancel()
        fullPaginationTask = nil
        EPUBImageCache.shared.endSession()
        // Unregister embedded fonts
        for cgFont in registeredFonts {
            CTFontManagerUnregisterGraphicsFont(cgFont, nil)
        }
        registeredFonts = []
    }

    // MARK: - Loading

    func load(initialPosition: String? = nil) async {
        logger.info("Loading EPUB from \(self.bookURL.lastPathComponent)")
        do {
            let parser = try await EPUBParser.parse(epubURL: bookURL)
            self.parser = parser
            EPUBImageCache.shared.beginSession(id: bookURL.absoluteString)
            logger.info("Parsed EPUB: \(parser.package.spine.count) spine items, \(parser.package.manifest.count) manifest items")

            // Load CSS stylesheets once for the entire book (off main thread)
            await loadStylesheets(from: parser)

            // Initialize spine page counts
            spinePageCounts = Array(repeating: 1, count: parser.package.spine.count)

            // Create page view controller
            let pageVC = NativePageViewController()
            setupCallbacks(pageVC)
            self.pageViewController = pageVC

            // Determine initial position
            var initialSpineIndex = 0
            var initialProgression: Double?

            if let positionJSON = initialPosition,
               let data = positionJSON.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {

                // Universal position format: { type: "epub", spineIndex, charOffset, progress }
                if json["type"] as? String == "epub",
                   let spineIdx = json["spineIndex"] as? Int,
                   spineIdx >= 0, spineIdx < parser.package.spine.count {
                    initialSpineIndex = spineIdx
                    // Prefer charOffset for precise cross-device restoration
                    if let charOff = json["charOffset"] as? Int {
                        pendingCharOffset = charOff
                        // Use progress as fallback progression while chapter loads
                        initialProgression = json["progress"] as? Double
                    } else {
                        // No charOffset — use progress to estimate within chapter
                        initialProgression = json["progress"] as? Double
                    }
                }
                // Legacy format: { href, locations: { progression, totalProgression } }
                else {
                    if let href = json["href"] as? String {
                        for (index, spineItem) in parser.package.spine.enumerated() {
                            if let manifest = parser.package.manifest[spineItem.idref],
                               manifest.href == href || href.contains(manifest.href) {
                                initialSpineIndex = index
                                break
                            }
                        }
                    }
                    if let locations = json["locations"] as? [String: Any] {
                        initialProgression = locations["progression"] as? Double
                    } else {
                        initialProgression = json["progression"] as? Double
                    }
                }
            }

            currentSpineIndex = initialSpineIndex

            // Store the pending load — will fire when the view has a proper size
            pendingInitialLoad = (spineIndex: initialSpineIndex, progression: initialProgression)

            // The view controller notifies us via onViewReady when it's in the
            // hierarchy and has a non-zero size (viewDidAppear/viewDidLayoutSubviews)
            pageVC.onViewReady = { [weak self] size in
                guard let self = self else { return }
                logger.info("View ready with size \(size.width)x\(size.height)")
                self.viewportSize = size
                self.safeAreaInsets = pageVC.view.window?.safeAreaInsets ?? pageVC.view.safeAreaInsets
                if let pending = self.pendingInitialLoad {
                    self.pendingInitialLoad = nil
                    logger.info("Executing deferred load: spine \(pending.spineIndex), progression \(pending.progression ?? -1)")
                    // Display the requested chapter immediately so the user can
                    // start reading, then paginate all remaining chapters in the
                    // background for accurate global page counts.
                    self.fullPaginationTask = Task {
                        self.loadChapter(at: pending.spineIndex, progression: pending.progression)
                        // Wait for the initial chapter to finish loading before
                        // paginating the rest, so it won't be processed twice.
                        await self.chapterLoadTask?.value
                        guard !Task.isCancelled else { return }
                        // If a charOffset was specified (universal position format),
                        // navigate to the exact character position now that the chapter is loaded.
                        if let charOffset = self.pendingCharOffset {
                            self.pendingCharOffset = nil
                            self.navigateToOffsetInCurrentChapter(charOffset)
                        }
                        await self.paginateAllChapters()
                    }
                }
            }

            pageVC.onViewResized = { [weak self] newSize in
                guard let self = self, self.isReady else { return }
                let oldWidth = self.viewportSize.width
                self.viewportSize = newSize
                self.safeAreaInsets = pageVC.view.window?.safeAreaInsets ?? pageVC.view.safeAreaInsets
                logger.info("View resized to \(newSize.width)x\(newSize.height)")

                // Re-paginate if the width changed (layout mode may have changed)
                if abs(newSize.width - oldWidth) > 1 {
                    self.invalidateAndReload()
                }
            }

        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func setupCallbacks(_ pageVC: NativePageViewController) {
        pageVC.onPageChanged = { [weak self] page, totalPages in
            guard let self = self else { return }
            self.currentPageIndex = page
            self.updateSpinePageCount(totalPages)
            self.updateLocation()

            // Show floating page indicator
            let globalPage = self.globalPageIndex + 1
            let total = self.totalPositions
            if self.isSpreadMode {
                let rightPage = min(globalPage + 1, total)
                self.pageViewController?.showPageIndicator(text: "\(globalPage)–\(rightPage) of \(total)")
            } else {
                self.pageViewController?.showPageIndicator(text: "\(globalPage) of \(total)")
            }
        }

        pageVC.onSelectionChanged = { [weak self] selection in
            self?.onSelectionChanged?(selection)
        }

        pageVC.onHighlightTapped = { [weak self] id in
            self?.onHighlightTapped?(id)
        }

        pageVC.onTapZone = { [weak self] zone in
            self?.onTapZone?(zone)
        }

        pageVC.onLinkTapped = { [weak self] url in
            self?.handleLinkTap(url)
        }

        pageVC.onFootnoteTapped = { [weak self] url in
            self?.handleFootnoteTap(url)
        }
    }

    private func handleLinkTap(_ url: URL) {
        let isExternal = url.scheme == "http" || url.scheme == "https"

        if let callback = onLinkNavigationRequested {
            callback(url, isExternal)
        } else {
            performLinkNavigation(url)
        }
    }

    func performLinkNavigation(_ url: URL) {
        guard let parser = parser else { return }

        // Get the href relative to the EPUB root
        let href = url.lastPathComponent
        let hrefBase = href.components(separatedBy: "#").first ?? href

        // Check if it's an internal link to a spine item
        for (index, spineItem) in parser.package.spine.enumerated() {
            guard let manifest = parser.package.manifest[spineItem.idref] else { continue }
            let manifestBase = manifest.href.components(separatedBy: "#").first ?? manifest.href

            if manifest.href == href || manifestBase == hrefBase
                || href.hasSuffix(manifestBase) || manifestBase.hasSuffix(hrefBase)
                || manifest.href.hasSuffix(hrefBase) || hrefBase.hasSuffix(manifest.href.components(separatedBy: "/").last ?? "") {

                if index != currentSpineIndex {
                    loadChapter(at: index)
                } else {
                    // Same chapter — scroll to top
                    pageViewController?.showPage(0)
                    currentPageIndex = 0
                    updateLocation()
                }
                return
            }
        }

        // External link — open in system browser
        if url.scheme == "http" || url.scheme == "https" {
            UIApplication.shared.open(url)
        }
    }

    /// Whether the spine item at the given index is an EPUB 3 navigation document.
    private func isNavDocument(at spineIndex: Int) -> Bool {
        guard let item = parser?.manifestItem(forSpineIndex: spineIndex) else { return false }
        return item.properties?.contains("nav") == true
    }

    private func handleFootnoteTap(_ url: URL) {
        guard let parser = parser else {
            handleLinkTap(url)
            return
        }

        // Extract fragment identifier (e.g. "#fn1" → "fn1")
        let fragment = url.fragment

        // Resolve the target XHTML file
        let href = url.lastPathComponent
        let hrefBase = href.components(separatedBy: "#").first ?? href

        // Find the target file URL — may be same chapter or a different spine item
        var targetURL: URL?
        for (_, spineItem) in parser.package.spine.enumerated() {
            guard let manifest = parser.package.manifest[spineItem.idref] else { continue }
            let manifestBase = manifest.href.components(separatedBy: "#").first ?? manifest.href
            if manifestBase == hrefBase || manifest.href.hasSuffix(hrefBase)
                || hrefBase.hasSuffix(manifest.href.components(separatedBy: "/").last ?? "") {
                targetURL = parser.resolveURL(for: manifest)
                break
            }
        }

        // If target not found in spine, try resolving directly from manifest
        if targetURL == nil {
            for manifest in parser.package.manifest.values {
                let manifestBase = manifest.href.components(separatedBy: "#").first ?? manifest.href
                if manifestBase == hrefBase || manifest.href.hasSuffix(hrefBase) {
                    targetURL = parser.resolveURL(for: manifest)
                    break
                }
            }
        }

        guard let resolvedURL = targetURL,
              let fragment, !fragment.isEmpty else {
            handleLinkTap(url)
            return
        }

        // Parse footnote content off the main thread to avoid UI blocking
        Task {
            let footnoteText: String? = await Task.detached {
                guard let data = try? Data(contentsOf: resolvedURL) else { return nil }
                let html = String(data: data, encoding: .utf8) ?? ""
                do {
                    let doc = try SwiftSoup.parse(html)
                    if let element = try doc.getElementById(fragment) {
                        let text = try element.text()
                        return text.isEmpty ? nil : text
                    }
                } catch {
                    // Fall through to nil
                }
                return nil
            }.value

            if let footnoteText {
                self.onFootnoteTapped?(footnoteText)
            } else {
                self.handleLinkTap(url)
            }
        }
    }

    // Media players are managed inline by NativePageViewController.
    // No overlay-based presentation needed.

    // MARK: - CSS Stylesheet Loading

    private func loadStylesheets(from parser: EPUBParser) async {
        let manifest = parser.package.manifest
        // Pre-resolve CSS file URLs on main actor
        var cssURLs: [URL] = []
        for (_, item) in manifest {
            guard item.mediaType == "text/css" else { continue }
            cssURLs.append(parser.resolveURL(for: item))
        }

        let extractedURL = parser.extractedURL
        let rootDir = parser.package.rootDirectoryPath

        let (combined, fonts) = await Task.detached { () -> (CSSStylesheet, [CGFont]) in
            var stylesheet = CSSStylesheet()
            for cssURL in cssURLs {
                guard let cssData = try? Data(contentsOf: cssURL),
                      let cssText = String(data: cssData, encoding: .utf8) else { continue }
                let parsed = CSSParser.parse(cssText)
                stylesheet.merge(with: parsed)
            }

            // Register @font-face fonts from EPUB
            var registeredFonts: [CGFont] = []
            for fontFace in stylesheet.fontFaces {
                for src in fontFace.sources {
                    // Skip WOFF/WOFF2 (not supported by CGFont)
                    let lower = src.lowercased()
                    if lower.hasSuffix(".woff") || lower.hasSuffix(".woff2") { continue }

                    let fontPath = rootDir.isEmpty ? src : rootDir + "/" + src
                    let fontURL = extractedURL.appendingPathComponent(fontPath).standardizedFileURL

                    guard let fontData = try? Data(contentsOf: fontURL) as CFData,
                          let provider = CGDataProvider(data: fontData),
                          let cgFont = CGFont(provider) else { continue }

                    var error: Unmanaged<CFError>?
                    if CTFontManagerRegisterGraphicsFont(cgFont, &error) {
                        registeredFonts.append(cgFont)
                    }
                    break // Stop after first successful source for this font-face
                }
            }

            return (stylesheet, registeredFonts)
        }.value
        self.bookStylesheet = combined
        self.registeredFonts = fonts
        if !fonts.isEmpty {
            logger.info("Registered \(fonts.count) embedded fonts from EPUB")
        }
        logger.info("Loaded CSS stylesheets from manifest")
    }

    /// Navigate to a specific spine index. Used by ReadAlongService for cross-chapter search.
    func goToSpine(_ spineIndex: Int) {
        loadChapter(at: spineIndex)
    }

    /// Navigate to the page containing a specific plain text offset within a given spine index.
    /// Used by reader mode to restore the EPUB position when exiting.
    func navigateToPlainTextOffset(_ offset: Int, inSpine spineIndex: Int) {
        if spineIndex != currentSpineIndex {
            loadChapter(at: spineIndex)
            // After chapter loads, navigate to the offset
            Task {
                try? await Task.sleep(for: .milliseconds(300))
                self.navigateToOffsetInCurrentChapter(offset)
            }
        } else {
            navigateToOffsetInCurrentChapter(offset)
        }
    }

    private func navigateToOffsetInCurrentChapter(_ offset: Int) {
        guard let map = chapterPlainTextMaps[currentSpineIndex],
              let attrRange = map.attrStringRange(for: NSRange(location: offset, length: 1)) else { return }
        showPage(containingRange: attrRange)
    }

    /// Briefly flash-highlight a plain text range, then fade it out.
    /// Used to show the user where they left off when exiting reader mode.
    func flashHighlight(plainTextOffset: Int, length: Int, inSpine spineIndex: Int) {
        guard spineIndex == currentSpineIndex,
              let map = chapterPlainTextMaps[spineIndex],
              let attrRange = map.attrStringRange(for: NSRange(location: plainTextOffset, length: length))
        else { return }

        let flashId = "_flash_highlight_"
        let accentColor = UIColor.systemYellow

        // Add the flash highlight on top of existing highlights
        var current = pageViewController?.currentHighlightRanges ?? []
        current.append((id: flashId, range: attrRange, color: accentColor))
        pageViewController?.applyHighlights(current)

        // Remove it after a brief delay
        Task {
            try? await Task.sleep(for: .milliseconds(1500))
            var updated = pageViewController?.currentHighlightRanges ?? []
            updated.removeAll { $0.id == flashId }
            pageViewController?.applyHighlights(updated)
        }
    }

    // MARK: - Chapter Loading

    private func loadChapter(at spineIndex: Int, startAtEnd: Bool = false, progression: Double? = nil) {
        guard let parser = parser else { return }
        guard spineIndex >= 0, spineIndex < parser.package.spine.count else { return }

        // Route fixed-layout EPUBs to dedicated renderer
        if parser.package.isFixedLayout {
            loadFXLChapter(at: spineIndex, startAtEnd: startAtEnd, progression: progression)
            return
        }

        // Route navigation documents to custom TOC renderer
        if isNavDocument(at: spineIndex) {
            loadNavChapter(at: spineIndex, startAtEnd: startAtEnd, progression: progression)
            return
        }

        // Cancel any in-flight chapter load
        chapterLoadTask?.cancel()

        currentSpineIndex = spineIndex
        onSpineIndexChanged?(spineIndex)

        // Update viewport size from current view
        if let vcView = pageViewController?.view, vcView.bounds.width > 0 {
            viewportSize = vcView.bounds.size
        }

        // Get chapter file URL
        guard let chapterURL = parser.resolveSpineItemURL(at: spineIndex) else {
            errorMessage = "Could not resolve chapter at index \(spineIndex)"
            return
        }

        logger.info("Loading chapter \(spineIndex) from \(chapterURL.lastPathComponent)")

        // Capture values needed for background work
        let cachedNodes = parsedChapters[spineIndex]
        let settings = currentSettings ?? ReaderSettings()
        let viewport = viewportSize
        let stylesheet = bookStylesheet
        let gutterWidth = spreadGutterWidth
        let resolvedLayout = settings.resolvedLayout(for: viewport.width)
        let capturedSafeArea = safeAreaInsets

        // If the chapter is already fully built (nodes + pages), display immediately
        if cachedNodes != nil, let cachedPages = chapterPages[spineIndex],
           let cachedString = chapterStrings[spineIndex] {
            displayChapter(
                spineIndex: spineIndex,
                nodes: cachedNodes!,
                attrString: cachedString,
                offsetMap: chapterOffsetMaps[spineIndex]!,
                plainTextMap: chapterPlainTextMaps[spineIndex]!,
                pages: cachedPages,
                mediaAttachments: chapterMediaAttachments[spineIndex] ?? [],
                floatingElements: chapterFloatingElements[spineIndex] ?? [],
                settings: settings,
                startAtEnd: startAtEnd,
                progression: progression
            )
            return
        }

        // Heavy work needed — show loading indicator and run off-main-thread
        isLoadingChapter = true
        pageViewController?.showLoadingIndicator(true)

        chapterLoadTask = Task { [weak self] in
            // Background: parse, build attributed string, paginate
            let result: ChapterBuildResult? = await Task.detached {
                // Read file
                guard let data = try? Data(contentsOf: chapterURL) else { return nil }

                // Parse XHTML
                let nodes: [ContentNode]
                if let cached = cachedNodes {
                    nodes = cached
                } else {
                    let baseURL = chapterURL.deletingLastPathComponent()
                    let contentParser = XHTMLContentParser(data: data, baseURL: baseURL, stylesheet: stylesheet)
                    nodes = contentParser.parse()
                }

                guard !Task.isCancelled else { return nil }

                // Compute layout (resolvedLayout captured before entering detached task)
                let isTwoPage = resolvedLayout == .twoPage
                let pageWidth = isTwoPage ? (viewport.width - gutterWidth) / 2 : viewport.width
                var insets = NativePaginationEngine.insets(for: pageWidth, isTwoPageMode: isTwoPage)
                insets.top += capturedSafeArea.top
                insets.bottom += capturedSafeArea.bottom
                let contentWidth = pageWidth - insets.left - insets.right
                let contentHeight = viewport.height - insets.top - insets.bottom
                let pageViewportSize = CGSize(width: pageWidth, height: viewport.height)

                // Build attributed string
                let builder = AttributedStringBuilder(
                    settings: settings,
                    contentWidth: max(1, contentWidth),
                    contentHeight: max(1, contentHeight)
                )
                let (attrString, offsetMap, plainTextMap) = builder.build(from: nodes)

                guard !Task.isCancelled else { return nil }

                // Paginate
                let pages = NativePaginationEngine.paginate(
                    attributedString: attrString,
                    viewportSize: pageViewportSize,
                    contentInsets: insets
                )

                return ChapterBuildResult(
                    nodes: nodes,
                    attrString: attrString,
                    offsetMap: offsetMap,
                    plainTextMap: plainTextMap,
                    pages: pages,
                    mediaAttachments: builder.mediaAttachments,
                    floatingElements: builder.floatingElements
                )
            }.value

            guard !Task.isCancelled, let self, let result else {
                await MainActor.run { [weak self] in
                    self?.isLoadingChapter = false
                    self?.pageViewController?.showLoadingIndicator(false)
                }
                return
            }

            // Back on MainActor — cache and display
            await MainActor.run {
                self.parsedChapters[spineIndex] = result.nodes
                self.chapterStrings[spineIndex] = result.attrString
                self.chapterOffsetMaps[spineIndex] = result.offsetMap
                self.chapterPlainTextMaps[spineIndex] = result.plainTextMap
                self.chapterPages[spineIndex] = result.pages
                self.chapterMediaAttachments[spineIndex] = result.mediaAttachments
                self.chapterFloatingElements[spineIndex] = result.floatingElements

                self.isLoadingChapter = false
                self.pageViewController?.showLoadingIndicator(false)

                self.displayChapter(
                    spineIndex: spineIndex,
                    nodes: result.nodes,
                    attrString: result.attrString,
                    offsetMap: result.offsetMap,
                    plainTextMap: result.plainTextMap,
                    pages: result.pages,
                    mediaAttachments: result.mediaAttachments,
                    floatingElements: result.floatingElements,
                    settings: settings,
                    startAtEnd: startAtEnd,
                    progression: progression
                )
            }
        }
    }

    /// Result of background chapter parsing + building.
    /// @unchecked because NSAttributedString and UIImage are not formally Sendable,
    /// but are safe here since we construct in one task and consume in another without sharing.
    private struct ChapterBuildResult: @unchecked Sendable {
        let nodes: [ContentNode]
        let attrString: NSAttributedString
        let offsetMap: OffsetMap
        let plainTextMap: PlainTextToAttrStringMap
        let pages: [PageInfo]
        let mediaAttachments: [MediaAttachment]
        let floatingElements: [FloatingElement]
    }

    // MARK: - Native TOC Rendering

    /// Build a styled attributed string for the table of contents using the parsed TOC entries.
    /// Returns the same tuple type as `AttributedStringBuilder.build(from:)` for pipeline compatibility.
    private func buildTOCAttributedString(
        settings: ReaderSettings,
        contentWidth: CGFloat,
        contentHeight: CGFloat
    ) -> (NSAttributedString, OffsetMap, PlainTextToAttrStringMap) {
        guard let parser = parser else {
            return (NSAttributedString(), OffsetMap(), PlainTextToAttrStringMap())
        }

        let tocEntries = parser.package.tocItems
        let result = NSMutableAttributedString()

        let fontSize = CGFloat(settings.fontSize)
        let lineHeight = CGFloat(settings.lineHeight)
        let textColor = settings.theme.textColor
        let accentColor = UIColor.tintColor

        let bodyFont = settings.nativeFont
        let boldFont = settings.nativeBoldFont

        // Heading: "Contents"
        let headingSize = fontSize * 1.6
        let headingFont: UIFont = {
            if let d = boldFont.fontDescriptor.withSymbolicTraits(.traitBold) {
                return UIFont(descriptor: d, size: headingSize)
            }
            return .boldSystemFont(ofSize: headingSize)
        }()
        let headingParaStyle = NSMutableParagraphStyle()
        headingParaStyle.lineHeightMultiple = lineHeight
        headingParaStyle.paragraphSpacingBefore = headingSize * 0.6
        headingParaStyle.paragraphSpacing = headingSize * 0.8
        headingParaStyle.alignment = .natural

        result.append(NSAttributedString(string: "Contents\n", attributes: [
            .font: headingFont,
            .foregroundColor: textColor,
            .paragraphStyle: headingParaStyle
        ]))

        // Recursively append TOC entries
        func appendEntries(_ entries: [EPUBTOCEntry], level: Int) {
            for entry in entries {
                let indent = CGFloat(level) * fontSize * 1.5
                let paraStyle = NSMutableParagraphStyle()
                paraStyle.lineHeightMultiple = lineHeight
                paraStyle.paragraphSpacing = fontSize * 0.5
                paraStyle.headIndent = indent
                paraStyle.firstLineHeadIndent = indent
                paraStyle.alignment = .natural

                // Build a file URL from the entry href that handleLinkTap can resolve
                let rootDir = parser.package.rootDirectoryPath
                let fullPath = rootDir.isEmpty ? entry.href : rootDir + "/" + entry.href
                let linkURL = parser.extractedURL.appendingPathComponent(fullPath)

                let attrs: [NSAttributedString.Key: Any] = [
                    .font: level == 0 ? boldFont : bodyFont,
                    .foregroundColor: accentColor,
                    .paragraphStyle: paraStyle,
                    .underlineStyle: NSUnderlineStyle.single.rawValue,
                    .link: linkURL
                ]

                result.append(NSAttributedString(string: entry.title + "\n", attributes: attrs))

                if !entry.children.isEmpty {
                    appendEntries(entry.children, level: level + 1)
                }
            }
        }

        appendEntries(tocEntries, level: 0)

        // Build minimal offset map and plain text map
        let offsetMap = OffsetMap()
        let plainTextMap = PlainTextToAttrStringMap()

        return (result, offsetMap, plainTextMap)
    }

    /// Static version for off-main-thread TOC building during paginateAllChapters.
    nonisolated private static func buildTOCAttributedStringStatic(
        tocEntries: [EPUBTOCEntry],
        fontSize: CGFloat,
        lineHeight: CGFloat,
        textColor: UIColor,
        bodyFont: UIFont,
        boldFont: UIFont,
        extractedURL: URL,
        rootDirectoryPath: String
    ) -> (NSAttributedString, OffsetMap, PlainTextToAttrStringMap) {
        let result = NSMutableAttributedString()

        let accentColor = UIColor.tintColor

        let headingSize = fontSize * 1.6
        let headingFont: UIFont = {
            if let d = boldFont.fontDescriptor.withSymbolicTraits(.traitBold) {
                return UIFont(descriptor: d, size: headingSize)
            }
            return .boldSystemFont(ofSize: headingSize)
        }()
        let headingParaStyle = NSMutableParagraphStyle()
        headingParaStyle.lineHeightMultiple = lineHeight
        headingParaStyle.paragraphSpacingBefore = headingSize * 0.6
        headingParaStyle.paragraphSpacing = headingSize * 0.8
        headingParaStyle.alignment = .natural

        result.append(NSAttributedString(string: "Contents\n", attributes: [
            .font: headingFont,
            .foregroundColor: textColor,
            .paragraphStyle: headingParaStyle
        ]))

        func appendEntries(_ entries: [EPUBTOCEntry], level: Int) {
            for entry in entries {
                let indent = CGFloat(level) * fontSize * 1.5
                let paraStyle = NSMutableParagraphStyle()
                paraStyle.lineHeightMultiple = lineHeight
                paraStyle.paragraphSpacing = fontSize * 0.5
                paraStyle.headIndent = indent
                paraStyle.firstLineHeadIndent = indent
                paraStyle.alignment = .natural

                let fullPath = rootDirectoryPath.isEmpty ? entry.href : rootDirectoryPath + "/" + entry.href
                let linkURL = extractedURL.appendingPathComponent(fullPath)

                let attrs: [NSAttributedString.Key: Any] = [
                    .font: level == 0 ? boldFont : bodyFont,
                    .foregroundColor: accentColor,
                    .paragraphStyle: paraStyle,
                    .underlineStyle: NSUnderlineStyle.single.rawValue,
                    .link: linkURL
                ]

                result.append(NSAttributedString(string: entry.title + "\n", attributes: attrs))

                if !entry.children.isEmpty {
                    appendEntries(entry.children, level: level + 1)
                }
            }
        }

        appendEntries(tocEntries, level: 0)

        return (result, OffsetMap(), PlainTextToAttrStringMap())
    }

    /// Load a navigation document spine item using custom TOC rendering.
    private func loadNavChapter(at spineIndex: Int, startAtEnd: Bool = false, progression: Double? = nil) {
        guard let parser = parser else { return }

        chapterLoadTask?.cancel()

        currentSpineIndex = spineIndex
        onSpineIndexChanged?(spineIndex)

        if let vcView = pageViewController?.view, vcView.bounds.width > 0 {
            viewportSize = vcView.bounds.size
        }

        let settings = currentSettings ?? ReaderSettings()
        let viewport = viewportSize
        let gutterWidth = spreadGutterWidth
        let resolvedLayout = settings.resolvedLayout(for: viewport.width)

        // If already cached, display immediately
        if let cachedPages = chapterPages[spineIndex],
           let cachedString = chapterStrings[spineIndex] {
            displayChapter(
                spineIndex: spineIndex,
                nodes: [],
                attrString: cachedString,
                offsetMap: chapterOffsetMaps[spineIndex] ?? OffsetMap(),
                plainTextMap: chapterPlainTextMaps[spineIndex] ?? PlainTextToAttrStringMap(),
                pages: cachedPages,
                mediaAttachments: [],
                floatingElements: [],
                settings: settings,
                startAtEnd: startAtEnd,
                progression: progression
            )
            return
        }

        isLoadingChapter = true
        pageViewController?.showLoadingIndicator(true)

        // Build TOC attributed string (requires main actor for parser access)
        let isTwoPage = resolvedLayout == .twoPage
        let pageWidth = isTwoPage ? (viewport.width - gutterWidth) / 2 : viewport.width
        let insets = paginationInsets(for: pageWidth, isTwoPage: isTwoPage)
        let contentWidth = pageWidth - insets.left - insets.right
        let contentHeight = viewport.height - insets.top - insets.bottom
        let pageViewportSize = CGSize(width: pageWidth, height: viewport.height)

        let (attrString, offsetMap, plainTextMap) = buildTOCAttributedString(
            settings: settings,
            contentWidth: max(1, contentWidth),
            contentHeight: max(1, contentHeight)
        )

        // Paginate in background
        chapterLoadTask = Task { [weak self] in
            let pages = await Task.detached {
                NativePaginationEngine.paginate(
                    attributedString: attrString,
                    viewportSize: pageViewportSize,
                    contentInsets: insets
                )
            }.value

            guard !Task.isCancelled, let self else {
                await MainActor.run { [weak self] in
                    self?.isLoadingChapter = false
                    self?.pageViewController?.showLoadingIndicator(false)
                }
                return
            }

            await MainActor.run {
                self.parsedChapters[spineIndex] = []
                self.chapterStrings[spineIndex] = attrString
                self.chapterOffsetMaps[spineIndex] = offsetMap
                self.chapterPlainTextMaps[spineIndex] = plainTextMap
                self.chapterPages[spineIndex] = pages
                self.chapterMediaAttachments[spineIndex] = []
                self.chapterFloatingElements[spineIndex] = []

                self.isLoadingChapter = false
                self.pageViewController?.showLoadingIndicator(false)

                self.displayChapter(
                    spineIndex: spineIndex,
                    nodes: [],
                    attrString: attrString,
                    offsetMap: offsetMap,
                    plainTextMap: plainTextMap,
                    pages: pages,
                    mediaAttachments: [],
                    floatingElements: [],
                    settings: settings,
                    startAtEnd: startAtEnd,
                    progression: progression
                )
            }
        }
    }

    // MARK: - Fixed Layout (FXL) Chapter Loading

    /// Load a fixed-layout (pre-paginated) chapter as a single page per spine item.
    private func loadFXLChapter(at spineIndex: Int, startAtEnd: Bool = false, progression: Double? = nil) {
        guard let parser = parser else { return }
        guard spineIndex >= 0, spineIndex < parser.package.spine.count else { return }

        chapterLoadTask?.cancel()

        currentSpineIndex = spineIndex
        onSpineIndexChanged?(spineIndex)

        if let vcView = pageViewController?.view, vcView.bounds.width > 0 {
            viewportSize = vcView.bounds.size
        }

        guard let chapterURL = parser.resolveSpineItemURL(at: spineIndex) else {
            errorMessage = "Could not resolve chapter at index \(spineIndex)"
            return
        }

        let cachedNodes = parsedChapters[spineIndex]
        let settings = currentSettings ?? ReaderSettings()
        let viewport = viewportSize
        let stylesheet = bookStylesheet

        // If cached, display immediately
        if cachedNodes != nil, let cachedPages = chapterPages[spineIndex],
           let cachedString = chapterStrings[spineIndex] {
            displayChapter(
                spineIndex: spineIndex,
                nodes: cachedNodes!,
                attrString: cachedString,
                offsetMap: chapterOffsetMaps[spineIndex]!,
                plainTextMap: chapterPlainTextMaps[spineIndex]!,
                pages: cachedPages,
                mediaAttachments: chapterMediaAttachments[spineIndex] ?? [],
                floatingElements: chapterFloatingElements[spineIndex] ?? [],
                settings: settings,
                startAtEnd: startAtEnd,
                progression: progression
            )
            return
        }

        isLoadingChapter = true
        pageViewController?.showLoadingIndicator(true)

        chapterLoadTask = Task { [weak self] in
            let result: ChapterBuildResult? = await Task.detached {
                guard let data = try? Data(contentsOf: chapterURL) else { return nil }

                // Parse XHTML
                let nodes: [ContentNode]
                if let cached = cachedNodes {
                    nodes = cached
                } else {
                    let baseURL = chapterURL.deletingLastPathComponent()
                    let contentParser = XHTMLContentParser(data: data, baseURL: baseURL, stylesheet: stylesheet)
                    nodes = contentParser.parse()
                }

                guard !Task.isCancelled else { return nil }

                // Parse viewport meta for FXL content dimensions
                let fxlViewport = NativeEPUBEngine.parseViewport(from: data)

                // Use FXL viewport or fall back to screen viewport
                let contentSize = fxlViewport ?? viewport

                let builder = AttributedStringBuilder(
                    settings: settings,
                    contentWidth: max(1, contentSize.width),
                    contentHeight: max(1, contentSize.height)
                )
                let (attrString, offsetMap, plainTextMap) = builder.build(from: nodes)

                // FXL: one page per spine item covering the entire string
                let singlePage = PageInfo(
                    range: NSRange(location: 0, length: attrString.length),
                    pageIndex: 0
                )

                return ChapterBuildResult(
                    nodes: nodes,
                    attrString: attrString,
                    offsetMap: offsetMap,
                    plainTextMap: plainTextMap,
                    pages: [singlePage],
                    mediaAttachments: builder.mediaAttachments,
                    floatingElements: builder.floatingElements
                )
            }.value

            guard !Task.isCancelled, let self, let result else {
                await MainActor.run { [weak self] in
                    self?.isLoadingChapter = false
                    self?.pageViewController?.showLoadingIndicator(false)
                }
                return
            }

            await MainActor.run {
                self.parsedChapters[spineIndex] = result.nodes
                self.chapterStrings[spineIndex] = result.attrString
                self.chapterOffsetMaps[spineIndex] = result.offsetMap
                self.chapterPlainTextMaps[spineIndex] = result.plainTextMap
                self.chapterPages[spineIndex] = result.pages
                self.chapterMediaAttachments[spineIndex] = result.mediaAttachments
                self.chapterFloatingElements[spineIndex] = result.floatingElements

                self.isLoadingChapter = false
                self.pageViewController?.showLoadingIndicator(false)

                self.displayChapter(
                    spineIndex: spineIndex,
                    nodes: result.nodes,
                    attrString: result.attrString,
                    offsetMap: result.offsetMap,
                    plainTextMap: result.plainTextMap,
                    pages: result.pages,
                    mediaAttachments: result.mediaAttachments,
                    floatingElements: result.floatingElements,
                    settings: settings,
                    startAtEnd: startAtEnd,
                    progression: progression
                )
            }
        }
    }

    /// Parse a viewport meta tag from XHTML data (e.g. `<meta name="viewport" content="width=600, height=800">`).
    nonisolated static func parseViewport(from data: Data) -> CGSize? {
        guard let html = String(data: data, encoding: .utf8) else { return nil }

        // Quick regex-based extraction — avoids full DOM parse just for meta tag
        guard let range = html.range(of: #"<meta[^>]*name\s*=\s*["']viewport["'][^>]*>"#,
                                       options: .regularExpression, range: html.startIndex..<html.endIndex) else {
            return nil
        }

        let metaTag = String(html[range])
        guard let contentRange = metaTag.range(of: #"content\s*=\s*["']([^"']+)["']"#,
                                                 options: .regularExpression) else {
            return nil
        }

        let content = String(metaTag[contentRange])
            .replacingOccurrences(of: #"content\s*=\s*["']"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"["']"#, with: "", options: .regularExpression)

        var width: CGFloat?
        var height: CGFloat?

        for part in content.split(separator: ",") {
            let trimmed = part.trimmingCharacters(in: .whitespaces)
            let kv = trimmed.split(separator: "=", maxSplits: 1)
            guard kv.count == 2 else { continue }
            let key = kv[0].trimmingCharacters(in: .whitespaces).lowercased()
            let value = kv[1].trimmingCharacters(in: .whitespaces)
            if key == "width", let v = Double(value) { width = CGFloat(v) }
            if key == "height", let v = Double(value) { height = CGFloat(v) }
        }

        if let w = width, let h = height, w > 0, h > 0 {
            return CGSize(width: w, height: h)
        }
        return nil
    }

    /// Display a fully-built chapter on screen (must be called on MainActor).
    private func displayChapter(
        spineIndex: Int,
        nodes: [ContentNode],
        attrString: NSAttributedString,
        offsetMap: OffsetMap,
        plainTextMap: PlainTextToAttrStringMap,
        pages: [PageInfo],
        mediaAttachments: [MediaAttachment],
        floatingElements: [FloatingElement],
        settings: ReaderSettings,
        startAtEnd: Bool,
        progression: Double?
    ) {
        guard let parser = parser else { return }

        // FXL books are always single-page (no spread)
        let isFXL = parser.package.isFixedLayout
        let resolvedLayout = settings.resolvedLayout(for: viewportSize.width)
        let isTwoPage = isFXL ? false : resolvedLayout == .twoPage
        isSpreadMode = isTwoPage

        logger.info("Attributed string: \(attrString.length) chars, offsets: \(offsetMap.entries.count)")

        if attrString.length > 0 {
            let preview = attrString.string.prefix(100)
            logger.info("Content preview: \(preview)")
        } else {
            logger.warning("Attributed string is EMPTY — content will not be visible")
        }

        // Store media attachments and floating elements
        currentMediaAttachments = mediaAttachments
        currentFloatingElements = floatingElements

        updateSpinePageCount(pages.count)
        logger.info("Paginated into \(pages.count) pages")

        // Determine starting page (aligned to spread boundaries)
        var startPage = 0
        if startAtEnd {
            startPage = max(0, pages.count - 1)
        } else if let progression = progression, progression > 0 {
            startPage = Int(round(progression * Double(max(1, pages.count - 1))))
            startPage = max(0, min(startPage, pages.count - 1))
        }
        startPage = alignToSpread(startPage)

        currentPageIndex = startPage

        // Configure layout mode on the page view controller
        pageViewController?.configureLayout(twoPage: isTwoPage)

        // Compute safe-area-aware insets for text container
        let displayPageWidth = isTwoPage ? (viewportSize.width - spreadGutterWidth) / 2 : viewportSize.width
        let displayInsets = paginationInsets(for: displayPageWidth, isTwoPage: isTwoPage)

        // Suppress "This page is blank" in spread mode or when rendition:spread is set
        let hasSpread = parser.package.metadata.renditionSpread != nil
            && parser.package.metadata.renditionSpread != .none
        pageViewController?.suppressBlankPagePlaceholder = isTwoPage || hasSpread

        // Display — pass insets explicitly so loadContent always has safe-area-aware values
        let manifestItem = parser.manifestItem(forSpineIndex: spineIndex)
        pageViewController?.loadContent(
            attributedString: attrString,
            pages: pages,
            chapterHref: manifestItem?.href,
            startAtPage: startPage,
            mediaAttachments: currentMediaAttachments,
            floatingElements: currentFloatingElements,
            textContainerInsets: displayInsets
        )

        // Apply theme
        if let settings = currentSettings {
            pageViewController?.applyTheme(backgroundColor: settings.theme.backgroundColor, theme: settings.theme)
        }

        // Apply highlights
        applyHighlightsToCurrentPage()

        isReady = true
        updateLocation()

        // Pre-fetch adjacent chapters in background
        prefetchAdjacentChapters()
    }

    private func updateSpinePageCount(_ pageCount: Int) {
        if currentSpineIndex < spinePageCounts.count {
            spinePageCounts[currentSpineIndex] = pageCount
        }
        totalPositions = spinePageCounts.reduce(0, +)
    }

    // MARK: - Full Book Pagination

    /// Pre-paginate all chapters so global page counts are accurate.
    /// Runs heavy work in a background task. Awaitable — blocks until complete.
    private func paginateAllChapters() async {
        guard let parser = parser else { return }

        let spineCount = parser.package.spine.count
        let stylesheet = bookStylesheet
        let settings = currentSettings ?? ReaderSettings()
        let viewport = viewportSize
        let gutterWidth = spreadGutterWidth
        let resolvedLayout = settings.resolvedLayout(for: viewport.width)

        let isTwoPage = resolvedLayout == .twoPage
        let pageWidth = isTwoPage ? (viewport.width - gutterWidth) / 2 : viewport.width
        let insets = paginationInsets(for: pageWidth, isTwoPage: isTwoPage)
        let contentWidth = pageWidth - insets.left - insets.right
        let contentHeight = viewport.height - insets.top - insets.bottom
        let pageViewportSize = CGSize(width: pageWidth, height: viewport.height)

        // Categorize spine items: nav documents vs regular chapters.
        var chapterURLs: [(index: Int, url: URL)] = []
        var navDocIndices: [Int] = []

        for index in 0..<spineCount {
            if chapterPages[index] != nil { continue }

            if isNavDocument(at: index) {
                navDocIndices.append(index)
                continue
            }

            guard let url = parser.resolveSpineItemURL(at: index) else { continue }
            chapterURLs.append((index, url))
        }

        // Build and paginate nav document TOC strings off main thread
        if !navDocIndices.isEmpty {
            let tocEntries = parser.package.tocItems
            let extractedURL = parser.extractedURL
            let rootDir = parser.package.rootDirectoryPath

            let tocFontSize = CGFloat(settings.fontSize)
            let tocLineHeight = CGFloat(settings.lineHeight)
            let tocTextColor = settings.theme.textColor
            let tocBodyFont = settings.nativeFont
            let tocBoldFont = settings.nativeBoldFont

            let navResults: [(index: Int, attrString: NSAttributedString, offsetMap: OffsetMap, plainTextMap: PlainTextToAttrStringMap, pages: [PageInfo])] = await Task.detached {
                var results: [(index: Int, attrString: NSAttributedString, offsetMap: OffsetMap, plainTextMap: PlainTextToAttrStringMap, pages: [PageInfo])] = []
                for navIndex in navDocIndices {
                    let (attrString, offsetMap, plainTextMap) = Self.buildTOCAttributedStringStatic(
                        tocEntries: tocEntries,
                        fontSize: tocFontSize,
                        lineHeight: tocLineHeight,
                        textColor: tocTextColor,
                        bodyFont: tocBodyFont,
                        boldFont: tocBoldFont,
                        extractedURL: extractedURL,
                        rootDirectoryPath: rootDir
                    )
                    let pages = NativePaginationEngine.paginate(
                        attributedString: attrString,
                        viewportSize: pageViewportSize,
                        contentInsets: insets
                    )
                    results.append((navIndex, attrString, offsetMap, plainTextMap, pages))
                }
                return results
            }.value

            for item in navResults {
                parsedChapters[item.index] = []
                chapterStrings[item.index] = item.attrString
                chapterOffsetMaps[item.index] = item.offsetMap
                chapterPlainTextMaps[item.index] = item.plainTextMap
                chapterPages[item.index] = item.pages
                chapterMediaAttachments[item.index] = []
                chapterFloatingElements[item.index] = []
                if item.index < spinePageCounts.count {
                    spinePageCounts[item.index] = item.pages.count
                }
            }
        }

        guard !chapterURLs.isEmpty else {
            totalPositions = spinePageCounts.reduce(0, +)
            paginationProgress = 1.0
            return
        }

        // Track pagination progress
        let totalToProcess = chapterURLs.count
        totalChapterCount = totalToProcess + navDocIndices.count
        paginatedChapterCount = navDocIndices.count
        paginationProgress = totalToProcess > 0 ? Double(paginatedChapterCount) / Double(totalChapterCount) : 0

        // Process chapters in parallel with bounded concurrency
        let maxConcurrent = 4
        var completedCount = navDocIndices.count

        await withTaskGroup(of: (Int, ChapterBuildResult?).self) { group in
            var urlIterator = chapterURLs.makeIterator()

            // Seed initial batch of tasks
            for _ in 0..<min(maxConcurrent, chapterURLs.count) {
                guard let (index, chapterURL) = urlIterator.next() else { break }
                group.addTask {
                    guard let data = try? Data(contentsOf: chapterURL) else { return (index, nil) }

                    let baseURL = chapterURL.deletingLastPathComponent()
                    let contentParser = XHTMLContentParser(data: data, baseURL: baseURL, stylesheet: stylesheet)
                    let nodes = contentParser.parse()

                    guard !Task.isCancelled else { return (index, nil) }

                    let builder = AttributedStringBuilder(
                        settings: settings,
                        contentWidth: max(1, contentWidth),
                        contentHeight: max(1, contentHeight)
                    )
                    let (attrString, offsetMap, plainTextMap) = builder.build(from: nodes)

                    guard !Task.isCancelled else { return (index, nil) }

                    let pages = NativePaginationEngine.paginate(
                        attributedString: attrString,
                        viewportSize: pageViewportSize,
                        contentInsets: insets
                    )

                    return (index, ChapterBuildResult(
                        nodes: nodes,
                        attrString: attrString,
                        offsetMap: offsetMap,
                        plainTextMap: plainTextMap,
                        pages: pages,
                        mediaAttachments: builder.mediaAttachments,
                        floatingElements: builder.floatingElements
                    ))
                }
            }

            // Process completed tasks and submit new ones (sliding window)
            for await (index, result) in group {
                guard !Task.isCancelled else { break }

                if let result {
                    parsedChapters[index] = result.nodes
                    chapterStrings[index] = result.attrString
                    chapterOffsetMaps[index] = result.offsetMap
                    chapterPlainTextMaps[index] = result.plainTextMap
                    chapterPages[index] = result.pages
                    chapterMediaAttachments[index] = result.mediaAttachments
                    chapterFloatingElements[index] = result.floatingElements
                    if index < spinePageCounts.count {
                        spinePageCounts[index] = result.pages.count
                    }
                }

                completedCount += 1
                paginatedChapterCount = completedCount
                paginationProgress = Double(completedCount) / Double(totalChapterCount)
                totalPositions = spinePageCounts.reduce(0, +)

                // Submit next chapter if available
                if let (nextIndex, nextURL) = urlIterator.next() {
                    group.addTask {
                        guard let data = try? Data(contentsOf: nextURL) else { return (nextIndex, nil) }

                        let baseURL = nextURL.deletingLastPathComponent()
                        let contentParser = XHTMLContentParser(data: data, baseURL: baseURL, stylesheet: stylesheet)
                        let nodes = contentParser.parse()

                        guard !Task.isCancelled else { return (nextIndex, nil) }

                        let builder = AttributedStringBuilder(
                            settings: settings,
                            contentWidth: max(1, contentWidth),
                            contentHeight: max(1, contentHeight)
                        )
                        let (attrString, offsetMap, plainTextMap) = builder.build(from: nodes)

                        guard !Task.isCancelled else { return (nextIndex, nil) }

                        let pages = NativePaginationEngine.paginate(
                            attributedString: attrString,
                            viewportSize: pageViewportSize,
                            contentInsets: insets
                        )

                        return (nextIndex, ChapterBuildResult(
                            nodes: nodes,
                            attrString: attrString,
                            offsetMap: offsetMap,
                            plainTextMap: plainTextMap,
                            pages: pages,
                            mediaAttachments: builder.mediaAttachments,
                            floatingElements: builder.floatingElements
                        ))
                    }
                }
            }
        }

        paginationProgress = 1.0
        logger.info("Full book pagination complete: \(self.totalPositions) total pages across \(spineCount) chapters")
    }

    // MARK: - Image Pre-loading

    /// Walk the AST and pre-load all referenced images into the shared cache.
    /// Called from a background task before building the attributed string so
    /// that `AttributedStringBuilder.appendImage` hits the cache immediately.
    nonisolated static func preloadImages(from nodes: [ContentNode]) {
        var urls: [URL] = []
        collectImageURLs(from: nodes, into: &urls)
        for url in urls {
            guard EPUBImageCache.shared.image(forPath: url.path) == nil else { continue }
            if let image = UIImage(contentsOfFile: url.path) {
                EPUBImageCache.shared.setImage(image, forPath: url.path)
            }
        }
    }

    /// Recursively collect image URLs from content nodes.
    nonisolated private static func collectImageURLs(from nodes: [ContentNode], into urls: inout [URL]) {
        for node in nodes {
            switch node {
            case .image(let url, _, _, _, _):
                urls.append(url)
            case .video(_, let poster, _):
                if let poster { urls.append(poster) }
            case .container(let children, _):
                collectImageURLs(from: children, into: &urls)
            case .blockquote(let children):
                collectImageURLs(from: children, into: &urls)
            case .list(_, let items, _):
                for item in items {
                    collectImageURLs(from: item.children, into: &urls)
                }
            case .paragraph, .heading, .codeBlock, .horizontalRule, .table, .audio:
                break
            }
        }
    }

    private func prefetchAdjacentChapters() {
        guard let parser = parser else { return }
        let indices = [currentSpineIndex - 1, currentSpineIndex + 1]
        let stylesheet = bookStylesheet
        let settings = currentSettings ?? ReaderSettings()
        let viewport = viewportSize
        let gutterWidth = spreadGutterWidth
        let resolvedLayout = settings.resolvedLayout(for: viewport.width)
        let capturedSafeArea = safeAreaInsets

        for index in indices {
            guard index >= 0, index < parser.package.spine.count,
                  chapterPages[index] == nil else { continue }

            // Handle nav documents on the main actor
            if isNavDocument(at: index) {
                let isTwoPage = resolvedLayout == .twoPage
                let pageWidth = isTwoPage ? (viewport.width - gutterWidth) / 2 : viewport.width
                let insets = paginationInsets(for: pageWidth, isTwoPage: isTwoPage)
                let contentWidth = pageWidth - insets.left - insets.right
                let contentHeight = viewport.height - insets.top - insets.bottom
                let pageViewportSize = CGSize(width: pageWidth, height: viewport.height)

                let (attrString, offsetMap, plainTextMap) = buildTOCAttributedString(
                    settings: settings,
                    contentWidth: max(1, contentWidth),
                    contentHeight: max(1, contentHeight)
                )

                Task.detached { [weak self] in
                    let pages = NativePaginationEngine.paginate(
                        attributedString: attrString,
                        viewportSize: pageViewportSize,
                        contentInsets: insets
                    )
                    await MainActor.run {
                        guard let self else { return }
                        self.parsedChapters[index] = []
                        self.chapterStrings[index] = attrString
                        self.chapterOffsetMaps[index] = offsetMap
                        self.chapterPlainTextMaps[index] = plainTextMap
                        self.chapterPages[index] = pages
                        self.chapterMediaAttachments[index] = []
                        self.chapterFloatingElements[index] = []
                        if index < self.spinePageCounts.count {
                            self.spinePageCounts[index] = pages.count
                        }
                        self.totalPositions = self.spinePageCounts.reduce(0, +)
                    }
                }
                continue
            }

            Task.detached { [weak self] in
                guard let self = self else { return }
                guard let chapterURL = await parser.resolveSpineItemURL(at: index),
                      let data = try? Data(contentsOf: chapterURL) else { return }

                // Parse XHTML
                let nodes: [ContentNode]
                if let cached = await self.parsedChapters[index] {
                    nodes = cached
                } else {
                    let baseURL = chapterURL.deletingLastPathComponent()
                    let contentParser = XHTMLContentParser(data: data, baseURL: baseURL, stylesheet: stylesheet)
                    nodes = contentParser.parse()
                }

                guard !Task.isCancelled else { return }

                // Build attributed string and paginate (resolvedLayout captured before detached task)
                let isTwoPage = resolvedLayout == .twoPage
                let pageWidth = isTwoPage ? (viewport.width - gutterWidth) / 2 : viewport.width
                var insets = NativePaginationEngine.insets(for: pageWidth, isTwoPageMode: isTwoPage)
                insets.top += capturedSafeArea.top
                insets.bottom += capturedSafeArea.bottom
                let contentWidth = pageWidth - insets.left - insets.right
                let contentHeight = viewport.height - insets.top - insets.bottom
                let pageViewportSize = CGSize(width: pageWidth, height: viewport.height)

                let builder = AttributedStringBuilder(
                    settings: settings,
                    contentWidth: max(1, contentWidth),
                    contentHeight: max(1, contentHeight)
                )
                let (attrString, offsetMap, plainTextMap) = builder.build(from: nodes)

                guard !Task.isCancelled else { return }

                let pages = NativePaginationEngine.paginate(
                    attributedString: attrString,
                    viewportSize: pageViewportSize,
                    contentInsets: insets
                )

                let mediaAttachments = builder.mediaAttachments
                let floatingElements = builder.floatingElements

                await MainActor.run {
                    self.parsedChapters[index] = nodes
                    self.chapterStrings[index] = attrString
                    self.chapterOffsetMaps[index] = offsetMap
                    self.chapterPlainTextMaps[index] = plainTextMap
                    self.chapterPages[index] = pages
                    self.chapterMediaAttachments[index] = mediaAttachments
                    self.chapterFloatingElements[index] = floatingElements
                    if index < self.spinePageCounts.count {
                        self.spinePageCounts[index] = pages.count
                    }
                    self.totalPositions = self.spinePageCounts.reduce(0, +)
                }
            }
        }
    }

    /// Invalidate caches and reload the current chapter, preserving position.
    private func invalidateAndReload() {
        // Cancel any in-flight full pagination
        fullPaginationTask?.cancel()
        fullPaginationTask = nil

        chapterStrings.removeAll()
        chapterPages.removeAll()
        chapterOffsetMaps.removeAll()
        chapterPlainTextMaps.removeAll()
        chapterMediaAttachments.removeAll()
        chapterFloatingElements.removeAll()
        // Reset spine page counts to defaults (will be recomputed)
        if let parser = parser {
            spinePageCounts = Array(repeating: 1, count: parser.package.spine.count)
            totalPositions = spinePageCounts.reduce(0, +)
        }

        let savedProgression = currentLocation?.progression ?? 0
        let savedSpine = currentSpineIndex

        // Display the current chapter immediately, then re-paginate remaining
        // chapters in the background for accurate global page counts.
        fullPaginationTask = Task { [weak self] in
            guard let self else { return }
            self.loadChapter(at: savedSpine, progression: savedProgression)
            await self.chapterLoadTask?.value
            guard !Task.isCancelled else { return }
            await self.paginateAllChapters()
        }
    }

    // MARK: - Location Tracking

    private func updateLocation() {
        guard let parser = parser else { return }

        let manifestItem = parser.manifestItem(forSpineIndex: currentSpineIndex)
        let chapterPageCount = chapterPages[currentSpineIndex]?.count ?? 1
        let chapterProgression = chapterPageCount > 1
            ? Double(currentPageIndex) / Double(chapterPageCount - 1)
            : 0

        let pagesBeforeCurrent = (0..<currentSpineIndex).reduce(0) { sum, i in
            sum + (i < spinePageCounts.count ? spinePageCounts[i] : 1)
        }
        let totalPagesCount = max(1, spinePageCounts.reduce(0, +))
        let totalProgression = Double(pagesBeforeCurrent + currentPageIndex) / Double(totalPagesCount)

        let chapterTitle = findChapterTitle(for: manifestItem?.href)

        currentLocation = ReaderLocation(
            href: manifestItem?.href,
            pageIndex: currentPageIndex,
            progression: chapterProgression,
            totalProgression: min(1.0, totalProgression),
            title: chapterTitle
        )
    }

    private func findChapterTitle(for href: String?) -> String? {
        guard let href = href, let parser = parser else { return nil }

        func search(_ entries: [EPUBTOCEntry]) -> String? {
            for entry in entries {
                let entryBase = entry.href.components(separatedBy: "#").first ?? entry.href
                if href == entryBase || href.hasSuffix(entryBase) || entryBase.hasSuffix(href) {
                    return entry.title
                }
                if let found = search(entry.children) { return found }
            }
            return nil
        }

        return search(parser.package.tocItems)
    }

    /// Returns the chapter title for a given 1-based global page number.
    func chapterTitle(forGlobalPage page: Int) -> String? {
        guard let parser = parser else { return nil }
        let targetPage = page - 1 // convert to 0-based
        var accumulated = 0
        for (index, count) in spinePageCounts.enumerated() {
            if accumulated + count > targetPage {
                let item = parser.manifestItem(forSpineIndex: index)
                return findChapterTitle(for: item?.href)
            }
            accumulated += count
        }
        return nil
    }

    // MARK: - Page Snapshot

    /// Convert a global (book-wide) page index to (spineIndex, localPageIndex).
    private func spineAndLocalPage(forGlobal globalIndex: Int) -> (spineIndex: Int, localPage: Int)? {
        var accumulated = 0
        for (index, count) in spinePageCounts.enumerated() {
            if accumulated + count > globalIndex {
                return (spineIndex: index, localPage: globalIndex - accumulated)
            }
            accumulated += count
        }
        return nil
    }

    func snapshotPage(at offset: Int) -> UIImage? {
        let targetGlobal = globalPageIndex + offset
        guard targetGlobal >= 0, targetGlobal < totalPositions else { return nil }
        guard let (spineIndex, localPage) = spineAndLocalPage(forGlobal: targetGlobal) else { return nil }
        guard let attrString = chapterStrings[spineIndex],
              let pages = chapterPages[spineIndex],
              localPage < pages.count else { return nil }

        let pageInfo = pages[localPage]
        let safeRange = NSIntersectionRange(pageInfo.range, NSRange(location: 0, length: attrString.length))
        let pageContent = attrString.attributedSubstring(from: safeRange)

        // Render at the actual viewport size so font sizes, line spacing, and
        // text reflow match the real reader exactly. SwiftUI scales the image
        // down for the carousel card display.
        let renderSize = viewportSize
        let isTwoPage = pagesPerSpread == 2
        let pageWidth = isTwoPage ? (renderSize.width - spreadGutterWidth) / 2 : renderSize.width
        let insets = paginationInsets(for: pageWidth, isTwoPage: isTwoPage)

        // Render into a temporary UITextView
        let tv = UITextView(frame: CGRect(origin: .zero, size: renderSize))
        tv.isEditable = false
        tv.isScrollEnabled = false
        tv.textContainerInset = insets
        tv.textContainer.lineFragmentPadding = 0
        tv.backgroundColor = pageViewController?.textView.backgroundColor ?? currentSettings?.theme.backgroundColor ?? .systemBackground
        tv.attributedText = pageContent

        tv.layoutIfNeeded()
        let renderer = UIGraphicsImageRenderer(size: renderSize)
        return renderer.image { ctx in
            tv.layer.render(in: ctx.cgContext)
        }
    }

    // MARK: - ReaderEngine Protocol

    func makeViewController() -> UIViewController {
        pageViewController ?? UIViewController()
    }

    func goForward() async {
        guard let pages = chapterPages[currentSpineIndex] else { return }

        let advance = pagesPerSpread
        let nextPage = currentPageIndex + advance

        if nextPage < pages.count {
            currentPageIndex = nextPage
            pageViewController?.showPage(currentPageIndex)
            updateLocation()
        } else {
            // End of chapter — load next spine item
            let nextIndex = currentSpineIndex + 1
            if nextIndex < (parser?.package.spine.count ?? 0) {
                loadChapter(at: nextIndex)
            }
        }
    }

    func goBackward() async {
        let retreat = pagesPerSpread

        if currentPageIndex >= retreat {
            currentPageIndex -= retreat
            currentPageIndex = alignToSpread(currentPageIndex)
            pageViewController?.showPage(currentPageIndex)
            updateLocation()
        } else if currentPageIndex > 0 {
            currentPageIndex = 0
            pageViewController?.showPage(currentPageIndex)
            updateLocation()
        } else {
            // Start of chapter — load previous spine item at last page
            let prevIndex = currentSpineIndex - 1
            if prevIndex >= 0 {
                loadChapter(at: prevIndex, startAtEnd: true)
            }
        }
    }

    func go(to location: ReaderLocation) async {
        guard let parser = parser, let href = location.href else { return }

        for (index, spineItem) in parser.package.spine.enumerated() {
            guard let manifest = parser.package.manifest[spineItem.idref] else { continue }
            let manifestBase = manifest.href.components(separatedBy: "#").first ?? manifest.href
            let hrefBase = href.components(separatedBy: "#").first ?? href

            if manifest.href == href || manifestBase == hrefBase
                || href.hasSuffix(manifestBase) || manifestBase.hasSuffix(hrefBase) {

                if index != currentSpineIndex {
                    loadChapter(at: index, progression: location.progression)
                } else if location.progression > 0 {
                    pageViewController?.showProgression(location.progression)
                    currentPageIndex = pageViewController?.currentPageIndex ?? 0
                    updateLocation()
                }
                break
            }
        }
    }

    /// Navigate to a progression within the current chapter (0.0–1.0).
    func goToChapterProgression(_ progression: Double) {
        pageViewController?.showProgression(progression)
        currentPageIndex = pageViewController?.currentPageIndex ?? 0
        updateLocation()
    }

    func go(toProgression progression: Double) async {
        guard parser != nil else { return }

        let totalPagesCount = max(1, spinePageCounts.reduce(0, +))
        let targetPage = Int(progression * Double(totalPagesCount))

        var accumulated = 0
        for (index, count) in spinePageCounts.enumerated() {
            if accumulated + count > targetPage {
                let pageInChapter = targetPage - accumulated
                let chapterProgression = count > 1 ? Double(pageInChapter) / Double(count - 1) : 0

                if index != currentSpineIndex {
                    loadChapter(at: index, progression: chapterProgression)
                } else {
                    pageViewController?.showProgression(chapterProgression)
                    currentPageIndex = pageViewController?.currentPageIndex ?? 0
                    updateLocation()
                }
                break
            }
            accumulated += count
        }
    }

    func tableOfContents() async -> [TOCItem] {
        guard let parser = parser else { return [] }

        let items = convertTOCEntries(parser.package.tocItems, level: 0)
        if !items.isEmpty { return items }

        // Fallback: build TOC from headings found in spine items
        return await buildTOCFromHeadings(parser: parser)
    }

    private func convertTOCEntries(_ entries: [EPUBTOCEntry], level: Int) -> [TOCItem] {
        entries.map { entry in
            let hrefBase = entry.href.components(separatedBy: "#").first ?? entry.href
            let globalPage = globalStartPage(forHref: hrefBase)
            return TOCItem(
                id: entry.href,
                title: entry.title,
                location: ReaderLocation(
                    href: hrefBase,
                    pageIndex: globalPage,
                    progression: 0,
                    totalProgression: 0,
                    title: entry.title
                ),
                level: level,
                children: convertTOCEntries(entry.children, level: level + 1)
            )
        }
    }

    /// Returns the global (book-wide) zero-based starting page index for a chapter href,
    /// by matching it to a spine index and summing page counts of preceding chapters.
    private func globalStartPage(forHref href: String) -> Int? {
        guard let parser = parser else { return nil }
        for (index, spineItem) in parser.package.spine.enumerated() {
            guard let manifest = parser.package.manifest[spineItem.idref] else { continue }
            let manifestBase = manifest.href.components(separatedBy: "#").first ?? manifest.href
            if manifest.href == href || manifestBase == href
                || href.hasSuffix(manifestBase) || manifestBase.hasSuffix(href) {
                return (0..<index).reduce(0) { sum, i in
                    sum + (i < spinePageCounts.count ? spinePageCounts[i] : 1)
                }
            }
        }
        return nil
    }

    /// Scan spine XHTML files for heading elements (h1–h3) to build a fallback TOC.
    private func buildTOCFromHeadings(parser: EPUBParser) async -> [TOCItem] {
        let spine = parser.package.spine
        let manifest = parser.package.manifest
        let pageCounts = spinePageCounts

        return await Task.detached {
            var items: [TOCItem] = []

            for (index, spineItem) in spine.enumerated() {
                guard let manifestItem = manifest[spineItem.idref],
                      let chapterURL = parser.resolveSpineItemURL(at: index),
                      let data = try? Data(contentsOf: chapterURL),
                      let html = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else {
                    continue
                }

                let globalPage = (0..<index).reduce(0) { sum, i in
                    sum + (i < pageCounts.count ? pageCounts[i] : 1)
                }

                do {
                    let doc = try SwiftSoup.parse(html)
                    let headings = try doc.select("h1, h2, h3")

                    for heading in headings.array() {
                        let text = try heading.text().trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !text.isEmpty else { continue }

                        let tagName = heading.tagName()
                        let level: Int
                        switch tagName {
                        case "h1": level = 0
                        case "h2": level = 1
                        case "h3": level = 2
                        default: level = 0
                        }

                        let href = manifestItem.href
                        let item = TOCItem(
                            id: "\(href)#heading-\(items.count)",
                            title: text,
                            location: ReaderLocation(
                                href: href,
                                pageIndex: globalPage,
                                progression: 0,
                                totalProgression: 0,
                                title: text
                            ),
                            level: level,
                            children: []
                        )
                        items.append(item)
                    }

                    if headings.isEmpty() {
                        let filename = chapterURL.deletingPathExtension().lastPathComponent
                            .replacingOccurrences(of: "_", with: " ")
                            .replacingOccurrences(of: "-", with: " ")
                        let capitalized = filename.prefix(1).uppercased() + filename.dropFirst()
                        items.append(TOCItem(
                            id: manifestItem.href,
                            title: capitalized,
                            location: ReaderLocation(
                                href: manifestItem.href,
                                pageIndex: globalPage,
                                progression: 0,
                                totalProgression: 0,
                                title: capitalized
                            ),
                            level: 0,
                            children: []
                        ))
                    }
                } catch {
                    // Skip chapters with parse errors
                }
            }

            return items
        }.value
    }

    func applyHighlights(_ highlights: [BookHighlight]) {
        pendingHighlights = highlights
        applyHighlightsToCurrentPage()
    }

    private func applyHighlightsToCurrentPage() {
        guard let parser = parser else { return }
        let manifestItem = parser.manifestItem(forSpineIndex: currentSpineIndex)
        let currentHref = manifestItem?.href ?? ""
        let highlights = pendingHighlights

        Task.detached { [weak self] in
            // Filter and parse highlights off main thread
            let ranges: [(id: String, range: NSRange, color: UIColor)] = highlights.compactMap { highlight in
                guard let data = highlight.locatorJSON.data(using: .utf8),
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let href = json["href"] as? String else { return nil }

                guard href == currentHref || currentHref.hasSuffix(href) || href.hasSuffix(currentHref) else {
                    return nil
                }

                guard let range = json["range"] as? [String: Any],
                      let startOffset = range["startOffset"] as? Int,
                      let endOffset = range["endOffset"] as? Int else { return nil }

                let nsRange = NSRange(location: startOffset, length: endOffset - startOffset)
                let color = UIColor(hex: highlight.color) ?? .yellow

                return (id: highlight.id, range: nsRange, color: color)
            }

            await MainActor.run {
                self?.pageViewController?.applyHighlights(ranges)
            }
        }
    }

    /// Navigate to the page containing the given character range in the attributed string.
    /// Returns true if navigation was needed (different page).
    @discardableResult
    func showPage(containingRange range: NSRange) -> Bool {
        guard let pages = chapterPages[currentSpineIndex] else { return false }

        // Find the page that contains the start of this range
        for (index, page) in pages.enumerated() {
            if NSLocationInRange(range.location, page.range) ||
               (range.location >= page.range.location &&
                range.location < page.range.location + page.range.length) {
                let alignedIndex = alignToSpread(index)
                if alignedIndex != currentPageIndex {
                    currentPageIndex = alignedIndex
                    pageViewController?.showPage(currentPageIndex)
                    updateLocation()
                    return true
                }
                return false
            }
        }
        return false
    }

    func clearSelection() {
        pageViewController?.clearSelection()
    }

    func applySettings(_ settings: ReaderSettings) {
        // Compare against snapshot values (not the reference) to detect real changes
        let settingsChanged = settingsSnapshot == nil ||
            settingsSnapshot?.theme != settings.theme ||
            settingsSnapshot?.fontFamily != settings.fontFamily ||
            settingsSnapshot?.fontSize != settings.fontSize ||
            settingsSnapshot?.lineHeight != settings.lineHeight ||
            settingsSnapshot?.layout != settings.layout

        currentSettings = settings
        settingsSnapshot = SettingsSnapshot(
            theme: settings.theme,
            fontFamily: settings.fontFamily,
            fontSize: settings.fontSize,
            lineHeight: settings.lineHeight,
            layout: settings.layout
        )

        guard settingsChanged, isReady else { return }

        // Apply theme immediately
        pageViewController?.applyTheme(backgroundColor: settings.theme.backgroundColor, theme: settings.theme)

        // Invalidate caches and rebuild
        invalidateAndReload()
    }

    func serializeLocation() -> String? {
        guard let location = currentLocation else { return nil }
        var dict: [String: Any] = [
            "type": "epub",
            "spineIndex": currentSpineIndex,
            "progress": location.totalProgression,
            // Keep href and title for display/fallback
            "href": location.href ?? "",
            "title": location.title ?? ""
        ]
        // Add character offset for cross-device position restoration
        if let charOffset = currentPagePlainTextOffset {
            dict["charOffset"] = charOffset
        }
        guard let data = try? JSONSerialization.data(withJSONObject: dict) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    // MARK: - Search

    func search(query: String) async -> [ReaderSearchResult] {
        guard let parser = parser, !query.isEmpty else { return [] }

        // Capture values on main actor for background work
        let spine = parser.package.spine
        let manifestMap = parser.package.manifest
        let cachedChapters = parsedChapters
        let stylesheet = bookStylesheet
        let pageCounts = spinePageCounts
        let totalPages = totalPositions

        // Pre-resolve chapter URLs and titles on main actor
        struct ChapterInfo: Sendable {
            let index: Int
            let href: String?
            let title: String?
            let url: URL?
        }
        var chapterInfos: [ChapterInfo] = []
        for (spineIndex, spineItem) in spine.enumerated() {
            let manifest = manifestMap[spineItem.idref]
            let href = manifest?.href
            let title = findChapterTitle(for: href)
            let url = parser.resolveSpineItemURL(at: spineIndex)
            chapterInfos.append(ChapterInfo(index: spineIndex, href: href, title: title, url: url))
        }

        // Run heavy search work off main thread
        return await Task.detached {
            var results: [ReaderSearchResult] = []
            let contextChars = 40

            for info in chapterInfos {
                guard !Task.isCancelled else { break }

                // Get or parse chapter content
                let nodes: [ContentNode]
                if let cached = cachedChapters[info.index] {
                    nodes = cached
                } else {
                    guard let url = info.url,
                          let data = try? Data(contentsOf: url) else { continue }
                    let baseURL = url.deletingLastPathComponent()
                    let contentParser = XHTMLContentParser(data: data, baseURL: baseURL, stylesheet: stylesheet)
                    nodes = contentParser.parse()
                }

                // Extract plain text
                let plainText = NativeEPUBEngine.extractPlainText(from: nodes)
                guard !plainText.isEmpty else { continue }

                // Calculate global start page for this chapter
                let globalStartPage = (0..<info.index).reduce(0) { sum, i in
                    sum + (i < pageCounts.count ? pageCounts[i] : 1)
                }
                let chapterPageCount = info.index < pageCounts.count ? pageCounts[info.index] : 1

                // Find all matches (case-insensitive)
                var searchStart = plainText.startIndex

                while searchStart < plainText.endIndex {
                    guard !Task.isCancelled else { break }
                    guard let matchRange = plainText.range(of: query, options: .caseInsensitive, range: searchStart..<plainText.endIndex) else {
                        break
                    }

                    // Build snippet with context
                    let snippetStart = plainText.index(matchRange.lowerBound, offsetBy: -contextChars, limitedBy: plainText.startIndex) ?? plainText.startIndex
                    let snippetEnd = plainText.index(matchRange.upperBound, offsetBy: contextChars, limitedBy: plainText.endIndex) ?? plainText.endIndex
                    let snippet = String(plainText[snippetStart..<snippetEnd])

                    // Calculate match range within snippet
                    let matchOffsetInSnippet = plainText.distance(from: snippetStart, to: matchRange.lowerBound)
                    let matchStartInSnippet = snippet.index(snippet.startIndex, offsetBy: matchOffsetInSnippet)
                    let matchEndInSnippet = snippet.index(matchStartInSnippet, offsetBy: plainText.distance(from: matchRange.lowerBound, to: matchRange.upperBound))

                    // Calculate progression within chapter and page number
                    let charOffset = plainText.distance(from: plainText.startIndex, to: matchRange.lowerBound)
                    let chapterProgression = Double(charOffset) / Double(max(1, plainText.count))

                    let pageInChapter = min(Int(chapterProgression * Double(chapterPageCount)), max(0, chapterPageCount - 1))
                    let globalPage = globalStartPage + pageInChapter
                    let totalProg = totalPages > 0 ? Double(globalPage) / Double(totalPages) : 0

                    let location = ReaderLocation(
                        href: info.href,
                        pageIndex: globalPage,
                        progression: chapterProgression,
                        totalProgression: totalProg,
                        title: info.title
                    )

                    let prefix = snippetStart > plainText.startIndex ? "..." : ""
                    let suffix = snippetEnd < plainText.endIndex ? "..." : ""
                    let displaySnippet = prefix + snippet + suffix

                    // Adjust match range for prefix
                    let adjustedStart = displaySnippet.index(displaySnippet.startIndex, offsetBy: prefix.count + matchOffsetInSnippet)
                    let adjustedEnd = displaySnippet.index(adjustedStart, offsetBy: plainText.distance(from: matchRange.lowerBound, to: matchRange.upperBound))

                    results.append(ReaderSearchResult(
                        location: location,
                        snippet: displaySnippet,
                        matchRange: adjustedStart..<adjustedEnd,
                        chapterTitle: info.title
                    ))

                    searchStart = matchRange.upperBound
                }
            }

            return results
        }.value
    }

    // MARK: - Plain Text Extraction

    nonisolated static func extractPlainText(from nodes: [ContentNode]) -> String {
        var text = ""
        for node in nodes {
            appendPlainText(from: node, to: &text)
        }
        return text
    }

    nonisolated static func appendPlainText(from node: ContentNode, to text: inout String) {
        switch node {
        case .paragraph(let runs, _), .heading(_, let runs, _):
            for run in runs {
                text += run.text
            }
            text += "\n"

        case .codeBlock(let code):
            text += code + "\n"

        case .list(_, let items, _):
            for item in items {
                for child in item.children {
                    appendPlainText(from: child, to: &text)
                }
            }

        case .blockquote(let children), .container(let children, _):
            for child in children {
                appendPlainText(from: child, to: &text)
            }

        case .table(let rows):
            for row in rows {
                for cell in row.cells {
                    for run in cell.runs {
                        text += run.text
                    }
                    text += "\t"
                }
                text += "\n"
            }

        case .image(_, let alt, _, _, _):
            if let alt = alt { text += alt + "\n" }

        case .horizontalRule:
            text += "\n"

        case .video, .audio:
            break
        }
    }
}

