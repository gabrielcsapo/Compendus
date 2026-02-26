//
//  AudiobookPlayerService.swift
//  Compendus
//
//  Persistent audiobook player service that survives view dismissal
//  and supports background audio playback.
//

import SwiftUI
import SwiftData
import AVFoundation
import MediaPlayer
import WidgetKit

@MainActor
@Observable
class AudiobookPlayer: NSObject {
    var isPlaying = false
    var currentTime: Double = 0
    var duration: Double = 0
    var playbackRate: Float = 1.0
    var currentChapter: Chapter?

    var currentBook: DownloadedBook?
    var isFullPlayerPresented = false
    var modelContainer: ModelContainer?

    var hasActiveSession: Bool {
        currentBook != nil && duration > 0
    }

    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private var chapters: [Chapter] = []
    @ObservationIgnored private var timer: Timer?
    @ObservationIgnored private var sleepTimer: Timer?
    @ObservationIgnored private var progressSaveTimer: Timer?

    override init() {
        super.init()
        setupAudioSession()
        setupRemoteCommands()
        observeAppLifecycle()
        observeAudioInterruptions()
    }

    // MARK: - Book Lifecycle

    func loadBook(_ book: DownloadedBook) async {
        // Save progress of current book if switching
        if let current = currentBook, current.id != book.id {
            saveProgress()
            stopPlayback()
        }

        currentBook = book

        guard let fileURL = book.fileURL else { return }
        await load(url: fileURL, chapters: book.chapters)

        // Restore last position
        if let lastPosition = book.lastPosition, let time = Double(lastPosition) {
            seek(to: time)
        }

        setupNowPlayingInfo(
            title: book.title,
            artist: book.authorsDisplay,
            artwork: book.coverData.flatMap { UIImage(data: $0) }
        )

        startProgressSaveTimer()
    }

    func stop() {
        saveProgress()
        stopPlayback()
        currentBook = nil
        currentChapter = nil
        progressSaveTimer?.invalidate()
        progressSaveTimer = nil
        cancelSleepTimer()
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    // MARK: - Playback

    private func load(url: URL, chapters: [Chapter]?) async {
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

    // MARK: - Progress Saving

    func saveProgress() {
        guard let book = currentBook, let container = modelContainer else { return }
        let bookId = book.id
        let time = currentTime
        let progress = duration > 0 ? currentTime / duration : 0

        let context = ModelContext(container)
        let descriptor = FetchDescriptor<DownloadedBook>(
            predicate: #Predicate { $0.id == bookId }
        )
        guard let dbBook = try? context.fetch(descriptor).first else { return }
        dbBook.lastPosition = String(time)
        dbBook.readingProgress = progress
        dbBook.lastReadAt = Date()
        try? context.save()

        // Update widget
        let widgetBook = WidgetBook(
            id: bookId,
            title: book.title,
            author: book.authorsDisplay,
            format: book.format,
            progress: progress,
            coverData: book.coverData,
            lastReadAt: Date()
        )
        WidgetDataManager.shared.saveCurrentBook(widgetBook)
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: - Now Playing

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

    // MARK: - Private Setup

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

    private func observeAppLifecycle() {
        NotificationCenter.default.addObserver(
            forName: UIApplication.willResignActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.saveProgress()
            }
        }
    }

    private func observeAudioInterruptions() {
        NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let info = notification.userInfo,
                  let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }
            Task { @MainActor in
                if type == .began {
                    self?.isPlaying = false
                    self?.stopTimer()
                }
            }
        }
    }

    // MARK: - Timers

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

    private func startProgressSaveTimer() {
        progressSaveTimer?.invalidate()
        progressSaveTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.saveProgress()
            }
        }
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

    private func stopPlayback() {
        player?.stop()
        player = nil
        isPlaying = false
        currentTime = 0
        duration = 0
        stopTimer()
    }
}

extension AudiobookPlayer: @preconcurrency AVAudioPlayerDelegate {
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            self.isPlaying = false
            self.stopTimer()
            self.saveProgress()
        }
    }
}
