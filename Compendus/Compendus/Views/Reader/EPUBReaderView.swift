//
//  EPUBReaderView.swift
//  Compendus
//
//  EPUB reader using Readium Swift toolkit
//
//  Required packages:
//  - ReadiumShared
//  - ReadiumStreamer
//  - ReadiumNavigator
//  - ReadiumAdapterGCDWebServer (for HTTP server)
//

import SwiftUI
import SwiftData
import ReadiumShared
import ReadiumStreamer
import ReadiumNavigator
import ReadiumAdapterGCDWebServer

// MARK: - Readium Services

@MainActor
final class ReadiumServices {
    static let shared = ReadiumServices()

    lazy var httpClient: HTTPClient = DefaultHTTPClient()
    lazy var httpServer: HTTPServer = GCDHTTPServer(assetRetriever: assetRetriever)

    lazy var assetRetriever = AssetRetriever(httpClient: httpClient)

    lazy var publicationOpener = PublicationOpener(
        parser: DefaultPublicationParser(
            httpClient: httpClient,
            assetRetriever: assetRetriever,
            pdfFactory: DefaultPDFDocumentFactory()
        ),
        contentProtections: []
    )
}

// MARK: - EPUB Navigator Container

/// Wraps EPUBNavigatorViewController as a child VC.
/// Detects text selection via polling and shows the floating highlight toolbar directly.
@MainActor
class EPUBNavigatorContainer: UIViewController {
    let navigator: EPUBNavigatorViewController
    var onHighlightRequested: ((Locator, String, CGRect?) -> Void)?
    var onHighlightTapped: ((String, CGRect?) -> Void)?

    private var selectionTimer: Timer?
    private var lastSelectionText: String = ""

    init(navigator: EPUBNavigatorViewController) {
        self.navigator = navigator
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        addChild(navigator)
        navigator.view.frame = view.bounds
        navigator.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(navigator.view)
        navigator.didMove(toParent: self)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        startSelectionObservation()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        stopSelectionObservation()
    }

    /// Suppress the default edit menu so our floating toolbar is the only UI
    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        return false
    }

    // MARK: - Selection Observation

    private func startSelectionObservation() {
        selectionTimer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in
            self?.checkSelection()
        }
    }

    private func stopSelectionObservation() {
        selectionTimer?.invalidate()
        selectionTimer = nil
    }

    private func checkSelection() {
        guard let selection = navigator.currentSelection else {
            lastSelectionText = ""
            return
        }
        let text = selection.locator.text.highlight ?? ""
        guard !text.isEmpty, text != lastSelectionText else { return }
        lastSelectionText = text
        onHighlightRequested?(selection.locator, text, selection.frame)
    }

    /// Apply highlight decorations to the navigator
    func applyHighlightDecorations(_ highlights: [BookHighlight]) {
        let decorations: [Decoration] = highlights.compactMap { highlight in
            guard let locator = Self.deserializeLocator(highlight.locatorJSON) else { return nil }
            return Decoration(
                id: Decoration.Id(highlight.id),
                locator: locator,
                style: .highlight(tint: highlight.uiColor, isActive: false)
            )
        }
        navigator.apply(decorations: decorations, in: "user-highlights")
    }

    /// Observe taps on existing highlight decorations
    func observeHighlightTaps() {
        navigator.observeDecorationInteractions(inGroup: "user-highlights") { [weak self] event in
            let highlightId = event.decoration.id
            self?.onHighlightTapped?(highlightId, event.rect)
        }
    }

    static func serializeLocator(_ locator: Locator) -> String? {
        locator.jsonString
    }

    static func deserializeLocator(_ json: String) -> Locator? {
        try? Locator(jsonString: json)
    }
}

// MARK: - Container Wrapper (UIViewControllerRepresentable)

struct EPUBNavigatorContainerWrapper: UIViewControllerRepresentable {
    let container: EPUBNavigatorContainer
    let highlights: [BookHighlight]

    func makeUIViewController(context: Context) -> EPUBNavigatorContainer {
        container
    }

    func updateUIViewController(_ uiViewController: EPUBNavigatorContainer, context: Context) {
        uiViewController.applyHighlightDecorations(highlights)
    }
}

// MARK: - EPUB Reader View

struct EPUBReaderView: View {
    let book: DownloadedBook

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Environment(ReaderSettings.self) private var readerSettings
    @State private var readerState: ReaderState = .loading
    @State private var showingSettings = false
    @State private var publication: Publication?
    @State private var container: EPUBNavigatorContainer?
    @State private var currentLocator: Locator?
    @State private var showingTOC = false
    @State private var showingHighlights = false
    @State private var readerDelegate: EPUBReaderDelegate?

    // Position tracking
    @State private var totalPositions: Int = 0

    // Highlighting state
    @State private var highlights: [BookHighlight] = []
    @State private var showingFloatingToolbar = false
    @State private var showingCustomColorPicker = false
    @State private var customColor: SwiftUI.Color = .yellow
    @State private var selectionFrame: CGRect?
    @State private var pendingHighlightLocator: Locator?
    @State private var pendingHighlightText: String = ""

    // Note input state
    @State private var showingNoteInput = false
    @State private var noteInputText = ""
    @State private var noteInputColor = "#ffff00"
    @State private var editingHighlight: BookHighlight?
    @State private var tappedHighlight: BookHighlight?

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
                    Text("Loading EPUB...")
                        .foregroundStyle(.secondary)
                }
            case .ready:
                if let container = container {
                    GeometryReader { geometry in
                        ZStack {
                            VStack(spacing: 0) {
                                EPUBNavigatorContainerWrapper(
                                    container: container,
                                    highlights: highlights
                                )

                                // Progress bar at bottom
                                VStack(spacing: 4) {
                                    ProgressView(value: currentLocator?.locations.totalProgression ?? 0)
                                        .tint(.blue)

                                    HStack {
                                        if let title = currentLocator?.title, !title.isEmpty {
                                            Text(title)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                                .lineLimit(1)
                                        }
                                        Spacer()
                                        if let position = currentLocator?.locations.position, totalPositions > 0 {
                                            Text("Page \(position) of \(totalPositions)")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        } else {
                                            Text("\(Int((currentLocator?.locations.totalProgression ?? 0) * 100))%")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }
                                .padding(.horizontal)
                                .padding(.vertical, 8)
                                .background(Color(uiColor: readerSettings.theme.backgroundColor))
                            }

                            // Floating highlight toolbar
                            if showingFloatingToolbar, let frame = selectionFrame {
                                FloatingHighlightToolbar(
                                    selectionRect: frame,
                                    containerSize: geometry.size,
                                    onSelectColor: { color in
                                        saveHighlight(color: color)
                                        container.navigator.clearSelection()
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
                                        UIPasteboard.general.string = pendingHighlightText
                                        container.navigator.clearSelection()
                                        pendingHighlightLocator = nil
                                        pendingHighlightText = ""
                                        showingFloatingToolbar = false
                                    },
                                    onDismiss: {
                                        container.navigator.clearSelection()
                                        pendingHighlightLocator = nil
                                        pendingHighlightText = ""
                                        showingFloatingToolbar = false
                                    }
                                )
                            }
                        }
                    }
                }
            case .error(let message):
                ContentUnavailableView {
                    Label("Error", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                }
            }
        }
        .navigationTitle(book.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if case .ready = readerState {
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

                        Button {
                            showingTOC = true
                        } label: {
                            Image(systemName: "list.bullet")
                        }
                    }
                }
            }
        }
        .task {
            await loadEPUB()
        }
        .onDisappear {
            saveProgress()
        }
        .sheet(isPresented: $showingTOC) {
            if let publication = publication, let container = container {
                EPUBTOCView(
                    publication: publication,
                    currentLocator: currentLocator,
                    onSelect: { locator in
                        Task {
                            _ = await container.navigator.go(to: locator)
                        }
                        showingTOC = false
                    }
                )
            }
        }
        .sheet(isPresented: $showingHighlights) {
            EPUBHighlightsView(
                highlights: highlights,
                onSelect: { highlight in
                    if let locator = EPUBNavigatorContainer.deserializeLocator(highlight.locatorJSON),
                       let container = container {
                        Task {
                            _ = await container.navigator.go(to: locator)
                        }
                    }
                    showingHighlights = false
                },
                onDelete: { highlight in
                    modelContext.delete(highlight)
                    try? modelContext.save()
                    fetchHighlights()
                },
                onEditNote: { highlight in
                    showingHighlights = false
                    editingHighlight = highlight
                }
            )
        }
        .sheet(isPresented: $showingSettings) {
            ReaderSettingsView(format: .epub)
        }
        .onChange(of: readerSettings.theme) { _, _ in
            container?.navigator.submitPreferences(readerSettings.epubPreferences())
        }
        .onChange(of: readerSettings.fontFamily) { _, _ in
            container?.navigator.submitPreferences(readerSettings.epubPreferences())
        }
        .onChange(of: readerSettings.fontSize) { _, _ in
            container?.navigator.submitPreferences(readerSettings.epubPreferences())
        }
        .onChange(of: readerSettings.lineHeight) { _, _ in
            container?.navigator.submitPreferences(readerSettings.epubPreferences())
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
                        container?.navigator.clearSelection()
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
        .sheet(isPresented: $showingNoteInput) {
            HighlightNoteEditor(
                highlightText: pendingHighlightText,
                note: $noteInputText,
                selectedColor: $noteInputColor,
                onSave: {
                    saveHighlight(color: noteInputColor, note: noteInputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : noteInputText.trimmingCharacters(in: .whitespacesAndNewlines))
                    container?.navigator.clearSelection()
                    showingNoteInput = false
                },
                onCancel: {
                    container?.navigator.clearSelection()
                    pendingHighlightLocator = nil
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
                    modelContext.delete(highlight)
                    try? modelContext.save()
                    fetchHighlights()
                }
            )
            .presentationDetents([.medium, .large])
        }
    }

    private func loadEPUB() async {
        guard let fileURL = book.fileURL else {
            readerState = .error("Could not find the EPUB file")
            return
        }

        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            readerState = .error("EPUB file not found at expected location")
            return
        }

        do {
            let services = ReadiumServices.shared

            guard let absoluteURL = FileURL(url: fileURL) else {
                readerState = .error("Invalid file URL")
                return
            }

            let assetResult = await services.assetRetriever.retrieve(url: absoluteURL)
            guard case .success(let asset) = assetResult else {
                if case .failure(let error) = assetResult {
                    readerState = .error("Failed to retrieve asset: \(error)")
                }
                return
            }

            let pubResult = await services.publicationOpener.open(
                asset: asset,
                allowUserInteraction: false,
                sender: nil
            )

            guard case .success(let pub) = pubResult else {
                if case .failure(let error) = pubResult {
                    readerState = .error("Failed to open EPUB: \(error)")
                }
                return
            }

            self.publication = pub

            // Load total position count for page display
            if case .success(let positions) = await pub.positions() {
                self.totalPositions = positions.count
            }

            // Restore last position if available
            var initialLocator: Locator? = nil
            if let lastPosition = book.lastPosition,
               let locatorData = lastPosition.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: locatorData) as? [String: Any],
               let totalProgression = (json["locations"] as? [String: Any])?["totalProgression"] as? Double {
                initialLocator = await pub.locate(progression: totalProgression)
            }

            // Configure navigator with reader preferences (no edit menu — floating toolbar handles highlighting)
            let config = EPUBNavigatorViewController.Configuration(
                preferences: readerSettings.epubPreferences(),
                editingActions: []
            )

            let nav = try EPUBNavigatorViewController(
                publication: pub,
                initialLocation: initialLocator,
                config: config,
                httpServer: services.httpServer
            )

            // Set up delegate
            let delegate = EPUBReaderDelegate()
            delegate.epubNavigator = nav
            delegate.onLocationChanged = { locator in
                Task { @MainActor in
                    self.currentLocator = locator
                }
            }
            nav.delegate = delegate
            self.readerDelegate = delegate

            // Create container wrapping the navigator
            let cont = EPUBNavigatorContainer(navigator: nav)
            cont.onHighlightRequested = { locator, text, frame in
                self.pendingHighlightLocator = locator
                self.pendingHighlightText = text
                self.selectionFrame = frame
                self.showingFloatingToolbar = true
            }
            cont.onHighlightTapped = { highlightId, _ in
                if let highlight = self.highlights.first(where: { $0.id == highlightId }) {
                    self.tappedHighlight = highlight
                }
            }
            cont.observeHighlightTaps()
            self.container = cont

            // Load existing highlights
            fetchHighlights()

            self.readerState = .ready

        } catch {
            readerState = .error("Failed to open EPUB: \(error.localizedDescription)")
        }
    }

    private func saveProgress() {
        guard let locator = currentLocator else { return }

        let locatorDict: [String: Any] = [
            "href": locator.href.url.absoluteString,
            "type": locator.mediaType.string,
            "title": locator.title ?? "",
            "locations": [
                "progression": locator.locations.progression ?? 0,
                "totalProgression": locator.locations.totalProgression ?? 0
            ]
        ]

        if let data = try? JSONSerialization.data(withJSONObject: locatorDict),
           let string = String(data: data, encoding: .utf8) {
            book.lastPosition = string
        }

        if let progression = locator.locations.totalProgression {
            book.readingProgress = progression
        }

        try? modelContext.save()
    }

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
        guard let locator = pendingHighlightLocator else { return }
        guard let locatorJSON = EPUBNavigatorContainer.serializeLocator(locator) else { return }

        let highlight = BookHighlight(
            bookId: book.id,
            locatorJSON: locatorJSON,
            text: pendingHighlightText,
            note: note,
            color: color,
            progression: locator.locations.totalProgression ?? 0,
            chapterTitle: locator.title
        )

        modelContext.insert(highlight)
        try? modelContext.save()

        pendingHighlightLocator = nil
        pendingHighlightText = ""

        fetchHighlights()
    }
}

// MARK: - EPUB Reader Delegate

class EPUBReaderDelegate: NSObject, EPUBNavigatorDelegate {
    var onLocationChanged: ((Locator) -> Void)?
    weak var epubNavigator: EPUBNavigatorViewController?

    func navigator(_ navigator: any Navigator, didFailToLoadResourceAt href: RelativeURL, withError error: ReadError) {
        print("Failed to load resource at \(href): \(error)")
    }

    func navigator(_ navigator: any Navigator, locationDidChange locator: Locator) {
        onLocationChanged?(locator)
    }

    func navigator(_ navigator: any Navigator, presentError error: NavigatorError) {
        print("Navigator error: \(error)")
    }

    func navigator(_ navigator: VisualNavigator, didTapAt point: CGPoint) {
        guard let epubNav = epubNavigator else { return }
        let width = epubNav.view.bounds.width

        if point.x < width * 0.25 {
            Task { await epubNav.goBackward() }
        } else if point.x > width * 0.75 {
            Task { await epubNav.goForward() }
        }
    }
}

// MARK: - Highlights List View

struct EPUBHighlightsView: View {
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
                                    // Color indicator
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

// MARK: - Edit Note Sheet (shared between EPUB and PDF readers)

struct EditNoteSheet: View {
    let highlight: BookHighlight
    let onSave: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var noteText: String = ""

    var body: some View {
        HighlightNoteEditor(
            highlightText: highlight.text,
            note: $noteText,
            onSave: {
                highlight.note = noteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : noteText.trimmingCharacters(in: .whitespacesAndNewlines)
                onSave()
                dismiss()
            },
            onCancel: {
                dismiss()
            }
        )
        .presentationDetents([.medium, .large])
        .onAppear {
            noteText = highlight.note ?? ""
        }
    }
}

// MARK: - Table of Contents

struct EPUBTOCView: View {
    let publication: Publication
    let currentLocator: Locator?
    let onSelect: (Locator) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var tocItems: [ReadiumShared.Link] = []
    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView("Loading...")
                } else if tocItems.isEmpty {
                    ContentUnavailableView {
                        Label("No Table of Contents", systemImage: "list.bullet")
                    } description: {
                        Text("This EPUB doesn't have a table of contents.")
                    }
                } else {
                    List(tocItems, id: \.href) { link in
                        Button {
                            Task {
                                if let locator = await publication.locate(link) {
                                    onSelect(locator)
                                }
                            }
                        } label: {
                            HStack {
                                Text(link.title ?? "Untitled")
                                    .foregroundStyle(.primary)
                                Spacer()
                                if isCurrentChapter(link) {
                                    Image(systemName: "bookmark.fill")
                                        .foregroundStyle(.blue)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Table of Contents")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .task {
                await loadTOC()
            }
        }
    }

    private func loadTOC() async {
        let result = await publication.tableOfContents()
        if case .success(let items) = result {
            tocItems = items
        }
        isLoading = false
    }

    private func isCurrentChapter(_ link: ReadiumShared.Link) -> Bool {
        guard let current = currentLocator else { return false }
        return link.href == current.href.url.absoluteString
    }
}

#Preview {
    let book = DownloadedBook(
        id: "1",
        title: "Sample EPUB",
        authors: ["Author Name"],
        format: "epub",
        fileSize: 1024000,
        localPath: "books/1.epub"
    )

    NavigationStack {
        EPUBReaderView(book: book)
    }
    .modelContainer(for: [DownloadedBook.self, BookHighlight.self], inMemory: true)
}
