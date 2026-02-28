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
import MediaPlayer

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
    private var ttsAudioCache: TTSAudioCache?
    @ObservationIgnored private var ttsWordAligner: TTSWordAligner?
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
    typealias SentenceSpan = TextProcessingUtils.SentenceSpan

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
    /// Running RMS for consistent loudness across sentence buffers.
    @ObservationIgnored private var ttsRunningRMS: Float = 0
    @ObservationIgnored private var ttsRunningRMSCount: Int = 0
    /// Target RMS level for normalization (~-20 dBFS).
    private let ttsTargetRMS: Float = 0.1
    /// Crossfade duration in samples (10ms at 24kHz).
    private let ttsCrossfadeSamples: Int = 240
    /// Silence threshold for trimming.
    private let ttsSilenceThreshold: Float = 0.01
    /// Inter-sentence silence padding in samples (~150ms at 24kHz).
    private let ttsSilencePaddingSamples: Int = 3600
    /// Tail samples from the previous buffer for crossfading.
    @ObservationIgnored private var ttsPreviousBufferTail: [Float] = []
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
            ttsWordAligner = nil
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
        voiceIndex: UInt32,
        audioCache: TTSAudioCache? = nil,
        transcriptionService: OnDeviceTranscriptionService? = nil
    ) {
        logger.info("Activating read-along (TTS mode): '\(ebook.title)' voice=\(voiceIndex)")

        self.audioSource = .tts
        self.ebook = ebook
        self.engine = engine
        self.pocketTTSContext = ttsContext
        self.ttsVoiceIndex = voiceIndex
        self.ttsAudioCache = audioCache

        state = .loading
        activeSentenceRange = nil
        activeSpineIndex = engine.activeSpineIndex
        ttsCurrentTime = 0
        ttsDuration = 0
        ttsIsPlaying = false
        ttsTotalSamplesScheduled = 0
        ttsCurrentSpineIndex = engine.activeSpineIndex

        // Release any existing Whisper context from the transcription service
        // (audiobook mode uses a larger Whisper model). TTS mode uses Whisper-tiny
        // for word alignment, which coexists with PocketTTS in memory.
        Task {
            if let transcriptionService {
                transcriptionService.releaseWhisperContext()
            }

            do {
                try self.setupTTSAudioEngine()
                logger.info("TTS audio engine ready, starting chapter generation...")
                self.startTTSForCurrentChapter()
            } catch {
                logger.error("TTS activation failed: \(error)")
                self.state = .error("TTS setup failed: \(error.localizedDescription)")
            }
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
        try AudioSessionManager.activate(for: .tts)

        let audioEngine = AVAudioEngine()
        let playerNode = AVAudioPlayerNode()
        let timePitch = AVAudioUnitTimePitch()

        audioEngine.attach(playerNode)
        audioEngine.attach(timePitch)

        // PocketTTS outputs 24kHz mono.
        let engineFormat = AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1)!

        // Chain: playerNode → timePitch → mainMixer
        // TimePitch enables speed control without pitch distortion.
        audioEngine.connect(playerNode, to: timePitch, format: engineFormat)
        audioEngine.connect(timePitch, to: audioEngine.mainMixerNode, format: engineFormat)
        timePitch.rate = ttsPlaybackRate

        try audioEngine.start()

        self.ttsAudioEngine = audioEngine
        self.ttsPlayerNode = playerNode
        self.ttsTimePitchNode = timePitch
        self.ttsEngineFormat = engineFormat

        setupTTSRemoteCommands()
        logger.info("TTS audio engine started (24kHz mono, rate: \(self.ttsPlaybackRate)x)")
    }

    private func deactivateAudioSession() {
        AudioSessionManager.deactivate()
        clearTTSRemoteCommands()
    }

    // MARK: - TTS Remote Commands

    @ObservationIgnored private var ttsRemoteCommandTargets: [Any] = []

    private func setupTTSRemoteCommands() {
        let commandCenter = MPRemoteCommandCenter.shared()

        let playTarget = commandCenter.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                self?.toggleTTSPlayPause()
            }
            return .success
        }

        let pauseTarget = commandCenter.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                self?.toggleTTSPlayPause()
            }
            return .success
        }

        commandCenter.skipForwardCommand.preferredIntervals = [30]
        let skipFwdTarget = commandCenter.skipForwardCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                self?.ttsSkipForward()
            }
            return .success
        }

        commandCenter.skipBackwardCommand.preferredIntervals = [15]
        let skipBwdTarget = commandCenter.skipBackwardCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                self?.ttsSkipBackward()
            }
            return .success
        }

        ttsRemoteCommandTargets = [playTarget, pauseTarget, skipFwdTarget, skipBwdTarget]

        updateTTSNowPlayingInfo()
    }

    private func clearTTSRemoteCommands() {
        let commandCenter = MPRemoteCommandCenter.shared()
        for target in ttsRemoteCommandTargets {
            commandCenter.playCommand.removeTarget(target)
            commandCenter.pauseCommand.removeTarget(target)
            commandCenter.skipForwardCommand.removeTarget(target)
            commandCenter.skipBackwardCommand.removeTarget(target)
        }
        ttsRemoteCommandTargets = []
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    private func updateTTSNowPlayingInfo() {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: ebook?.title ?? "Read Along",
            MPMediaItemPropertyArtist: ebook?.authorsDisplay ?? "",
            MPNowPlayingInfoPropertyPlaybackRate: ttsIsPlaying ? ttsPlaybackRate : 0,
            MPMediaItemPropertyPlaybackDuration: ttsDuration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: ttsCurrentTime,
        ]

        if let coverData = ebook?.coverData, let image = UIImage(data: coverData) {
            info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        }

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    // MARK: - Page-Boundary Sentence Splitting

    /// Split sentences that cross page boundaries so each TTS chunk maps to
    /// exactly one page. Page turns then happen naturally at buffer boundaries.
    private func splitSentencesAtPageBoundaries(
        _ sentences: [TextProcessingUtils.SentenceSpan]
    ) -> [TextProcessingUtils.SentenceSpan] {
        guard let engine = engine,
              let pages = engine.currentChapterPageInfos,
              pages.count > 1,
              let plainTextMap = engine.currentChapterPlainTextMap else {
            return sentences
        }

        // Build sorted list of plain text offsets where pages break.
        // Each entry is the plain text character where a new page begins.
        var pageBreakPlainOffsets: [Int] = []
        for i in 1..<pages.count {
            let pageAttrStart = pages[i].range.location
            if let plainOffset = plainTextMap.plainTextLocation(forAttrStringLocation: pageAttrStart) {
                pageBreakPlainOffsets.append(plainOffset)
            }
        }
        guard !pageBreakPlainOffsets.isEmpty else { return sentences }
        pageBreakPlainOffsets.sort()

        var result: [TextProcessingUtils.SentenceSpan] = []

        for sentence in sentences {
            let sentStart = sentence.plainTextRange.location
            let sentEnd = sentStart + sentence.plainTextRange.length

            // Find page breaks that fall strictly inside this sentence
            let breaksInside = pageBreakPlainOffsets.filter { $0 > sentStart && $0 < sentEnd }

            if breaksInside.isEmpty {
                result.append(sentence)
                continue
            }

            // Split the sentence at each page break
            let sentText = sentence.text
            var currentPlainStart = sentStart

            for breakOffset in breaksInside {
                let offsetInText = breakOffset - sentStart
                guard offsetInText > 0, offsetInText < sentText.count else { continue }

                // Find nearest word boundary by searching backward for whitespace
                let breakIdx = sentText.index(sentText.startIndex, offsetBy: offsetInText)
                var splitIdx = breakIdx

                // Search backward (up to 80 chars) for the nearest space
                let searchLimit = max(0, offsetInText - 80)
                let searchStart = sentText.index(sentText.startIndex, offsetBy: searchLimit)
                if let spaceIdx = sentText[searchStart..<breakIdx].lastIndex(where: { $0.isWhitespace }) {
                    splitIdx = sentText.index(after: spaceIdx)
                }

                // Extract segment from currentPlainStart to splitIdx
                let segStart = currentPlainStart - sentStart
                let segEnd = sentText.distance(from: sentText.startIndex, to: splitIdx)
                guard segEnd > segStart else { continue }

                let startIdx = sentText.index(sentText.startIndex, offsetBy: segStart)
                let segmentText = String(sentText[startIdx..<splitIdx])
                let trimmed = segmentText.trimmingCharacters(in: .whitespacesAndNewlines)

                if !trimmed.isEmpty {
                    result.append(TextProcessingUtils.SentenceSpan(
                        text: trimmed,
                        plainTextRange: NSRange(location: currentPlainStart, length: segEnd - segStart)
                    ))
                }

                currentPlainStart = sentStart + segEnd
            }

            // Add remaining text after the last page break
            let remainingStart = currentPlainStart - sentStart
            if remainingStart < sentText.count {
                let remainIdx = sentText.index(sentText.startIndex, offsetBy: remainingStart)
                let remainText = String(sentText[remainIdx...]).trimmingCharacters(in: .whitespacesAndNewlines)
                if !remainText.isEmpty {
                    result.append(TextProcessingUtils.SentenceSpan(
                        text: remainText,
                        plainTextRange: NSRange(location: currentPlainStart, length: sentText.count - remainingStart)
                    ))
                }
            }
        }

        logger.info("Page-boundary split: \(sentences.count) sentences → \(result.count) chunks")
        return result
    }

    // MARK: - TTS Chapter Generation

    private func startTTSForCurrentChapter() {
        guard let engine = engine else { return }
        let spineIndex = engine.activeSpineIndex
        let bookId = ebook?.id

        // Check cache first
        if let bookId = bookId,
           let cache = ttsAudioCache,
           cache.hasCachedAudio(bookId: bookId, spineIndex: spineIndex, voiceId: Int(ttsVoiceIndex)),
           let cached = cache.loadCachedAudio(bookId: bookId, spineIndex: spineIndex) {
            logger.info("Using cached TTS audio for \(bookId)/\(spineIndex)")
            startTTSFromCachedAudio(cached, spineIndex: spineIndex)
            return
        }

        // Get chapter plain text — skip empty chapters (title pages, images, etc.)
        let rawText = engine.currentChapterPlainText ?? ""
        // Sentencize from the ORIGINAL text so plainTextRange values
        // correctly map to the PlainTextToAttrStringMap offsets.
        // TTS preprocessing (hyphen removal, etc.) is applied per-sentence
        // in the generation pipeline to avoid offset drift.
        let rawSentences = rawText.isEmpty ? [] : TextProcessingUtils.sentencize(rawText)

        if rawSentences.isEmpty {
            logger.info("Empty chapter at spine \(engine.activeSpineIndex), auto-advancing")
            handleTTSChapterComplete()
            return
        }

        // Split sentences at page boundaries so each TTS chunk
        // maps to exactly one page for crisp auto-advance.
        let sentences = splitSentencesAtPageBoundaries(rawSentences)

        ttsSentences = sentences
        ttsTotalSamplesScheduled = 0
        ttsBuffersQueued = 0
        ttsSentencePlaybackQueue = []
        ttsCurrentTime = 0
        ttsCurrentSpineIndex = engine.activeSpineIndex
        resetAudioProcessingState()

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

    /// Play from cached TTS audio — schedules all sentence buffers from disk.
    private func startTTSFromCachedAudio(_ cached: TTSAudioCache.CachedChapter, spineIndex: Int) {
        guard let playerNode = ttsPlayerNode,
              let engineFormat = ttsEngineFormat,
              let engine = engine else { return }

        let sentences = cached.sentenceSpans
        if sentences.isEmpty {
            handleTTSChapterComplete()
            return
        }

        ttsSentences = sentences
        ttsTotalSamplesScheduled = 0
        ttsBuffersQueued = 0
        ttsSentencePlaybackQueue = []
        ttsCurrentTime = 0
        ttsCurrentSpineIndex = spineIndex
        resetAudioProcessingState()

        let pageOffset = engine.currentPagePlainTextOffset ?? 0
        let startIndex = sentences.firstIndex {
            $0.plainTextRange.location + $0.plainTextRange.length > pageOffset
        } ?? 0
        ttsCurrentSentenceIndex = startIndex
        ttsStartSentenceIndex = startIndex

        // Schedule buffers from cached samples using sentence timing metadata
        ttsGenerationTask?.cancel()
        ttsGenerationTask = Task { [weak self] in
            guard let self = self else { return }
            let allSamples = cached.samples
            var successCount = 0

            for i in startIndex..<sentences.count {
                guard !Task.isCancelled else { return }

                // Throttle: wait if too many buffers are queued ahead
                while self.ttsBuffersQueued >= self.ttsMaxBuffersAhead && !Task.isCancelled {
                    try? await Task.sleep(for: .milliseconds(200))
                }
                guard !Task.isCancelled else { return }

                let timing = cached.metadata.sentenceTimings[i]
                let endSample = min(timing.sampleOffset + timing.sampleCount, allSamples.count)
                guard timing.sampleOffset < endSample else { continue }

                let sentenceSamples = Array(allSamples[timing.sampleOffset..<endSample])
                guard let buffer = self.makeEngineBuffer(from: sentenceSamples, engineFormat: engineFormat) else { continue }

                successCount += 1

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
                    self.ttsTotalSamplesScheduled += sentenceSamples.count

                    if self.state == .loading {
                        playerNode.play()
                        self.ttsIsPlaying = true
                        self.state = .active
                        self.startTTSUpdateLoop()
                        self.highlightFirstSentence()
                        logger.info("Cached TTS playback started at sentence \(i)")
                    }
                }
            }

            if successCount == 0 && !Task.isCancelled {
                self.state = .error("Failed to play cached audio")
                return
            }

            guard !Task.isCancelled else { return }

            // Schedule silence buffer for chapter completion
            let silenceBuffer = AVAudioPCMBuffer(pcmFormat: engineFormat, frameCapacity: 1)!
            silenceBuffer.frameLength = 1
            silenceBuffer.floatChannelData![0][0] = 0
            await playerNode.scheduleBuffer(silenceBuffer)

            await MainActor.run { [weak self] in
                self?.handleTTSChapterComplete()
            }
        }
    }

    /// Create a PCM buffer from raw audio samples (24kHz mono).
    /// Applies silence trimming, RMS-based loudness normalization,
    /// crossfade with the previous buffer, and inter-sentence padding.
    private func makeEngineBuffer(from samples: [Float], engineFormat: AVAudioFormat) -> AVAudioPCMBuffer? {
        guard !samples.isEmpty else { return nil }

        // 1. Trim leading/trailing silence
        var trimmed = trimSilence(samples)
        guard !trimmed.isEmpty else { return nil }

        // 2. RMS-based loudness normalization
        let rms = computeRMS(trimmed)
        if rms > 0.001 {
            // Update running average RMS
            ttsRunningRMSCount += 1
            ttsRunningRMS += (rms - ttsRunningRMS) / Float(ttsRunningRMSCount)

            // Scale to target RMS, but limit gain to avoid amplifying noise
            let gain = min(ttsTargetRMS / rms, 4.0)
            for i in 0..<trimmed.count {
                trimmed[i] = trimmed[i] * gain
            }

            // Soft-clip anything above 0.95 to prevent harsh clipping
            for i in 0..<trimmed.count {
                if trimmed[i] > 0.95 {
                    trimmed[i] = 0.95 + 0.05 * tanhf((trimmed[i] - 0.95) / 0.05)
                } else if trimmed[i] < -0.95 {
                    trimmed[i] = -0.95 - 0.05 * tanhf((-trimmed[i] - 0.95) / 0.05)
                }
            }
        }

        // 3. Crossfade with previous buffer's tail
        if !ttsPreviousBufferTail.isEmpty {
            let fadeLen = min(ttsCrossfadeSamples, trimmed.count, ttsPreviousBufferTail.count)
            for i in 0..<fadeLen {
                let t = Float(i) / Float(fadeLen)
                trimmed[i] = ttsPreviousBufferTail[i] * (1.0 - t) + trimmed[i] * t
            }
        }

        // Save tail for next crossfade
        let tailLen = min(ttsCrossfadeSamples, trimmed.count)
        ttsPreviousBufferTail = Array(trimmed.suffix(tailLen))

        // 4. Apply fade-out to last few ms (avoids click at sentence end)
        let fadeOutLen = min(ttsCrossfadeSamples, trimmed.count)
        for i in 0..<fadeOutLen {
            let idx = trimmed.count - fadeOutLen + i
            let t = Float(fadeOutLen - i) / Float(fadeOutLen)
            trimmed[idx] = trimmed[idx] * t
        }

        // 5. Append inter-sentence silence padding
        let padding = [Float](repeating: 0, count: ttsSilencePaddingSamples)
        let finalSamples = trimmed + padding

        guard let buffer = AVAudioPCMBuffer(pcmFormat: engineFormat, frameCapacity: AVAudioFrameCount(finalSamples.count)) else {
            return nil
        }
        buffer.frameLength = buffer.frameCapacity

        let channelData = buffer.floatChannelData![0]
        finalSamples.withUnsafeBufferPointer { srcPtr in
            let byteCount = srcPtr.count * MemoryLayout<Float>.stride
            UnsafeMutableRawPointer(channelData)
                .copyMemory(from: UnsafeRawPointer(srcPtr.baseAddress!), byteCount: byteCount)
        }

        return buffer
    }

    /// Trim leading and trailing silence below threshold.
    private func trimSilence(_ samples: [Float]) -> [Float] {
        let threshold = ttsSilenceThreshold
        var start = 0
        var end = samples.count - 1

        // Find first sample above threshold
        while start < samples.count && abs(samples[start]) < threshold {
            start += 1
        }
        // Find last sample above threshold
        while end > start && abs(samples[end]) < threshold {
            end -= 1
        }

        guard start < end else { return [] }

        // Keep a small margin (2ms = 48 samples at 24kHz) to avoid cutting transients
        let margin = 48
        start = max(0, start - margin)
        end = min(samples.count - 1, end + margin)

        return Array(samples[start...end])
    }

    /// Compute RMS of a sample buffer.
    private func computeRMS(_ samples: [Float]) -> Float {
        guard !samples.isEmpty else { return 0 }
        var sumSquares: Float = 0
        for s in samples {
            sumSquares += s * s
        }
        return sqrtf(sumSquares / Float(samples.count))
    }

    /// Reset audio processing state for a new chapter.
    private func resetAudioProcessingState() {
        ttsRunningRMS = 0
        ttsRunningRMSCount = 0
        ttsPreviousBufferTail = []
    }

    /// Producer pipeline: generates audio sentence by sentence, schedules onto player.
    /// Uses a sliding window to limit memory — only keeps up to ttsMaxBuffersAhead
    /// buffers queued on the player at any time.
    private func ttsGenerationPipeline(startingFrom startIndex: Int = 0) async {
        guard let playerNode = ttsPlayerNode,
              let engineFormat = ttsEngineFormat else {
            logger.error("TTS pipeline guard failed — player=\(self.ttsPlayerNode != nil), format=\(self.ttsEngineFormat != nil)")
            state = .error("TTS engine not ready")
            return
        }

        logger.info("TTS generation pipeline started for \(self.ttsSentences.count) sentences (from index \(startIndex))")

        ttsBuffersQueued = 0
        await MainActor.run { self.ttsSentencePlaybackQueue = [] }
        var cumulativeTime: Double = 0
        var successCount = 0

        // Stream samples to a temp file for caching + later alignment reads
        let tempPCMURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("tts_stream_\(UUID().uuidString).pcm")
        FileManager.default.createFile(atPath: tempPCMURL.path, contents: nil)
        let pcmFileHandle = try? FileHandle(forWritingTo: tempPCMURL)
        var totalSamplesWritten = 0

        // Phase 1: Generate ALL audio with PocketTTS (no Whisper loaded)
        for i in startIndex..<ttsSentences.count {
            guard !Task.isCancelled else {
                pcmFileHandle?.closeFile()
                try? FileManager.default.removeItem(at: tempPCMURL)
                return
            }

            // Throttle: wait if too many buffers are queued ahead
            while ttsBuffersQueued >= ttsMaxBuffersAhead && !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(200))
            }
            guard !Task.isCancelled else {
                pcmFileHandle?.closeFile()
                try? FileManager.default.removeItem(at: tempPCMURL)
                return
            }

            guard i < ttsSentences.count else { break }
            let sentence = ttsSentences[i]
            let rawSentenceText = sentence.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !rawSentenceText.isEmpty else { continue }

            let sentenceText = TextProcessingUtils.preprocessTextForTTS(rawSentenceText)

            do {
                guard let ttsContext = pocketTTSContext else {
                    logger.error("PocketTTS context lost mid-pipeline at chunk \(i)")
                    break
                }

                logger.info("Generating chunk[\(i)]: \"\(sentenceText.prefix(80))\"")

                // Register sentence in playback queue before generation starts
                await MainActor.run {
                    self.ttsBuffersQueued += 1
                    self.ttsSentencePlaybackQueue.append(i)
                }

                // Stream audio chunks directly to player as they arrive from Mimi decoder.
                // Each onChunk callback fires on ttsQueue with a playable audio fragment,
                // enabling near-immediate playback instead of waiting for full sentence.
                let result = try await ttsContext.generateAudioStreaming(
                    text: sentenceText,
                    onChunk: { [weak self] chunkSamples in
                        guard !chunkSamples.isEmpty else { return }

                        // Create PCM buffer at 24kHz mono (matches engine format)
                        guard let buffer = AVAudioPCMBuffer(
                            pcmFormat: engineFormat,
                            frameCapacity: AVAudioFrameCount(chunkSamples.count)
                        ) else { return }
                        buffer.frameLength = AVAudioFrameCount(chunkSamples.count)
                        chunkSamples.withUnsafeBufferPointer { src in
                            buffer.floatChannelData![0].update(from: src.baseAddress!, count: chunkSamples.count)
                        }

                        // Schedule immediately — AVAudioPlayerNode.scheduleBuffer is thread-safe
                        playerNode.scheduleBuffer(buffer)

                        // Start playback on the very first audio chunk
                        DispatchQueue.main.async { [weak self] in
                            guard let self = self, self.state == .loading else { return }
                            playerNode.play()
                            self.ttsIsPlaying = true
                            self.state = .active
                            self.startTTSUpdateLoop()
                            self.highlightFirstSentence()
                            logger.info("TTS playback started (first audio chunk at sentence \(i))")
                        }
                    }
                )
                let generatedSamples = result.audioSamples

                guard !Task.isCancelled, i < self.ttsSentences.count else {
                    pcmFileHandle?.closeFile()
                    try? FileManager.default.removeItem(at: tempPCMURL)
                    return
                }

                let sampleCount = generatedSamples.count
                guard sampleCount > 0 else { continue }

                let audioDuration = Double(sampleCount) / 24000.0
                successCount += 1

                // Update sentence timing
                await MainActor.run {
                    guard i < self.ttsSentences.count else { return }
                    self.ttsSentences[i].audioStartTime = cumulativeTime
                    self.ttsSentences[i].audioEndTime = cumulativeTime + audioDuration
                    self.ttsDuration = cumulativeTime + audioDuration
                    self.ttsTotalSamplesScheduled += sampleCount
                }

                cumulativeTime += audioDuration

                // Write collected samples to disk for caching
                generatedSamples.withUnsafeBufferPointer { buffer in
                    pcmFileHandle?.write(Data(buffer: buffer))
                }
                totalSamplesWritten += sampleCount

                // Schedule sentence boundary sentinel for highlight advancement.
                // This 1-sample silence plays after all of this sentence's audio chunks,
                // triggering handleSentenceBufferCompleted to advance highlighting.
                let sentinel = AVAudioPCMBuffer(pcmFormat: engineFormat, frameCapacity: 1)!
                sentinel.frameLength = 1
                sentinel.floatChannelData![0][0] = 0
                playerNode.scheduleBuffer(sentinel) { [weak self] in
                    Task { @MainActor in
                        self?.ttsBuffersQueued -= 1
                        self?.handleSentenceBufferCompleted()
                    }
                }

            } catch {
                logger.error("TTS generation failed for chunk \(i): \(error)")
            }
        }

        pcmFileHandle?.closeFile()

        if successCount == 0 && !Task.isCancelled {
            logger.error("TTS pipeline produced no audio for any sentence")
            try? FileManager.default.removeItem(at: tempPCMURL)
            state = .error("Failed to generate speech audio")
            return
        }

        guard !Task.isCancelled else {
            try? FileManager.default.removeItem(at: tempPCMURL)
            return
        }

        // Schedule a silence buffer with completion handler to detect end of playback.
        // This goes into the player queue after all audio buffers.
        let silenceBuffer = AVAudioPCMBuffer(pcmFormat: engineFormat, frameCapacity: 1)!
        silenceBuffer.frameLength = 1
        silenceBuffer.floatChannelData![0][0] = 0

        let playbackFinished: Task<Void, Never> = Task { @MainActor [playerNode] in
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                playerNode.scheduleBuffer(silenceBuffer) {
                    continuation.resume()
                }
            }
        }

        logger.info("All \(self.ttsSentences.count) sentences queued, total duration=\(String(format: "%.1f", cumulativeTime))s, \(totalSamplesWritten) samples streamed to disk")

        // Phase 2: Cache + align — runs DURING playback.
        // Both PocketTTS and Whisper-tiny coexist in memory (no model swapping).
        // Word-level highlighting becomes available during first playback.
        if let bookId = ebook?.id, let cache = ttsAudioCache, startIndex == 0, totalSamplesWritten > 0 {
            let metadata = TTSAudioCache.buildMetadata(
                voiceId: Int(self.ttsVoiceIndex),
                sentences: ttsSentences,
                chapterSamples: []
            )
            cache.cacheChapterAudioFromFile(
                bookId: bookId,
                spineIndex: ttsCurrentSpineIndex,
                pcmFileURL: tempPCMURL,
                metadata: metadata
            )

            // Whisper alignment runs concurrently with playback.
            // Word timings update live on ttsSentences, enabling word-level highlighting
            // during the current playback session.
            await alignChapterFromCache(bookId: bookId, spineIndex: ttsCurrentSpineIndex, cache: cache)
        } else {
            try? FileManager.default.removeItem(at: tempPCMURL)
        }

        // Wait for all audio playback to finish before advancing chapter
        await playbackFinished.value

        guard !Task.isCancelled else { return }

        await MainActor.run { [weak self] in
            self?.handleTTSChapterComplete()
        }
    }

    // MARK: - Word Alignment

    /// Align all sentences for a cached chapter using Whisper-tiny.
    /// Both PocketTTS and Whisper-tiny coexist in memory (tiny model ~75MB vs base ~370MB).
    /// Reads PCM samples per-sentence from disk (no bulk memory load).
    private func alignChapterFromCache(bookId: String, spineIndex: Int, cache: TTSAudioCache) async {
        let aligner = TTSWordAligner()
        do {
            try await aligner.loadModel()
            logger.info("Whisper loaded for chapter alignment")
        } catch {
            logger.warning("Whisper unavailable for alignment: \(error)")
            return
        }

        let sentences = await MainActor.run { self.ttsSentences }

        for (i, sentence) in sentences.enumerated() {
            guard !Task.isCancelled else { break }

            let rawText = sentence.text.trimmingCharacters(in: .whitespacesAndNewlines)
            let sampleRate = 24000.0
            let startSample = Int(sentence.audioStartTime * sampleRate)
            let sampleCount = Int((sentence.audioEndTime - sentence.audioStartTime) * sampleRate)

            guard !rawText.isEmpty, sampleCount > 0 else { continue }

            // Read only this sentence's samples from disk
            guard let sentenceSamples = cache.loadSampleRange(
                bookId: bookId,
                spineIndex: spineIndex,
                sampleOffset: startSample,
                sampleCount: sampleCount
            ) else { continue }

            let wordTimings = await aligner.alignWords(
                samples: sentenceSamples,
                originalText: rawText,
                sentencePlainTextRange: sentence.plainTextRange,
                timeOffset: sentence.audioStartTime
            )

            if !wordTimings.isEmpty {
                await MainActor.run {
                    if i < self.ttsSentences.count {
                        self.ttsSentences[i].wordTimings = wordTimings
                    }
                }
            }
        }

        // Update cache metadata with word timings
        if !Task.isCancelled {
            let updatedSentences = await MainActor.run { self.ttsSentences }
            let metadata = TTSAudioCache.buildMetadata(
                voiceId: Int(ttsVoiceIndex),
                sentences: updatedSentences,
                chapterSamples: []
            )
            cache.updateMetadata(bookId: bookId, spineIndex: spineIndex, metadata: metadata)
        }

        logger.info("Chapter word alignment complete")
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
        updateTTSNowPlayingInfo()

        // Advance page mid-sentence if the estimated reading position
        // has crossed a page boundary (fallback for cached audio where
        // sentences may not align with current page layout).
        checkMidSentencePageAdvance()
    }

    /// Advance the page mid-sentence based on the current reading position.
    /// Uses word-level timestamps from Whisper when available, otherwise
    /// falls back to linear interpolation based on audio progress.
    private func checkMidSentencePageAdvance() {
        guard let engine = engine,
              !autoAdvanceSuppressed,
              ttsCurrentSentenceIndex < ttsSentences.count else { return }

        let sentence = ttsSentences[ttsCurrentSentenceIndex]
        guard let plainTextMap = engine.currentChapterPlainTextMap else { return }

        let currentOffset: Int

        if !sentence.wordTimings.isEmpty {
            // Use precise Whisper-aligned word timestamps
            guard let currentWord = sentence.wordTimings.last(where: { $0.start <= ttsCurrentTime }) else { return }
            currentOffset = currentWord.plainTextOffset
        } else {
            // Fall back to linear interpolation
            let duration = sentence.audioEndTime - sentence.audioStartTime
            guard duration > 0 else { return }
            let elapsed = ttsCurrentTime - sentence.audioStartTime
            let progress = min(1.0, max(0.0, elapsed / duration))
            currentOffset = sentence.plainTextRange.location
                + Int(progress * Double(sentence.plainTextRange.length))
        }

        let clampedOffset = min(currentOffset, sentence.plainTextRange.location + sentence.plainTextRange.length - 1)
        guard let attrRange = plainTextMap.attrStringRange(
            for: NSRange(location: clampedOffset, length: 1)
        ) else { return }

        engine.showPage(containingRange: attrRange)
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
              let engineFormat = ttsEngineFormat,
              !ttsSentences.isEmpty,
              index < ttsSentences.count else { return }

        ttsStartSentenceIndex = index
        ttsGenerationTask?.cancel()
        playerNode.stop()
        ttsIsPlaying = false
        ttsTotalSamplesScheduled = 0
        ttsBuffersQueued = 0
        ttsSentencePlaybackQueue = []
        ttsCurrentSentenceIndex = index

        // Restart generation from this sentence
        ttsGenerationTask = Task { [weak self] in
            guard let self = self else { return }

            guard let pocketTTSContext = self.pocketTTSContext,
                  index < self.ttsSentences.count else { return }

            var cumulativeTime = self.ttsSentences[index].audioStartTime

            for i in index..<self.ttsSentences.count {
                guard !Task.isCancelled, i < self.ttsSentences.count else { return }

                // Throttle: wait if too many buffers are queued ahead
                while self.ttsBuffersQueued >= self.ttsMaxBuffersAhead && !Task.isCancelled {
                    try? await Task.sleep(for: .milliseconds(200))
                }
                guard !Task.isCancelled, i < self.ttsSentences.count else { return }

                let sentence = self.ttsSentences[i]
                let rawSentenceText = sentence.text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !rawSentenceText.isEmpty else { continue }

                // Preprocess for better TTS pronunciation (doesn't affect highlighting ranges)
                let sentenceText = TextProcessingUtils.preprocessTextForTTS(rawSentenceText)

                do {
                    // Register sentence in playback queue before generation starts
                    await MainActor.run {
                        self.ttsBuffersQueued += 1
                        self.ttsSentencePlaybackQueue.append(i)
                    }

                    // Stream audio chunks directly to player as they arrive
                    let result = try await pocketTTSContext.generateAudioStreaming(
                        text: sentenceText,
                        onChunk: { [weak self] chunkSamples in
                            guard !chunkSamples.isEmpty else { return }

                            guard let buffer = AVAudioPCMBuffer(
                                pcmFormat: engineFormat,
                                frameCapacity: AVAudioFrameCount(chunkSamples.count)
                            ) else { return }
                            buffer.frameLength = AVAudioFrameCount(chunkSamples.count)
                            chunkSamples.withUnsafeBufferPointer { src in
                                buffer.floatChannelData![0].update(from: src.baseAddress!, count: chunkSamples.count)
                            }

                            playerNode.scheduleBuffer(buffer)

                            // Start playback on the first audio chunk after restart
                            DispatchQueue.main.async { [weak self] in
                                guard let self = self, !self.ttsIsPlaying else { return }
                                playerNode.play()
                                self.ttsIsPlaying = true
                                self.state = .active
                                self.highlightFirstSentence()
                            }
                        }
                    )
                    let generatedSamples = result.audioSamples

                    guard !Task.isCancelled, i < self.ttsSentences.count else { return }

                    let sampleCount = generatedSamples.count
                    guard sampleCount > 0 else { continue }

                    let audioDuration = Double(sampleCount) / 24000.0

                    await MainActor.run {
                        guard i < self.ttsSentences.count else { return }
                        self.ttsSentences[i].audioStartTime = cumulativeTime
                        self.ttsSentences[i].audioEndTime = cumulativeTime + audioDuration
                        self.ttsDuration = cumulativeTime + audioDuration
                        self.ttsTotalSamplesScheduled += sampleCount
                    }

                    cumulativeTime += audioDuration

                    // Sentence boundary sentinel for highlight advancement
                    let sentinel = AVAudioPCMBuffer(pcmFormat: engineFormat, frameCapacity: 1)!
                    sentinel.frameLength = 1
                    sentinel.floatChannelData![0][0] = 0
                    playerNode.scheduleBuffer(sentinel) { [weak self] in
                        Task { @MainActor in
                            self?.ttsBuffersQueued -= 1
                            self?.handleSentenceBufferCompleted()
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

}
