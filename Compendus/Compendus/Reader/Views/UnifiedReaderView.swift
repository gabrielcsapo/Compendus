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
import CCReader

struct UnifiedReaderView: View {
    let book: DownloadedBook
    var preferEpub: Bool = false
    /// Optional position to open at (e.g. from a highlight). Overrides book.lastPosition.
    var initialPosition: String? = nil

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(ReaderSettings.self) private var readerSettings
    @Environment(HighlightColorManager.self) private var highlightColorManager
    @Environment(ReadAlongService.self) private var readAlongService
    @Environment(AudiobookPlayer.self) private var audiobookPlayer
    @Environment(OnDeviceTranscriptionService.self) private var transcriptionService
    @Environment(APIService.self) private var apiService
    @Environment(KokoroModelManager.self) private var kokoroModelManager
    @Environment(TTSAudioCache.self) private var ttsAudioCache
    @Environment(BackgroundProcessingManager.self) private var backgroundProcessingManager
    @Environment(StorageManager.self) private var storageManager
    @Environment(ComicExtractor.self) private var comicExtractor

    // Engine
    @State private var engine: (any ReaderEngine)?
    @State private var readerState: ReaderState = .loading
    @State private var tocItems: [TOCItem] = []

    // UI state
    @State private var showingSettings = false
    @State private var showingTOC = false
    @State private var showingNotes = false
    @State private var notesTab: NotesTab = .highlights
    @State private var showingOverlay = false
    @State private var overlayHideTask: Task<Void, Never>?
    @State private var showingThumbnails = false
    @State private var showingSearch = false
    @State private var searchQuery: String = ""
    @State private var showingShareSheet = false
    @State private var shareText: String = ""
    @State private var scrubber = ScrubberState()
    @State private var showingHighlightSetup = false
    @State private var showingBookColorEditor = false

    // Highlighting
    @State private var highlights: [ReadingMark] = []
    @State private var showingFloatingToolbar = false
    @State private var selectionFrame: CGRect?
    @State private var pendingSelection: ReaderSelection?
    @State private var showingNoteInput = false
    @State private var noteInputText = ""
    @State private var noteInputColor = "#ffff00"
    @State private var editingHighlight: ReadingMark?
    @State private var tappedHighlight: ReadingMark?

    // Brightness/warmth are now in ReaderSettings (applied as overlays);
    // no longer touch UIScreen.main.brightness.

    // P1.3 — edge-tap zones (EPUB only). Settable so users can opt out.
    @AppStorage("compendus.reader.tapZonesEnabled") private var tapZonesEnabled = true
    // P1.3 — one-shot coach mark on first launch after the edge taps ship.
    @AppStorage("compendus.reader.coachMarkSeen") private var coachMarkSeen = false
    @State private var showCoachMark = false

    // P2.4 — "Back to where you were" pill after a non-linear jump.
    @State private var jumpBackLocation: ReaderLocation? = nil
    @State private var jumpBackLabel: String = ""

    // Read-along / TTS pill
    @State private var matchingAudiobook: DownloadedBook?
    @State private var showReadAlongPill = false
    @State private var readAlongPillDismissed = false
    /// Presents the Read Aloud options popover from the ⋯ menu (after the first-time pill).
    @State private var showReadAloudOptions = false
    /// Persists across sessions — once a user has seen the Read Aloud hint
    /// for any book, don't surface the bottom toast again. Read Aloud is
    /// still accessible from the ⋯ menu.
    @AppStorage("compendus.reader.hasSeenReadAloudHint") private var hasSeenReadAloudHint = false

    // Reader mode (infinite scroll lyrics view without audio)
    @State private var readerMode = ReaderModeState()

    // Footnote popover
    @State private var showingFootnote = false
    @State private var footnoteContent = ""

    // Link confirmation
    @State private var linkConfirmation = LinkConfirmationState()

    // Bookmarks
    @State private var bookmarks: [ReadingMark] = []
    // (showingBookmarks subsumed by showingNotes + notesTab)
    @State private var showingBookmarkEdit = false

    @State private var showingPageJump = false

    // Reading session tracking
    @State private var currentSession: ReadingSession?

    // Save error feedback
    @State private var saveError: String?

    enum ReaderState {
        case loading
        case ready
        case error(String)
    }

    /// Scrubber-bar interaction state (value, drag flag, thumbnail preview).
    struct ScrubberState {
        var value: Double = 0
        var isScrubbing = false
        var thumbnail: UIImage? = nil
        var lastFetchedPage: Int = -1
        var thumbnailTask: Task<Void, Never>? = nil
    }

    /// Reader-mode (infinite-scroll lyrics view) session state.
    struct ReaderModeState {
        var active = false
        var segmentMap: [ReaderModeSegmentMapping] = []
        var activeSegment: Int = -1
        var activeSegmentText: String = ""
        var startSegment: Int = 0
    }

    /// In-book link tap pending user confirmation.
    struct LinkConfirmationState {
        var isPresented = false
        var url: URL?
        var isExternal = false
    }

    // Break out complex optional chains to help the type-checker across module boundaries
    private var currentProgression: Double? { engine?.currentLocation?.totalProgression }

    /// Short hint shown under the cover during initial load. Sets expectation
    /// for what's happening — CBZ extraction can take a moment.
    private var loadingHintForBook: String {
        if book.isComic { return "Opening comic…" }
        switch book.format.lowercased() {
        case "pdf": return "Opening PDF…"
        case "epub": return "Preparing pages…"
        default: return "Opening…"
        }
    }

    @ViewBuilder private var stateContent: some View {
        switch readerState {
        case .loading:
            // Cover-driven loading state — shows the book the user is opening
            // instead of a bare "Loading..." label, which feels uncertain
            // especially for large CBZs (e.g. 400+ pages).
            VStack(spacing: 20) {
                Spacer()
                LocalCoverImage(
                    bookId: book.id,
                    coverData: book.coverData,
                    format: book.format
                )
                .frame(width: 140, height: 210)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .shadow(color: .black.opacity(0.25), radius: 12, y: 4)

                VStack(spacing: 6) {
                    Text(book.title)
                        .font(.headline)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                    if !book.authorsDisplay.isEmpty {
                        Text(book.authorsDisplay)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                .padding(.horizontal, 32)

                ProgressView()
                    .progressViewStyle(.linear)
                    .frame(maxWidth: 180)
                    .padding(.top, 4)

                Text(loadingHintForBook)
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .ready:
            if let engine = engine {
                readerContent(engine: engine)
            }
        case .error(let message):
            ContentUnavailableView {
                Label("Error", systemImage: "exclamationmark.triangle")
            } description: {
                Text(message)
            } actions: {
                Button("Try Again") {
                    readerState = .loading
                    Task { await initializeEngine() }
                }
                .buttonStyle(.borderedProminent)
                Button("Close", role: .cancel) {
                    dismiss()
                }
                .buttonStyle(.bordered)
            }
        }
    }

    // Lifecycle modifiers only — kept small for the type-checker
    private var lifecycleContent: some View {
        stateContent
            .ignoresSafeArea(.all)
            .statusBarHidden(!showingOverlay)
            .task { await initializeEngine() }
            .onChange(of: currentProgression) { _, _ in updateReadingSession() }
            .onChange(of: readAlongService.activeSentenceRange) { _, _ in updateNarrationHighlight() }
            .onChange(of: readAlongService.activeWordRange) { _, _ in updateNarrationHighlight() }
            .onChange(of: readAlongService.isActive) { _, _ in updateNarrationHighlight() }
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)) { _ in saveProgress() }
            .onDisappear {
                saveProgress()
                readerMode.active = false
                readAlongService.deactivate()
                if let nativeEPUB = engine as? NativeReaderEngine { nativeEPUB.cleanup() }
            }
        #if targetEnvironment(macCatalyst)
            .focusable()
            .focusEffectDisabled()
            .onKeyPress(.leftArrow) {
                hideOverlayIfShowing(); showingFloatingToolbar = false
                Task { await engine?.goBackward() }; return .handled
            }
            .onKeyPress(.rightArrow) {
                hideOverlayIfShowing(); showingFloatingToolbar = false
                Task { await engine?.goForward() }; return .handled
            }
        #endif
    }

    // ── Sheet group 1: settings, TOC, highlights ──
    private var sheetsGroup1: some View {
        lifecycleContent
            .sheet(isPresented: $showingSettings, onDismiss: {
                engine?.applySettings(readerSettings)
            }) {
                ReaderSettingsView(format: engine?.isComic == true ? .comic : (engine?.isPDF == true ? .pdf : .epub), bookId: book.id)
                    .readerThemed(readerSettings)
                    // Detent + background interaction so the page redraws live behind the sheet.
                    .presentationDetents([.fraction(0.55), .large])
                    .presentationBackgroundInteraction(.enabled(upThrough: .fraction(0.55)))
                    .presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showReadAloudOptions) {
                ReadAloudOptionsSheet(
                    availableSources: readAlongPillSources,
                    bookId: book.id,
                    audiobookHasTranscript: matchingAudiobook?.hasTranscript ?? true,
                    onStartAudiobook: { activateReadAlong() },
                    onStartTTS: { activateTTSReadAloud() },
                    onChangeVoice: { _ in restartTTSWithNewVoice() },
                    onDownloadForLater: { queueTTSPreGeneration() }
                )
            }
            .sheet(isPresented: $showingTOC) {
                if let comicEngine = engine as? ComicEngine {
                    ComicThumbnailGridView(
                        engine: comicEngine,
                        onSelect: { pageIndex in
                            Task {
                                await comicEngine.go(to: ReaderLocation(
                                    href: nil, pageIndex: pageIndex,
                                    progression: 0, totalProgression: 0, title: nil
                                ))
                            }
                            showingTOC = false
                        }
                    )
                    .readerThemed(readerSettings)
                } else {
                    ReaderTOCView(
                        items: tocItems,
                        currentLocation: engine?.currentLocation,
                        onSelect: { item in
                            armJumpBack(label: "Return to your spot")
                            Task { await engine?.go(to: item.location) }
                            showingTOC = false
                        }
                    )
                    .readerThemed(readerSettings)
                    .task {
                        // Build this when the sheet opens. EPUB page counts are
                        // populated by background pagination, so eagerly caching
                        // the TOC during launch made every chapter appear on page 1.
                        tocItems = await engine?.tableOfContents() ?? []
                    }
                }
            }
            .sheet(isPresented: $showingNotes) {
                NotesSheet(
                    tab: $notesTab,
                    highlights: highlights,
                    bookmarks: bookmarks,
                    onSelectHighlight: { highlight in
                        navigateToHighlight(highlight)
                        showingNotes = false
                    },
                    onDeleteHighlight: { highlight in deleteHighlight(highlight) },
                    onEditHighlightNote: { highlight in
                        showingNotes = false
                        editingHighlight = highlight
                    },
                    onSelectBookmark: { bookmark in
                        Task {
                            await engine?.go(to: ReaderLocation(
                                href: nil, pageIndex: bookmark.pageIndex ?? 0,
                                progression: bookmark.progression,
                                totalProgression: bookmark.progression,
                                title: bookmark.chapterTitle
                            ))
                        }
                        showingNotes = false
                    },
                    onDeleteBookmark: { bookmark in deleteBookmark(bookmark) },
                    hideHighlights: engine?.isComic ?? false
                )
                .readerThemed(readerSettings)
            }
    }

    // ── Sheet group 2: bookmark edit, note input ──
    private var sheetsGroup2: some View {
        sheetsGroup1
        // Bookmark edit (color + note)
        .sheet(isPresented: $showingBookmarkEdit) {
            if let bookmark = currentPageBookmark {
                BookmarkEditSheet(
                    bookmark: bookmark,
                    bookId: book.id,
                    onSave: {
                        do {
                            try modelContext.save()
                        } catch {
                            HapticFeedback.error()
                            saveError = "Couldn't save bookmark. Please try again."
                        }
                        fetchBookmarks()
                        showingBookmarkEdit = false
                    },
                    onDelete: {
                        deleteBookmark(bookmark)
                        showingBookmarkEdit = false
                    }
                )
                .presentationDetents([.medium])
                .readerThemed(readerSettings)
            }
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
    }

    // ── Sheet group 3: highlight editors + fullscreen covers ──
    private var sheetsGroup3: some View {
        sheetsGroup2
            .sheet(item: $editingHighlight) { highlight in
                EditNoteSheet(highlight: highlight) {
                    do {
                        try modelContext.save()
                        HapticFeedback.lightImpact()
                    } catch {
                        HapticFeedback.error()
                        saveError = "Couldn't save note. Please try again."
                    }
                    fetchHighlights()
                }
                .readerThemed(readerSettings)
            }
            .sheet(item: $tappedHighlight) { highlight in
                HighlightEditSheet(
                    bookId: book.id,
                    highlight: highlight,
                    onChangeColor: { color in
                        highlight.color = color
                        if let pdfEngine = engine as? PDFEngine, let info = highlight.toHighlightRenderInfo() {
                            pdfEngine.updateAnnotationColor(for: info, color: color)
                        }
                        do {
                            try modelContext.save()
                        } catch {
                            HapticFeedback.error()
                            saveError = "Couldn't save highlight color. Please try again."
                        }
                        fetchHighlights()
                    },
                    onSaveNote: { note in
                        highlight.note = note
                        do {
                            try modelContext.save()
                            HapticFeedback.lightImpact()
                        } catch {
                            HapticFeedback.error()
                            saveError = "Couldn't save note. Please try again."
                        }
                        fetchHighlights()
                    },
                    onCopy: { UIPasteboard.general.string = highlight.text },
                    onDelete: { deleteHighlight(highlight) }
                )
                .presentationDetents([.medium, .large])
                .readerThemed(readerSettings)
            }
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
    }

    // ── Sheet group 4: navigation + footnote ──
    private var sheetsGroup4: some View {
        sheetsGroup3
            .sheet(isPresented: $showingSearch) {
                if let engine = engine {
                    ReaderSearchView(engine: engine, initialQuery: searchQuery) { location in
                        Task { await engine.go(to: location) }
                    }
                    .readerThemed(readerSettings)
                }
            }
            .sheet(isPresented: $showingShareSheet) {
                ShareSheet(activityItems: [shareText])
                    .presentationDetents([.medium, .large])
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
            .sheet(isPresented: $showingPageJump) {
                pageJumpSheet
                    .presentationDetents([.height(220)])
                    .presentationDragIndicator(.hidden)
                    .readerThemed(readerSettings)
            }
    }

    @ViewBuilder
    private var pageJumpSheet: some View {
        if let engine = engine {
            let nativeEngine = engine as? NativeReaderEngine
            let total = max(1, engine.totalPositions)
            let current: Int = {
                if engine.isPDF {
                    return (engine.currentLocation?.pageIndex ?? 0) + 1
                } else if let comicEngine = engine as? ComicEngine {
                    return comicEngine.currentPage + 1
                } else if let nativeEngine {
                    return nativeEngine.globalPageIndex + 1
                }
                return 1
            }()
            PageJumpView(
                totalPages: total,
                currentPage: current,
                chapterTitle: engine.currentLocation?.title,
                chapterTitleForPage: { page in
                    nativeEngine?.chapterTitle(forGlobalPage: page)
                },
                onJump: { progression in
                    jumpToProgression(progression, engine: engine)
                }
            )
        }
    }

    private func jumpToProgression(_ progression: Double, engine: any ReaderEngine) {
        let total = max(1, engine.totalPositions)
        let pageIndex = Int(round(progression * Double(total - 1)))
        if let nativeEngine = engine as? NativeReaderEngine {
            Task { await nativeEngine.go(toProgression: progression) }
        } else {
            Task {
                await engine.go(to: ReaderLocation(
                    href: nil,
                    pageIndex: pageIndex,
                    progression: 0,
                    totalProgression: progression,
                    title: nil
                ))
            }
        }
    }

    var body: some View {
        sheetsGroup4
            .alert(
                linkConfirmation.isExternal ? "Open External Link?" : "Navigate to Link?",
                isPresented: $linkConfirmation.isPresented
            ) {
                Button("Cancel", role: .cancel) { linkConfirmation.url = nil }
                Button(linkConfirmation.isExternal ? "Open" : "Go") {
                    if let url = linkConfirmation.url,
                       let nativeEngine = engine as? NativeReaderEngine {
                        nativeEngine.performLinkNavigation(url)
                    }
                    linkConfirmation.url = nil
                }
            } message: {
                if let url = linkConfirmation.url {
                    if linkConfirmation.isExternal {
                        Text("This will open \(url.absoluteString) in your browser.")
                    } else {
                        Text("Navigate to this section in the book?")
                    }
                }
            }
            .onChange(of: readerSettings.theme) { _, _ in
                // Apply settings live so the user sees changes behind the
                // settings sheet (it now uses detents + backgroundInteraction).
                engine?.applySettings(readerSettings)
            }
            .onChange(of: readerSettings.fontFamily) { _, _ in
                // Apply settings live so the user sees changes behind the
                // settings sheet (it now uses detents + backgroundInteraction).
                engine?.applySettings(readerSettings)
            }
            .onChange(of: readerSettings.fontSize) { _, _ in
                // Apply settings live so the user sees changes behind the
                // settings sheet (it now uses detents + backgroundInteraction).
                engine?.applySettings(readerSettings)
            }
            .onChange(of: readerSettings.lineHeight) { _, _ in
                // Apply settings live so the user sees changes behind the
                // settings sheet (it now uses detents + backgroundInteraction).
                engine?.applySettings(readerSettings)
            }
            .onChange(of: readerSettings.layout) { _, _ in
                // Apply settings live so the user sees changes behind the
                // settings sheet (it now uses detents + backgroundInteraction).
                engine?.applySettings(readerSettings)
            }
            .bannerToast($saveError, type: .error)
    }

    // MARK: - Reader Content

    @ViewBuilder
    private func readerContent(engine: any ReaderEngine) -> some View {
        GeometryReader { geometry in
            ZStack {
                // Layer 0: Primary reading content. The live engine page stays
                // visible while the chrome bars overlay it — no snapshot carousel.
                // Only Reader Mode replaces the page.
                //
                // Tap zones (left/right page, center toggles chrome) are handled
                // INSIDE the engine's own UITapGestureRecognizer (see
                // NativePageViewController.handleTap → onTapZone, wired in
                // configureEngineCallbacks). That recognizer is built to coexist
                // with text selection (it stands down while a selection is active),
                // which a SwiftUI tap overlay can't — an overlay steals the
                // long-press and breaks highlighting. So we mount NO tap overlay
                // here and just keep the engine hit-testable (even while chrome is
                // up, so a center tap dismisses the bars).
                EngineViewWrapper(engine: engine)
                    .ignoresSafeArea()
                    .opacity(readerMode.active ? 0 : 1)
                    .allowsHitTesting(!readAlongService.isActive && !readerMode.active)

                // (Removed) Invisible corner-tap bookmark hot zone — the
                // top-bar bookmark button already covers this when chrome is
                // up, and the invisible variant was undiscoverable.
                // Show a small dog-ear indicator only when this page is
                // bookmarked so the user has visual confirmation.
                if !showingOverlay && !readerMode.active && currentPageBookmark != nil {
                    VStack {
                        HStack {
                            Spacer()
                            Image(systemName: "bookmark.fill")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(Color.accentColor)
                                .padding(.top, 4)
                                .padding(.trailing, 12)
                        }
                        Spacer()
                    }
                    .ignoresSafeArea(edges: [])
                    .allowsHitTesting(false)
                }

                // Reader mode replaces the engine view when active
                if readerMode.active, let segments = readerModeSegments(engine: engine) {
                    ReaderModeScrollView(
                        segments: segments,
                        totalPages: engine.totalPositions,
                        initialSegment: readerMode.startSegment,
                        onActiveSegmentChanged: { index in
                            readerMode.activeSegment = index
                            if index >= 0 && index < segments.count {
                                readerMode.activeSegmentText = segments[index].text
                            }
                        },
                        onToggleOverlay: { toggleOverlay() }
                    )
                    .transition(.opacity)
                }

                // Read-along (audiobook or TTS): keep the real typeset page
                // visible and highlight the spoken sentence/word in place rather
                // than covering the page with a plain karaoke block. A transparent
                // layer captures taps to toggle chrome (the engine view's hit
                // testing is disabled while read-along is active).
                if readAlongService.isActive && !showingOverlay && !readerMode.active {
                    Color.clear
                        .contentShape(Rectangle())
                        .onTapGesture { toggleOverlay() }

                    // Lightweight "preparing" HUD while the first audio/transcript
                    // is generated — does not replace the page underneath.
                    if readAlongService.state == .loading || readAlongService.state == .buffering {
                        VStack(spacing: 10) {
                            ProgressView()
                            Text("Preparing\u{2026}")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .padding(20)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                        .allowsHitTesting(false)
                        .transition(.opacity)
                    }
                }

                // Layer 1b: Mac Catalyst hover zones (invisible hit areas at edges)
                #if targetEnvironment(macCatalyst)
                VStack {
                    Color.clear
                        .frame(height: 60)
                        .contentShape(Rectangle())
                        .onHover { hovering in
                            if hovering && !showingOverlay { toggleOverlay() }
                        }
                    Spacer()
                    Color.clear
                        .frame(height: 60)
                        .contentShape(Rectangle())
                        .onHover { hovering in
                            if hovering && !showingOverlay { toggleOverlay() }
                        }
                }
                #endif

                // Layer 2: Overlay bars — slide in from edges on tap.
                // simultaneousGesture resets the auto-hide timer on every tap
                // inside the chrome so users aren't racing the clock to hit
                // small icons. Button taps still win because they consume the
                // gesture before this one fires.
                VStack(spacing: 0) {
                    if showingOverlay {
                        readerTopBar(engine: engine)
                            .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
                            .simultaneousGesture(TapGesture().onEnded { scheduleOverlayHide() })
                    }

                    Spacer()

                    // Hide the page-scrubber bar in reader mode (own page info)
                    // and during read-aloud (the docked player owns the bottom).
                    if showingOverlay && !readerMode.active && !readAlongService.isActive {
                        readerBottomBar(engine: engine)
                            .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                            .simultaneousGesture(TapGesture().onEnded { scheduleOverlayHide() })
                    }
                }

                // Layer 3: Floating highlight toolbar (always overlaid at selection position)
                if showingFloatingToolbar, let frame = selectionFrame {
                    FloatingHighlightToolbar(
                        bookId: book.id,
                        selectedText: pendingSelection?.text ?? "",
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
                        },
                        onSearchInBook: { text in
                            searchQuery = text
                            showingSearch = true
                            engine.clearSelection()
                            pendingSelection = nil
                            showingFloatingToolbar = false
                        },
                        onShare: { text in
                            shareText = text
                            showingShareSheet = true
                        }
                    )
                }

                // Layer 4a: Cross-book audiobook FAB (bottom-right)
                // When the user is reading visually (this view) but an
                // audiobook is playing in the background for a DIFFERENT book,
                // surface a compact circular FAB at bottom-right. Tap toggles
                // play/pause; long-press opens the full player.
                // Hidden when the reader overlay is showing — the chrome's own
                // scrubber would collide. Reappears the moment chrome hides.
                if audiobookPlayer.hasActiveSession
                    && !audiobookPlayer.isFullPlayerPresented
                    && audiobookPlayer.currentBook?.id != book.id
                    && !showingOverlay {
                    VStack {
                        Spacer()
                        HStack {
                            Spacer()
                            AudioFABView()
                                .padding(.trailing, 16)
                                .padding(.bottom, 16)
                        }
                    }
                    .transition(.scale(scale: 0.6).combined(with: .opacity))
                    .animation(.spring(response: 0.35, dampingFraction: 0.85),
                               value: showingOverlay)
                    .zIndex(2)
                }

                // Layer 4b: Guided-view FAB for comics (bottom-left).
                // Persistent and prominent — most comic readers will want it.
                if let comicEngine = engine as? ComicEngine,
                   engine.totalPositions > 1,
                   !showingOverlay {
                    VStack {
                        Spacer()
                        HStack {
                            GuidedViewFAB(isOn: Binding(
                                get: { comicEngine.guidedViewEnabled },
                                set: { comicEngine.guidedViewEnabled = $0 }
                            ))
                            .padding(.leading, 16)
                            .padding(.bottom, 16)
                            Spacer()
                        }
                    }
                    .transition(.scale(scale: 0.6).combined(with: .opacity))
                    .animation(.spring(response: 0.35, dampingFraction: 0.85),
                               value: showingOverlay)
                    .zIndex(2)
                }

                // Layer 4: Read-along / TTS playback pill (bottom).
                // Read Aloud is started from the ⋯ menu ("Read Aloud") — we no
                // longer float an "available" hint when a book opens. The pill
                // appears ONLY while read-along is actively playing, to surface
                // the playback controls.
                if readAlongService.isActive {
                    VStack(spacing: 0) {
                        Spacer()
                        // Docked, music-player-style bar (shared PlaybackDockBar,
                        // the same component the audiobook player can use). Full
                        // width, flush to the bottom edge — not a floating pill.
                        PlaybackDockBar(
                            controller: readAlongService,
                            bottomInset: bottomSafeAreaInset,
                            onOptions: { showReadAloudOptions = true }
                        )
                    }
                    .transition(.move(edge: .bottom))
                    .zIndex(3)
                }

                // Layer 5: Full-screen loading overlay while engine initializes content
                if !engine.isReady {
                    ZStack {
                        Color(uiColor: readerSettings.theme.backgroundColor)
                            .ignoresSafeArea()
                        VStack(spacing: 16) {
                            if let epub = engine as? NativeReaderEngine, epub.totalChapterCount > 0 {
                                ProgressView(value: epub.paginationProgress)
                                    .progressViewStyle(.linear)
                                    .frame(width: 200)
                                Text("Paginating chapter \(epub.paginatedChapterCount) of \(epub.totalChapterCount)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .monospacedDigit()
                            } else {
                                ProgressView()
                                    .scaleEffect(1.5)
                                Text("Loading...")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .transition(.opacity)
                }

                // Layer 6: Brightness + warmth overlays (rendered last so they
                // sit on top of everything else). Both are in-app overlays —
                // they don't touch system brightness. Hit-testing disabled so
                // they don't intercept reader gestures.
                if readerSettings.brightness < 1.0 {
                    Color.black
                        .opacity(1.0 - readerSettings.brightness)
                        .ignoresSafeArea()
                        .allowsHitTesting(false)
                }
                if readerSettings.warmth > 0 {
                    Color(red: 1.0, green: 0.55, blue: 0.1)
                        .opacity(readerSettings.warmth * 0.28)
                        .blendMode(.multiply)
                        .ignoresSafeArea()
                        .allowsHitTesting(false)
                }

                // Layer 7: First-launch coach mark (P1.3). One-shot dimmed
                // overlay teaching the left/center/right tap zones. Persisted
                // in @AppStorage so it only shows once across the app's life.
                if showCoachMark && !engine.isComic && !engine.isPDF {
                    ReaderTapZonesCoachMark {
                        coachMarkSeen = true
                        withAnimation(.easeOut(duration: 0.2)) {
                            showCoachMark = false
                        }
                    }
                    .transition(.opacity)
                    .zIndex(100)
                }

                // Layer 8: "Back to where you were" pill (P2.4). Auto-hides
                // after 5 seconds; tap to restore.
                if let label = jumpBackLocation.map({ _ in jumpBackLabel }), !label.isEmpty {
                    VStack {
                        Spacer()
                        JumpBackPill(label: label) {
                            if let loc = jumpBackLocation {
                                Task { await engine.go(to: loc) }
                            }
                            jumpBackLocation = nil
                        }
                        .padding(.bottom, showingOverlay ? 160 : 32)
                        .padding(.horizontal, 16)
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(50)
                }
            }
            .onChange(of: engine.isReady) { _, isReady in
                // Show the coach mark the first time any EPUB reader becomes
                // ready. Delayed by 600ms so the user sees the actual page first.
                if isReady && !coachMarkSeen && !engine.isComic && !engine.isPDF {
                    Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(600))
                        withAnimation(.easeIn(duration: 0.25)) {
                            showCoachMark = true
                        }
                    }
                }
            }
            .animation(reduceMotion ? .none : .spring(response: 0.3, dampingFraction: 0.85), value: showingOverlay)
            .animation(.easeInOut(duration: 0.3), value: engine.isReady)
        }
    }

    // MARK: - Top Bar

    private var themeTextColor: Color {
        Color(uiColor: readerSettings.theme.textColor)
    }

    /// Some converted books only provide a generated filename as their spine
    /// title. Keep that implementation detail out of the reading chrome.
    private func displayChapterTitle(_ rawTitle: String?) -> String? {
        guard let rawTitle else { return nil }
        let trimmed = rawTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let stem = (trimmed as NSString).deletingPathExtension
        let lowercased = stem.lowercased()
        for prefix in ["chapter-", "chapter_"] where lowercased.hasPrefix(prefix) {
            let suffix = String(stem.dropFirst(prefix.count))
            if let number = Int(suffix) {
                return "Chapter \(number)"
            }
        }
        return trimmed
    }

    @ViewBuilder
    private func readerTopBar(engine: any ReaderEngine) -> some View {
        HStack(spacing: 0) {
            // Left: back button
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(themeTextColor)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close reader")

            Spacer(minLength: 8)

            // Center: chapter/book title
            Text(displayChapterTitle(engine.currentLocation?.title) ?? book.title)
            .font(.subheadline.weight(.medium))
            .foregroundStyle(themeTextColor)
            .lineLimit(1)

            Spacer(minLength: 8)

            // Keep one frequent reading adjustment visible. Navigation and
            // annotation tools live in the explicit More menu below.
            HStack(spacing: 0) {
                // Font/typography controls don't apply to comics (raster images);
                // hide the Aa button there to avoid suggesting otherwise.
                if !engine.isComic {
                    Button {
                        showingSettings = true
                    } label: {
                        Image(systemName: "textformat.size")
                            .foregroundStyle(themeTextColor)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel("Reading appearance")
                }

                // One-tap Listen: starts read-along immediately with the saved
                // voice/speed (prefers a matching audiobook, else on-device TTS).
                // When already listening it toggles play/pause. Voice/speed/download
                // stay one level deeper in the ⋯ → Read Aloud options sheet. EPUB only.
                if !engine.isPDF && !engine.isComic
                    && (matchingAudiobook != nil || kokoroModelManager.isModelAvailable || readAlongService.isActive) {
                    Button {
                        if readAlongService.isActive {
                            readAlongService.togglePlayPause()
                        } else if matchingAudiobook != nil {
                            activateReadAlong()
                        } else {
                            activateTTSReadAloud()
                        }
                    } label: {
                        Image(systemName: listenButtonIcon)
                            .foregroundStyle(readAlongService.isActive ? Color.accentColor : themeTextColor)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel(readAlongService.isActive ? "Play or pause read aloud" : "Listen")
                }
            }
            .buttonStyle(.plain)

            // Far right: overflow menu
            Menu {
                Button {
                    showingTOC = true
                } label: {
                    Label(engine.isComic ? "Pages" : "Table of Contents", systemImage: "list.bullet")
                }

                if !engine.isComic {
                    Button {
                        showingSearch = true
                    } label: {
                        Label("Search in Book", systemImage: "magnifyingglass")
                    }
                }

                Button {
                    bookmarkCurrentPage()
                } label: {
                    Label(
                        isCurrentPageBookmarked ? "Edit Bookmark" : "Add Bookmark",
                        systemImage: isCurrentPageBookmarked ? "bookmark.fill" : "bookmark"
                    )
                }

                Button {
                    notesTab = engine.isComic ? .bookmarks : .highlights
                    showingNotes = true
                } label: {
                    Label("Notes", systemImage: "note.text")
                }

                if !engine.isPDF && !engine.isComic && (matchingAudiobook != nil || kokoroModelManager.isModelAvailable || readAlongService.isActive) {
                    if readAlongService.isActive {
                        Button {
                            readAlongService.deactivate()
                        } label: {
                            Label("Stop Read Aloud", systemImage: "speaker.slash")
                        }
                    } else {
                        Button {
                            showReadAloudOptions = true
                        } label: {
                            Label("Read Aloud", systemImage: "speaker.wave.2")
                        }
                    }
                }

                // Reader Mode (continuous scroll) is hidden during read-aloud —
                // read-aloud always presents on the paginated page with in-place
                // highlighting, so the two view modes don't conflict.
                if !engine.isPDF && !engine.isComic && !readAlongService.isActive {
                    Button {
                        // Defer toggle so the context menu fully dismisses first
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                            if readerMode.active {
                                // Exiting reader mode: navigate EPUB to the last viewed passage
                                restoreEPUBPosition(engine: engine)
                            } else {
                                // Pre-compute mapping and start segment before view renders
                                buildReaderModeMapping(forEngine: engine)
                                readerMode.startSegment = computeStartSegment(forEngine: engine)
                            }
                            withAnimation(.easeInOut(duration: 0.3)) {
                                readerMode.active.toggle()
                                if readerMode.active { showingOverlay = false }
                            }
                        }
                    } label: {
                        Label(readerMode.active ? "Exit Reader Mode" : "Reader Mode", systemImage: readerMode.active ? "book" : "scroll")
                    }
                }

            } label: {
                Image(systemName: "ellipsis")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(themeTextColor)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("More reading tools")
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 10)
        .padding(.top, topSafeAreaInset + 12)
        .background(.ultraThinMaterial)
        .environment(\.colorScheme, readerSettings.theme.colorScheme)
    }

    /// SF Symbol for the top-bar one-tap Listen control. Headphones when idle;
    /// play/pause glyph that reflects playback state while a session is active.
    private var listenButtonIcon: String {
        guard readAlongService.isActive else { return "headphones" }
        switch readAlongService.state {
        case .paused: return "play.fill"
        case .loading, .buffering: return "headphones"
        default: return "pause.fill"
        }
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

    // MARK: - Bottom Bar

    @ViewBuilder
    private func readerBottomBar(engine: any ReaderEngine) -> some View {
        VStack(spacing: 8) {
            // Brightness lives in the Aa settings sheet now (works for all
            // formats, not just PDF, and no longer touches system brightness).

            // Page info label
            pageInfoLabel(engine: engine)

            // Interactive page scrubber — for comics on long books, flanked
            // by ±1 page nudge buttons since the scrubber thumb is fiddly to
            // hit precisely (e.g. 400+ page comics).
            if engine.isComic && engine.totalPositions > 50 {
                HStack(spacing: 8) {
                    Button {
                        Task { await engine.goBackward() }
                    } label: {
                        Image(systemName: "minus")
                            .font(.caption.weight(.semibold))
                            .frame(width: 30, height: 30)
                            .background(Circle().fill(.regularMaterial))
                    }
                    .accessibilityLabel("Previous page")

                    pageScrubber(engine: engine)
                        .frame(maxWidth: .infinity)

                    Button {
                        Task { await engine.goForward() }
                    } label: {
                        Image(systemName: "plus")
                            .font(.caption.weight(.semibold))
                            .frame(width: 30, height: 30)
                            .background(Circle().fill(.regularMaterial))
                    }
                    .accessibilityLabel("Next page")
                }
            } else {
                pageScrubber(engine: engine)
            }

            // Footer row: page range + optional thumbnail toggle + zoom chip
            HStack {
                Text("1")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.tertiary)

                Spacer()

                if engine.isPDF {
                    Button {
                        withAnimation(reduceMotion ? .none : .spring(response: 0.35, dampingFraction: 0.8)) {
                            showingThumbnails.toggle()
                        }
                    } label: {
                        Image(systemName: showingThumbnails ? "rectangle.grid.1x2.fill" : "rectangle.grid.1x2")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }

                // Zoom chip — only when the user has zoomed in on a comic.
                if let comicEngine = engine as? ComicEngine,
                   comicEngine.zoomScale > 1.01 {
                    Button {
                        comicEngine.resetZoom()
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "minus.magnifyingglass")
                                .font(.caption2)
                            Text("\(Int(comicEngine.zoomScale * 100))%")
                                .font(.caption2.monospacedDigit().weight(.medium))
                        }
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(Color(.tertiarySystemFill)))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Reset zoom")
                }

                Spacer()

                // Guided-view toggle moved to a prominent bottom-left FAB
                // mounted in readerContent — comics are a primary use case
                // and the small chrome icon was easy to miss.

                Text("\(engine.totalPositions)")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.tertiary)
            }

            // PDF thumbnail scrubber (expanded below when toggled)
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
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, max(12, bottomSafeAreaInset + 4))
        .background(.ultraThinMaterial)
        .environment(\.colorScheme, readerSettings.theme.colorScheme)
    }

    // MARK: - Page Info Label

    @ViewBuilder
    private func pageInfoLabel(engine: any ReaderEngine) -> some View {
        // When actively scrubbing, preview the destination page/chapter so the
        // user can see where they're about to land.
        let nativeEngine = engine as? NativeReaderEngine
        let scrubPage: Int? = scrubber.isScrubbing ? Int(scrubber.value) : nil
        let rawChapterTitle: String? = {
            if let scrubPage, let nativeEngine {
                return nativeEngine.chapterTitle(forGlobalPage: scrubPage) ?? engine.currentLocation?.title
            }
            return engine.currentLocation?.title
        }()
        let chapterTitle = displayChapterTitle(rawChapterTitle)
        let displayProgression: Double = {
            if let scrubPage {
                let total = max(1, engine.totalPositions)
                return Double(scrubPage) / Double(total)
            }
            return engine.currentLocation?.totalProgression ?? 0
        }()
        let percentage = Int(displayProgression * 100)

        VStack(spacing: 2) {
            Button {
                if engine.totalPositions > 1 {
                    showingPageJump = true
                    HapticFeedback.lightImpact()
                }
            } label: {
                Group {
                    if engine.isPDF {
                        let page = (scrubPage ?? engine.currentLocation?.pageIndex ?? 0) + 1
                        Text("Page \(page) of \(engine.totalPositions) \u{00B7} \(percentage)%")
                    } else if let comicEngine = engine as? ComicEngine {
                        let page = (scrubPage ?? comicEngine.currentPage) + 1
                        if comicEngine.pagesPerSpread == 2 {
                            let rightPage = min(page + 1, engine.totalPositions)
                            Text("Pages \(page)-\(rightPage) of \(engine.totalPositions) \u{00B7} \(percentage)%")
                        } else {
                            Text("Page \(page) of \(engine.totalPositions) \u{00B7} \(percentage)%")
                        }
                    } else if let nativeEngine,
                              engine.currentLocation?.pageIndex != nil {
                        let totalPages = nativeEngine.totalPositions
                        let globalPage = (scrubPage ?? nativeEngine.globalPageIndex) + 1
                        if nativeEngine.isSpreadMode {
                            let rightPage = min(globalPage + 1, totalPages)
                            Text("Pages \(globalPage)-\(rightPage) of \(totalPages) \u{00B7} \(percentage)%")
                        } else {
                            Text("Page \(globalPage) of \(totalPages) \u{00B7} \(percentage)%")
                        }
                    } else {
                        Text("\(percentage)%")
                    }
                }
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .disabled(engine.totalPositions <= 1)
            .accessibilityHint("Opens page picker")

            // Chapter title row — meaningful for ebooks/PDFs, but for comics
            // `currentLocation.title` just echoes "Page N" which we already show
            // in the top bar and the row above. Suppress to avoid triplication.
            // During scrubbing this previews the destination chapter.
            if scrubber.isScrubbing, !engine.isComic, let chapterTitle, !chapterTitle.isEmpty {
                Text(chapterTitle)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .padding(.horizontal, 8)
                    .animation(.none, value: scrubPage)
            }

        }
    }

    // MARK: - Page Scrubber

    @ViewBuilder
    private func pageScrubber(engine: any ReaderEngine) -> some View {
        if engine.isPDF, let pdfEngine = engine as? PDFEngine, engine.totalPositions > 1 {
            Slider(
                value: Binding(
                    get: { scrubber.isScrubbing ? scrubber.value : Double(pdfEngine.currentPage) },
                    set: { newValue in
                        scrubber.value = newValue
                        fetchScrubberThumbnail(engine: engine, page: Int(newValue))
                    }
                ),
                in: 0...Double(max(0, engine.totalPositions - 1)),
                step: 1,
                onEditingChanged: { editing in
                    handleScrubberEditingChanged(editing: editing) {
                        Task { await pdfEngine.go(to: ReaderLocation(
                            href: nil, pageIndex: Int(scrubber.value),
                            progression: 0, totalProgression: 0, title: nil
                        ))}
                    }
                }
            )
            .tint(.accentColor)
            .overlay(alignment: .top) {
                scrubberPreviewOverlay()
            }
        } else if let comicEngine = engine as? ComicEngine, engine.totalPositions > 1 {
            Slider(
                value: Binding(
                    get: { scrubber.isScrubbing ? scrubber.value : Double(comicEngine.currentPage) },
                    set: { newValue in
                        scrubber.value = newValue
                        fetchScrubberThumbnail(engine: engine, page: Int(newValue))
                    }
                ),
                in: 0...Double(max(0, engine.totalPositions - 1)),
                step: 1,
                onEditingChanged: { editing in
                    handleScrubberEditingChanged(editing: editing) {
                        Task { await comicEngine.go(to: ReaderLocation(
                            href: nil, pageIndex: Int(scrubber.value),
                            progression: 0, totalProgression: 0, title: nil
                        ))}
                    }
                }
            )
            .tint(.accentColor)
            .overlay(alignment: .top) {
                scrubberPreviewOverlay()
            }
        } else if let nativeEngine = engine as? NativeReaderEngine,
                  nativeEngine.totalPositions > 1 {
            Slider(
                value: Binding(
                    get: { scrubber.isScrubbing ? scrubber.value : Double(nativeEngine.globalPageIndex) },
                    set: { scrubber.value = $0 }
                ),
                in: 0...Double(max(0, nativeEngine.totalPositions - 1)),
                step: 1,
                onEditingChanged: { editing in
                    scrubber.isScrubbing = editing
                    if editing {
                        // Suspend auto-hide while the user is dragging.
                        overlayHideTask?.cancel()
                        overlayHideTask = nil
                    } else {
                        // Navigate only when the user lifts their finger
                        let page = Int(scrubber.value)
                        let totalPages = max(1, nativeEngine.totalPositions)
                        let progression = Double(page) / Double(totalPages)
                        Task { await nativeEngine.go(toProgression: progression) }
                        scheduleOverlayHide()
                    }
                }
            )
            .tint(.accentColor)
        } else {
            ProgressView(value: engine.currentLocation?.totalProgression ?? 0)
                .tint(.accentColor)
        }
    }

    // MARK: - Scrubber preview (comic/PDF)

    @ViewBuilder
    private func scrubberPreviewOverlay() -> some View {
        if scrubber.isScrubbing, let thumb = scrubber.thumbnail {
            Image(uiImage: thumb)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 90, height: 130)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(.white.opacity(0.6), lineWidth: 0.5)
                )
                .shadow(color: .black.opacity(0.3), radius: 8, y: 3)
                .offset(y: -150)
                .transition(.scale(scale: 0.85).combined(with: .opacity))
                .allowsHitTesting(false)
        }
    }

    /// Debounced thumbnail fetch — only kicks off when the integer page changes.
    private func fetchScrubberThumbnail(engine: any ReaderEngine, page: Int) {
        guard page != scrubber.lastFetchedPage else { return }
        scrubber.lastFetchedPage = page
        scrubber.thumbnailTask?.cancel()
        scrubber.thumbnailTask = Task {
            let size = CGSize(width: 90, height: 130)
            let image: UIImage?
            if let comic = engine as? ComicEngine {
                image = await comic.thumbnail(forPage: page, size: size)
            } else if let pdf = engine as? PDFEngine {
                image = await pdf.thumbnail(forPage: page, size: size)
            } else {
                image = nil
            }
            guard !Task.isCancelled else { return }
            await MainActor.run {
                if scrubber.isScrubbing {
                    withAnimation(.easeInOut(duration: 0.15)) {
                        scrubber.thumbnail = image
                    }
                }
            }
        }
    }

    private func handleScrubberEditingChanged(editing: Bool, onCommit: @escaping () -> Void) {
        scrubber.isScrubbing = editing
        if editing {
            // Suspend auto-hide while dragging.
            overlayHideTask?.cancel()
            overlayHideTask = nil
            scrubber.lastFetchedPage = -1
        } else {
            scrubber.thumbnailTask?.cancel()
            scrubber.thumbnailTask = nil
            scrubber.thumbnail = nil
            onCommit()
            scheduleOverlayHide()
        }
    }

    // MARK: - Toggle Overlay

    /// Read-aloud always presents on the paginated page with in-place
    /// highlighting, so if Reader Mode (the continuous dimmed scroll) is on,
    /// exit it first — restoring the paginated position from the active segment.
    private func exitReaderModeIfActive() {
        guard readerMode.active, let engine else { return }
        restoreEPUBPosition(engine: engine)
        withAnimation(.easeInOut(duration: 0.3)) { readerMode.active = false }
    }

    private func toggleOverlay() {
        withAnimation(reduceMotion ? .none : .spring(response: 0.3, dampingFraction: 0.85)) {
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
        withAnimation(reduceMotion ? .none : .spring(response: 0.3, dampingFraction: 0.85)) {
            showingOverlay = false
        }
    }

    private func scheduleOverlayHide() {
        overlayHideTask?.cancel()
        overlayHideTask = Task {
            try? await Task.sleep(for: .seconds(10))
            guard !Task.isCancelled else { return }
            withAnimation(reduceMotion ? .none : .spring(response: 0.3, dampingFraction: 0.85)) {
                showingOverlay = false
            }
        }
    }

    // MARK: - Custom Color Picker

    // MARK: - Engine Initialization

    private func initializeEngine() async {
        // Reflowable formats (epub/mobi/azw3) are read entirely from the CCD pack —
        // no raw .epub on device. preferEpub no longer changes the source.
        if isReflowableFormat {
            await initializeReaderEngine()
            return
        }

        // Comics can work without a local file (CBR requires server)
        if book.isComic {
            await initializeComicEngine()
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
        case "pdf":
            initializePDFEngine(fileURL: fileURL)
        default:
            readerState = .error("Unsupported format: \(book.format)")
        }
    }

    /// Whether this book is a reflowable ebook served via the CCD pack.
    private var isReflowableFormat: Bool {
        ["epub", "mobi", "azw", "azw3"].contains(book.format.lowercased())
    }

    /// Ensure the CCD pack is unpacked on-device (download + unzip on first open),
    /// returning the unpacked manifest URL. Idempotent: if the manifest already
    /// exists locally, skip the download (offline-capable). Returns nil if
    /// unavailable — the reader then has no content (book needs CCD backfill).
    private func ensureCcdPack() async -> URL? {
        guard let packDir = book.ccdPackDir,
              let manifestURL = book.ccdManifestURL else { return nil }
        if FileManager.default.fileExists(atPath: manifestURL.path) { return manifestURL }
        do {
            let data = try await apiService.fetchCcdPack(bookId: book.id)
            return try CCDPack.unpack(zipData: data, into: packDir)
        } catch {
            return nil
        }
    }

    /// The error message shown when the CCD pack can't be loaded. The primary
    /// signal is the book's server-reported `ccdStatus`: a not-yet-converted or
    /// unconvertable book is a content-readiness problem, not a connectivity
    /// one, so don't mislead the user with "try again when online".
    private var ccdUnavailableMessage: String {
        if book.isCcdFailed {
            return "This book couldn't be prepared for reading."
        }
        // "processing", or a nil-status reflowable book that simply has no pack
        // yet (backfill in flight) — both mean "not ready, check back later".
        if book.isCcdProcessing || (book.ccdStatus == nil && book.isReflowable) {
            return "This book is still being prepared for reading. Check back in a bit."
        }
        // ccdStatus is "ready" (or otherwise marked available) but the pack
        // fetch genuinely failed — most likely offline / a transient error.
        return "Could not load book content. Try again when online."
    }

    private func initializeReaderEngine() async {
        guard let manifestURL = await ensureCcdPack(),
              let resourcesRoot = book.ccdResourcesDir else {
            readerState = .error(ccdUnavailableMessage)
            return
        }
        let nativeEngine = NativeReaderEngine(ccdManifestURL: manifestURL, resourcesRoot: resourcesRoot)
        configureEngineCallbacks(nativeEngine)
        await nativeEngine.load(initialPosition: initialPosition ?? book.lastPosition)

        if let error = nativeEngine.errorMessage {
            readerState = .error(error)
            return
        }

        engine = nativeEngine
        fetchHighlights()
        nativeEngine.applyHighlights(highlights.renderableHighlights())
        nativeEngine.applySettings(readerSettings)

        readerState = .ready
        startReadingSession(engine: nativeEngine)
        fetchBookmarks()

        showHighlightSetupIfNeeded()

        // Check for matching audiobook / TTS availability (defer to avoid blocking)
        Task(priority: .userInitiated) { @MainActor [book, modelContext, readAlongService, kokoroModelManager] in
            let audiobook = readAlongService.findMatchingAudiobook(for: book, in: modelContext)
            if let audiobook {
                self.matchingAudiobook = audiobook
            }
            if self.matchingAudiobook != nil || kokoroModelManager.isModelAvailable {
                withAnimation { self.showReadAlongPill = true }
            }
        }
    }

    /// Parse a position string to extract a page number.
    /// Handles both universal JSON format ({"type":"pdf","page":N}) and legacy plain integers.
    private func parsePageFromPosition(_ positionStr: String?) -> Int? {
        guard let str = positionStr else { return nil }
        // Try universal JSON format first
        if let data = str.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let page = json["page"] as? Int {
            return page
        }
        // Legacy: plain integer
        return Int(str)
    }

    private func initializePDFEngine(fileURL: URL) {
        let pdfEngine = PDFEngine(bookURL: fileURL)
        configureEngineCallbacks(pdfEngine)

        let initialPage = parsePageFromPosition(initialPosition ?? book.lastPosition)
        pdfEngine.load(initialPage: initialPage)

        if let error = pdfEngine.errorMessage {
            readerState = .error(error)
            return
        }

        engine = pdfEngine
        fetchHighlights()
        pdfEngine.applyHighlights(highlights.renderableHighlights())
        pdfEngine.applySettings(readerSettings)

        // Load TOC
        Task {
            tocItems = await pdfEngine.tableOfContents()
        }

        readerState = .ready
        startReadingSession(engine: pdfEngine)
        fetchBookmarks()
        showHighlightSetupIfNeeded()
    }

    private func initializeComicEngine() async {
        let comicEngine = ComicEngine(
            book: book,
            comicExtractor: comicExtractor,
            storageManager: storageManager,
            apiService: apiService
        )
        configureEngineCallbacks(comicEngine)

        let initialPage = parsePageFromPosition(initialPosition ?? book.lastPosition)
        await comicEngine.load(initialPage: initialPage)

        if let error = comicEngine.errorMessage {
            readerState = .error(error)
            return
        }

        engine = comicEngine
        comicEngine.applySettings(readerSettings)
        fetchBookmarks()

        readerState = .ready
        startReadingSession(engine: comicEngine)
    }

    private func showHighlightSetupIfNeeded() {
        // Forced first-read setup was friction; defaults are now applied silently.
        // Per-book customization is still available via the in-reader overflow menu
        // (showingBookColorEditor) and global settings.
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

        // PDF: tap zones for page navigation + center tap to toggle overlay
        if let pdfEngine = engine as? PDFEngine {
            pdfEngine.onTapZone = { [self] zone in
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
        }

        // Comic: center tap to toggle overlay (page navigation handled by ComicPageViewController)
        if let comicEngine = engine as? ComicEngine {
            comicEngine.onCenterTap = { [self] in
                toggleOverlay()
            }
        }

        // EPUB: tap zones for page navigation + center tap to toggle overlay
        if let nativeEngine = engine as? NativeReaderEngine {
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

            nativeEngine.onLinkNavigationRequested = { [self] url, isExternal in
                linkConfirmation.url = url
                linkConfirmation.isExternal = isExternal
                linkConfirmation.isPresented = true
            }
        }
    }

    // MARK: - Jump Back Pill (P2.4)

    /// Capture the current location so the "Back to where you were" pill
    /// can offer to restore it after a TOC / search / bookmark / highlight
    /// jump. The pill auto-dismisses after 5 seconds.
    private func armJumpBack(label: String) {
        guard let location = engine?.currentLocation else { return }
        jumpBackLocation = location
        jumpBackLabel = label
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(5))
            withAnimation(.easeOut(duration: 0.25)) {
                jumpBackLocation = nil
                jumpBackLabel = ""
            }
        }
    }

    // MARK: - Progress

    private func saveProgress() {
        guard let engine = engine else { return }

        // If read-along is active, ensure the EPUB page matches the
        // currently read sentence so the bookmark is accurate.
        if readAlongService.isActive,
           let range = readAlongService.activeSentenceRange,
           let nativeEngine = engine as? NativeReaderEngine {
            nativeEngine.showPage(containingRange: range)
        }

        var changedPositionOrProgress = false
        if let serialized = engine.serializeLocation() {
            book.lastPosition = serialized
            changedPositionOrProgress = true
        }

        if let progression = engine.currentLocation?.totalProgression {
            book.readingProgress = progression
            changedPositionOrProgress = true
        }

        // Stamp local reading so sync pushes it. `lastReadAt` is bumped too so the
        // server roll-up reflects when this device actually read (not a stale
        // server-seeded value); `localProgressUpdatedAt` is the push gate and is
        // never overwritten by pulls.
        if changedPositionOrProgress {
            let now = Date()
            book.lastReadAt = now
            book.localProgressUpdatedAt = now
        }

        // Finalize reading session
        if let session = currentSession {
            session.endedAt = Date()
            if let nativeEngine = engine as? NativeReaderEngine {
                session.endPage = nativeEngine.globalPageIndex
                session.endCharacterOffset = nativeEngine.currentPagePlainTextOffset
            } else if let pdfEngine = engine as? PDFEngine {
                session.endPage = pdfEngine.currentPage
            } else if let comicEngine = engine as? ComicEngine {
                session.endPage = comicEngine.currentPage
            }
            // Discard sessions shorter than 10 seconds (accidental opens)
            if session.durationSeconds < 10 {
                modelContext.delete(session)
            }
        }

        do { try modelContext.save() } catch { print("[UnifiedReaderView] saveProgress failed: \(error)") }
    }

    // MARK: - Reading Session Tracking

    private func startReadingSession(engine: any ReaderEngine) {
        guard currentSession == nil else { return }

        let page: Int
        let charOffset: Int?

        if let nativeEngine = engine as? NativeReaderEngine {
            page = nativeEngine.globalPageIndex
            charOffset = nativeEngine.currentPagePlainTextOffset
        } else if let pdfEngine = engine as? PDFEngine {
            page = pdfEngine.currentPage
            charOffset = nil
        } else if let comicEngine = engine as? ComicEngine {
            page = comicEngine.currentPage
            charOffset = nil
        } else {
            return
        }

        let format: String
        if engine.isComic { format = "comic" }
        else if engine.isPDF { format = "pdf" }
        else { format = "epub" }

        let session = ReadingSession(
            bookId: book.id,
            format: format,
            startPage: page,
            endPage: page,
            totalBookPages: engine.totalPositions,
            startCharacterOffset: charOffset,
            endCharacterOffset: charOffset
        )
        session.profileId = book.profileId
        session.appendPageTurn(page: page, characterOffset: charOffset)
        modelContext.insert(session)
        do { try modelContext.save() } catch { print("[UnifiedReaderView] startReadingSession save failed: \(error)") }
        currentSession = session
    }

    /// Push the read-along narration highlight (spoken sentence + word) onto the
    /// live typeset page so listening highlights in place instead of covering the
    /// page. Cleared when read-along is inactive.
    private func updateNarrationHighlight() {
        guard let nativeEngine = engine as? NativeReaderEngine else { return }
        if readAlongService.isActive {
            nativeEngine.setNarrationHighlight(
                sentence: readAlongService.activeSentenceRange,
                word: readAlongService.activeWordRange
            )
        } else {
            nativeEngine.setNarrationHighlight(sentence: nil, word: nil)
        }
    }

    private func updateReadingSession() {
        guard let engine = engine else { return }

        // Durably persist the book-level reading position on every page turn —
        // manual OR read-along auto-advance — so a crash or force-quit can never
        // lose more than the current page. Previously book.lastPosition /
        // readingProgress were only written in saveProgress() (disappear/resign),
        // so a mid-listen crash reset the book's progress to 0%.
        if let serialized = engine.serializeLocation() {
            book.lastPosition = serialized
        }
        if let progression = engine.currentLocation?.totalProgression {
            book.readingProgress = progression
        }
        // Mark local progress so sync pushes it (see saveProgress for rationale).
        let now = Date()
        book.lastReadAt = now
        book.localProgressUpdatedAt = now

        guard let session = currentSession else {
            do { try modelContext.save() } catch { print("[UnifiedReaderView] updateReadingSession (position only) save failed: \(error)") }
            return
        }

        session.endedAt = Date()

        if let nativeEngine = engine as? NativeReaderEngine {
            let page = nativeEngine.globalPageIndex
            let charOffset = nativeEngine.currentPagePlainTextOffset
            session.endPage = page
            session.endCharacterOffset = charOffset
            session.appendPageTurn(page: page, characterOffset: charOffset)
        } else if let pdfEngine = engine as? PDFEngine {
            let page = pdfEngine.currentPage
            session.endPage = page
            session.appendPageTurn(page: page)
        } else if let comicEngine = engine as? ComicEngine {
            let page = comicEngine.currentPage
            session.endPage = page
            session.appendPageTurn(page: page)
        }

        do { try modelContext.save() } catch { print("[UnifiedReaderView] updateReadingSession save failed: \(error)") }
    }

    // MARK: - Bookmarks

    private var currentPageIndex: Int? {
        guard let engine = engine else { return nil }
        if let comicEngine = engine as? ComicEngine {
            return comicEngine.currentPage
        } else if let pdfEngine = engine as? PDFEngine {
            return pdfEngine.currentPage
        } else if let nativeEngine = engine as? NativeReaderEngine {
            return nativeEngine.globalPageIndex
        }
        return nil
    }

    private var isCurrentPageBookmarked: Bool {
        guard let pageIndex = currentPageIndex else { return false }
        return bookmarks.contains { $0.pageIndex == pageIndex }
    }

    private var currentPageBookmark: ReadingMark? {
        guard let pageIndex = currentPageIndex else { return nil }
        return bookmarks.first { $0.pageIndex == pageIndex }
    }

    private func bookmarkRowTitle(for bookmark: ReadingMark) -> String {
        if let title = displayChapterTitle(bookmark.chapterTitle) { return title }
        if let page = bookmark.pageIndex { return "Page \(page + 1)" }
        return "Bookmark"
    }

    private func fetchBookmarks() {
        let bookId = book.id
        let descriptor = FetchDescriptor<ReadingMark>(
            predicate: #Predicate { $0.bookId == bookId && $0.kindRaw != "highlight" },
            sortBy: [SortDescriptor(\.pageIndex)]
        )
        bookmarks = (try? modelContext.fetch(descriptor)) ?? []
    }

    private func bookmarkCurrentPage() {
        guard let engine = engine, let pageIndex = currentPageIndex else { return }
        // If already bookmarked, just show the editor
        if currentPageBookmark != nil {
            showingBookmarkEdit = true
            return
        }

        let format: String
        if engine.isComic { format = "comic" }
        else if engine.isPDF { format = "pdf" }
        else { format = "epub" }

        let defaultColor = highlightColorManager.colors.first?.hex ?? "#ff6b6b"
        let bookmark = ReadingMark(
            bookId: book.id,
            kind: .bookmark,
            format: format,
            pageIndex: pageIndex,
            color: defaultColor,
            chapterTitle: engine.currentLocation?.title,
            progression: engine.currentLocation?.totalProgression ?? 0
        )
        modelContext.insert(bookmark)
        bookmarks.append(bookmark)
        do {
            try modelContext.save()
            HapticFeedback.lightImpact()
        } catch {
            HapticFeedback.error()
            saveError = "Couldn't create bookmark. Please try again."
        }

        showingBookmarkEdit = true
    }

    private func deleteBookmark(_ bookmark: ReadingMark) {
        modelContext.delete(bookmark)
        bookmarks.removeAll { $0.id == bookmark.id }
        do {
            try modelContext.save()
        } catch {
            HapticFeedback.error()
            saveError = "Couldn't delete bookmark. Please try again."
        }
    }

    // MARK: - Read Along

    private func activateReadAlong() {
        guard let audiobook = matchingAudiobook,
              let nativeEngine = engine as? NativeReaderEngine else { return }

        exitReaderModeIfActive()

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
        guard let nativeEngine = engine as? NativeReaderEngine else {
            print("[TTS] Cannot start: engine is not NativeReaderEngine (engine=\(String(describing: engine)))")
            return
        }

        exitReaderModeIfActive()

        print("[TTS] Activating read aloud, voice=\(kokoroModelManager.selectedVoiceIndex)")

        // Both changes must be in the same animation transaction so the pill
        // transitions from "available" to "active/loading" without disappearing.
        withAnimation {
            showReadAlongPill = false
            readAlongService.state = .loading
        }

        Task { @MainActor [kokoroModelManager, readAlongService, book, ttsAudioCache, transcriptionService] in
            do {
                let voiceIndex = kokoroModelManager.selectedVoiceIndex
                print("[TTS] Loading model with voice \(voiceIndex)...")
                let context = try KokoroTTSContext.createFromBundle(voiceIndex: voiceIndex)
                print("[TTS] Model loaded, activating service...")
                readAlongService.activateWithTTS(
                    ebook: book,
                    engine: nativeEngine,
                    ttsContext: context,
                    voiceIndex: voiceIndex,
                    audioCache: ttsAudioCache,
                    transcriptionService: transcriptionService
                )
            } catch {
                print("[TTS] Failed to load model: \(error)")
                readAlongService.state = .error("Failed to load TTS model: \(error.localizedDescription)")
            }
        }
    }

    /// Sources available for the pill based on current book state.
    private var readAlongPillSources: [ReadAlongPill.Source] {
        var sources: [ReadAlongPill.Source] = []
        if matchingAudiobook != nil {
            sources.append(.audiobook)
        }
        if kokoroModelManager.isModelAvailable {
            let cached = ttsAudioCache.hasCachedAudio(
                bookId: book.id,
                spineIndex: 0,
                voiceId: Int(kokoroModelManager.selectedVoiceIndex)
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
        let voiceId = Int(kokoroModelManager.selectedVoiceIndex)
        backgroundProcessingManager.enqueue(.ttsGeneration(bookId: book.id, voiceId: voiceId))
    }

    // MARK: - Reader Mode

    struct ReaderModeSegmentMapping {
        let spineIndex: Int
        let plainTextOffset: Int
    }

    /// Eagerly build the segment mapping from all parsed chapters.
    /// Called from the toggle button handler so the mapping is ready before the view renders.
    private func buildReaderModeMapping(forEngine engine: any ReaderEngine) {
        guard let nativeEngine = engine as? NativeReaderEngine else { return }
        let chapters = nativeEngine.allChaptersPlainText
        guard !chapters.isEmpty else { return }

        var mapping: [ReaderModeSegmentMapping] = []
        for chapter in chapters {
            let sentences = TextProcessingUtils.sentencize(chapter.plainText)
            for span in sentences {
                mapping.append(ReaderModeSegmentMapping(
                    spineIndex: chapter.spineIndex,
                    plainTextOffset: span.plainTextRange.location
                ))
            }
        }
        readerMode.segmentMap = mapping
    }

    /// Build segments from all parsed chapters for reader mode infinite scroll.
    /// The mapping is built eagerly by `buildReaderModeMapping` in the button handler.
    private func readerModeSegments(engine: any ReaderEngine) -> [ReaderModeScrollView.Segment]? {
        guard let nativeEngine = engine as? NativeReaderEngine else { return nil }
        let chapters = nativeEngine.allChaptersPlainText
        guard !chapters.isEmpty else { return nil }

        var segments: [ReaderModeScrollView.Segment] = []
        var index = 0
        var lastSpineIndex = -1

        for chapter in chapters {
            let chapterTitle = nativeEngine.chapterTitle(forSpineIndex: chapter.spineIndex)
            let sentences = TextProcessingUtils.sentencize(chapter.plainText)
            for (sentenceIndex, span) in sentences.enumerated() {
                let isChapterStart = chapter.spineIndex != lastSpineIndex && sentenceIndex == 0
                let pageNumber = nativeEngine.globalPageIndex(
                    forPlainTextOffset: span.plainTextRange.location,
                    inSpine: chapter.spineIndex
                ) ?? 0

                segments.append(ReaderModeScrollView.Segment(
                    id: index,
                    text: span.text,
                    chapterTitle: isChapterStart ? chapterTitle : nil,
                    isChapterStart: isChapterStart,
                    pageNumber: pageNumber
                ))
                index += 1
            }
            lastSpineIndex = chapter.spineIndex
        }
        guard !segments.isEmpty else { return nil }

        return segments
    }

    /// Find the segment index corresponding to the current EPUB page position.
    /// Uses a pre-built mapping array (called from `readerModeSegments` during view updates).
    private func startSegmentForCurrentPage(engine: NativeReaderEngine, mapping: [ReaderModeSegmentMapping]) -> Int {
        let currentSpine = engine.activeSpineIndex
        let pageOffset = engine.currentPagePlainTextOffset ?? 0

        // Find the first segment in the current chapter at or after the page offset
        for (i, m) in mapping.enumerated() {
            if m.spineIndex == currentSpine && m.plainTextOffset >= pageOffset {
                return i
            }
        }
        // Fallback: find the first segment in the current chapter
        return mapping.firstIndex { $0.spineIndex == currentSpine } ?? 0
    }

    /// Eagerly compute the start segment for the current page without requiring
    /// the full mapping array. Called from the toggle button handler so the value
    /// is ready before `readerMode.active` triggers the first render.
    private func computeStartSegment(forEngine engine: any ReaderEngine) -> Int {
        guard let nativeEngine = engine as? NativeReaderEngine else { return 0 }
        let currentSpine = nativeEngine.activeSpineIndex
        let pageOffset = nativeEngine.currentPagePlainTextOffset ?? 0
        let chapters = nativeEngine.allChaptersPlainText
        guard !chapters.isEmpty else { return 0 }

        var segmentIndex = 0
        var firstInChapter: Int?

        for chapter in chapters {
            let sentences = TextProcessingUtils.sentencize(chapter.plainText)
            for span in sentences {
                if chapter.spineIndex == currentSpine {
                    if firstInChapter == nil { firstInChapter = segmentIndex }
                    if span.plainTextRange.location >= pageOffset {
                        return segmentIndex
                    }
                }
                segmentIndex += 1
            }
        }

        return firstInChapter ?? 0
    }

    /// Navigate the EPUB engine to the page containing the active reader mode segment's text,
    /// then briefly flash-highlight it so the user can see where to pick up reading.
    private func restoreEPUBPosition(engine: any ReaderEngine) {
        guard !readerMode.activeSegmentText.isEmpty,
              readerMode.activeSegment >= 0,
              readerMode.activeSegment < readerMode.segmentMap.count,
              let nativeEngine = engine as? NativeReaderEngine else { return }

        let mapping = readerMode.segmentMap[readerMode.activeSegment]
        let spineIndex = mapping.spineIndex
        let fullText = readerMode.activeSegmentText

        // Search for the segment text within the chapter's plain text
        let chapters = nativeEngine.allChaptersPlainText
        guard let chapter = chapters.first(where: { $0.spineIndex == spineIndex }) else {
            nativeEngine.navigateToPlainTextOffset(mapping.plainTextOffset, inSpine: spineIndex)
            return
        }

        let searchText = String(fullText.prefix(80))
        if let range = chapter.plainText.range(of: searchText) {
            let offset = chapter.plainText.distance(from: chapter.plainText.startIndex, to: range.lowerBound)
            nativeEngine.navigateToPlainTextOffset(offset, inSpine: spineIndex)

            // Flash-highlight the full sentence after a brief delay so the page has rendered
            Task {
                try? await Task.sleep(for: .milliseconds(150))
                nativeEngine.flashHighlight(plainTextOffset: offset, length: fullText.count, inSpine: spineIndex)
            }
        } else {
            nativeEngine.navigateToPlainTextOffset(mapping.plainTextOffset, inSpine: spineIndex)
        }
    }

    // MARK: - Highlights

    private func fetchHighlights() {
        let bookId = book.id
        let descriptor = FetchDescriptor<ReadingMark>(
            predicate: #Predicate<ReadingMark> { highlight in
                highlight.bookId == bookId && highlight.kindRaw == "highlight"
            },
            sortBy: [SortDescriptor(\.createdAt)]
        )
        highlights = (try? modelContext.fetch(descriptor)) ?? []
    }

    private func saveHighlight(color: String, note: String? = nil) {
        // PDF-specific save path
        if let pdfEngine = engine as? PDFEngine {
            guard let result = pdfEngine.saveHighlightFromSelection(color: color, note: note) else { return }

            let highlight = ReadingMark(
                bookId: book.id,
                kind: .highlight,
                format: "pdf",
                locatorJSON: result.locatorJSON,
                text: result.text,
                note: note,
                color: color,
                chapterTitle: result.chapterTitle,
                progression: result.progression
            )

            modelContext.insert(highlight)
            try? modelContext.save()
            pendingSelection = nil
            fetchHighlights()
            engine?.applyHighlights(highlights.renderableHighlights())
            return
        }

        // EPUB save path
        guard let selection = pendingSelection else { return }

        let highlight = ReadingMark(
            bookId: book.id,
            kind: .highlight,
            format: "epub",
            locatorJSON: selection.locationJSON,
            text: selection.text,
            note: note,
            color: color,
            chapterTitle: engine?.currentLocation?.title,
            progression: engine?.currentLocation?.totalProgression ?? 0
        )

        modelContext.insert(highlight)
        try? modelContext.save()

        engine?.clearSelection()
        pendingSelection = nil

        fetchHighlights()
        engine?.applyHighlights(highlights.renderableHighlights())
    }

    private func deleteHighlight(_ highlight: ReadingMark) {
        if let pdfEngine = engine as? PDFEngine, let info = highlight.toHighlightRenderInfo() {
            pdfEngine.deleteHighlightAnnotations(for: info)
        }
        modelContext.delete(highlight)
        try? modelContext.save()
        fetchHighlights()
        engine?.applyHighlights(highlights.renderableHighlights())
    }

    private func navigateToHighlight(_ highlight: ReadingMark) {
        if let pdfEngine = engine as? PDFEngine, let info = highlight.toHighlightRenderInfo() {
            pdfEngine.navigateToHighlight(info)
            return
        }

        // EPUB: parse the locator to get href and navigate
        guard let locatorJSON = highlight.locatorJSON,
              let data = locatorJSON.data(using: .utf8),
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

// MARK: - Jump Back Pill (P2.4)

/// Small floating pill that appears after a non-linear jump (TOC, search,
/// bookmark, highlight). Tap to restore the previous position. Auto-hides
/// after 5 seconds via the parent.
private struct JumpBackPill: View {
    let label: String
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 8) {
                Image(systemName: "arrow.uturn.backward.circle.fill")
                    .font(.callout)
                Text(label)
                    .font(.subheadline.weight(.medium))
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(.regularMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(.separator, lineWidth: 0.5))
            .shadow(color: .black.opacity(0.12), radius: 8, y: 4)
        }
        .buttonStyle(.plain)
    }
}

// NOTE: Tap-zone navigation (left/right page, center toggle) is handled inside
// the engine's own UITapGestureRecognizer (NativePageViewController.handleTap →
// onTapZone), which coexists with text selection. The earlier SwiftUI
// `EPUBEdgeTapZones` overlay was removed because a full-screen tap overlay stole
// the long-press and broke highlighting.

// MARK: - Tap-Zones Coach Mark (P1.3)

/// One-shot teaching overlay shown the first time a user opens an EPUB
/// reader after the edge-tap feature ships. Persistence is handled by the
/// parent via `@AppStorage("compendus.reader.coachMarkSeen")`.
private struct ReaderTapZonesCoachMark: View {
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.65)
                .ignoresSafeArea()
                .onTapGesture { onDismiss() }

            HStack(spacing: 0) {
                coachHint(
                    icon: "chevron.left",
                    title: "Tap left",
                    subtitle: "Previous page"
                )
                Rectangle()
                    .fill(Color.white.opacity(0.18))
                    .frame(width: 1)
                coachHint(
                    icon: "hand.tap",
                    title: "Tap center",
                    subtitle: "Show controls"
                )
                Rectangle()
                    .fill(Color.white.opacity(0.18))
                    .frame(width: 1)
                coachHint(
                    icon: "chevron.right",
                    title: "Tap right",
                    subtitle: "Next page"
                )
            }
            .padding(.vertical, 80)

            VStack {
                Spacer()
                Button {
                    onDismiss()
                } label: {
                    Text("Got it")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.black)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 12)
                        .background(Capsule().fill(Color.white))
                }
                .padding(.bottom, 60)
            }
        }
    }

    @ViewBuilder
    private func coachHint(icon: String, title: String, subtitle: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 44, weight: .semibold))
                .foregroundStyle(.white)
            VStack(spacing: 4) {
                Text(title)
                    .font(.headline)
                    .foregroundStyle(.white)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.7))
            }
        }
        .frame(maxWidth: .infinity)
    }
}
