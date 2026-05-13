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
import EPUBReader

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
    @Environment(PocketTTSModelManager.self) private var pocketTTSModelManager
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
    @State private var scrubberValue: Double = 0
    @State private var isScrubbing = false
    @State private var scrubberThumbnail: UIImage? = nil
    @State private var lastFetchedThumbnailPage: Int = -1
    @State private var scrubberThumbnailTask: Task<Void, Never>? = nil
    @State private var showingHighlightSetup = false
    @State private var showingBookColorEditor = false

    // Carousel state
    @State private var carouselSnapshots: [UIImage?] = [nil, nil, nil] // [prev, current, next]
    @State private var carouselDragOffset: CGFloat = 0

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
    /// Persists across sessions — once a user has seen the Read Aloud hint
    /// for any book, don't surface the bottom toast again. Read Aloud is
    /// still accessible from the ⋯ menu.
    @AppStorage("compendus.reader.hasSeenReadAloudHint") private var hasSeenReadAloudHint = false

    // Reader mode (infinite scroll lyrics view without audio)
    @State private var readerModeActive = false
    @State private var readerModeSegmentMap: [ReaderModeSegmentMapping] = []
    @State private var readerModeActiveSegment: Int = -1
    @State private var readerModeActiveSegmentText: String = ""
    @State private var readerModeStartSegment: Int = 0

    // Footnote popover
    @State private var showingFootnote = false
    @State private var footnoteContent = ""

    // Link confirmation
    @State private var showingLinkConfirmation = false
    @State private var pendingLinkURL: URL?
    @State private var pendingLinkIsExternal = false

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
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)) { _ in saveProgress() }
            .onDisappear {
                saveProgress()
                readerModeActive = false
                readAlongService.deactivate()
                if let nativeEPUB = engine as? NativeEPUBEngine { nativeEPUB.cleanup() }
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
                        if let items = await engine?.tableOfContents(), !items.isEmpty {
                            tocItems = items
                        }
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
            let nativeEngine = engine as? NativeEPUBEngine
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
        if let nativeEngine = engine as? NativeEPUBEngine {
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
                pendingLinkIsExternal ? "Open External Link?" : "Navigate to Link?",
                isPresented: $showingLinkConfirmation
            ) {
                Button("Cancel", role: .cancel) { pendingLinkURL = nil }
                Button(pendingLinkIsExternal ? "Open" : "Go") {
                    if let url = pendingLinkURL,
                       let nativeEngine = engine as? NativeEPUBEngine {
                        nativeEngine.performLinkNavigation(url)
                    }
                    pendingLinkURL = nil
                }
            } message: {
                if let url = pendingLinkURL {
                    if pendingLinkIsExternal {
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
                // Layer 0: Primary reading content
                // Engine view always in tree for UIKit stability; hidden in reader mode.
                // The opacity flip to hidden is intentionally NOT animated — if it
                // crossfades, the engine view and the carousel snapshot are both
                // partially visible mid-transition, producing a ghosted-text artifact.
                // Instant hide eliminates the double-render; the carousel handles
                // its own fade-in cleanly.
                EngineViewWrapper(engine: engine)
                    .ignoresSafeArea()
                    .opacity(showingOverlay || readerModeActive ? 0 : 1)
                    .animation(.none, value: showingOverlay)
                    .allowsHitTesting(!showingOverlay && !readAlongService.isActive && !readerModeActive)

                // Edge-tap zones (P1.3) — for EPUB only. Comic + PDF engines
                // have their own gesture handling. Left/right thirds advance
                // pages; center third toggles the overlay (existing behavior).
                if tapZonesEnabled
                    && !engine.isComic
                    && !engine.isPDF
                    && !showingOverlay
                    && !readAlongService.isActive
                    && !readerModeActive {
                    EPUBEdgeTapZones(
                        onPrevious: { Task { await engine.goBackward() } },
                        onNext: { Task { await engine.goForward() } },
                        onCenterTap: { toggleOverlay() }
                    )
                }

                // (Removed) Invisible corner-tap bookmark hot zone — the
                // top-bar bookmark button already covers this when chrome is
                // up, and the invisible variant was undiscoverable.
                // Show a small dog-ear indicator only when this page is
                // bookmarked so the user has visual confirmation.
                if !showingOverlay && !readerModeActive && currentPageBookmark != nil {
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
                if readerModeActive, let segments = readerModeSegments(engine: engine) {
                    ReaderModeScrollView(
                        segments: segments,
                        totalPages: engine.totalPositions,
                        initialSegment: readerModeStartSegment,
                        onActiveSegmentChanged: { index in
                            readerModeActiveSegment = index
                            if index >= 0 && index < segments.count {
                                readerModeActiveSegmentText = segments[index].text
                            }
                        },
                        onToggleOverlay: { toggleOverlay() }
                    )
                    .transition(.opacity)
                }

                // Read-along karaoke overlay (audiobook or TTS mode)
                // Always in the view tree; controlled via opacity.
                ReadAlongLyricsOverlay(
                    transcript: readAlongService.isActive ? readAlongService.currentTranscript : nil,
                    currentTime: readAlongService.currentPlaybackTime,
                    bookTitle: book.title,
                    chapterTitle: engine.currentLocation?.title,
                    isLoading: readAlongService.isActive && readAlongService.currentTranscript == nil,
                    scrollDriven: false,
                    onSeek: { time in readAlongService.seek(to: time) },
                    onTapBackground: { toggleOverlay() }
                )
                .opacity(readAlongService.isActive ? 1 : 0)
                .allowsHitTesting(readAlongService.isActive)
                .animation(.easeInOut(duration: 0.3), value: readAlongService.isActive)

                // Layer 1: Page carousel (visible when overlay is showing, not in reader mode)
                if showingOverlay && !readerModeActive {
                    pageCarousel(engine: engine, geometry: geometry)
                        .transition(reduceMotion ? .opacity : .opacity)
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

                    // Hide bottom bar in reader mode (has its own page info)
                    if showingOverlay && !readerModeActive {
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

                // Layer 4: Read-along / TTS pill (bottom)
                // Show the Read Aloud pill only the FIRST time it's available
                // for a user (gated by hasSeenReadAloudHint AppStorage). After
                // that, Read Aloud lives in the ⋯ menu. The pill also returns
                // whenever read-along is actively playing so users see the
                // playback affordances.
                if ((showReadAlongPill && !readAlongPillDismissed && !hasSeenReadAloudHint)
                    || readAlongService.isActive) {
                    VStack {
                        Spacer()
                        ReadAlongPill(
                            availableSources: readAlongPillSources,
                            bookId: book.id,
                            audiobookHasTranscript: matchingAudiobook?.hasTranscript ?? true,
                            onStartAudiobook: {
                                hasSeenReadAloudHint = true
                                activateReadAlong()
                            },
                            onStartTTS: {
                                hasSeenReadAloudHint = true
                                activateTTSReadAloud()
                            },
                            onDismiss: {
                                hasSeenReadAloudHint = true
                                withAnimation { readAlongPillDismissed = true }
                            },
                            onChangeVoice: { _ in restartTTSWithNewVoice() },
                            onDownloadForLater: {
                                hasSeenReadAloudHint = true
                                queueTTSPreGeneration()
                            }
                        )
                        .padding(.horizontal, 16)
                        .padding(.bottom, showingOverlay ? 140 : 16)
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }

                // Layer 5: Full-screen loading overlay while engine initializes content
                if !engine.isReady {
                    ZStack {
                        Color(uiColor: readerSettings.theme.backgroundColor)
                            .ignoresSafeArea()
                        VStack(spacing: 16) {
                            if let epub = engine as? NativeEPUBEngine, epub.totalChapterCount > 0 {
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
            .onChange(of: showingOverlay) { _, isShowing in
                if isShowing {
                    captureCarouselSnapshots(engine: engine)
                } else {
                    carouselSnapshots = [nil, nil, nil]
                    carouselDragOffset = 0
                }
            }
        }
    }

    // MARK: - Page Carousel

    /// Card dimensions for carousel layout (computed from geometry).
    private func carouselMetrics(for geometry: GeometryProxy) -> (cardWidth: CGFloat, cardHeight: CGFloat, cardStride: CGFloat, verticalCenter: CGFloat) {
        let topBarHeight = topSafeAreaInset + 62
        let bottomBarHeight = max(12, bottomSafeAreaInset + 4) + 90
        let availableHeight = geometry.size.height - topBarHeight - bottomBarHeight
        let verticalCenter = topBarHeight + availableHeight / 2

        let cardWidth = geometry.size.width * 0.75
        let cardAspect = geometry.size.height / max(1, geometry.size.width)
        let cardHeight = min(cardWidth * cardAspect, availableHeight - 32)
        let cardSpacing: CGFloat = 16
        let cardStride = cardWidth + cardSpacing

        return (cardWidth, cardHeight, cardStride, verticalCenter)
    }

    @ViewBuilder
    private func pageCarousel(engine: any ReaderEngine, geometry: GeometryProxy) -> some View {
        let metrics = carouselMetrics(for: geometry)

        ZStack {
            // Dimmed background — tap to dismiss overlay
            Color.black.opacity(0.3)
                .ignoresSafeArea()
                .onTapGesture {
                    toggleOverlay()
                }

            // Three cards: prev (-1), current (0), next (+1)
            ForEach(-1...1, id: \.self) { offset in
                let index = offset + 1 // 0=prev, 1=current, 2=next
                let xOffset = CGFloat(offset) * metrics.cardStride + carouselDragOffset

                carouselCard(image: carouselSnapshots[index], width: metrics.cardWidth, height: metrics.cardHeight)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        if offset == 0 {
                            // Tap on current card dismisses the overlay
                            toggleOverlay()
                        } else {
                            // Tap on prev/next card navigates to that page
                            let navigateForward = offset == 1
                            withAnimation(.spring(response: 0.25, dampingFraction: 0.9)) {
                                carouselDragOffset = navigateForward ? -metrics.cardStride : metrics.cardStride
                            }
                            Task {
                                try? await Task.sleep(for: .milliseconds(250))
                                if navigateForward {
                                    await engine.goForward()
                                } else {
                                    await engine.goBackward()
                                }
                                carouselDragOffset = 0
                                captureCarouselSnapshots(engine: engine)
                                scheduleOverlayHide()
                            }
                        }
                    }
                    .offset(x: xOffset)
                    .zIndex(offset == 0 ? 1 : 0)
            }
            .position(x: geometry.size.width / 2, y: metrics.verticalCenter)
        }
        .contentShape(Rectangle())
        .highPriorityGesture(
            DragGesture(minimumDistance: 15)
                .onChanged { value in
                    // Cancel auto-hide while user is interacting with carousel
                    overlayHideTask?.cancel()
                    overlayHideTask = nil
                    carouselDragOffset = value.translation.width
                }
                .onEnded { value in
                    let threshold = metrics.cardWidth * 0.25
                    let predicted = value.predictedEndTranslation.width
                    if value.translation.width < -threshold || predicted < -threshold * 2 {
                        // Swiped left → animate card off to the left, then update
                        withAnimation(.spring(response: 0.25, dampingFraction: 0.9)) {
                            carouselDragOffset = -metrics.cardStride
                        }
                        Task {
                            try? await Task.sleep(for: .milliseconds(250))
                            await engine.goForward()
                            carouselDragOffset = 0
                            captureCarouselSnapshots(engine: engine)
                            scheduleOverlayHide()
                        }
                    } else if value.translation.width > threshold || predicted > threshold * 2 {
                        // Swiped right → animate card off to the right, then update
                        withAnimation(.spring(response: 0.25, dampingFraction: 0.9)) {
                            carouselDragOffset = metrics.cardStride
                        }
                        Task {
                            try? await Task.sleep(for: .milliseconds(250))
                            await engine.goBackward()
                            carouselDragOffset = 0
                            captureCarouselSnapshots(engine: engine)
                            scheduleOverlayHide()
                        }
                    } else {
                        // Snap back — not enough to trigger navigation
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                            carouselDragOffset = 0
                        }
                        scheduleOverlayHide()
                    }
                }
        )
    }

    @ViewBuilder
    private func carouselCard(image: UIImage?, width: CGFloat, height: CGFloat) -> some View {
        Group {
            if let image = image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            } else {
                Color(uiColor: readerSettings.theme.backgroundColor)
            }
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: 24))
        .shadow(color: .black.opacity(0.4), radius: 20, x: 0, y: 8)
    }

    private func captureCarouselSnapshots(engine: any ReaderEngine) {
        // The engine renders snapshots at its own viewport size so text layout
        // matches exactly. SwiftUI scales the images down for the carousel card.
        carouselSnapshots = [
            engine.snapshotPage(at: -1),
            engine.snapshotPage(at: 0),
            engine.snapshotPage(at: 1)
        ]
    }

    // MARK: - Top Bar

    private var themeTextColor: Color {
        Color(uiColor: readerSettings.theme.textColor)
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

            // Left-center: TOC
            Button {
                showingTOC = true
            } label: {
                Image(systemName: "list.bullet")
                    .foregroundStyle(themeTextColor)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Spacer(minLength: 8)

            // Center: chapter/book title
            Group {
                if let title = engine.currentLocation?.title, !title.isEmpty {
                    Text(title)
                } else {
                    Text(book.title)
                }
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(themeTextColor)
            .lineLimit(1)

            Spacer(minLength: 8)

            // Right-center: search + font settings + bookmark
            HStack(spacing: 0) {
                if !engine.isComic {
                    Button {
                        showingSearch = true
                    } label: {
                        Image(systemName: "magnifyingglass")
                            .foregroundStyle(themeTextColor)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                }

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
                }

                // Bookmark button: solid when bookmarked, outline when not
                Button {
                    bookmarkCurrentPage()
                } label: {
                    Image(systemName: isCurrentPageBookmarked ? "bookmark.fill" : "bookmark")
                        .foregroundStyle(
                            isCurrentPageBookmarked
                                ? Color(uiColor: currentPageBookmark?.uiColor ?? .systemRed)
                                : themeTextColor
                        )
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
            }
            .buttonStyle(.plain)

            // Far right: overflow menu
            Menu {
                Button {
                    notesTab = engine.isComic ? .bookmarks : .highlights
                    showingNotes = true
                } label: {
                    Label("Notes", systemImage: "note.text")
                }

                if !engine.isPDF && !engine.isComic && (matchingAudiobook != nil || pocketTTSModelManager.isModelAvailable || readAlongService.isActive) {
                    if readAlongService.isActive {
                        Button {
                            readAlongService.deactivate()
                        } label: {
                            Label("Stop Read Aloud", systemImage: "speaker.slash")
                        }
                    } else {
                        Button {
                            withAnimation {
                                readAlongPillDismissed = false
                                showReadAlongPill = true
                            }
                        } label: {
                            Label("Read Aloud", systemImage: "speaker.wave.2")
                        }
                    }
                }

                if !engine.isPDF && !engine.isComic {
                    Button {
                        // Defer toggle so the context menu fully dismisses first
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                            if readerModeActive {
                                // Exiting reader mode: navigate EPUB to the last viewed passage
                                restoreEPUBPosition(engine: engine)
                            } else {
                                // Pre-compute mapping and start segment before view renders
                                buildReaderModeMapping(forEngine: engine)
                                readerModeStartSegment = computeStartSegment(forEngine: engine)
                            }
                            withAnimation(.easeInOut(duration: 0.3)) {
                                readerModeActive.toggle()
                                if readerModeActive { showingOverlay = false }
                            }
                        }
                    } label: {
                        Label(readerModeActive ? "Exit Reader Mode" : "Reader Mode", systemImage: readerModeActive ? "book" : "scroll")
                    }
                }

            } label: {
                Image(systemName: "ellipsis")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(themeTextColor)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 10)
        .padding(.top, topSafeAreaInset + 12)
        .background(.ultraThinMaterial)
        .environment(\.colorScheme, readerSettings.theme.colorScheme)
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
        let nativeEngine = engine as? NativeEPUBEngine
        let scrubPage: Int? = isScrubbing ? Int(scrubberValue) : nil
        let chapterTitle: String? = {
            if let scrubPage, let nativeEngine {
                return nativeEngine.chapterTitle(forGlobalPage: scrubPage) ?? engine.currentLocation?.title
            }
            return engine.currentLocation?.title
        }()
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
            if !engine.isComic, let chapterTitle, !chapterTitle.isEmpty {
                Text(chapterTitle)
                    .font(.caption2)
                    .foregroundStyle(isScrubbing ? .secondary : .tertiary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .padding(.horizontal, 8)
                    .animation(.none, value: scrubPage)
            }

            // Estimated reading time left (P2.5) — EPUB only. Uses a rough
            // 250 WPM × ~300 words/page heuristic = ~1.2 min/page. Cheap,
            // mostly accurate, and matches what users expect from Kindle.
            if !isScrubbing, let label = readingTimeLeftLabel(engine: engine) {
                Text(label)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    /// "About 23 min left in book" — only shown for paginated EPUB content
    /// where we have a stable page count. Comics/PDFs are skipped (visual
    /// reading speed varies too much) and audiobooks have their own readout.
    private func readingTimeLeftLabel(engine: any ReaderEngine) -> String? {
        guard !engine.isComic, !engine.isPDF else { return nil }
        guard let nativeEngine = engine as? NativeEPUBEngine else { return nil }
        let totalPages = nativeEngine.totalPositions
        let currentPage = nativeEngine.globalPageIndex + 1
        let pagesLeft = totalPages - currentPage
        guard pagesLeft > 1, totalPages > 1 else { return nil }
        // ~1.2 minutes per page; cap precision so 47.999 → "48 min"
        let minutes = Int(round(Double(pagesLeft) * 1.2))
        if minutes < 1 { return nil }
        if minutes < 60 {
            return "About \(minutes) min left in book"
        }
        let hours = minutes / 60
        let mins = minutes % 60
        if mins == 0 {
            return "About \(hours)h left in book"
        }
        return "About \(hours)h \(mins)m left in book"
    }

    // MARK: - Page Scrubber

    @ViewBuilder
    private func pageScrubber(engine: any ReaderEngine) -> some View {
        if engine.isPDF, let pdfEngine = engine as? PDFEngine, engine.totalPositions > 1 {
            Slider(
                value: Binding(
                    get: { isScrubbing ? scrubberValue : Double(pdfEngine.currentPage) },
                    set: { newValue in
                        scrubberValue = newValue
                        fetchScrubberThumbnail(engine: engine, page: Int(newValue))
                    }
                ),
                in: 0...Double(max(0, engine.totalPositions - 1)),
                step: 1,
                onEditingChanged: { editing in
                    handleScrubberEditingChanged(editing: editing) {
                        Task { await pdfEngine.go(to: ReaderLocation(
                            href: nil, pageIndex: Int(scrubberValue),
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
                    get: { isScrubbing ? scrubberValue : Double(comicEngine.currentPage) },
                    set: { newValue in
                        scrubberValue = newValue
                        fetchScrubberThumbnail(engine: engine, page: Int(newValue))
                    }
                ),
                in: 0...Double(max(0, engine.totalPositions - 1)),
                step: 1,
                onEditingChanged: { editing in
                    handleScrubberEditingChanged(editing: editing) {
                        Task { await comicEngine.go(to: ReaderLocation(
                            href: nil, pageIndex: Int(scrubberValue),
                            progression: 0, totalProgression: 0, title: nil
                        ))}
                    }
                }
            )
            .tint(.accentColor)
            .overlay(alignment: .top) {
                scrubberPreviewOverlay()
            }
        } else if let nativeEngine = engine as? NativeEPUBEngine,
                  nativeEngine.totalPositions > 1 {
            Slider(
                value: Binding(
                    get: { isScrubbing ? scrubberValue : Double(nativeEngine.globalPageIndex) },
                    set: { scrubberValue = $0 }
                ),
                in: 0...Double(max(0, nativeEngine.totalPositions - 1)),
                step: 1,
                onEditingChanged: { editing in
                    isScrubbing = editing
                    if editing {
                        // Suspend auto-hide while the user is dragging.
                        overlayHideTask?.cancel()
                        overlayHideTask = nil
                    } else {
                        // Navigate only when the user lifts their finger
                        let page = Int(scrubberValue)
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
        if isScrubbing, let thumb = scrubberThumbnail {
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
        guard page != lastFetchedThumbnailPage else { return }
        lastFetchedThumbnailPage = page
        scrubberThumbnailTask?.cancel()
        scrubberThumbnailTask = Task {
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
                if isScrubbing {
                    withAnimation(.easeInOut(duration: 0.15)) {
                        scrubberThumbnail = image
                    }
                }
            }
        }
    }

    private func handleScrubberEditingChanged(editing: Bool, onCommit: @escaping () -> Void) {
        isScrubbing = editing
        if editing {
            // Suspend auto-hide while dragging.
            overlayHideTask?.cancel()
            overlayHideTask = nil
            lastFetchedThumbnailPage = -1
        } else {
            scrubberThumbnailTask?.cancel()
            scrubberThumbnailTask = nil
            scrubberThumbnail = nil
            onCommit()
            scheduleOverlayHide()
        }
    }

    // MARK: - Toggle Overlay

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
        // When preferEpub is true and the book has a downloaded EPUB version, use it
        if preferEpub, let epubURL = book.epubFileURL, book.hasEpubVersion {
            await initializeEPUBEngine(fileURL: epubURL)
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

            nativeEngine.onLinkNavigationRequested = { [self] url, isExternal in
                pendingLinkURL = url
                pendingLinkIsExternal = isExternal
                showingLinkConfirmation = true
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
           let nativeEngine = engine as? NativeEPUBEngine {
            nativeEngine.showPage(containingRange: range)
        }

        if let serialized = engine.serializeLocation() {
            book.lastPosition = serialized
        }

        if let progression = engine.currentLocation?.totalProgression {
            book.readingProgress = progression
        }

        // Finalize reading session
        if let session = currentSession {
            session.endedAt = Date()
            if let nativeEngine = engine as? NativeEPUBEngine {
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

        if let nativeEngine = engine as? NativeEPUBEngine {
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

    private func updateReadingSession() {
        guard let session = currentSession, let engine = engine else { return }

        session.endedAt = Date()

        if let nativeEngine = engine as? NativeEPUBEngine {
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
        } else if let nativeEngine = engine as? NativeEPUBEngine {
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
        if let title = bookmark.chapterTitle, !title.isEmpty { return title }
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

        Task.detached(priority: .userInitiated) { [pocketTTSModelManager, readAlongService, book, ttsAudioCache, transcriptionService] in
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
                        audioCache: ttsAudioCache,
                        transcriptionService: transcriptionService
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

    // MARK: - Reader Mode

    struct ReaderModeSegmentMapping {
        let spineIndex: Int
        let plainTextOffset: Int
    }

    /// Eagerly build the segment mapping from all parsed chapters.
    /// Called from the toggle button handler so the mapping is ready before the view renders.
    private func buildReaderModeMapping(forEngine engine: any ReaderEngine) {
        guard let nativeEngine = engine as? NativeEPUBEngine else { return }
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
        readerModeSegmentMap = mapping
    }

    /// Build segments from all parsed chapters for reader mode infinite scroll.
    /// The mapping is built eagerly by `buildReaderModeMapping` in the button handler.
    private func readerModeSegments(engine: any ReaderEngine) -> [ReaderModeScrollView.Segment]? {
        guard let nativeEngine = engine as? NativeEPUBEngine else { return nil }
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
    private func startSegmentForCurrentPage(engine: NativeEPUBEngine, mapping: [ReaderModeSegmentMapping]) -> Int {
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
    /// is ready before `readerModeActive` triggers the first render.
    private func computeStartSegment(forEngine engine: any ReaderEngine) -> Int {
        guard let nativeEngine = engine as? NativeEPUBEngine else { return 0 }
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
        guard !readerModeActiveSegmentText.isEmpty,
              readerModeActiveSegment >= 0,
              readerModeActiveSegment < readerModeSegmentMap.count,
              let nativeEngine = engine as? NativeEPUBEngine else { return }

        let mapping = readerModeSegmentMap[readerModeActiveSegment]
        let spineIndex = mapping.spineIndex
        let fullText = readerModeActiveSegmentText

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

// MARK: - Edge-Tap Zones (P1.3)

/// Three invisible tap zones laid over the reading surface for EPUB:
/// left-third → previous page, right-third → next page, center → toggle
/// overlay. Kindle / Apple Books convention. Comic and PDF readers have
/// their own gesture systems so this view is only mounted for EPUB.
private struct EPUBEdgeTapZones: View {
    let onPrevious: () -> Void
    let onNext: () -> Void
    let onCenterTap: () -> Void

    var body: some View {
        GeometryReader { geo in
            HStack(spacing: 0) {
                Color.clear
                    .frame(width: geo.size.width / 3)
                    .contentShape(Rectangle())
                    .onTapGesture { onPrevious() }
                Color.clear
                    .frame(width: geo.size.width / 3)
                    .contentShape(Rectangle())
                    .onTapGesture { onCenterTap() }
                Color.clear
                    .frame(width: geo.size.width / 3)
                    .contentShape(Rectangle())
                    .onTapGesture { onNext() }
            }
        }
        .ignoresSafeArea()
    }
}

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
