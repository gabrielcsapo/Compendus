//
//  ReadingSessionDetailView.swift
//  Compendus
//
//  Detail view for a single reading session showing duration, pages, and page turn timeline.
//

import SwiftUI
import SwiftData

struct ReadingSessionDetailView: View {
    let session: ReadingSession
    var bookTitle: String? = nil

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var resolvedBookTitle: String = ""
    @State private var bookCoverData: Data? = nil

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    headerSection
                    statsGridSection
                    if !session.pageTurns.isEmpty {
                        pageTurnTimelineSection
                    }
                }
                .padding(.vertical, 16)
            }
            .navigationTitle("Session Details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .task { resolveBook() }
        }
    }

    // MARK: - Header

    private var headerSection: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                // Cover
                if let coverData = bookCoverData, let uiImage = UIImage(data: coverData) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .aspectRatio(2/3, contentMode: .fit)
                        .frame(width: 50)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .shadow(color: .black.opacity(0.1), radius: 2, y: 1)
                } else {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(Color(.systemGray5))
                        .aspectRatio(2/3, contentMode: .fit)
                        .frame(width: 50)
                        .overlay {
                            Image(systemName: formatIcon)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(resolvedBookTitle)
                        .font(.headline)
                        .lineLimit(2)

                    HStack(spacing: 6) {
                        FormatBadgeView(format: session.format, size: .compact)

                        Text(session.startedAt.formatted(date: .abbreviated, time: .omitted))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()
            }

            // Time range
            HStack(spacing: 8) {
                Image(systemName: "clock")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Text(session.startedAt.formatted(date: .omitted, time: .shortened))
                    .font(.subheadline)

                Image(systemName: "arrow.right")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)

                Text(session.endedAt.formatted(date: .omitted, time: .shortened))
                    .font(.subheadline)

                Spacer()

                Text(formatDuration(session.durationSeconds))
                    .font(.title3)
                    .fontWeight(.bold)
                    .monospacedDigit()
            }
            .padding(12)
            .background {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.accentColor.opacity(0.1))
            }
        }
        .padding(.horizontal, 20)
    }

    // MARK: - Stats Grid

    private var statsGridSection: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            // Pages read
            if let pages = session.pagesRead, pages > 0 {
                statCard(
                    icon: "doc.text",
                    label: "Pages Read",
                    value: "\(pages)",
                    detail: pageRangeText
                )
            }

            // Unique pages
            if session.uniquePagesVisited > 0 {
                statCard(
                    icon: "number",
                    label: "Unique Pages",
                    value: "\(session.uniquePagesVisited)",
                    detail: nil
                )
            }

            // Total book pages
            if let total = session.totalBookPages, total > 0 {
                let progress = progressPercent
                statCard(
                    icon: "book.closed",
                    label: "Book Progress",
                    value: progress != nil ? "\(progress!)%" : "—",
                    detail: "\(total) total pages"
                )
            }

            // Characters read (EPUB)
            if let chars = session.charactersRead, chars > 0 {
                statCard(
                    icon: "textformat",
                    label: "Characters Read",
                    value: formatNumber(chars),
                    detail: charRangeText
                )
            }

            // Playback rate (audiobook)
            if let rate = session.audioPlaybackRate {
                statCard(
                    icon: "gauge.with.dots.needle.67percent",
                    label: "Playback Speed",
                    value: String(format: "%.1fx", rate),
                    detail: rate != 1.0 ? "Content: \(formatDuration(session.contentDurationSeconds))" : nil
                )
            }

            // Page turns count
            if !session.pageTurns.isEmpty {
                statCard(
                    icon: "hand.point.right",
                    label: "Page Turns",
                    value: "\(session.pageTurns.count)",
                    detail: avgTimeBetweenTurns
                )
            }
        }
        .padding(.horizontal, 20)
    }

    private func statCard(icon: String, label: String, value: String, detail: String?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(label, systemImage: icon)
                .font(.caption)
                .foregroundStyle(.secondary)

            Text(value)
                .font(.title2)
                .fontWeight(.bold)
                .monospacedDigit()

            if let detail {
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(.regularMaterial)
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(.separator, lineWidth: 0.5)
                }
        }
    }

    // MARK: - Page Turn Timeline

    private var pageTurnTimelineSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Page Turn Timeline")
                    .font(.headline)

                Spacer()

                Text("\(session.pageTurns.count) turns")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 20)

            // Page number chart
            pageChart
                .padding(.horizontal, 20)

            // Timeline list
            VStack(spacing: 0) {
                ForEach(Array(session.pageTurns.enumerated()), id: \.offset) { index, turn in
                    HStack(spacing: 12) {
                        // Timeline dot and line
                        VStack(spacing: 0) {
                            if index > 0 {
                                Rectangle()
                                    .fill(Color.accentColor.opacity(0.3))
                                    .frame(width: 2)
                                    .frame(height: 8)
                            }
                            Circle()
                                .fill(index == 0 ? Color.green : (index == session.pageTurns.count - 1 ? Color.red : Color.accentColor))
                                .frame(width: 8, height: 8)
                            if index < session.pageTurns.count - 1 {
                                Rectangle()
                                    .fill(Color.accentColor.opacity(0.3))
                                    .frame(width: 2)
                                    .frame(height: 8)
                            }
                        }
                        .frame(width: 12)

                        VStack(alignment: .leading, spacing: 1) {
                            HStack {
                                Text("Page \(turn.page + 1)")
                                    .font(.subheadline)

                                Spacer()

                                Text(turn.timestamp.formatted(date: .omitted, time: .standard))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .monospacedDigit()
                            }

                            HStack(spacing: 8) {
                                if index > 0 {
                                    let prevTurn = session.pageTurns[index - 1]
                                    let elapsed = Int(turn.timestamp.timeIntervalSince(prevTurn.timestamp))
                                    if elapsed > 0 {
                                        Text("\(formatDuration(elapsed)) on previous page")
                                            .font(.caption2)
                                            .foregroundStyle(.tertiary)
                                    }
                                }

                                if let offset = turn.characterOffset {
                                    Text("char \(formatNumber(offset))")
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 6)

                    if index < session.pageTurns.count - 1 {
                        Divider()
                            .padding(.leading, 40)
                    }
                }
            }
            .background {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(.regularMaterial)
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(.separator, lineWidth: 0.5)
                    }
            }
            .padding(.horizontal, 20)
        }
    }

    // MARK: - Page Chart

    private var pageChart: some View {
        let turns = session.pageTurns
        let pages = turns.map(\.page)
        let minPage = (pages.min() ?? 0)
        let maxPage = max((pages.max() ?? 1), minPage + 1)
        let range = CGFloat(maxPage - minPage)

        return VStack(alignment: .leading, spacing: 4) {
            // Chart
            GeometryReader { geo in
                let width = geo.size.width
                let height: CGFloat = 80
                let stepX = turns.count > 1 ? width / CGFloat(turns.count - 1) : width

                Path { path in
                    for (i, turn) in turns.enumerated() {
                        let x = turns.count > 1 ? stepX * CGFloat(i) : width / 2
                        let y = height - (CGFloat(turn.page - minPage) / range) * height
                        if i == 0 {
                            path.move(to: CGPoint(x: x, y: y))
                        } else {
                            path.addLine(to: CGPoint(x: x, y: y))
                        }
                    }
                }
                .stroke(Color.accentColor, lineWidth: 2)
            }
            .frame(height: 80)
            .padding(8)
            .background {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color(.systemGray6))
            }

            // Labels
            HStack {
                Text("Page \(minPage + 1)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                Spacer()
                Text("Page \(maxPage + 1)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    // MARK: - Data

    private func resolveBook() {
        if let title = bookTitle {
            resolvedBookTitle = title
        }

        let bookId = session.bookId
        let descriptor = FetchDescriptor<DownloadedBook>(
            predicate: #Predicate { $0.id == bookId }
        )
        if let book = try? modelContext.fetch(descriptor).first {
            if bookTitle == nil {
                resolvedBookTitle = book.title
            }
            bookCoverData = book.coverData
        } else if bookTitle == nil {
            resolvedBookTitle = session.bookId
        }
    }

    // MARK: - Helpers

    private var formatIcon: String {
        switch session.format.lowercased() {
        case "epub", "pdf": return "book.closed"
        case "audiobook", "m4b", "mp3": return "headphones"
        case "comic", "cbr", "cbz": return "book.pages"
        default: return "doc"
        }
    }

    private var pageRangeText: String? {
        guard let start = session.startPage, let end = session.endPage else { return nil }
        return "Page \(start + 1) → \(end + 1)"
    }

    private var charRangeText: String? {
        guard let start = session.startCharacterOffset, let end = session.endCharacterOffset else { return nil }
        return "\(formatNumber(start)) → \(formatNumber(end))"
    }

    private var progressPercent: Int? {
        guard let end = session.endPage, let total = session.totalBookPages, total > 0 else { return nil }
        return Int((Double(end) / Double(total)) * 100)
    }

    private var avgTimeBetweenTurns: String? {
        let turns = session.pageTurns
        guard turns.count > 1 else { return nil }
        let totalInterval = turns.last!.timestamp.timeIntervalSince(turns.first!.timestamp)
        let avg = Int(totalInterval) / (turns.count - 1)
        return "~\(formatDuration(avg)) per page"
    }

    private func formatDuration(_ totalSeconds: Int) -> String {
        let hours = totalSeconds / 3600
        let minutes = (totalSeconds % 3600) / 60
        let seconds = totalSeconds % 60
        if hours > 0 {
            return "\(hours)h \(minutes)m"
        } else if minutes > 0 {
            return "\(minutes)m \(seconds)s"
        }
        return "\(seconds)s"
    }

    private func formatNumber(_ n: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        return formatter.string(from: NSNumber(value: n)) ?? "\(n)"
    }
}
