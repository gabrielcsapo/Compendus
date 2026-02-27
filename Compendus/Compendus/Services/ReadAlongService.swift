//
//  ReadAlongService.swift
//  Compendus
//
//  Orchestrates read-along mode: syncs audiobook playback with EPUB
//  text highlighting using live Whisper transcription (audiobook mode)
//  or on-device TTS generation via PocketTTS (TTS mode).
//

import Foundation
import UIKit
import SwiftData
import AVFoundation
import NaturalLanguage

import os.log

private let logger = Logger(subsystem: "com.compendus.reader", category: "ReadAlong")

@MainActor
@Observable
class ReadAlongService {

    enum ReadAlongState: Equatable {
        case inactive
        case loading       // Loading audiobook into player / generating TTS
        case buffering     // Waiting for initial transcript data
        case active        // Playing and aligning
        case paused        // User paused
        case error(String)
    }

    /// The audio source driving the read-along.
    enum AudioSource {
        case audiobook
        case tts
    }

    // MARK: - Public State

    var state: ReadAlongState = .inactive
    var audioSource: AudioSource?

    /// Range of the active sentence in the current chapter's attributed string.
    var activeSentenceRange: NSRange?

    /// The spine index (chapter) the read-along is currently highlighting.
    var activeSpineIndex: Int?

    /// Whether auto-advance is temporarily suppressed (user manually turned page).
    var autoAdvanceSuppressed = false

    var isActive: Bool {
        switch state {
        case .inactive, .error: return false
        default: return true
        }
    }

    /// Whether the current session is TTS mode.
    var isTTSMode: Bool { audioSource == .tts }

    // MARK: - TTS Public State

    /// Current playback time in TTS mode (seconds).
    var ttsCurrentTime: Double = 0

    /// Estimated total duration of current chapter TTS audio (seconds).
    var ttsDuration: Double = 0

    /// Whether TTS audio is currently playing.
    var ttsIsPlaying: Bool = false

    /// TTS playback speed.
    var ttsPlaybackRate: Float = 1.0

    // MARK: - References

    private weak var engine: NativeEPUBEngine?
    private weak var player: AudiobookPlayer?
    private weak var transcriptionService: OnDeviceTranscriptionService?

    // MARK: - TTS References

    private var pocketTTSContext: PocketTTSContext?
    @ObservationIgnored private var ttsVoiceIndex: UInt32 = 0

    // MARK: - Internal State

    private var ebook: DownloadedBook?
    private var audiobook: DownloadedBook?
    private var alignmentEngine = TextAlignmentEngine()
    private var alignmentCursor: Int = 0
    private var currentAudioChapterIndex: Int = -1
    private var chapterAlignmentMap: [Int: Int] = [:]  // audio chapter index -> spine index
    private var didInitiateAudioSession = false
    private var autoAdvanceSuppressTask: Task<Void, Never>?

    @ObservationIgnored private var updateTask: Task<Void, Never>?
    @ObservationIgnored private var lastProcessedTime: Double = -1
    @ObservationIgnored private var consecutiveAlignmentMisses: Int = 0
    @ObservationIgnored private var isSearchingChapter = false

    // MARK: - TTS Internal State

    /// Sentence spans for the current chapter being narrated.
    struct SentenceSpan {
        let text: String
        let plainTextRange: NSRange
        var audioStartTime: Double = 0  // cumulative start within chapter
        var audioEndTime: Double = 0    // cumulative end within chapter
    }

    @ObservationIgnored private var ttsAudioEngine: AVAudioEngine?
    @ObservationIgnored private var ttsPlayerNode: AVAudioPlayerNode?
    @ObservationIgnored private var ttsTimePitchNode: AVAudioUnitTimePitch?
    @ObservationIgnored private var ttsEngineFormat: AVAudioFormat?
    @ObservationIgnored private var ttsSentences: [SentenceSpan] = []
    @ObservationIgnored private var ttsCurrentSentenceIndex: Int = 0
    @ObservationIgnored private var ttsGenerationTask: Task<Void, Never>?
    @ObservationIgnored private var ttsPlaybackStartHostTime: UInt64 = 0
    @ObservationIgnored private var ttsPlaybackStartSampleTime: Double = 0
    @ObservationIgnored private var ttsTotalSamplesScheduled: Int = 0
    @ObservationIgnored private var ttsCurrentSpineIndex: Int = 0
    @ObservationIgnored private var ttsBuffersQueued: Int = 0
    @ObservationIgnored private var ttsStartSentenceIndex: Int = 0
    /// Queue of sentence indices in playback order — each scheduled buffer appends its index.
    /// Buffer completion pops the front, and the new front is the currently playing sentence.
    @ObservationIgnored private var ttsSentencePlaybackQueue: [Int] = []
    private let ttsMaxBuffersAhead = 3
    @ObservationIgnored private var ttsBackgrounded = false
    @ObservationIgnored private var backgroundObservers: [Any] = []

    // MARK: - Book Matching

    /// Find a downloaded audiobook that matches the given ebook by title and authors.
    func findMatchingAudiobook(for ebook: DownloadedBook, in context: ModelContext) -> DownloadedBook? {
        let descriptor = FetchDescriptor<DownloadedBook>()
        guard let allBooks = try? context.fetch(descriptor) else { return nil }

        let normalizedTitle = normalizeTitle(ebook.title)
        let ebookAuthors = Set(ebook.authors.map { $0.lowercased().trimmingCharacters(in: .whitespaces) })

        for book in allBooks {
            guard book.isAudiobook else { continue }
            guard book.id != ebook.id else { continue }

            let bookTitle = normalizeTitle(book.title)
            guard bookTitle == normalizedTitle else { continue }

            // Check for at least one overlapping author
            let bookAuthors = Set(book.authors.map { $0.lowercased().trimmingCharacters(in: .whitespaces) })
            if !ebookAuthors.isEmpty && !bookAuthors.isEmpty {
                guard !ebookAuthors.isDisjoint(with: bookAuthors) else { continue }
            }

            return book
        }
        return nil
    }

    // MARK: - Session Lifecycle

    func activate(
        ebook: DownloadedBook,
        audiobook: DownloadedBook,
        engine: NativeEPUBEngine,
        player: AudiobookPlayer,
        transcriptionService: OnDeviceTranscriptionService
    ) {
        logger.info("Activating read-along (audiobook mode): '\(ebook.title)' with '\(audiobook.title)'")
        self.audioSource = .audiobook

        self.ebook = ebook
        self.audiobook = audiobook
        self.engine = engine
        self.player = player
        self.transcriptionService = transcriptionService

        state = .loading
        alignmentCursor = 0
        activeSentenceRange = nil
        activeSpineIndex = engine.activeSpineIndex
        alignmentEngine.reset()

        // Build chapter alignment map
        buildChapterAlignmentMap(audiobook: audiobook, engine: engine)

        // Load audiobook into player, then start read-along
        Task {
            if player.currentBook?.id != audiobook.id {
                didInitiateAudioSession = true
                logger.info("Loading audiobook into player...")
                await player.loadBook(audiobook)
                logger.info("Audiobook loaded, duration=\(player.duration)s, currentTime=\(player.currentTime)s")
            } else {
                logger.info("Audiobook already loaded, currentTime=\(player.currentTime)s")
            }

            // Navigate EPUB to match the current audio chapter position
            await self.syncEPUBToAudioPosition(engine: engine, player: player, audiobook: audiobook)

            // Use pre-existing transcript if available (much better — no buffering delay)
            if let savedTranscript = audiobook.transcript {
                logger.info("Using saved transcript: \(savedTranscript.segments.count) segments, duration=\(savedTranscript.duration)s")
                transcriptionService.partialTranscript = savedTranscript
            } else {
                // Fall back to live transcription
                guard let fileURL = audiobook.fileURL else {
                    state = .error("Audiobook file not found")
                    logger.error("Audiobook file URL missing")
                    return
                }

                let audioDuration = audiobook.duration.map(Double.init) ?? player.duration
                guard audioDuration > 0 else {
                    state = .error("Could not determine audiobook duration")
                    logger.error("Audiobook duration is 0 (model=\(String(describing: audiobook.duration)), player=\(player.duration))")
                    return
                }

                let startTime = player.currentTime
                logger.info("Starting live transcription from time=\(startTime)s, duration=\(audioDuration)s")

                transcriptionService.transcribe(
                    fileURL: fileURL,
                    duration: audioDuration,
                    bookId: audiobook.id,
                    title: audiobook.title,
                    coverData: audiobook.coverData,
                    startFromTime: startTime
                )
            }

            // Start playback immediately
            state = .active
            player.play()
            logger.info("Playback started, beginning update loop")

            // Start the update loop
            startUpdateLoop()
        }

        // Listen for spine index changes (user manually navigating chapters)
        engine.onSpineIndexChanged = { [weak self] newIndex in
            guard let self = self, self.isActive else { return }
            self.handleUserChapterChange(newIndex)
        }
    }

    func deactivate() {
        logger.info("Deactivating read-along (mode: \(String(describing: self.audioSource)))")

        updateTask?.cancel()
        updateTask = nil
        autoAdvanceSuppressTask?.cancel()
        autoAdvanceSuppressTask = nil

        // TTS cleanup
        if audioSource == .tts {
            ttsGenerationTask?.cancel()
            ttsGenerationTask = nil
            ttsPlayerNode?.stop()
            ttsAudioEngine?.stop()
            ttsPlayerNode = nil
            ttsTimePitchNode = nil
            ttsEngineFormat = nil
            ttsAudioEngine = nil
            ttsSentences = []
            ttsCurrentSentenceIndex = 0
            ttsCurrentTime = 0
            ttsDuration = 0
            ttsIsPlaying = false
            ttsTotalSamplesScheduled = 0
            ttsBuffersQueued = 0
            ttsPlaybackStartHostTime = 0
            ttsPlaybackStartSampleTime = 0
            pocketTTSContext = nil
            ttsBackgrounded = false
            for observer in backgroundObservers {
                NotificationCenter.default.removeObserver(observer)
            }
            backgroundObservers = []
            deactivateAudioSession()
        }

        // Stop audio if we initiated the session
        if didInitiateAudioSession {
            player?.pause()
        }

        // Cancel transcription if active for read-along
        if transcriptionService?.isActive == true {
            transcriptionService?.cancel()
        }

        // Clear highlight
        activeSentenceRange = nil
        engine?.readAlongHighlightRange = nil

        state = .inactive
        audioSource = nil
        ebook = nil
        audiobook = nil
        engine = nil
        player = nil
        transcriptionService = nil
        didInitiateAudioSession = false
        lastProcessedTime = -1
    }

    func togglePlayPause() {
        if audioSource == .tts {
            toggleTTSPlayPause()
            return
        }

        guard let player = player else { return }
        if player.isPlaying {
            player.pause()
            state = .paused
        } else {
            player.play()
            if state == .paused || state == .buffering {
                state = .active
            }
        }
    }

    /// Call when the user manually turns a page to suppress auto-advance temporarily.
    func suppressAutoAdvance() {
        autoAdvanceSuppressed = true
        autoAdvanceSuppressTask?.cancel()
        autoAdvanceSuppressTask = Task {
            try? await Task.sleep(for: .seconds(10))
            guard !Task.isCancelled else { return }
            autoAdvanceSuppressed = false
        }
    }

    /// Re-sync the EPUB to the current audio position.
    func resync() {
        autoAdvanceSuppressed = false
        autoAdvanceSuppressTask?.cancel()
        handleTimeUpdate(player?.currentTime ?? 0)
    }

    // MARK: - Update Loop

    private func startUpdateLoop() {
        updateTask?.cancel()
        updateTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(150))
                guard !Task.isCancelled else { break }
                guard let self = self, let player = self.player else { break }

                let currentTime = player.currentTime
                // Only process if time actually changed
                guard abs(currentTime - self.lastProcessedTime) > 0.05 else { continue }
                self.lastProcessedTime = currentTime

                self.handleTimeUpdate(currentTime)
            }
        }
    }

    @ObservationIgnored private var logThrottle: Int = 0

    private func handleTimeUpdate(_ currentTime: Double) {
        guard let engine = engine,
              let transcriptionService = transcriptionService else {
            logger.warning("handleTimeUpdate: engine or transcriptionService is nil")
            return
        }

        let shouldLog = logThrottle % 20 == 0  // Log every ~3s (20 * 150ms)
        logThrottle += 1

        // Check transcript availability
        let lastTranscribedTime = transcriptionService.lastTranscribedTime ?? 0
        let hasTranscript = transcriptionService.partialTranscript != nil

        if shouldLog {
            logger.info("Update: state=\(String(describing: self.state)), time=\(String(format: "%.1f", currentTime))s, transcribed=\(String(format: "%.1f", lastTranscribedTime))s, hasTranscript=\(hasTranscript)")
        }

        // Handle buffering state — resume when we have some transcript ahead
        if state == .buffering {
            if lastTranscribedTime > currentTime + 5 {
                state = .active
                player?.play()
                logger.info("Buffer ready, resuming playback at \(String(format: "%.1f", currentTime))s (transcript at \(String(format: "%.1f", lastTranscribedTime))s)")
            }
            return
        }

        // If playback is catching up to transcript, pause temporarily
        // Only check when we actually have transcript data and are very close
        if lastTranscribedTime > 0 && currentTime > lastTranscribedTime - 2 {
            if state == .active {
                player?.pause()
                state = .buffering
                logger.info("Buffer depleted, pausing at \(String(format: "%.1f", currentTime))s, transcript at \(String(format: "%.1f", lastTranscribedTime))s")
            }
            return
        }

        guard state == .active || state == .paused else { return }

        // Detect audio chapter changes
        if let player = player, let chapter = player.currentChapter {
            let chapterIndex = audiobook?.chapters?.firstIndex(where: { $0.title == chapter.title }) ?? -1
            if chapterIndex != currentAudioChapterIndex && chapterIndex >= 0 {
                handleAudioChapterChange(chapterIndex)
            }
        }

        // Skip alignment if no transcript data yet — audio keeps playing,
        // alignment will start once Whisper produces its first chunk
        guard let transcript = transcriptionService.partialTranscript else {
            if shouldLog {
                logger.info("No transcript data yet, waiting for first Whisper chunk...")
            }
            return
        }

        let words = transcriptWordsAround(time: currentTime, in: transcript)
        if words.isEmpty {
            if shouldLog {
                logger.info("No transcript words around time=\(String(format: "%.1f", currentTime))s")
            }
            return
        }

        // Get chapter text and map
        let plainText = engine.currentChapterPlainText
        let plainTextMap = engine.currentChapterPlainTextMap

        // Try alignment if we have chapter text
        var aligned = false
        if let plainText = plainText, plainText.count > 10,
           let plainTextMap = plainTextMap {

            if shouldLog {
                logger.info("Aligning: \(words.count) words, cursor=\(self.alignmentCursor), textLen=\(plainText.count), mapEntries=\(plainTextMap.entries.count)")
            }

            if let result = alignmentEngine.align(
                transcriptWords: words,
                currentTime: currentTime,
                chapterPlainText: plainText,
                cursorPosition: alignmentCursor,
                plainTextToAttrStringMap: plainTextMap
            ) {
                alignmentCursor = result.lastMatchedCursorPosition
                let newRange = result.sentenceRange
                consecutiveAlignmentMisses = 0
                aligned = true

                if shouldLog {
                    logger.info("Alignment hit: confidence=\(String(format: "%.2f", result.matchConfidence)), range=\(newRange.location)...\(newRange.location + newRange.length), cursor=\(self.alignmentCursor)")
                }

                // Only update if sentence actually changed
                if newRange != activeSentenceRange {
                    activeSentenceRange = newRange
                    activeSpineIndex = engine.activeSpineIndex
                    engine.readAlongHighlightRange = newRange

                    // Auto-advance page if needed
                    if !autoAdvanceSuppressed {
                        engine.showPage(containingRange: newRange)
                    }
                }
            }
        }

        if !aligned {
            consecutiveAlignmentMisses += 1

            // Clear highlight on miss
            if activeSentenceRange != nil {
                activeSentenceRange = nil
                engine.readAlongHighlightRange = nil
            }

            // After 3+ misses, search across all chapters using transcript words
            if consecutiveAlignmentMisses >= 3 && !isSearchingChapter {
                let phrase = buildSearchPhrase(from: words, around: currentTime)
                if !phrase.isEmpty {
                    logger.info("Alignment miss x\(self.consecutiveAlignmentMisses), searching all chapters for: '\(phrase.prefix(60))'")
                    isSearchingChapter = true
                    Task {
                        await searchAndNavigateToChapter(phrase: phrase, engine: engine)
                        isSearchingChapter = false
                    }
                }
            } else if shouldLog {
                logger.info("Alignment miss at time=\(String(format: "%.1f", currentTime))s, cursor=\(self.alignmentCursor), misses=\(self.consecutiveAlignmentMisses)")
            }
        }
    }

    // MARK: - Chapter Handling

    private func buildChapterAlignmentMap(audiobook: DownloadedBook, engine: NativeEPUBEngine) {
        guard let chapters = audiobook.chapters, !chapters.isEmpty else {
            logger.info("No audiobook chapters to map")
            return
        }
        let tocEntries = engine.tocEntries
        logger.info("Building chapter map: \(chapters.count) audio chapters, \(tocEntries.count) TOC entries, \(engine.spineCount) spine items")

        if !chapters.isEmpty {
            logger.info("Audio chapters: \(chapters.prefix(5).map { $0.title }.joined(separator: ", "))\(chapters.count > 5 ? "..." : "")")
        }
        if !tocEntries.isEmpty {
            logger.info("TOC entries: \(tocEntries.prefix(5).map { $0.title }.joined(separator: ", "))\(tocEntries.count > 5 ? "..." : "")")
        }

        for (audioIndex, chapter) in chapters.enumerated() {
            let normalizedChapterTitle = chapter.title.lowercased()
                .trimmingCharacters(in: .whitespacesAndNewlines)

            var flatIndex = 0
            if let spineIndex = findMatchingSpineIndex(
                title: normalizedChapterTitle,
                in: tocEntries,
                engine: engine,
                flatIndex: &flatIndex
            ) {
                chapterAlignmentMap[audioIndex] = spineIndex
            }
        }

        logger.info("Built chapter alignment map: \(self.chapterAlignmentMap.count) mappings from \(chapters.count) audio chapters")
    }

    /// Navigate the EPUB to the chapter that matches the current audio position.
    /// Called once during activation when resuming from a non-zero position.
    private func syncEPUBToAudioPosition(engine: NativeEPUBEngine, player: AudiobookPlayer, audiobook: DownloadedBook) async {
        let currentTime = player.currentTime
        guard currentTime > 0 else {
            logger.info("syncEPUB: currentTime is 0, no sync needed")
            return
        }

        let chapters = audiobook.chapters ?? []
        logger.info("syncEPUB: currentTime=\(String(format: "%.1f", currentTime))s, \(chapters.count) audio chapters, \(self.chapterAlignmentMap.count) mappings")

        // Strategy 1: Use chapter alignment map if available
        if !chapters.isEmpty && !chapterAlignmentMap.isEmpty {
            // Find which audio chapter the current time falls in
            var audioChapterIndex: Int?
            for (index, chapter) in chapters.enumerated() {
                let chapterStart = chapter.startTime
                let nextStart: Double
                if index + 1 < chapters.count {
                    nextStart = chapters[index + 1].startTime
                } else {
                    nextStart = player.duration
                }

                if currentTime >= chapterStart && currentTime < nextStart {
                    audioChapterIndex = index
                    break
                }
            }

            if let chapterIdx = audioChapterIndex {
                currentAudioChapterIndex = chapterIdx
                logger.info("syncEPUB: audio chapter \(chapterIdx) ('\(chapters[chapterIdx].title)')")

                if let spineIndex = chapterAlignmentMap[chapterIdx] {
                    if spineIndex != engine.activeSpineIndex {
                        logger.info("syncEPUB: navigating EPUB from spine \(engine.activeSpineIndex) to \(spineIndex)")
                        let tocItems = await engine.tableOfContents()
                        if spineIndex < tocItems.count {
                            await engine.go(to: tocItems[spineIndex].location)
                            alignmentCursor = 0
                            alignmentEngine.reset()
                            logger.info("syncEPUB: navigation complete")
                            return
                        }
                    } else {
                        logger.info("syncEPUB: already on correct spine \(spineIndex)")
                        return
                    }
                } else {
                    logger.info("syncEPUB: no EPUB mapping for audio chapter \(chapterIdx)")
                }
            }
        }

        // Strategy 2: Estimate position from time ratio
        // Use overall progression through the audiobook to estimate EPUB spine position
        let progression = player.duration > 0 ? currentTime / player.duration : 0
        if progression > 0 {
            logger.info("syncEPUB: falling back to progression-based sync, progression=\(String(format: "%.3f", progression))")
            await engine.go(toProgression: progression)
            alignmentCursor = 0
            alignmentEngine.reset()
            logger.info("syncEPUB: progression-based navigation complete")
        }
    }

    private func findMatchingSpineIndex(title: String, in entries: [EPUBTOCEntry], engine: NativeEPUBEngine, flatIndex: inout Int) -> Int? {
        for entry in entries {
            let currentIndex = flatIndex
            flatIndex += 1

            let entryTitle = entry.title.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
            if entryTitle == title || entryTitle.contains(title) || title.contains(entryTitle) {
                // Use the flat index as an approximation of spine index
                return min(currentIndex, engine.spineCount - 1)
            }

            // Recurse into children
            if let found = findMatchingSpineIndex(title: title, in: entry.children, engine: engine, flatIndex: &flatIndex) {
                return found
            }
        }
        return nil
    }

    private func handleAudioChapterChange(_ newChapterIndex: Int) {
        currentAudioChapterIndex = newChapterIndex

        // Find the corresponding EPUB spine index
        guard let spineIndex = chapterAlignmentMap[newChapterIndex],
              let engine = engine else {
            logger.info("Audio chapter \(newChapterIndex) has no EPUB mapping, resetting alignment")
            alignmentCursor = 0
            alignmentEngine.reset()
            return
        }

        if spineIndex != engine.activeSpineIndex {
            logger.info("Audio chapter \(newChapterIndex) -> EPUB spine \(spineIndex)")
            // Navigate engine to the matching chapter, then reset alignment
            Task {
                let tocItems = await engine.tableOfContents()
                if spineIndex < tocItems.count {
                    await engine.go(to: tocItems[spineIndex].location)
                }
                // Reset alignment cursor AFTER navigation completes
                self.alignmentCursor = 0
                self.alignmentEngine.reset()
                logger.info("Chapter navigation complete, alignment reset")
            }
        } else {
            // Same spine index, just reset alignment
            alignmentCursor = 0
            alignmentEngine.reset()
        }
    }

    private func handleUserChapterChange(_ newSpineIndex: Int) {
        // User manually navigated to a different chapter
        // Suppress auto-advance briefly
        suppressAutoAdvance()
    }

    // MARK: - Transcript Helpers

    /// Get transcript words in a window around the given time.
    private func transcriptWordsAround(time: Double, in transcript: Transcript) -> [TranscriptWord] {
        var words: [TranscriptWord] = []
        let windowStart = max(0, time - 5)
        let windowEnd = time + 10

        for segment in transcript.segments {
            guard segment.end >= windowStart && segment.start <= windowEnd else { continue }
            for word in segment.words {
                if word.end >= windowStart && word.start <= windowEnd {
                    words.append(word)
                }
            }
        }

        return words
    }

    // MARK: - Cross-Chapter Search

    /// Build a search phrase from transcript words near the current time.
    private func buildSearchPhrase(from words: [TranscriptWord], around time: Double) -> String {
        // Get words closest to current time
        let nearWords = words
            .filter { $0.start >= time - 2 && $0.start <= time + 3 }
            .prefix(8)
            .map { $0.word.trimmingCharacters(in: .whitespacesAndNewlines)
                .filter { $0.isLetter || $0.isNumber || $0 == " " || $0 == "'" } }
            .filter { !$0.isEmpty }

        guard nearWords.count >= 3 else { return "" }
        return nearWords.joined(separator: " ")
    }

    /// Search all EPUB chapters for a phrase from the transcript and navigate there.
    private func searchAndNavigateToChapter(phrase: String, engine: NativeEPUBEngine) async {
        guard let spineIndex = engine.findSpineIndex(containingPhrase: phrase) else {
            logger.info("Cross-chapter search: no match for '\(phrase.prefix(40))'")
            return
        }

        if spineIndex != engine.activeSpineIndex {
            logger.info("Cross-chapter search: found in spine \(spineIndex), navigating from \(engine.activeSpineIndex)")
            engine.goToSpine(spineIndex)
            // Wait for chapter to load
            try? await Task.sleep(for: .milliseconds(300))
            alignmentCursor = 0
            alignmentEngine.reset()
            consecutiveAlignmentMisses = 0
            logger.info("Cross-chapter navigation complete")
        } else {
            // Same chapter — maybe cursor is wrong, reset it
            logger.info("Cross-chapter search: phrase found in current chapter, resetting cursor")
            alignmentCursor = 0
            alignmentEngine.reset()
            consecutiveAlignmentMisses = 0
        }
    }

    // MARK: - Title Normalization

    private func normalizeTitle(_ title: String) -> String {
        var normalized = title.lowercased()
            .trimmingCharacters(in: .whitespacesAndNewlines)

        // Strip leading "the "
        if normalized.hasPrefix("the ") {
            normalized = String(normalized.dropFirst(4))
        }

        // Remove subtitle after ":" or " - "
        if let colonRange = normalized.range(of: ":") {
            normalized = String(normalized[..<colonRange.lowerBound])
                .trimmingCharacters(in: .whitespaces)
        }
        if let dashRange = normalized.range(of: " - ") {
            normalized = String(normalized[..<dashRange.lowerBound])
                .trimmingCharacters(in: .whitespaces)
        }

        return normalized
    }

    // MARK: - TTS Mode Activation

    /// Activate TTS read-aloud mode for an EPUB with no matching audiobook.
    func activateWithTTS(
        ebook: DownloadedBook,
        engine: NativeEPUBEngine,
        ttsContext: PocketTTSContext,
        voiceIndex: UInt32
    ) {
        logger.info("Activating read-along (TTS mode): '\(ebook.title)' voice=\(voiceIndex)")

        self.audioSource = .tts
        self.ebook = ebook
        self.engine = engine
        self.pocketTTSContext = ttsContext
        self.ttsVoiceIndex = voiceIndex

        state = .loading
        activeSentenceRange = nil
        activeSpineIndex = engine.activeSpineIndex
        ttsCurrentTime = 0
        ttsDuration = 0
        ttsIsPlaying = false
        ttsTotalSamplesScheduled = 0
        ttsCurrentSpineIndex = engine.activeSpineIndex

        // Engine is already loaded with voice — just set up audio and start
        do {
            try setupTTSAudioEngine()
            startTTSForCurrentChapter()
        } catch {
            logger.error("TTS activation failed: \(error)")
            state = .error("TTS setup failed: \(error.localizedDescription)")
        }

        // Listen for spine index changes (user manually navigating)
        engine.onSpineIndexChanged = { [weak self] newIndex in
            guard let self = self, self.isActive, self.audioSource == .tts else { return }
            self.suppressAutoAdvance()
        }

        // Pause/resume TTS generation around backgrounding to avoid Metal GPU crash
        let nc = NotificationCenter.default
        backgroundObservers = [
            nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
                guard let self = self, self.audioSource == .tts else { return }
                self.ttsBackgrounded = true
                self.ttsGenerationTask?.cancel()
                self.ttsPlayerNode?.pause()
                self.ttsIsPlaying = false
                if self.state == .active { self.state = .paused }
                logger.info("TTS paused — app entered background")
            },
            nc.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
                guard let self = self, self.audioSource == .tts else { return }
                self.ttsBackgrounded = false
                logger.info("TTS resumed — app entering foreground")
                // Restart generation from current sentence
                self.restartTTSFromSentence(self.ttsCurrentSentenceIndex)
            }
        ]
    }

    // MARK: - TTS Audio Engine Setup

    private func setupTTSAudioEngine() throws {
        // Playback category for TTS audio
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .default)
        try session.setActive(true)

        let audioEngine = AVAudioEngine()
        let playerNode = AVAudioPlayerNode()

        audioEngine.attach(playerNode)

        // PocketTTS outputs 24kHz mono — no resampling needed.
        // The mainMixerNode handles upsampling to hardware rate internally.
        let engineFormat = AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1)!
        audioEngine.connect(playerNode, to: audioEngine.mainMixerNode, format: engineFormat)

        try audioEngine.start()

        self.ttsAudioEngine = audioEngine
        self.ttsPlayerNode = playerNode
        self.ttsTimePitchNode = nil
        self.ttsEngineFormat = engineFormat

        logger.info("TTS audio engine started (24kHz mono)")
    }

    private func deactivateAudioSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: - TTS Chapter Generation

    private func startTTSForCurrentChapter() {
        guard let engine = engine else { return }

        // Get chapter plain text — skip empty chapters (title pages, images, etc.)
        let rawText = engine.currentChapterPlainText ?? ""
        // Sentencize from the ORIGINAL text so plainTextRange values
        // correctly map to the PlainTextToAttrStringMap offsets.
        // TTS preprocessing (hyphen removal, etc.) is applied per-sentence
        // in the generation pipeline to avoid offset drift.
        let sentences = rawText.isEmpty ? [] : sentencize(rawText)

        if sentences.isEmpty {
            logger.info("Empty chapter at spine \(engine.activeSpineIndex), auto-advancing")
            handleTTSChapterComplete()
            return
        }

        ttsSentences = sentences
        ttsTotalSamplesScheduled = 0
        ttsBuffersQueued = 0
        ttsSentencePlaybackQueue = []
        ttsCurrentTime = 0
        ttsCurrentSpineIndex = engine.activeSpineIndex

        // Find the first sentence on or after the current page so TTS
        // starts from where the user is reading, not from page 1.
        let pageOffset = engine.currentPagePlainTextOffset ?? 0
        let startIndex = sentences.firstIndex {
            $0.plainTextRange.location + $0.plainTextRange.length > pageOffset
        } ?? 0
        ttsCurrentSentenceIndex = startIndex
        ttsStartSentenceIndex = startIndex
        logger.info("TTS starting from sentence \(startIndex) (page plain text offset \(pageOffset))")

        logger.info("Chapter has \(self.ttsSentences.count) sentences, \(rawText.count) characters at spine \(engine.activeSpineIndex)")
        // Log first few sentences for debugging text extraction
        for (idx, s) in sentences.prefix(5).enumerated() {
            logger.info("  Sentence[\(idx)]: \"\(s.text.prefix(120))\"")
        }

        // Start generation pipeline from the current page's sentence
        ttsGenerationTask?.cancel()
        ttsGenerationTask = Task { [weak self] in
            await self?.ttsGenerationPipeline(startingFrom: startIndex)
        }
    }

    /// Create a PCM buffer from raw audio samples (24kHz mono).
    /// Normalizes audio to a peak of 0.8 if any sample exceeds [-1, 1]
    /// to prevent iOS clipping.
    private func makeEngineBuffer(from samples: [Float], engineFormat: AVAudioFormat) -> AVAudioPCMBuffer? {
        guard !samples.isEmpty else { return nil }
        guard let buffer = AVAudioPCMBuffer(pcmFormat: engineFormat, frameCapacity: AVAudioFrameCount(samples.count)) else {
            return nil
        }
        buffer.frameLength = buffer.frameCapacity

        // Find peak absolute value
        var peak: Float = 0
        for sample in samples {
            let absVal = abs(sample)
            if absVal > peak { peak = absVal }
        }

        let channelData = buffer.floatChannelData![0]

        if peak > 1.0 {
            // Scale down so peak maps to 0.8 (leaving headroom)
            let scale: Float = 0.8 / peak
            for i in 0..<samples.count {
                channelData[i] = samples[i] * scale
            }
        } else {
            // Already in range — copy directly
            samples.withUnsafeBufferPointer { srcPtr in
                let byteCount = srcPtr.count * MemoryLayout<Float>.stride
                UnsafeMutableRawPointer(channelData)
                    .copyMemory(from: UnsafeRawPointer(srcPtr.baseAddress!), byteCount: byteCount)
            }
        }

        return buffer
    }

    /// Producer pipeline: generates audio sentence by sentence, schedules onto player.
    /// Uses a sliding window to limit memory — only keeps up to ttsMaxBuffersAhead
    /// buffers queued on the player at any time.
    private func ttsGenerationPipeline(startingFrom startIndex: Int = 0) async {
        guard let pocketTTSContext = pocketTTSContext,
              let playerNode = ttsPlayerNode,
              let engineFormat = ttsEngineFormat else {
            logger.error("TTS pipeline guard failed — context=\(self.pocketTTSContext != nil), player=\(self.ttsPlayerNode != nil), format=\(self.ttsEngineFormat != nil)")
            state = .error("TTS engine not ready")
            return
        }

        logger.info("TTS generation pipeline started for \(self.ttsSentences.count) sentences (from index \(startIndex))")

        ttsBuffersQueued = 0
        await MainActor.run { self.ttsSentencePlaybackQueue = [] }
        var cumulativeTime: Double = 0
        var successCount = 0

        for i in startIndex..<ttsSentences.count {
            guard !Task.isCancelled else { return }

            // Throttle: wait if too many buffers are queued ahead
            while ttsBuffersQueued >= ttsMaxBuffersAhead && !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(200))
            }
            guard !Task.isCancelled else { return }

            let sentence = ttsSentences[i]
            let rawSentenceText = sentence.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !rawSentenceText.isEmpty else { continue }

            // Preprocess for better TTS pronunciation (doesn't affect highlighting ranges)
            let sentenceText = preprocessTextForTTS(rawSentenceText)

            do {
                logger.info("Generating chunk[\(i)]: \"\(sentenceText.prefix(80))\"")

                let result = try await pocketTTSContext.generateAudio(
                    text: sentenceText,
                    speed: 1.0
                )
                let generatedSamples = result.audioSamples

                guard !Task.isCancelled else { return }

                let sampleCount = generatedSamples.count
                guard sampleCount > 0 else { continue }

                let audioDuration = Double(sampleCount) / 24000.0

                // Update sentence timing
                await MainActor.run {
                    self.ttsSentences[i].audioStartTime = cumulativeTime
                    self.ttsSentences[i].audioEndTime = cumulativeTime + audioDuration
                    self.ttsDuration = cumulativeTime + audioDuration
                }

                cumulativeTime += audioDuration

                guard let buffer = makeEngineBuffer(from: generatedSamples, engineFormat: engineFormat) else { continue }

                successCount += 1

                // Schedule buffer; completion callback advances sentence tracking.
                await MainActor.run {
                    self.ttsBuffersQueued += 1
                    self.ttsSentencePlaybackQueue.append(i)
                    let options: AVAudioPlayerNodeBufferOptions = successCount == 1 ? .interrupts : []
                    playerNode.scheduleBuffer(buffer, at: nil, options: options) { [weak self] in
                        Task { @MainActor in
                            self?.ttsBuffersQueued -= 1
                            self?.handleSentenceBufferCompleted()
                        }
                    }
                    self.ttsTotalSamplesScheduled += sampleCount

                    // Start playback once first chunk is ready
                    if self.state == .loading {
                        playerNode.play()
                        self.ttsIsPlaying = true
                        self.state = .active
                        self.startTTSUpdateLoop()
                        self.highlightFirstSentence()
                        logger.info("TTS playback started (first audio ready at chunk \(i))")
                    }
                }

            } catch {
                logger.error("TTS generation failed for chunk \(i): \(error)")
            }
        }

        // If no sentences produced audio, report error
        if successCount == 0 && !Task.isCancelled {
            logger.error("TTS pipeline produced no audio for any sentence")
            state = .error("Failed to generate speech audio")
            return
        }

        // All sentences generated — schedule completion handler for chapter advance
        guard !Task.isCancelled else { return }

        let silenceBuffer = AVAudioPCMBuffer(pcmFormat: engineFormat, frameCapacity: 1)!
        silenceBuffer.frameLength = 1
        silenceBuffer.floatChannelData![0][0] = 0

        await playerNode.scheduleBuffer(silenceBuffer)

        logger.info("All \(self.ttsSentences.count) sentences queued, total duration=\(String(format: "%.1f", cumulativeTime))s")

        // Wait for playback to finish, then advance chapter
        await MainActor.run { [weak self] in
            self?.handleTTSChapterComplete()
        }
    }

    // MARK: - TTS Update Loop

    private func startTTSUpdateLoop() {
        updateTask?.cancel()
        updateTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(100))
                guard !Task.isCancelled else { break }
                guard let self = self else { break }
                self.handleTTSTimeUpdate()
            }
        }
    }

    @ObservationIgnored private var ttsUpdateLogThrottle: Int = 0

    private func handleTTSTimeUpdate() {
        guard let playerNode = ttsPlayerNode,
              state == .active else { return }

        // Track playback time for progress bar / scrubber
        guard let nodeTime = playerNode.lastRenderTime,
              let playerTime = playerNode.playerTime(forNodeTime: nodeTime) else { return }

        let currentTime = Double(playerTime.sampleTime) / playerTime.sampleRate
        guard currentTime >= 0 else { return }

        ttsCurrentTime = currentTime
    }

    /// Called when a buffer finishes playing. Advances to the next sentence
    /// in the playback queue and updates highlighting + page position.
    private func handleSentenceBufferCompleted() {
        guard let engine = engine else { return }

        // Pop the completed sentence from the queue
        if !ttsSentencePlaybackQueue.isEmpty {
            ttsSentencePlaybackQueue.removeFirst()
        }

        // The front of the queue is now the actively playing sentence
        guard let currentIdx = ttsSentencePlaybackQueue.first else { return }
        guard currentIdx < ttsSentences.count else { return }

        ttsCurrentSentenceIndex = currentIdx
        let sentence = ttsSentences[currentIdx]

        // Map to attributed string range for highlighting
        guard let plainTextMap = engine.currentChapterPlainTextMap,
              let attrRange = plainTextMap.attrStringRange(for: sentence.plainTextRange) else {
            logger.warning("TTS chunk done: failed to map sentence[\(currentIdx)] plainTextRange \(sentence.plainTextRange)")
            return
        }

        activeSentenceRange = attrRange
        activeSpineIndex = engine.activeSpineIndex
        engine.readAlongHighlightRange = attrRange
        logger.info("TTS playing sentence[\(currentIdx)]: \"\(sentence.text.prefix(60))\" attrRange=\(attrRange)")

        // Auto-advance page if needed
        if !autoAdvanceSuppressed {
            engine.showPage(containingRange: attrRange)
        }
    }

    /// Highlight the first sentence when TTS playback begins.
    private func highlightFirstSentence() {
        guard let engine = engine,
              let currentIdx = ttsSentencePlaybackQueue.first,
              currentIdx < ttsSentences.count else { return }

        ttsCurrentSentenceIndex = currentIdx
        let sentence = ttsSentences[currentIdx]

        guard let plainTextMap = engine.currentChapterPlainTextMap,
              let attrRange = plainTextMap.attrStringRange(for: sentence.plainTextRange) else { return }

        activeSentenceRange = attrRange
        activeSpineIndex = engine.activeSpineIndex
        engine.readAlongHighlightRange = attrRange
        logger.info("TTS first sentence[\(currentIdx)]: \"\(sentence.text.prefix(60))\" attrRange=\(attrRange)")

        if !autoAdvanceSuppressed {
            engine.showPage(containingRange: attrRange)
        }
    }

    // MARK: - TTS Playback Controls

    private func toggleTTSPlayPause() {
        guard let playerNode = ttsPlayerNode else { return }

        if ttsIsPlaying {
            playerNode.pause()
            ttsIsPlaying = false
            state = .paused
        } else {
            playerNode.play()
            ttsIsPlaying = true
            if state == .paused {
                state = .active
            }
        }
    }

    func ttsSkipForward() {
        // Skip to next sentence
        guard ttsCurrentSentenceIndex + 1 < ttsSentences.count else { return }
        ttsCurrentSentenceIndex += 1
        // Can't easily seek in AVAudioPlayerNode with queued buffers,
        // so we restart generation from the next sentence
        restartTTSFromSentence(ttsCurrentSentenceIndex)
    }

    func ttsSkipBackward() {
        // Skip to previous sentence (or restart current)
        let targetIndex = max(0, ttsCurrentSentenceIndex - 1)
        restartTTSFromSentence(targetIndex)
    }

    func setTTSPlaybackRate(_ rate: Float) {
        ttsPlaybackRate = rate
        ttsTimePitchNode?.rate = rate
    }

    private func restartTTSFromSentence(_ index: Int) {
        guard let playerNode = ttsPlayerNode,
              let engineFormat = ttsEngineFormat else { return }

        ttsStartSentenceIndex = index
        ttsGenerationTask?.cancel()
        playerNode.stop()
        ttsTotalSamplesScheduled = 0
        ttsBuffersQueued = 0
        ttsSentencePlaybackQueue = []
        ttsCurrentSentenceIndex = index

        // Restart generation from this sentence
        ttsGenerationTask = Task { [weak self] in
            guard let self = self else { return }

            guard let pocketTTSContext = self.pocketTTSContext else { return }

            var cumulativeTime = self.ttsSentences[index].audioStartTime

            for i in index..<self.ttsSentences.count {
                guard !Task.isCancelled else { return }

                // Throttle: wait if too many buffers are queued ahead
                while self.ttsBuffersQueued >= self.ttsMaxBuffersAhead && !Task.isCancelled {
                    try? await Task.sleep(for: .milliseconds(200))
                }
                guard !Task.isCancelled else { return }

                let sentence = self.ttsSentences[i]
                let rawSentenceText = sentence.text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !rawSentenceText.isEmpty else { continue }

                // Preprocess for better TTS pronunciation (doesn't affect highlighting ranges)
                let sentenceText = self.preprocessTextForTTS(rawSentenceText)

                do {
                    let result = try await pocketTTSContext.generateAudio(
                        text: sentenceText,
                        speed: 1.0
                    )
                    let generatedSamples = result.audioSamples

                    guard !Task.isCancelled else { return }

                    let sampleCount = generatedSamples.count
                    guard sampleCount > 0 else { continue }

                    let audioDuration = Double(sampleCount) / 24000.0

                    await MainActor.run {
                        self.ttsSentences[i].audioStartTime = cumulativeTime
                        self.ttsSentences[i].audioEndTime = cumulativeTime + audioDuration
                        self.ttsDuration = cumulativeTime + audioDuration
                    }

                    cumulativeTime += audioDuration

                    guard let buffer = self.makeEngineBuffer(from: generatedSamples, engineFormat: engineFormat) else { continue }

                    await MainActor.run {
                        self.ttsBuffersQueued += 1
                        self.ttsSentencePlaybackQueue.append(i)
                        let options: AVAudioPlayerNodeBufferOptions = i == index ? .interrupts : []
                        playerNode.scheduleBuffer(buffer, at: nil, options: options) { [weak self] in
                            Task { @MainActor in
                                self?.ttsBuffersQueued -= 1
                                self?.handleSentenceBufferCompleted()
                            }
                        }
                        self.ttsTotalSamplesScheduled += sampleCount

                        if i == index {
                            playerNode.play()
                            self.ttsIsPlaying = true
                            self.state = .active
                            self.highlightFirstSentence()
                        }
                    }
                } catch {
                    logger.error("TTS generation failed for chunk \(i): \(error)")
                }
            }

            // End-of-chapter completion
            guard !Task.isCancelled else { return }
            let silenceBuffer = AVAudioPCMBuffer(pcmFormat: engineFormat, frameCapacity: 1)!
            silenceBuffer.frameLength = 1
            silenceBuffer.floatChannelData![0][0] = 0
            await playerNode.scheduleBuffer(silenceBuffer)

            await MainActor.run { [weak self] in
                self?.handleTTSChapterComplete()
            }
        }
    }

    // MARK: - TTS Chapter Advance

    private func handleTTSChapterComplete() {
        guard audioSource == .tts, let engine = engine else { return }

        let nextSpine = ttsCurrentSpineIndex + 1
        guard nextSpine < engine.spineCount else {
            logger.info("TTS: reached end of book")
            state = .paused
            ttsIsPlaying = false
            return
        }

        logger.info("TTS: chapter complete, advancing to spine \(nextSpine)")
        ttsCurrentSpineIndex = nextSpine
        engine.goToSpine(nextSpine)

        // Wait for chapter to load, then start narrating
        Task {
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            startTTSForCurrentChapter()
        }
    }

    // MARK: - Sentence Splitting

    /// Maximum characters per TTS chunk. PocketTTS handles longer sequences but
    /// we still chunk for sentence-level highlighting and streaming playback.
    private let ttsMaxCharsPerChunk = 500

    /// Split chapter text into sentence spans (one sentence per chunk).
    /// Chunking enables sentence-level highlighting and streaming playback.
    private func sentencize(_ text: String) -> [SentenceSpan] {
        let tokenizer = NLTokenizer(unit: .sentence)
        tokenizer.string = text
        let nsText = text as NSString

        var spans: [SentenceSpan] = []
        tokenizer.enumerateTokens(in: text.startIndex..<text.endIndex) { range, _ in
            let nsRange = NSRange(range, in: text)
            let sentenceText = nsText.substring(with: nsRange)
            let trimmed = sentenceText.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                if trimmed.count > ttsMaxCharsPerChunk {
                    spans.append(contentsOf: splitLongSentence(trimmed, baseRange: nsRange))
                } else {
                    spans.append(SentenceSpan(text: trimmed, plainTextRange: nsRange))
                }
            }
            return true
        }

        return spans
    }

    /// Split a long sentence at clause boundaries to keep each chunk under ttsMaxCharsPerChunk.
    /// Tries semicolons first, then commas/colons, then conjunctions, then mid-point whitespace.
    private func splitLongSentence(_ text: String, baseRange: NSRange) -> [SentenceSpan] {
        guard text.count > ttsMaxCharsPerChunk else {
            return [SentenceSpan(text: text, plainTextRange: baseRange)]
        }

        let clausePatterns = [
            "(?<=;)\\s+",
            "(?<=,)\\s+",
            "(?<=:)\\s+",
            "\\s+(?=\\b(?:and|but|or|yet|so|which|that|because|although|while|when|where|if)\\b)"
        ]

        for pattern in clausePatterns {
            let parts = splitByPattern(text, pattern: pattern)
            if parts.count > 1 {
                let recombined = recombineParts(parts, maxLength: ttsMaxCharsPerChunk)
                var spans: [SentenceSpan] = []
                var offset = 0
                for chunk in recombined {
                    let nsRange = NSRange(location: baseRange.location + offset, length: chunk.count)
                    if chunk.count > ttsMaxCharsPerChunk {
                        spans.append(contentsOf: splitLongSentence(chunk, baseRange: nsRange))
                    } else {
                        spans.append(SentenceSpan(text: chunk, plainTextRange: nsRange))
                    }
                    offset += chunk.count
                }
                return spans
            }
        }

        // Last resort: split at nearest whitespace to midpoint
        let mid = text.index(text.startIndex, offsetBy: text.count / 2)
        if let spaceRange = text.rangeOfCharacter(from: .whitespaces, range: mid..<text.endIndex)
            ?? text.rangeOfCharacter(from: .whitespaces, options: .backwards, range: text.startIndex..<mid) {
            let first = String(text[text.startIndex..<spaceRange.lowerBound]).trimmingCharacters(in: .whitespaces)
            let second = String(text[spaceRange.upperBound...]).trimmingCharacters(in: .whitespaces)
            var result: [SentenceSpan] = []
            if !first.isEmpty {
                let r = NSRange(location: baseRange.location, length: first.count)
                result.append(contentsOf: splitLongSentence(first, baseRange: r))
            }
            if !second.isEmpty {
                let r = NSRange(location: baseRange.location + text.count - second.count, length: second.count)
                result.append(contentsOf: splitLongSentence(second, baseRange: r))
            }
            return result
        }

        return [SentenceSpan(text: text, plainTextRange: baseRange)]
    }

    private func splitByPattern(_ text: String, pattern: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [text] }
        let range = NSRange(text.startIndex..., in: text)
        var parts: [String] = []
        var lastEnd = text.startIndex
        regex.enumerateMatches(in: text, range: range) { match, _, _ in
            if let match = match, let matchRange = Range(match.range, in: text) {
                let part = String(text[lastEnd..<matchRange.lowerBound]).trimmingCharacters(in: .whitespaces)
                if !part.isEmpty { parts.append(part) }
                lastEnd = matchRange.upperBound
            }
        }
        let remaining = String(text[lastEnd...]).trimmingCharacters(in: .whitespaces)
        if !remaining.isEmpty { parts.append(remaining) }
        return parts
    }

    private func recombineParts(_ parts: [String], maxLength: Int) -> [String] {
        var chunks: [String] = []
        var current = ""
        for part in parts {
            let combined = current.isEmpty ? part : current + " " + part
            if combined.count > maxLength && !current.isEmpty {
                chunks.append(current)
                current = part
            } else {
                current = combined
            }
        }
        if !current.isEmpty { chunks.append(current) }
        return chunks
    }

    // MARK: - Text Preprocessing

    /// Preprocess text for better TTS output.
    private func preprocessTextForTTS(_ text: String) -> String {
        var result = text
        result = removeHyphensFromCompoundWords(result)
        result = convertParentheticalsToDashes(result)
        result = convertSlashesToDashes(result)
        return result
    }

    /// "time-delayed" → "time delayed"
    private func removeHyphensFromCompoundWords(_ text: String) -> String {
        let pattern = "(?<=\\p{L})-(?=\\p{L})"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return text }
        let range = NSRange(text.startIndex..., in: text)
        return regex.stringByReplacingMatches(in: text, range: range, withTemplate: " ")
    }

    /// "(or not)" → "- or not -"
    private func convertParentheticalsToDashes(_ text: String) -> String {
        var result = text
        let pattern = "\\(([^)]+)\\)([.,;:!?]?)(?=(\\s+\\w|\\s*$))"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return text }
        let range = NSRange(result.startIndex..., in: result)
        let matches = regex.matches(in: result, range: range)
        for match in matches.reversed() {
            guard let contentRange = Range(match.range(at: 1), in: result),
                  let fullRange = Range(match.range, in: result) else { continue }
            let content = String(result[contentRange])
            let punctuation = match.range(at: 2).length > 0
                ? String(result[Range(match.range(at: 2), in: result)!]) : ""
            let followedByMoreText = match.range(at: 3).length > 0 &&
                Range(match.range(at: 3), in: result).map { !result[$0].trimmingCharacters(in: .whitespaces).isEmpty } ?? false
            let replacement: String
            if punctuation.isEmpty && followedByMoreText {
                replacement = "- \(content) -"
            } else {
                replacement = "- \(content)\(punctuation)"
            }
            result.replaceSubrange(fullRange, with: replacement)
        }
        return result
    }

    /// "and/or" → "and - or"
    private func convertSlashesToDashes(_ text: String) -> String {
        let pattern = "(?<=\\p{L})/(?=\\p{L})"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return text }
        let range = NSRange(text.startIndex..., in: text)
        return regex.stringByReplacingMatches(in: text, range: range, withTemplate: " - ")
    }
}
