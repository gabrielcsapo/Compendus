//
//  AudiobookPlayerView.swift
//  Compendus
//
//  Audiobook player using AVFoundation
//

import SwiftUI
import SwiftData
import AVFoundation
import MediaPlayer

struct AudiobookPlayerView: View {
    let book: DownloadedBook

    @Environment(\.modelContext) private var modelContext
    @State private var player = AudiobookPlayer()

    @State private var showingChapters = false
    @State private var sleepTimerMinutes: Int?
    @State private var showingSleepTimer = false

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
                    // Cover and info (scrollable, takes available space)
                    ScrollView {
                        VStack(spacing: 16) {
                            // Cover image
                            if let coverData = book.coverData, let uiImage = UIImage(data: coverData) {
                                Image(uiImage: uiImage)
                                    .resizable()
                                    .aspectRatio(contentMode: .fit)
                                    .frame(maxWidth: geometry.size.width - 80, maxHeight: 250)
                                    .clipShape(RoundedRectangle(cornerRadius: 12))
                                    .shadow(color: .black.opacity(0.3), radius: 16, x: 0, y: 8)
                            } else {
                                RoundedRectangle(cornerRadius: 12)
                                    .fill(Color.gray.opacity(0.2))
                                    .frame(width: 200, height: 200)
                                    .overlay {
                                        Image(systemName: "headphones")
                                            .font(.system(size: 50))
                                            .foregroundStyle(.secondary)
                                    }
                            }

                            // Title and author
                            VStack(spacing: 4) {
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
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, 16)
                        .padding(.bottom, 8)
                    }

                    // Player controls (fixed at bottom)
                    VStack(spacing: 16) {
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
                        HStack(spacing: 40) {
                            Button {
                                player.skipBackward()
                            } label: {
                                Image(systemName: "gobackward.15")
                                    .font(.title2)
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
                .frame(maxWidth: .infinity)
            }
        }
        .ignoresSafeArea(edges: .bottom)
        .task {
            await loadAudiobook()
        }
        .onDisappear {
            saveProgress()
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
    }

    private func loadAudiobook() async {
        guard let fileURL = book.fileURL else { return }

        await player.load(url: fileURL, chapters: book.chapters)

        // Restore last position
        if let lastPosition = book.lastPosition, let time = Double(lastPosition) {
            player.seek(to: time)
        }

        // Setup Now Playing info
        player.setupNowPlayingInfo(
            title: book.title,
            artist: book.authorsDisplay,
            artwork: book.coverData.flatMap { UIImage(data: $0) }
        )
    }

    private func saveProgress() {
        book.lastPosition = String(player.currentTime)
        book.readingProgress = player.duration > 0 ? player.currentTime / player.duration : 0
        try? modelContext.save()
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
}

// MARK: - Chapters List

struct ChaptersListView: View {
    let chapters: [Chapter]
    let currentTime: Double
    let totalDuration: Double
    let onSelect: (Chapter) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(chapters) { chapter in
                Button {
                    onSelect(chapter)
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(chapter.title)
                                .foregroundStyle(isCurrentChapter(chapter) ? .blue : .primary)

                            HStack(spacing: 8) {
                                Text(chapter.startTimeDisplay)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)

                                // Chapter progress indicator
                                if let progress = chapterProgress(chapter) {
                                    ProgressView(value: progress)
                                        .frame(width: 50)
                                        .tint(.blue)
                                }
                            }
                        }

                        Spacer()

                        if isCurrentChapter(chapter) {
                            Image(systemName: "speaker.wave.2.fill")
                                .foregroundStyle(.blue)
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

// MARK: - Audio Player

@MainActor
@Observable
class AudiobookPlayer: NSObject {
    var isPlaying = false
    var currentTime: Double = 0
    var duration: Double = 0
    var playbackRate: Float = 1.0
    var currentChapter: Chapter?

    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private var chapters: [Chapter] = []
    @ObservationIgnored private var timer: Timer?
    @ObservationIgnored private var sleepTimer: Timer?

    override init() {
        super.init()
        setupAudioSession()
        setupRemoteCommands()
    }

    func load(url: URL, chapters: [Chapter]?) async {
        self.chapters = chapters ?? []

        do {
            player = try AVAudioPlayer(contentsOf: url)
            player?.delegate = self
            player?.prepareToPlay()
            duration = player?.duration ?? 0
            updateCurrentChapter()
        } catch {
            print("Error loading audio: \(error)")
        }
    }

    func play() {
        player?.play()
        isPlaying = true
        startTimer()
    }

    func pause() {
        player?.pause()
        isPlaying = false
        stopTimer()
    }

    func seek(to time: Double) {
        player?.currentTime = time
        currentTime = time
        updateCurrentChapter()
        updateNowPlayingTime()
    }

    func skipForward() {
        let newTime = min(currentTime + 30, duration)
        seek(to: newTime)
    }

    func skipBackward() {
        let newTime = max(currentTime - 15, 0)
        seek(to: newTime)
    }

    func setPlaybackRate(_ rate: Float) {
        playbackRate = rate
        player?.rate = rate
        if isPlaying {
            player?.play()
        }
    }

    func setSleepTimer(minutes: Int) {
        sleepTimer?.invalidate()
        sleepTimer = Timer.scheduledTimer(withTimeInterval: Double(minutes * 60), repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.pause()
            }
        }
    }

    func cancelSleepTimer() {
        sleepTimer?.invalidate()
        sleepTimer = nil
    }

    func setupNowPlayingInfo(title: String, artist: String, artwork: UIImage?) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: artist,
            MPNowPlayingInfoPropertyPlaybackRate: playbackRate,
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: currentTime
        ]

        if let image = artwork {
            info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        }

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func setupAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("Audio session setup failed: \(error)")
        }
    }

    private func setupRemoteCommands() {
        let commandCenter = MPRemoteCommandCenter.shared()

        commandCenter.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                self?.play()
            }
            return .success
        }

        commandCenter.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                self?.pause()
            }
            return .success
        }

        commandCenter.skipForwardCommand.preferredIntervals = [30]
        commandCenter.skipForwardCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                self?.skipForward()
            }
            return .success
        }

        commandCenter.skipBackwardCommand.preferredIntervals = [15]
        commandCenter.skipBackwardCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                self?.skipBackward()
            }
            return .success
        }

        commandCenter.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            Task { @MainActor in
                self?.seek(to: event.positionTime)
            }
            return .success
        }
    }

    private func startTimer() {
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self = self, let player = self.player else { return }
                self.currentTime = player.currentTime
                self.updateCurrentChapter()
                self.updateNowPlayingTime()
            }
        }
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }

    private func updateCurrentChapter() {
        guard !chapters.isEmpty else {
            currentChapter = nil
            return
        }

        for (index, chapter) in chapters.enumerated() {
            let nextStart = index + 1 < chapters.count ? chapters[index + 1].startTime : Double.infinity
            if currentTime >= chapter.startTime && currentTime < nextStart {
                if currentChapter?.id != chapter.id {
                    currentChapter = chapter
                }
                return
            }
        }
    }

    private func updateNowPlayingTime() {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentTime
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? playbackRate : 0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}

extension AudiobookPlayer: AVAudioPlayerDelegate {
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            self.isPlaying = false
            self.stopTimer()
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
    .modelContainer(for: DownloadedBook.self, inMemory: true)
}
