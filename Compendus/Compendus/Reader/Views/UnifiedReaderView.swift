//
//  UnifiedReaderView.swift
//  Compendus
//
//  Single reader view that works with any ReaderEngine (EPUB or PDF).
//  Replaces both EPUBReaderView (879 lines) and PDFReaderView (837 lines)
//  with a unified reading experience.
//

import SwiftUI
import SwiftData

struct UnifiedReaderView: View {
    let book: DownloadedBook
    var preferEpub: Bool = false

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(ReaderSettings.self) private var readerSettings

    // Engine
    @State private var engine: (any ReaderEngine)?
    @State private var readerState: ReaderState = .loading
    @State private var tocItems: [TOCItem] = []

    // UI state
    @State private var showingSettings = false
    @State private var showingTOC = false
    @State private var showingHighlights = false
    @State private var showingOverlay = false
    @State private var overlayHideTask: Task<Void, Never>?
    @State private var showingThumbnails = false
    @State private var showingPageJump = false
    @State private var showingSearch = false

    // Highlighting
    @State private var highlights: [BookHighlight] = []
    @State private var showingFloatingToolbar = false
    @State private var selectionFrame: CGRect?
    @State private var pendingSelection: ReaderSelection?
    @State private var showingCustomColorPicker = false
    @State private var customColor: SwiftUI.Color = .yellow
    @State private var showingNoteInput = false
    @State private var noteInputText = ""
    @State private var noteInputColor = "#ffff00"
    @State private var editingHighlight: BookHighlight?
    @State private var tappedHighlight: BookHighlight?

    // PDF-specific
    #if !targetEnvironment(macCatalyst)
    @State private var brightness: Double = Double(UIScreen.main.brightness)
    @State private var originalBrightness: Double = Double(UIScreen.main.brightness)
    #else
    @State private var brightness: Double = 1.0
    @State private var originalBrightness: Double = 1.0
    #endif

    enum ReaderState {
        case loading
        case ready
        case error(String)
    }

    var body: some View {
        Group {
            switch readerState {
            case .loading:
                VStack(spacing: 16) {
                    ProgressView()
                        .scaleEffect(1.5)
                    Text("Loading...")
                        .foregroundStyle(.secondary)
                }

            case .ready:
                if let engine = engine {
                    readerContent(engine: engine)
                }

            case .error(let message):
                ContentUnavailableView {
                    Label("Error", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                }
            }
        }
        .ignoresSafeArea(.all)
        .statusBarHidden(!showingOverlay)
        #if targetEnvironment(macCatalyst)
        .focusable()
        .focusEffectDisabled()
        .onKeyPress(.leftArrow) {
            hideOverlayIfShowing()
            showingFloatingToolbar = false
            Task { await engine?.goBackward() }
            return .handled
        }
        .onKeyPress(.rightArrow) {
            hideOverlayIfShowing()
            showingFloatingToolbar = false
            Task { await engine?.goForward() }
            return .handled
        }
        #endif
        .task { await initializeEngine() }
        .onDisappear {
            saveProgress()
            #if !targetEnvironment(macCatalyst)
            if engine?.isPDF == true {
                UIScreen.main.brightness = CGFloat(originalBrightness)
            }
            #endif
        }
        // Settings — apply changes on dismiss to avoid lag during adjustment
        .sheet(isPresented: $showingSettings, onDismiss: {
            engine?.applySettings(readerSettings)
        }) {
            ReaderSettingsView(format: engine?.isPDF == true ? .pdf : .epub)
                .readerThemed(readerSettings)
        }
        // TOC
        .sheet(isPresented: $showingTOC) {
            ReaderTOCView(
                items: tocItems,
                currentLocation: engine?.currentLocation,
                onSelect: { item in
                    Task {
                        await engine?.go(to: item.location)
                    }
                    showingTOC = false
                }
            )
            .readerThemed(readerSettings)
        }
        // Highlights list
        .sheet(isPresented: $showingHighlights) {
            ReaderHighlightsListView(
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
            .readerThemed(readerSettings)
        }
        // Custom color picker
        .sheet(isPresented: $showingCustomColorPicker) {
            customColorPickerSheet
                .readerThemed(readerSettings)
        }
        // Note input
        .sheet(isPresented: $showingNoteInput) {
            HighlightNoteEditor(
                highlightText: pendingSelection?.text ?? "",
                note: $noteInputText,
                selectedColor: $noteInputColor,
                onSave: {
                    let trimmedNote = noteInputText.trimmingCharacters(in: .whitespacesAndNewlines)
                    saveHighlight(color: noteInputColor, note: trimmedNote.isEmpty ? nil : trimmedNote)
                    showingNoteInput = false
                },
                onCancel: {
                    engine?.clearSelection()
                    pendingSelection = nil
                    showingNoteInput = false
                }
            )
            .presentationDetents([.medium, .large])
            .readerThemed(readerSettings)
        }
        // Edit note
        .sheet(item: $editingHighlight) { highlight in
            EditNoteSheet(highlight: highlight) {
                try? modelContext.save()
                fetchHighlights()
            }
            .readerThemed(readerSettings)
        }
        // Tapped highlight actions
        .sheet(item: $tappedHighlight) { highlight in
            HighlightEditSheet(
                highlight: highlight,
                onChangeColor: { color in
                    highlight.color = color
                    if let pdfEngine = engine as? PDFEngine {
                        pdfEngine.updateAnnotationColor(for: highlight, color: color)
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
            .readerThemed(readerSettings)
        }
        // Page jump
        .sheet(isPresented: $showingPageJump) {
            if let engine = engine {
                let currentPage = calculateCurrentAbsolutePage(engine: engine)
                PageJumpView(
                    totalPages: engine.totalPositions,
                    currentPage: currentPage,
                    onJump: { progression in
                        Task { await engine.go(toProgression: progression) }
                    }
                )
                .presentationDetents([.medium])
                .readerThemed(readerSettings)
            }
        }
        // Search
        .sheet(isPresented: $showingSearch) {
            if let engine = engine {
                ReaderSearchView(engine: engine) { location in
                    Task { await engine.go(to: location) }
                }
                .readerThemed(readerSettings)
            }
        }
        // Settings changes — skip while settings sheet is open (applied on dismiss)
        .onChange(of: readerSettings.theme) { _, _ in
            if !showingSettings { engine?.applySettings(readerSettings) }
        }
        .onChange(of: readerSettings.fontFamily) { _, _ in
            if !showingSettings { engine?.applySettings(readerSettings) }
        }
        .onChange(of: readerSettings.fontSize) { _, _ in
            if !showingSettings { engine?.applySettings(readerSettings) }
        }
        .onChange(of: readerSettings.lineHeight) { _, _ in
            if !showingSettings { engine?.applySettings(readerSettings) }
        }
    }

    // MARK: - Reader Content

    @ViewBuilder
    private func readerContent(engine: any ReaderEngine) -> some View {
        GeometryReader { geometry in
            ZStack {
                // Main layout: top bar area, reader, bottom bar area
                VStack(spacing: 0) {
                    // Top bar — always reserves space, content fades in/out
                    readerTopBar(engine: engine, visible: showingOverlay)

                    // Engine fills remaining space
                    EngineViewWrapper(engine: engine)

                    // Bottom area — always reserves space
                    VStack(spacing: 0) {
                        // PDF-specific controls (only when overlay visible)
                        if showingOverlay && engine.isPDF {
                            if showingThumbnails, let pdfEngine = engine as? PDFEngine,
                               let document = pdfEngine.pdfDocument {
                                PDFThumbnailScrubber(
                                    document: document,
                                    currentPage: Binding(
                                        get: { pdfEngine.currentPage },
                                        set: { page in
                                            Task { await pdfEngine.go(to: ReaderLocation(
                                                href: nil, pageIndex: page,
                                                progression: 0, totalProgression: 0, title: nil
                                            ))}
                                        }
                                    )
                                )
                            }

                            pdfControlsOverlay(engine: engine)
                        }

                        // Progress bar — always present, content fades
                        progressBar(engine: engine, visible: showingOverlay)
                    }
                }

                // Floating highlight toolbar (always overlaid at selection position)
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
                            showingFloatingToolbar = false
                            noteInputText = ""
                            noteInputColor = "#ffff00"
                            showingNoteInput = true
                        },
                        onCopy: {
                            UIPasteboard.general.string = pendingSelection?.text ?? ""
                            engine.clearSelection()
                            pendingSelection = nil
                            showingFloatingToolbar = false
                        },
                        onDismiss: {
                            engine.clearSelection()
                            pendingSelection = nil
                            showingFloatingToolbar = false
                        }
                    )
                }
            }
        }
    }

    // MARK: - Top Bar

    @ViewBuilder
    private func readerTopBar(engine: any ReaderEngine, visible: Bool) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 16) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.primary)
                }
                .buttonStyle(.plain)

                Spacer()

                // Chapter/page title
                Group {
                    if let title = engine.currentLocation?.title, !title.isEmpty {
                        Text(title)
                    } else {
                        Text(book.title)
                    }
                }
                .font(.subheadline.weight(.medium))
                .lineLimit(1)

                Spacer()

                HStack(spacing: 18) {
                    Button {
                        showingSearch = true
                    } label: {
                        Image(systemName: "magnifyingglass")
                    }

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

                    Button {
                        showingTOC = true
                    } label: {
                        Image(systemName: "list.bullet")
                    }
                }
                .buttonStyle(.plain)
                .foregroundStyle(.primary)
            }
            .padding(.horizontal)
            .padding(.bottom, 10)
            .padding(.top, topSafeAreaInset + 6)
            .opacity(visible ? 1 : 0)
        }
        .background(visible ? AnyShapeStyle(.ultraThinMaterial) : AnyShapeStyle(Color(uiColor: readerSettings.theme.backgroundColor)))
        .environment(\.colorScheme, readerSettings.theme.colorScheme)
        .contentShape(Rectangle())
        .onTapGesture {
            if !visible { toggleOverlay() }
        }
        #if targetEnvironment(macCatalyst)
        .onHover { hovering in
            if hovering && !visible {
                toggleOverlay()
            }
        }
        #endif
        .animation(reduceMotion ? .none : .easeInOut(duration: 0.25), value: visible)
    }

    private var topSafeAreaInset: CGFloat {
        windowSafeAreaInsets.top
    }

    private var bottomSafeAreaInset: CGFloat {
        windowSafeAreaInsets.bottom
    }

    private var windowSafeAreaInsets: UIEdgeInsets {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first?.windows.first?.safeAreaInsets ?? .zero
    }

    // MARK: - Progress Bar

    @ViewBuilder
    private func progressBar(engine: any ReaderEngine, visible: Bool) -> some View {
        VStack(spacing: 4) {
            ProgressView(value: engine.currentLocation?.totalProgression ?? 0)
                .tint(.blue)

            HStack {
                if engine.isPDF {
                    let page = (engine.currentLocation?.pageIndex ?? 0) + 1
                    Button {
                        showingPageJump = true
                    } label: {
                        Text("\(page) / \(engine.totalPositions)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                } else if engine.totalPositions > 0,
                          let pageIndex = engine.currentLocation?.pageIndex {
                    let pagesBeforeCurrent = calculatePagesBeforeCurrent(engine: engine)
                    Button {
                        showingPageJump = true
                    } label: {
                        Text("Page \(pagesBeforeCurrent + pageIndex + 1) of \(engine.totalPositions)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                } else {
                    Text("\(Int((engine.currentLocation?.totalProgression ?? 0) * 100))%")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
        }
        .padding(.horizontal)
        .padding(.top, 12)
        .padding(.bottom, max(12, bottomSafeAreaInset + 8))
        .opacity(visible ? 1 : 0)
        .background(visible ? AnyShapeStyle(.ultraThinMaterial) : AnyShapeStyle(Color(uiColor: readerSettings.theme.backgroundColor)))
        .environment(\.colorScheme, readerSettings.theme.colorScheme)
        .contentShape(Rectangle())
        .onTapGesture {
            if !visible { toggleOverlay() }
        }
        #if targetEnvironment(macCatalyst)
        .onHover { hovering in
            if hovering && !visible {
                toggleOverlay()
            }
        }
        #endif
        .animation(reduceMotion ? .none : .easeInOut(duration: 0.25), value: visible)
    }

    private func calculatePagesBeforeCurrent(engine: any ReaderEngine) -> Int {
        guard let location = engine.currentLocation else { return 0 }
        let estimatedPage = Int(location.totalProgression * Double(engine.totalPositions))
        return max(0, estimatedPage - (location.pageIndex ?? 0))
    }

    private func calculateCurrentAbsolutePage(engine: any ReaderEngine) -> Int {
        if engine.isPDF {
            return (engine.currentLocation?.pageIndex ?? 0) + 1
        }
        let pagesBeforeCurrent = calculatePagesBeforeCurrent(engine: engine)
        return pagesBeforeCurrent + (engine.currentLocation?.pageIndex ?? 0) + 1
    }

    // MARK: - PDF Controls Overlay

    @ViewBuilder
    private func pdfControlsOverlay(engine: any ReaderEngine) -> some View {
        VStack(spacing: 16) {
            // Brightness control (iOS only — no screen brightness API on Mac)
            #if !targetEnvironment(macCatalyst)
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
            #endif

            // Page slider
            if engine.totalPositions > 1, let pdfEngine = engine as? PDFEngine {
                VStack(spacing: 4) {
                    Slider(
                        value: Binding(
                            get: { Double(pdfEngine.currentPage) },
                            set: { newValue in
                                Task { await pdfEngine.go(to: ReaderLocation(
                                    href: nil, pageIndex: Int(newValue),
                                    progression: 0, totalProgression: 0, title: nil
                                ))}
                            }
                        ),
                        in: 0...Double(max(0, engine.totalPositions - 1)),
                        step: 1
                    )

                    HStack {
                        Text("1")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text("\(engine.totalPositions)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal)
            }

            // Thumbnail toggle
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

    // MARK: - Toggle Overlay

    private func toggleOverlay() {
        withAnimation(reduceMotion ? .none : .easeInOut(duration: 0.25)) {
            showingOverlay.toggle()
        }
        if showingOverlay {
            scheduleOverlayHide()
        } else {
            overlayHideTask?.cancel()
            overlayHideTask = nil
        }
    }

    private func hideOverlayIfShowing() {
        guard showingOverlay else { return }
        overlayHideTask?.cancel()
        overlayHideTask = nil
        withAnimation(reduceMotion ? .none : .easeInOut(duration: 0.25)) {
            showingOverlay = false
        }
    }

    private func scheduleOverlayHide() {
        overlayHideTask?.cancel()
        overlayHideTask = Task {
            try? await Task.sleep(for: .seconds(10))
            guard !Task.isCancelled else { return }
            withAnimation(reduceMotion ? .none : .easeInOut(duration: 0.25)) {
                showingOverlay = false
            }
        }
    }

    // MARK: - Custom Color Picker

    @ViewBuilder
    private var customColorPickerSheet: some View {
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

    // MARK: - Engine Initialization

    private func initializeEngine() async {
        // When preferEpub is true and the book has a downloaded EPUB version, use it
        if preferEpub, let epubURL = book.epubFileURL, book.hasEpubVersion {
            await initializeEPUBEngine(fileURL: epubURL)
            return
        }

        guard let fileURL = book.fileURL else {
            readerState = .error("Could not find the book file")
            return
        }

        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            readerState = .error("Book file not found at expected location")
            return
        }

        switch book.format.lowercased() {
        case "epub":
            await initializeEPUBEngine(fileURL: fileURL)
        case "pdf":
            initializePDFEngine(fileURL: fileURL)
        default:
            readerState = .error("Unsupported format: \(book.format)")
        }
    }

    private func initializeEPUBEngine(fileURL: URL) async {
        let nativeEngine = NativeEPUBEngine(bookURL: fileURL)
        configureEngineCallbacks(nativeEngine)
        await nativeEngine.load(initialPosition: book.lastPosition)

        if let error = nativeEngine.errorMessage {
            readerState = .error(error)
            return
        }

        engine = nativeEngine
        fetchHighlights()
        nativeEngine.applyHighlights(highlights)
        nativeEngine.applySettings(readerSettings)

        // Load TOC
        tocItems = await nativeEngine.tableOfContents()

        readerState = .ready
    }

    private func initializePDFEngine(fileURL: URL) {
        let pdfEngine = PDFEngine(bookURL: fileURL)
        configureEngineCallbacks(pdfEngine)

        let initialPage = book.lastPosition.flatMap { Int($0) }
        pdfEngine.load(initialPage: initialPage)

        if let error = pdfEngine.errorMessage {
            readerState = .error(error)
            return
        }

        engine = pdfEngine
        fetchHighlights()
        pdfEngine.applyHighlights(highlights)
        pdfEngine.applySettings(readerSettings)

        // Load TOC
        Task {
            tocItems = await pdfEngine.tableOfContents()
        }

        readerState = .ready
    }

    private func configureEngineCallbacks(_ engine: any ReaderEngine) {
        engine.onSelectionChanged = { [self] selection in
            if let selection = selection {
                pendingSelection = selection
                selectionFrame = selection.frame
                showingFloatingToolbar = true
            } else {
                showingFloatingToolbar = false
            }
        }

        engine.onHighlightTapped = { [self] highlightId in
            if let highlight = highlights.first(where: { $0.id == highlightId }) {
                tappedHighlight = highlight
            }
        }

        // PDF: center tap to toggle overlay
        if let pdfEngine = engine as? PDFEngine {
            pdfEngine.onCenterTap = { [self] in
                toggleOverlay()
            }
        }

        // EPUB: tap zones for page navigation + center tap to toggle overlay
        if let nativeEngine = engine as? NativeEPUBEngine {
            nativeEngine.onTapZone = { [self] zone in
                switch zone {
                case "left":
                    hideOverlayIfShowing()
                    showingFloatingToolbar = false
                    Task { await self.engine?.goBackward() }
                case "right":
                    hideOverlayIfShowing()
                    showingFloatingToolbar = false
                    Task { await self.engine?.goForward() }
                case "center":
                    toggleOverlay()
                default:
                    break
                }
            }
        }
    }

    // MARK: - Progress

    private func saveProgress() {
        guard let engine = engine else { return }

        if let serialized = engine.serializeLocation() {
            book.lastPosition = serialized
        }

        if let progression = engine.currentLocation?.totalProgression {
            book.readingProgress = progression
        }

        try? modelContext.save()
    }

    // MARK: - Highlights

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
        // PDF-specific save path
        if let pdfEngine = engine as? PDFEngine {
            guard let result = pdfEngine.saveHighlightFromSelection(color: color, note: note) else { return }

            let highlight = BookHighlight(
                bookId: book.id,
                locatorJSON: result.locatorJSON,
                text: result.text,
                note: note,
                color: color,
                progression: result.progression,
                chapterTitle: result.chapterTitle
            )

            modelContext.insert(highlight)
            try? modelContext.save()
            pendingSelection = nil
            fetchHighlights()
            engine?.applyHighlights(highlights)
            return
        }

        // EPUB save path
        guard let selection = pendingSelection else { return }

        let highlight = BookHighlight(
            bookId: book.id,
            locatorJSON: selection.locationJSON,
            text: selection.text,
            note: note,
            color: color,
            progression: engine?.currentLocation?.totalProgression ?? 0,
            chapterTitle: engine?.currentLocation?.title
        )

        modelContext.insert(highlight)
        try? modelContext.save()

        engine?.clearSelection()
        pendingSelection = nil

        fetchHighlights()
        engine?.applyHighlights(highlights)
    }

    private func deleteHighlight(_ highlight: BookHighlight) {
        if let pdfEngine = engine as? PDFEngine {
            pdfEngine.deleteHighlightAnnotations(for: highlight)
        }
        modelContext.delete(highlight)
        try? modelContext.save()
        fetchHighlights()
        engine?.applyHighlights(highlights)
    }

    private func navigateToHighlight(_ highlight: BookHighlight) {
        if let pdfEngine = engine as? PDFEngine {
            pdfEngine.navigateToHighlight(highlight)
            return
        }

        // EPUB: parse the locator to get href and navigate
        guard let data = highlight.locatorJSON.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let href = json["href"] as? String else { return }

        let location = ReaderLocation(
            href: href,
            pageIndex: nil,
            progression: 0,
            totalProgression: highlight.progression,
            title: highlight.chapterTitle
        )
        Task {
            await engine?.go(to: location)
        }
    }
}

// MARK: - Engine View Wrapper

struct EngineViewWrapper: UIViewControllerRepresentable {
    let engine: any ReaderEngine

    func makeUIViewController(context: Context) -> UIViewController {
        engine.makeViewController()
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {
        // Updates handled via engine protocol methods
    }
}
