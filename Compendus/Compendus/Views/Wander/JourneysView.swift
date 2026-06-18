//
//  JourneysView.swift
//  Compendus
//
//  Journeys — "the roads through your library." A first-class, atmospheric
//  surface (sibling of Wander) listing emergent themes as journey cards. Each
//  journey opens a candlelit road: passages are nodes along a vertical line,
//  modules are labeled stretches, the current (first unseen) node glows, seen
//  nodes are checked, and reading a node records coverage.
//

import SwiftUI

// Shared night/candle palette, matching WanderView.
private let journeyNight = Color(red: 0.043, green: 0.043, blue: 0.063)
private let journeyAmber = Color(red: 0.92, green: 0.70, blue: 0.30)

// MARK: - Journeys list

struct JourneysView: View {
    @Environment(APIService.self) private var apiService
    @Environment(\.dismiss) private var dismiss

    @State private var topics: [TopicSummary] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ZStack {
                journeyNight.ignoresSafeArea()
                content
            }
            .preferredColorScheme(.dark)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .overlay(alignment: .topTrailing) {
                Button { dismiss() } label: {
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
                .accessibilityLabel("Close journeys")
            }
        }
        .task {
            if topics.isEmpty { await load() }
        }
    }

    @ViewBuilder
    private var content: some View {
        if let errorMessage {
            messageState(
                title: "Couldn't load Journeys",
                detail: errorMessage
            ) { Task { await load() } }
        } else if isLoading {
            ProgressView().tint(.gray)
        } else if topics.isEmpty {
            messageState(
                title: "No journeys yet.",
                detail: "Analyze a few nonfiction books to map the themes across your library."
            )
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    LazyVStack(spacing: 16) {
                        ForEach(topics) { topic in
                            NavigationLink {
                                JourneyRoadView(topic: topic)
                            } label: {
                                JourneyCard(topic: topic)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 48)
                }
            }
            .scrollIndicators(.hidden)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Journeys")
                .font(.system(size: 34, weight: .semibold, design: .serif))
                .foregroundStyle(Color(white: 0.92))
            Text("The roads through your library.")
                .font(.system(size: 16, design: .serif))
                .italic()
                .foregroundStyle(Color(white: 0.5))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 28)
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

    private func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            topics = try await apiService.fetchTopics().topics
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Journey card

private struct JourneyCard: View {
    let topic: TopicSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(topic.displayLabel)
                .font(.system(size: 22, weight: .medium, design: .serif))
                .foregroundStyle(Color(white: 0.9))
                .multilineTextAlignment(.leading)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)

            Text("\(topic.size) passages · \(topic.bookCount) book\(topic.bookCount == 1 ? "" : "s")")
                .font(.system(size: 13))
                .foregroundStyle(Color(white: 0.45))

            if let coverage = topic.coverage, coverage.total > 0 {
                HStack(spacing: 10) {
                    CandleBar(fraction: topic.coverageFraction)
                        .frame(height: 3)
                    Text("\(Int(topic.coverageFraction * 100))%")
                        .font(.system(size: 12, weight: .medium).monospacedDigit())
                        .foregroundStyle(journeyAmber.opacity(0.85))
                }
                .padding(.top, 2)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(white: 0.1).opacity(0.55))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(white: 0.18), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

/// A thin warm coverage bar.
private struct CandleBar: View {
    let fraction: Double

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color(white: 0.2))
                Capsule()
                    .fill(journeyAmber.opacity(0.9))
                    .frame(width: max(0, min(1, fraction)) * geo.size.width)
            }
        }
    }
}

// MARK: - Journey road (curriculum)

struct JourneyRoadView: View {
    @Environment(APIService.self) private var apiService

    let topic: TopicSummary

    @State private var curriculum: StudyCurriculum?
    @State private var isLoading = true
    @State private var errorMessage: String?

    // Locally-recorded "seen" passages, so the current node advances after a read.
    @State private var locallySeen: Set<String> = []

    // Passage being read in a sheet.
    @State private var openPassageId: String?

    var body: some View {
        ZStack {
            journeyNight.ignoresSafeArea()
            content
        }
        .preferredColorScheme(.dark)
        .navigationTitle(curriculum?.title ?? topic.displayLabel)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task { if curriculum == nil { await load() } }
        .sheet(item: Binding(
            get: { openPassageId.map { PassageRef(id: $0) } },
            set: { openPassageId = $0?.id }
        )) { ref in
            PassageReaderSheet(passageId: ref.id) {
                // Reading the passage records coverage server-side; reflect it locally.
                locallySeen.insert(ref.id)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if let errorMessage {
            messageState(
                title: "Couldn't load this journey",
                detail: errorMessage
            ) { Task { await load() } }
        } else if isLoading {
            ProgressView().tint(.gray)
        } else if let curriculum, !curriculum.items.isEmpty {
            road(curriculum)
        } else {
            messageState(
                title: "No road yet.",
                detail: "This journey has no readable passages yet."
            )
        }
    }

    private func road(_ curriculum: StudyCurriculum) -> some View {
        let currentId = currentPassageId(curriculum)
        return ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(orderedModules(curriculum).enumerated()), id: \.element) { _, module in
                    stretchHeader(module)
                    ForEach(curriculum.items.filter { $0.module == module }) { item in
                        nodeRow(item, currentId: currentId)
                    }
                }
            }
            .padding(.bottom, 56)
        }
        .scrollIndicators(.hidden)
    }

    private func stretchHeader(_ module: String) -> some View {
        Text(module.uppercased())
            .font(.system(size: 12, weight: .semibold))
            .tracking(3)
            .foregroundStyle(Color(white: 0.4))
            .padding(.leading, 24)
            .padding(.top, 28)
            .padding(.bottom, 10)
    }

    private func nodeRow(_ item: StudyItem, currentId: String?) -> some View {
        let state = nodeState(item, currentId: currentId)
        return Button {
            openPassageId = item.passageId
        } label: {
            HStack(alignment: .top, spacing: 0) {
                // The road: a continuous faint line with a node circle on it.
                NodeMarker(state: state)
                    .frame(width: 48)

                VStack(alignment: .leading, spacing: 6) {
                    if !item.transition.isEmpty {
                        Text(item.transition)
                            .font(.system(size: 13, design: .serif))
                            .italic()
                            .foregroundStyle(journeyAmber.opacity(0.8))
                    }
                    Text(item.snippet)
                        .font(.system(size: 17, design: .serif))
                        .foregroundStyle(Color(white: state == .upcoming ? 0.7 : 0.88))
                        .multilineTextAlignment(.leading)
                        .lineLimit(4)
                    Text("\(item.bookTitle) · \(item.role)")
                        .font(.system(size: 12))
                        .foregroundStyle(Color(white: 0.42))
                        .lineLimit(1)
                }
                .padding(.trailing, 24)
                .padding(.vertical, 4)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .buttonStyle(.plain)
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

    // MARK: - Node state

    private func isSeen(_ item: StudyItem) -> Bool {
        item.seen || locallySeen.contains(item.passageId)
    }

    /// The first unseen item is "current."
    private func currentPassageId(_ curriculum: StudyCurriculum) -> String? {
        curriculum.items.first { !isSeen($0) }?.passageId
    }

    private func nodeState(_ item: StudyItem, currentId: String?) -> NodeState {
        if isSeen(item) { return .seen }
        if item.passageId == currentId { return .current }
        return .upcoming
    }

    private func orderedModules(_ curriculum: StudyCurriculum) -> [String] {
        var seen: [String] = []
        for item in curriculum.items where !seen.contains(item.module) {
            seen.append(item.module)
        }
        return seen
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            curriculum = try await apiService.fetchCurriculum(topicId: topic.id).curriculum
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private enum NodeState {
    case seen, current, upcoming
}

/// A node on the road: a circle centered on a continuous vertical line.
private struct NodeMarker: View {
    let state: NodeState

    var body: some View {
        ZStack {
            // Continuous road line behind the node.
            Rectangle()
                .fill(Color(white: 0.18))
                .frame(width: 1.5)
                .frame(maxHeight: .infinity)

            marker
                .padding(.top, 6)
                .frame(maxHeight: .infinity, alignment: .top)
        }
    }

    @ViewBuilder
    private var marker: some View {
        switch state {
        case .seen:
            ZStack {
                Circle().fill(journeyAmber.opacity(0.9)).frame(width: 18, height: 18)
                Image(systemName: "checkmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(journeyNight)
            }
        case .current:
            ZStack {
                Circle()
                    .fill(journeyAmber.opacity(0.25))
                    .frame(width: 30, height: 30)
                    .blur(radius: 4)
                Circle().fill(journeyAmber).frame(width: 16, height: 16)
                Circle().stroke(journeyAmber.opacity(0.7), lineWidth: 2).frame(width: 26, height: 26)
            }
        case .upcoming:
            Circle()
                .stroke(Color(white: 0.3), lineWidth: 1.5)
                .background(Circle().fill(journeyNight))
                .frame(width: 14, height: 14)
        }
    }
}

// MARK: - Passage reader sheet

private struct PassageRef: Identifiable {
    let id: String
}

/// Opens a single passage in a calm serif reader. Fetching the stop also records
/// coverage server-side (which is why we surface a "seen" callback on success).
private struct PassageReaderSheet: View {
    @Environment(APIService.self) private var apiService
    @Environment(\.dismiss) private var dismiss

    let passageId: String
    let onSeen: () -> Void

    @State private var stop: WanderStop?
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ZStack {
                journeyNight.ignoresSafeArea()
                content
            }
            .preferredColorScheme(.dark)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .tint(journeyAmber)
                }
            }
        }
        .task { await load() }
    }

    @ViewBuilder
    private var content: some View {
        if let errorMessage {
            VStack(spacing: 16) {
                Text("Couldn't open this passage")
                    .font(.system(size: 22, design: .serif))
                    .foregroundStyle(Color(white: 0.9))
                Text(errorMessage)
                    .font(.system(size: 15))
                    .foregroundStyle(Color(white: 0.5))
                    .multilineTextAlignment(.center)
                Button("Try Again") { Task { await load() } }
                    .buttonStyle(.borderedProminent)
                    .tint(Color(white: 0.3))
            }
            .padding(40)
        } else if isLoading {
            ProgressView().tint(.gray)
        } else if let stop {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text((stop.topicLabel?.components(separatedBy: ",").first ?? "FROM YOUR LIBRARY").uppercased())
                        .font(.system(size: 12, weight: .semibold))
                        .tracking(3)
                        .foregroundStyle(journeyAmber.opacity(0.8))
                        .padding(.bottom, 20)

                    Text(stop.text)
                        .font(.system(size: 19, design: .serif))
                        .lineSpacing(7)
                        .foregroundStyle(Color(white: 0.88))
                        .padding(.bottom, 24)

                    Text("— \(stop.bookTitle)\(stop.chapterTitle.map { " · \($0)" } ?? "")")
                        .font(.system(size: 14))
                        .foregroundStyle(journeyAmber.opacity(0.85))
                }
                .padding(.horizontal, 24)
                .padding(.top, 24)
                .padding(.bottom, 48)
            }
            .scrollIndicators(.hidden)
        } else {
            VStack(spacing: 12) {
                Text("This passage is unavailable.")
                    .font(.system(size: 20, design: .serif))
                    .foregroundStyle(Color(white: 0.85))
            }
            .padding(40)
        }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let response = try await apiService.fetchWanderStop(passageId: passageId, visited: [])
            stop = response.stop
            if response.stop != nil { onSeen() }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
