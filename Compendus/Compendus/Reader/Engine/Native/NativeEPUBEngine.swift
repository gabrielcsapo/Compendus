//
//  NativeEPUBEngine.swift
//  Compendus
//
//  ReaderEngine implementation for EPUB files using native UITextView rendering.
//  Replaces the WKWebView-based EPUBEngine with Core Text pagination
//  and NSAttributedString-based content display.
//

import UIKit
import os.log

private let logger = Logger(subsystem: "com.compendus.reader", category: "NativeEPUB")

@Observable
@MainActor
class NativeEPUBEngine: ReaderEngine {
    var currentLocation: ReaderLocation?
    var totalPositions: Int = 0
    var isReady: Bool = false
    var errorMessage: String?

    var onSelectionChanged: ((ReaderSelection?) -> Void)?
    var onHighlightTapped: ((String) -> Void)?
    var onTapZone: ((String) -> Void)?

    private var parser: EPUBParser?
    private var pageViewController: NativePageViewController?
    private let bookURL: URL

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
    }
    private var settingsSnapshot: SettingsSnapshot?
    private var currentSettings: ReaderSettings?

    // Content cache
    private var parsedChapters: [Int: [ContentNode]] = [:]
    private var chapterStrings: [Int: NSAttributedString] = [:]
    private var chapterPages: [Int: [PageInfo]] = [:]
    private var chapterOffsetMaps: [Int: OffsetMap] = [:]

    // Viewport
    private var viewportSize: CGSize = .zero

    // Deferred initial load (waits for view to have proper size)
    private var pendingInitialLoad: (spineIndex: Int, progression: Double?)?

    init(bookURL: URL) {
        self.bookURL = bookURL
    }

    // MARK: - Loading

    func load(initialPosition: String? = nil) async {
        logger.info("Loading EPUB from \(self.bookURL.lastPathComponent)")
        do {
            let parser = try await EPUBParser.parse(epubURL: bookURL)
            self.parser = parser
            logger.info("Parsed EPUB: \(parser.package.spine.count) spine items, \(parser.package.manifest.count) manifest items")

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

            currentSpineIndex = initialSpineIndex

            // Store the pending load — will fire when the view has a proper size
            pendingInitialLoad = (spineIndex: initialSpineIndex, progression: initialProgression)

            // The view controller notifies us via onViewReady when it's in the
            // hierarchy and has a non-zero size (viewDidAppear/viewDidLayoutSubviews)
            pageVC.onViewReady = { [weak self] size in
                guard let self = self else { return }
                logger.info("View ready with size \(size.width)x\(size.height)")
                self.viewportSize = size
                if let pending = self.pendingInitialLoad {
                    self.pendingInitialLoad = nil
                    logger.info("Executing deferred load: spine \(pending.spineIndex), progression \(pending.progression ?? -1)")
                    self.loadChapter(at: pending.spineIndex, progression: pending.progression)
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
    }

    // MARK: - Chapter Loading

    private func loadChapter(at spineIndex: Int, startAtEnd: Bool = false, progression: Double? = nil) {
        guard let parser = parser else { return }
        guard spineIndex >= 0, spineIndex < parser.package.spine.count else { return }

        currentSpineIndex = spineIndex

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

        // Parse XHTML if not cached
        if parsedChapters[spineIndex] == nil {
            guard let data = try? Data(contentsOf: chapterURL) else {
                logger.error("Failed to read chapter file at \(chapterURL.path)")
                errorMessage = "Could not read chapter file"
                return
            }
            logger.info("Chapter XHTML data: \(data.count) bytes")
            let baseURL = chapterURL.deletingLastPathComponent()
            let contentParser = XHTMLContentParser(data: data, baseURL: baseURL)
            parsedChapters[spineIndex] = contentParser.parse()
        }

        guard let nodes = parsedChapters[spineIndex] else { return }
        logger.info("Parsed \(nodes.count) content nodes")

        // Build attributed string if not cached (or settings changed)
        let settings = currentSettings ?? ReaderSettings()
        let contentWidth = viewportSize.width - NativePaginationEngine.defaultInsets.left - NativePaginationEngine.defaultInsets.right
        logger.info("Viewport: \(self.viewportSize.width)x\(self.viewportSize.height), contentWidth: \(contentWidth)")
        let builder = AttributedStringBuilder(settings: settings, contentWidth: max(1, contentWidth))
        let (attrString, offsetMap) = builder.build(from: nodes)
        chapterStrings[spineIndex] = attrString
        chapterOffsetMaps[spineIndex] = offsetMap
        logger.info("Attributed string: \(attrString.length) chars, offsets: \(offsetMap.entries.count)")

        if attrString.length > 0 {
            let preview = attrString.string.prefix(100)
            logger.info("Content preview: \(preview)")
        } else {
            logger.warning("Attributed string is EMPTY — content will not be visible")
        }

        // Paginate
        let pages = NativePaginationEngine.paginate(
            attributedString: attrString,
            viewportSize: viewportSize
        )
        chapterPages[spineIndex] = pages
        updateSpinePageCount(pages.count)
        logger.info("Paginated into \(pages.count) pages")

        // Determine starting page
        var startPage = 0
        if startAtEnd {
            startPage = max(0, pages.count - 1)
        } else if let progression = progression, progression > 0 {
            startPage = Int(round(progression * Double(max(1, pages.count - 1))))
            startPage = max(0, min(startPage, pages.count - 1))
        }

        currentPageIndex = startPage

        // Display
        let manifestItem = parser.manifestItem(forSpineIndex: spineIndex)
        pageViewController?.loadContent(
            attributedString: attrString,
            pages: pages,
            chapterHref: manifestItem?.href,
            startAtPage: startPage
        )

        // Apply theme
        if let settings = currentSettings {
            pageViewController?.applyTheme(backgroundColor: settings.theme.backgroundColor)
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

    private func prefetchAdjacentChapters() {
        guard let parser = parser else { return }
        let indices = [currentSpineIndex - 1, currentSpineIndex + 1]
        for index in indices {
            guard index >= 0, index < parser.package.spine.count,
                  parsedChapters[index] == nil else { continue }

            Task.detached { [weak self] in
                guard let self = self else { return }
                guard let chapterURL = await parser.resolveSpineItemURL(at: index),
                      let data = try? Data(contentsOf: chapterURL) else { return }

                let baseURL = chapterURL.deletingLastPathComponent()
                let contentParser = XHTMLContentParser(data: data, baseURL: baseURL)
                let nodes = contentParser.parse()

                await MainActor.run {
                    self.parsedChapters[index] = nodes
                }
            }
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

    // MARK: - ReaderEngine Protocol

    func makeViewController() -> UIViewController {
        pageViewController ?? UIViewController()
    }

    func goForward() async {
        guard let pages = chapterPages[currentSpineIndex] else { return }

        if currentPageIndex < pages.count - 1 {
            currentPageIndex += 1
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
        if currentPageIndex > 0 {
            currentPageIndex -= 1
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
        return convertTOCEntries(parser.package.tocItems, level: 0)
    }

    private func convertTOCEntries(_ entries: [EPUBTOCEntry], level: Int) -> [TOCItem] {
        entries.map { entry in
            TOCItem(
                id: entry.href,
                title: entry.title,
                location: ReaderLocation(
                    href: entry.href.components(separatedBy: "#").first ?? entry.href,
                    pageIndex: nil,
                    progression: 0,
                    totalProgression: 0,
                    title: entry.title
                ),
                level: level,
                children: convertTOCEntries(entry.children, level: level + 1)
            )
        }
    }

    func applyHighlights(_ highlights: [BookHighlight]) {
        pendingHighlights = highlights
        applyHighlightsToCurrentPage()
    }

    private func applyHighlightsToCurrentPage() {
        guard let parser = parser else { return }
        let manifestItem = parser.manifestItem(forSpineIndex: currentSpineIndex)
        let currentHref = manifestItem?.href ?? ""

        // Filter highlights for current chapter
        let chapterHighlights = pendingHighlights.filter { highlight in
            guard let data = highlight.locatorJSON.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let href = json["href"] as? String else { return false }
            return href == currentHref || currentHref.hasSuffix(href) || href.hasSuffix(currentHref)
        }

        // Convert to native highlight ranges
        let ranges: [(id: String, range: NSRange, color: UIColor)] = chapterHighlights.compactMap { highlight in
            guard let data = highlight.locatorJSON.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let range = json["range"] as? [String: Any],
                  let startOffset = range["startOffset"] as? Int,
                  let endOffset = range["endOffset"] as? Int else { return nil }

            let nsRange = NSRange(location: startOffset, length: endOffset - startOffset)
            let color = UIColor(hex: highlight.color) ?? .yellow

            return (id: highlight.id, range: nsRange, color: color)
        }

        pageViewController?.applyHighlights(ranges)
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
            settingsSnapshot?.lineHeight != settings.lineHeight

        currentSettings = settings
        settingsSnapshot = SettingsSnapshot(
            theme: settings.theme,
            fontFamily: settings.fontFamily,
            fontSize: settings.fontSize,
            lineHeight: settings.lineHeight
        )

        guard settingsChanged, isReady else { return }

        // Invalidate cached attributed strings and paginations
        chapterStrings.removeAll()
        chapterPages.removeAll()
        chapterOffsetMaps.removeAll()

        // Apply theme immediately
        pageViewController?.applyTheme(backgroundColor: settings.theme.backgroundColor)

        // Rebuild current chapter preserving progression
        let savedProgression = currentLocation?.progression ?? 0
        loadChapter(at: currentSpineIndex, progression: savedProgression)
    }

    func serializeLocation() -> String? {
        guard let location = currentLocation else { return nil }
        let dict: [String: Any] = [
            "href": location.href ?? "",
            "locations": [
                "progression": location.progression,
                "totalProgression": location.totalProgression
            ],
            "title": location.title ?? ""
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: dict) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    // MARK: - Search

    func search(query: String) async -> [ReaderSearchResult] {
        guard let parser = parser, !query.isEmpty else { return [] }

        var results: [ReaderSearchResult] = []
        let contextChars = 40

        for (spineIndex, spineItem) in parser.package.spine.enumerated() {
            // Get or parse chapter content
            let nodes: [ContentNode]
            if let cached = parsedChapters[spineIndex] {
                nodes = cached
            } else {
                guard let chapterURL = parser.resolveSpineItemURL(at: spineIndex),
                      let data = try? Data(contentsOf: chapterURL) else { continue }
                let baseURL = chapterURL.deletingLastPathComponent()
                let contentParser = XHTMLContentParser(data: data, baseURL: baseURL)
                let parsed = contentParser.parse()
                parsedChapters[spineIndex] = parsed
                nodes = parsed
            }

            // Extract plain text
            let plainText = Self.extractPlainText(from: nodes)
            guard !plainText.isEmpty else { continue }

            let manifest = parser.package.manifest[spineItem.idref]
            let href = manifest?.href
            let chapterTitle = findChapterTitle(for: href)

            // Find all matches (case-insensitive)
            var searchStart = plainText.startIndex

            while searchStart < plainText.endIndex {
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

                // Calculate progression within chapter
                let charOffset = plainText.distance(from: plainText.startIndex, to: matchRange.lowerBound)
                let chapterProgression = Double(charOffset) / Double(max(1, plainText.count))

                let location = ReaderLocation(
                    href: href,
                    pageIndex: nil,
                    progression: chapterProgression,
                    totalProgression: 0,
                    title: chapterTitle
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
                    chapterTitle: chapterTitle
                ))

                searchStart = matchRange.upperBound
            }
        }

        return results
    }

    // MARK: - Plain Text Extraction

    private static func extractPlainText(from nodes: [ContentNode]) -> String {
        var text = ""
        for node in nodes {
            appendPlainText(from: node, to: &text)
        }
        return text
    }

    private static func appendPlainText(from node: ContentNode, to text: inout String) {
        switch node {
        case .paragraph(let runs), .heading(_, let runs):
            for run in runs {
                text += run.text
            }
            text += "\n"

        case .codeBlock(let code):
            text += code + "\n"

        case .list(_, let items):
            for item in items {
                for child in item.children {
                    appendPlainText(from: child, to: &text)
                }
            }

        case .blockquote(let children), .container(let children):
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

        case .image(_, let alt, _, _):
            if let alt = alt { text += alt + "\n" }

        case .horizontalRule:
            text += "\n"
        }
    }
}
