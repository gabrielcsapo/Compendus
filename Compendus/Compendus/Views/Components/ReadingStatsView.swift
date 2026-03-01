//
//  ReadingStatsView.swift
//  Compendus
//
//  Detailed reading statistics breakdown shown when tapping the reading streak.
//

import SwiftUI
import SwiftData

struct ReadingStatsView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var sessions: [ReadingSession] = []
    @State private var streakDays: Int = 0
    @State private var bestStreak: Int = 0
    @State private var totalReadingTime: Int = 0
    @State private var totalSessions: Int = 0
    @State private var booksRead: Int = 0
    @State private var dailyActivity: [(date: Date, seconds: Int)] = []
    @State private var bookBreakdowns: [BookBreakdown] = []
    @State private var selectedSession: ReadingSession? = nil

    struct BookBreakdown: Identifiable {
        let id: String
        let title: String
        let authors: String
        let coverData: Data?
        let format: String
        let totalSeconds: Int
        let sessionCount: Int
        let lastReadAt: Date
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    streakSummarySection
                    weeklyActivitySection
                    monthlyCalendarSection
                    booksBreakdownSection
                    recentSessionsSection
                }
                .padding(.vertical, 16)
            }
            .navigationTitle("Reading Stats")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .task { loadStats() }
            .sheet(item: $selectedSession) { session in
                ReadingSessionDetailView(
                    session: session,
                    bookTitle: bookBreakdowns.first(where: { $0.id == session.bookId })?.title
                )
            }
        }
    }

    // MARK: - Streak Summary

    private var streakSummarySection: some View {
        HStack(spacing: 0) {
            statCard(
                icon: "flame.fill",
                iconColor: streakDays > 0 ? .orange : .secondary,
                value: "\(streakDays)",
                label: "Current Streak"
            )

            Divider().frame(height: 50)

            statCard(
                icon: "trophy.fill",
                iconColor: bestStreak > 0 ? .yellow : .secondary,
                value: "\(bestStreak)",
                label: "Best Streak"
            )

            Divider().frame(height: 50)

            statCard(
                icon: "clock.fill",
                iconColor: .blue,
                value: formatTime(totalReadingTime),
                label: "Total Time"
            )

            Divider().frame(height: 50)

            statCard(
                icon: "book.closed.fill",
                iconColor: .green,
                value: "\(booksRead)",
                label: "Books Read"
            )
        }
        .padding(.vertical, 16)
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

    private func statCard(icon: String, iconColor: Color, value: String, label: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(iconColor)
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
            Text("This Week")
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

    // MARK: - Monthly Calendar

    private var monthlyCalendarSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Last 30 Days")
                .font(.headline)
                .padding(.horizontal, 20)

            let days = last30Days()
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
                let firstWeekday = calendar.component(.weekday, from: days.first ?? Date())
                ForEach(0..<(firstWeekday - 1), id: \.self) { _ in
                    Color.clear
                        .aspectRatio(1, contentMode: .fit)
                }

                // Day cells
                ForEach(days, id: \.self) { date in
                    let seconds = dailyActivity.first(where: { calendar.isDate($0.date, inSameDayAs: date) })?.seconds ?? 0

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
            .padding(12)
            .background {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(.regularMaterial)
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(.separator, lineWidth: 0.5)
                    }
            }
            .padding(.horizontal, 20)

            // Legend
            HStack(spacing: 4) {
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
            .padding(.horizontal, 20)
        }
    }

    // MARK: - Books Breakdown

    private var booksBreakdownSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("By Book")
                .font(.headline)
                .padding(.horizontal, 20)

            if bookBreakdowns.isEmpty {
                Text("No reading sessions yet")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 20)
            } else {
                VStack(spacing: 0) {
                    ForEach(bookBreakdowns) { book in
                        HStack(spacing: 12) {
                            // Cover
                            if let coverData = book.coverData, let uiImage = UIImage(data: coverData) {
                                Image(uiImage: uiImage)
                                    .resizable()
                                    .aspectRatio(2/3, contentMode: .fit)
                                    .frame(width: 40)
                                    .clipShape(RoundedRectangle(cornerRadius: 4))
                            } else {
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(Color(.systemGray5))
                                    .aspectRatio(2/3, contentMode: .fit)
                                    .frame(width: 40)
                                    .overlay {
                                        Image(systemName: formatIcon(book.format))
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                    }
                            }

                            VStack(alignment: .leading, spacing: 2) {
                                Text(book.title)
                                    .font(.subheadline)
                                    .fontWeight(.medium)
                                    .lineLimit(1)
                                Text(book.authors)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }

                            Spacer()

                            VStack(alignment: .trailing, spacing: 2) {
                                Text(formatTime(book.totalSeconds))
                                    .font(.subheadline)
                                    .fontWeight(.medium)
                                    .monospacedDigit()
                                Text("\(book.sessionCount) \(book.sessionCount == 1 ? "session" : "sessions")")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)

                        if book.id != bookBreakdowns.last?.id {
                            Divider()
                                .padding(.leading, 68)
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
    }

    // MARK: - Recent Sessions

    private var recentSessionsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Recent Sessions")
                .font(.headline)
                .padding(.horizontal, 20)

            let recentSessions = Array(sessions.prefix(10))

            if recentSessions.isEmpty {
                Text("No reading sessions yet")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 20)
            } else {
                VStack(spacing: 0) {
                    ForEach(recentSessions, id: \.id) { session in
                        let bookTitle = bookBreakdowns.first(where: { $0.id == session.bookId })?.title ?? session.bookId

                        Button {
                            selectedSession = session
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: formatIcon(session.format))
                                    .font(.body)
                                    .foregroundStyle(.secondary)
                                    .frame(width: 24)

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(bookTitle)
                                        .font(.subheadline)
                                        .lineLimit(1)
                                    HStack(spacing: 4) {
                                        Text(session.startedAt.formatted(date: .abbreviated, time: .shortened))
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                        if let pages = session.pagesRead, pages > 0 {
                                            Text("·")
                                                .font(.caption)
                                                .foregroundStyle(.tertiary)
                                            Text("\(pages) pages")
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

                        if session.id != recentSessions.last?.id {
                            Divider()
                                .padding(.leading, 52)
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
    }

    // MARK: - Data Loading

    private func loadStats() {
        let descriptor = FetchDescriptor<ReadingSession>(
            sortBy: [SortDescriptor(\.startedAt, order: .reverse)]
        )
        guard let allSessions = try? modelContext.fetch(descriptor) else { return }
        sessions = allSessions
        totalSessions = allSessions.count
        totalReadingTime = allSessions.reduce(0) { $0 + $1.durationSeconds }

        let calendar = Calendar.current

        // Build daily activity
        var dailyMap: [Date: Int] = [:]
        var bookIds: Set<String> = []

        for session in allSessions {
            let day = calendar.startOfDay(for: session.startedAt)
            dailyMap[day, default: 0] += session.durationSeconds
            bookIds.insert(session.bookId)
        }

        booksRead = bookIds.count
        dailyActivity = dailyMap.map { (date: $0.key, seconds: $0.value) }
            .sorted { $0.date < $1.date }

        // Calculate streaks
        let today = calendar.startOfDay(for: Date())
        var daysWithReading = Set(dailyMap.keys)

        // Current streak
        var streak = 0
        var checkDate = today
        if daysWithReading.contains(checkDate) {
            streak = 1
            checkDate = calendar.date(byAdding: .day, value: -1, to: checkDate)!
        } else {
            checkDate = calendar.date(byAdding: .day, value: -1, to: checkDate)!
            if !daysWithReading.contains(checkDate) {
                streakDays = 0
            }
        }
        while daysWithReading.contains(checkDate) {
            streak += 1
            checkDate = calendar.date(byAdding: .day, value: -1, to: checkDate)!
        }
        streakDays = streak

        // Best streak
        let sortedDays = daysWithReading.sorted()
        var best = 0
        var current = 0
        var previousDay: Date? = nil
        for day in sortedDays {
            if let prev = previousDay,
               let nextDay = calendar.date(byAdding: .day, value: 1, to: prev),
               calendar.isDate(day, inSameDayAs: nextDay) {
                current += 1
            } else {
                current = 1
            }
            best = max(best, current)
            previousDay = day
        }
        bestStreak = best

        // Book breakdowns
        let bookDescriptor = FetchDescriptor<DownloadedBook>()
        let downloadedBooks = (try? modelContext.fetch(bookDescriptor)) ?? []
        let bookMap = Dictionary(uniqueKeysWithValues: downloadedBooks.map { ($0.id, $0) })

        var breakdownMap: [String: (seconds: Int, count: Int, lastRead: Date)] = [:]
        for session in allSessions {
            let existing = breakdownMap[session.bookId]
            breakdownMap[session.bookId] = (
                seconds: (existing?.seconds ?? 0) + session.durationSeconds,
                count: (existing?.count ?? 0) + 1,
                lastRead: max(existing?.lastRead ?? .distantPast, session.endedAt)
            )
        }

        bookBreakdowns = breakdownMap.map { bookId, stats in
            let book = bookMap[bookId]
            return BookBreakdown(
                id: bookId,
                title: book?.title ?? "Unknown Book",
                authors: book?.authorsDisplay ?? "",
                coverData: book?.coverData,
                format: book?.format ?? "epub",
                totalSeconds: stats.seconds,
                sessionCount: stats.count,
                lastReadAt: stats.lastRead
            )
        }
        .sorted { $0.totalSeconds > $1.totalSeconds }
    }

    // MARK: - Helpers

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

    private func last30Days() -> [Date] {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        return (0..<30).reversed().compactMap {
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

    private func calendarColor(seconds: Int) -> Color {
        if seconds == 0 { return Color(.systemGray5) }
        if seconds < 300 { return .accentColor.opacity(0.3) }       // < 5 min
        if seconds < 900 { return .accentColor.opacity(0.5) }       // < 15 min
        if seconds < 1800 { return .accentColor.opacity(0.7) }      // < 30 min
        return .accentColor                                          // 30+ min
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
