//
//  ComicPageViewController.swift
//  Compendus
//
//  UIViewController that displays comic pages with zoom/pan gesture support.
//  Uses UIScrollView for smooth pinch-to-zoom and momentum scrolling.
//  Supports single-page and two-page spread layouts.
//

import UIKit
import EPUBReader

@MainActor
class ComicPageViewController: UIViewController {

    private let engine: ComicEngine

    // MARK: - Views

    private var scrollView: UIScrollView!
    private var contentView: UIView!
    private var leftImageView: UIImageView!
    private var rightImageView: UIImageView?
    private var gutterView: UIView?
    private let gutterWidth: CGFloat = 8

    // MARK: - State

    private var isTwoPageMode: Bool = false
    private var isZoomed: Bool { scrollView.zoomScale > 1.01 }
    private var hasAppeared = false

    // Loading indicator (indeterminate linear bar)
    private var loadingTrack: UIView!
    private var loadingBar: UIView!
    private var isLoadingVisible = false

    // Guided-view panel overlay (all panels + current panel highlight + dim mask)
    private let allPanelsLayer = CAShapeLayer()
    private let currentPanelLayer = CAShapeLayer()
    /// Dims every part of the page EXCEPT the current panel — makes the
    /// focused panel pop and reduces visual noise from other panel outlines.
    private let dimMaskLayer = CAShapeLayer()

    // MARK: - Init

    init(engine: ComicEngine) {
        self.engine = engine
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = engine.currentSettings?.theme.backgroundColor ?? .black
        setupScrollView()
        setupImageViews()
        setupLoadingIndicator()
        setupGestures()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if !hasAppeared {
            hasAppeared = true
            layoutContentView()
            // Display the initial page now that the VC is in the view hierarchy.
            // During engine.load(), pageViewController was nil so the initial
            // displayCurrentPage() was a no-op.
            Task { await engine.displayCurrentPage() }
            // DEBUG: panel-detection audit on first appearance. Logs anomalies
            // with detailed rect info so we can classify full-bleed vs partial.
            Task.detached { [weak self] in
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                await self?.engine.auditAllPagesPanelDetection()
            }
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        guard hasAppeared else { return }

        scrollView.frame = view.bounds
        layoutContentView()

        // Start the loading animation once Auto Layout gives the track a real width
        startLoadingAnimationIfNeeded()

        // Landscape always renders as a single page (fit-to-width with vertical
        // scroll). Force the engine into single-page mode so it doesn't load
        // or detect panels for a second page that won't be displayed. In
        // portrait we let the user's settings drive spread mode normally.
        if view.bounds.width > view.bounds.height {
            engine.setSpreadMode(pagesPerSpread: 1)
        } else if let settings = engine.currentSettings {
            engine.updateSpreadMode(for: view.bounds.size, settings: settings)
        }
    }

    // MARK: - Setup

    private func setupScrollView() {
        scrollView = UIScrollView(frame: view.bounds)
        scrollView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        scrollView.delegate = self
        scrollView.minimumZoomScale = 1.0
        scrollView.maximumZoomScale = 4.0
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.showsVerticalScrollIndicator = false
        scrollView.bouncesZoom = true
        scrollView.backgroundColor = .clear
        view.addSubview(scrollView)

        contentView = UIView()
        contentView.backgroundColor = .clear
        scrollView.addSubview(contentView)
    }

    private func setupImageViews() {
        leftImageView = UIImageView()
        leftImageView.contentMode = .scaleAspectFit
        leftImageView.clipsToBounds = true
        contentView.addSubview(leftImageView)

        setupPanelOverlay()
    }

    /// Add the guided-view panel overlay layers. Children of contentView so
    /// they zoom and pan with the page.
    private func setupPanelOverlay() {
        // Dim mask drawn FIRST so it sits below the outlines.
        dimMaskLayer.fillColor = UIColor.black.withAlphaComponent(0.82).cgColor
        dimMaskLayer.fillRule = .evenOdd
        dimMaskLayer.isHidden = true
        contentView.layer.addSublayer(dimMaskLayer)

        allPanelsLayer.fillColor = UIColor.clear.cgColor
        allPanelsLayer.strokeColor = UIColor.systemBlue.withAlphaComponent(0.35).cgColor
        allPanelsLayer.lineWidth = 1.5
        allPanelsLayer.lineDashPattern = [4, 3]
        allPanelsLayer.isHidden = true
        contentView.layer.addSublayer(allPanelsLayer)

        currentPanelLayer.fillColor = UIColor.clear.cgColor
        currentPanelLayer.strokeColor = UIColor.systemBlue.cgColor
        currentPanelLayer.lineWidth = 0.5
        currentPanelLayer.isHidden = true
        contentView.layer.addSublayer(currentPanelLayer)
    }

    /// Refresh both overlay layers based on engine state + current contentView bounds.
    func updatePanelOverlay() {
        guard engine.guidedViewEnabled else {
            allPanelsLayer.isHidden = true
            currentPanelLayer.isHidden = true
            dimMaskLayer.isHidden = true
            return
        }
        let bounds = contentView.bounds
        guard bounds.width > 1, bounds.height > 1 else { return }

        let rects = allPanelRects(in: bounds, twoPage: isTwoPageMode)

        // Note: the dashed "all panels" outline used to draw here was visually
        // noisy; the dim mask already implies the other panels exist, so we
        // only render the solid current-panel highlight now.
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        allPanelsLayer.isHidden = true

        let panelIndex = max(0, min(engine.currentPanel, rects.count - 1))
        if rects.indices.contains(panelIndex) {
            let currentRect = rects[panelIndex]
            currentPanelLayer.path = UIBezierPath(roundedRect: currentRect, cornerRadius: 4).cgPath
            currentPanelLayer.isHidden = false

            // Dim mask = image area with the current panel cut out. Clipping
            // to the image rect (instead of contentView.bounds) keeps the
            // letterbox / off-page region transparent so the user can still
            // see the reader chrome and FAB clearly.
            let dimArea: CGRect
            if isTwoPageMode {
                dimArea = bounds
            } else {
                dimArea = imageRect(for: leftImageView)
            }
            let dimPath = UIBezierPath(rect: dimArea)
            dimPath.append(UIBezierPath(roundedRect: currentRect, cornerRadius: 4))
            dimPath.usesEvenOddFillRule = true
            dimMaskLayer.path = dimPath.cgPath
            dimMaskLayer.isHidden = false
        } else {
            currentPanelLayer.isHidden = true
            dimMaskLayer.isHidden = true
        }
        CATransaction.commit()
    }

    private func setupLoadingIndicator() {
        // Indeterminate linear progress bar (track + sliding inner bar)
        loadingTrack = UIView()
        loadingTrack.backgroundColor = currentTheme?.loadingTrackColor ?? UIColor.white.withAlphaComponent(0.15)
        loadingTrack.layer.cornerRadius = 2
        loadingTrack.clipsToBounds = true
        loadingTrack.translatesAutoresizingMaskIntoConstraints = false
        loadingTrack.isHidden = true
        view.addSubview(loadingTrack)

        loadingBar = UIView()
        loadingBar.backgroundColor = currentTheme?.loadingBarColor ?? UIColor.white.withAlphaComponent(0.6)
        loadingBar.layer.cornerRadius = 2
        loadingTrack.addSubview(loadingBar)

        NSLayoutConstraint.activate([
            loadingTrack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            loadingTrack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            loadingTrack.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.4),
            loadingTrack.heightAnchor.constraint(equalToConstant: 4),
        ])
    }

    private func setupGestures() {
        // Double-tap to toggle 2x zoom
        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(handleDoubleTap(_:)))
        doubleTap.numberOfTapsRequired = 2
        scrollView.addGestureRecognizer(doubleTap)

        // Single tap for zone detection (left 30% / center 40% / right 30%)
        let singleTap = UITapGestureRecognizer(target: self, action: #selector(handleSingleTap(_:)))
        singleTap.numberOfTapsRequired = 1
        singleTap.require(toFail: doubleTap)
        scrollView.addGestureRecognizer(singleTap)

        // Swipe left/right for page navigation (only when not zoomed)
        let swipeLeft = UISwipeGestureRecognizer(target: self, action: #selector(handleSwipeLeft))
        swipeLeft.direction = .left
        swipeLeft.delegate = self
        scrollView.addGestureRecognizer(swipeLeft)

        let swipeRight = UISwipeGestureRecognizer(target: self, action: #selector(handleSwipeRight))
        swipeRight.direction = .right
        swipeRight.delegate = self
        scrollView.addGestureRecognizer(swipeRight)
    }

    // MARK: - Gesture Handlers

    @objc private func handleSingleTap(_ gesture: UITapGestureRecognizer) {
        let location = gesture.location(in: view)
        let width = view.bounds.width

        // In guided view the left/right halves step through panels; the small
        // center strip still surfaces chrome (so users can toggle off).
        if engine.guidedViewEnabled {
            let leftZone = width * 0.4
            let rightZone = width * 0.6
            if location.x < leftZone {
                if engine.goPreviousPanel() {
                    applyGuidedView(currentPanel: engine.currentPanel)
                } else {
                    Task { await engine.goBackward() }
                }
                return
            } else if location.x > rightZone {
                if engine.goNextPanel() {
                    applyGuidedView(currentPanel: engine.currentPanel)
                } else {
                    Task { await engine.goForward() }
                }
                return
            } else {
                engine.onCenterTap?()
                return
            }
        }

        guard !isZoomed else { return }
        if location.x < width * 0.3 {
            Task { await engine.goBackward() }
        } else if location.x > width * 0.7 {
            Task { await engine.goForward() }
        } else {
            engine.onCenterTap?()
        }
    }

    // MARK: - Guided View

    /// Zoom-and-pan so the current panel exactly fills the device's safe-area
    /// region (between the notch and the home indicator), with a small
    /// breathing margin. Also refreshes the visible panel-outline overlay.
    func applyGuidedView(currentPanel: Int) {
        if !engine.guidedViewEnabled {
            updatePanelOverlay()  // hide
            scrollView.setZoomScale(1.0, animated: true)
            return
        }
        // Update the outline overlay so it tracks the current panel.
        updatePanelOverlay()

        let rect = panelRect(forPanel: currentPanel, in: contentView.bounds, twoPage: isTwoPageMode)
        guard rect.width > 1, rect.height > 1 else { return }

        // We want the panel to fit inside the safe area (not the full
        // scrollView bounds). `scrollView.zoom(to:)` fits its argument to the
        // FULL bounds, so we hand it a synthetic "padded rect" whose padding
        // matches the safe-area insets — when iOS zooms it into the bounds,
        // the panel itself lands in the safe-area visible region.
        let bounds = scrollView.bounds
        let insets = view.safeAreaInsets
        let safeW = max(1, bounds.width - insets.left - insets.right)
        let safeH = max(1, bounds.height - insets.top - insets.bottom)

        // Small breathing margin so the panel doesn't kiss the safe-area edge.
        let breathing: CGFloat = 8
        let baseRect = rect.insetBy(dx: -breathing, dy: -breathing)

        // Required zoom to fit the panel inside the safe area.
        let targetZoom = min(safeW / baseRect.width, safeH / baseRect.height)
        let clampedZoom = max(scrollView.minimumZoomScale,
                              min(scrollView.maximumZoomScale, targetZoom))

        // The padded rect spans the full scrollView bounds at that zoom level.
        let paddedW = bounds.width / clampedZoom
        let paddedH = bounds.height / clampedZoom

        // Asymmetric safe-area offset (e.g. notch is taller than the home
        // indicator) — shift the centre so the panel ends up in the visible
        // sweet spot instead of being half-covered by the notch.
        let asymX = (insets.left - insets.right) / 2 / clampedZoom
        let asymY = (insets.top - insets.bottom) / 2 / clampedZoom

        let paddedRect = CGRect(
            x: baseRect.midX - paddedW / 2 + asymX,
            y: baseRect.midY - paddedH / 2 + asymY,
            width: paddedW,
            height: paddedH
        )

        // Custom animation: UIScrollView.zoom(to:animated:) uses a fixed,
        // slightly stiff curve. Setting zoomScale + contentOffset inside a
        // UIView.animate block lets us pick a smoother curve and duration,
        // making panel-to-panel transitions feel cinematic. .beginFromCurrentState
        // is critical so rapid taps don't fight each other mid-animation.
        let targetOffset = CGPoint(
            x: paddedRect.minX * clampedZoom,
            y: paddedRect.minY * clampedZoom
        )
        UIView.animate(
            withDuration: 0.55,
            delay: 0,
            options: [.curveEaseInOut, .beginFromCurrentState, .allowUserInteraction],
            animations: {
                self.scrollView.zoomScale = clampedZoom
                self.scrollView.contentOffset = targetOffset
            }
        )
    }

    /// Returns the rect for the given panel index in contentView coordinates.
    /// Prefers detected panels when available; falls back to a 2×3 heuristic
    /// grid otherwise. The rect is the FULL panel frame — outline + zoom both
    /// use it directly so the highlight hugs the gutter edge.
    ///
    /// Normalized detector coords are mapped into the IMAGE's visible rect
    /// inside the imageView (which is letterboxed via .scaleAspectFit) — NOT
    /// to contentView.bounds directly, otherwise the rect drifts into the
    /// letterbox bars.
    private func panelRect(forPanel index: Int, in bounds: CGRect, twoPage: Bool) -> CGRect {
        // Detected-panel path
        let leftDetected = engine.detectedPanels
        let rightDetected = engine.detectedPanelsRight
        if !leftDetected.isEmpty || !rightDetected.isEmpty {
            if twoPage {
                if index < leftDetected.count {
                    let n = leftDetected[index]
                    let pageRect = imageRect(for: leftImageView)
                    return mapNormalized(n, into: pageRect)
                } else {
                    let rightIndex = index - leftDetected.count
                    guard rightIndex >= 0, rightIndex < rightDetected.count,
                          let rightImageView else {
                        return heuristicPanelRect(forPanel: index, in: bounds, twoPage: twoPage)
                    }
                    let n = rightDetected[rightIndex]
                    let pageRect = imageRect(for: rightImageView)
                    return mapNormalized(n, into: pageRect)
                }
            } else {
                guard index >= 0, index < leftDetected.count else {
                    return heuristicPanelRect(forPanel: index, in: bounds, twoPage: twoPage)
                }
                let n = leftDetected[index]
                let pageRect = imageRect(for: leftImageView)
                return mapNormalized(n, into: pageRect)
            }
        }

        // Heuristic fallback while detection runs
        return heuristicPanelRect(forPanel: index, in: bounds, twoPage: twoPage)
    }

    /// The image's actual visible rect inside its imageView, accounting for
    /// .scaleAspectFit letterboxing. Returns the imageView's frame if there's
    /// no image yet (rect coordinates are still relative to contentView).
    private func imageRect(for imageView: UIImageView) -> CGRect {
        guard let image = imageView.image else { return imageView.frame }
        let containerSize = imageView.bounds.size
        let imageSize = image.size
        guard containerSize.width > 0, containerSize.height > 0,
              imageSize.width > 0, imageSize.height > 0 else {
            return imageView.frame
        }
        let scale = min(containerSize.width / imageSize.width,
                        containerSize.height / imageSize.height)
        let displayed = CGSize(width: imageSize.width * scale,
                               height: imageSize.height * scale)
        let origin = CGPoint(
            x: imageView.frame.minX + (containerSize.width - displayed.width) / 2,
            y: imageView.frame.minY + (containerSize.height - displayed.height) / 2
        )
        return CGRect(origin: origin, size: displayed)
    }

    private func mapNormalized(_ n: CGRect, into rect: CGRect) -> CGRect {
        CGRect(
            x: rect.minX + n.minX * rect.width,
            y: rect.minY + n.minY * rect.height,
            width: n.width * rect.width,
            height: n.height * rect.height
        )
    }

    /// Iterate every panel rect in the order the overlay renders them.
    /// Counts are based on what's actually being rendered (`twoPage`), not on
    /// `engine.panelsPerPage` — those can disagree when landscape fit-to-width
    /// shows a single page while the engine still has a two-page spread state.
    private func allPanelRects(in bounds: CGRect, twoPage: Bool) -> [CGRect] {
        let leftCount = engine.detectedPanels.isEmpty ? 6 : engine.detectedPanels.count
        let rightCount = twoPage
            ? (engine.detectedPanelsRight.isEmpty ? 6 : engine.detectedPanelsRight.count)
            : 0
        let count = leftCount + rightCount
        var rects: [CGRect] = []
        for i in 0..<count {
            rects.append(panelRect(forPanel: i, in: bounds, twoPage: twoPage))
        }
        return rects
    }

    /// 2×3 heuristic panel grid — fallback when detection hasn't run yet or
    /// returned no usable rects. Reads the left page panels 0–5 then (in
    /// two-page mode) right page panels 6–11.
    private func heuristicPanelRect(forPanel index: Int, in bounds: CGRect, twoPage: Bool) -> CGRect {
        let rows = 3
        let cols = 2
        let perPage = rows * cols  // 6
        let panel = max(0, index)

        let pageRect: CGRect
        if twoPage {
            let half = bounds.width / 2
            if panel < perPage {
                pageRect = CGRect(x: bounds.minX, y: bounds.minY, width: half, height: bounds.height)
            } else {
                pageRect = CGRect(x: bounds.minX + half, y: bounds.minY, width: half, height: bounds.height)
            }
        } else {
            pageRect = bounds
        }

        let localIndex = panel % perPage
        let row = localIndex / cols
        let col = localIndex % cols
        let panelW = pageRect.width / CGFloat(cols)
        let panelH = pageRect.height / CGFloat(rows)
        return CGRect(
            x: pageRect.minX + CGFloat(col) * panelW,
            y: pageRect.minY + CGFloat(row) * panelH,
            width: panelW,
            height: panelH
        )
    }

    /// Called by the engine once panel detection completes (or fails) for
    /// the current page. Refreshes the overlay and re-applies guided zoom.
    func panelDetectionDidUpdate() {
        updatePanelOverlay()
        if engine.guidedViewEnabled {
            applyGuidedView(currentPanel: engine.currentPanel)
        }
    }

    @objc private func handleDoubleTap(_ gesture: UITapGestureRecognizer) {
        if isZoomed {
            scrollView.setZoomScale(1.0, animated: true)
        } else {
            let point = gesture.location(in: contentView)
            let zoomRect = zoomRectForScale(2.0, center: point)
            scrollView.zoom(to: zoomRect, animated: true)
        }
    }

    @objc private func handleSwipeLeft() {
        guard !isZoomed else { return }
        Task { await engine.goForward() }
    }

    @objc private func handleSwipeRight() {
        guard !isZoomed else { return }
        Task { await engine.goBackward() }
    }

    // MARK: - Display

    func displayPages(left: UIImage?, right: UIImage?) {
        // Reset zoom on page change
        scrollView.setZoomScale(1.0, animated: false)

        if left == nil && right == nil {
            showLoading()
        } else {
            hideLoading()
        }

        leftImageView.image = left
        rightImageView?.image = right

        layoutContentView()

        // Re-apply guided view zoom for the new page's current panel.
        if engine.guidedViewEnabled {
            // Defer until after layout settles so contentView.bounds is final.
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.applyGuidedView(currentPanel: self.engine.currentPanel)
            }
        }
    }

    private func showLoading() {
        isLoadingVisible = true
        loadingTrack.isHidden = false
        startLoadingAnimationIfNeeded()
    }

    private func hideLoading() {
        isLoadingVisible = false
        loadingTrack.isHidden = true
        loadingBar.layer.removeAllAnimations()
    }

    /// Starts the sliding bar animation once the track has a real width from Auto Layout.
    /// Called from showLoading() and viewDidLayoutSubviews().
    private func startLoadingAnimationIfNeeded() {
        guard isLoadingVisible else { return }
        let trackWidth = loadingTrack.bounds.width
        guard trackWidth > 0 else { return }
        // Don't restart if already animating
        guard loadingBar.layer.animation(forKey: "indeterminate") == nil else { return }

        let barWidth = trackWidth * 0.3
        loadingBar.frame = CGRect(x: -barWidth, y: 0, width: barWidth, height: 4)

        let anim = CABasicAnimation(keyPath: "position.x")
        anim.fromValue = -barWidth / 2
        anim.toValue = trackWidth + barWidth / 2
        anim.duration = 1.0
        anim.repeatCount = .infinity
        anim.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        loadingBar.layer.add(anim, forKey: "indeterminate")
    }

    func updateLayout(pagesPerSpread: Int) {
        let wantsTwoPage = pagesPerSpread == 2
        guard wantsTwoPage != isTwoPageMode else { return }
        isTwoPageMode = wantsTwoPage

        if isTwoPageMode {
            let rightView = UIImageView()
            rightView.contentMode = .scaleAspectFit
            rightView.clipsToBounds = true
            contentView.addSubview(rightView)
            self.rightImageView = rightView

            let gutter = UIView()
            gutter.backgroundColor = .clear
            contentView.addSubview(gutter)
            self.gutterView = gutter
        } else {
            rightImageView?.removeFromSuperview()
            rightImageView = nil
            gutterView?.removeFromSuperview()
            gutterView = nil
        }

        layoutContentView()
    }

    private(set) var currentTheme: ReaderTheme?

    func applyTheme(_ theme: ReaderTheme) {
        currentTheme = theme
        view.backgroundColor = theme.backgroundColor
        scrollView.backgroundColor = theme.backgroundColor
        loadingTrack.backgroundColor = theme.loadingTrackColor
        loadingBar.backgroundColor = theme.loadingBarColor
    }

    // MARK: - Layout

    private func layoutContentView() {
        let bounds = view.bounds
        guard bounds.width > 0 && bounds.height > 0 else { return }

        // Tell the engine about orientation so it can split-or-not-split wide
        // panels appropriately. (Setter is no-op if value unchanged.)
        engine.isLandscape = bounds.width > bounds.height

        if isTwoPageMode {
            contentView.frame = bounds
            scrollView.contentSize = bounds.size
            let pageWidth = (bounds.width - gutterWidth) / 2
            leftImageView.frame = CGRect(x: 0, y: 0, width: pageWidth, height: bounds.height)
            gutterView?.frame = CGRect(x: pageWidth, y: 0, width: gutterWidth, height: bounds.height)
            rightImageView?.frame = CGRect(x: pageWidth + gutterWidth, y: 0, width: pageWidth, height: bounds.height)
        } else if bounds.width > bounds.height,
                  let img = leftImageView.image,
                  img.size.width > 0 {
            // Landscape single-page: fit-to-width with vertical scroll. The
            // page renders large (taller than the screen) so panels are
            // readable; the user pans vertically through the page.
            let aspect = img.size.height / img.size.width
            let contentHeight = bounds.width * aspect
            contentView.frame = CGRect(x: 0, y: 0, width: bounds.width, height: contentHeight)
            scrollView.contentSize = CGSize(width: bounds.width, height: contentHeight)
            leftImageView.frame = contentView.bounds
        } else {
            // Portrait or no image yet: aspect-fit inside the viewport.
            contentView.frame = bounds
            scrollView.contentSize = bounds.size
            leftImageView.frame = bounds
        }

        // Keep panel outlines aligned with the new content bounds.
        updatePanelOverlay()
    }

    private func zoomRectForScale(_ scale: CGFloat, center: CGPoint) -> CGRect {
        let size = CGSize(
            width: scrollView.bounds.width / scale,
            height: scrollView.bounds.height / scale
        )
        return CGRect(
            x: center.x - size.width / 2,
            y: center.y - size.height / 2,
            width: size.width,
            height: size.height
        )
    }
}

// MARK: - UIScrollViewDelegate

extension ComicPageViewController: UIScrollViewDelegate {
    func viewForZooming(in scrollView: UIScrollView) -> UIView? {
        contentView
    }

    func scrollViewDidZoom(_ scrollView: UIScrollView) {
        // Center content when smaller than scroll view
        let offsetX = max((scrollView.bounds.width - scrollView.contentSize.width) / 2, 0)
        let offsetY = max((scrollView.bounds.height - scrollView.contentSize.height) / 2, 0)
        contentView.center = CGPoint(
            x: scrollView.contentSize.width / 2 + offsetX,
            y: scrollView.contentSize.height / 2 + offsetY
        )
        // Surface zoom to the engine so the reader bottom bar can show a chip.
        engine.setZoomScale(scrollView.zoomScale)
    }

    /// Reset zoom to fit; called from the reader's bottom bar.
    func resetZoom(animated: Bool) {
        scrollView.setZoomScale(1.0, animated: animated)
    }
}

// MARK: - UIGestureRecognizerDelegate

extension ComicPageViewController: UIGestureRecognizerDelegate {
    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        if gestureRecognizer is UISwipeGestureRecognizer {
            return !isZoomed
        }
        return true
    }
}
