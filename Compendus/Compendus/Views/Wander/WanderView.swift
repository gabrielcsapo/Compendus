//
//  WanderView.swift
//  Compendus
//
//  The Living Library "wander" experience, passage-centric: drift through your
//  library one real passage at a time, every step grounded in a book — the
//  same idea elsewhere, a different take, deeper into the theme, or somewhere
//  else entirely. Seedable ("wander toward…"), saveable (trails), and counted
//  toward topic coverage. No feeds, metrics, or streaks.
//

import SwiftUI
import SwiftData
import CCReader

struct WanderView: View {
    @Environment(APIService.self) private var apiService
    @Environment(AppNavigation.self) private var nav

    // Reader-cover dependencies (all injected at the app root, so available here).
    @Environment(DownloadManager.self) private var downloadManager
    @Environment(AudiobookPlayer.self) private var audiobookPlayer
    @Environment(StorageManager.self) private var storageManager
    @Environment(ReaderSettings.self) private var readerSettings
    @Environment(HighlightColorManager.self) private var highlightColorManager
    @Environment(OnDeviceTranscriptionService.self) private var transcriptionService
    @Environment(ReadAlongService.self) private var readAlongService
    @Environment(KokoroModelManager.self) private var kokoroModelManager
    @Environment(TTSAudioCache.self) private var ttsAudioCache
    @Environment(BackgroundProcessingManager.self) private var backgroundProcessingManager
    @Environment(ComicExtractor.self) private var comicExtractor
    @Environment(\.modelContext) private var modelContext

    @State private var stop: WanderStop?
    @State private var history: [String] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    // Seeded entry ("wander toward…").
    @State private var showingSeek = false
    @State private var seekText = ""

    // Topics / study mode sheet.
    @State private var showingTopics = false

    // Saving the path as a trail.
    @State private var savedTrailTitle: String?

    // Opening a passage in the native reader.
    @State private var bookToRead: DownloadedBook?
    @State private var readerPosition: String?
    @State private var showNotDownloaded = false
    @State private var notDownloadedTitle = ""

    // Interaction log: the visited path and which step kinds were taken.
    @State private var sessionStartedAt = Date()
    @State private var path: [String] = []
    @State private var stepsTaken: [String] = []

    private let night = Color(red: 0.043, green: 0.043, blue: 0.063)
    private let amber = Color(red: 0.92, green: 0.70, blue: 0.30)

    var body: some View {
        ZStack {
            night.ignoresSafeArea()
            content
        }
        #if !targetEnvironment(macCatalyst)
        .overlay(alignment: .topTrailing) { closeButton }
        #endif
        .overlay(alignment: .topLeading) { topLeadingButtons }
        .preferredColorScheme(.dark)
        .fullScreenCover(item: $bookToRead) { book in
            readerCover(for: book)
        }
        .sheet(isPresented: $showingTopics) {
            JourneysView()
        }
        .alert("Not on this device", isPresented: $showNotDownloaded) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Download “\(notDownloadedTitle)” from your library to open this passage.")
        }
        .alert("Wander toward…", isPresented: $showingSeek) {
            TextField("What are you curious about?", text: $seekText)
            Button("Wander") {
                let q = seekText
                seekText = ""
                Task { await start(query: q) }
            }
            Button("Cancel", role: .cancel) { seekText = "" }
        }
        .task {
            if stop == nil { await start() }
        }
        .onAppear { sessionStartedAt = Date() }
        .onDisappear {
            guard !path.isEmpty else { return }
            let startedAt = sessionStartedAt
            let visited = path
            let kinds = stepsTaken
            Task {
                await apiService.logWanderSession(
                    startedAt: startedAt, ideasVisited: visited.count,
                    path: visited, stepsTaken: kinds
                )
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if let errorMessage = errorMessage {
            messageState(title: "Couldn't load wander", detail: errorMessage) {
                Task { await start() }
            }
        } else if let stop = stop {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    passage(stop)
                    if !stop.steps.isEmpty { threadList(stop) }
                }
                .padding(.horizontal, 24)
                .padding(.top, 56)
                .padding(.bottom, 48)
                .opacity(isLoading ? 0.25 : 1)
                .animation(.easeInOut(duration: 0.5), value: stop.passageId)
            }
            .scrollIndicators(.hidden)
            .safeAreaInset(edge: .bottom) { controls }
        } else if isLoading {
            ProgressView().tint(.gray)
        } else {
            messageState(
                title: "Your library hasn't been explored yet.",
                detail: "Open a book and run “Analyze for Living Library” to map its ideas, then wander through them here."
            )
        }
    }

    private var closeButton: some View {
        Button {
            nav.selectedTab = 0
        } label: {
            Image(systemName: "xmark")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color(white: 0.6))
                .frame(width: 36, height: 36)
                .background(Color(white: 0.12))
                .clipShape(Circle())
                .overlay(Circle().stroke(Color(white: 0.22), lineWidth: 1))
        }
        .padding(.trailing, 20)
        .padding(.top, 8)
        .accessibilityLabel("Exit wander")
    }

    private var topLeadingButtons: some View {
        HStack(spacing: 10) {
            iconButton("magnifyingglass", label: "Wander toward something") { showingSeek = true }
            iconButton("books.vertical", label: "Topics and study paths") { showingTopics = true }
        }
        .padding(.leading, 20)
        .padding(.top, 8)
    }

    private func iconButton(_ system: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color(white: 0.6))
                .frame(width: 36, height: 36)
                .background(Color(white: 0.12))
                .clipShape(Circle())
                .overlay(Circle().stroke(Color(white: 0.22), lineWidth: 1))
        }
        .accessibilityLabel(label)
    }

    private func passage(_ stop: WanderStop) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text((stop.topicLabel?.components(separatedBy: ",").first ?? "FROM YOUR LIBRARY").uppercased())
                .font(.system(size: 12, weight: .semibold))
                .tracking(3)
                .foregroundStyle(amber.opacity(0.8))
                .padding(.bottom, 20)

            Text(stop.text.count > 900 ? String(stop.text.prefix(900)) + "…" : stop.text)
                .font(.system(size: 19, design: .serif))
                .lineSpacing(7)
                .foregroundStyle(Color(white: 0.88))
                .padding(.bottom, 20)

            Button {
                openPassage(stop)
            } label: {
                Text("— \(stop.bookTitle)\(stop.chapterTitle.map { " · \($0)" } ?? "")  →")
                    .font(.system(size: 14))
                    .foregroundStyle(amber.opacity(0.85))
            }
            .buttonStyle(.plain)

            if !stop.entities.isEmpty {
                FlowChips(entities: stop.entities)
                    .padding(.top, 18)
            }
        }
        .padding(.bottom, 48)
    }

    private func threadList(_ stop: WanderStop) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("WANDER ON")
                .font(.system(size: 12, weight: .regular))
                .tracking(3)
                .foregroundStyle(Color(white: 0.38))
                .padding(.bottom, 4)

            ForEach(stop.steps) { step in
                Button {
                    Task { await goTo(step.passageId, recordKind: step.kind) }
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(step.kindLabel) · \(step.bookTitle)".uppercased())
                            .font(.system(size: 11))
                            .tracking(1)
                            .foregroundStyle(Color(white: 0.42))
                            .lineLimit(1)
                        Text(step.snippet)
                            .font(.system(size: 16, design: .serif))
                            .foregroundStyle(Color(white: 0.85))
                            .multilineTextAlignment(.leading)
                            .lineLimit(4)
                        Text(step.reason)
                            .font(.system(size: 13))
                            .foregroundStyle(Color(white: 0.5))
                            .multilineTextAlignment(.leading)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(18)
                    .background(Color(white: 0.1).opacity(0.5))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(white: 0.18), lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var controls: some View {
        HStack(spacing: 24) {
            if !history.isEmpty {
                Button {
                    Task { await back() }
                } label: {
                    Text("← back").foregroundStyle(Color(white: 0.5))
                }
            }
            if path.count > 2 {
                Button {
                    Task { await saveTrail() }
                } label: {
                    Text(savedTrailTitle.map { "saved: \($0)" } ?? "save trail")
                        .foregroundStyle(Color(white: 0.5))
                }
            }
            Button {
                Task { await start() }
            } label: {
                Text("drift somewhere else →").foregroundStyle(amber.opacity(0.85))
            }
        }
        .font(.system(size: 15))
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity)
        .background(night.opacity(0.92))
    }

    private func messageState(
        title: String,
        detail: String,
        retry: (@MainActor () -> Void)? = nil
    ) -> some View {
        VStack(spacing: 16) {
            Text(title)
                .font(.system(size: 24, design: .serif))
                .foregroundStyle(Color(white: 0.9))
                .multilineTextAlignment(.center)
            Text(detail)
                .font(.system(size: 15))
                .foregroundStyle(Color(white: 0.5))
                .multilineTextAlignment(.center)
            if let retry {
                Button("Try Again", action: retry)
                    .buttonStyle(.borderedProminent)
                    .tint(Color(white: 0.3))
                    .padding(.top, 8)
            }
        }
        .padding(40)
    }

    // MARK: - Data

    private func start(query: String? = nil) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let response = try await apiService.fetchWanderStart(query: query)
            if let next = response.stop {
                if let current = stop {
                    history.append(current.passageId)
                    stepsTaken.append("leave")
                }
                show(next)
            } else if stop == nil {
                errorMessage = nil // substrate not built — empty state renders
            }
        } catch {
            if stop == nil { errorMessage = error.localizedDescription }
        }
    }

    private func goTo(_ passageId: String, recordKind: String?) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await apiService.fetchWanderStop(passageId: passageId, visited: path)
            if let next = response.stop {
                if let current = stop, current.passageId != next.passageId {
                    history.append(current.passageId)
                }
                if let recordKind { stepsTaken.append(recordKind) }
                show(next)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func back() async {
        guard let previous = history.popLast() else { return }
        isLoading = true
        defer { isLoading = false }
        if let response = try? await apiService.fetchWanderStop(passageId: previous, visited: path),
           let next = response.stop {
            stop = next
            savedTrailTitle = nil
        }
    }

    private func show(_ next: WanderStop) {
        stop = next
        path.append(next.passageId)
        savedTrailTitle = nil
        errorMessage = nil
    }

    private func saveTrail() async {
        guard let response = try? await apiService.saveTrail(path: path), response.success else { return }
        savedTrailTitle = response.title
    }

    // MARK: - Open passage in reader

    private func openPassage(_ stop: WanderStop) {
        guard let downloaded = downloadManager.getDownloadedBook(id: stop.bookId, modelContext: modelContext)
        else {
            notDownloadedTitle = stop.bookTitle
            showNotDownloaded = true
            return
        }
        readerPosition = locatorJSON(spineIndex: stop.spineIndex, progress: stop.chapterProgress)
        bookToRead = downloaded
    }

    private func locatorJSON(spineIndex: Int?, progress: Double?) -> String? {
        guard let spineIndex, let progress else { return nil }
        let dict: [String: Any] = ["type": "epub", "spineIndex": spineIndex, "progress": progress]
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let json = String(data: data, encoding: .utf8)
        else { return nil }
        return json
    }

    @ViewBuilder
    private func readerCover(for book: DownloadedBook) -> some View {
        ReaderContainerView(book: book, initialPosition: readerPosition)
            .environment(readerSettings)
            .environment(highlightColorManager)
            .environment(readAlongService)
            .environment(audiobookPlayer)
            .environment(transcriptionService)
            .environment(apiService)
            .environment(storageManager)
            .environment(kokoroModelManager)
            .environment(ttsAudioCache)
            .environment(backgroundProcessingManager)
            .environment(comicExtractor)
            .modelContext(modelContext)
    }
}

/// Entity chips below the passage — light, wrapping, non-blocking.
private struct FlowChips: View {
    let entities: [StopEntity]

    var body: some View {
        // Simple wrapping layout: chips flow onto new lines as needed.
        FlexibleChipLayout(spacing: 8) {
            ForEach(entities) { entity in
                Text(entity.name)
                    .font(.system(size: 12))
                    .foregroundStyle(Color(white: 0.55))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .overlay(Capsule().stroke(Color(white: 0.22), lineWidth: 1))
            }
        }
    }
}

/// Minimal wrapping layout for chips (Layout protocol, iOS 16+).
private struct FlexibleChipLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > maxWidth {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: maxWidth == .infinity ? x : maxWidth, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: .unspecified)
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
