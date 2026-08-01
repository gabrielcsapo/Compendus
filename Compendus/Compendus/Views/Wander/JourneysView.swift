//
//  JourneysView.swift
//  Compendus
//
//  Pods — compact, source-grounded learning sessions shared with the web app.
//  The filename and root type stay stable so existing navigation keeps compiling.
//

import SwiftUI
import SwiftData
import CCReader

private let podNight = Color(red: 0.043, green: 0.043, blue: 0.063)
private let podAmber = Color(red: 0.92, green: 0.70, blue: 0.30)

// MARK: - Pods collection

struct JourneysView: View {
    @Environment(APIService.self) private var apiService
    @Environment(\.dismiss) private var dismiss

    @State private var pods: [PodSummary] = []
    @State private var total = 0
    @State private var isLoading = true
    @State private var errorMessage: String?

    @State private var searchText = ""
    @State private var searchResults: [PodSummary]?
    @State private var isSearching = false
    @State private var searchError: String?

    private var normalizedSearch: String {
        searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var displayedPods: [PodSummary] {
        searchResults ?? pods
    }

    var body: some View {
        NavigationStack {
            ZStack {
                podNight.ignoresSafeArea()
                content
            }
            .preferredColorScheme(.dark)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .tint(podAmber)
                }
            }
            .navigationDestination(for: PodSummary.self) { pod in
                PodSessionView(pod: pod)
            }
        }
        .task {
            if pods.isEmpty { await loadPods() }
        }
        .task(id: normalizedSearch) {
            await runSearch(normalizedSearch)
        }
    }

    @ViewBuilder
    private var content: some View {
        if let errorMessage, pods.isEmpty {
            messageState(title: "Couldn't load Pods", detail: errorMessage) {
                Task { await loadPods() }
            }
        } else if isLoading && pods.isEmpty {
            loadingState
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    header

                    if isSearching {
                        HStack(spacing: 8) {
                            ProgressView().tint(podAmber)
                            Text("Searching your library…")
                                .font(.footnote)
                                .foregroundStyle(Color(white: 0.5))
                        }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 16)
                    }

                    if let searchError {
                        Text(searchError)
                            .font(.footnote)
                            .foregroundStyle(.red.opacity(0.8))
                            .padding(.horizontal, 20)
                            .padding(.bottom, 16)
                    }

                    if displayedPods.isEmpty && !isSearching {
                        messageState(
                            title: normalizedSearch.isEmpty
                                ? "No Pods are ready yet."
                                : "No ready Pods found.",
                            detail: normalizedSearch.isEmpty
                                ? "Analyze a few nonfiction books to build source-grounded sessions."
                                : "Try a broader subject or a phrase from one of your books."
                        )
                        .frame(maxWidth: .infinity)
                    } else {
                        LazyVStack(spacing: 14) {
                            ForEach(displayedPods) { pod in
                                NavigationLink(value: pod) {
                                    PodCard(pod: pod)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 48)
                    }
                }
            }
            .scrollIndicators(.hidden)
            .refreshable {
                guard normalizedSearch.isEmpty else { return }
                await loadPods()
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Pods")
                    .font(.system(size: 34, weight: .semibold, design: .serif))
                    .foregroundStyle(Color(white: 0.94))
                Text("Verified passages from your books, followed by source-grounded checks.")
                    .font(.system(size: 16, design: .serif))
                    .foregroundStyle(Color(white: 0.52))
                if total > 0, normalizedSearch.isEmpty {
                    Text("\(total) available")
                        .font(.caption)
                        .foregroundStyle(Color(white: 0.38))
                }
            }

            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(Color(white: 0.45))
                TextField("Find a Pod…", text: $searchText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .foregroundStyle(Color(white: 0.9))
                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(Color(white: 0.4))
                    }
                    .accessibilityLabel("Clear Pod search")
                }
            }
            .padding(.horizontal, 14)
            .frame(height: 44)
            .background(Color.white.opacity(0.07))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Color.white.opacity(0.1), lineWidth: 1)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 22)
    }

    private var loadingState: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                LazyVStack(spacing: 14) {
                    ForEach(0..<4, id: \.self) { index in
                        VStack(alignment: .leading, spacing: 12) {
                            RoundedRectangle(cornerRadius: 4)
                                .fill(Color.white.opacity(0.12))
                                .frame(width: index.isMultiple(of: 2) ? 170 : 220, height: 21)
                            RoundedRectangle(cornerRadius: 4)
                                .fill(Color.white.opacity(0.07))
                                .frame(height: 14)
                            RoundedRectangle(cornerRadius: 4)
                                .fill(Color.white.opacity(0.07))
                                .frame(width: 210, height: 13)
                        }
                        .padding(20)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.white.opacity(0.045))
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                }
                .padding(.horizontal, 20)
            }
        }
        .scrollDisabled(true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading Pods")
    }

    private func messageState(
        title: String,
        detail: String,
        retry: (@MainActor () -> Void)? = nil
    ) -> some View {
        VStack(spacing: 14) {
            Text(title)
                .font(.system(size: 23, design: .serif))
                .foregroundStyle(Color(white: 0.9))
                .multilineTextAlignment(.center)
            Text(detail)
                .font(.system(size: 15))
                .foregroundStyle(Color(white: 0.5))
                .multilineTextAlignment(.center)
            if let retry {
                Button("Try Again", action: retry)
                    .buttonStyle(.borderedProminent)
                    .tint(Color(white: 0.28))
            }
        }
        .padding(40)
    }

    private func loadPods() async {
        isLoading = true
        errorMessage = nil
        do {
            let response = try await apiService.fetchPods()
            try Task.checkCancellation()
            pods = response.pods
            total = response.total
            isLoading = false
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }

    private func runSearch(_ query: String) async {
        searchError = nil
        guard !query.isEmpty else {
            searchResults = nil
            isSearching = false
            return
        }

        isSearching = true
        do {
            try await Task.sleep(for: .milliseconds(300))
            let response = try await apiService.searchPods(query: query)
            try Task.checkCancellation()
            guard normalizedSearch == query else { return }
            searchResults = response.pods
            isSearching = false
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled, normalizedSearch == query else { return }
            searchResults = []
            searchError = error.localizedDescription
            isSearching = false
        }
    }
}

private struct PodCard: View {
    let pod: PodSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            Text(pod.title)
                .font(.system(size: 21, weight: .medium, design: .serif))
                .foregroundStyle(Color(white: 0.92))
                .multilineTextAlignment(.leading)
                .lineLimit(2)

            if let description = pod.description, !description.isEmpty {
                Text(description)
                    .font(.system(size: 14, design: .serif))
                    .foregroundStyle(Color(white: 0.58))
                    .lineLimit(3)
            }

            HStack(spacing: 7) {
                Text("\(pod.passageCount) passages")
                Text("·")
                Text("\(pod.bookCount) book\(pod.bookCount == 1 ? "" : "s")")
                if let questionCount = pod.questionCount {
                    Text("·")
                    Text("\(questionCount) check\(questionCount == 1 ? "" : "s")")
                }
            }
            .font(.caption)
            .foregroundStyle(Color(white: 0.4))
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.055))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Color.white.opacity(0.1), lineWidth: 1)
        }
    }
}

// MARK: - Compact Pod session

private struct PodSessionView: View {
    @Environment(APIService.self) private var apiService
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

    let pod: PodSummary

    @State private var response: PodSessionResponse?
    @State private var isLoading = true
    @State private var errorMessage: String?

    @State private var bookToRead: DownloadedBook?
    @State private var readerPosition: String?
    @State private var showNotDownloaded = false
    @State private var notDownloadedTitle = ""

    var body: some View {
        ZStack {
            podNight.ignoresSafeArea()
            content
        }
        .preferredColorScheme(.dark)
        .navigationTitle(response?.session.title ?? pod.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task(id: pod.id) {
            await loadSession()
        }
        .fullScreenCover(item: $bookToRead) { book in
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
        .alert("Not on this device", isPresented: $showNotDownloaded) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Download “\(notDownloadedTitle)” from Library to open the exact source.")
        }
    }

    @ViewBuilder
    private var content: some View {
        if let errorMessage {
            sessionMessage(title: "Couldn't load this Pod", detail: errorMessage) {
                Task { await loadSession() }
            }
        } else if isLoading {
            VStack(spacing: 12) {
                ProgressView().tint(podAmber)
                Text("Building a source session…")
                    .font(.footnote)
                    .foregroundStyle(Color(white: 0.5))
            }
        } else if let response {
            sessionScroll(response)
        } else {
            sessionMessage(title: "This Pod is empty.", detail: "There are no readable source cards yet.")
        }
    }

    private func sessionScroll(_ payload: PodSessionResponse) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                sessionHeader(payload.session)

                ForEach(orderedModules(payload.session), id: \.self) { module in
                    Text(module.uppercased())
                        .font(.system(size: 11, weight: .semibold))
                        .tracking(2.4)
                        .foregroundStyle(Color(white: 0.42))
                        .padding(.top, 22)
                        .padding(.bottom, 10)

                    ForEach(payload.session.items.filter { $0.module == module }) { item in
                        PodPassageCard(item: item, total: payload.session.items.count) {
                            openSource(item.source)
                        }
                        .padding(.bottom, 12)

                        ForEach(payload.session.questions.filter { $0.afterOrdinal == item.ordinal }) { question in
                            PodQuestionCard(
                                podId: pod.id,
                                revision: payload.session.revision,
                                question: question
                            ) { source in
                                openSource(source)
                            }
                            .padding(.vertical, 8)
                        }
                    }
                }

                if !payload.adjacent.isEmpty {
                    Text("KEEP LEARNING")
                        .font(.system(size: 11, weight: .semibold))
                        .tracking(2.4)
                        .foregroundStyle(Color(white: 0.42))
                        .padding(.top, 30)
                        .padding(.bottom, 10)

                    ForEach(payload.adjacent.prefix(3)) { adjacent in
                        NavigationLink(value: adjacent) {
                            HStack {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(adjacent.title)
                                        .font(.system(size: 16, weight: .medium, design: .serif))
                                        .foregroundStyle(Color(white: 0.86))
                                        .lineLimit(2)
                                    Text("\(adjacent.bookCount) books")
                                        .font(.caption)
                                        .foregroundStyle(Color(white: 0.4))
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(podAmber.opacity(0.7))
                            }
                            .padding(15)
                            .background(Color.white.opacity(0.045))
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .padding(.bottom, 8)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 52)
        }
        .scrollIndicators(.hidden)
    }

    private func sessionHeader(_ session: PodSession) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(session.title)
                .font(.system(size: 30, weight: .semibold, design: .serif))
                .foregroundStyle(Color(white: 0.94))

            Text("\(session.items.count) passages · \(session.questions.count) recall check\(session.questions.count == 1 ? "" : "s")")
                .font(.subheadline)
                .foregroundStyle(Color(white: 0.5))

            HStack(spacing: 9) {
                PodProgressBar(fraction: session.items.isEmpty ? 0 : Double(session.seenCount) / Double(session.items.count))
                    .frame(height: 3)
                Text("\(session.seenCount) revisited")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(podAmber.opacity(0.8))
            }
        }
        .padding(.top, 18)
        .padding(.bottom, 6)
    }

    private func orderedModules(_ session: PodSession) -> [String] {
        session.items.reduce(into: [String]()) { modules, item in
            if !modules.contains(item.module) { modules.append(item.module) }
        }
    }

    private func loadSession() async {
        isLoading = true
        errorMessage = nil
        response = nil
        do {
            let loaded = try await apiService.fetchPodSession(podId: pod.id)
            try Task.checkCancellation()
            guard loaded.session.podId == pod.id else { return }
            response = loaded
            isLoading = false
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }

    private func openSource(_ source: SourceLocator) {
        guard let book = downloadManager.getDownloadedBook(id: source.bookId, modelContext: modelContext) else {
            notDownloadedTitle = source.bookTitle
            showNotDownloaded = true
            return
        }
        readerPosition = sourcePosition(source)
        bookToRead = book
    }

    private func sourcePosition(_ source: SourceLocator) -> String? {
        var locator: [String: Any]
        if let spineIndex = source.spineIndex {
            locator = ["type": "epub", "spineIndex": spineIndex]
            if let charStart = source.charStart { locator["charOffset"] = charStart }
        } else if let page = source.page {
            locator = ["type": "pdf", "page": page]
        } else {
            return nil
        }
        guard let data = try? JSONSerialization.data(withJSONObject: locator) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func sessionMessage(
        title: String,
        detail: String,
        retry: (@MainActor () -> Void)? = nil
    ) -> some View {
        VStack(spacing: 14) {
            Text(title)
                .font(.system(size: 23, design: .serif))
                .foregroundStyle(Color(white: 0.9))
                .multilineTextAlignment(.center)
            Text(detail)
                .font(.system(size: 15))
                .foregroundStyle(Color(white: 0.5))
                .multilineTextAlignment(.center)
            if let retry {
                Button("Try Again", action: retry)
                    .buttonStyle(.borderedProminent)
                    .tint(Color(white: 0.28))
            }
        }
        .padding(40)
    }
}

private struct PodProgressBar: View {
    let fraction: Double

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.1))
                Capsule()
                    .fill(podAmber.opacity(0.85))
                    .frame(width: max(0, min(1, fraction)) * geometry.size.width)
            }
        }
    }
}

private struct PodPassageCard: View {
    let item: PodSessionItem
    let total: Int
    let onOpenSource: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("\(item.ordinal) OF \(total)")
                    .font(.caption2.weight(.semibold).monospacedDigit())
                    .tracking(1.4)
                    .foregroundStyle(podAmber.opacity(0.8))
                Spacer()
                if item.seen {
                    Label("Revisited", systemImage: "checkmark.circle.fill")
                        .font(.caption2)
                        .foregroundStyle(Color(white: 0.42))
                }
            }

            if !item.transition.isEmpty {
                Text(item.transition)
                    .font(.system(size: 14, design: .serif))
                    .italic()
                    .foregroundStyle(podAmber.opacity(0.72))
            }

            Text(item.snippet)
                .font(.system(size: 18, design: .serif))
                .lineSpacing(5)
                .foregroundStyle(Color(white: 0.88))
                .fixedSize(horizontal: false, vertical: true)

            Divider().overlay(Color.white.opacity(0.1))

            HStack(alignment: .firstTextBaseline, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.source.bookTitle)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color(white: 0.62))
                        .lineLimit(1)
                    Text([item.source.locationLabel, item.role.replacingOccurrences(of: "_", with: " ")]
                        .compactMap { $0 }
                        .joined(separator: " · "))
                        .font(.caption2)
                        .foregroundStyle(Color(white: 0.38))
                        .lineLimit(1)
                }
                Spacer()
                Button("Open in reader", action: onOpenSource)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(podAmber)
            }
        }
        .padding(18)
        .background(Color.white.opacity(0.055))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Color.white.opacity(0.1), lineWidth: 1)
        }
    }
}

private struct PodQuestionCard: View {
    @Environment(APIService.self) private var apiService

    let podId: String
    let revision: String
    let question: PodQuestion
    let onOpenSource: (SourceLocator) -> Void

    @State private var selectedChoiceId: String?
    @State private var result: PodAttemptResult?
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var requestToken = UUID()
    @State private var attemptId: UUID?
    @State private var attemptTask: Task<Void, Never>?

    init(
        podId: String,
        revision: String,
        question: PodQuestion,
        onOpenSource: @escaping (SourceLocator) -> Void
    ) {
        self.podId = podId
        self.revision = revision
        self.question = question
        self.onOpenSource = onOpenSource
        _selectedChoiceId = State(initialValue: question.savedAnswer?.selectedChoiceId)
        _result = State(initialValue: question.savedAnswer?.result)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("SOURCE RECALL", systemImage: "questionmark.bubble")
                .font(.caption2.weight(.semibold))
                .tracking(1.5)
                .foregroundStyle(podAmber.opacity(0.82))

            Text(question.prompt)
                .font(.system(size: 18, weight: .medium, design: .serif))
                .foregroundStyle(Color(white: 0.92))
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 9) {
                ForEach(question.choices) { choice in
                    Button {
                        submit(choice.id)
                    } label: {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: choiceIcon(choice.id))
                                .foregroundStyle(choiceColor(choice.id))
                                .padding(.top, 1)
                            Text(choice.text)
                                .font(.system(size: 14, design: .serif))
                                .foregroundStyle(Color(white: 0.82))
                                .multilineTextAlignment(.leading)
                            Spacer(minLength: 0)
                            if isSubmitting, selectedChoiceId == choice.id {
                                ProgressView().controlSize(.small).tint(podAmber)
                            }
                        }
                        .padding(13)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(choiceBackground(choice.id))
                        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 11, style: .continuous)
                                .stroke(choiceColor(choice.id).opacity(selectedChoiceId == choice.id ? 0.7 : 0.15), lineWidth: 1)
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(isSubmitting || result?.correct == true)
                }
            }

            if let result {
                VStack(alignment: .leading, spacing: 10) {
                    Label(
                        result.feedback,
                        systemImage: result.correct ? "checkmark.circle.fill" : "book.pages.fill"
                    )
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(result.correct ? Color.green.opacity(0.86) : podAmber)

                    if !result.correct {
                        Text(result.evidence.excerpt)
                            .font(.system(size: 15, design: .serif))
                            .lineSpacing(4)
                            .foregroundStyle(Color(white: 0.82))
                            .fixedSize(horizontal: false, vertical: true)

                        VStack(alignment: .leading, spacing: 3) {
                            Text(result.evidence.bookTitle)
                                .font(.caption.weight(.semibold))
                            if let location = result.evidence.source.locationLabel {
                                Text(location).font(.caption2)
                            }
                        }
                        .foregroundStyle(Color(white: 0.48))

                        Button {
                            onOpenSource(result.evidence.source)
                        } label: {
                            Label("Open in reader", systemImage: "book")
                                .font(.subheadline.weight(.semibold))
                        }
                        .foregroundStyle(podAmber)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background((result.correct ? Color.green : podAmber).opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red.opacity(0.82))
            }
        }
        .padding(18)
        .background(Color.white.opacity(0.075))
        .clipShape(RoundedRectangle(cornerRadius: 17, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 17, style: .continuous)
                .stroke(podAmber.opacity(0.22), lineWidth: 1)
        }
        .onDisappear { attemptTask?.cancel() }
    }

    private func submit(_ choiceId: String) {
        attemptTask?.cancel()
        let requestAttemptId = selectedChoiceId == choiceId ? (attemptId ?? UUID()) : UUID()
        attemptId = requestAttemptId
        selectedChoiceId = choiceId
        result = nil
        errorMessage = nil
        isSubmitting = true

        let token = UUID()
        requestToken = token
        attemptTask = Task {
            do {
                let response = try await apiService.submitPodAttempt(
                    podId: podId,
                    revision: revision,
                    questionId: question.id,
                    selectedChoiceId: choiceId,
                    attemptId: requestAttemptId.uuidString
                )
                guard !Task.isCancelled, requestToken == token, selectedChoiceId == choiceId else { return }
                result = response.result
                isSubmitting = false
            } catch {
                guard !Task.isCancelled, requestToken == token else { return }
                errorMessage = error.localizedDescription
                isSubmitting = false
            }
        }
    }

    private func choiceIcon(_ id: String) -> String {
        guard selectedChoiceId == id, let result else { return "circle" }
        return result.correct ? "checkmark.circle.fill" : "xmark.circle.fill"
    }

    private func choiceColor(_ id: String) -> Color {
        guard selectedChoiceId == id else { return Color(white: 0.3) }
        guard let result else { return podAmber }
        return result.correct ? .green : .red
    }

    private func choiceBackground(_ id: String) -> Color {
        guard selectedChoiceId == id else { return Color.white.opacity(0.035) }
        guard let result else { return podAmber.opacity(0.08) }
        return (result.correct ? Color.green : Color.red).opacity(0.09)
    }
}
