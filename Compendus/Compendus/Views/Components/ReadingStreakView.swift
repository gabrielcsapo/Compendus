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
    @State private var streakDays: Int = 0
    @State private var todayMinutes: Int = 0
    @State private var showingStats = false

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
            .padding()
            .background(Color(.systemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .shadow(color: .black.opacity(0.05), radius: 2, y: 1)
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showingStats) {
            ReadingStatsView()
        }
        .task { calculateStreak() }
    }

    private func calculateStreak() {
        let descriptor = FetchDescriptor<ReadingSession>(
            sortBy: [SortDescriptor(\.startedAt, order: .reverse)]
        )
        guard let sessions = try? modelContext.fetch(descriptor), !sessions.isEmpty else {
            streakDays = 0
            todayMinutes = 0
            return
        }

        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())

        // Group sessions by day and sum today's reading time
        var daysWithReading: Set<Date> = []
        var todaySeconds: Int = 0

        for session in sessions {
            let day = calendar.startOfDay(for: session.startedAt)
            daysWithReading.insert(day)
            if day == today {
                todaySeconds += session.durationSeconds
            }
        }

        todayMinutes = todaySeconds / 60

        // Count consecutive days backwards from today
        var streak = 0
        var checkDate = today

        if daysWithReading.contains(checkDate) {
            streak = 1
            checkDate = calendar.date(byAdding: .day, value: -1, to: checkDate)!
        } else {
            // Check if streak is alive from yesterday
            checkDate = calendar.date(byAdding: .day, value: -1, to: checkDate)!
            if !daysWithReading.contains(checkDate) {
                streakDays = 0
                return
            }
        }

        while daysWithReading.contains(checkDate) {
            streak += 1
            checkDate = calendar.date(byAdding: .day, value: -1, to: checkDate)!
        }

        streakDays = streak
    }
}
