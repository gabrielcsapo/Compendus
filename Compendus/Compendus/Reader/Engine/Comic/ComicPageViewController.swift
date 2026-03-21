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
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        guard hasAppeared else { return }

        scrollView.frame = view.bounds
        layoutContentView()

        // Start the loading animation once Auto Layout gives the track a real width
        startLoadingAnimationIfNeeded()

        // Notify engine of viewport size for spread mode auto-detection
        if let settings = engine.currentSettings {
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
        guard !isZoomed else { return }
        let location = gesture.location(in: view)
        let width = view.bounds.width

        if location.x < width * 0.3 {
            Task { await engine.goBackward() }
        } else if location.x > width * 0.7 {
            Task { await engine.goForward() }
        } else {
            engine.onCenterTap?()
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

        contentView.frame = bounds
        scrollView.contentSize = bounds.size

        if isTwoPageMode {
            let pageWidth = (bounds.width - gutterWidth) / 2
            leftImageView.frame = CGRect(x: 0, y: 0, width: pageWidth, height: bounds.height)
            gutterView?.frame = CGRect(x: pageWidth, y: 0, width: gutterWidth, height: bounds.height)
            rightImageView?.frame = CGRect(x: pageWidth + gutterWidth, y: 0, width: pageWidth, height: bounds.height)
        } else {
            leftImageView.frame = bounds
        }
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
