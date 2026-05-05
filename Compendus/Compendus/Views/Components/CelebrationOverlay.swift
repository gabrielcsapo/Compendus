//
//  CelebrationOverlay.swift
//  Compendus
//
//  Watches reading sessions and fires celebration banner toasts on milestones.
//  Mirrors web's `useReadingMilestones()` hook so behavior is consistent across
//  platforms (Duolingo-style positive feedback).
//
//  Triggers (each fires at most once per relevant unit):
//    - Daily goal hit  → once per day (keyed by YYYY-MM-DD)
//    - Streak milestone → at 3 / 7 / 14 / 30 / 60 / 100 / 200 / 365 days
//
//  Persistence is in UserDefaults so app relaunches don't replay celebrations.
//

import SwiftUI
import SwiftData

private let streakMilestones = [3, 7, 14, 30, 60, 100, 200, 365]

private enum DefaultsKeys {
    static let dailyGoalCelebratedFor = "compendus.celebrated.dailyGoal"
    static let highestStreakCelebrated = "compendus.celebrated.streak"
    /// Last booksRead count we celebrated on this device. Matches web's
    /// `compendus.celebrated.booksRead` key so reinstalls share baselines.
    static let highestBooksCelebrated = "compendus.celebrated.booksRead"
}

private func todayKey() -> String {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: Date())
}

struct CelebrationOverlay<Content: View>: View {
    let content: () -> Content

    @Environment(ServerConfig.self) private var serverConfig
    @Query(sort: \ReadingSession.startedAt, order: .reverse) private var sessions: [ReadingSession]
    /// Watched for book-finished celebrations. SwiftData mirrors
    /// `userBookState.isRead` from the server (see SyncService), so this
    /// reflects books marked read on any device once sync completes.
    @Query private var downloadedBooks: [DownloadedBook]
    @AppStorage("compendus.dailyGoalMinutes") private var dailyGoalMinutes: Int = 15

    @State private var bannerMessage: String?
    @State private var bannerType: BannerToastType = .success
    @State private var hasInitializedBaseline = false

    init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    private var booksReadCount: Int {
        let pid = serverConfig.selectedProfileId ?? ""
        return downloadedBooks.filter {
            $0.isRead && ($0.profileId == pid || $0.profileId.isEmpty)
        }.count
    }

    var body: some View {
        content()
            .bannerToast($bannerMessage, type: bannerType, duration: 5.5)
            .onChange(of: sessions, initial: true) { _, _ in
                evaluateMilestones()
            }
            .onChange(of: booksReadCount) { _, _ in
                evaluateMilestones()
            }
    }

    private func evaluateMilestones() {
        let (streak, todayMinutes) = computeStreakAndToday()
        let booksRead = booksReadCount

        // First sighting on this device: establish a baseline so we don't fire
        // celebrations for already-achieved milestones on launch.
        if !hasInitializedBaseline {
            hasInitializedBaseline = true
            let defaults = UserDefaults.standard
            if defaults.object(forKey: DefaultsKeys.highestStreakCelebrated) == nil {
                let highest = streakMilestones.filter { streak >= $0 }.last ?? 0
                defaults.set(highest, forKey: DefaultsKeys.highestStreakCelebrated)
            }
            if defaults.object(forKey: DefaultsKeys.highestBooksCelebrated) == nil {
                defaults.set(booksRead, forKey: DefaultsKeys.highestBooksCelebrated)
            }
            if defaults.string(forKey: DefaultsKeys.dailyGoalCelebratedFor) == nil
                && todayMinutes >= dailyGoalMinutes {
                defaults.set(todayKey(), forKey: DefaultsKeys.dailyGoalCelebratedFor)
            }
            return
        }

        // --- Daily goal hit ---
        if todayMinutes >= dailyGoalMinutes,
           UserDefaults.standard.string(forKey: DefaultsKeys.dailyGoalCelebratedFor) != todayKey() {
            UserDefaults.standard.set(todayKey(), forKey: DefaultsKeys.dailyGoalCelebratedFor)
            bannerType = .celebration(emoji: "\u{1F389}", title: "Daily goal complete!")
            bannerMessage = "You read \(todayMinutes) minutes today. Keep that streak going."
            HapticFeedback.success()
            return
        }

        // --- Streak milestone ---
        let lastStreak = UserDefaults.standard.integer(forKey: DefaultsKeys.highestStreakCelebrated)
        if let justHit = streakMilestones.first(where: { streak >= $0 && lastStreak < $0 }) {
            UserDefaults.standard.set(justHit, forKey: DefaultsKeys.highestStreakCelebrated)
            let body: String
            if justHit >= 100 {
                body = "That's a serious habit. We're proud."
            } else if justHit >= 30 {
                body = "A whole month of daily reading. Beautiful."
            } else if justHit >= 7 {
                body = "A full week of reading every day. Keep going."
            } else {
                body = "Three days in a row — momentum is real."
            }
            bannerType = .celebration(emoji: "\u{1F525}", title: "\(justHit)-day streak!")
            bannerMessage = body
            HapticFeedback.success()
            return
        }

        // --- Book finished ---
        let lastBooks = UserDefaults.standard.integer(forKey: DefaultsKeys.highestBooksCelebrated)
        if booksRead > lastBooks {
            UserDefaults.standard.set(booksRead, forKey: DefaultsKeys.highestBooksCelebrated)
            let finishedCount = booksRead - lastBooks
            bannerType = .celebration(
                emoji: "\u{1F4DA}",
                title: finishedCount == 1 ? "Book finished" : "\(finishedCount) books finished"
            )
            bannerMessage = "That's #\(booksRead) on your shelf."
            HapticFeedback.success()
        }
    }

    private func computeStreakAndToday() -> (streak: Int, todayMinutes: Int) {
        let r = StreakCalculator.compute(
            sessions: sessions,
            profileId: serverConfig.selectedProfileId ?? ""
        )
        return (r.streak, r.todayMinutes)
    }
}
