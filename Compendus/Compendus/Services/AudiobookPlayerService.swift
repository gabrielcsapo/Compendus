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

    @ObservationIgnored private var player: AVPlayer?
    @ObservationIgnored private var playerItemObserver: Any?
    @ObservationIgnored private var chapters: [Chapter] = []
    @ObservationIgnored private var timer: Timer?
    @ObservationIgnored private var progressSaveTimer: Timer?
    @ObservationIgnored private var currentSession: ReadingSession?
    @ObservationIgnored private var sessionContext: ModelContext?
    @ObservationIgnored private var lifecycleObserver: Any?
    @ObservationIgnored private var interruptionObserver: Any?

    override init() {
        super.init()
        setupRemoteCommands()
        observeAppLifecycle()
        observeAudioInterruptions()
    }

    // MARK: - Book Lifecycle

    func loadBook(_ book: DownloadedBook) async {
        // Save progress of current book if switching
        if let current = currentBook, current.id != book.id {
            saveProgress()
            finalizeListeningSession()
            stopPlayback()
        }

        currentBook = book
        setupAudioSession()

        guard let fileURL = book.fileURL else { return }
        await load(url: fileURL, chapters: book.chapters)

        // Restore last position (universal JSON format or legacy plain number)
        if let lastPosition = book.lastPosition {
            var seekTime: Double?
            if let data = lastPosition.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               json["type"] as? String == "audio" {
                seekTime = json["timestamp"] as? Double
            } else {
                seekTime = Double(lastPosition)
            }
            if let time = seekTime {
                seek(to: time)
            }
        }

        setupNowPlayingInfo(
            title: book.title,
            artist: book.authorsDisplay,
            artwork: book.coverData.flatMap { UIImage(data: $0) }
        )

        startProgressSaveTimer()
        startListeningSession()
    }

    func stop() {
        saveProgress()
        finalizeListeningSession()
        stopPlayback()
        currentBook = nil
        currentChapter = nil
        progressSaveTimer?.invalidate()
        progressSaveTimer = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    // MARK: - Playback

    private func load(url: URL, chapters: [Chapter]?) async {
        self.chapters = chapters ?? []

        // Remove previous end-of-playback observer
        if let observer = playerItemObserver {
            NotificationCenter.default.removeObserver(observer)
            playerItemObserver = nil
        }

        let asset = AVURLAsset(url: url)
        do {
            let assetDuration = try await asset.load(.duration)
            duration = assetDuration.seconds.isNaN ? 0 : assetDuration.seconds
        } catch {
            print("Error loading audio asset: \(error)")
        }

        let item = AVPlayerItem(asset: asset)
        // Preserve pitch when adjusting playback rate
        item.audioTimePitchAlgorithm = .timeDomain

        player = AVPlayer(playerItem: item)
        // AirPlay requires AVPlayer; allowsExternalPlayback enables routing via AVRoutePickerView
        player?.allowsExternalPlayback = true
        // Local files don't need stalling prevention; skip buffering delay for instant start
        player?.automaticallyWaitsToMinimizeStalling = false

        playerItemObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.isPlaying = false
                self?.stopTimer()
                self?.saveProgress()
                self?.finalizeListeningSession()
            }
        }

        updateCurrentChapter()
    }

    func play() {
        // Setting rate to a non-zero value both starts and applies speed in AVPlayer
        player?.rate = playbackRate
        isPlaying = true
        startTimer()
    }

    func pause() {
        player?.pause()
        isPlaying = false
        stopTimer()
    }

    func seek(to time: Double) {
        player?.seek(to: CMTime(seconds: time, preferredTimescale: 600))
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
        if isPlaying {
            player?.rate = rate
        }
        updateNowPlayingTime()
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
        let posDict: [String: Any] = [
            "type": "audio",
            "timestamp": time,
            "progress": progress
        ]
        if let posData = try? JSONSerialization.data(withJSONObject: posDict),
           let posStr = String(data: posData, encoding: .utf8) {
            dbBook.lastPosition = posStr
        } else {
            dbBook.lastPosition = String(time) // fallback
        }
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
            try AudioSessionManager.activate(for: .audiobook)
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
        lifecycleObserver = NotificationCenter.default.addObserver(
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
        interruptionObserver = NotificationCenter.default.addObserver(
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

    private func removeObservers() {
        if let observer = lifecycleObserver {
            NotificationCenter.default.removeObserver(observer)
            lifecycleObserver = nil
        }
        if let observer = interruptionObserver {
            NotificationCenter.default.removeObserver(observer)
            interruptionObserver = nil
        }
    }

    // MARK: - Timers

    private func startTimer() {
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self = self, let player = self.player else { return }
                let t = player.currentTime().seconds
                guard !t.isNaN && !t.isInfinite else { return }
                self.currentTime = t
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
                self?.updateListeningSession()
            }
        }
    }

    private func updateListeningSession() {
        guard let session = currentSession, let context = sessionContext else { return }

        session.endedAt = Date()
        session.audioPlaybackRate = playbackRate
        try? context.save()
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

    // MARK: - Listening Session Tracking

    private func startListeningSession() {
        guard let book = currentBook, let container = modelContainer else { return }
        guard currentSession == nil else { return }

        let context = ModelContext(container)
        let session = ReadingSession(
            bookId: book.id,
            format: "audiobook",
            audioPlaybackRate: playbackRate,
            audioStartTimestamp: currentTime
        )
        session.profileId = book.profileId

        context.insert(session)
        try? context.save()
        currentSession = session
        sessionContext = context
    }

    private func finalizeListeningSession() {
        guard let session = currentSession, let context = sessionContext else { return }

        session.endedAt = Date()
        session.audioPlaybackRate = playbackRate
        session.audioEndTimestamp = currentTime

        // Discard sessions shorter than 10 seconds
        if session.durationSeconds < 10 {
            context.delete(session)
        }

        try? context.save()
        currentSession = nil
        sessionContext = nil
    }

    private func stopPlayback() {
        if let observer = playerItemObserver {
            NotificationCenter.default.removeObserver(observer)
            playerItemObserver = nil
        }
        player?.pause()
        player = nil
        isPlaying = false
        currentTime = 0
        duration = 0
        stopTimer()
    }
}

