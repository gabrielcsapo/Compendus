//
//  TimePeriodDetailView.swift
//  Compendus
//
//  Detail view for a specific time period (today, this month, this year)
//  showing activity chart and session list.
//

import SwiftUI
import SwiftData

struct TimePeriodDetailView: View {
    let period: TimePeriod
    let sessionData: [SessionValueType]
    let bookData: [BookValueType]
    let allSessions: [ReadingSession]

    @State private var totalSeconds: Int = 0
    @State private var sessionCount: Int = 0
    @State private var pagesRead: Int = 0
    @State private var booksTouched: Int = 0
    @State private var avgDailyMinutes: Int = 0
    @State private var booksFinished: Int = 0
    @State private var bestStreak: Int = 0
    @State private var activityBars: [(label: String, seconds: Int)] = []
    @State private var filteredSessions: [ReadingSession] = []
    @State private var isLoading = true
    @State private var selectedSession: ReadingSession? = nil

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
                        statsGridSection
                        activityChartSection
                        sessionsListSection
                    }
                    .padding(.vertical, Spacing.lg)
                }
            }
        }
        .navigationTitle(period.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await computeStats() }
        .sheet(item: $selectedSession) { session in
            ReadingSessionDetailView(
                session: session,
                bookTitle: bookData.first(where: { $0.id == session.bookId })?.title
            )
        }
    }

    // MARK: - Stats Grid

    private var statsGridSection: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: Spacing.md) {
            statCard(icon: "clock.fill", label: "Total Time", value: formatTime(totalSeconds))
            statCard(icon: "list.bullet", label: "Sessions", value: "\(sessionCount)")

            switch period {
            case .today:
                statCard(icon: "doc.text", label: "Pages Read", value: "\(pagesRead)")
                statCard(icon: "books.vertical", label: "Books", value: "\(booksTouched)")
            case .thisMonth:
                statCard(icon: "chart.bar", label: "Avg/Day", value: "\(avgDailyMinutes)m")
                statCard(icon: "books.vertical", label: "Books", value: "\(booksTouched)")
            case .thisYear:
                statCard(icon: "checkmark.circle", label: "Finished", value: "\(booksFinished)")
                statCard(icon: "flame.fill", label: "Best Streak", value: "\(bestStreak)d")
            }
        }
        .padding(.horizontal, Spacing.xl)
    }

    private func statCard(icon: String, label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Label(label, systemImage: icon)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title2)
                .fontWeight(.bold)
                .monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Spacing.md)
        .background {
            RoundedRectangle(cornerRadius: Radius.large, style: .continuous)
                .fill(.regularMaterial)
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.large, style: .continuous)
                        .strokeBorder(.separator, lineWidth: 0.5)
                }
        }
    }

    // MARK: - Activity Chart

    private var activityChartSection: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Activity")
                .font(.headline)
                .padding(.horizontal, Spacing.xl)

            if activityBars.isEmpty {
                Text("No activity in this period")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, Spacing.xl)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .bottom, spacing: period == .today ? 6 : 4) {
                        ForEach(activityBars, id: \.label) { bar in
                            let minutes = bar.seconds / 60

                            VStack(spacing: Spacing.xs) {
                                Text(minutes > 0 ? "\(minutes)m" : "")
                                    .font(.system(size: 8))
                                    .foregroundStyle(.secondary)
                                    .frame(height: 12)

                                RoundedRectangle(cornerRadius: 3)
                                    .fill(bar.seconds > 0 ? Color.accentColor : Color(.systemGray5))
                                    .frame(width: barWidth, height: barHeight(seconds: bar.seconds))

                                Text(bar.label)
                                    .font(.system(size: 8))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                    }
                    .frame(height: 130)
                    .padding(.horizontal, Spacing.xl)
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
        }
    }

    private var barWidth: CGFloat {
        switch period {
        case .today: return 20
        case .thisMonth: return 16
        case .thisYear: return 28
        }
    }

    private func barHeight(seconds: Int) -> CGFloat {
        let maxSeconds = activityBars.map(\.seconds).max() ?? 1
        let ratio = maxSeconds > 0 ? CGFloat(seconds) / CGFloat(maxSeconds) : 0
        return max(4, ratio * 70)
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
                    Text("No reading sessions")
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

    // MARK: - Data Loading

    private func computeStats() async {
        isLoading = true
        let range = period.dateRange

        let filtered = sessionData.filter { $0.startedAt >= range.start && $0.startedAt <= range.end }
        let bookMap = Dictionary(uniqueKeysWithValues: bookData.map { ($0.id, $0) })

        let computed = await Task.detached {
            let calendar = Calendar.current
            let total = filtered.reduce(0) { $0 + $1.durationSeconds }
            let pages = filtered.compactMap(\.pagesRead).reduce(0, +)
            let books = Set(filtered.map(\.bookId)).count
            let finished = Set(filtered.map(\.bookId)).filter { bookMap[$0]?.isRead == true }.count

            // Avg daily
            let daysInRange = max(1, calendar.dateComponents([.day], from: range.start, to: range.end).day ?? 1)
            let avgDaily = (total / 60) / daysInRange

            // Best streak in period
            var daysWithReading: Set<Date> = []
            for s in filtered {
                daysWithReading.insert(calendar.startOfDay(for: s.startedAt))
            }
            let sortedDays = daysWithReading.sorted()
            var best = 0
            var currentRun = 0
            var previousDay: Date? = nil
            for day in sortedDays {
                if let prev = previousDay,
                   let nextDay = calendar.date(byAdding: .day, value: 1, to: prev),
                   calendar.isDate(day, inSameDayAs: nextDay) {
                    currentRun += 1
                } else {
                    currentRun = 1
                }
                best = max(best, currentRun)
                previousDay = day
            }

            // Activity bars
            var bars: [(label: String, seconds: Int)] = []
            switch period {
            case .today:
                // Hourly bars
                for hour in 0..<24 {
                    let hourStart = calendar.date(bySettingHour: hour, minute: 0, second: 0, of: Date())!
                    let hourEnd = calendar.date(byAdding: .hour, value: 1, to: hourStart)!
                    let secs = filtered.filter { $0.startedAt >= hourStart && $0.startedAt < hourEnd }
                        .reduce(0) { $0 + $1.durationSeconds }
                    let label = hour % 6 == 0 ? "\(hour == 0 ? 12 : (hour > 12 ? hour - 12 : hour))\(hour < 12 ? "a" : "p")" : ""
                    bars.append((label: label.isEmpty ? "\(hour)" : label, seconds: secs))
                }
            case .thisMonth:
                // Daily bars
                let now = Date()
                let monthStart = calendar.date(from: calendar.dateComponents([.year, .month], from: now))!
                let daysCount = calendar.dateComponents([.day], from: monthStart, to: now).day ?? 0
                for dayOffset in 0...daysCount {
                    guard let day = calendar.date(byAdding: .day, value: dayOffset, to: monthStart) else { continue }
                    let dayStart = calendar.startOfDay(for: day)
                    let dayEnd = calendar.date(byAdding: .day, value: 1, to: dayStart)!
                    let secs = filtered.filter { $0.startedAt >= dayStart && $0.startedAt < dayEnd }
                        .reduce(0) { $0 + $1.durationSeconds }
                    let dayNum = calendar.component(.day, from: day)
                    bars.append((label: "\(dayNum)", seconds: secs))
                }
            case .thisYear:
                // Monthly bars
                let now = Date()
                let currentMonth = calendar.component(.month, from: now)
                let monthNames = calendar.shortMonthSymbols
                for month in 1...currentMonth {
                    var components = calendar.dateComponents([.year], from: now)
                    components.month = month
                    components.day = 1
                    guard let monthStart = calendar.date(from: components) else { continue }
                    var endComponents = components
                    endComponents.month = month + 1
                    let monthEnd = calendar.date(from: endComponents) ?? now
                    let secs = filtered.filter { $0.startedAt >= monthStart && $0.startedAt < monthEnd }
                        .reduce(0) { $0 + $1.durationSeconds }
                    bars.append((label: String(monthNames[month - 1].prefix(3)), seconds: secs))
                }
            }

            return (total, filtered.count, pages, books, finished, avgDaily, best, bars)
        }.value

        totalSeconds = computed.0
        sessionCount = computed.1
        pagesRead = computed.2
        booksTouched = computed.3
        booksFinished = computed.4
        avgDailyMinutes = computed.5
        bestStreak = computed.6
        activityBars = computed.7

        // Filter actual ReadingSession objects for the list
        let range2 = period.dateRange
        filteredSessions = allSessions.filter { $0.startedAt >= range2.start && $0.startedAt <= range2.end }

        isLoading = false
    }

    // MARK: - Helpers

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
