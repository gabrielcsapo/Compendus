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

    @State private var showingChapters = false
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
    @State private var showStopConfirmation = false
    @State private var sleepTimer: Timer?
    @State private var sleepTimerFireDate: Date?
    @State private var showSleepTimerMenu = false

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
            ZStack {
                // Background blur from cover art
                if let uiImage = CoverImageDecoder.decode(bookId: book.id, data: book.coverData) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(width: geometry.size.width, height: geometry.size.height)
                        .blur(radius: 60)
                        .opacity(0.3)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
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
                                bookFormat: book.format
                            )
                            .frame(width: scrubberSize, height: scrubberSize)
                            .onTapGesture { showBookDetail = true }

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

                    // Transcription pill (above player controls)
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

                    // Player controls (fixed at bottom)
                    playerControls
                }
                .frame(maxWidth: .infinity)
                .animation(.easeInOut(duration: 0.3), value: showLyrics)
            }
        }
        .ignoresSafeArea(edges: .bottom)
        .task {
            // Only load if this isn't already the active book
            if player.currentBook?.id != book.id {
                isLoadingBook = true
                await player.loadBook(book)
                isLoadingBook = false
            }
            // Load transcript if available
            if loadedTranscript == nil, let transcript = book.transcript {
                loadedTranscript = transcript
            }
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
        }
        .onChange(of: transcriptionService.partialTranscript?.segments.count) { _, _ in
            checkTranscriptBuffer()
        }
    }

    // MARK: - Player Controls

    private var playerControls: some View {
        VStack(spacing: 0) {
            // Single 5-button transport row
            HStack {
                Spacer()

                // Chapters
                let hasChapters = !(book.chapters?.isEmpty ?? true)
                Button { showingChapters = true } label: {
                    Image(systemName: "list.bullet")
                        .font(.title3)
                        .frame(width: 44, height: 44)
                }
                .disabled(!hasChapters)
                .opacity(hasChapters ? 1.0 : 0.3)
                .accessibilityLabel("Chapters")

                Spacer()

                // Skip back 15s
                Button { player.skipBackward() } label: {
                    Image(systemName: "gobackward.15")
                        .font(.title2)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Skip backward 15 seconds")

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

                // Skip forward 30s
                Button { player.skipForward() } label: {
                    Image(systemName: "goforward.30")
                        .font(.title2)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Skip forward 30 seconds")

                Spacer()

                // Speed picker
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
                } label: {
                    Text("\(player.playbackRate, specifier: "%.2g")x")
                        .font(.footnote.weight(.semibold))
                        .frame(width: 44, height: 44)
                }
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
