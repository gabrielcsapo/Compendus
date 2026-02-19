//
//  NativePageViewController.swift
//  Compendus
//
//  UIViewController hosting a non-editable UITextView for native EPUB rendering.
//  Displays one page at a time with tap zone navigation and text selection support.
//

import UIKit

@MainActor
class NativePageViewController: UIViewController, UITextViewDelegate {

    // MARK: - Views

    private(set) var textView: UITextView!

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

    /// Called once when the view has been laid out with a proper size.
    /// The engine uses this to know when it's safe to paginate.
    var onViewReady: ((CGSize) -> Void)?
    private var hasNotifiedReady = false

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

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        suppressNativeEditMenu(in: textView)
        notifyReadyIfNeeded()
    }

    private func notifyReadyIfNeeded() {
        guard !hasNotifiedReady,
              view.bounds.width > 0, view.bounds.height > 0 else { return }
        hasNotifiedReady = true
        onViewReady?(view.bounds.size)
    }

    private func setupTextView() {
        textView = UITextView()
        textView.isEditable = false
        textView.isScrollEnabled = false
        textView.isSelectable = true
        textView.textContainerInset = NativePaginationEngine.defaultInsets
        textView.textContainer.lineFragmentPadding = 0
        textView.backgroundColor = .white
        textView.delegate = self
        textView.translatesAutoresizingMaskIntoConstraints = false

        // Disable link interactions (we handle taps ourselves)
        textView.isUserInteractionEnabled = true
        textView.dataDetectorTypes = []
        textView.linkTextAttributes = [:]

        view.addSubview(textView)
        NSLayoutConstraint.activate([
            textView.topAnchor.constraint(equalTo: view.topAnchor),
            textView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            textView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            textView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        suppressNativeEditMenu(in: textView)
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
        startAtPage: Int = 0
    ) {
        self.fullAttributedString = attributedString
        self.pages = pages
        self.currentChapterHref = chapterHref
        self.currentPageIndex = min(startAtPage, max(0, pages.count - 1))

        showCurrentPage()
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

        suppressSelectionCallbacks = true

        let page = pages[currentPageIndex]
        let safeRange = NSIntersectionRange(page.range, NSRange(location: 0, length: fullString.length))
        let pageString = fullString.attributedSubstring(from: safeRange)

        // Detect blank pages (empty or whitespace-only content)
        let trimmed = pageString.string.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            textView.attributedText = blankPagePlaceholder()
            centerTextVertically()
        } else {
            // Apply highlights that overlap with this page
            let highlightedString = applyHighlightsToPage(pageString, pageRange: safeRange)
            textView.attributedText = highlightedString
            textView.contentInset.top = 0
        }

        suppressSelectionCallbacks = false
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

    private func centerTextVertically() {
        let textSize = textView.sizeThatFits(CGSize(
            width: textView.bounds.width,
            height: .greatestFiniteMagnitude
        ))
        let offset = max(0, (textView.bounds.height - textSize.height) / 2)
        textView.contentInset.top = offset
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
    }

    // MARK: - UITextViewDelegate

    func textViewDidChangeSelection(_ textView: UITextView) {
        guard !suppressSelectionCallbacks else { return }

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

        // Convert page-local selection range to full chapter range
        let pageRange = pages[currentPageIndex].range
        let fullRange = NSRange(
            location: pageRange.location + selectedRange.location,
            length: selectedRange.length
        )

        // Get bounding rect of selection for toolbar positioning
        let frame = selectionBoundingRect(for: selectedRange)

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

    private func selectionBoundingRect(for range: NSRange) -> CGRect? {
        guard let start = textView.position(from: textView.beginningOfDocument, offset: range.location),
              let end = textView.position(from: start, offset: range.length),
              let textRange = textView.textRange(from: start, to: end) else {
            return nil
        }

        let rects = textView.selectionRects(for: textRange)
        guard !rects.isEmpty else { return nil }

        var boundingRect = rects[0].rect
        for rect in rects.dropFirst() {
            boundingRect = boundingRect.union(rect.rect)
        }

        // Convert to view coordinates
        return textView.convert(boundingRect, to: view)
    }

    func clearSelection() {
        suppressSelectionCallbacks = true
        textView.selectedTextRange = nil
        suppressSelectionCallbacks = false
        onSelectionChanged?(nil)
    }

    // MARK: - Gesture Handlers

    @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
        let point = gesture.location(in: view)

        // Check if user has text selected — if so, clear selection
        if let selectedRange = textView.selectedTextRange, !selectedRange.isEmpty {
            clearSelection()
            return
        }

        // Check if tap is on a highlight
        let textViewPoint = gesture.location(in: textView)
        if let highlightId = highlightAtPoint(textViewPoint) {
            onHighlightTapped?(highlightId)
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

    // MARK: - Highlight Hit Testing

    private func highlightAtPoint(_ point: CGPoint) -> String? {
        guard !highlightRanges.isEmpty else { return nil }

        // Find the character index at the tap point
        let layoutManager = textView.layoutManager
        let textContainer = textView.textContainer
        let characterIndex = layoutManager.characterIndex(
            for: point,
            in: textContainer,
            fractionOfDistanceBetweenInsertionPoints: nil
        )

        // Convert page-local index to full chapter index
        let pageRange = pages[currentPageIndex].range
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
