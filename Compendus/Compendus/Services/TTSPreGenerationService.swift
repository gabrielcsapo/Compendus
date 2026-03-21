//
//  TTSPreGenerationService.swift
//  Compendus
//
//  Background TTS pre-generation for EPUB books. Parses each chapter,
//  generates speech via PocketTTS, and caches audio + transcript data
//  so read-along can start instantly without real-time synthesis.
//
//  Supports resumable background processing via BGProcessingTask.
//

import Foundation
import SwiftData
import os.log
import EPUBReader

private let logger = Logger(subsystem: "com.compendus.tts", category: "PreGeneration")

@MainActor
@Observable
class TTSPreGenerationService {

    static let backgroundTaskIdentifier = "com.compendus.tts-generation"

    // MARK: - State

    enum GenerationState: Equatable {
        case idle
        case generating(progress: Double, message: String)
        case completed
        case error(String)

        static func == (lhs: GenerationState, rhs: GenerationState) -> Bool {
            switch (lhs, rhs) {
            case (.idle, .idle): return true
            case (.generating(let lp, let lm), .generating(let rp, let rm)):
                return lp == rp && lm == rm
            case (.completed, .completed): return true
            case (.error(let l), .error(let r)): return l == r
            default: return false
            }
        }
    }

    var state: GenerationState = .idle
    var activeBookId: String?
    var activeBookTitle: String?

    var isActive: Bool {
        if case .generating = state { return true }
        return false
    }

    // MARK: - Resumable State

    struct ResumableGenerationState: Codable {
        let bookId: String
        let bookLocalPath: String
        let voiceId: Int
        let totalSpineItems: Int
        var completedSpineIndex: Int     // -1 if none completed
        var accumulatedSegments: [TranscriptSegment]
    }

    @ObservationIgnored private var currentTask: Task<Void, Never>?
    @ObservationIgnored private var resumableState: ResumableGenerationState?

    private static let progressFilePath: URL = {
        FileManager.default.temporaryDirectory.appendingPathComponent("tts_generation_progress.json")
    }()

    // MARK: - Core API

    /// Start generating TTS audio for all chapters of an EPUB book.
    func generateForBook(
        _ book: DownloadedBook,
        voiceId: Int,
        ttsContext: PocketTTSContext,
        cache: TTSAudioCache,
        modelContainer: ModelContainer
    ) {
        guard !isActive else {
            logger.warning("Generation already in progress")
            return
        }

        guard let fileURL = book.fileURL else {
            state = .error("Book file not found")
            return
        }

        activeBookId = book.id
        activeBookTitle = book.title
        state = .generating(progress: 0, message: "Preparing...")

        // Restore any saved progress from a previous interrupted session
        if resumableState == nil {
            resumableState = loadProgressFromDisk()
        }

        currentTask = Task.detached(priority: .utility) { [weak self] in
            await self?.performGeneration(
                bookId: book.id,
                bookLocalPath: book.localPath,
                fileURL: fileURL,
                voiceId: voiceId,
                ttsContext: ttsContext,
                cache: cache,
                modelContainer: modelContainer
            )
        }
    }

    /// Cancel any in-progress generation.
    func cancel() {
        currentTask?.cancel()
        currentTask = nil
        clearProgressFromDisk()
        state = .idle
        activeBookId = nil
        activeBookTitle = nil
        logger.info("TTS generation cancelled")
    }

    // MARK: - Generation Pipeline

    nonisolated private func performGeneration(
        bookId: String,
        bookLocalPath: String,
        fileURL: URL,
        voiceId: Int,
        ttsContext: PocketTTSContext,
        cache: TTSAudioCache,
        modelContainer: ModelContainer
    ) async {
        do {
            // Parse the EPUB
            await MainActor.run { state = .generating(progress: 0, message: "Parsing EPUB...") }
            let parser = try await EPUBParser.parse(epubURL: fileURL)
            let spineCount = parser.package.spine.count

            guard spineCount > 0 else {
                await MainActor.run { state = .error("No content in EPUB") }
                return
            }

            // Initialize or restore resumable state
            let startIndex: Int
            let currentResumable = await resumableState
            if let rs = currentResumable, rs.bookId == bookId, rs.voiceId == voiceId {
                startIndex = rs.completedSpineIndex + 1
                logger.info("Resuming TTS generation for '\(bookId)' from spine \(startIndex)")
            } else {
                let newState = ResumableGenerationState(
                    bookId: bookId,
                    bookLocalPath: bookLocalPath,
                    voiceId: voiceId,
                    totalSpineItems: spineCount,
                    completedSpineIndex: -1,
                    accumulatedSegments: []
                )
                await MainActor.run { resumableState = newState }
                startIndex = 0
            }

            var cumulativeTimeOffset: Double = 0
            // Calculate offset from already-completed chapters
            if let rs = await resumableState {
                for segment in rs.accumulatedSegments {
                    cumulativeTimeOffset = max(cumulativeTimeOffset, segment.end)
                }
            }

            for spineIndex in startIndex..<spineCount {
                guard !Task.isCancelled else {
                    await saveProgressToDisk()
                    return
                }

                let progress = Double(spineIndex) / Double(spineCount)
                await MainActor.run {
                    state = .generating(
                        progress: progress,
                        message: "Chapter \(spineIndex + 1) of \(spineCount)"
                    )
                }

                // Skip chapters that are already cached with this voice
                if cache.hasCachedAudio(bookId: bookId, spineIndex: spineIndex, voiceId: voiceId) {
                    // Load cached metadata to get timing for transcript
                    if let cached = cache.loadCachedAudio(bookId: bookId, spineIndex: spineIndex) {
                        let chapterTranscript = TTSTranscriptBuilder.buildTranscript(
                            from: cached.sentenceSpans
                        )
                        let offsetSegments = chapterTranscript.segments.map { seg in
                            TranscriptSegment(
                                start: seg.start + cumulativeTimeOffset,
                                end: seg.end + cumulativeTimeOffset,
                                text: seg.text,
                                words: seg.words.map { w in
                                    TranscriptWord(
                                        word: w.word,
                                        start: w.start + cumulativeTimeOffset,
                                        end: w.end + cumulativeTimeOffset
                                    )
                                }
                            )
                        }
                        await MainActor.run { resumableState?.accumulatedSegments.append(contentsOf: offsetSegments) }
                        cumulativeTimeOffset += chapterTranscript.duration
                    }
                    await MainActor.run { resumableState?.completedSpineIndex = spineIndex }
                    logger.info("Skipping cached spine \(spineIndex)")
                    continue
                }

                // Load and parse chapter content
                guard let chapterURL = parser.resolveSpineItemURL(at: spineIndex),
                      let chapterData = try? Data(contentsOf: chapterURL) else {
                    logger.warning("Could not load content for spine \(spineIndex), skipping")
                    await MainActor.run { resumableState?.completedSpineIndex = spineIndex }
                    continue
                }

                let contentParser = XHTMLContentParser(data: chapterData, baseURL: chapterURL)
                let nodes = contentParser.parse()
                let plainText = await MainActor.run { NativeEPUBEngine.extractPlainText(from: nodes) }

                guard !plainText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    logger.info("Empty chapter at spine \(spineIndex), skipping")
                    await MainActor.run { resumableState?.completedSpineIndex = spineIndex }
                    continue
                }

                // Sentencize
                let sentences = TextProcessingUtils.sentencize(plainText)
                guard !sentences.isEmpty else {
                    await MainActor.run { resumableState?.completedSpineIndex = spineIndex }
                    continue
                }

                // Generate audio for each sentence
                var chapterSamples: [Float] = []
                var chapterSentences = sentences
                var chapterCumulativeTime: Double = 0

                for (i, sentence) in sentences.enumerated() {
                    guard !Task.isCancelled else {
                        await saveProgressToDisk()
                        return
                    }

                    let rawText = sentence.text.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !rawText.isEmpty else { continue }

                    let processedText = TextProcessingUtils.preprocessTextForTTS(rawText)

                    do {
                        let result = try await ttsContext.generateAudioStreaming(text: processedText, onChunk: { _ in })
                        let samples = result.audioSamples
                        guard !samples.isEmpty else { continue }

                        let duration = Double(samples.count) / 24000.0
                        chapterSentences[i].audioStartTime = chapterCumulativeTime
                        chapterSentences[i].audioEndTime = chapterCumulativeTime + duration

                        // Compute proportional word timings
                        chapterSentences[i].wordTimings = TextProcessingUtils.estimateWordTimings(
                            sentence: rawText,
                            plainTextRange: sentence.plainTextRange,
                            startTime: chapterCumulativeTime,
                            endTime: chapterCumulativeTime + duration
                        )

                        chapterCumulativeTime += duration
                        chapterSamples.append(contentsOf: samples)
                    } catch {
                        logger.error("TTS generation failed for spine \(spineIndex) sentence \(i): \(error)")
                    }
                }

                // Cache the chapter audio
                if !chapterSamples.isEmpty {
                    let metadata = TTSAudioCache.buildMetadata(
                        voiceId: voiceId,
                        sentences: chapterSentences,
                        chapterSamples: chapterSamples
                    )
                    cache.cacheChapterAudio(
                        bookId: bookId,
                        spineIndex: spineIndex,
                        samples: chapterSamples,
                        metadata: metadata
                    )

                    // Build transcript segment for this chapter
                    let chapterTranscript = TTSTranscriptBuilder.buildTranscript(from: chapterSentences)
                    let offsetSegments = chapterTranscript.segments.map { seg in
                        TranscriptSegment(
                            start: seg.start + cumulativeTimeOffset,
                            end: seg.end + cumulativeTimeOffset,
                            text: seg.text,
                            words: seg.words.map { w in
                                TranscriptWord(
                                    word: w.word,
                                    start: w.start + cumulativeTimeOffset,
                                    end: w.end + cumulativeTimeOffset
                                )
                            }
                        )
                    }
                    await MainActor.run { resumableState?.accumulatedSegments.append(contentsOf: offsetSegments) }
                    cumulativeTimeOffset += chapterTranscript.duration
                }

                await MainActor.run { resumableState?.completedSpineIndex = spineIndex }

                // Save progress periodically
                if spineIndex % 2 == 0 {
                    await saveProgressToDisk()
                }

                logger.info("Generated TTS for spine \(spineIndex)/\(spineCount) — \(chapterSamples.count) samples")
            }

            guard !Task.isCancelled else { return }

            // Build and save full transcript
            if let rs = await resumableState, !rs.accumulatedSegments.isEmpty {
                let fullTranscript = Transcript(
                    duration: cumulativeTimeOffset,
                    language: "en",
                    segments: rs.accumulatedSegments
                )
                await saveTranscript(fullTranscript, bookId: bookId, voiceId: voiceId, modelContainer: modelContainer)
            }

            await clearProgressFromDisk()
            await MainActor.run {
                state = .completed
            }
            logger.info("TTS pre-generation complete for '\(bookId)'")

        } catch {
            logger.error("TTS generation failed: \(error)")
            await MainActor.run { state = .error(error.localizedDescription) }
        }
    }

    // MARK: - Transcript Persistence

    private func saveTranscript(
        _ transcript: Transcript,
        bookId: String,
        voiceId: Int,
        modelContainer: ModelContainer
    ) async {
        do {
            let context = ModelContext(modelContainer)
            let descriptor = FetchDescriptor<DownloadedBook>(
                predicate: #Predicate { $0.id == bookId }
            )
            guard let book = try context.fetch(descriptor).first else {
                logger.warning("Book \(bookId) not found for transcript save")
                return
            }
            book.ttsTranscriptData = try JSONEncoder().encode(transcript)
            book.ttsVoiceId = voiceId
            try context.save()
            logger.info("Saved TTS transcript for '\(bookId)' (\(transcript.segments.count) segments)")
        } catch {
            logger.error("Failed to save TTS transcript: \(error)")
        }
    }

    // MARK: - Resumable Progress

    func saveProgressToDisk() {
        guard let state = resumableState else { return }
        do {
            let data = try JSONEncoder().encode(state)
            try data.write(to: Self.progressFilePath, options: .atomic)
            logger.info("Saved TTS generation progress (spine \(state.completedSpineIndex)/\(state.totalSpineItems))")
        } catch {
            logger.error("Failed to save TTS generation progress: \(error)")
        }
    }

    func loadProgressFromDisk() -> ResumableGenerationState? {
        guard FileManager.default.fileExists(atPath: Self.progressFilePath.path) else { return nil }
        guard let data = try? Data(contentsOf: Self.progressFilePath) else { return nil }
        return try? JSONDecoder().decode(ResumableGenerationState.self, from: data)
    }

    func clearProgressFromDisk() {
        resumableState = nil
        try? FileManager.default.removeItem(at: Self.progressFilePath)
    }
}
