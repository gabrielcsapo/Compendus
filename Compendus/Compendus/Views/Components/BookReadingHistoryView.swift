//
//  BookReadingHistoryView.swift
//  Compendus
//
//  Per-book reading session history detail view.
//

import SwiftUI
import SwiftData

struct BookReadingHistoryView: View {
    let book: DownloadedBook

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var sessions: [ReadingSession] = []
    @State private var totalReadingTime: Int = 0
    @State private var totalContentTime: Int = 0
    @State private var dailyActivity: [(date: Date, seconds: Int)] = []
    @State private var selectedSession: ReadingSession? = nil

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    summarySection
                    weeklyActivitySection
                    sessionsListSection
                }
                .padding(.vertical, 16)
            }
            .navigationTitle("Reading History")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .task { loadSessions() }
            .sheet(item: $selectedSession) { session in
                ReadingSessionDetailView(session: session, bookTitle: book.title)
            }
        }
    }

    // MARK: - Summary

    private var summarySection: some View {
        VStack(spacing: 12) {
            // Book info
            HStack(spacing: 12) {
                if let coverData = book.coverData, let uiImage = UIImage(data: coverData) {
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
                            Image(systemName: book.isAudiobook ? "headphones" : "book.closed")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(book.title)
                        .font(.headline)
                        .lineLimit(2)
                    Text(book.authorsDisplay)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Spacer()
            }
            .padding(.horizontal, 20)

            // Stats row
            HStack(spacing: 0) {
                statItem(
                    value: formatTime(book.isAudiobook ? totalContentTime : totalReadingTime),
                    label: book.isAudiobook ? "Content Time" : "Total Time"
                )

                Divider().frame(height: 40)

                statItem(
                    value: "\(sessions.count)",
                    label: sessions.count == 1 ? "Session" : "Sessions"
                )

                Divider().frame(height: 40)

                if let totalPages = sessions.compactMap(\.pagesRead).reduce(0, +) as Int?, totalPages > 0 {
                    statItem(value: "\(totalPages)", label: "Pages Read")
                } else {
                    statItem(
                        value: averageSessionLength,
                        label: "Avg Session"
                    )
                }
            }
            .padding(.vertical, 12)
            .background {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(.regularMaterial)
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(.separator, lineWidth: 0.5)
                    }
            }
            .padding(.horizontal, 20)

            // Audiobook note
            if book.isAudiobook && totalContentTime != totalReadingTime {
                HStack(spacing: 6) {
                    Image(systemName: "gauge.with.dots.needle.67percent")
                        .font(.caption)
                    Text("\(formatTime(totalReadingTime)) wall-clock time at varying speeds")
                        .font(.caption)
                }
                .foregroundStyle(.secondary)
                .padding(.horizontal, 20)
            }
        }
    }

    private func statItem(value: String, label: String) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.title3)
                .fontWeight(.bold)
                .monospacedDigit()
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Weekly Activity

    private var weeklyActivitySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Recent Activity")
                .font(.headline)
                .padding(.horizontal, 20)

            HStack(alignment: .bottom, spacing: 8) {
                ForEach(last7Days(), id: \.self) { date in
                    let seconds = dailyActivity.first(where: { Calendar.current.isDate($0.date, inSameDayAs: date) })?.seconds ?? 0
                    let minutes = seconds / 60

                    VStack(spacing: 4) {
                        Text(minutes > 0 ? "\(minutes)m" : "")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .frame(height: 14)

                        RoundedRectangle(cornerRadius: 4)
                            .fill(seconds > 0 ? Color.accentColor : Color(.systemGray5))
                            .frame(height: barHeight(seconds: seconds))

                        Text(dayLabel(date))
                            .font(.caption2)
                            .foregroundStyle(Calendar.current.isDateInToday(date) ? .primary : .secondary)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 120)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
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

    // MARK: - Sessions List

    private var sessionsListSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("All Sessions")
                .font(.headline)
                .padding(.horizontal, 20)

            if sessions.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "clock")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                    Text("No reading sessions yet")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text("Start reading to track your progress")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 32)
            } else {
                // Group sessions by date
                let grouped = groupedByDate()

                VStack(spacing: 16) {
                    ForEach(grouped, id: \.date) { group in
                        VStack(alignment: .leading, spacing: 0) {
                            // Date header
                            HStack {
                                Text(formatDateHeader(group.date))
                                    .font(.subheadline)
                                    .fontWeight(.medium)
                                    .foregroundStyle(.secondary)

                                Spacer()

                                let dayTotal = group.sessions.reduce(0) { $0 + $1.durationSeconds }
                                Text(formatTime(dayTotal))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(.horizontal, 16)
                            .padding(.bottom, 8)

                            VStack(spacing: 0) {
                                ForEach(group.sessions, id: \.id) { session in
                                    sessionRow(session)

                                    if session.id != group.sessions.last?.id {
                                        Divider()
                                            .padding(.leading, 44)
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
                        }
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }

    private func sessionRow(_ session: ReadingSession) -> some View {
        Button {
            selectedSession = session
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "clock")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(width: 24)

                VStack(alignment: .leading, spacing: 2) {
                    Text("\(session.startedAt.formatted(date: .omitted, time: .shortened)) – \(session.endedAt.formatted(date: .omitted, time: .shortened))")
                        .font(.subheadline)

                    HStack(spacing: 6) {
                        if let pages = session.pagesRead, pages > 0 {
                            Label("\(pages) pages", systemImage: "doc.text")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        if session.uniquePagesVisited > 0 {
                            Label("\(session.uniquePagesVisited) unique", systemImage: "number")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        if let rate = session.audioPlaybackRate, rate != 1.0 {
                            Label(String(format: "%.1fx", rate), systemImage: "gauge.with.dots.needle.67percent")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Spacer()

                HStack(spacing: 6) {
                    Text(formatTime(session.durationSeconds))
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)

                    Image(systemName: "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Data Loading

    private func loadSessions() {
        let bookId = book.id
        let descriptor = FetchDescriptor<ReadingSession>(
            predicate: #Predicate { $0.bookId == bookId },
            sortBy: [SortDescriptor(\.startedAt, order: .reverse)]
        )
        guard let fetchedSessions = try? modelContext.fetch(descriptor) else { return }
        sessions = fetchedSessions
        totalReadingTime = fetchedSessions.reduce(0) { $0 + $1.durationSeconds }
        totalContentTime = fetchedSessions.reduce(0) { $0 + $1.contentDurationSeconds }

        // Build daily activity
        let calendar = Calendar.current
        var dailyMap: [Date: Int] = [:]
        for session in fetchedSessions {
            let day = calendar.startOfDay(for: session.startedAt)
            dailyMap[day, default: 0] += session.durationSeconds
        }
        dailyActivity = dailyMap.map { (date: $0.key, seconds: $0.value) }
            .sorted { $0.date < $1.date }
    }

    // MARK: - Helpers

    private var averageSessionLength: String {
        guard !sessions.isEmpty else { return "0m" }
        let avg = totalReadingTime / sessions.count
        return formatTime(avg)
    }

    private struct DateGroup {
        let date: Date
        let sessions: [ReadingSession]
    }

    private func groupedByDate() -> [DateGroup] {
        let calendar = Calendar.current
        let grouped = Dictionary(grouping: sessions) { session in
            calendar.startOfDay(for: session.startedAt)
        }
        return grouped.map { DateGroup(date: $0.key, sessions: $0.value) }
            .sorted { $0.date > $1.date }
    }

    private func formatDateHeader(_ date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) {
            return "Today"
        } else if calendar.isDateInYesterday(date) {
            return "Yesterday"
        } else {
            return date.formatted(date: .abbreviated, time: .omitted)
        }
    }

    private func formatTime(_ totalSeconds: Int) -> String {
        let hours = totalSeconds / 3600
        let minutes = (totalSeconds % 3600) / 60
        if hours > 0 {
            return "\(hours)h \(minutes)m"
        } else if minutes > 0 {
            return "\(minutes)m"
        }
        return "<1m"
    }

    private func last7Days() -> [Date] {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        return (0..<7).reversed().compactMap {
            calendar.date(byAdding: .day, value: -$0, to: today)
        }
    }

    private func dayLabel(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "E"
        return String(formatter.string(from: date).prefix(2))
    }

    private func barHeight(seconds: Int) -> CGFloat {
        let maxSeconds = dailyActivity.map(\.seconds).max() ?? 1
        let ratio = maxSeconds > 0 ? CGFloat(seconds) / CGFloat(maxSeconds) : 0
        return max(4, ratio * 70)
    }
}
