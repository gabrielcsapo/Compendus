//
//  StreakCalculator.swift
//  Compendus
//
//  Computes the user's current reading streak, today's minutes, and whether
//  a "freeze" is propping the streak up (1 forgiven missed day per rolling
//  7-day window). Mirrors the server-side logic in `app/lib/stats.ts` so
//  iOS and web show the same numbers without round-tripping to the server.
//

import Foundation

enum StreakCalculator {
    /// Number of missed days allowed per rolling window. Matches server.
    static let freezeWindowDays = 7

    struct Result {
        let streak: Int
        let todayMinutes: Int
        /// True if the streak is currently being protected by a freeze
        /// (i.e. the most recent forgiven miss is still within the
        /// rolling 7-day window).
        let hasFreeze: Bool
    }

    /// Compute the streak/today/freeze for a profile from raw reading
    /// sessions. Sessions are filtered to the given profile id; sessions
    /// with an empty profileId are treated as belonging to the same user
    /// (legacy data).
    static func compute(
        sessions: [ReadingSession],
        profileId: String,
        now: Date = Date()
    ) -> Result {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: now)

        var daysWithReading: Set<Date> = []
        var todaySeconds = 0
        for s in sessions where s.profileId == profileId || s.profileId.isEmpty {
            let day = calendar.startOfDay(for: s.startedAt)
            daysWithReading.insert(day)
            if day == today { todaySeconds += s.durationSeconds }
        }

        guard !daysWithReading.isEmpty else {
            return Result(streak: 0, todayMinutes: todaySeconds / 60, hasFreeze: false)
        }

        // Walk backward from today; allow up to one missed day per rolling
        // freezeWindowDays. A forgiven day counts toward the streak (matches
        // Duolingo: "you have a 5-day streak even with one frozen gap").
        var streak = 0
        var freezeUsedAtIdx: Int? = nil
        let maxBack = daysWithReading.count + freezeWindowDays

        for i in 0...maxBack {
            guard let d = calendar.date(byAdding: .day, value: -i, to: today) else { break }
            if daysWithReading.contains(d) {
                streak += 1
            } else if i == 0 {
                // Today — don't count, don't break.
                continue
            } else if freezeUsedAtIdx == nil || i - (freezeUsedAtIdx ?? 0) >= freezeWindowDays {
                // No active freeze in the window → forgive this miss.
                freezeUsedAtIdx = i
                streak += 1
            } else {
                break
            }
        }

        // Is the freeze still "load-bearing" — i.e. without it, would the
        // streak end near here? Matches the server semantic in app/lib/stats.ts
        // (post-loop clear when currentStreak - freezeUsedAtIdx > window).
        let hasFreeze: Bool
        if let used = freezeUsedAtIdx, streak - used <= freezeWindowDays {
            hasFreeze = true
        } else {
            hasFreeze = false
        }

        return Result(streak: streak, todayMinutes: todaySeconds / 60, hasFreeze: hasFreeze)
    }
}
