//
//  AudiobookPlayerView.swift
//  Compendus
//
//  Audiobook player UI using shared AudiobookPlayer service
//

import SwiftUI
import SwiftData
import AVKit
import MediaPlayer
import EPUBReader

struct AudiobookPlayerView: View {
    let book: DownloadedBook

    @Environment(AudiobookPlayer.self) private var player
    @Environment(OnDeviceTranscriptionService.self) private var transcriptionService
    @Environment(ServerConfig.self) private var serverConfig
    @Environment(APIService.self) private var apiService
    @Environment(AppNavigation.self) private var appNavigation
    @Environment(DownloadManager.self) private var downloadManager
    @Environment(StorageManager.self) private var storageManager
    @Environment(ReaderSettings.self) private var readerSettings
    @Environment(\.modelContext) private var modelContext

    @State private var showingChapters = false
    /// Brief visual confirmation after the user taps the bookmark button —
    /// flips the SF Symbol to `.fill` for ~1.2s before fading back.
    @State private var justBookmarked = false

    // P2.1 — fine-grained speed slider (long-press the speed button)
    @State private var showingSpeedSlider = false
    // P2.2 — user-configurable skip intervals (Settings → Audio)
    @AppStorage("compendus.audiobook.skipForward") private var skipForwardSeconds: Double = 30
    @AppStorage("compendus.audiobook.skipBackward") private var skipBackwardSeconds: Double = 15

    /// Map skip seconds to the closest SF Symbol available (10/15/30/45/60/75/90).
    private var skipForwardIcon: String { skipIcon(seconds: skipForwardSeconds, forward: true) }
    private var skipBackwardIcon: String { skipIcon(seconds: skipBackwardSeconds, forward: false) }

    private func skipIcon(seconds: Double, forward: Bool) -> String {
        let buckets: [Int] = [5, 10, 15, 30, 45, 60, 75, 90]
        let target = Int(seconds)
        let closest = buckets.min(by: { abs($0 - target) < abs($1 - target) }) ?? (forward ? 30 : 15)
        let prefix = forward ? "goforward" : "gobackward"
        return "\(prefix).\(closest)"
    }
    @State private var showLyrics = false
    @State private var loadedTranscript: Transcript?
    @State private var showBookDetail = false
    @State private var transcriptionPillDismissed = false
    /// When live transcribing, we pause playback until the transcript has
    /// buffered at least 30 s ahead of this position, then auto-resume.
    @State private var liveBufferResumeTime: Double?
    /// True when the current transcription was started as "live" (tied to playback).
    @State private var isLiveTranscription = false
    @State private var isLoadingBook = false
    @State private var loadError: String?
    @State private var showStopConfirmation = false
    @State private var sleepTimer: Timer?
    @State private var sleepTimerFireDate: Date?
    @State private var showSleepTimerMenu = false
    // P2.7 — auto-detect chapters via silence scan when the book has none.
    @State private var chapterDetectionService = ChapterDetectionService()
    @State private var detectionToast: String?
    @State private var detectionToastType: BannerToastType = .success
    // P3.1 — next-in-series handoff. Card surfaces in the last 30s of a book
    // when the next entry in the series is already downloaded.
    @State private var nextInSeries: DownloadedBook?
    @State private var nextInSeriesDismissed = false

    private var showTranscriptionPill: Bool {
        !transcriptionPillDismissed && (
            transcriptionService.isAvailable ||
            effectiveTranscript != nil ||
            transcriptionService.activeBookId == book.id
        )
    }

    /// Uses the full transcript if available, otherwise the partial transcript
    /// from an in-progress on-device transcription for this book.
    private var effectiveTranscript: Transcript? {
        if let loaded = loadedTranscript {
            return loaded
        }
        if transcriptionService.activeBookId == book.id,
           let partial = transcriptionService.partialTranscript {
            return partial
        }
        return nil
    }

    var body: some View {
        GeometryReader { geometry in
            VStack(spacing: 0) {
                // ── Bloom zone (cover art + metadata only) ──────────────────
                ZStack {
                    // Vibrant blurred cover background (Spotify-style)
                    if let uiImage = CoverImageDecoder.decode(bookId: book.id, data: book.coverData) {
                        Image(uiImage: uiImage)
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .saturation(1.8)
                            .blur(radius: 50)
                            .opacity(0.65)
                            .clipped()
                    }

                // Bottom fade — blends bloom into the controls panel below
                VStack(spacing: 0) {
                    Spacer()
                    LinearGradient(
                        colors: [.clear, Color(uiColor: .systemBackground)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: 120)
                }

                VStack(spacing: 0) {
                    if isLoadingBook {
                        Spacer()
                        ProgressView()
                        Text("Loading audiobook...")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .padding(.top, 8)
                        Spacer()
                    } else if let errorMessage = loadError {
                        Spacer()
                        VStack(spacing: 12) {
                            Image(systemName: "exclamationmark.circle")
                                .font(.system(size: 36))
                                .foregroundStyle(.secondary)
                            Text(errorMessage)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                            Button("Try Again") {
                                loadError = nil
                                isLoadingBook = true
                                Task {
                                    let timeoutTask = Task {
                                        try? await Task.sleep(nanoseconds: 15_000_000_000)
                                        if isLoadingBook {
                                            isLoadingBook = false
                                            loadError = "Loading timed out. Please try again."
                                        }
                                    }
                                    await player.loadBook(book)
                                    timeoutTask.cancel()
                                    isLoadingBook = false
                                }
                            }
                            .buttonStyle(.bordered)
                        }
                        .padding()
                        Spacer()
                    } else if showLyrics, liveBufferResumeTime != nil {
                        // Buffering transcript before playback resumes
                        VStack(spacing: 16) {
                            Spacer()
                            ProgressView()
                            Text("Buffering transcript...")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Text("Playback will resume once enough text is ready")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                            Spacer()
                        }
                        .frame(maxWidth: .infinity)
                        .transition(.opacity)
                    } else if showLyrics, let transcript = effectiveTranscript {
                        // Lyrics view (replaces cover when active)
                        VStack(spacing: 8) {
                            Text(book.title)
                                .font(.headline)
                                .lineLimit(1)
                                .padding(.top, 12)

                            if let chapter = player.currentChapter {
                                Text(chapter.title)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }

                            AudioLyricsView(
                                transcript: transcript,
                                currentTime: player.currentTime,
                                onSeek: { time in player.seek(to: time) }
                            )
                        }
                        .transition(.opacity)
                    } else {
                        // Circular scrubber + metadata — expands to fill available space
                        // so that playerControls stays pinned to the bottom
                        VStack(spacing: 10) {
                            Spacer(minLength: 0)

                            // Circular scrubber with cover art inside
                            let scrubberSize = min(geometry.size.width - 40, geometry.size.height * 0.45)
                            CircularScrubberView(
                                currentTime: player.currentTime,
                                duration: player.duration,
                                onSeek: { player.seek(to: $0) },
                                coverImage: CoverImageDecoder.decode(bookId: book.id, data: book.coverData),
                                bookFormat: book.format,
                                chapters: book.chapters ?? []
                            )
                            .frame(width: scrubberSize, height: scrubberSize)
                            .onTapGesture { showBookDetail = true }
                            // P3.2 — long-press cover for quick moment bookmark.
                            // Spotify / Audible-style affordance.
                            .onLongPressGesture(minimumDuration: 0.5) {
                                bookmarkCurrentMoment()
                            }

                            // Elapsed / remaining time
                            HStack {
                                Text(formatTime(player.currentTime))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .monospacedDigit()
                                Spacer()
                                Text("-\(formatTime(max(0, player.duration - player.currentTime)))")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .monospacedDigit()
                            }
                            .padding(.horizontal, 28)

                            // Title, author, narrator
                            VStack(spacing: 4) {
                                Text(book.title)
                                    .font(.title3)
                                    .fontWeight(.bold)
                                    .multilineTextAlignment(.center)
                                    .lineLimit(2)

                                let authorNarrator = [book.authorsDisplay, book.narrator.map { "Narrated by \($0)" }]
                                    .compactMap { $0 }
                                    .joined(separator: " · ")
                                Text(authorNarrator)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .multilineTextAlignment(.center)
                                    .lineLimit(2)
                            }
                            .padding(.horizontal, 20)

                            // Current chapter — primary navigation affordance
                            if let chapter = player.currentChapter {
                                Button { showingChapters = true } label: {
                                    HStack(spacing: 4) {
                                        Text(chapter.title)
                                            .font(.subheadline)
                                            .fontWeight(.medium)
                                            .lineLimit(1)
                                        Image(systemName: "chevron.right")
                                            .font(.caption.weight(.semibold))
                                    }
                                    .foregroundStyle(.tint)
                                }
                                .disabled(book.chapters?.isEmpty ?? true)
                            }

                            Spacer(minLength: 0)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .transition(.opacity)
                    }

                }
                .frame(maxWidth: .infinity)
                .animation(.easeInOut(duration: 0.3), value: showLyrics)
                } // ZStack (bloom zone)
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                // ── Controls zone (outside bloom) ────────────────────────────
                // Next-in-series handoff card (P3.1) — fades in during the
                // final 30s of playback when the next series entry is downloaded.
                if showNextInSeriesCard, let next = nextInSeries {
                    nextInSeriesCard(next: next)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 8)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }

                // Transcription pill
                if showTranscriptionPill {
                    TranscriptionPill(
                        book: book,
                        showLyrics: showLyrics,
                        onToggleLyrics: { showLyrics.toggle() },
                        onStartLiveTranscription: { startLiveTranscription() },
                        onStartFullTranscription: { startFullTranscription() },
                        onDismiss: { withAnimation { transcriptionPillDismissed = true } }
                    )
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }

                // Player controls
                playerControls
            } // VStack (outer)
        }
        .ignoresSafeArea(edges: .bottom)
        .task {
            // Only load if this isn't already the active book
            if player.currentBook?.id != book.id {
                isLoadingBook = true
                let timeoutTask = Task {
                    try? await Task.sleep(nanoseconds: 15_000_000_000)
                    if isLoadingBook {
                        isLoadingBook = false
                        loadError = "Loading timed out. Check your connection and try again."
                    }
                }
                await player.loadBook(book)
                timeoutTask.cancel()
                isLoadingBook = false
            }
            // Load transcript if available
            if loadedTranscript == nil, let transcript = book.transcript {
                loadedTranscript = transcript
            }
            // P3.1 — find next downloaded audiobook in the same series.
            loadNextInSeries()
        }
        .sheet(isPresented: $showingChapters) {
            ChaptersListView(
                chapters: book.chapters ?? [],
                currentTime: player.currentTime,
                totalDuration: player.duration
            ) { chapter in
                player.seek(to: chapter.startTime)
                showingChapters = false
            }
        }
        .sheet(isPresented: $showBookDetail) {
            NavigationStack {
                DownloadedBookDetailView(book: book)
            }
            .environment(serverConfig)
            .environment(apiService)
            .environment(appNavigation)
            .environment(player)
            .environment(downloadManager)
            .environment(storageManager)
            .environment(readerSettings)
        }
        .sheet(isPresented: $showingSpeedSlider) {
            SpeedSliderSheet(
                rate: Binding(
                    get: { Double(player.playbackRate) },
                    set: { player.setPlaybackRate(Float($0)) }
                )
            )
            .presentationDetents([.height(280)])
        }
        .onChange(of: transcriptionService.partialTranscript?.segments.count) { _, _ in
            checkTranscriptBuffer()
        }
        .bannerToast($detectionToast, type: detectionToastType)
    }

    // MARK: - Player Controls

    // MARK: - Next-in-Series Card (P3.1)

    private var showNextInSeriesCard: Bool {
        guard nextInSeries != nil,
              !nextInSeriesDismissed,
              player.duration > 0 else { return false }
        let remaining = player.duration - player.currentTime
        return remaining > 0 && remaining < 30
    }

    @ViewBuilder
    private func nextInSeriesCard(next: DownloadedBook) -> some View {
        Button {
            playNextInSeries(next)
        } label: {
            HStack(spacing: 12) {
                if let uiImage = CoverImageDecoder.decode(bookId: next.id, data: next.coverData) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(width: 52, height: 78)
                        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                } else {
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(Color.secondary.opacity(0.2))
                        .frame(width: 52, height: 78)
                        .overlay {
                            Image(systemName: "headphones")
                                .foregroundStyle(.secondary)
                        }
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("UP NEXT IN SERIES")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.tint)
                        .tracking(0.5)
                    Text(next.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    if let narrator = next.narrator, !narrator.isEmpty {
                        Text(narrator)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    } else {
                        Text(next.authorsDisplay)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 0)

                Image(systemName: "play.circle.fill")
                    .font(.system(size: 36))
                    .foregroundStyle(.tint)
            }
            .padding(.vertical, 10)
            .padding(.leading, 10)
            .padding(.trailing, 12)
            .background {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(.ultraThinMaterial)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.primary.opacity(0.08), lineWidth: 0.5)
            }
            .overlay(alignment: .topTrailing) {
                Button {
                    withAnimation { nextInSeriesDismissed = true }
                } label: {
                    Image(systemName: "xmark")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.secondary)
                        .frame(width: 22, height: 22)
                        .background(Circle().fill(.ultraThinMaterial))
                }
                .offset(x: 8, y: -8)
                .accessibilityLabel("Dismiss")
            }
        }
        .buttonStyle(.plain)
    }

    private func loadNextInSeries() {
        guard let series = book.series, !series.isEmpty,
              let currentNumber = book.seriesNumber else {
            nextInSeries = nil
            return
        }
        let currentId = book.id
        let descriptor = FetchDescriptor<DownloadedBook>(
            predicate: #Predicate { $0.series == series }
        )
        guard let books = try? modelContext.fetch(descriptor) else {
            nextInSeries = nil
            return
        }
        nextInSeries = books
            .filter { other in
                guard other.id != currentId,
                      other.isAudiobook,
                      let num = other.seriesNumber else { return false }
                return num > currentNumber
            }
            .sorted { ($0.seriesNumber ?? .infinity) < ($1.seriesNumber ?? .infinity) }
            .first
    }

    private func playNextInSeries(_ next: DownloadedBook) {
        HapticFeedback.success()
        Task {
            await player.loadBook(next)
            player.play()
        }
    }

    @ViewBuilder
    private var chaptersButton: some View {
        let hasChapters = !(book.chapters?.isEmpty ?? true)
        if chapterDetectionService.isDetecting {
            ZStack {
                Circle()
                    .stroke(Color.primary.opacity(0.15), lineWidth: 2.5)
                Circle()
                    .trim(from: 0, to: max(0.02, chapterDetectionService.progress))
                    .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.linear(duration: 0.2), value: chapterDetectionService.progress)
            }
            .frame(width: 22, height: 22)
            .frame(width: 44, height: 44)
            .accessibilityLabel("Detecting chapters")
        } else if hasChapters {
            Button { showingChapters = true } label: {
                Image(systemName: "list.bullet")
                    .font(.title3)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Chapters")
        } else {
            Button { detectChapters() } label: {
                Image(systemName: "sparkles")
                    .font(.title3)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Detect chapters automatically")
        }
    }

    private var playerControls: some View {
        VStack(spacing: 0) {
            // 6-button transport row (chapters, bookmark, back, play, fwd, speed)
            HStack {
                Spacer()

                // Chapters — falls back to a "Detect chapters" affordance when
                // the book has no embedded chapter markers (P2.7).
                chaptersButton

                Spacer()

                // Moment bookmark (P1.1) — capture "this moment was important"
                Button {
                    bookmarkCurrentMoment()
                } label: {
                    Image(systemName: justBookmarked ? "bookmark.fill" : "bookmark")
                        .font(.title3)
                        .foregroundStyle(justBookmarked ? Color.accentColor : Color.primary)
                        .contentTransition(.symbolEffect(.replace))
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Bookmark this moment")

                Spacer()

                // Skip back — configurable interval
                Button { player.skipBackward() } label: {
                    Image(systemName: skipBackwardIcon)
                        .font(.title2)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Skip backward \(Int(skipBackwardSeconds)) seconds")

                Spacer()

                // Play/Pause — long-press to stop
                Button {
                    if player.isPlaying { player.pause() } else { player.play() }
                } label: {
                    Image(systemName: player.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                        .font(.system(size: 64))
                        .contentTransition(.symbolEffect(.replace))
                }
                .accessibilityLabel(player.isPlaying ? "Pause" : "Play")

                Spacer()

                // Skip forward — configurable interval
                Button { player.skipForward() } label: {
                    Image(systemName: skipForwardIcon)
                        .font(.title2)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Skip forward \(Int(skipForwardSeconds)) seconds")

                Spacer()

                // Speed picker — tap for presets, long-press for fine slider (P2.1)
                Menu {
                    ForEach([0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0], id: \.self) { speed in
                        Button {
                            player.setPlaybackRate(Float(speed))
                        } label: {
                            HStack {
                                Text("\(speed, specifier: "%.2g")x")
                                if player.playbackRate == Float(speed) {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                    Divider()
                    Button {
                        showingSpeedSlider = true
                    } label: {
                        Label("Fine control…", systemImage: "slider.horizontal.3")
                    }
                } label: {
                    Text("\(player.playbackRate, specifier: "%.2g")x")
                        .font(.footnote.weight(.semibold))
                        .frame(width: 44, height: 44)
                }
                .simultaneousGesture(
                    LongPressGesture(minimumDuration: 0.4).onEnded { _ in
                        showingSpeedSlider = true
                        HapticFeedback.lightImpact()
                    }
                )
                .accessibilityLabel("Playback speed, currently \(player.playbackRate, specifier: "%.2g")x")

                Spacer()
            }
            .padding(.bottom, 16)

            // Secondary row: stop | AirPlay | sleep timer
            HStack {
                // Stop
                Button {
                    showStopConfirmation = true
                } label: {
                    Image(systemName: "stop.circle")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Stop playback")
                .confirmationDialog("Stop playback?", isPresented: $showStopConfirmation, titleVisibility: .visible) {
                    Button("Stop", role: .destructive) {
                        cancelLiveTranscriptionIfNeeded()
                        cancelSleepTimer()
                        player.isFullPlayerPresented = false
                        player.stop()
                    }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("This will end your listening session.")
                }

                Spacer()

                // AirPlay — explicit size so MPVolumeView renders correctly
                ZStack {
                    AirPlayButton()
                }
                .frame(width: 44, height: 44)

                Spacer()

                // Sleep timer
                Button {
                    showSleepTimerMenu = true
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "moon.zzz")
                            .font(.callout)
                        if let fireDate = sleepTimerFireDate {
                            Text(sleepTimerLabel(fireDate: fireDate))
                                .font(.caption.weight(.medium))
                        }
                    }
                    .foregroundStyle(sleepTimerFireDate != nil ? Color.accentColor : Color.secondary)
                    .frame(height: 36)
                }
                .accessibilityLabel(sleepTimerFireDate != nil ? "Sleep timer active" : "Set sleep timer")
                .confirmationDialog("Sleep Timer", isPresented: $showSleepTimerMenu, titleVisibility: .visible) {
                    if sleepTimerFireDate != nil {
                        Button("Cancel Timer", role: .destructive) { cancelSleepTimer() }
                    }
                    Button("15 minutes") { setSleepTimer(minutes: 15) }
                    Button("30 minutes") { setSleepTimer(minutes: 30) }
                    Button("45 minutes") { setSleepTimer(minutes: 45) }
                    Button("1 hour") { setSleepTimer(minutes: 60) }
                    if let chapter = player.currentChapter,
                       let chapters = book.chapters,
                       let idx = chapters.firstIndex(where: { $0.id == chapter.id }),
                       idx + 1 < chapters.count {
                        Button("End of chapter") { setSleepTimerEndOfChapter() }
                    }
                    Button("Cancel", role: .cancel) {}
                }
            }
            .padding(.horizontal, 4)
            .padding(.bottom, 8)
        }
        .padding(.horizontal, 20)
        .padding(.bottom)
    }

    // MARK: - Sleep Timer

    private func setSleepTimer(minutes: Int) {
        cancelSleepTimer()
        let fireDate = Date().addingTimeInterval(Double(minutes) * 60)
        sleepTimerFireDate = fireDate
        sleepTimer = Timer.scheduledTimer(withTimeInterval: Double(minutes) * 60, repeats: false) { _ in
            player.pause()
            sleepTimerFireDate = nil
            sleepTimer = nil
        }
    }

    private func setSleepTimerEndOfChapter() {
        guard let chapter = player.currentChapter,
              let chapters = book.chapters,
              let idx = chapters.firstIndex(where: { $0.id == chapter.id }),
              idx + 1 < chapters.count else { return }
        let chapterEnd = chapters[idx + 1].startTime
        let secondsRemaining = max(1, chapterEnd - player.currentTime)
        cancelSleepTimer()
        let fireDate = Date().addingTimeInterval(secondsRemaining)
        sleepTimerFireDate = fireDate
        sleepTimer = Timer.scheduledTimer(withTimeInterval: secondsRemaining, repeats: false) { _ in
            player.pause()
            sleepTimerFireDate = nil
            sleepTimer = nil
        }
    }

    private func cancelSleepTimer() {
        sleepTimer?.invalidate()
        sleepTimer = nil
        sleepTimerFireDate = nil
    }

    private func sleepTimerLabel(fireDate: Date) -> String {
        let remaining = fireDate.timeIntervalSinceNow
        guard remaining > 0 else { return "" }
        let minutes = Int(remaining) / 60
        let seconds = Int(remaining) % 60
        if minutes > 0 {
            return "\(minutes)m"
        }
        return "\(seconds)s"
    }

    private func formatTime(_ seconds: Double) -> String {
        let hours = Int(seconds) / 3600
        let minutes = (Int(seconds) % 3600) / 60
        let secs = Int(seconds) % 60

        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, secs)
        }
        return String(format: "%d:%02d", minutes, secs)
    }

    // MARK: - Transcription

    private func startLiveTranscription() {
        guard let fileURL = book.fileURL else {
            print("[Transcription] Cannot start: book has no fileURL")
            return
        }
        // Prefer the player's loaded duration over stored metadata (may be nil/0)
        let duration = player.duration > 0 ? player.duration : Double(book.duration ?? 0)
        guard duration > 0 else {
            print("[Transcription] Cannot start: book duration is 0 (stored=\(String(describing: book.duration)), player=\(player.duration))")
            return
        }

        let resumeTime = player.currentTime
        player.pause()
        liveBufferResumeTime = resumeTime
        isLiveTranscription = true

        transcriptionService.transcribe(
            fileURL: fileURL,
            duration: duration,
            bookId: book.id,
            title: book.title,
            coverData: book.coverData,
            startFromTime: resumeTime
        )
        showLyrics = true
    }

    /// Resume playback once the partial transcript covers at least 30 s
    /// ahead of the position where we paused for live transcription.
    private func checkTranscriptBuffer() {
        guard let resumeTime = liveBufferResumeTime,
              let transcript = effectiveTranscript,
              let lastSegment = transcript.segments.last else { return }

        if lastSegment.end >= resumeTime + 30 {
            liveBufferResumeTime = nil
            player.play()
        }
    }

    /// Cancel an in-progress live transcription (tied to playback session).
    private func cancelLiveTranscriptionIfNeeded() {
        guard isLiveTranscription,
              transcriptionService.activeBookId == book.id else { return }
        transcriptionService.cancel()
        isLiveTranscription = false
        liveBufferResumeTime = nil
        showLyrics = false
    }

    private func startFullTranscription() {
        guard let fileURL = book.fileURL else {
            print("[Transcription] Cannot start full: book has no fileURL")
            return
        }
        let duration = player.duration > 0 ? player.duration : Double(book.duration ?? 0)
        guard duration > 0 else {
            print("[Transcription] Cannot start full: book duration is 0")
            return
        }

        transcriptionService.transcribe(
            fileURL: fileURL,
            duration: duration,
            bookId: book.id,
            title: book.title,
            coverData: book.coverData
        )
        showLyrics = true
    }

    // MARK: - Moment Bookmark (P1.1)

    /// Capture the current playback timestamp as a `BookBookmark` so the user
    /// can come back to "this exact moment". Surfaces in the Highlights tab
    /// alongside ebook/comic bookmarks via the `format = "audiobook"` field.
    private func bookmarkCurrentMoment() {
        let timestamp = player.currentTime
        let duration = player.duration > 0 ? player.duration : Double(book.duration ?? 0)
        let progression = duration > 0 ? timestamp / duration : 0

        let chapter = player.currentChapter
        let chapterIndex: Int = {
            guard let chapter, let chapters = book.chapters else { return 0 }
            return chapters.firstIndex(where: { $0.id == chapter.id }) ?? 0
        }()

        // Format the title as "Chapter 3 · 12:34" for at-a-glance scanning.
        let title: String = {
            let timeStr = Self.shortFormatTime(timestamp)
            if let chapterTitle = chapter?.title, !chapterTitle.isEmpty {
                return "\(chapterTitle) · \(timeStr)"
            }
            return "Bookmark at \(timeStr)"
        }()

        let bookmark = BookBookmark(
            bookId: book.id,
            pageIndex: chapterIndex,
            color: "#42a5f5",
            format: "audiobook",
            title: title,
            progression: progression,
            timestampSeconds: timestamp
        )
        bookmark.profileId = serverConfig.selectedProfileId ?? ""

        modelContext.insert(bookmark)
        do {
            try modelContext.save()
            HapticFeedback.success()
            withAnimation(.snappy) { justBookmarked = true }
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(1200))
                withAnimation(.easeOut(duration: 0.25)) { justBookmarked = false }
            }
        } catch {
            HapticFeedback.error()
        }
    }

    /// Scan the audiobook file for silence gaps and use them as chapter
    /// boundaries. Only runs when the book has no embedded chapters.
    /// Saves results to `book.chaptersData` and refreshes the active player
    /// so chapter-aware UI (ring scrubber ticks, "End of chapter" sleep
    /// timer, etc.) lights up immediately.
    private func detectChapters() {
        guard let fileURL = book.fileURL else {
            detectionToastType = .error
            detectionToast = "Audiobook file not available"
            return
        }
        let bookId = book.id
        Task {
            do {
                let chapters = try await chapterDetectionService.detect(fileURL: fileURL)
                if chapters.count < 2 {
                    await MainActor.run {
                        detectionToastType = .error
                        detectionToast = "No clear chapter breaks found"
                    }
                    return
                }
                let encoded = try JSONEncoder().encode(chapters)
                await MainActor.run {
                    book.chaptersData = encoded
                    do {
                        try modelContext.save()
                        if player.currentBook?.id == bookId {
                            player.updateChapters(chapters)
                        }
                        HapticFeedback.success()
                        detectionToastType = .success
                        detectionToast = "\(chapters.count) chapters detected"
                    } catch {
                        detectionToastType = .error
                        detectionToast = "Couldn't save chapters"
                    }
                }
            } catch is CancellationError {
                // User cancelled — no toast.
            } catch {
                await MainActor.run {
                    detectionToastType = .error
                    detectionToast = "Detection failed"
                }
            }
        }
    }

    /// "M:SS" or "H:MM:SS" depending on length.
    private static func shortFormatTime(_ seconds: Double) -> String {
        let total = Int(seconds)
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, s)
        }
        return String(format: "%d:%02d", m, s)
    }
}

// MARK: - Chapters List

struct ChaptersListView: View {
    let chapters: [Chapter]
    let currentTime: Double
    let totalDuration: Double
    let onSelect: (Chapter) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(ThemeManager.self) private var themeManager

    var body: some View {
        NavigationStack {
            List(chapters) { chapter in
                Button {
                    onSelect(chapter)
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(chapter.title)
                                .foregroundStyle(isCurrentChapter(chapter) ? themeManager.accentColor : Color.primary)

                            HStack(spacing: 8) {
                                Text(chapter.startTimeDisplay)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)

                                // Chapter progress indicator
                                if let progress = chapterProgress(chapter) {
                                    ProgressView(value: progress)
                                        .frame(width: 50)
                                        .tint(themeManager.accentColor)
                                }
                            }
                        }

                        Spacer()

                        if isCurrentChapter(chapter) {
                            Image(systemName: "speaker.wave.2.fill")
                                .foregroundStyle(themeManager.accentColor)
                                .symbolEffect(.variableColor.iterative, isActive: true)
                        }
                    }
                }
            }
            .navigationTitle("Chapters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }

    private func isCurrentChapter(_ chapter: Chapter) -> Bool {
        guard let index = chapters.firstIndex(where: { $0.id == chapter.id }) else { return false }
        let nextChapterStart = index + 1 < chapters.count ? chapters[index + 1].startTime : Double.infinity
        return currentTime >= chapter.startTime && currentTime < nextChapterStart
    }

    /// Calculate the progress within a chapter (0.0 to 1.0)
    private func chapterProgress(_ chapter: Chapter) -> Double? {
        guard let index = chapters.firstIndex(where: { $0.id == chapter.id }) else { return nil }
        let nextChapterStart = index + 1 < chapters.count ? chapters[index + 1].startTime : totalDuration
        let chapterDuration = nextChapterStart - chapter.startTime

        guard chapterDuration > 0 else { return nil }

        if currentTime < chapter.startTime {
            return nil // Chapter not started
        } else if currentTime >= nextChapterStart {
            return 1.0 // Chapter completed
        } else {
            // Currently in this chapter
            let elapsed = currentTime - chapter.startTime
            return elapsed / chapterDuration
        }
    }
}

// MARK: - AirPlay Button

/// MPVolumeView (showsVolumeSlider=false) is the most reliable way to embed an
/// AirPlay route button in a SwiftUI sheet — it has worked since iOS 2 and handles
/// all presentation context issues that AVRoutePickerView can hit in SwiftUI.
struct AirPlayButton: UIViewRepresentable {
    func makeUIView(context: Context) -> MPVolumeView {
        let view = MPVolumeView()
        view.showsVolumeSlider = false
        view.tintColor = .label
        return view
    }
    func updateUIView(_ uiView: MPVolumeView, context: Context) {}
}

#Preview {
    let book = DownloadedBook(
        id: "1",
        title: "Sample Audiobook",
        authors: ["Author Name"],
        format: "m4b",
        fileSize: 100000000,
        localPath: "books/1.m4b",
        duration: 36000,
        narrator: "Narrator Name"
    )

    NavigationStack {
        AudiobookPlayerView(book: book)
    }
    .environment(AudiobookPlayer())
    .modelContainer(for: DownloadedBook.self, inMemory: true)
}

// MARK: - Speed Slider Sheet (P2.1)

/// Fine-grained playback speed slider — accessed via long-press on the
/// transport row's speed button, or via the "Fine control…" Menu item.
/// 0.05 increments from 0.5x to 3.0x.
private struct SpeedSliderSheet: View {
    @Binding var rate: Double
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Text(String(format: "%.2fx", rate))
                    .font(.system(size: 56, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .padding(.top, 16)

                Slider(value: $rate, in: 0.5...3.0, step: 0.05) {
                    Text("Speed")
                }
                .accessibilityLabel("Playback speed")
                .padding(.horizontal)

                HStack(spacing: 8) {
                    ForEach([0.85, 1.0, 1.15, 1.3], id: \.self) { preset in
                        Button(String(format: "%.2gx", preset)) {
                            rate = preset
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                }
                Spacer()
            }
            .padding()
            .navigationTitle("Playback Speed")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
        }
    }
}
