//
//  PDFEngine.swift
//  Compendus
//
//  ReaderEngine implementation for PDF files using native PDFKit.
//  Extracted from the original PDFReaderView.swift.
//

import UIKit
import PDFKit

@Observable
@MainActor
class PDFEngine: ReaderEngine {
    var currentLocation: ReaderLocation?
    var totalPositions: Int = 0
    var isReady: Bool = false
    var errorMessage: String?
    var isPDF: Bool { true }

    var onSelectionChanged: ((ReaderSelection?) -> Void)?
    var onHighlightTapped: ((String) -> Void)?
    var onCenterTap: (() -> Void)?

    private(set) var pdfDocument: PDFDocument?
    private var pdfView: PDFView?
    private let bookURL: URL
    private(set) var currentPage: Int = 0

    init(bookURL: URL) {
        self.bookURL = bookURL
    }

    // MARK: - Loading

    func load(initialPage: Int? = nil) {
        guard let document = PDFDocument(url: bookURL) else {
            errorMessage = "Could not open the PDF file"
            return
        }
        pdfDocument = document
        totalPositions = document.pageCount
        if let page = initialPage {
            currentPage = min(page, max(0, totalPositions - 1))
        }
        updateLocation()
        isReady = true
    }

    // MARK: - ReaderEngine Protocol

    func makeViewController() -> UIViewController {
        let vc = PDFViewHostController(engine: self)
        return vc
    }

    func goForward() async {
        if currentPage < totalPositions - 1 {
            currentPage += 1
            navigateToCurrentPage()
            updateLocation()
        }
    }

    func goBackward() async {
        if currentPage > 0 {
            currentPage -= 1
            navigateToCurrentPage()
            updateLocation()
        }
    }

    func go(to location: ReaderLocation) async {
        if let pageIndex = location.pageIndex {
            currentPage = min(max(0, pageIndex), totalPositions - 1)
            navigateToCurrentPage()
            updateLocation()
        }
    }

    func go(toProgression progression: Double) async {
        let page = Int(progression * Double(totalPositions))
        currentPage = min(max(0, page), totalPositions - 1)
        navigateToCurrentPage()
        updateLocation()
    }

    func tableOfContents() async -> [TOCItem] {
        guard let document = pdfDocument,
              let outline = document.outlineRoot else { return [] }
        return parseOutline(outline, level: 0)
    }

    func applyHighlights(_ highlights: [BookHighlight]) {
        guard let document = pdfDocument else { return }

        // Clear existing custom annotations
        removeAllHighlightAnnotations(from: document)

        // Apply new highlights
        for highlight in highlights {
            applyHighlightAnnotation(highlight, to: document)
        }
    }

    func clearSelection() {
        pdfView?.clearSelection()
    }

    func applySettings(_ settings: ReaderSettings) {
        pdfView?.backgroundColor = settings.theme.backgroundColor
    }

    func serializeLocation() -> String? {
        return String(currentPage)
    }

    // MARK: - PDF View Management

    func setPDFView(_ view: PDFView) {
        self.pdfView = view
    }

    func setCurrentPage(_ page: Int) {
        guard page != currentPage else { return }
        currentPage = page
        updateLocation()
    }

    private func navigateToCurrentPage() {
        guard let document = pdfDocument,
              let page = document.page(at: currentPage) else { return }
        pdfView?.go(to: page)
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

    // MARK: - Outline Parsing

    private func parseOutline(_ outline: PDFOutline, level: Int) -> [TOCItem] {
        var items: [TOCItem] = []
        for i in 0..<outline.numberOfChildren {
            guard let child = outline.child(at: i) else { continue }
            let page = child.destination?.page
            let pageIndex = page.flatMap { pdfDocument?.index(for: $0) }
            let prog = pageIndex.map { Double($0) / Double(max(1, totalPositions)) } ?? 0

            items.append(TOCItem(
                id: "\(level)-\(i)",
                title: child.label ?? "Section \(i + 1)",
                location: ReaderLocation(
                    href: nil,
                    pageIndex: pageIndex,
                    progression: prog,
                    totalProgression: prog,
                    title: child.label
                ),
                level: level,
                children: parseOutline(child, level: level + 1)
            ))
        }
        return items
    }

    // MARK: - Highlight Annotations

    func saveHighlightFromSelection(color: String, note: String? = nil) -> (text: String, locatorJSON: String, progression: Double, chapterTitle: String)? {
        guard let pdfView = pdfView,
              let selection = pdfView.currentSelection,
              let text = selection.string, !text.isEmpty else { return nil }

        // Build annotation data for each line
        var annotationData: [[String: Any]] = []
        let lineSelections = selection.selectionsByLine()

        for lineSelection in lineSelections {
            for page in lineSelection.pages {
                let bounds = lineSelection.bounds(for: page)
                guard let document = pdfView.document else { continue }
                let pageIndex = document.index(for: page)
                guard pageIndex != NSNotFound else { continue }

                annotationData.append([
                    "pageIndex": pageIndex,
                    "x": bounds.origin.x,
                    "y": bounds.origin.y,
                    "width": bounds.size.width,
                    "height": bounds.size.height,
                ])

                // Create colored bar annotation above text
                let barHeight: CGFloat = 4
                let barBounds = CGRect(
                    x: bounds.origin.x,
                    y: bounds.maxY,
                    width: bounds.size.width,
                    height: barHeight
                )
                let annotation = PDFAnnotation(bounds: barBounds, forType: .highlight, withProperties: nil)
                annotation.color = (UIColor(hex: color) ?? .yellow).withAlphaComponent(0.7)
                page.addAnnotation(annotation)
            }
        }

        // Determine primary page
        let primaryPageIndex: Int
        if let firstPage = lineSelections.first?.pages.first,
           let document = pdfView.document {
            primaryPageIndex = document.index(for: firstPage)
        } else {
            primaryPageIndex = currentPage
        }

        let locatorDict: [String: Any] = [
            "format": "pdf",
            "annotations": annotationData,
        ]

        guard let locatorData = try? JSONSerialization.data(withJSONObject: locatorDict),
              let locatorJSON = String(data: locatorData, encoding: .utf8) else { return nil }

        let progression = totalPositions > 0 ? Double(primaryPageIndex) / Double(totalPositions) : 0

        pdfView.clearSelection()

        return (
            text: text,
            locatorJSON: locatorJSON,
            progression: progression,
            chapterTitle: "Page \(primaryPageIndex + 1)"
        )
    }

    private func applyHighlightAnnotation(_ highlight: BookHighlight, to document: PDFDocument) {
        guard let data = highlight.locatorJSON.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let annotations = json["annotations"] as? [[String: Any]] else { return }

        for annotationInfo in annotations {
            guard let pageIndex = annotationInfo["pageIndex"] as? Int,
                  let x = annotationInfo["x"] as? Double,
                  let y = annotationInfo["y"] as? Double,
                  let width = annotationInfo["width"] as? Double,
                  let height = annotationInfo["height"] as? Double,
                  let page = document.page(at: pageIndex) else { continue }

            let barHeight: CGFloat = 4
            let barBounds = CGRect(x: x, y: y + height, width: width, height: barHeight)
            let annotation = PDFAnnotation(bounds: barBounds, forType: .highlight, withProperties: nil)
            annotation.color = highlight.uiColor.withAlphaComponent(0.7)
            annotation.setValue(highlight.id, forAnnotationKey: PDFAnnotationKey(rawValue: "highlightId"))
            page.addAnnotation(annotation)
        }
    }

    func deleteHighlightAnnotations(for highlight: BookHighlight) {
        guard let document = pdfDocument,
              let data = highlight.locatorJSON.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let annotations = json["annotations"] as? [[String: Any]] else { return }

        for annotationInfo in annotations {
            guard let pageIndex = annotationInfo["pageIndex"] as? Int,
                  let page = document.page(at: pageIndex) else { continue }

            for annotation in page.annotations {
                if annotation.type == "Highlight",
                   let storedId = annotation.value(forAnnotationKey: PDFAnnotationKey(rawValue: "highlightId")) as? String,
                   storedId == highlight.id {
                    page.removeAnnotation(annotation)
                }
            }
        }
    }

    func updateAnnotationColor(for highlight: BookHighlight, color: String) {
        guard let document = pdfDocument,
              let data = highlight.locatorJSON.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let annotations = json["annotations"] as? [[String: Any]] else { return }

        let newColor = (UIColor(hex: color) ?? .yellow).withAlphaComponent(0.7)

        for annotationInfo in annotations {
            guard let pageIndex = annotationInfo["pageIndex"] as? Int,
                  let page = document.page(at: pageIndex) else { continue }

            for annotation in page.annotations {
                if annotation.type == "Highlight",
                   let storedId = annotation.value(forAnnotationKey: PDFAnnotationKey(rawValue: "highlightId")) as? String,
                   storedId == highlight.id {
                    annotation.color = newColor
                }
            }
        }
    }

    private func removeAllHighlightAnnotations(from document: PDFDocument) {
        for i in 0..<document.pageCount {
            guard let page = document.page(at: i) else { continue }
            let toRemove = page.annotations.filter { annotation in
                annotation.type == "Highlight" &&
                annotation.value(forAnnotationKey: PDFAnnotationKey(rawValue: "highlightId")) is String
            }
            toRemove.forEach { page.removeAnnotation($0) }
        }
    }

    func navigateToHighlight(_ highlight: BookHighlight) {
        guard let data = highlight.locatorJSON.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let annotations = json["annotations"] as? [[String: Any]],
              let firstAnnotation = annotations.first,
              let pageIndex = firstAnnotation["pageIndex"] as? Int else { return }

        currentPage = pageIndex
        navigateToCurrentPage()
        updateLocation()
    }
}

// MARK: - PDF View Host Controller

/// UIViewController that hosts a PDFView and bridges events to PDFEngine
@MainActor
class PDFViewHostController: UIViewController, UIGestureRecognizerDelegate {
    let engine: PDFEngine
    private var pdfView: PDFView!

    init(engine: PDFEngine) {
        self.engine = engine
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        let pdfView = PDFView(frame: view.bounds)
        pdfView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        pdfView.document = engine.pdfDocument
        pdfView.autoScales = true
        pdfView.displayMode = .singlePage
        pdfView.displayDirection = .horizontal
        pdfView.usePageViewController(true)
        pdfView.backgroundColor = .systemBackground

        // Set initial page
        if let page = engine.pdfDocument?.page(at: engine.currentPage) {
            pdfView.go(to: page)
        }

        view.addSubview(pdfView)
        self.pdfView = pdfView
        engine.setPDFView(pdfView)

        // Observe page changes
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(pageChanged(_:)),
            name: .PDFViewPageChanged,
            object: pdfView
        )

        // Observe selection changes
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(selectionChanged(_:)),
            name: .PDFViewSelectionChanged,
            object: pdfView
        )

        // Tap gesture for annotation detection
        let tapGesture = UITapGestureRecognizer(target: self, action: #selector(handleAnnotationTap(_:)))
        tapGesture.delegate = self
        pdfView.addGestureRecognizer(tapGesture)
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        true
    }

    @objc private func handleAnnotationTap(_ gesture: UITapGestureRecognizer) {
        let location = gesture.location(in: pdfView)
        guard let page = pdfView.page(for: location, nearest: false) else {
            engine.onCenterTap?()
            return
        }
        let pagePoint = pdfView.convert(location, to: page)

        for annotation in page.annotations where annotation.type == "Highlight" {
            let hitBounds = annotation.bounds.insetBy(dx: 0, dy: -8)
            if hitBounds.contains(pagePoint),
               let highlightId = annotation.value(forAnnotationKey: PDFAnnotationKey(rawValue: "highlightId")) as? String {
                engine.onHighlightTapped?(highlightId)
                return
            }
        }

        // No annotation hit — toggle overlay
        engine.onCenterTap?()
    }

    @objc private func pageChanged(_ notification: Notification) {
        guard let pdfView = notification.object as? PDFView,
              let currentPage = pdfView.currentPage,
              let document = pdfView.document else { return }

        let pageIndex = document.index(for: currentPage)
        guard pageIndex != NSNotFound else { return }

        DispatchQueue.main.async { [weak self] in
            self?.engine.setCurrentPage(pageIndex)
        }
    }

    @objc private func selectionChanged(_ notification: Notification) {
        guard let pdfView = notification.object as? PDFView else { return }
        let selection = pdfView.currentSelection
        let hasSelection = selection?.string?.isEmpty == false

        if !hasSelection {
            DispatchQueue.main.async { [weak self] in
                self?.engine.onSelectionChanged?(nil)
            }
            return
        }

        guard let sel = selection else { return }
        let text = sel.string ?? ""

        var frame: CGRect? = nil
        let lines = sel.selectionsByLine()
        if let firstLine = lines.first, let page = firstLine.pages.first {
            let pageBounds = firstLine.bounds(for: page)
            frame = pdfView.convert(pageBounds, from: page)
        }

        // Build locator-compatible info (for display purposes; actual save uses engine method)
        let readerSelection = ReaderSelection(
            text: text,
            locationJSON: "{}",
            frame: frame
        )

        DispatchQueue.main.async { [weak self] in
            self?.engine.onSelectionChanged?(readerSelection)
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}
