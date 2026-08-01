//
//  NativeReaderEngine.swift
//  Compendus
//
//  ReaderEngine implementation for CCD content using native UITextView rendering.
//  Native Core Text reader for CCD content
//  with NSAttributedString-based content display.
//

import UIKit
import CoreText
import SwiftSoup
import os.log

private let logger = Logger(subsystem: "com.compendus.reader", category: "Reader")

@Observable
@MainActor
public class NativeReaderEngine: ReaderEngine {
    public var currentLocation: ReaderLocation?
    public var totalPositions: Int = 0
    public var isReady: Bool = false
    public var errorMessage: String?

    /// Whether the reader is currently in two-page spread mode.
    public var isSpreadMode: Bool = false

    /// Whether a chapter is currently being loaded/parsed in the background.
    public var isLoadingChapter: Bool = false

    /// Progress of full-book pagination (0.0 to 1.0). Observed by the loading overlay.
    public var paginationProgress: Double = 0
    /// Number of chapters paginated so far (for display).
    public var paginatedChapterCount: Int = 0
    /// Total chapters to paginate.
    public var totalChapterCount: Int = 0

    public var onSelectionChanged: ((ReaderSelection?) -> Void)?
    public var onHighlightTapped: ((String) -> Void)?
    public var onTapZone: ((String) -> Void)?
    public var onFootnoteTapped: ((String) -> Void)?
    public var onLinkNavigationRequested: ((URL, Bool) -> Void)?  // (url, isExternal)

    private var pageViewController: NativePageViewController?

    /// Location of the unpacked CCD pack manifest (`manifest.ccd.json`).
    private let ccdManifestURL: URL
    /// Root directory for pack resources; CCD resource handles resolve against this.
    private let resourcesRoot: URL
    /// The decoded CCD bundle — the single source of content/structure.
    /// Set once at the start of load() (MainActor) before any chapter parsing,
    /// then read-only — safe to read from the detached parse tasks.
    nonisolated(unsafe) private var ccdBundle: CCDBundle?

    /// Whether the bundle declares fixed-layout (FXL) rendering. FXL chapters are
    /// image-block chapters (one full-page image per chapter) — no .epub needed.
    private var isFixedLayout: Bool = false
    /// Optional book-wide writing mode from the bundle ("ltr"/"rtl"/vertical).
    private var bundleWritingMode: String?

    /// Ordered list of real spine indices, in reading order. Index into this array
    /// is the engine's sequential chapter position; the value is the spine index
    /// used as the key for chapterDocuments/parsedChapters/spinePageCounts and for
    /// the saved-position format.
    private var orderedSpineIndices: [Int] = []
    /// chapter spineIndex → title (from readingOrder).
    private var spineTitles: [Int: String] = [:]
    /// chapter spineIndex → href (from chapters), for internal-link resolution.
    private var spineHrefs: [Int: String] = [:]
    /// chapter spineIndex → CCDChapter, for content mapping.
    nonisolated(unsafe) private var chaptersBySpine: [Int: CCDChapter] = [:]
    /// The highest spine index + 1 across the bundle (sizes the per-spine arrays).
    private var spineSlotCount: Int = 0

    /// Active chapter loading task (cancelled when a new chapter load begins)
    private var chapterLoadTask: Task<Void, Never>?

    /// Background task that pre-paginates all chapters for accurate global page counts.
    private var fullPaginationTask: Task<Void, Never>?

    // Spine/page tracking.
    private var currentSpineIndex: Int = 0
    private var currentPageIndex: Int = 0
    private var spinePageCounts: [Int] = []
    private var pendingHighlights: [HighlightRenderInfo] = []

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
    /// Settings-independent AST cache — survives theme/font changes.
    /// Keyed by chapter spine index.
    private var parsedChapters: [Int: [ContentNode]] = [:]
    /// Render artifact cache — cleared when visual settings change.
    private var chapterDocuments: [Int: ChapterDocument] = [:]
    /// Shared pool of NSLayoutManager instances for background chapter pagination.
    private let layoutManagerPool = LayoutManagerPool(maxSize: 4)

    // MARK: - Read-Along Support

    /// Callback fired when the spine index changes (for chapter tracking in read-along).
    public var onSpineIndexChanged: ((Int) -> Void)?

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

    private var pagesPerSpread: Int {
        // FXL is always single-page (each chapter is one full-page image).
        if isFixedLayout { return 1 }
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
    public var activeSpineIndex: Int { currentSpineIndex }

    /// The plain text of the currently displayed chapter.
    public var currentChapterPlainText: String? {
        guard let nodes = parsedChapters[currentSpineIndex] else { return nil }
        return Self.extractPlainText(from: nodes)
    }

    /// The full attributed string for the currently displayed chapter.
    public var currentChapterAttributedString: NSAttributedString? {
        chapterDocuments[currentSpineIndex]?.attributedString
    }

    /// Page boundaries for the currently displayed chapter.
    public var currentChapterPageInfos: [PageInfo]? {
        chapterDocuments[currentSpineIndex]?.pages
    }

    /// Total number of pages in the currently displayed chapter.
    public var currentChapterPageCount: Int {
        chapterDocuments[currentSpineIndex]?.pages.count ?? 1
    }

    /// Global (book-wide) zero-based page index for the current position.
    public var globalPageIndex: Int {
        pagesBefore(spineIndex: currentSpineIndex) + currentPageIndex
    }

    /// Plain text character offset for the start of the currently displayed page.
    /// Uses the PlainTextToAttrStringMap to find the content node at the page boundary,
    /// returning that node's plain text start. Accurate to the paragraph level.
    public var currentPagePlainTextOffset: Int? {
        guard let doc = chapterDocuments[currentSpineIndex],
              currentPageIndex < doc.pages.count else { return nil }
        return doc.plainTextMap.plainTextOffset(forAttrStringLocation: doc.pages[currentPageIndex].range.location)
    }

    /// Plain-text-to-attributed-string offset map for the current chapter.
    public var currentChapterPlainTextMap: PlainTextToAttrStringMap? {
        chapterDocuments[currentSpineIndex]?.plainTextMap
    }

    /// The chapter count (number of chapters in reading order).
    public var spineCount: Int {
        orderedSpineIndices.count
    }

    /// Chapter title for a given spine index.
    public func chapterTitle(forSpineIndex spineIndex: Int) -> String? {
        chapterTitleOrTocTitle(forSpineIndex: spineIndex)
    }

    /// The CCD table-of-contents entries (title + spineIndex + nested children).
    public var tocEntries: [CCDTocEntry] {
        ccdBundle?.toc ?? []
    }

    /// Global page index for a given plain text offset within a spine item.
    public func globalPageIndex(forPlainTextOffset offset: Int, inSpine spineIndex: Int) -> Int? {
        guard let doc = chapterDocuments[spineIndex] else { return nil }
        let map = doc.plainTextMap
        let pages = doc.pages

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
        return pagesBefore(spineIndex: spineIndex) + localPage
    }

    /// All parsed chapters as (spineIndex, plainText) for reader mode.
    public var allChaptersPlainText: [(spineIndex: Int, plainText: String)] {
        var result: [(spineIndex: Int, plainText: String)] = []
        for spineIndex in orderedSpineIndices {
            guard let nodes = parsedChapters[spineIndex] else { continue }
            let text = Self.extractPlainText(from: nodes)
            guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
            result.append((spineIndex: spineIndex, plainText: text))
        }
        return result
    }

    /// Whether a search is currently in progress.
    public var isSearching: Bool = false

    /// Search all chapters for a phrase (case-insensitive).
    /// Returns the spine index where the phrase was found, or nil.
    /// Operates entirely on the CCD bundle (no file I/O).
    public func findSpineIndex(containingPhrase phrase: String) async -> Int? {
        guard !phrase.isEmpty else { return nil }

        isSearching = true
        defer { isSearching = false }

        let order = orderedSpineIndices
        let cachedChapters = parsedChapters

        // Run the search off the main thread
        let result: (spineIndex: Int, parsedUpdates: [(Int, [ContentNode])])? = await Task.detached {
            var parsedUpdates: [(Int, [ContentNode])] = []

            for spineIndex in order {
                guard !Task.isCancelled else { return nil }

                let nodes: [ContentNode]
                if let cached = cachedChapters[spineIndex] {
                    nodes = cached
                } else {
                    let parsed = self.contentNodes(spineIndex: spineIndex)
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

    public init(ccdManifestURL: URL, resourcesRoot: URL) {
        self.ccdManifestURL = ccdManifestURL
        self.resourcesRoot = resourcesRoot
    }

    /// Source [ContentNode] for a chapter (by spine index) from the canonical CCD
    /// bundle. SINGLE PATH — without the bundle the chapter is empty. Image handles
    /// resolve against the unpacked pack's resources root.
    nonisolated private func contentNodes(spineIndex: Int) -> [ContentNode] {
        guard let chapter = chaptersBySpine[spineIndex] else {
            guard ccdBundle != nil else {
                logger.error("CCD-DIAG spine=\(spineIndex): bundle is NIL")
                return []
            }
            logger.error("CCD-DIAG spine=\(spineIndex): NO matching chapter")
            return []
        }
        let root = resourcesRoot
        let nodes = CCDContentMapper.nodes(for: chapter) { resource in
            if let u = URL(string: resource), u.scheme != nil, u.scheme != "file" { return u }
            // CCD resource handles are in-EPUB root-relative hrefs (e.g.
            // "EPUB/images/x.jpg") packed under resources/<handle>.
            return root.appendingPathComponent(resource)
        }
        return nodes
    }

    /// Release resources when the reader is dismissed.
    /// IMPORTANT: Must be called from onDisappear — @MainActor prevents deinit cleanup.
    public func cleanup() {
        chapterLoadTask?.cancel()
        chapterLoadTask = nil
        fullPaginationTask?.cancel()
        fullPaginationTask = nil
        ReaderImageCache.shared.endSession()
    }

    // MARK: - Loading

    public func load(initialPosition: String? = nil) async {
        logger.info("Loading CCD pack from \(self.ccdManifestURL.lastPathComponent)")
        // Decode the canonical CCD bundle — the single source of content/structure.
        guard let data = try? Data(contentsOf: ccdManifestURL),
              let bundle = try? CCDBundle.decode(from: data) else {
            errorMessage = "Could not load book content (CCD pack missing or invalid)."
            return
        }
        self.ccdBundle = bundle
        self.isFixedLayout = bundle.isFixedLayout ?? false
        self.bundleWritingMode = bundle.writingMode

        // Build structure lookups from the bundle.
        orderedSpineIndices = bundle.readingOrder.map { $0.spineIndex }
        spineTitles = [:]
        for ref in bundle.readingOrder {
            if let t = ref.title { spineTitles[ref.spineIndex] = t }
        }
        chaptersBySpine = [:]
        spineHrefs = [:]
        for chapter in bundle.chapters {
            chaptersBySpine[chapter.spineIndex] = chapter
            if let href = chapter.href { spineHrefs[chapter.spineIndex] = href }
        }
        // Size per-spine arrays to cover the highest spine index referenced.
        let maxSpine = max(
            bundle.readingOrder.map { $0.spineIndex }.max() ?? -1,
            bundle.chapters.map { $0.spineIndex }.max() ?? -1
        )
        spineSlotCount = maxSpine + 1

        logger.info("Using CCD bundle (\(bundle.chapters.count) chapters, fxl=\(self.isFixedLayout))")

        ReaderImageCache.shared.beginSession(id: ccdManifestURL.path)

        // Initialize spine page counts
        spinePageCounts = Array(repeating: 1, count: spineSlotCount)

        // Create page view controller
        let pageVC = NativePageViewController()
        setupCallbacks(pageVC)
        self.pageViewController = pageVC

        // Determine initial position
        var initialSpineIndex = orderedSpineIndices.first ?? 0
        var initialProgression: Double?

        if let positionJSON = initialPosition,
           let posData = positionJSON.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: posData) as? [String: Any] {

            // Universal position format: { type: "epub", spineIndex, charOffset, progress }
            if json["type"] as? String == "epub",
               let spineIdx = json["spineIndex"] as? Int,
               chaptersBySpine[spineIdx] != nil {
                initialSpineIndex = spineIdx
                // Prefer charOffset for precise cross-device restoration.
                // `progress` is book-wide and must never be reused as the
                // within-chapter progression when restoring a location.
                if let charOff = json["charOffset"] as? Int {
                    pendingCharOffset = charOff
                }
                initialProgression = json["chapterProgression"] as? Double
            }
            // Legacy format: { href, locations: { progression, totalProgression } }
            else {
                if let href = json["href"] as? String,
                   let idx = spineIndex(forHref: href) {
                    initialSpineIndex = idx
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
                    self.fullPaginationTask = Task { [weak self] in
                        guard let self = self else { return }
                        self.loadChapter(at: pending.spineIndex, progression: pending.progression)
                        await self.chapterLoadTask?.value
                        guard !Task.isCancelled else { return }
                        if let charOffset = self.pendingCharOffset {
                            self.pendingCharOffset = nil
                            self.navigateToOffsetInCurrentChapter(charOffset)
                        }
                        await self.paginateAllChapters()
                        // Background pagination changes the book-wide page
                        // denominator. Publish one corrected location when it
                        // completes so progress and TOC page numbers agree.
                        self.updateLocation()
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

    /// Resolve an href (possibly with fragment) to a chapter spine index using the
    /// bundle's chapter href map. Matches on last-path-component or suffix.
    private func spineIndex(forHref href: String) -> Int? {
        let hrefBase = (href.components(separatedBy: "#").first ?? href)
        let hrefLast = (hrefBase as NSString).lastPathComponent
        for (spineIdx, chapterHref) in spineHrefs {
            let chBase = chapterHref.components(separatedBy: "#").first ?? chapterHref
            let chLast = (chBase as NSString).lastPathComponent
            if chBase == hrefBase || chBase == href
                || chBase.hasSuffix(hrefBase) || hrefBase.hasSuffix(chBase)
                || chLast == hrefLast {
                return spineIdx
            }
        }
        return nil
    }

    public func performLinkNavigation(_ url: URL) {
        // Resolve internal link to a chapter via the bundle href map.
        let href = url.lastPathComponent
        if let index = spineIndex(forHref: href) {
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

        // External link — open in system browser
        if url.scheme == "http" || url.scheme == "https" {
            UIApplication.shared.open(url)
        }
    }

    private func handleFootnoteTap(_ url: URL) {
        // CCD carries footnote/endnote bodies inline on the chapter (chapter.notes).
        // Resolve the note by its fragment id within the current chapter first,
        // then across all chapters.
        let fragment = url.fragment
        guard let fragment, !fragment.isEmpty else {
            handleLinkTap(url)
            return
        }

        func noteBlocks(in chapter: CCDChapter?) -> [CCDBlock]? {
            chapter?.notes?[fragment]
        }

        var blocks = noteBlocks(in: chaptersBySpine[currentSpineIndex])
        if blocks == nil {
            for chapter in chaptersBySpine.values {
                if let b = chapter.notes?[fragment] { blocks = b; break }
            }
        }

        guard let blocks else {
            handleLinkTap(url)
            return
        }

        let nodes = CCDContentMapper.nodes(forBlocks: blocks) { [resourcesRoot] resource in
            if let u = URL(string: resource), u.scheme != nil, u.scheme != "file" { return u }
            return resourcesRoot.appendingPathComponent(resource)
        }
        let text = Self.extractPlainText(from: nodes).trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty {
            handleLinkTap(url)
        } else {
            onFootnoteTapped?(text)
        }
    }

    // Media players are managed inline by NativePageViewController.
    // No overlay-based presentation needed.

    /// Navigate to a specific spine index. Used by ReadAlongService for cross-chapter search.
    public func goToSpine(_ spineIndex: Int) {
        loadChapter(at: spineIndex)
    }

    /// Navigate to the page containing a specific plain text offset within a given spine index.
    /// Used by reader mode to restore the EPUB position when exiting.
    public func navigateToPlainTextOffset(_ offset: Int, inSpine spineIndex: Int) {
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
        guard let map = chapterDocuments[currentSpineIndex]?.plainTextMap,
              let attrRange = map.attrStringRange(for: NSRange(location: offset, length: 1)) else { return }
        showPage(containingRange: attrRange)
    }

    /// Briefly flash-highlight a plain text range, then fade it out.
    /// Used to show the user where they left off when exiting reader mode.
    public func flashHighlight(plainTextOffset: Int, length: Int, inSpine spineIndex: Int) {
        guard spineIndex == currentSpineIndex,
              let map = chapterDocuments[spineIndex]?.plainTextMap,
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
        guard chaptersBySpine[spineIndex] != nil else { return }

        // Dismiss any active FXL page state (legacy) before switching content
        pageViewController?.clearFXLPage()

        // Cancel any in-flight chapter load
        chapterLoadTask?.cancel()

        currentSpineIndex = spineIndex
        onSpineIndexChanged?(spineIndex)

        // Update viewport size from current view
        if let vcView = pageViewController?.view, vcView.bounds.width > 0 {
            viewportSize = vcView.bounds.size
        }

        logger.info("Loading chapter spine=\(spineIndex)")

        // Capture values needed for background work
        let cachedNodes = parsedChapters[spineIndex]
        let settings = currentSettings ?? ReaderSettings()
        let capturedTheme = settings.theme
        let capturedFontFamily = settings.fontFamily
        let capturedFontSize = settings.fontSize
        let capturedLineHeight = settings.lineHeight
        let viewport = viewportSize
        let gutterWidth = spreadGutterWidth
        // FXL chapters (image-block) always render single-page full-bleed.
        let resolvedLayout = isFixedLayout ? ReaderLayout.single : settings.resolvedLayout(for: viewport.width)
        let capturedSafeArea = safeAreaInsets
        let fxl = isFixedLayout

        // If the chapter is already fully built, display immediately
        if let doc = chapterDocuments[spineIndex] {
            displayChapter(
                spineIndex: spineIndex,
                nodes: cachedNodes ?? [],
                attrString: doc.attributedString,
                offsetMap: doc.offsetMap,
                plainTextMap: doc.plainTextMap,
                pages: doc.pages,
                mediaAttachments: doc.mediaAttachments,
                floatingElements: doc.floatingElements,
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
            // Background: map CCD blocks, build attributed string, paginate
            let result: ChapterBuildResult? = await Task.detached { () -> ChapterBuildResult? in
                // Map CCD blocks → ContentNodes (no file I/O, no XHTML parsing)
                let nodes: [ContentNode]
                if let cached = cachedNodes {
                    nodes = cached
                } else {
                    nodes = self?.contentNodes(spineIndex: spineIndex) ?? []
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
                    theme: capturedTheme, fontFamily: capturedFontFamily,
                    fontSize: capturedFontSize, lineHeight: capturedLineHeight,
                    contentWidth: max(1, contentWidth),
                    contentHeight: max(1, contentHeight)
                )
                let (attrString, offsetMap, plainTextMap) = builder.build(from: nodes)

                guard !Task.isCancelled else { return nil }

                // FXL: one full-page image per chapter — never split across pages.
                let pages: [PageInfo]
                if fxl {
                    pages = [PageInfo(range: NSRange(location: 0, length: attrString.length), pageIndex: 0)]
                } else {
                    pages = NativePaginationEngine.paginate(
                        attributedString: attrString,
                        viewportSize: pageViewportSize,
                        contentInsets: insets
                    )
                }

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
                self.chapterDocuments[spineIndex] = ChapterDocument(
                    spineIndex: spineIndex,
                    attributedString: result.attrString,
                    pages: result.pages,
                    offsetMap: result.offsetMap,
                    plainTextMap: result.plainTextMap,
                    mediaAttachments: result.mediaAttachments,
                    floatingElements: result.floatingElements
                )

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

    /// Build a single-page error chapter for display when the normal build pipeline fails.
    /// Shows the error message to the user rather than leaving a blank page.
    nonisolated private static func errorChapterResult(
        spineIndex: Int,
        message: String,
        settings: ReaderSettings,
        viewport: CGSize,
        gutterWidth: CGFloat,
        resolvedLayout: ReaderLayout,
        capturedSafeArea: UIEdgeInsets
    ) -> ChapterBuildResult {
        let isTwoPage = resolvedLayout == .twoPage
        let pageWidth = isTwoPage ? (viewport.width - gutterWidth) / 2 : viewport.width
        var insets = NativePaginationEngine.insets(for: pageWidth, isTwoPageMode: isTwoPage)
        insets.top += capturedSafeArea.top
        insets.bottom += capturedSafeArea.bottom

        let paraStyle = NSMutableParagraphStyle()
        paraStyle.lineHeightMultiple = 1.4
        paraStyle.paragraphSpacing = 8
        let errorAttr = NSAttributedString(
            string: "⚠\u{FE0F} Chapter failed to load\n\n\(message)",
            attributes: [
                .font: UIFont.italicSystemFont(ofSize: 15),
                .foregroundColor: UIColor.systemRed,
                .paragraphStyle: paraStyle
            ]
        )
        let singlePage = PageInfo(range: NSRange(location: 0, length: errorAttr.length), pageIndex: 0)
        return ChapterBuildResult(
            nodes: [],
            attrString: errorAttr,
            offsetMap: OffsetMap(),
            plainTextMap: PlainTextToAttrStringMap(),
            pages: [singlePage],
            mediaAttachments: [],
            floatingElements: []
        )
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
        // FXL books are always single-page (no spread)
        let isFXL = isFixedLayout
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

        // Suppress "This page is blank" in spread mode.
        pageViewController?.suppressBlankPagePlaceholder = isTwoPage

        // Display — pass insets explicitly so loadContent always has safe-area-aware values
        pageViewController?.loadContent(
            attributedString: attrString,
            pages: pages,
            chapterHref: spineHrefs[spineIndex],
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
        let settings = currentSettings ?? ReaderSettings()
        let capturedTheme = settings.theme
        let capturedFontFamily = settings.fontFamily
        let capturedFontSize = settings.fontSize
        let capturedLineHeight = settings.lineHeight
        let viewport = viewportSize
        let gutterWidth = spreadGutterWidth
        let fxl = isFixedLayout
        let resolvedLayout = fxl ? ReaderLayout.single : settings.resolvedLayout(for: viewport.width)

        let isTwoPage = resolvedLayout == .twoPage
        let pageWidth = isTwoPage ? (viewport.width - gutterWidth) / 2 : viewport.width
        let insets = paginationInsets(for: pageWidth, isTwoPage: isTwoPage)
        let contentWidth = pageWidth - insets.left - insets.right
        let contentHeight = viewport.height - insets.top - insets.bottom
        let pageViewportSize = CGSize(width: pageWidth, height: viewport.height)

        // Chapters still needing pagination, in reading order.
        var pendingSpines = orderedSpineIndices.filter { chapterDocuments[$0] == nil }

        guard !pendingSpines.isEmpty else {
            totalPositions = spinePageCounts.reduce(0, +)
            paginationProgress = 1.0
            return
        }

        // Priority sort: process chapters nearest the current reading position first
        // (by position in reading order), so page turns stay responsive.
        let order = orderedSpineIndices
        let pivotPos = order.firstIndex(of: currentSpineIndex) ?? 0
        func orderPos(_ spine: Int) -> Int { order.firstIndex(of: spine) ?? 0 }
        pendingSpines.sort { abs(orderPos($0) - pivotPos) < abs(orderPos($1) - pivotPos) }

        // Track pagination progress
        totalChapterCount = pendingSpines.count
        paginatedChapterCount = 0
        paginationProgress = 0

        // Process chapters in parallel with bounded concurrency
        let maxConcurrent = 4
        var completedCount = 0

        await withTaskGroup(of: (Int, ChapterBuildResult?).self) { group in
            var iterator = pendingSpines.makeIterator()

            func build(_ spineIndex: Int) -> ChapterBuildResult? {
                let nodes = self.contentNodes(spineIndex: spineIndex)
                guard !Task.isCancelled else { return nil }
                let builder = AttributedStringBuilder(
                    theme: capturedTheme, fontFamily: capturedFontFamily,
                    fontSize: capturedFontSize, lineHeight: capturedLineHeight,
                    contentWidth: max(1, contentWidth),
                    contentHeight: max(1, contentHeight)
                )
                let (attrString, offsetMap, plainTextMap) = builder.build(from: nodes)
                guard !Task.isCancelled else { return nil }
                let pages: [PageInfo]
                if fxl {
                    pages = [PageInfo(range: NSRange(location: 0, length: attrString.length), pageIndex: 0)]
                } else {
                    pages = NativePaginationEngine.paginate(
                        attributedString: attrString,
                        viewportSize: pageViewportSize,
                        contentInsets: insets
                    )
                }
                return ChapterBuildResult(
                    nodes: nodes, attrString: attrString, offsetMap: offsetMap,
                    plainTextMap: plainTextMap, pages: pages,
                    mediaAttachments: builder.mediaAttachments,
                    floatingElements: builder.floatingElements
                )
            }

            // Seed initial batch of tasks
            for _ in 0..<min(maxConcurrent, pendingSpines.count) {
                guard let index = iterator.next() else { break }
                group.addTask { (index, build(index)) }
            }

            // Process completed tasks and submit new ones (sliding window)
            for await (index, result) in group {
                guard !Task.isCancelled else { break }

                if let result {
                    parsedChapters[index] = result.nodes
                    chapterDocuments[index] = ChapterDocument(
                        spineIndex: index,
                        attributedString: result.attrString,
                        pages: result.pages,
                        offsetMap: result.offsetMap,
                        plainTextMap: result.plainTextMap,
                        mediaAttachments: result.mediaAttachments,
                        floatingElements: result.floatingElements
                    )
                    if index < spinePageCounts.count {
                        spinePageCounts[index] = result.pages.count
                    }
                }

                completedCount += 1
                paginatedChapterCount = completedCount
                paginationProgress = Double(completedCount) / Double(max(1, totalChapterCount))
                totalPositions = spinePageCounts.reduce(0, +)

                if let nextIndex = iterator.next() {
                    group.addTask { (nextIndex, build(nextIndex)) }
                }
            }
        }

        paginationProgress = 1.0
        logger.info("Full book pagination complete: \(self.totalPositions) total pages across \(self.orderedSpineIndices.count) chapters")
    }

    // MARK: - Image Pre-loading

    /// Walk the AST and pre-load all referenced images into the shared cache.
    /// Called from a background task before building the attributed string so
    /// that `AttributedStringBuilder.appendImage` hits the cache immediately.
    nonisolated static func preloadImages(from nodes: [ContentNode]) {
        var urls: [URL] = []
        collectImageURLs(from: nodes, into: &urls)
        for url in urls {
            guard ReaderImageCache.shared.image(forPath: url.path) == nil else { continue }
            if let image = UIImage(contentsOfFile: url.path) {
                ReaderImageCache.shared.setImage(image, forPath: url.path)
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
        let order = orderedSpineIndices
        guard let pos = order.firstIndex(of: currentSpineIndex) else { return }
        var indices: [Int] = []
        if pos - 1 >= 0 { indices.append(order[pos - 1]) }
        if pos + 1 < order.count { indices.append(order[pos + 1]) }

        let settings = currentSettings ?? ReaderSettings()
        let capturedTheme = settings.theme
        let capturedFontFamily = settings.fontFamily
        let capturedFontSize = settings.fontSize
        let capturedLineHeight = settings.lineHeight
        let viewport = viewportSize
        let gutterWidth = spreadGutterWidth
        let fxl = isFixedLayout
        let resolvedLayout = fxl ? ReaderLayout.single : settings.resolvedLayout(for: viewport.width)
        let capturedSafeArea = safeAreaInsets

        for index in indices {
            guard chaptersBySpine[index] != nil, chapterDocuments[index] == nil else { continue }

            let cachedNodes = parsedChapters[index]

            Task.detached { [weak self] in
                guard let self else { return }

                // Map CCD blocks (no file I/O)
                let nodes: [ContentNode]
                if let cached = cachedNodes {
                    nodes = cached
                } else {
                    nodes = self.contentNodes(spineIndex: index)
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
                    theme: capturedTheme, fontFamily: capturedFontFamily,
                    fontSize: capturedFontSize, lineHeight: capturedLineHeight,
                    contentWidth: max(1, contentWidth),
                    contentHeight: max(1, contentHeight)
                )
                let (attrString, offsetMap, plainTextMap) = builder.build(from: nodes)

                guard !Task.isCancelled else { return }

                let pages: [PageInfo]
                if fxl {
                    pages = [PageInfo(range: NSRange(location: 0, length: attrString.length), pageIndex: 0)]
                } else {
                    pages = NativePaginationEngine.paginate(
                        attributedString: attrString,
                        viewportSize: pageViewportSize,
                        contentInsets: insets
                    )
                }

                let mediaAttachments = builder.mediaAttachments
                let floatingElements = builder.floatingElements

                await MainActor.run {
                    self.parsedChapters[index] = nodes
                    self.chapterDocuments[index] = ChapterDocument(
                        spineIndex: index,
                        attributedString: attrString,
                        pages: pages,
                        offsetMap: offsetMap,
                        plainTextMap: plainTextMap,
                        mediaAttachments: mediaAttachments,
                        floatingElements: floatingElements
                    )
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

        // Atomic invalidation of all render artifacts. parsedChapters (AST nodes)
        // are settings-independent and survive — they get reused on next build.
        chapterDocuments.removeAll()
        // Reset spine page counts to defaults (will be recomputed)
        spinePageCounts = Array(repeating: 1, count: spineSlotCount)
        totalPositions = spinePageCounts.reduce(0, +)

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
        let chapterPageCount = chapterDocuments[currentSpineIndex]?.pages.count ?? 1
        let chapterProgression = chapterPageCount > 1
            ? Double(currentPageIndex) / Double(chapterPageCount - 1)
            : 0

        let pagesBeforeCurrent = pagesBefore(spineIndex: currentSpineIndex)
        let totalPagesCount = max(1, spinePageCounts.reduce(0, +))
        let totalProgression = Double(pagesBeforeCurrent + currentPageIndex) / Double(totalPagesCount)

        let chapterTitle = chapterTitleOrTocTitle(forSpineIndex: currentSpineIndex)

        currentLocation = ReaderLocation(
            href: spineHrefs[currentSpineIndex],
            pageIndex: currentPageIndex,
            progression: chapterProgression,
            totalProgression: min(1.0, totalProgression),
            title: chapterTitle
        )
    }

    /// Sum the page counts of all chapters that precede `spineIndex` in reading order.
    private func pagesBefore(spineIndex: Int) -> Int {
        guard let pos = orderedSpineIndices.firstIndex(of: spineIndex) else { return 0 }
        return orderedSpineIndices.prefix(pos).reduce(0) { sum, s in
            sum + (s < spinePageCounts.count ? spinePageCounts[s] : 1)
        }
    }

    /// Title for a chapter: prefer the readingOrder title, fall back to the TOC.
    private func chapterTitleOrTocTitle(forSpineIndex spineIndex: Int) -> String? {
        if let t = spineTitles[spineIndex], !t.isEmpty {
            // Conversion pipelines sometimes use a filename-like placeholder
            // even when the publication provides a human TOC heading.
            if isGeneratedChapterTitle(t), let toc = tocTitle(forSpineIndex: spineIndex) {
                return toc
            }
            return t
        }
        return tocTitle(forSpineIndex: spineIndex)
    }

    private func isGeneratedChapterTitle(_ title: String) -> Bool {
        let stem = (title as NSString).deletingPathExtension.lowercased()
        for prefix in ["chapter-", "chapter_"] where stem.hasPrefix(prefix) {
            if Int(stem.dropFirst(prefix.count)) != nil { return true }
        }
        return false
    }

    /// Find a TOC entry title that targets the given spine index.
    private func tocTitle(forSpineIndex spineIndex: Int) -> String? {
        guard let bundle = ccdBundle else { return nil }
        func search(_ entries: [CCDTocEntry]) -> String? {
            for entry in entries {
                if entry.spineIndex == spineIndex { return entry.title }
                if let children = entry.children, let found = search(children) { return found }
            }
            return nil
        }
        return search(bundle.toc)
    }

    /// Returns the chapter title for a given 1-based global page number.
    public func chapterTitle(forGlobalPage page: Int) -> String? {
        let targetPage = page - 1 // convert to 0-based
        var accumulated = 0
        for spine in orderedSpineIndices {
            let count = spine < spinePageCounts.count ? spinePageCounts[spine] : 1
            if accumulated + count > targetPage {
                return chapterTitleOrTocTitle(forSpineIndex: spine)
            }
            accumulated += count
        }
        return nil
    }

    // MARK: - Page Snapshot

    /// Convert a global (book-wide) page index to (spineIndex, localPageIndex).
    private func spineAndLocalPage(forGlobal globalIndex: Int) -> (spineIndex: Int, localPage: Int)? {
        var accumulated = 0
        for spine in orderedSpineIndices {
            let count = spine < spinePageCounts.count ? spinePageCounts[spine] : 1
            if accumulated + count > globalIndex {
                return (spineIndex: spine, localPage: globalIndex - accumulated)
            }
            accumulated += count
        }
        return nil
    }

    public func snapshotPage(at offset: Int) -> UIImage? {
        let targetGlobal = globalPageIndex + offset
        guard targetGlobal >= 0, targetGlobal < totalPositions else { return nil }
        guard let (spineIndex, localPage) = spineAndLocalPage(forGlobal: targetGlobal) else { return nil }
        guard let doc = chapterDocuments[spineIndex],
              localPage < doc.pages.count else { return nil }
        let attrString = doc.attributedString
        let pages = doc.pages

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

    public func makeViewController() -> UIViewController {
        pageViewController ?? UIViewController()
    }

    /// The spine index after `spineIndex` in reading order, or nil at the end.
    private func nextSpine(after spineIndex: Int) -> Int? {
        guard let pos = orderedSpineIndices.firstIndex(of: spineIndex),
              pos + 1 < orderedSpineIndices.count else { return nil }
        return orderedSpineIndices[pos + 1]
    }

    /// The spine index before `spineIndex` in reading order, or nil at the start.
    private func prevSpine(before spineIndex: Int) -> Int? {
        guard let pos = orderedSpineIndices.firstIndex(of: spineIndex),
              pos - 1 >= 0 else { return nil }
        return orderedSpineIndices[pos - 1]
    }

    public func goForward() async {
        guard let pages = chapterDocuments[currentSpineIndex]?.pages else { return }

        let advance = pagesPerSpread
        let nextPage = currentPageIndex + advance

        if nextPage < pages.count {
            currentPageIndex = nextPage
            pageViewController?.showPage(currentPageIndex)
            updateLocation()
        } else {
            // End of chapter — advance to next chapter in reading order
            if let nextIndex = nextSpine(after: currentSpineIndex) {
                loadChapter(at: nextIndex)
            }
        }
    }

    public func goBackward() async {
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
            // Start of chapter — retreat to previous chapter in reading order
            if let prevIndex = prevSpine(before: currentSpineIndex) {
                loadChapter(at: prevIndex, startAtEnd: true)
            }
        }
    }

    public func go(to location: ReaderLocation) async {
        guard let href = location.href else { return }

        if let index = spineIndex(forHref: href) {
            if index != currentSpineIndex {
                loadChapter(at: index, progression: location.progression)
            } else if location.progression > 0 {
                pageViewController?.showProgression(location.progression)
                currentPageIndex = pageViewController?.currentPageIndex ?? 0
                updateLocation()
            }
        }
    }

    /// Navigate to a progression within the current chapter (0.0–1.0).
    func goToChapterProgression(_ progression: Double) {
        pageViewController?.showProgression(progression)
        currentPageIndex = pageViewController?.currentPageIndex ?? 0
        updateLocation()
    }

    public func go(toProgression progression: Double) async {
        guard ccdBundle != nil else { return }

        let totalPagesCount = max(1, spinePageCounts.reduce(0, +))
        let targetPage = Int(progression * Double(totalPagesCount))

        var accumulated = 0
        for spine in orderedSpineIndices {
            let count = spine < spinePageCounts.count ? spinePageCounts[spine] : 1
            if accumulated + count > targetPage {
                let pageInChapter = targetPage - accumulated
                let chapterProgression = count > 1 ? Double(pageInChapter) / Double(count - 1) : 0

                if spine != currentSpineIndex {
                    loadChapter(at: spine, progression: chapterProgression)
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

    public func tableOfContents() async -> [TOCItem] {
        guard let bundle = ccdBundle else { return [] }
        let items = convertTOCEntries(bundle.toc, level: 0)
        if !items.isEmpty { return items }

        // Fallback: one entry per chapter in reading order, using readingOrder titles.
        return orderedSpineIndices.enumerated().compactMap { (pos, spine) in
            let title = spineTitles[spine] ?? "Chapter \(pos + 1)"
            return TOCItem(
                id: spineHrefs[spine] ?? "spine-\(spine)",
                title: title,
                location: ReaderLocation(
                    href: spineHrefs[spine],
                    pageIndex: pagesBefore(spineIndex: spine),
                    progression: 0,
                    totalProgression: 0,
                    title: title
                ),
                level: 0,
                children: []
            )
        }
    }

    private func convertTOCEntries(_ entries: [CCDTocEntry], level: Int) -> [TOCItem] {
        entries.map { entry in
            let href = spineHrefs[entry.spineIndex]
            let globalPage = pagesBefore(spineIndex: entry.spineIndex)
            return TOCItem(
                id: "\(entry.spineIndex)-\(entry.title)",
                title: entry.title,
                location: ReaderLocation(
                    href: href,
                    pageIndex: globalPage,
                    progression: 0,
                    totalProgression: 0,
                    title: entry.title
                ),
                level: level,
                children: convertTOCEntries(entry.children ?? [], level: level + 1)
            )
        }
    }

    public func applyHighlights(_ highlights: [HighlightRenderInfo]) {
        pendingHighlights = highlights
        applyHighlightsToCurrentPage()
    }

    /// Drive the transient read-along narration highlight on the live page.
    /// `sentence`/`word` are ranges in the current chapter's attributed string
    /// (the same coordinate space as `showPage(containingRange:)`). Pass nil/nil
    /// to clear (e.g. when read-along stops).
    public func setNarrationHighlight(sentence: NSRange?, word: NSRange?) {
        pageViewController?.applyNarrationHighlight(sentence: sentence, word: word)
    }

    private func applyHighlightsToCurrentPage() {
        let currentHref = spineHrefs[currentSpineIndex] ?? ""
        let highlights = pendingHighlights
        // Snapshot the attributed string length so we can guard against stale offsets.
        // charOffset is a character-level index (stable across font/size changes) but
        // a highlight saved from a different EPUB edition may exceed the current length.
        let attrStringLength = chapterDocuments[currentSpineIndex]?.attributedString.length ?? Int.max

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
                      let endOffset = range["endOffset"] as? Int,
                      startOffset >= 0, endOffset > startOffset else { return nil }

                let nsRange = NSRange(location: startOffset, length: endOffset - startOffset)
                // Guard: skip highlights whose range extends beyond the current attributed string.
                // This handles highlights saved from a different edition or after content changes.
                guard NSMaxRange(nsRange) <= attrStringLength else { return nil }

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
    public func showPage(containingRange range: NSRange) -> Bool {
        guard let pages = chapterDocuments[currentSpineIndex]?.pages else { return false }

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

    public func clearSelection() {
        pageViewController?.clearSelection()
    }

    public func applySettings(_ settings: ReaderSettings) {
        // Compare against snapshot values (not the reference) to detect real changes
        let themeChanged = settingsSnapshot?.theme != settings.theme
        let structuralChanged = settingsSnapshot == nil ||
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

        guard (themeChanged || structuralChanged), isReady else { return }

        // Apply theme immediately to the visible view in all cases
        pageViewController?.applyTheme(backgroundColor: settings.theme.backgroundColor, theme: settings.theme)

        if structuralChanged {
            // Font/size/layout changed — full invalidate + rebuild required
            invalidateAndReload()
        } else if themeChanged {
            // Theme-only change: recolor existing attributed strings without re-parsing
            applyThemeColorsOnly(theme: settings.theme)
        }
    }

    /// Update foreground/background color attributes in all cached chapter documents
    /// without rebuilding the attributed strings from scratch. This is much faster than
    /// a full invalidate + reload and avoids any visible flicker.
    private func applyThemeColorsOnly(theme: ReaderTheme) {
        let newTextColor = theme.textColor
        let newBackColor = theme.backgroundColor

        for (index, doc) in chapterDocuments {
            let mutable = doc.attributedString.mutableCopy() as! NSMutableAttributedString
            let fullRange = NSRange(location: 0, length: mutable.length)
            // Replace foreground and background color attributes throughout
            mutable.enumerateAttributes(in: fullRange, options: []) { attrs, range, _ in
                var updated: [NSAttributedString.Key: Any] = [:]
                if attrs[.foregroundColor] != nil {
                    updated[.foregroundColor] = newTextColor
                }
                if attrs[.backgroundColor] != nil {
                    updated[.backgroundColor] = newBackColor
                }
                if !updated.isEmpty {
                    mutable.addAttributes(updated, range: range)
                }
            }
            // Store updated document (pages/offsets unchanged — layout is unaffected by color)
            chapterDocuments[index] = ChapterDocument(
                spineIndex: doc.spineIndex,
                attributedString: mutable,
                pages: doc.pages,
                offsetMap: doc.offsetMap,
                plainTextMap: doc.plainTextMap,
                mediaAttachments: doc.mediaAttachments,
                floatingElements: doc.floatingElements
            )
        }

        // Refresh the current page with the recolored attributed string
        if let doc = chapterDocuments[currentSpineIndex] {
            pageViewController?.updateAttributedString(doc.attributedString)
        }
    }

    public func serializeLocation() -> String? {
        guard let location = currentLocation else { return nil }
        var dict: [String: Any] = [
            "type": "epub",
            "spineIndex": currentSpineIndex,
            "progress": location.totalProgression,
            "chapterProgression": location.progression,
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

    public func search(query: String) async -> [ReaderSearchResult] {
        guard ccdBundle != nil, !query.isEmpty else { return [] }

        // Capture values on main actor for background work
        let cachedChapters = parsedChapters
        let pageCounts = spinePageCounts
        let totalPages = totalPositions

        // Pre-resolve chapter hrefs, titles, and global start pages on main actor
        struct ChapterInfo: Sendable {
            let index: Int
            let href: String?
            let title: String?
            let globalStartPage: Int
        }
        var chapterInfos: [ChapterInfo] = []
        for spineIndex in orderedSpineIndices {
            chapterInfos.append(ChapterInfo(
                index: spineIndex,
                href: spineHrefs[spineIndex],
                title: chapterTitleOrTocTitle(forSpineIndex: spineIndex),
                globalStartPage: pagesBefore(spineIndex: spineIndex)
            ))
        }

        // Run heavy search work off main thread
        return await Task.detached {
            var results: [ReaderSearchResult] = []
            let contextChars = 40

            for info in chapterInfos {
                guard !Task.isCancelled else { break }

                // Get or map chapter content (no file I/O)
                let nodes: [ContentNode]
                if let cached = cachedChapters[info.index] {
                    nodes = cached
                } else {
                    nodes = self.contentNodes(spineIndex: info.index)
                }

                // Extract plain text
                let plainText = NativeReaderEngine.extractPlainText(from: nodes)
                guard !plainText.isEmpty else { continue }

                // Global start page for this chapter (pre-computed on main actor)
                let globalStartPage = info.globalStartPage
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

    public nonisolated static func extractPlainText(from nodes: [ContentNode]) -> String {
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
