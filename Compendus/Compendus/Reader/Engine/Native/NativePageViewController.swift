//
//  NativePageViewController.swift
//  Compendus
//
//  UIViewController hosting a non-editable UITextView for native EPUB rendering.
//  Displays one or two pages at a time with tap zone navigation and text selection support.
//

import UIKit

@MainActor
class NativePageViewController: UIViewController, UITextViewDelegate {

    // MARK: - Views

    private(set) var textView: UITextView!

    // Second text view for right page in two-page (spread) mode
    private var secondTextView: UITextView?

    // Visual divider between pages in spread mode
    private var gutterView: UIView?

    // MARK: - Layout State

    /// Whether we're currently in two-page spread mode
    private(set) var isTwoPageMode: Bool = false

    /// Gutter width between the two pages
    private let gutterWidth: CGFloat = 16

    /// Active constraints for the text views (replaced when layout mode changes)
    private var layoutConstraints: [NSLayoutConstraint] = []

    // MARK: - Content State

    private var fullAttributedString: NSAttributedString?
    private var pages: [PageInfo] = []
    private(set) var currentPageIndex: Int = 0
    private var currentChapterHref: String?

    // Highlight tracking: (highlight ID, range in full attributed string, color)
    private var highlightRanges: [(id: String, range: NSRange, color: UIColor)] = []

    // Track whether we're suppressing selection callbacks during page transitions
    private var suppressSelectionCallbacks = false

    // MARK: - Callbacks

    var onPageChanged: ((_ page: Int, _ totalPages: Int) -> Void)?
    var onSelectionChanged: ((ReaderSelection?) -> Void)?
    var onHighlightTapped: ((String) -> Void)?
    var onTapZone: ((String) -> Void)?
    var onLinkTapped: ((URL) -> Void)?

    // Media attachments in the current chapter
    private var mediaAttachments: [MediaAttachment] = []

    // Inline player views positioned over media attachments on the current page
    private var inlinePlayerViews: [InlineMediaPlayerView] = []

    // Floating elements (CSS float images) in the current chapter
    private var floatingElements: [FloatingElement] = []

    // UIImageView subviews for floating images on the current page
    private var floatingImageViews: [UIImageView] = []

    /// Called once when the view has been laid out with a proper size.
    /// The engine uses this to know when it's safe to paginate.
    var onViewReady: ((CGSize) -> Void)?
    private var hasNotifiedReady = false

    /// Called when the view size changes after initial layout (rotation, window resize).
    var onViewResized: ((CGSize) -> Void)?
    private var lastReportedSize: CGSize = .zero
    private var resizeDebounceTask: Task<Void, Never>?

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()

        setupTextView()
        setupGestures()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        notifyReadyIfNeeded()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        stopAllMedia()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        suppressNativeEditMenu(in: textView)
        if let stv = secondTextView { suppressNativeEditMenu(in: stv) }
        notifyReadyIfNeeded()
        notifyResizeIfNeeded()
    }

    private func notifyReadyIfNeeded() {
        guard !hasNotifiedReady,
              view.bounds.width > 0, view.bounds.height > 0 else { return }
        hasNotifiedReady = true
        lastReportedSize = view.bounds.size
        onViewReady?(view.bounds.size)
    }

    private func notifyResizeIfNeeded() {
        guard hasNotifiedReady else { return }
        let newSize = view.bounds.size
        guard newSize.width > 0, newSize.height > 0,
              newSize != lastReportedSize else { return }

        lastReportedSize = newSize

        // Debounce to avoid excessive re-pagination during live resize
        resizeDebounceTask?.cancel()
        resizeDebounceTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            onViewResized?(newSize)
        }
    }

    // MARK: - Text View Setup

    private func setupTextView() {
        // Use TextKit 1 explicitly. Our hit-testing methods access layoutManager
        // which forces a TextKit 2 → 1 compatibility switch mid-lifecycle,
        // corrupting the rendering pipeline. Starting in TK1 avoids this.
        textView = makeTextView()

        view.addSubview(textView)

        // Default single-page constraints
        layoutConstraints = [
            textView.topAnchor.constraint(equalTo: view.topAnchor),
            textView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            textView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            textView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ]
        NSLayoutConstraint.activate(layoutConstraints)

        suppressNativeEditMenu(in: textView)
    }

    /// Factory for creating a configured UITextView (used for both left and right pages).
    private func makeTextView() -> UITextView {
        let tv = UITextView(usingTextLayoutManager: false)
        tv.isEditable = false
        tv.isScrollEnabled = false
        tv.isSelectable = true
        tv.textContainerInset = NativePaginationEngine.defaultInsets
        tv.textContainer.lineFragmentPadding = 0
        tv.backgroundColor = .systemBackground
        tv.delegate = self
        tv.translatesAutoresizingMaskIntoConstraints = false

        // Disable link interactions (we handle taps ourselves)
        tv.isUserInteractionEnabled = true
        tv.dataDetectorTypes = []
        tv.linkTextAttributes = [:]

        return tv
    }

    private func setupGestures() {
        // Tap gesture for navigation zones and highlight detection
        let tapGesture = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        tapGesture.delegate = self
        view.addGestureRecognizer(tapGesture)

        // Swipe gestures for page turning
        let swipeLeft = UISwipeGestureRecognizer(target: self, action: #selector(handleSwipeLeft(_:)))
        swipeLeft.direction = .left
        view.addGestureRecognizer(swipeLeft)

        let swipeRight = UISwipeGestureRecognizer(target: self, action: #selector(handleSwipeRight(_:)))
        swipeRight.direction = .right
        view.addGestureRecognizer(swipeRight)
    }

    // MARK: - Two-Page Layout Configuration

    /// Switch between single-page and two-page spread layout.
    func configureLayout(twoPage: Bool) {
        guard twoPage != isTwoPageMode else { return }
        isTwoPageMode = twoPage

        if twoPage {
            setupSpreadLayout()
        } else {
            tearDownSpreadLayout()
        }
    }

    private func setupSpreadLayout() {
        // Create second text view
        let stv = makeTextView()
        stv.backgroundColor = textView.backgroundColor
        view.addSubview(stv)
        secondTextView = stv

        // Create gutter divider
        let gutter = UIView()
        gutter.backgroundColor = textView.backgroundColor
        gutter.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(gutter)
        gutterView = gutter

        // Replace constraints
        NSLayoutConstraint.deactivate(layoutConstraints)

        let halfWidth = (view.bounds.width - gutterWidth) / 2

        layoutConstraints = [
            // Left text view
            textView.topAnchor.constraint(equalTo: view.topAnchor),
            textView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            textView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            textView.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.5, constant: -gutterWidth / 2),

            // Gutter
            gutter.topAnchor.constraint(equalTo: view.topAnchor),
            gutter.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            gutter.leadingAnchor.constraint(equalTo: textView.trailingAnchor),
            gutter.widthAnchor.constraint(equalToConstant: gutterWidth),

            // Right text view
            stv.topAnchor.constraint(equalTo: view.topAnchor),
            stv.leadingAnchor.constraint(equalTo: gutter.trailingAnchor),
            stv.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            stv.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ]
        NSLayoutConstraint.activate(layoutConstraints)

        suppressNativeEditMenu(in: stv)
    }

    private func tearDownSpreadLayout() {
        secondTextView?.removeFromSuperview()
        secondTextView = nil

        gutterView?.removeFromSuperview()
        gutterView = nil

        // Restore single-page constraints
        NSLayoutConstraint.deactivate(layoutConstraints)
        layoutConstraints = [
            textView.topAnchor.constraint(equalTo: view.topAnchor),
            textView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            textView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            textView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ]
        NSLayoutConstraint.activate(layoutConstraints)
    }

    // MARK: - Edit Menu Suppression

    private func suppressNativeEditMenu(in targetView: UIView) {
        for interaction in targetView.interactions {
            if interaction is UIEditMenuInteraction {
                targetView.removeInteraction(interaction)
            }
        }
        for subview in targetView.subviews {
            suppressNativeEditMenu(in: subview)
        }
    }

    // MARK: - Content Loading

    /// Load a chapter's attributed string and pre-computed pages.
    func loadContent(
        attributedString: NSAttributedString,
        pages: [PageInfo],
        chapterHref: String?,
        startAtPage: Int = 0,
        mediaAttachments: [MediaAttachment] = [],
        floatingElements: [FloatingElement] = []
    ) {
        self.fullAttributedString = attributedString
        self.pages = pages
        self.currentChapterHref = chapterHref
        self.currentPageIndex = min(startAtPage, max(0, pages.count - 1))
        self.mediaAttachments = mediaAttachments
        self.floatingElements = floatingElements

        // Use responsive insets
        let insets = NativePaginationEngine.insets(for: pageWidth(), isTwoPageMode: isTwoPageMode)
        textView.textContainerInset = insets
        secondTextView?.textContainerInset = insets

        showCurrentPage()
    }

    /// The effective width of a single page (half of view width in spread mode).
    private func pageWidth() -> CGFloat {
        if isTwoPageMode {
            return (view.bounds.width - gutterWidth) / 2
        }
        return view.bounds.width
    }

    /// Navigate to a specific page index.
    func showPage(_ index: Int) {
        guard index >= 0, index < pages.count else { return }
        currentPageIndex = index
        showCurrentPage()
        onPageChanged?(currentPageIndex, pages.count)
    }

    /// Navigate to a progression value (0.0–1.0) within the current chapter.
    func showProgression(_ progression: Double) {
        guard !pages.isEmpty else { return }
        let targetPage = Int(round(progression * Double(pages.count - 1)))
        showPage(max(0, min(targetPage, pages.count - 1)))
    }

    private func showCurrentPage() {
        guard let fullString = fullAttributedString,
              currentPageIndex < pages.count else { return }

        // Remove old inline players and floating images before changing page content
        removeInlinePlayers()
        removeFloatingImages()

        suppressSelectionCallbacks = true

        // Render left page
        renderPage(at: currentPageIndex, into: textView, fullString: fullString)

        // Render right page in two-page mode
        if isTwoPageMode, let stv = secondTextView {
            let rightPageIndex = currentPageIndex + 1
            if rightPageIndex < pages.count {
                renderPage(at: rightPageIndex, into: stv, fullString: fullString)
            } else {
                // Last page is alone on the left; right page is empty
                stv.attributedText = NSAttributedString(string: "")
                stv.contentInset.top = 0
            }
        }

        suppressSelectionCallbacks = false

        // Apply floating images with exclusion paths (must be before inline players)
        overlayFloatingImages(for: currentPageIndex, in: textView)
        if isTwoPageMode, let stv = secondTextView, currentPageIndex + 1 < pages.count {
            overlayFloatingImages(for: currentPageIndex + 1, in: stv)
        }

        // Overlay inline players for media attachments
        overlayInlinePlayers(for: currentPageIndex, in: textView)
        if isTwoPageMode, let stv = secondTextView, currentPageIndex + 1 < pages.count {
            overlayInlinePlayers(for: currentPageIndex + 1, in: stv)
        }
    }

    /// Render a single page into the given text view.
    private func renderPage(at pageIndex: Int, into targetTextView: UITextView, fullString: NSAttributedString) {
        let page = pages[pageIndex]
        let safeRange = NSIntersectionRange(page.range, NSRange(location: 0, length: fullString.length))
        let pageString = fullString.attributedSubstring(from: safeRange)

        // Detect blank pages (empty or whitespace-only content)
        let trimmed = pageString.string.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            targetTextView.attributedText = blankPagePlaceholder()
            centerTextVertically(in: targetTextView)
        } else {
            // Apply highlights that overlap with this page
            let highlightedString = applyHighlightsToPage(pageString, pageRange: safeRange)
            targetTextView.attributedText = highlightedString
            targetTextView.contentInset.top = 0
        }
    }

    private func blankPagePlaceholder() -> NSAttributedString {
        let style = NSMutableParagraphStyle()
        style.alignment = .center

        let attrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: 15, weight: .regular),
            .foregroundColor: UIColor.tertiaryLabel,
            .paragraphStyle: style
        ]
        return NSAttributedString(string: "This page is blank", attributes: attrs)
    }

    private func centerTextVertically(in targetTextView: UITextView) {
        let textSize = targetTextView.sizeThatFits(CGSize(
            width: targetTextView.bounds.width,
            height: .greatestFiniteMagnitude
        ))
        let offset = max(0, (targetTextView.bounds.height - textSize.height) / 2)
        targetTextView.contentInset.top = offset
    }

    // MARK: - Highlight Application

    /// Set the highlights to render. Ranges are relative to the full chapter attributed string.
    func applyHighlights(_ highlights: [(id: String, range: NSRange, color: UIColor)]) {
        self.highlightRanges = highlights
        showCurrentPage() // Re-render with highlights
    }

    /// Apply highlight background colors to a page substring.
    private func applyHighlightsToPage(_ pageString: NSAttributedString,
                                        pageRange: NSRange) -> NSAttributedString {
        guard !highlightRanges.isEmpty else { return pageString }

        let mutable = NSMutableAttributedString(attributedString: pageString)

        for highlight in highlightRanges {
            // Calculate overlap between highlight range and page range
            let overlap = NSIntersectionRange(highlight.range, pageRange)
            guard overlap.length > 0 else { continue }

            // Convert to page-local range
            let localRange = NSRange(
                location: overlap.location - pageRange.location,
                length: overlap.length
            )

            // Safety check
            guard localRange.location >= 0,
                  localRange.location + localRange.length <= mutable.length else { continue }

            mutable.addAttribute(.backgroundColor, value: highlight.color.withAlphaComponent(0.35),
                                 range: localRange)
        }

        return mutable
    }

    // MARK: - Theme

    func applyTheme(backgroundColor: UIColor) {
        view.backgroundColor = backgroundColor
        textView.backgroundColor = backgroundColor
        secondTextView?.backgroundColor = backgroundColor
        gutterView?.backgroundColor = backgroundColor
    }

    // MARK: - UITextViewDelegate

    func textViewDidChangeSelection(_ textView: UITextView) {
        guard !suppressSelectionCallbacks else { return }

        // Determine which page this text view represents
        let pageIndex: Int
        if textView === self.secondTextView {
            pageIndex = currentPageIndex + 1
        } else {
            pageIndex = currentPageIndex
        }

        let selectedRange = textView.selectedRange
        guard selectedRange.length > 0 else {
            onSelectionChanged?(nil)
            return
        }

        let selectedText = (textView.text as NSString).substring(with: selectedRange)
        guard !selectedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            onSelectionChanged?(nil)
            return
        }

        guard pageIndex < pages.count else {
            onSelectionChanged?(nil)
            return
        }

        // Convert page-local selection range to full chapter range
        let pageRange = pages[pageIndex].range
        let fullRange = NSRange(
            location: pageRange.location + selectedRange.location,
            length: selectedRange.length
        )

        // Get bounding rect of selection for toolbar positioning
        let frame = selectionBoundingRect(for: selectedRange, in: textView)

        // Build locator JSON
        let locator: [String: Any] = [
            "format": "epub",
            "href": currentChapterHref ?? "",
            "range": [
                "startOffset": fullRange.location,
                "endOffset": fullRange.location + fullRange.length
            ]
        ]

        let locationJSON: String
        if let data = try? JSONSerialization.data(withJSONObject: locator),
           let json = String(data: data, encoding: .utf8) {
            locationJSON = json
        } else {
            locationJSON = "{}"
        }

        let selection = ReaderSelection(
            text: selectedText,
            locationJSON: locationJSON,
            frame: frame
        )
        onSelectionChanged?(selection)
    }

    private func selectionBoundingRect(for range: NSRange, in targetTextView: UITextView) -> CGRect? {
        guard let start = targetTextView.position(from: targetTextView.beginningOfDocument, offset: range.location),
              let end = targetTextView.position(from: start, offset: range.length),
              let textRange = targetTextView.textRange(from: start, to: end) else {
            return nil
        }

        let rects = targetTextView.selectionRects(for: textRange)
        guard !rects.isEmpty else { return nil }

        var boundingRect = rects[0].rect
        for rect in rects.dropFirst() {
            boundingRect = boundingRect.union(rect.rect)
        }

        // Convert to view coordinates
        return targetTextView.convert(boundingRect, to: view)
    }

    func clearSelection() {
        suppressSelectionCallbacks = true
        textView.selectedTextRange = nil
        secondTextView?.selectedTextRange = nil
        suppressSelectionCallbacks = false
        onSelectionChanged?(nil)
    }

    // MARK: - Target Text View Detection

    /// Determine which text view and page index a point (in view coords) corresponds to.
    private func targetTextView(for point: CGPoint) -> (UITextView, Int) {
        if isTwoPageMode, let stv = secondTextView {
            let pointInSTV = view.convert(point, to: stv)
            if stv.bounds.contains(pointInSTV) {
                return (stv, currentPageIndex + 1)
            }
        }
        return (textView, currentPageIndex)
    }

    // MARK: - Gesture Handlers

    @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
        let point = gesture.location(in: view)

        // Ignore taps on inline player views — they handle their own interactions
        for playerView in inlinePlayerViews {
            if playerView.frame.contains(point) {
                return
            }
        }

        // Check if user has text selected on either text view — if so, clear selection
        if let selectedRange = textView.selectedTextRange, !selectedRange.isEmpty {
            clearSelection()
            return
        }
        if let stv = secondTextView, let selectedRange = stv.selectedTextRange, !selectedRange.isEmpty {
            clearSelection()
            return
        }

        // Determine which text view and page was tapped
        let (tappedTV, tappedPageIndex) = targetTextView(for: point)

        // Check if tap is on a highlight
        let textViewPoint = gesture.location(in: tappedTV)
        if let highlightId = highlightAtPoint(textViewPoint, in: tappedTV, pageIndex: tappedPageIndex) {
            onHighlightTapped?(highlightId)
            return
        }

        // Check if tap is on a link
        if let linkURL = linkAtPoint(textViewPoint, in: tappedTV) {
            onLinkTapped?(linkURL)
            return
        }

        // Tap zone detection: left 25%, center 50%, right 25%
        let width = view.bounds.width
        if point.x < width * 0.25 {
            onTapZone?("left")
        } else if point.x > width * 0.75 {
            onTapZone?("right")
        } else {
            onTapZone?("center")
        }
    }

    @objc private func handleSwipeLeft(_ gesture: UISwipeGestureRecognizer) {
        onTapZone?("right") // Swipe left = go forward
    }

    @objc private func handleSwipeRight(_ gesture: UISwipeGestureRecognizer) {
        onTapZone?("left") // Swipe right = go backward
    }

    // MARK: - Link Hit Testing

    private func linkAtPoint(_ point: CGPoint, in targetTextView: UITextView) -> URL? {
        let layoutManager = targetTextView.layoutManager
        let textContainer = targetTextView.textContainer
        let characterIndex = layoutManager.characterIndex(
            for: point,
            in: textContainer,
            fractionOfDistanceBetweenInsertionPoints: nil
        )

        guard let attrString = targetTextView.attributedText,
              characterIndex < attrString.length else { return nil }

        let attrs = attrString.attributes(at: characterIndex, effectiveRange: nil)
        return attrs[.link] as? URL
    }

    // MARK: - Floating Images (CSS float)

    /// Position floating images as subviews and set exclusion paths for text wrapping.
    private func overlayFloatingImages(for pageIndex: Int, in targetTextView: UITextView) {
        guard !floatingElements.isEmpty, pageIndex < pages.count else { return }

        let pageRange = pages[pageIndex].range
        let containerWidth = targetTextView.textContainer.size.width

        // First pass: determine which floats are on this page and their Y positions
        targetTextView.layoutIfNeeded()
        let layoutManager = targetTextView.layoutManager

        var exclusionRects: [CGRect] = []

        for floatEl in floatingElements {
            // Check if this float's marker falls within the current page range
            guard NSLocationInRange(floatEl.markerIndex, pageRange) else { continue }

            // Convert to page-local character index
            let localIndex = floatEl.markerIndex - pageRange.location
            guard localIndex >= 0,
                  let attrText = targetTextView.attributedText,
                  localIndex < attrText.length else { continue }

            // Find Y position of the marker character
            let charRange = NSRange(location: localIndex, length: 1)
            let glyphRange = layoutManager.glyphRange(
                forCharacterRange: charRange, actualCharacterRange: nil
            )
            guard glyphRange.location != NSNotFound else { continue }

            let lineRect = layoutManager.lineFragmentRect(
                forGlyphAt: glyphRange.location, effectiveRange: nil
            )

            // The float starts at the top of the line containing the marker
            let floatY = lineRect.origin.y + floatEl.marginTop

            // Calculate exclusion rect in text container coordinates
            let exclusionRect: CGRect
            if floatEl.floatSide == .right {
                let x = containerWidth - floatEl.size.width
                exclusionRect = CGRect(
                    x: x - floatEl.marginInline,
                    y: floatY,
                    width: floatEl.size.width + floatEl.marginInline,
                    height: floatEl.size.height + floatEl.marginBottom
                )
            } else {
                exclusionRect = CGRect(
                    x: 0,
                    y: floatY,
                    width: floatEl.size.width + floatEl.marginInline,
                    height: floatEl.size.height + floatEl.marginBottom
                )
            }

            exclusionRects.append(exclusionRect)

            // Create UIImageView for the floating image
            let imageView = UIImageView(image: floatEl.image)
            imageView.contentMode = .scaleAspectFill
            imageView.clipsToBounds = true

            // Position in text container coordinates, then convert to view coordinates
            let imageRect: CGRect
            if floatEl.floatSide == .right {
                imageRect = CGRect(
                    x: containerWidth - floatEl.size.width,
                    y: floatY,
                    width: floatEl.size.width,
                    height: floatEl.size.height
                )
            } else {
                imageRect = CGRect(
                    x: 0,
                    y: floatY,
                    width: floatEl.size.width,
                    height: floatEl.size.height
                )
            }

            // Convert from text container coords to textView coords (add insets)
            var viewFrame = imageRect
            viewFrame.origin.x += targetTextView.textContainerInset.left
            viewFrame.origin.y += targetTextView.textContainerInset.top

            // Convert to self.view coordinates
            let finalFrame = targetTextView.convert(viewFrame, to: view)
            imageView.frame = finalFrame

            view.addSubview(imageView)
            floatingImageViews.append(imageView)
        }

        // Apply exclusion paths — text will reflow around these rects
        if !exclusionRects.isEmpty {
            let paths = exclusionRects.map { UIBezierPath(rect: $0) }
            targetTextView.textContainer.exclusionPaths = paths
            targetTextView.layoutIfNeeded()
        }
    }

    /// Remove all floating image subviews and clear exclusion paths.
    private func removeFloatingImages() {
        for imageView in floatingImageViews {
            imageView.removeFromSuperview()
        }
        floatingImageViews.removeAll()
        textView.textContainer.exclusionPaths = []
        secondTextView?.textContainer.exclusionPaths = []
    }

    // MARK: - Inline Media Players

    /// Stop all active media players. Called when the book is closed.
    func stopAllMedia() {
        removeInlinePlayers()
    }

    /// Create and position inline player views over media attachments on the given page.
    private func overlayInlinePlayers(for pageIndex: Int, in targetTextView: UITextView) {
        guard !mediaAttachments.isEmpty, pageIndex < pages.count else { return }

        let pageRange = pages[pageIndex].range
        targetTextView.layoutIfNeeded()

        let layoutManager = targetTextView.layoutManager

        for media in mediaAttachments {
            // Check if this attachment overlaps with the current page
            let overlap = NSIntersectionRange(media.range, pageRange)
            guard overlap.length > 0 else { continue }

            // Use only the first character (the attachment character itself),
            // not the trailing newline, to get the precise attachment frame.
            let attachCharIndex = overlap.location - pageRange.location

            guard attachCharIndex >= 0,
                  let attrText = targetTextView.attributedText,
                  attachCharIndex < attrText.length else { continue }

            // Get the attachment size from the NSTextAttachment bounds
            let attachSize: CGSize
            if let attachment = attrText.attribute(.attachment, at: attachCharIndex, effectiveRange: nil) as? NSTextAttachment {
                attachSize = attachment.bounds.size
            } else {
                continue // Not an attachment character
            }

            guard attachSize.width > 10, attachSize.height > 10 else { continue }

            // Find the glyph position for the attachment character
            let charRange = NSRange(location: attachCharIndex, length: 1)
            let glyphRange = layoutManager.glyphRange(
                forCharacterRange: charRange, actualCharacterRange: nil
            )
            let glyphIndex = glyphRange.location

            // Get the line fragment containing this glyph
            let lineRect = layoutManager.lineFragmentRect(
                forGlyphAt: glyphIndex, effectiveRange: nil
            )
            // Get the glyph's location within the line fragment
            let glyphLoc = layoutManager.location(forGlyphAt: glyphIndex)

            // Compute the attachment rect in text container coordinates
            var rect = CGRect(
                x: lineRect.origin.x + glyphLoc.x,
                y: lineRect.origin.y,
                width: attachSize.width,
                height: attachSize.height
            )

            // Adjust for text container insets
            rect.origin.x += targetTextView.textContainerInset.left
            rect.origin.y += targetTextView.textContainerInset.top

            // Convert to self.view coordinates
            let viewRect = targetTextView.convert(rect, to: view)

            let mode: InlineMediaPlayerView.Mode = media.kind == .audio ? .audio : .video
            let playerView = InlineMediaPlayerView(url: media.url, mode: mode)
            playerView.frame = viewRect
            view.addSubview(playerView)
            inlinePlayerViews.append(playerView)
        }
    }

    /// Remove and stop all inline player views.
    private func removeInlinePlayers() {
        for playerView in inlinePlayerViews {
            playerView.stopPlayback()
            playerView.removeFromSuperview()
        }
        inlinePlayerViews.removeAll()
    }

    // MARK: - Highlight Hit Testing

    private func highlightAtPoint(_ point: CGPoint, in targetTextView: UITextView, pageIndex: Int) -> String? {
        guard !highlightRanges.isEmpty, pageIndex < pages.count else { return nil }

        // Find the character index at the tap point
        let layoutManager = targetTextView.layoutManager
        let textContainer = targetTextView.textContainer
        let characterIndex = layoutManager.characterIndex(
            for: point,
            in: textContainer,
            fractionOfDistanceBetweenInsertionPoints: nil
        )

        // Convert page-local index to full chapter index
        let pageRange = pages[pageIndex].range
        let fullIndex = pageRange.location + characterIndex

        // Check if this index falls within any highlight range
        for highlight in highlightRanges {
            if NSLocationInRange(fullIndex, highlight.range) {
                return highlight.id
            }
        }

        return nil
    }
}

// MARK: - UIGestureRecognizerDelegate

extension NativePageViewController: UIGestureRecognizerDelegate {
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        // Allow tap gesture to work alongside text selection
        return true
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        // Only begin tap if no text is currently being selected via long press
        if gestureRecognizer is UITapGestureRecognizer {
            return true
        }
        return true
    }
}
