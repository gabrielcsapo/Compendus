//
//  PDFReaderView.swift
//  Compendus
//
//  PDF reader using native PDFKit with highlighting support
//

import SwiftUI
import SwiftData
import PDFKit

struct PDFReaderView: View {
    let book: DownloadedBook

    @Environment(\.modelContext) private var modelContext
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(ReaderSettings.self) private var readerSettings

    @State private var pdfDocument: PDFDocument?
    @State private var showingSettings = false
    @State private var currentPage: Int = 0
    @State private var totalPages: Int = 0
    @State private var showingControls = false
    @State private var showingThumbnails = false
    @State private var errorMessage: String?
    @State private var brightness: Double = Double(UIScreen.main.brightness)
    @State private var originalBrightness: Double = Double(UIScreen.main.brightness)

    // Highlighting state
    @State private var highlights: [BookHighlight] = []
    @State private var hasTextSelection = false
    @State private var showingFloatingToolbar = false
    @State private var showingCustomColorPicker = false
    @State private var customColor: Color = .yellow
    @State private var selectionFrame: CGRect?
    @State private var showingHighlights = false
    @State private var pdfViewReference: PDFView?

    // Note input state
    @State private var showingNoteInput = false
    @State private var noteInputText = ""
    @State private var noteInputColor = "#ffff00"
    @State private var pendingHighlightText = ""
    @State private var editingHighlight: BookHighlight?
    @State private var tappedHighlight: BookHighlight?

    var body: some View {
        Group {
            if let error = errorMessage {
                ContentUnavailableView {
                    Label("Error", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                }
            } else if let document = pdfDocument {
                GeometryReader { geometry in
                    ZStack {
                        PDFKitView(
                            document: document,
                            currentPage: $currentPage,
                            backgroundColor: readerSettings.theme.backgroundColor,
                            onSelectionChanged: { hasSelection, frame in
                                hasTextSelection = hasSelection
                                selectionFrame = frame
                                if hasSelection {
                                    showingFloatingToolbar = true
                                } else {
                                    showingFloatingToolbar = false
                                }
                            },
                            onPDFViewCreated: { pdfView in
                                pdfViewReference = pdfView
                            },
                            onAnnotationTapped: { highlightId in
                                if let highlight = highlights.first(where: { $0.id == highlightId }) {
                                    tappedHighlight = highlight
                                }
                            }
                        )
                        .ignoresSafeArea(edges: .bottom)

                        // Controls overlay
                        VStack(spacing: 0) {
                            Spacer()

                            // Thumbnail scrubber
                            if showingThumbnails {
                                PDFThumbnailScrubber(
                                    document: document,
                                    currentPage: $currentPage
                                )
                                .transition(.move(edge: .bottom).combined(with: .opacity))
                            }

                            // Main controls
                            if showingControls {
                                controlsOverlay
                                    .transition(.move(edge: .bottom).combined(with: .opacity))
                            }

                            // Page indicator (always visible when controls shown)
                            if showingControls || !showingThumbnails {
                                pageIndicator
                            }
                        }

                        // Floating highlight toolbar
                        if showingFloatingToolbar, let frame = selectionFrame {
                            FloatingHighlightToolbar(
                                selectionRect: frame,
                                containerSize: geometry.size,
                                onSelectColor: { color in
                                    saveHighlight(color: color)
                                    showingFloatingToolbar = false
                                },
                                onCustomColor: {
                                    showingCustomColorPicker = true
                                },
                                onAddNote: {
                                    // Capture selected text before dismissing toolbar
                                    pendingHighlightText = pdfViewReference?.currentSelection?.string ?? ""
                                    showingFloatingToolbar = false
                                    noteInputText = ""
                                    noteInputColor = "#ffff00"
                                    showingNoteInput = true
                                },
                                onCopy: {
                                    let text = pdfViewReference?.currentSelection?.string ?? ""
                                    UIPasteboard.general.string = text
                                    pdfViewReference?.clearSelection()
                                    hasTextSelection = false
                                    showingFloatingToolbar = false
                                },
                                onDismiss: {
                                    pdfViewReference?.clearSelection()
                                    hasTextSelection = false
                                    showingFloatingToolbar = false
                                }
                            )
                        }
                    }
                    .onTapGesture { location in
                        let width = UIScreen.main.bounds.width
                        if location.x < width * 0.3 {
                            if currentPage > 0 {
                                currentPage -= 1
                            }
                        } else if location.x > width * 0.7 {
                            if currentPage < totalPages - 1 {
                                currentPage += 1
                            }
                        } else {
                            withAnimation(reduceMotion ? .none : .spring(response: 0.35, dampingFraction: 0.8)) {
                                showingControls.toggle()
                                if !showingControls {
                                    showingThumbnails = false
                                }
                            }
                        }
                    }
                }
            } else {
                ProgressView("Loading PDF...")
            }
        }
        .navigationTitle(book.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if pdfDocument != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: 12) {
                        Button {
                            showingSettings = true
                        } label: {
                            Image(systemName: "textformat.size")
                        }

                        Button {
                            showingHighlights = true
                        } label: {
                            Image(systemName: "highlighter")
                        }
                    }
                }
            }
        }
        .task {
            loadPDF()
        }
        .onChange(of: currentPage) { _, newValue in
            saveProgress(page: newValue)
        }
        .onDisappear {
            UIScreen.main.brightness = CGFloat(originalBrightness)
        }
        .sheet(isPresented: $showingSettings) {
            ReaderSettingsView(format: .pdf)
        }
        .sheet(isPresented: $showingCustomColorPicker) {
            NavigationStack {
                VStack(spacing: 20) {
                    ColorPicker("Choose a color", selection: $customColor, supportsOpacity: false)
                        .labelsHidden()
                        .scaleEffect(2)
                        .padding(.top, 40)

                    Spacer()

                    Button {
                        let uiColor = UIColor(customColor)
                        let hex = uiColor.hexString
                        saveHighlight(color: hex)
                        showingFloatingToolbar = false
                        showingCustomColorPicker = false
                    } label: {
                        Text("Highlight")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(customColor)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .padding(.horizontal)
                    .padding(.bottom)
                }
                .navigationTitle("Custom Color")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Cancel") {
                            showingCustomColorPicker = false
                        }
                    }
                }
            }
            .presentationDetents([.medium])
        }
        .sheet(isPresented: $showingHighlights) {
            PDFHighlightsView(
                highlights: highlights,
                onSelect: { highlight in
                    navigateToHighlight(highlight)
                    showingHighlights = false
                },
                onDelete: { highlight in
                    deleteHighlight(highlight)
                },
                onEditNote: { highlight in
                    showingHighlights = false
                    editingHighlight = highlight
                }
            )
        }
        .sheet(isPresented: $showingNoteInput) {
            HighlightNoteEditor(
                highlightText: pendingHighlightText,
                note: $noteInputText,
                selectedColor: $noteInputColor,
                onSave: {
                    let trimmedNote = noteInputText.trimmingCharacters(in: .whitespacesAndNewlines)
                    saveHighlight(color: noteInputColor, note: trimmedNote.isEmpty ? nil : trimmedNote)
                    showingNoteInput = false
                },
                onCancel: {
                    pdfViewReference?.clearSelection()
                    hasTextSelection = false
                    pendingHighlightText = ""
                    showingNoteInput = false
                }
            )
            .presentationDetents([.medium, .large])
        }
        .sheet(item: $editingHighlight) { highlight in
            EditNoteSheet(highlight: highlight) {
                try? modelContext.save()
                fetchHighlights()
            }
        }
        .sheet(item: $tappedHighlight) { highlight in
            HighlightEditSheet(
                highlight: highlight,
                onChangeColor: { color in
                    highlight.color = color
                    // Update PDF annotations with new color
                    if let document = pdfDocument {
                        updateAnnotationColor(for: highlight, in: document, color: color)
                    }
                    try? modelContext.save()
                    fetchHighlights()
                },
                onSaveNote: { note in
                    highlight.note = note
                    try? modelContext.save()
                    fetchHighlights()
                },
                onCopy: {
                    UIPasteboard.general.string = highlight.text
                },
                onDelete: {
                    deleteHighlight(highlight)
                }
            )
            .presentationDetents([.medium, .large])
        }
    }

    @ViewBuilder
    private var controlsOverlay: some View {
        VStack(spacing: 16) {
            // Brightness control
            HStack(spacing: 12) {
                Image(systemName: "sun.min")
                    .foregroundStyle(.secondary)

                Slider(value: $brightness, in: 0...1)
                    .onChange(of: brightness) { _, newValue in
                        UIScreen.main.brightness = CGFloat(newValue)
                    }

                Image(systemName: "sun.max")
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal)

            // Page slider
            if totalPages > 1 {
                VStack(spacing: 4) {
                    Slider(
                        value: Binding(
                            get: { Double(currentPage) },
                            set: { currentPage = Int($0) }
                        ),
                        in: 0...Double(max(0, totalPages - 1)),
                        step: 1
                    )

                    HStack {
                        Text("1")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text("\(totalPages)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal)
            }

            // Thumbnail toggle button
            Button {
                withAnimation(reduceMotion ? .none : .spring(response: 0.35, dampingFraction: 0.8)) {
                    showingThumbnails.toggle()
                }
            } label: {
                Label(
                    showingThumbnails ? "Hide Thumbnails" : "Show Thumbnails",
                    systemImage: showingThumbnails ? "rectangle.grid.1x2.fill" : "rectangle.grid.1x2"
                )
                .font(.subheadline)
            }
        }
        .padding()
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal)
        .padding(.bottom, 8)
    }

    @ViewBuilder
    private var pageIndicator: some View {
        Text("\(currentPage + 1) / \(totalPages)")
            .font(.subheadline.monospacedDigit())
            .fontWeight(.medium)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(.ultraThinMaterial)
            .clipShape(Capsule())
            .padding(.bottom, 16)
    }

    private func loadPDF() {
        guard let fileURL = book.fileURL else {
            errorMessage = "Could not find the PDF file"
            return
        }

        guard let document = PDFDocument(url: fileURL) else {
            errorMessage = "Could not open the PDF file"
            return
        }

        pdfDocument = document
        totalPages = document.pageCount

        // Restore last position
        if let lastPosition = book.lastPosition, let page = Int(lastPosition) {
            currentPage = min(page, totalPages - 1)
        }

        // Load and apply saved highlights
        fetchHighlights()
        applyHighlightAnnotations(to: document)
    }

    private func saveProgress(page: Int) {
        book.lastPosition = String(page)
        book.readingProgress = totalPages > 0 ? Double(page + 1) / Double(totalPages) : 0
        try? modelContext.save()
    }

    // MARK: - Highlight Methods

    private func fetchHighlights() {
        let bookId = book.id
        let descriptor = FetchDescriptor<BookHighlight>(
            predicate: #Predicate<BookHighlight> { highlight in
                highlight.bookId == bookId
            },
            sortBy: [SortDescriptor(\.createdAt)]
        )
        highlights = (try? modelContext.fetch(descriptor)) ?? []
    }

    private func saveHighlight(color: String, note: String? = nil) {
        guard let pdfView = pdfViewReference,
              let selection = pdfView.currentSelection else { return }

        let text = selection.string ?? ""
        if text.isEmpty { return }

        // Build annotation data for each line of the selection
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

                // Create a thin colored bar above the text line
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

        // Determine page index for progression
        let primaryPageIndex: Int
        if let firstPage = lineSelections.first?.pages.first,
           let document = pdfView.document {
            primaryPageIndex = document.index(for: firstPage)
        } else {
            primaryPageIndex = currentPage
        }

        // Serialize locator data
        let locatorDict: [String: Any] = [
            "type": "pdf",
            "annotations": annotationData,
        ]

        guard let locatorData = try? JSONSerialization.data(withJSONObject: locatorDict),
              let locatorJSON = String(data: locatorData, encoding: .utf8) else { return }

        let highlight = BookHighlight(
            bookId: book.id,
            locatorJSON: locatorJSON,
            text: text,
            note: note,
            color: color,
            progression: totalPages > 0 ? Double(primaryPageIndex) / Double(totalPages) : 0,
            chapterTitle: "Page \(primaryPageIndex + 1)"
        )

        modelContext.insert(highlight)
        try? modelContext.save()

        // Clear selection and refresh
        pdfView.clearSelection()
        hasTextSelection = false
        fetchHighlights()
    }

    private func applyHighlightAnnotations(to document: PDFDocument) {
        for highlight in highlights {
            guard let data = highlight.locatorJSON.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let annotations = json["annotations"] as? [[String: Any]] else { continue }

            for annotationInfo in annotations {
                guard let pageIndex = annotationInfo["pageIndex"] as? Int,
                      let x = annotationInfo["x"] as? Double,
                      let y = annotationInfo["y"] as? Double,
                      let width = annotationInfo["width"] as? Double,
                      let height = annotationInfo["height"] as? Double,
                      let page = document.page(at: pageIndex) else { continue }

                // Create a thin colored bar above the text line
                let barHeight: CGFloat = 4
                let barBounds = CGRect(x: x, y: y + height, width: width, height: barHeight)
                let annotation = PDFAnnotation(bounds: barBounds, forType: .highlight, withProperties: nil)
                annotation.color = highlight.uiColor.withAlphaComponent(0.7)
                annotation.setValue(highlight.id, forAnnotationKey: PDFAnnotationKey(rawValue: "highlightId"))
                page.addAnnotation(annotation)
            }
        }
    }

    private func deleteHighlight(_ highlight: BookHighlight) {
        // Remove annotations from PDF pages
        if let document = pdfDocument,
           let data = highlight.locatorJSON.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let annotations = json["annotations"] as? [[String: Any]] {
            for annotationInfo in annotations {
                guard let pageIndex = annotationInfo["pageIndex"] as? Int,
                      let page = document.page(at: pageIndex) else { continue }

                // Find and remove matching annotation
                for annotation in page.annotations {
                    if annotation.type == "Highlight",
                       let storedId = annotation.value(forAnnotationKey: PDFAnnotationKey(rawValue: "highlightId")) as? String,
                       storedId == highlight.id {
                        page.removeAnnotation(annotation)
                    }
                }
            }
        }

        modelContext.delete(highlight)
        try? modelContext.save()
        fetchHighlights()
    }

    private func updateAnnotationColor(for highlight: BookHighlight, in document: PDFDocument, color: String) {
        guard let data = highlight.locatorJSON.data(using: .utf8),
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

    private func navigateToHighlight(_ highlight: BookHighlight) {
        guard let data = highlight.locatorJSON.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let annotations = json["annotations"] as? [[String: Any]],
              let firstAnnotation = annotations.first,
              let pageIndex = firstAnnotation["pageIndex"] as? Int else { return }

        currentPage = pageIndex
    }
}

// MARK: - PDF Kit View

struct PDFKitView: UIViewRepresentable {
    let document: PDFDocument
    @Binding var currentPage: Int
    var backgroundColor: UIColor = .systemBackground
    var onSelectionChanged: ((Bool, CGRect?) -> Void)?
    var onPDFViewCreated: ((PDFView) -> Void)?
    var onAnnotationTapped: ((String) -> Void)?

    func makeUIView(context: Context) -> PDFView {
        let pdfView = PDFView()
        pdfView.document = document
        pdfView.autoScales = true
        pdfView.displayMode = .singlePage
        pdfView.displayDirection = .horizontal
        pdfView.usePageViewController(true)
        pdfView.backgroundColor = backgroundColor

        // Set initial page
        if let page = document.page(at: currentPage) {
            pdfView.go(to: page)
        }

        // Observe page changes
        NotificationCenter.default.addObserver(
            context.coordinator,
            selector: #selector(Coordinator.pageChanged(_:)),
            name: .PDFViewPageChanged,
            object: pdfView
        )

        // Observe selection changes
        NotificationCenter.default.addObserver(
            context.coordinator,
            selector: #selector(Coordinator.selectionChanged(_:)),
            name: .PDFViewSelectionChanged,
            object: pdfView
        )

        // Add tap gesture to detect taps on highlight annotations
        let tapGesture = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleAnnotationTap(_:))
        )
        tapGesture.delegate = context.coordinator
        pdfView.addGestureRecognizer(tapGesture)

        context.coordinator.pdfView = pdfView
        onPDFViewCreated?(pdfView)

        return pdfView
    }

    func updateUIView(_ pdfView: PDFView, context: Context) {
        pdfView.backgroundColor = backgroundColor

        if let currentDisplayedPage = pdfView.currentPage {
            let currentIndex = document.index(for: currentDisplayedPage)
            if currentIndex != NSNotFound && currentIndex != currentPage {
                if let page = document.page(at: currentPage) {
                    pdfView.go(to: page)
                }
            }
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var parent: PDFKitView
        weak var pdfView: PDFView?

        init(_ parent: PDFKitView) {
            self.parent = parent
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            true
        }

        @objc func handleAnnotationTap(_ gesture: UITapGestureRecognizer) {
            guard let pdfView = pdfView else { return }
            let location = gesture.location(in: pdfView)

            guard let page = pdfView.page(for: location, nearest: false) else { return }
            let pagePoint = pdfView.convert(location, to: page)

            for annotation in page.annotations where annotation.type == "Highlight" {
                // Expand hit area since the bar annotation is thin
                let hitBounds = annotation.bounds.insetBy(dx: 0, dy: -8)
                if hitBounds.contains(pagePoint),
                   let highlightId = annotation.value(forAnnotationKey: PDFAnnotationKey(rawValue: "highlightId")) as? String {
                    DispatchQueue.main.async {
                        self.parent.onAnnotationTapped?(highlightId)
                    }
                    return
                }
            }
        }

        @objc func pageChanged(_ notification: Notification) {
            guard let pdfView = notification.object as? PDFView,
                  let currentPage = pdfView.currentPage,
                  let document = pdfView.document else { return }

            let pageIndex = document.index(for: currentPage)
            guard pageIndex != NSNotFound else { return }

            DispatchQueue.main.async {
                if self.parent.currentPage != pageIndex {
                    self.parent.currentPage = pageIndex
                }
            }
        }

        @objc func selectionChanged(_ notification: Notification) {
            guard let pdfView = notification.object as? PDFView else { return }
            let selection = pdfView.currentSelection
            let hasSelection = selection?.string?.isEmpty == false

            var frame: CGRect? = nil
            if hasSelection, let sel = selection {
                let lines = sel.selectionsByLine()
                if let firstLine = lines.first, let page = firstLine.pages.first {
                    let pageBounds = firstLine.bounds(for: page)
                    frame = pdfView.convert(pageBounds, from: page)
                }
            }

            DispatchQueue.main.async {
                self.parent.onSelectionChanged?(hasSelection, frame)
            }
        }
    }
}

// MARK: - PDF Highlights List

struct PDFHighlightsView: View {
    let highlights: [BookHighlight]
    let onSelect: (BookHighlight) -> Void
    let onDelete: (BookHighlight) -> Void
    var onEditNote: ((BookHighlight) -> Void)?

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if highlights.isEmpty {
                    ContentUnavailableView {
                        Label("No Highlights", systemImage: "highlighter")
                    } description: {
                        Text("Select text while reading to create highlights.")
                    }
                } else {
                    List {
                        ForEach(highlights, id: \.id) { highlight in
                            Button {
                                onSelect(highlight)
                            } label: {
                                HStack(spacing: 12) {
                                    RoundedRectangle(cornerRadius: 3)
                                        .fill(Color(uiColor: highlight.uiColor))
                                        .frame(width: 4)

                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("\"\(highlight.text)\"")
                                            .font(.subheadline)
                                            .italic()
                                            .lineLimit(3)
                                            .foregroundStyle(.primary)

                                        // Note display
                                        if let note = highlight.note, !note.isEmpty {
                                            Text(note)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                                .lineLimit(2)
                                        } else if onEditNote != nil {
                                            Text("Add note...")
                                                .font(.caption)
                                                .foregroundStyle(.tertiary)
                                        }

                                        HStack {
                                            if let chapter = highlight.chapterTitle {
                                                Text(chapter)
                                                    .font(.caption)
                                                    .foregroundStyle(.secondary)
                                                    .lineLimit(1)
                                            }

                                            Spacer()

                                            Text("\(Int(highlight.progression * 100))%")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }
                                .padding(.vertical, 4)
                            }
                            .swipeActions(edge: .leading) {
                                if onEditNote != nil {
                                    Button {
                                        onEditNote?(highlight)
                                    } label: {
                                        Label("Note", systemImage: "note.text")
                                    }
                                    .tint(.blue)
                                }
                            }
                        }
                        .onDelete { indexSet in
                            for index in indexSet {
                                onDelete(highlights[index])
                            }
                        }
                    }
                }
            }
            .navigationTitle("Highlights")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

#Preview {
    let book = DownloadedBook(
        id: "1",
        title: "Sample PDF",
        authors: ["Author"],
        format: "pdf",
        fileSize: 1024000,
        localPath: "books/1.pdf"
    )

    NavigationStack {
        PDFReaderView(book: book)
    }
    .modelContainer(for: [DownloadedBook.self, BookHighlight.self], inMemory: true)
}
