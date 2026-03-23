//
//  NativePageViewController.swift
//  Compendus
//
//  UIViewController hosting a non-editable UITextView for native EPUB rendering.
//  Displays one or two pages at a time with tap zone navigation and text selection support.
//

import UIKit

@MainActor
public class NativePageViewController: UIViewController, UITextViewDelegate {

    // MARK: - Views

    public private(set) var textView: UITextView!

    // Second text view for right page in two-page (spread) mode
    private var secondTextView: UITextView?

    // Visual divider between pages in spread mode
    private var gutterView: UIView?

    // UIImageView used for FXL pages whose spine items carry properties="svg".
    // These pages are fully typeset SVGs (e.g. exported from InDesign) rendered
    // natively via UIImage+CoreSVG — no WKWebView process needed.
    private var fxlImageView: UIImageView?

    // MARK: - Layout State

    /// Whether we're currently in two-page spread mode
    public private(set) var isTwoPageMode: Bool = false

    /// Gutter width between the two pages
    private let gutterWidth: CGFloat = 16

    /// Active constraints for the text views (replaced when layout mode changes)
    private var layoutConstraints: [NSLayoutConstraint] = []

    // MARK: - Content State

    private var fullAttributedString: NSAttributedString?
    private var pages: [PageInfo] = []
    public private(set) var currentPageIndex: Int = 0
    private var currentChapterHref: String?

    // Highlight tracking: (highlight ID, range in full attributed string, color)
    public private(set) var highlightRanges: [(id: String, range: NSRange, color: UIColor)] = []

    /// Read-only access to the current highlights for composing temporary overlays.
    public var currentHighlightRanges: [(id: String, range: NSRange, color: UIColor)] {
        highlightRanges
    }

    // Track whether we're suppressing selection callbacks during page transitions
    private var suppressSelectionCallbacks = false

    // MARK: - Callbacks

    public var onPageChanged: ((_ page: Int, _ totalPages: Int) -> Void)?
    public var onSelectionChanged: ((ReaderSelection?) -> Void)?
    public var onHighlightTapped: ((String) -> Void)?
    public var onTapZone: ((String) -> Void)?
    public var onLinkTapped: ((URL) -> Void)?
    public var onFootnoteTapped: ((URL) -> Void)?

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
    public var onViewReady: ((CGSize) -> Void)?
    private var hasNotifiedReady = false

    /// Called when the view size changes after initial layout (rotation, window resize).
    public var onViewResized: ((CGSize) -> Void)?
    private var lastReportedSize: CGSize = .zero
    private var resizeDebounceTask: Task<Void, Never>?

    /// When true, blank pages show as empty instead of "This page is blank" placeholder.
    public var suppressBlankPagePlaceholder: Bool = false

    // MARK: - Page Indicator

    private var pageIndicatorView: UIView?
    private var pageIndicatorLabel: UILabel?
    private var pageIndicatorHideTask: Task<Void, Never>?

    /// Show a floating page indicator in the center of the screen that fades out.
    public func showPageIndicator(text: String) {
        pageIndicatorHideTask?.cancel()

        if let label = pageIndicatorLabel, let container = pageIndicatorView {
            container.layer.removeAllAnimations()
            label.text = text
            container.alpha = 1
            view.bringSubviewToFront(container)
        } else {
            let label = UILabel()
            label.text = text
            let baseFont = UIFont.monospacedDigitSystemFont(ofSize: 15, weight: .medium)
            if let descriptor = baseFont.fontDescriptor.withDesign(.rounded) {
                label.font = UIFont(descriptor: descriptor, size: 15)
            } else {
                label.font = baseFont
            }
            label.textColor = .secondaryLabel
            label.textAlignment = .center
            label.translatesAutoresizingMaskIntoConstraints = false

            let container = UIView()
            container.backgroundColor = currentTheme?.secondaryBackgroundColor ?? UIColor.systemFill
            container.layer.cornerRadius = 10
            container.layer.masksToBounds = true
            container.translatesAutoresizingMaskIntoConstraints = false
            container.addSubview(label)
            view.addSubview(container)

            NSLayoutConstraint.activate([
                container.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                container.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
                label.topAnchor.constraint(equalTo: container.topAnchor, constant: 8),
                label.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -8),
                label.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 16),
                label.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -16),
            ])

            pageIndicatorLabel = label
            pageIndicatorView = container
        }

        pageIndicatorHideTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(1.2))
            guard !Task.isCancelled else { return }
            UIView.animate(withDuration: 0.3) {
                self?.pageIndicatorView?.alpha = 0
            }
        }
    }

    // MARK: - Loading Overlay

    private var loadingOverlay: UIView?

    /// Show or hide a centered activity indicator overlay while a chapter loads.
    public func showLoadingIndicator(_ show: Bool) {
        if show {
            guard loadingOverlay == nil else { return }
            let overlay = UIView()
            overlay.backgroundColor = currentTheme?.overlayBackgroundColor ?? UIColor.systemBackground.withAlphaComponent(0.6)
            overlay.translatesAutoresizingMaskIntoConstraints = false

            // Linear progress bar style matching the EPUB loader
            let progressBar = UIProgressView(progressViewStyle: .default)
            progressBar.translatesAutoresizingMaskIntoConstraints = false
            progressBar.setProgress(0, animated: false)
            progressBar.trackTintColor = UIColor.systemGray5
            // Animate indeterminate progress
            overlay.addSubview(progressBar)

            let label = UILabel()
            label.text = "Loading chapter..."
            label.font = .preferredFont(forTextStyle: .caption1)
            label.textColor = .secondaryLabel
            label.translatesAutoresizingMaskIntoConstraints = false
            overlay.addSubview(label)

            view.addSubview(overlay)
            NSLayoutConstraint.activate([
                overlay.topAnchor.constraint(equalTo: view.topAnchor),
                overlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                overlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                overlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),
                progressBar.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
                progressBar.centerYAnchor.constraint(equalTo: overlay.centerYAnchor),
                progressBar.widthAnchor.constraint(equalToConstant: 200),
                label.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
                label.topAnchor.constraint(equalTo: progressBar.bottomAnchor, constant: 12),
            ])

            // Animate progress to simulate loading
            UIView.animate(withDuration: 1.5, delay: 0, options: [.repeat, .autoreverse]) {
                progressBar.setProgress(1.0, animated: true)
            }

            loadingOverlay = overlay
        } else {
            loadingOverlay?.removeFromSuperview()
            loadingOverlay = nil
        }
    }

    // MARK: - Lifecycle

    override public func viewDidLoad() {
        super.viewDidLoad()

        setupTextView()
        setupGestures()
    }

    override public func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        notifyReadyIfNeeded()
    }

    override public func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        stopAllMedia()
    }

    override public func viewDidLayoutSubviews() {
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
        disableDoubleTapSelection(in: textView)
    }

    /// Factory for creating a configured UITextView (used for both left and right pages).
    private func makeTextView() -> UITextView {
        let tv = UITextView(usingTextLayoutManager: false)
        tv.isEditable = false
        tv.isScrollEnabled = false
        tv.isSelectable = true
        tv.textContainerInset = NativePaginationEngine.defaultInsets
        tv.textContainer.lineFragmentPadding = 0
        tv.backgroundColor = currentTheme?.backgroundColor ?? .systemBackground
        tv.delegate = self
        tv.translatesAutoresizingMaskIntoConstraints = false

        // Disable link interactions (we handle taps ourselves)
        tv.isUserInteractionEnabled = true
        tv.dataDetectorTypes = []
        tv.linkTextAttributes = [:]

        return tv
    }

    /// Update text container insets on all text views (e.g. to include safe area).
    public func updateTextContainerInsets(_ insets: UIEdgeInsets) {
        textView.textContainerInset = insets
        secondTextView?.textContainerInset = insets
    }

    private func setupGestures() {
        // Tap gesture for navigation zones and highlight detection
        let tapGesture = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        tapGesture.delegate = self
        view.addGestureRecognizer(tapGesture)

        // Swipe gestures for page turning
        let swipeLeft = UISwipeGestureRecognizer(target: self, action: #selector(handleSwipeLeft(_:)))
        swipeLeft.direction = .left
        swipeLeft.delegate = self
        view.addGestureRecognizer(swipeLeft)

        let swipeRight = UISwipeGestureRecognizer(target: self, action: #selector(handleSwipeRight(_:)))
        swipeRight.direction = .right
        swipeRight.delegate = self
        view.addGestureRecognizer(swipeRight)
    }

    // MARK: - Two-Page Layout Configuration

    /// Switch between single-page and two-page spread layout.
    public func configureLayout(twoPage: Bool) {
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
        disableDoubleTapSelection(in: stv)
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

    // MARK: - Double-Tap Selection Suppression

    /// Disable UITextView's internal double-tap-to-select-word gesture so that
    /// text selection only happens via long press. This prevents accidental
    /// highlight toolbar appearances from casual taps.
    private func disableDoubleTapSelection(in targetTextView: UITextView) {
        for gesture in targetTextView.gestureRecognizers ?? [] {
            if let tap = gesture as? UITapGestureRecognizer, tap.numberOfTapsRequired == 2 {
                tap.isEnabled = false
            }
        }
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
    /// `textContainerInsets` must include safe area insets for correct rendering.
    public func loadContent(
        attributedString: NSAttributedString,
        pages: [PageInfo],
        chapterHref: String?,
        startAtPage: Int = 0,
        mediaAttachments: [MediaAttachment] = [],
        floatingElements: [FloatingElement] = [],
        textContainerInsets: UIEdgeInsets? = nil
    ) {
        self.fullAttributedString = attributedString
        self.pages = pages
        self.currentChapterHref = chapterHref
        self.currentPageIndex = min(startAtPage, max(0, pages.count - 1))
        self.mediaAttachments = mediaAttachments
        self.floatingElements = floatingElements

        // Apply insets if provided; callers should always provide safe-area-aware insets
        if let insets = textContainerInsets {
            textView.textContainerInset = insets
            secondTextView?.textContainerInset = insets
        }

        // Re-apply double-tap suppression after content load (UIKit may
        // recreate internal gesture recognizers when content changes)
        disableDoubleTapSelection(in: textView)
        if let stv = secondTextView { disableDoubleTapSelection(in: stv) }

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
    public func showPage(_ index: Int) {
        guard index >= 0, index < pages.count else { return }
        currentPageIndex = index
        showCurrentPage()
        onPageChanged?(currentPageIndex, pages.count)
    }

    /// Replace the full attributed string (e.g. after a theme-only color update)
    /// and re-render the current page without altering pagination or page index.
    public func updateAttributedString(_ attributedString: NSAttributedString) {
        self.fullAttributedString = attributedString
        showCurrentPage()
    }

    /// Navigate to a progression value (0.0–1.0) within the current chapter.
    public func showProgression(_ progression: Double) {
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

        // Defer layout and overlay work to the next run loop iteration.
        // This allows tap events to be processed immediately after content is set,
        // preventing the "can see content but can't interact" issue.
        let pageAtSchedule = currentPageIndex
        DispatchQueue.main.async { [weak self] in
            guard let self, self.currentPageIndex == pageAtSchedule else { return }

            // Single layout pass before computing glyph positions for overlays.
            self.textView.layoutIfNeeded()
            if self.isTwoPageMode {
                self.secondTextView?.layoutIfNeeded()
            }

            // Apply floating images with exclusion paths (must be before inline players)
            self.overlayFloatingImages(for: pageAtSchedule, in: self.textView)
            if self.isTwoPageMode, let stv = self.secondTextView, pageAtSchedule + 1 < self.pages.count {
                self.overlayFloatingImages(for: pageAtSchedule + 1, in: stv)
            }

            // Overlay inline players for media attachments
            self.overlayInlinePlayers(for: pageAtSchedule, in: self.textView)
            if self.isTwoPageMode, let stv = self.secondTextView, pageAtSchedule + 1 < self.pages.count {
                self.overlayInlinePlayers(for: pageAtSchedule + 1, in: stv)
            }

            // Prefetch images for nearby pages in background for smooth paging
            self.prefetchImagesForAdjacentPages()
        }
    }

    /// Render a single page into the given text view.
    private func renderPage(at pageIndex: Int, into targetTextView: UITextView, fullString: NSAttributedString) {
        let page = pages[pageIndex]
        let safeRange = NSIntersectionRange(page.range, NSRange(location: 0, length: fullString.length))

        // Apply only already-cached images synchronously (no disk I/O).
        // Any uncached images are loaded asynchronously to avoid blocking the main thread.
        var hasUncached = false
        fullString.enumerateAttribute(.attachment, in: safeRange, options: []) { value, _, _ in
            guard let lazy = value as? LazyImageAttachment else { return }
            if lazy.isLoaded { return }
            if let cached = EPUBImageCache.shared.image(forPath: lazy.imageURL.path) {
                lazy.image = cached
            } else {
                hasUncached = true
            }
        }
        if hasUncached {
            loadImagesAsync(for: pageIndex)
        }

        let pageString = fullString.attributedSubstring(from: safeRange)

        // Detect blank pages (empty or whitespace-only content)
        let trimmed = pageString.string.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            if suppressBlankPagePlaceholder {
                targetTextView.attributedText = NSAttributedString(string: "")
            } else {
                targetTextView.attributedText = blankPagePlaceholder()
            }
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

    // MARK: - Lazy Image Loading

    /// Collect LazyImageAttachments that need loading in the given range.
    private func collectLazyAttachments(in range: NSRange, from attrString: NSAttributedString) -> [LazyImageAttachment] {
        let safeRange = NSIntersectionRange(range, NSRange(location: 0, length: attrString.length))
        guard safeRange.length > 0 else { return [] }
        var attachments: [LazyImageAttachment] = []
        attrString.enumerateAttribute(.attachment, in: safeRange, options: []) { value, _, _ in
            if let lazy = value as? LazyImageAttachment, !lazy.isLoaded {
                attachments.append(lazy)
            }
        }
        return attachments
    }

    /// Asynchronously load images for a page, then refresh the text view to show them.
    public func loadImagesAsync(for pageIndex: Int) {
        guard let fullString = fullAttributedString, pageIndex < pages.count else { return }
        let page = pages[pageIndex]
        let safeRange = NSIntersectionRange(page.range, NSRange(location: 0, length: fullString.length))
        let unloaded = collectLazyAttachments(in: safeRange, from: fullString)
        guard !unloaded.isEmpty else { return }

        Task { [weak self] in
            // Load all images off main thread
            await withTaskGroup(of: Void.self) { group in
                for attachment in unloaded {
                    group.addTask { _ = await attachment.loadImageAsync() }
                }
            }
            // Refresh the text view now that images are decoded.
            // Use setNeedsDisplay + setNeedsLayout to defer layout to the next run loop
            // instead of forcing an immediate synchronous layout pass.
            guard let self, self.currentPageIndex == pageIndex else { return }
            self.textView?.setNeedsDisplay()
            self.textView?.setNeedsLayout()
            self.secondTextView?.setNeedsDisplay()
            self.secondTextView?.setNeedsLayout()
        }
    }

    /// Prefetch images for pages adjacent to the current page in a background task.
    /// Ensures smooth page transitions without visible image pop-in.
    private func prefetchImagesForAdjacentPages() {
        guard let fullString = fullAttributedString, !pages.isEmpty else { return }
        let current = currentPageIndex
        let pageCount = pages.count

        // Prefetch current ± 2 pages (current page is already loaded)
        let prefetchIndices = [current - 1, current + 2, current + 3, current - 2]
            .filter { $0 >= 0 && $0 < pageCount }

        guard !prefetchIndices.isEmpty else { return }

        // Capture page ranges for the background task
        let pageRanges = prefetchIndices.map { pages[$0].range }
        let stringLength = fullString.length

        Task.detached(priority: .utility) {
            for range in pageRanges {
                let safeRange = NSIntersectionRange(range, NSRange(location: 0, length: stringLength))
                guard safeRange.length > 0 else { continue }
                // Collect attachments then load async (avoids setting UIKit properties from background)
                var attachments: [LazyImageAttachment] = []
                fullString.enumerateAttribute(.attachment, in: safeRange, options: []) { value, _, _ in
                    if let lazy = value as? LazyImageAttachment, !lazy.isLoaded {
                        attachments.append(lazy)
                    }
                }
                for attachment in attachments {
                    _ = await attachment.loadImageAsync()
                }
            }
        }
    }

    // MARK: - Highlight Application

    /// Set the highlights to render. Ranges are relative to the full chapter attributed string.
    /// Applies highlights incrementally without re-rendering the entire page.
    public func applyHighlights(_ highlights: [(id: String, range: NSRange, color: UIColor)]) {
        self.highlightRanges = highlights
        refreshHighlightsInPlace()
    }

    /// Re-apply highlight attributes to the currently displayed text views
    /// without triggering a full page re-render (no image loading, no overlay rebuild).
    private func refreshHighlightsInPlace() {
        guard let fullString = fullAttributedString,
              currentPageIndex < pages.count else { return }

        // Refresh left (or only) page
        let leftPage = pages[currentPageIndex]
        let leftRange = NSIntersectionRange(leftPage.range, NSRange(location: 0, length: fullString.length))
        let leftPageString = fullString.attributedSubstring(from: leftRange)
        let highlightedLeft = applyHighlightsToPage(leftPageString, pageRange: leftRange)
        textView.attributedText = highlightedLeft

        // Refresh right page in two-page mode
        if isTwoPageMode, let stv = secondTextView, currentPageIndex + 1 < pages.count {
            let rightPage = pages[currentPageIndex + 1]
            let rightRange = NSIntersectionRange(rightPage.range, NSRange(location: 0, length: fullString.length))
            let rightPageString = fullString.attributedSubstring(from: rightRange)
            let highlightedRight = applyHighlightsToPage(rightPageString, pageRange: rightRange)
            stv.attributedText = highlightedRight
        }
    }

    /// Apply highlight background colors to a page substring.
    private func applyHighlightsToPage(_ pageString: NSAttributedString,
                                        pageRange: NSRange) -> NSAttributedString {
        guard !highlightRanges.isEmpty else { return pageString }

        let mutable = NSMutableAttributedString(attributedString: pageString)

        // Apply user highlights (35% opacity)
        for highlight in highlightRanges {
            let overlap = NSIntersectionRange(highlight.range, pageRange)
            guard overlap.length > 0 else { continue }

            let localRange = NSRange(
                location: overlap.location - pageRange.location,
                length: overlap.length
            )

            guard localRange.location >= 0,
                  localRange.location + localRange.length <= mutable.length else { continue }

            mutable.addAttribute(.backgroundColor, value: highlight.color.withAlphaComponent(0.35),
                                 range: localRange)
        }

        return mutable
    }

    /// Check if a given range (in full chapter attributed string coords) is visible on the current page(s).
    public func isRangeVisibleOnCurrentPage(_ range: NSRange) -> Bool {
        guard currentPageIndex < pages.count else { return false }

        let leftPageRange = pages[currentPageIndex].range
        if NSIntersectionRange(range, leftPageRange).length > 0 { return true }

        if isTwoPageMode, currentPageIndex + 1 < pages.count {
            let rightPageRange = pages[currentPageIndex + 1].range
            if NSIntersectionRange(range, rightPageRange).length > 0 { return true }
        }

        return false
    }

    // MARK: - FXL Web Page (SVG-property spine items)

    /// Load an FXL XHTML page that contains inline SVG content.
    /// Display a pre-rendered FXL page image. Hides the UITextView(s) and shows
    /// a UIImageView sized to fill the viewport. Call `clearFXLPage()` to restore
    /// normal text rendering when navigating away.
    public func loadFXLImagePage(_ image: UIImage) {
        if fxlImageView == nil {
            let iv = UIImageView(frame: view.bounds)
            iv.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            iv.contentMode = .scaleAspectFit
            iv.backgroundColor = view.backgroundColor ?? .systemBackground
            view.addSubview(iv)
            fxlImageView = iv
        }
        // Always bring above any spread-mode views (secondTextView/gutterView) that may
        // have been added after fxlImageView was first created, but stay below the
        // loading overlay if present.
        if let iv = fxlImageView {
            if let overlay = loadingOverlay {
                view.insertSubview(iv, belowSubview: overlay)
            } else {
                view.bringSubviewToFront(iv)
            }
        }
        fxlImageView?.backgroundColor = view.backgroundColor ?? .systemBackground
        fxlImageView?.image = image
        fxlImageView?.isHidden = false
        textView.isHidden = true
        secondTextView?.isHidden = true
        gutterView?.isHidden = true
    }

    /// Restore normal UITextView rendering, hiding the FXL image view.
    public func clearFXLPage() {
        fxlImageView?.isHidden = true
        textView.isHidden = false
        secondTextView?.isHidden = false
        gutterView?.isHidden = false
    }

    /// Legacy name kept for call sites that haven't migrated yet.
    @available(*, deprecated, renamed: "clearFXLPage")
    public func clearFXLWebPage() { clearFXLPage() }

    // MARK: - Theme

    public private(set) var currentTheme: ReaderTheme?

    public func applyTheme(backgroundColor: UIColor, theme: ReaderTheme? = nil) {
        view.backgroundColor = backgroundColor
        textView.backgroundColor = backgroundColor
        secondTextView?.backgroundColor = backgroundColor
        gutterView?.backgroundColor = backgroundColor
        fxlImageView?.backgroundColor = backgroundColor

        if let theme = theme {
            currentTheme = theme
            // Update page indicator container
            pageIndicatorView?.backgroundColor = theme.secondaryBackgroundColor
            // Update loading overlay
            loadingOverlay?.backgroundColor = theme.overlayBackgroundColor
        }
    }

    // MARK: - UITextViewDelegate

    public func textViewDidChangeSelection(_ textView: UITextView) {
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

    public func clearSelection() {
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

        // Note: when text is selected, gestureRecognizerShouldBegin prevents
        // this tap gesture from firing at all, so UITextView's internal gestures
        // handle taps (dragging handles or tapping elsewhere to deselect).

        // Determine which text view and page was tapped
        let (tappedTV, tappedPageIndex) = targetTextView(for: point)
        let textViewPoint = gesture.location(in: tappedTV)

        // Tap zone detection: left 25%, center 50%, right 25% horizontally,
        // but taps in the top/bottom 12% always toggle the overlay (toolbar).
        let width = view.bounds.width
        let height = view.bounds.height
        let isEdgeVertical = point.y < height * 0.12 || point.y > height * 0.88
        let isNavigationZone = !isEdgeVertical && (point.x < width * 0.25 || point.x > width * 0.75)

        // Only check highlights in the center content zone — tapping in
        // the navigation edges should always navigate, not trigger highlights.
        if !isNavigationZone {
            if let highlightId = highlightAtPoint(textViewPoint, in: tappedTV, pageIndex: tappedPageIndex) {
                onHighlightTapped?(highlightId)
                return
            }
        }

        // Check if tap is on a link (footnote or regular) — links are checked
        // everywhere since they're part of content interaction.
        if let (linkURL, isFootnote) = footnoteLinkAtPoint(textViewPoint, in: tappedTV) {
            if isFootnote, let callback = onFootnoteTapped {
                callback(linkURL)
            } else {
                onLinkTapped?(linkURL)
            }
            return
        }

        // Taps in the top/bottom edge always toggle overlay (show toolbar)
        if isEdgeVertical {
            onTapZone?("center")
        } else if point.x < width * 0.25 {
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

    private func footnoteLinkAtPoint(_ point: CGPoint, in targetTextView: UITextView) -> (URL, isFootnote: Bool)? {
        let layoutManager = targetTextView.layoutManager
        let textContainer = targetTextView.textContainer

        // Convert from text view coordinates to text container coordinates
        let insets = targetTextView.textContainerInset
        let containerPoint = CGPoint(x: point.x - insets.left, y: point.y - insets.top)

        var fraction: CGFloat = 0
        let characterIndex = layoutManager.characterIndex(
            for: containerPoint,
            in: textContainer,
            fractionOfDistanceBetweenInsertionPoints: &fraction
        )

        guard let attrString = targetTextView.attributedText,
              characterIndex < attrString.length else { return nil }

        // Verify the tap is actually within the glyph bounds, not just the nearest character
        let glyphIndex = layoutManager.glyphIndexForCharacter(at: characterIndex)
        let glyphRect = layoutManager.boundingRect(
            forGlyphRange: NSRange(location: glyphIndex, length: 1),
            in: textContainer
        )
        guard glyphRect.contains(containerPoint) else { return nil }

        let attrs = attrString.attributes(at: characterIndex, effectiveRange: nil)
        guard let url = attrs[.link] as? URL else { return nil }

        let isFootnote = attrs[NSAttributedString.Key("footnoteRef")] as? Bool == true
        return (url, isFootnote)
    }

    // MARK: - Floating Images (CSS float)

    /// Position floating images as subviews and set exclusion paths for text wrapping.
    /// Callers must call layoutIfNeeded() on the text view before invoking this method.
    private func overlayFloatingImages(for pageIndex: Int, in targetTextView: UITextView) {
        guard !floatingElements.isEmpty, pageIndex < pages.count else { return }

        let pageRange = pages[pageIndex].range
        let containerWidth = targetTextView.textContainer.size.width

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

            // Load the floating image — use cache first, fall back to async disk load
            let floatImage: UIImage?
            if let cached = EPUBImageCache.shared.image(forPath: floatEl.imageURL.path) {
                floatImage = cached
            } else {
                // Defer disk I/O to background — will be loaded when page is revisited
                // or by the prefetch system
                let url = floatEl.imageURL
                Task.detached(priority: .userInitiated) {
                    if let loaded = UIImage(contentsOfFile: url.path) {
                        EPUBImageCache.shared.setImage(loaded, forPath: url.path)
                    }
                }
                floatImage = nil
            }
            guard let resolvedImage = floatImage else { continue }

            let imageView = UIImageView(image: resolvedImage)
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

        // Apply exclusion paths — text will reflow around these rects.
        // Skip layoutIfNeeded here; the text view will lay out naturally on the next run loop.
        if !exclusionRects.isEmpty {
            let paths = exclusionRects.map { UIBezierPath(rect: $0) }
            targetTextView.textContainer.exclusionPaths = paths
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
    public func stopAllMedia() {
        removeInlinePlayers()
    }

    /// Create and position inline player views over media attachments on the given page.
    /// Callers must call layoutIfNeeded() on the text view before invoking this method.
    private func overlayInlinePlayers(for pageIndex: Int, in targetTextView: UITextView) {
        guard !mediaAttachments.isEmpty, pageIndex < pages.count else { return }

        let pageRange = pages[pageIndex].range

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

        // Convert from text view coordinates to text container coordinates
        let insets = targetTextView.textContainerInset
        let containerPoint = CGPoint(x: point.x - insets.left, y: point.y - insets.top)

        // Find the character index at the tap point
        let layoutManager = targetTextView.layoutManager
        let textContainer = targetTextView.textContainer
        let characterIndex = layoutManager.characterIndex(
            for: containerPoint,
            in: textContainer,
            fractionOfDistanceBetweenInsertionPoints: nil
        )

        // Verify the tap is actually within the glyph bounds
        let glyphIndex = layoutManager.glyphIndexForCharacter(at: characterIndex)
        let glyphRect = layoutManager.boundingRect(
            forGlyphRange: NSRange(location: glyphIndex, length: 1),
            in: textContainer
        )
        guard glyphRect.contains(containerPoint) else { return nil }

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
    public func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        // Allow tap gesture alongside text selection, but don't let swipe
        // gestures fire simultaneously with UITextView's internal selection
        // handle gestures — that prevents selection handle dragging.
        if gestureRecognizer is UITapGestureRecognizer {
            return true
        }
        return false
    }

    public func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        // When text is selected, don't begin any of our custom gestures.
        // UITextView's internal gestures handle everything:
        // - Tapping a selection handle → starts dragging to resize
        // - Tapping elsewhere → deselects (textViewDidChangeSelection fires)
        // - Swiping → blocked so handle dragging works
        let hasSelection: Bool = {
            if let selectedRange = textView.selectedTextRange, !selectedRange.isEmpty {
                return true
            }
            if let stv = secondTextView, let selectedRange = stv.selectedTextRange, !selectedRange.isEmpty {
                return true
            }
            return false
        }()

        if hasSelection {
            return false
        }
        return true
    }
}
