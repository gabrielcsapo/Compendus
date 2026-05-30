//
//  WanderView.swift
//  Compendus
//
//  The Living Library "wander" experience: a calm, source-grounded way to drift
//  through the ideas, people, and places across your library — one idea at a
//  time, every thread rooted in a real passage. No feeds, metrics, or streaks.
//

import SwiftUI
import SwiftData
import EPUBReader

struct WanderView: View {
    @Environment(APIService.self) private var apiService
    @Environment(AppNavigation.self) private var nav

    // Reader-cover dependencies (all injected at the app root, so available here).
    // Mirrors the set BookDetailView forwards into ReaderContainerView.
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

    @State private var entity: GraphEntity?
    @State private var steps: [WanderStep] = []
    @State private var pool: [GraphEntity] = []
    @State private var history: [String] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    // Opening a passage in the native reader.
    @State private var bookToRead: DownloadedBook?
    @State private var readerPosition: String?
    @State private var showNotDownloaded = false
    @State private var notDownloadedTitle = ""

    // Activity tracking: time + ideas surfaced this visit, logged on disappear.
    @State private var sessionStartedAt = Date()
    @State private var ideasVisited = 0

    private let night = Color(red: 0.043, green: 0.043, blue: 0.063)
    private let amber = Color(red: 0.92, green: 0.70, blue: 0.30)

    var body: some View {
        ZStack {
            night.ignoresSafeArea()
            content
        }
        .overlay(alignment: .topTrailing) { closeButton }
        .preferredColorScheme(.dark)
        .fullScreenCover(item: $bookToRead) { book in
            readerCover(for: book)
        }
        .alert("Not on this device", isPresented: $showNotDownloaded) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Download “\(notDownloadedTitle)” from your library to open this passage.")
        }
        .task {
            if pool.isEmpty { await start() }
        }
        .onAppear {
            sessionStartedAt = Date()
            ideasVisited = entity == nil ? 0 : 1
        }
        .onDisappear {
            guard ideasVisited > 0 else { return }
            let startedAt = sessionStartedAt
            let count = ideasVisited
            Task { await apiService.logWanderSession(startedAt: startedAt, ideasVisited: count) }
        }
    }

    @ViewBuilder
    private var content: some View {
        if let errorMessage = errorMessage {
            messageState(title: "Couldn't load the library", detail: errorMessage)
        } else if let entity = entity {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    idea(entity)
                    if !threads.isEmpty { threadList }
                }
                .padding(.horizontal, 24)
                .padding(.top, 56)
                .padding(.bottom, 48)
                .opacity(isLoading ? 0.25 : 1)
                .animation(.easeInOut(duration: 0.5), value: entity.id)
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

    private func idea(_ entity: GraphEntity) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(typeLine(entity))
                .font(.system(size: 12, weight: .semibold))
                .tracking(3)
                .foregroundStyle(amber.opacity(0.8))
                .padding(.bottom, 16)

            Text(entity.canonicalName)
                .font(.system(size: 40, weight: .regular, design: .serif))
                .foregroundStyle(Color(white: 0.95))
                .padding(.bottom, 28)

            if let snippet = entity.mentions?.first {
                Button {
                    openPassage(snippet)
                } label: {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(snippet.snippet)
                            .font(.system(size: 19, design: .serif))
                            .lineSpacing(6)
                            .foregroundStyle(Color(white: 0.78))
                        Text("— \(snippet.bookTitle)\(snippet.chapterTitle.map { " · \($0)" } ?? "")")
                            .font(.system(size: 14))
                            .foregroundStyle(Color(white: 0.5))
                        Text("Open passage →")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(amber.opacity(0.85))
                            .padding(.top, 2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, 18)
                    .overlay(alignment: .leading) {
                        Rectangle().fill(Color(white: 0.3)).frame(width: 1)
                    }
                }
                .buttonStyle(.plain)
            } else {
                Text("Mentioned across your library.")
                    .font(.system(size: 17))
                    .foregroundStyle(Color(white: 0.5))
            }
        }
        .padding(.bottom, 56)
    }

    private var threadList: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("WANDER ON")
                .font(.system(size: 12, weight: .regular))
                .tracking(3)
                .foregroundStyle(Color(white: 0.38))
                .padding(.bottom, 4)

            ForEach(threads) { step in
                Button {
                    if let id = step.entityId { Task { await goTo(id, from: entity?.id) } }
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(kindLabel(step.kind)) · \(step.entityType ?? "")".uppercased())
                            .font(.system(size: 11))
                            .tracking(1)
                            .foregroundStyle(Color(white: 0.42))
                        Text(step.entityName ?? "")
                            .font(.system(size: 21, design: .serif))
                            .foregroundStyle(Color(white: 0.9))
                        Text(step.reason)
                            .font(.system(size: 14))
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
        HStack(spacing: 28) {
            if !history.isEmpty {
                Button {
                    Task { await back() }
                } label: {
                    Text("← back").foregroundStyle(Color(white: 0.5))
                }
            }
            Button {
                Task { await drift() }
            } label: {
                Text("drift somewhere else →").foregroundStyle(amber.opacity(0.85))
            }
        }
        .font(.system(size: 15))
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity)
        .background(night.opacity(0.92))
    }

    private func messageState(title: String, detail: String) -> some View {
        VStack(spacing: 16) {
            Text(title)
                .font(.system(size: 24, design: .serif))
                .foregroundStyle(Color(white: 0.9))
                .multilineTextAlignment(.center)
            Text(detail)
                .font(.system(size: 15))
                .foregroundStyle(Color(white: 0.5))
                .multilineTextAlignment(.center)
        }
        .padding(40)
    }

    // MARK: - Data

    private var threads: [WanderStep] { steps.filter { $0.entityId != nil } }

    private func start() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let list = try await apiService.fetchEntities(limit: 60)
            pool = list.entities
            guard !pool.isEmpty else { return }
            let topTier = Array(pool.prefix(25))
            let pick = topTier.randomElement() ?? pool[0]
            try await load(pick.id)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func goTo(_ id: String, from previous: String?) async {
        isLoading = true
        defer { isLoading = false }
        do {
            if let previous = previous { history.append(previous) }
            try await load(id)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func drift() async {
        guard !pool.isEmpty else { return }
        var pick = pool.randomElement()!
        if pick.id == entity?.id, pool.count > 1 {
            pick = pool.first { $0.id != entity?.id } ?? pick
        }
        await goTo(pick.id, from: entity?.id)
    }

    private func back() async {
        guard let previous = history.popLast() else { return }
        await goTo(previous, from: nil)
    }

    private func load(_ id: String) async throws {
        async let detail = apiService.fetchEntity(id: id)
        async let wander = apiService.fetchWander(entityId: id, limit: 6)
        entity = try await detail.entity
        steps = try await wander.steps
        ideasVisited += 1
    }

    // MARK: - Open passage in reader

    /// Open the passage's book in the native reader at a chapter-anchored locator.
    /// Requires the book to be downloaded on device; otherwise prompts to download.
    private func openPassage(_ mention: EntityMention) {
        guard let downloaded = downloadManager.getDownloadedBook(id: mention.bookId, modelContext: modelContext)
        else {
            notDownloadedTitle = mention.bookTitle
            showNotDownloaded = true
            return
        }
        readerPosition = locatorJSON(for: mention)
        bookToRead = downloaded
    }

    /// Build the native reader's EPUB locator JSON from a mention. Prefers the
    /// chapter-anchored {spineIndex, progress} pair (the engine reads `progress`
    /// as within-chapter progression); returns nil to resume at the saved spot
    /// when the chapter anchor isn't available.
    private func locatorJSON(for mention: EntityMention) -> String? {
        guard let spine = mention.spineIndex, let progress = mention.chapterProgress else { return nil }
        let dict: [String: Any] = ["type": "epub", "spineIndex": spine, "progress": progress]
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

    // MARK: - Labels

    private func typeLine(_ entity: GraphEntity) -> String {
        var line = entity.type.uppercased()
        if let date = entity.dateText { line += " · \(date)" }
        return line
    }

    private func kindLabel(_ kind: String) -> String {
        switch kind {
        case "relationship": return "connected"
        case "co_occurrence": return "appears with"
        case "semantic": return "feels related"
        default: return "related"
        }
    }
}
