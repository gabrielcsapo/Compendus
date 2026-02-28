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
    @Environment(HighlightColorManager.self) private var highlightColorManager
    @Environment(ReadAlongService.self) private var readAlongService
    @Environment(AudiobookPlayer.self) private var audiobookPlayer
    @Environment(OnDeviceTranscriptionService.self) private var transcriptionService
    @Environment(APIService.self) private var apiService
    @Environment(PocketTTSModelManager.self) private var pocketTTSModelManager
    @Environment(TTSAudioCache.self) private var ttsAudioCache
    @Environment(BackgroundProcessingManager.self) private var backgroundProcessingManager

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
    @State private var showingHighlightSetup = false
    @State private var showingBookColorEditor = false

    // Highlighting
    @State private var highlights: [BookHighlight] = []
    @State private var showingFloatingToolbar = false
    @State private var selectionFrame: CGRect?
    @State private var pendingSelection: ReaderSelection?
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

    // Read-along / TTS pill
    @State private var matchingAudiobook: DownloadedBook?
    @State private var showReadAlongPill = false
    @State private var readAlongPillDismissed = false

    // Footnote popover
    @State private var showingFootnote = false
    @State private var footnoteContent = ""

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
            readAlongService.deactivate()
            if let nativeEPUB = engine as? NativeEPUBEngine {
                nativeEPUB.cleanup()
            }
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
            ReaderSettingsView(format: engine?.isPDF == true ? .pdf : .epub, bookId: book.id)
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
        // Note input
        .sheet(isPresented: $showingNoteInput) {
            HighlightNoteEditor(
                bookId: book.id,
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
                bookId: book.id,
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
        // First-time highlight setup (full-screen so banners don't distract)
        .fullScreenCover(isPresented: $showingHighlightSetup) {
            HighlightSetupSheet(
                bookId: book.id,
                bookTitle: book.title,
                onUseDefaults: {},
                onCustomize: {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        showingBookColorEditor = true
                    }
                }
            )
            .readerThemed(readerSettings)
        }
        // Book-specific color editor
        .sheet(isPresented: $showingBookColorEditor) {
            NavigationStack {
                BookHighlightColorsEditor(bookId: book.id)
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button("Done") { showingBookColorEditor = false }
                        }
                    }
            }
            .readerThemed(readerSettings)
        }
        // Page jump
        .sheet(isPresented: $showingPageJump) {
            if let engine = engine {
                if engine.isPDF {
                    let currentPage = (engine.currentLocation?.pageIndex ?? 0) + 1
                    PageJumpView(
                        totalPages: engine.totalPositions,
                        currentPage: currentPage,
                        onJump: { progression in
                            Task { await engine.go(toProgression: progression) }
                        }
                    )
                    .presentationDetents([.medium])
                    .readerThemed(readerSettings)
                } else if let nativeEngine = engine as? NativeEPUBEngine {
                    PageJumpView(
                        totalPages: nativeEngine.totalPositions,
                        currentPage: nativeEngine.globalPageIndex + 1,
                        chapterTitle: engine.currentLocation?.title,
                        onJump: { progression in
                            Task {
                                await nativeEngine.go(toProgression: progression)
                            }
                        }
                    )
                    .presentationDetents([.medium])
                    .readerThemed(readerSettings)
                }
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
        .sheet(isPresented: $showingFootnote) {
            NavigationStack {
                ScrollView {
                    Text(footnoteContent)
                        .font(.body)
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .navigationTitle("Footnote")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { showingFootnote = false }
                    }
                }
            }
            .presentationDetents([.medium])
            .readerThemed(readerSettings)
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
        .onChange(of: readerSettings.layout) { _, _ in
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
                        bookId: book.id,
                        selectionRect: frame,
                        containerSize: geometry.size,
                        onSelectColor: { color in
                            saveHighlight(color: color)
                            showingFloatingToolbar = false
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

                // Read-along / TTS pill (bottom)
                if (showReadAlongPill && !readAlongPillDismissed) || readAlongService.isActive {
                    VStack {
                        Spacer()
                        ReadAlongPill(
                            availableSources: readAlongPillSources,
                            bookId: book.id,
                            audiobookHasTranscript: matchingAudiobook?.hasTranscript ?? true,
                            onStartAudiobook: { activateReadAlong() },
                            onStartTTS: { activateTTSReadAloud() },
                            onDismiss: {
                                withAnimation { readAlongPillDismissed = true }
                            },
                            onChangeVoice: { _ in restartTTSWithNewVoice() },
                            onDownloadForLater: { queueTTSPreGeneration() }
                        )
                        .padding(.horizontal, 16)
                        .padding(.bottom, showingOverlay ? 60 : 16)
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }

                // Full-screen loading overlay while engine initializes content
                if !engine.isReady {
                    ZStack {
                        Color(uiColor: readerSettings.theme.backgroundColor)
                            .ignoresSafeArea()
                        VStack(spacing: 16) {
                            ProgressView()
                                .scaleEffect(1.5)
                            Text("Loading...")
                                .foregroundStyle(.secondary)
                        }
                    }
                    .transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.3), value: engine.isReady)
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
                .opacity(visible ? 1 : 0)

                Spacer()

                HStack(spacing: 18) {
                    // Read aloud / Read along
                    if !engine.isPDF && (matchingAudiobook != nil || pocketTTSModelManager.isModelAvailable || readAlongService.isActive) {
                        if readAlongService.state == .loading || readAlongService.state == .buffering {
                            ProgressView()
                                .scaleEffect(0.7)
                        } else {
                            Button {
                                if readAlongService.isActive {
                                    readAlongService.deactivate()
                                } else {
                                    // Show the pill so users can choose between
                                    // Read Along (audiobook) and Read Aloud (TTS)
                                    withAnimation {
                                        readAlongPillDismissed = false
                                        showReadAlongPill = true
                                    }
                                }
                            } label: {
                                Image(systemName: readAlongService.isActive ? "speaker.wave.2.fill" : "speaker.wave.2")
                                    .foregroundStyle(readAlongService.isActive ? Color.accentColor : .primary)
                            }
                        }
                    }

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
                .opacity(visible ? 1 : 0)
            }
            .padding(.horizontal)
            .padding(.bottom, 14)
            .padding(.top, topSafeAreaInset + 12)
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
                .tint(.accentColor)

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
                } else if let nativeEngine = engine as? NativeEPUBEngine,
                          engine.currentLocation?.pageIndex != nil {
                    let globalPage = nativeEngine.globalPageIndex + 1
                    let totalPages = nativeEngine.totalPositions
                    Button {
                        showingPageJump = true
                    } label: {
                        HStack(spacing: 4) {
                            if let title = engine.currentLocation?.title {
                                Text(title)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                Text("·")
                                    .font(.caption)
                                    .foregroundStyle(.tertiary)
                            }
                            if nativeEngine.isSpreadMode {
                                let rightPage = min(globalPage + 1, totalPages)
                                Text("Pages \(globalPage)-\(rightPage) of \(totalPages)")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            } else {
                                Text("Page \(globalPage) of \(totalPages)")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                        }
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
        .padding(.top, 16)
        .padding(.bottom, max(16, bottomSafeAreaInset + 12))
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

    /// Pauses read-along playback if currently active (any screen touch should pause).
    private func pauseReadAlongIfActive() {
        if readAlongService.state == .active {
            readAlongService.togglePlayPause()
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

        readerState = .ready

        // Load TOC in background — not needed until user opens TOC panel
        Task {
            tocItems = await nativeEngine.tableOfContents()
        }
        showHighlightSetupIfNeeded()

        // Check for matching audiobook / TTS availability (defer to avoid blocking)
        Task.detached(priority: .userInitiated) { [book, modelContext, readAlongService, pocketTTSModelManager] in
            let audiobook = readAlongService.findMatchingAudiobook(for: book, in: modelContext)
            await MainActor.run {
                if let audiobook {
                    self.matchingAudiobook = audiobook
                }
                if self.matchingAudiobook != nil || pocketTTSModelManager.isModelAvailable {
                    withAnimation { self.showReadAlongPill = true }
                }
            }
        }
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
        showHighlightSetupIfNeeded()
    }

    private func showHighlightSetupIfNeeded() {
        if book.lastReadAt == nil && !highlightColorManager.hasCustomColors(for: book.id) {
            showingHighlightSetup = true
        }
    }

    private func configureEngineCallbacks(_ engine: any ReaderEngine) {
        engine.onSelectionChanged = { [self] selection in
            if let selection = selection {
                pauseReadAlongIfActive()
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
                pauseReadAlongIfActive()
                toggleOverlay()
            }
        }

        // EPUB: tap zones for page navigation + center tap to toggle overlay
        if let nativeEngine = engine as? NativeEPUBEngine {
            nativeEngine.onTapZone = { [self] zone in
                pauseReadAlongIfActive()
                switch zone {
                case "left":
                    hideOverlayIfShowing()
                    showingFloatingToolbar = false
                    dismissPillIfAvailable()
                    Task { await self.engine?.goBackward() }
                case "right":
                    hideOverlayIfShowing()
                    showingFloatingToolbar = false
                    dismissPillIfAvailable()
                    Task { await self.engine?.goForward() }
                case "center":
                    toggleOverlay()
                default:
                    break
                }
            }

            nativeEngine.onFootnoteTapped = { [self] text in
                footnoteContent = text
                showingFootnote = true
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

    // MARK: - Read Along

    private func activateReadAlong() {
        guard let audiobook = matchingAudiobook,
              let nativeEngine = engine as? NativeEPUBEngine else { return }

        if audiobook.hasTranscript {
            // Transcript already exists — start immediately
            withAnimation {
                showReadAlongPill = false
            }
            readAlongService.activate(
                ebook: book,
                audiobook: audiobook,
                engine: nativeEngine,
                player: audiobookPlayer,
                transcriptionService: transcriptionService
            )
        } else {
            // Need to transcribe first — start transcription, then activate when done
            withAnimation {
                showReadAlongPill = false
                readAlongService.state = .loading
            }
            guard let fileURL = audiobook.fileURL else { return }
            let duration = audiobook.duration.map(Double.init) ?? 0

            transcriptionService.transcribe(
                fileURL: fileURL,
                duration: duration > 0 ? duration : 3600,
                bookId: audiobook.id,
                title: audiobook.title,
                coverData: audiobook.coverData
            )

            // Watch for transcription completion
            Task {
                while transcriptionService.isActive {
                    try? await Task.sleep(for: .seconds(1))
                }

                // Save transcript to audiobook
                if case .completed(let transcript) = transcriptionService.state {
                    if let data = try? JSONEncoder().encode(transcript) {
                        audiobook.transcriptData = data
                        try? modelContext.save()
                    }

                    // Upload to server so other clients can use it
                    let bookId = audiobook.id
                    Task {
                        try? await apiService.uploadTranscript(bookId: bookId, transcript: transcript)
                    }

                    transcriptionService.state = .idle

                    // Now activate read-along with the saved transcript
                    readAlongService.activate(
                        ebook: book,
                        audiobook: audiobook,
                        engine: nativeEngine,
                        player: audiobookPlayer,
                        transcriptionService: transcriptionService
                    )
                } else {
                    readAlongService.state = .inactive
                }
            }
        }
    }

    private func activateTTSReadAloud() {
        guard let nativeEngine = engine as? NativeEPUBEngine else {
            print("[TTS] Cannot start: engine is not NativeEPUBEngine (engine=\(String(describing: engine)))")
            return
        }

        print("[TTS] Activating read aloud, voice=\(pocketTTSModelManager.selectedVoiceIndex)")

        // Both changes must be in the same animation transaction so the pill
        // transitions from "available" to "active/loading" without disappearing.
        withAnimation {
            showReadAlongPill = false
            readAlongService.state = .loading
        }

        Task.detached(priority: .userInitiated) { [pocketTTSModelManager, readAlongService, book, ttsAudioCache] in
            do {
                let voiceIndex = await pocketTTSModelManager.selectedVoiceIndex
                print("[TTS] Loading model with voice \(voiceIndex)...")
                let context = try PocketTTSContext.createFromBundle(voiceIndex: voiceIndex)
                print("[TTS] Model loaded, activating service...")
                await MainActor.run {
                    readAlongService.activateWithTTS(
                        ebook: book,
                        engine: nativeEngine,
                        ttsContext: context,
                        voiceIndex: voiceIndex,
                        audioCache: ttsAudioCache
                    )
                }
            } catch {
                print("[TTS] Failed to load model: \(error)")
                await MainActor.run {
                    readAlongService.state = .error("Failed to load TTS model: \(error.localizedDescription)")
                }
            }
        }
    }

    /// Sources available for the pill based on current book state.
    private var readAlongPillSources: [ReadAlongPill.Source] {
        var sources: [ReadAlongPill.Source] = []
        if matchingAudiobook != nil {
            sources.append(.audiobook)
        }
        if pocketTTSModelManager.isModelAvailable {
            let cached = ttsAudioCache.hasCachedAudio(
                bookId: book.id,
                spineIndex: 0,
                voiceId: Int(pocketTTSModelManager.selectedVoiceIndex)
            )
            sources.append(cached ? .ttsCached : .tts)
        }
        return sources
    }

    /// Dismiss the pill if it's in the "available" (not active) state.
    private func dismissPillIfAvailable() {
        guard !readAlongService.isActive, showReadAlongPill, !readAlongPillDismissed else { return }
        withAnimation { readAlongPillDismissed = true }
    }

    /// Restart TTS with the currently selected voice (after voice change).
    private func restartTTSWithNewVoice() {
        guard readAlongService.isTTSMode else { return }
        readAlongService.deactivate()
        // Small delay to let deactivation clean up before restarting
        Task {
            try? await Task.sleep(for: .milliseconds(200))
            activateTTSReadAloud()
        }
    }

    /// Queue TTS audio pre-generation for all chapters.
    private func queueTTSPreGeneration() {
        let voiceId = Int(pocketTTSModelManager.selectedVoiceIndex)
        backgroundProcessingManager.enqueue(.ttsGeneration(bookId: book.id, voiceId: voiceId))
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
