//
//  AudiobookPlayerView.swift
//  Compendus
//
//  Audiobook player UI using shared AudiobookPlayer service
//

import SwiftUI
import SwiftData

struct AudiobookPlayerView: View {
    let book: DownloadedBook

    @Environment(AudiobookPlayer.self) private var player
    @Environment(OnDeviceTranscriptionService.self) private var transcriptionService

    @State private var showingChapters = false
    @State private var sleepTimerMinutes: Int?
    @State private var showingSleepTimer = false
    @State private var showLyrics = false
    @State private var loadedTranscript: Transcript?
    @State private var showBookDetail = false
    @State private var transcriptionPillDismissed = false
    /// When live transcribing, we pause playback until the transcript has
    /// buffered at least 30 s ahead of this position, then auto-resume.
    @State private var liveBufferResumeTime: Double?
    /// True when the current transcription was started as "live" (tied to playback).
    @State private var isLiveTranscription = false

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
                if let coverData = book.coverData, let uiImage = UIImage(data: coverData) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(width: geometry.size.width, height: geometry.size.height)
                        .blur(radius: 60)
                        .opacity(0.3)
                        .clipped()
                }

                VStack(spacing: 0) {
                    if showLyrics, liveBufferResumeTime != nil {
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
                    } else {
                        // Cover and info (centered in available space)
                        VStack(spacing: 14) {
                            Spacer()

                            // Cover image — tap to show details
                            if let coverData = book.coverData, let uiImage = UIImage(data: coverData) {
                                Image(uiImage: uiImage)
                                    .resizable()
                                    .aspectRatio(contentMode: .fit)
                                    .frame(maxWidth: geometry.size.width - 48)
                                    .clipShape(RoundedRectangle(cornerRadius: 12))
                                    .shadow(color: .black.opacity(0.3), radius: 16, x: 0, y: 8)
                                    .onTapGesture { showBookDetail = true }
                            } else {
                                RoundedRectangle(cornerRadius: 12)
                                    .fill(Color.gray.opacity(0.2))
                                    .frame(width: 280, height: 280)
                                    .overlay {
                                        Image(systemName: "headphones")
                                            .font(.system(size: 50))
                                            .foregroundStyle(.secondary)
                                    }
                                    .onTapGesture { showBookDetail = true }
                            }

                            // Title and author
                            VStack(spacing: 6) {
                                Text(book.title)
                                    .font(.title3)
                                    .fontWeight(.bold)
                                    .multilineTextAlignment(.center)
                                    .lineLimit(2)

                                Text(book.authorsDisplay)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)

                                if let narrator = book.narrator {
                                    Text("Narrated by \(narrator)")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .padding(.horizontal, 20)

                            // Current chapter
                            if let chapter = player.currentChapter {
                                Text(chapter.title)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .padding(.horizontal, 20)
                            }

                            Spacer()
                        }
                        .frame(maxWidth: .infinity)
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
            }
        }
        .ignoresSafeArea(edges: .bottom)
        .task {
            // Only load if this isn't already the active book
            if player.currentBook?.id != book.id {
                await player.loadBook(book)
            }
            if !player.isPlaying {
                player.play()
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
        .confirmationDialog("Sleep Timer", isPresented: $showingSleepTimer) {
            Button("15 minutes") { setSleepTimer(minutes: 15) }
            Button("30 minutes") { setSleepTimer(minutes: 30) }
            Button("45 minutes") { setSleepTimer(minutes: 45) }
            Button("60 minutes") { setSleepTimer(minutes: 60) }
            if sleepTimerMinutes != nil {
                Button("Cancel Timer", role: .destructive) {
                    sleepTimerMinutes = nil
                    player.cancelSleepTimer()
                }
            }
            Button("Cancel", role: .cancel) { }
        }
        .onChange(of: transcriptionService.partialTranscript?.segments.count) { _, _ in
            checkTranscriptBuffer()
        }
    }

    // MARK: - Player Controls

    private var playerControls: some View {
        VStack(spacing: 12) {
            // Progress slider
            VStack(spacing: 4) {
                Slider(
                    value: Binding(
                        get: { player.currentTime },
                        set: { player.seek(to: $0) }
                    ),
                    in: 0...max(1, player.duration)
                )
                .tint(.primary)

                HStack {
                    Text(formatTime(player.currentTime))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()

                    Spacer()

                    Text("-\(formatTime(player.duration - player.currentTime))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }

            // Playback controls
            HStack(spacing: 28) {
                Button {
                    player.skipBackward()
                } label: {
                    Image(systemName: "gobackward.15")
                        .font(.title2)
                }

                Button {
                    cancelLiveTranscriptionIfNeeded()
                    player.isFullPlayerPresented = false
                    player.stop()
                } label: {
                    Image(systemName: "stop.circle.fill")
                        .font(.system(size: 36))
                }

                Button {
                    if player.isPlaying {
                        player.pause()
                    } else {
                        player.play()
                    }
                } label: {
                    Image(systemName: player.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                        .font(.system(size: 56))
                }

                Button {
                    player.skipForward()
                } label: {
                    Image(systemName: "goforward.30")
                        .font(.title2)
                }
            }

            // Speed and utilities
            HStack {
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
                        .font(.subheadline)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color.gray.opacity(0.2))
                        .clipShape(Capsule())
                }

                Spacer()

                if let chapters = book.chapters, !chapters.isEmpty {
                    Button {
                        showingChapters = true
                    } label: {
                        Image(systemName: "list.bullet")
                            .font(.title3)
                    }
                }

                Button {
                    showingSleepTimer = true
                } label: {
                    Image(systemName: sleepTimerMinutes != nil ? "moon.fill" : "moon")
                        .font(.title3)
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom)
    }

    private func setSleepTimer(minutes: Int) {
        sleepTimerMinutes = minutes
        player.setSleepTimer(minutes: minutes)
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
        guard let fileURL = book.fileURL else { return }
        let duration = Double(book.duration ?? 0)
        guard duration > 0 else { return }

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
        guard let fileURL = book.fileURL else { return }
        let duration = Double(book.duration ?? 0)
        guard duration > 0 else { return }

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
