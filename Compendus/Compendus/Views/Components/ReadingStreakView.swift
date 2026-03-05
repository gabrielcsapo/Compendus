//
//  ReadingStreakView.swift
//  Compendus
//
//  Reading streak and daily reading time indicator
//

import SwiftUI
import SwiftData

struct ReadingStreakView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(ServerConfig.self) private var serverConfig
    @State private var streakDays: Int = 0
    @State private var todayMinutes: Int = 0
    @State private var showingStats = false
    @State private var isLoading = true

    var body: some View {
        Button {
            showingStats = true
        } label: {
            HStack(spacing: 16) {
                VStack(spacing: 4) {
                    Image(systemName: streakDays > 0 ? "flame.fill" : "flame")
                        .font(.title2)
                        .foregroundStyle(streakDays > 0 ? .orange : .secondary)
                    Text("\(streakDays)")
                        .font(.title2)
                        .fontWeight(.bold)
                    Text(streakDays == 1 ? "day" : "days")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .frame(width: 60)

                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("Reading Streak")
                            .font(.subheadline)
                            .fontWeight(.medium)

                        Spacer()

                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }

                    if todayMinutes > 0 {
                        Text("\(todayMinutes)m read today")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("Read today to keep your streak!")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()
            }
            .padding(Spacing.lg)
            .background(Color(.systemBackground))
            .clipShape(RoundedRectangle(cornerRadius: Radius.large, style: .continuous))
            .shadow(Shadow.subtle)
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showingStats) {
            ReadingStatsView()
        }
        .task { await calculateStreak() }
        .redacted(reason: isLoading ? .placeholder : [])
    }

    private func calculateStreak() async {
        isLoading = true
        let descriptor = FetchDescriptor<ReadingSession>(
            sortBy: [SortDescriptor(\.startedAt, order: .reverse)]
        )
        guard let allSessions = try? modelContext.fetch(descriptor), !allSessions.isEmpty else {
            streakDays = 0
            todayMinutes = 0
            isLoading = false
            return
        }

        let pid = serverConfig.selectedProfileId ?? ""
        let sessions = allSessions.filter { $0.profileId == pid || $0.profileId.isEmpty }
        guard !sessions.isEmpty else {
            streakDays = 0
            todayMinutes = 0
            isLoading = false
            return
        }

        // Extract value types for background computation
        let sessionData = sessions.map { (startedAt: $0.startedAt, durationSeconds: $0.durationSeconds) }

        let (computedStreak, computedMinutes) = await Task.detached {
            let calendar = Calendar.current
            let today = calendar.startOfDay(for: Date())

            var daysWithReading: Set<Date> = []
            var todaySeconds: Int = 0

            for session in sessionData {
                let day = calendar.startOfDay(for: session.startedAt)
                daysWithReading.insert(day)
                if day == today {
                    todaySeconds += session.durationSeconds
                }
            }

            var streak = 0
            var checkDate = today

            if daysWithReading.contains(checkDate) {
                streak = 1
                checkDate = calendar.date(byAdding: .day, value: -1, to: checkDate)!
            } else {
                checkDate = calendar.date(byAdding: .day, value: -1, to: checkDate)!
                if !daysWithReading.contains(checkDate) {
                    return (0, todaySeconds / 60)
                }
            }

            while daysWithReading.contains(checkDate) {
                streak += 1
                checkDate = calendar.date(byAdding: .day, value: -1, to: checkDate)!
            }

            return (streak, todaySeconds / 60)
        }.value

        streakDays = computedStreak
        todayMinutes = computedMinutes
        isLoading = false
    }
}
