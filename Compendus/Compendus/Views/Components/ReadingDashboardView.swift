//
//  ReadingDashboardView.swift
//  Compendus
//
//  Xbox-dashboard-style reading stats with most-read books and time rollups.
//

import SwiftUI
import SwiftData

// MARK: - Shared Types

enum TimePeriod: Hashable {
    case today
    case thisMonth
    case thisYear

    var title: String {
        switch self {
        case .today: return "Today"
        case .thisMonth: return "This Month"
        case .thisYear: return "This Year"
        }
    }

    var icon: String {
        switch self {
        case .today: return "sun.max.fill"
        case .thisMonth: return "calendar"
        case .thisYear: return "chart.line.uptrend.xyaxis"
        }
    }

    var iconColor: Color {
        switch self {
        case .today: return .orange
        case .thisMonth: return .blue
        case .thisYear: return .green
        }
    }

    var dateRange: (start: Date, end: Date) {
        let calendar = Calendar.current
        let now = Date()
        switch self {
        case .today:
            return (calendar.startOfDay(for: now), now)
        case .thisMonth:
            let start = calendar.date(from: calendar.dateComponents([.year, .month], from: now))!
            return (start, now)
        case .thisYear:
            let start = calendar.date(from: calendar.dateComponents([.year], from: now))!
            return (start, now)
        }
    }
}

struct SessionValueType: Sendable {
    let id: String
    let bookId: String
    let format: String
    let durationSeconds: Int
    let contentDurationSeconds: Int
    let startedAt: Date
    let endedAt: Date
    let pagesRead: Int?
}

struct BookValueType: Sendable {
    let id: String
    let title: String
    let authorsDisplay: String
    let coverData: Data?
    let format: String
    let isRead: Bool
}

struct MostReadBook: Identifiable {
    let id: String
    let title: String
    let authors: String
    let coverData: Data?
    let format: String
    let totalSeconds: Int
    let sessionCount: Int
}

// MARK: - Dashboard View

struct ReadingDashboardView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Environment(ServerConfig.self) private var serverConfig

    @State private var sessionData: [SessionValueType] = []
    @State private var bookData: [BookValueType] = []
    @State private var allSessions: [ReadingSession] = []

    // Dashboard stats
    @State private var mostReadBooks: [MostReadBook] = []
    @State private var streakDays: Int = 0
    @State private var todaySeconds: Int = 0
    @State private var todaySessions: Int = 0
    @State private var todayPages: Int = 0
    @State private var monthSeconds: Int = 0
    @State private var monthAvgDailyMinutes: Int = 0
    @State private var monthBooksTouched: Int = 0
    @State private var yearSeconds: Int = 0
    @State private var yearBooksFinished: Int = 0
    @State private var yearBestStreak: Int = 0

    @State private var isLoading = true
    @State private var selectedSession: ReadingSession? = nil

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    VStack(spacing: 16) {
                        ProgressView()
                        Text("Loading stats...")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        VStack(spacing: Spacing.xl) {
                            mostReadSection
                            timeRollupSection
                            viewMoreSection
                        }
                        .padding(.vertical, Spacing.lg)
                    }
                }
            }
            .navigationTitle("Reading Stats")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .navigationDestination(for: TimePeriod.self) { period in
                TimePeriodDetailView(
                    period: period,
                    sessionData: sessionData,
                    bookData: bookData,
                    allSessions: allSessions
                )
            }
            .task { await loadStats() }
            .sheet(item: $selectedSession) { session in
                ReadingSessionDetailView(
                    session: session,
                    bookTitle: bookData.first(where: { $0.id == session.bookId })?.title
                )
            }
        }
    }

    // MARK: - Most Read Section

    private var mostReadSection: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Most Read")
                .font(.headline)
                .padding(.horizontal, Spacing.xl)

            if mostReadBooks.isEmpty {
                Text("No reading sessions yet")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, Spacing.xl)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Spacing.md) {
                        ForEach(Array(mostReadBooks.enumerated()), id: \.element.id) { index, book in
                            mostReadCard(book: book, rank: index + 1)
                        }
                    }
                    .padding(.horizontal, Spacing.xl)
                }
            }
        }
    }

    private func mostReadCard(book: MostReadBook, rank: Int) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            ZStack(alignment: .topLeading) {
                // Cover
                Group {
                    if let coverData = book.coverData, let uiImage = UIImage(data: coverData) {
                        Color.clear
                            .overlay {
                                Image(uiImage: uiImage)
                                    .resizable()
                                    .scaledToFill()
                            }
                            .clipped()
                    } else {
                        RoundedRectangle(cornerRadius: Radius.standard)
                            .fill(Color(.systemGray5))
                            .overlay {
                                Image(systemName: formatIcon(book.format))
                                    .font(.title)
                                    .foregroundStyle(.secondary)
                            }
                    }
                }
                .frame(width: 100, height: 150)
                .clipShape(RoundedRectangle(cornerRadius: Radius.standard))
                .shadow(Shadow.light)

                // Rank badge
                Text("\(rank)")
                    .font(.caption2)
                    .fontWeight(.bold)
                    .foregroundStyle(.white)
                    .frame(width: 20, height: 20)
                    .background(Circle().fill(Color.accentColor))
                    .offset(x: -4, y: -4)
            }

            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(book.title)
                    .font(.caption)
                    .fontWeight(.medium)
                    .lineLimit(2)

                Text(formatTime(book.totalSeconds))
                    .font(.caption2)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)

                Text("\(book.sessionCount) \(book.sessionCount == 1 ? "session" : "sessions")")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .frame(width: 100, alignment: .leading)
        }
    }

    // MARK: - Time Rollup Section

    private var timeRollupSection: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Activity")
                .font(.headline)
                .padding(.horizontal, Spacing.xl)

            VStack(spacing: 0) {
                // Today
                NavigationLink(value: TimePeriod.today) {
                    rollupRow(
                        period: .today,
                        stats: [
                            (formatTime(todaySeconds), "time"),
                            ("\(todaySessions)", todaySessions == 1 ? "session" : "sessions"),
                            ("\(todayPages)", todayPages == 1 ? "page" : "pages")
                        ]
                    )
                }
                .buttonStyle(.plain)

                Divider().padding(.leading, 52)

                // This Month
                NavigationLink(value: TimePeriod.thisMonth) {
                    rollupRow(
                        period: .thisMonth,
                        stats: [
                            (formatTime(monthSeconds), "total"),
                            ("\(monthAvgDailyMinutes)m", "avg/day"),
                            ("\(monthBooksTouched)", monthBooksTouched == 1 ? "book" : "books")
                        ]
                    )
                }
                .buttonStyle(.plain)

                Divider().padding(.leading, 52)

                // This Year
                NavigationLink(value: TimePeriod.thisYear) {
                    rollupRow(
                        period: .thisYear,
                        stats: [
                            (formatTime(yearSeconds), "total"),
                            ("\(yearBooksFinished)", "finished"),
                            ("\(yearBestStreak)d", "best streak")
                        ]
                    )
                }
                .buttonStyle(.plain)
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
    }

    private func rollupRow(period: TimePeriod, stats: [(value: String, label: String)]) -> some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: period.icon)
                .font(.body)
                .foregroundStyle(period.iconColor)
                .frame(width: 28)

            Text(period.title)
                .font(.subheadline)
                .fontWeight(.medium)

            Spacer()

            HStack(spacing: Spacing.lg) {
                ForEach(stats, id: \.label) { stat in
                    VStack(spacing: 1) {
                        Text(stat.value)
                            .font(.caption)
                            .fontWeight(.semibold)
                            .monospacedDigit()
                        Text(stat.label)
                            .font(.system(size: 9))
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Image(systemName: "chevron.right")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.md)
    }

    // MARK: - View More Section

    private var viewMoreSection: some View {
        NavigationLink {
            CustomRangeStatsView(
                sessionData: sessionData,
                bookData: bookData,
                allSessions: allSessions
            )
        } label: {
            HStack(spacing: Spacing.md) {
                Image(systemName: "calendar.badge.clock")
                    .font(.body)
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 28)

                Text("View Custom Range")
                    .font(.subheadline)
                    .fontWeight(.medium)

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.md)
            .background {
                RoundedRectangle(cornerRadius: Radius.large, style: .continuous)
                    .fill(.regularMaterial)
                    .overlay {
                        RoundedRectangle(cornerRadius: Radius.large, style: .continuous)
                            .strokeBorder(.separator, lineWidth: 0.5)
                    }
            }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, Spacing.xl)
    }

    // MARK: - Data Loading

    private func loadStats() async {
        isLoading = true
        let context = modelContext

        let descriptor = FetchDescriptor<ReadingSession>(
            sortBy: [SortDescriptor(\.startedAt, order: .reverse)]
        )
        guard let fetchedSessions = try? context.fetch(descriptor) else {
            isLoading = false
            return
        }

        let bookDescriptor = FetchDescriptor<DownloadedBook>()
        let downloadedBooks = (try? context.fetch(bookDescriptor)) ?? []

        let pid = serverConfig.selectedProfileId ?? ""
        let profileSessions = fetchedSessions.filter { $0.profileId == pid || $0.profileId.isEmpty }

        let extractedSessions = profileSessions.map {
            SessionValueType(
                id: $0.id,
                bookId: $0.bookId,
                format: $0.format,
                durationSeconds: $0.durationSeconds,
                contentDurationSeconds: $0.contentDurationSeconds,
                startedAt: $0.startedAt,
                endedAt: $0.endedAt,
                pagesRead: $0.pagesRead
            )
        }

        let extractedBooks = downloadedBooks.map {
            BookValueType(
                id: $0.id,
                title: $0.title,
                authorsDisplay: $0.authorsDisplay,
                coverData: $0.coverData,
                format: $0.format,
                isRead: $0.isRead
            )
        }

        let computed = await Task.detached {
            let calendar = Calendar.current
            let now = Date()
            let todayStart = calendar.startOfDay(for: now)
            let monthStart = calendar.date(from: calendar.dateComponents([.year, .month], from: now))!
            let yearStart = calendar.date(from: calendar.dateComponents([.year], from: now))!

            let bookMap = Dictionary(uniqueKeysWithValues: extractedBooks.map { ($0.id, $0) })

            // Most read (all time)
            var bookTimeMap: [String: (seconds: Int, count: Int)] = [:]
            for s in extractedSessions {
                let existing = bookTimeMap[s.bookId]
                bookTimeMap[s.bookId] = (
                    seconds: (existing?.seconds ?? 0) + s.durationSeconds,
                    count: (existing?.count ?? 0) + 1
                )
            }
            let mostRead = bookTimeMap
                .sorted { $0.value.seconds > $1.value.seconds }
                .prefix(10)
                .map { bookId, stats in
                    let book = bookMap[bookId]
                    return MostReadBook(
                        id: bookId,
                        title: book?.title ?? "Unknown Book",
                        authors: book?.authorsDisplay ?? "",
                        coverData: book?.coverData,
                        format: book?.format ?? "epub",
                        totalSeconds: stats.seconds,
                        sessionCount: stats.count
                    )
                }

            // Today
            let todaySessions = extractedSessions.filter { $0.startedAt >= todayStart }
            let tSeconds = todaySessions.reduce(0) { $0 + $1.durationSeconds }
            let tPages = todaySessions.compactMap(\.pagesRead).reduce(0, +)

            // This Month
            let monthSessions = extractedSessions.filter { $0.startedAt >= monthStart }
            let mSeconds = monthSessions.reduce(0) { $0 + $1.durationSeconds }
            let daysInMonth = max(1, calendar.dateComponents([.day], from: monthStart, to: now).day ?? 1)
            let mAvgDaily = (mSeconds / 60) / daysInMonth
            let mBooks = Set(monthSessions.map(\.bookId)).count

            // This Year
            let yearSessions = extractedSessions.filter { $0.startedAt >= yearStart }
            let ySeconds = yearSessions.reduce(0) { $0 + $1.durationSeconds }
            let yFinished = Set(yearSessions.map(\.bookId)).filter { bookId in
                bookMap[bookId]?.isRead == true
            }.count

            // Year best streak
            var daysWithReading: Set<Date> = []
            for s in yearSessions {
                daysWithReading.insert(calendar.startOfDay(for: s.startedAt))
            }
            let sortedDays = daysWithReading.sorted()
            var yBest = 0
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
                yBest = max(yBest, currentRun)
                previousDay = day
            }

            // Current streak (all time)
            var allDaysWithReading: Set<Date> = []
            for s in extractedSessions {
                allDaysWithReading.insert(calendar.startOfDay(for: s.startedAt))
            }
            var streak = 0
            var checkDate = todayStart
            if allDaysWithReading.contains(checkDate) {
                streak = 1
                checkDate = calendar.date(byAdding: .day, value: -1, to: checkDate)!
            } else {
                checkDate = calendar.date(byAdding: .day, value: -1, to: checkDate)!
            }
            while allDaysWithReading.contains(checkDate) {
                streak += 1
                checkDate = calendar.date(byAdding: .day, value: -1, to: checkDate)!
            }

            return (
                mostRead: mostRead,
                streak: streak,
                tSeconds: tSeconds,
                tCount: todaySessions.count,
                tPages: tPages,
                mSeconds: mSeconds,
                mAvgDaily: mAvgDaily,
                mBooks: mBooks,
                ySeconds: ySeconds,
                yFinished: yFinished,
                yBest: yBest
            )
        }.value

        sessionData = extractedSessions
        bookData = extractedBooks
        allSessions = profileSessions
        mostReadBooks = computed.mostRead
        streakDays = computed.streak
        todaySeconds = computed.tSeconds
        todaySessions = computed.tCount
        todayPages = computed.tPages
        monthSeconds = computed.mSeconds
        monthAvgDailyMinutes = computed.mAvgDaily
        monthBooksTouched = computed.mBooks
        yearSeconds = computed.ySeconds
        yearBooksFinished = computed.yFinished
        yearBestStreak = computed.yBest
        isLoading = false
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

    private func formatIcon(_ format: String) -> String {
        switch format.lowercased() {
        case "epub", "pdf": return "book.closed"
        case "audiobook", "m4b", "mp3": return "headphones"
        case "comic", "cbr", "cbz": return "book.pages"
        default: return "doc"
        }
    }
}
