//
//  CustomRangeStatsView.swift
//  Compendus
//
//  Custom date range stats with calendar heatmap and session list.
//

import SwiftUI
import SwiftData

struct CustomRangeStatsView: View {
    let sessionData: [SessionValueType]
    let bookData: [BookValueType]
    let allSessions: [ReadingSession]

    @State private var startDate: Date = Calendar.current.date(byAdding: .day, value: -30, to: Date()) ?? Date()
    @State private var endDate: Date = Date()

    @State private var totalSeconds: Int = 0
    @State private var sessionCount: Int = 0
    @State private var booksTouched: Int = 0
    @State private var dailyActivity: [Date: Int] = [:]
    @State private var filteredSessions: [ReadingSession] = []
    @State private var isLoading = true
    @State private var selectedSession: ReadingSession? = nil
    @State private var computeTask: Task<Void, Never>? = nil

    var body: some View {
        Group {
            if isLoading {
                VStack(spacing: 16) {
                    ProgressView()
                    Text("Loading...")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    VStack(spacing: Spacing.xl) {
                        datePickerSection
                        summarySection
                        calendarHeatmapSection
                        sessionsListSection
                    }
                    .padding(.vertical, Spacing.lg)
                }
            }
        }
        .navigationTitle("Custom Range")
        .navigationBarTitleDisplayMode(.inline)
        .task { await computeStats() }
        .onChange(of: startDate) { recompute() }
        .onChange(of: endDate) { recompute() }
        .sheet(item: $selectedSession) { session in
            ReadingSessionDetailView(
                session: session,
                bookTitle: bookData.first(where: { $0.id == session.bookId })?.title
            )
        }
    }

    // MARK: - Date Picker

    private var datePickerSection: some View {
        VStack(spacing: 0) {
            HStack {
                Text("From")
                    .font(.subheadline)
                Spacer()
                DatePicker("", selection: $startDate, in: ...endDate, displayedComponents: .date)
                    .datePickerStyle(.compact)
                    .labelsHidden()
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.md)

            Divider()

            HStack {
                Text("To")
                    .font(.subheadline)
                Spacer()
                DatePicker("", selection: $endDate, in: startDate...Date(), displayedComponents: .date)
                    .datePickerStyle(.compact)
                    .labelsHidden()
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.md)
        }
        .background {
            RoundedRectangle(cornerRadius: Radius.large, style: .continuous)
                .fill(.regularMaterial)
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.large, style: .continuous)
                        .strokeBorder(.separator, lineWidth: 0.5)
                }
        }
        .padding(.horizontal, Spacing.xl)
    }

    // MARK: - Summary

    private var summarySection: some View {
        HStack(spacing: 0) {
            summaryItem(value: formatTime(totalSeconds), label: "Total Time")
            Divider().frame(height: 40)
            summaryItem(value: "\(sessionCount)", label: sessionCount == 1 ? "Session" : "Sessions")
            Divider().frame(height: 40)
            summaryItem(value: "\(booksTouched)", label: booksTouched == 1 ? "Book" : "Books")
        }
        .padding(.vertical, Spacing.md)
        .background {
            RoundedRectangle(cornerRadius: Radius.large, style: .continuous)
                .fill(.regularMaterial)
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.large, style: .continuous)
                        .strokeBorder(.separator, lineWidth: 0.5)
                }
        }
        .padding(.horizontal, Spacing.xl)
    }

    private func summaryItem(value: String, label: String) -> some View {
        VStack(spacing: Spacing.xs) {
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

    // MARK: - Calendar Heatmap

    private var calendarHeatmapSection: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Activity")
                .font(.headline)
                .padding(.horizontal, Spacing.xl)

            let days = daysInRange()
            let calendar = Calendar.current

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 7), spacing: 4) {
                // Day headers
                ForEach(["S", "M", "T", "W", "T", "F", "S"], id: \.self) { day in
                    Text(day)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                }

                // Leading empty cells for alignment
                if let firstDay = days.first {
                    let firstWeekday = calendar.component(.weekday, from: firstDay)
                    ForEach(0..<(firstWeekday - 1), id: \.self) { _ in
                        Color.clear
                            .aspectRatio(1, contentMode: .fit)
                    }
                }

                // Day cells
                ForEach(days, id: \.self) { date in
                    let seconds = dailyActivity[calendar.startOfDay(for: date)] ?? 0

                    RoundedRectangle(cornerRadius: 3)
                        .fill(calendarColor(seconds: seconds))
                        .aspectRatio(1, contentMode: .fit)
                        .overlay {
                            Text("\(calendar.component(.day, from: date))")
                                .font(.system(size: 9))
                                .foregroundStyle(seconds > 0 ? .white : .secondary)
                        }
                }
            }
            .padding(Spacing.md)
            .background {
                RoundedRectangle(cornerRadius: Radius.large, style: .continuous)
                    .fill(.regularMaterial)
                    .overlay {
                        RoundedRectangle(cornerRadius: Radius.large, style: .continuous)
                            .strokeBorder(.separator, lineWidth: 0.5)
                    }
            }
            .padding(.horizontal, Spacing.xl)

            // Legend
            HStack(spacing: Spacing.xs) {
                Text("Less")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                ForEach([0, 300, 900, 1800, 3600], id: \.self) { secs in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(calendarColor(seconds: secs))
                        .frame(width: 12, height: 12)
                }
                Text("More")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, Spacing.xl)
        }
    }

    // MARK: - Sessions List

    private var sessionsListSection: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Sessions")
                .font(.headline)
                .padding(.horizontal, Spacing.xl)

            if filteredSessions.isEmpty {
                VStack(spacing: Spacing.sm) {
                    Image(systemName: "clock")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                    Text("No reading sessions in this range")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.xxxl)
            } else {
                let grouped = groupedByDate()

                VStack(spacing: Spacing.lg) {
                    ForEach(grouped, id: \.date) { group in
                        VStack(alignment: .leading, spacing: 0) {
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
                            .padding(.horizontal, Spacing.lg)
                            .padding(.bottom, Spacing.sm)

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
                                RoundedRectangle(cornerRadius: Radius.large, style: .continuous)
                                    .fill(.regularMaterial)
                                    .overlay {
                                        RoundedRectangle(cornerRadius: Radius.large, style: .continuous)
                                            .strokeBorder(.separator, lineWidth: 0.5)
                                    }
                            }
                        }
                    }
                }
                .padding(.horizontal, Spacing.xl)
            }
        }
    }

    private func sessionRow(_ session: ReadingSession) -> some View {
        Button {
            selectedSession = session
        } label: {
            HStack(spacing: Spacing.md) {
                Image(systemName: formatIcon(session.format))
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(width: 24)

                VStack(alignment: .leading, spacing: 2) {
                    let title = bookData.first(where: { $0.id == session.bookId })?.title ?? session.bookId
                    Text(title)
                        .font(.subheadline)
                        .lineLimit(1)
                    HStack(spacing: Spacing.xs) {
                        Text(session.startedAt.formatted(date: .omitted, time: .shortened))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if let pages = session.pagesRead, pages > 0 {
                            Text("\u{00B7} \(pages) pages")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Spacer()

                HStack(spacing: Spacing.sm) {
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
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, 10)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Data

    private func recompute() {
        computeTask?.cancel()
        computeTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await computeStats()
        }
    }

    private func computeStats() async {
        isLoading = true
        let rangeStart = Calendar.current.startOfDay(for: startDate)
        let rangeEnd = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: endDate))!

        let filtered = sessionData.filter { $0.startedAt >= rangeStart && $0.startedAt < rangeEnd }

        let computed = await Task.detached {
            let calendar = Calendar.current
            let total = filtered.reduce(0) { $0 + $1.durationSeconds }
            let books = Set(filtered.map(\.bookId)).count

            var daily: [Date: Int] = [:]
            for s in filtered {
                let day = calendar.startOfDay(for: s.startedAt)
                daily[day, default: 0] += s.durationSeconds
            }

            return (total, filtered.count, books, daily)
        }.value

        totalSeconds = computed.0
        sessionCount = computed.1
        booksTouched = computed.2
        dailyActivity = computed.3
        filteredSessions = allSessions.filter { $0.startedAt >= rangeStart && $0.startedAt < rangeEnd }
        isLoading = false
    }

    // MARK: - Helpers

    private func daysInRange() -> [Date] {
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: startDate)
        let end = calendar.startOfDay(for: endDate)
        let dayCount = (calendar.dateComponents([.day], from: start, to: end).day ?? 0) + 1
        return (0..<dayCount).compactMap {
            calendar.date(byAdding: .day, value: $0, to: start)
        }
    }

    private func calendarColor(seconds: Int) -> Color {
        if seconds == 0 { return Color(.systemGray5) }
        if seconds < 300 { return .accentColor.opacity(0.3) }
        if seconds < 900 { return .accentColor.opacity(0.5) }
        if seconds < 1800 { return .accentColor.opacity(0.7) }
        return .accentColor
    }

    private struct DateGroup {
        let date: Date
        let sessions: [ReadingSession]
    }

    private func groupedByDate() -> [DateGroup] {
        let calendar = Calendar.current
        let grouped = Dictionary(grouping: filteredSessions) { session in
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

    private func formatIcon(_ format: String) -> String {
        switch format.lowercased() {
        case "epub", "pdf": return "book.closed"
        case "audiobook", "m4b", "mp3": return "headphones"
        case "comic", "cbr", "cbz": return "book.pages"
        default: return "doc"
        }
    }
}
