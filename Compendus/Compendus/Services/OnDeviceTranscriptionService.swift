//
//  OnDeviceTranscriptionService.swift
//  Compendus
//
//  On-device audiobook transcription using whisper.cpp.
//  Processes audio in 30-second chunks and outputs Transcript
//  model compatible with the existing AudioLyricsView.
//
//  Supports background processing via BGProcessingTask so long
//  audiobooks can be transcribed overnight while charging.
//

import Foundation
import AVFoundation
import BackgroundTasks
import UIKit

@MainActor
@Observable
class OnDeviceTranscriptionService {
    enum TranscriptionState: Equatable {
        case idle
        case preparing
        case transcribing(progress: Double, message: String)
        case completed(Transcript)
        case error(String)

        static func == (lhs: TranscriptionState, rhs: TranscriptionState) -> Bool {
            switch (lhs, rhs) {
            case (.idle, .idle): return true
            case (.preparing, .preparing): return true
            case (.transcribing(let lp, let lm), .transcribing(let rp, let rm)):
                return lp == rp && lm == rm
            case (.completed, .completed): return true
            case (.error(let l), .error(let r)): return l == r
            default: return false
            }
        }
    }

    static let backgroundTaskIdentifier = "com.compendus.transcription"

    var state: TranscriptionState = .idle

    // Book metadata for displaying progress outside the detail view
    var activeBookId: String?
    var activeBookTitle: String?
    var activeBookCoverData: Data?

    /// Whether a transcription is currently running
    var isActive: Bool {
        switch state {
        case .preparing, .transcribing: return true
        default: return false
        }
    }

    /// When true, transcription is ephemeral (used for live read-along).
    /// The transcript is kept in `partialTranscript` for real-time highlighting
    /// but is NOT saved to disk or emitted via `.completed` state.
    /// Users who want a persistent transcript should use the offline "Transcribe" button.
    var liveMode: Bool = false

    /// Partial transcript built progressively as chunks complete.
    /// Available for live lyrics display while transcription is in progress.
    var partialTranscript: Transcript?

    /// The end time (in seconds) of the last transcribed segment.
    /// Used by ReadAlongService to check how far ahead the buffer extends.
    var lastTranscribedTime: Double? {
        partialTranscript?.segments.last?.end
    }

    @ObservationIgnored private var currentTask: Task<Void, Never>?
    @ObservationIgnored private var backgroundTaskID: UIBackgroundTaskIdentifier = .invalid
    @ObservationIgnored private var whisperContext: WhisperContext?

    // MARK: - Resumable State

    /// Persisted progress so transcription can resume from background tasks
    @ObservationIgnored private var resumableState: ResumableTranscriptionState?

    struct ResumableTranscriptionState: Codable {
        let fileURL: URL
        let duration: Double
        let bookId: String
        let title: String
        let coverData: Data?
        var completedChunkIndex: Int // last completed chunk (0-based), -1 if none completed
        var accumulatedSegments: [TranscriptSegment]
        let chunkDuration: Double
        let totalChunks: Int
        let language: String

        var nextChunkIndex: Int { completedChunkIndex + 1 }
        var isComplete: Bool { nextChunkIndex >= totalChunks }
    }

    private static var progressFileURL: URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("transcription_progress.json")
    }

    // MARK: - Model

    /// Path to the bundled whisper model.
    private static var modelURL: URL? {
        // Look for the model in the app bundle
        Bundle.main.url(forResource: "ggml-base.en-q8_0", withExtension: "bin")
    }

    // MARK: - Availability

    var isAvailable: Bool {
        Self.modelURL != nil
    }

    // MARK: - Public API

    /// Start transcription of the full book or from a specific time position.
    /// - Parameter startFromTime: If provided, transcription starts from this
    ///   position (one chunk back for context). Useful for "live" transcription
    ///   while listening — only transcribes from where the user is.
    func transcribe(fileURL: URL, duration: Double, bookId: String, title: String, coverData: Data?, startFromTime: Double? = nil) {
        currentTask?.cancel()
        activeBookId = bookId
        activeBookTitle = title
        activeBookCoverData = coverData

        let chunkDuration: Double = 30.0
        let totalChunks = max(1, Int(ceil(duration / chunkDuration)))

        // For live transcription, skip to the chunk containing the current position
        var startChunkIndex = -1
        if let startTime = startFromTime, startTime > chunkDuration {
            let targetChunk = Int(startTime / chunkDuration)
            // Start one chunk back for context so first completed chunk
            // covers the area near the current playback position
            startChunkIndex = max(-1, targetChunk - 1)
        }

        resumableState = ResumableTranscriptionState(
            fileURL: fileURL,
            duration: duration,
            bookId: bookId,
            title: title,
            coverData: coverData,
            completedChunkIndex: startChunkIndex,
            accumulatedSegments: [],
            chunkDuration: chunkDuration,
            totalChunks: totalChunks,
            language: "en"
        )

        currentTask = Task {
            await performTranscription()
        }
    }

    func cancel() {
        currentTask?.cancel()
        currentTask = nil
        endBackgroundTask()
        clearResumableState()
        clearActiveBook()
        partialTranscript = nil
        liveMode = false
        whisperContext = nil
        state = .idle
    }

    /// Release the Whisper model from memory without cancelling transcription state.
    /// Call this before loading another Whisper-based service (e.g. TTS word aligner)
    /// to avoid two Whisper models coexisting in Metal GPU memory.
    func releaseWhisperContext() {
        whisperContext = nil
        print("[Whisper] Transcription service context released to free Metal memory")
    }

    private func clearActiveBook() {
        activeBookId = nil
        activeBookTitle = nil
        activeBookCoverData = nil
    }

    // MARK: - Background Task Registration

    /// Call once at app launch to register the background task handler
    nonisolated static func registerBackgroundTask(service: OnDeviceTranscriptionService) {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: backgroundTaskIdentifier,
            using: nil
        ) { task in
            guard let processingTask = task as? BGProcessingTask else {
                task.setTaskCompleted(success: false)
                return
            }
            Task { @MainActor in
                service.handleBackgroundTask(processingTask)
            }
        }
    }

    /// Schedule a BGProcessingTask to continue transcription
    func scheduleBackgroundTask() {
        guard resumableState != nil, isActive else { return }

        // Save progress to disk so it survives process termination
        saveProgressToDisk()

        let request = BGProcessingTaskRequest(identifier: Self.backgroundTaskIdentifier)
        request.requiresExternalPower = false
        request.requiresNetworkConnectivity = false

        do {
            try BGTaskScheduler.shared.submit(request)
            print("[Whisper] Background processing task scheduled")
        } catch {
            print("[Whisper] Failed to schedule background task: \(error)")
        }
    }

    /// Called when the app enters background — request extra execution time
    func handleAppBackgrounded() {
        guard isActive else { return }

        // Request immediate background time
        backgroundTaskID = UIApplication.shared.beginBackgroundTask { [weak self] in
            Task { @MainActor [weak self] in
                self?.saveProgressToDisk()
                self?.endBackgroundTask()
            }
        }

        // Schedule a BGProcessingTask for extended processing
        scheduleBackgroundTask()
    }

    /// Called when the app returns to foreground
    func handleAppForegrounded() {
        endBackgroundTask()

        // If we have saved progress but no active task, resume
        if currentTask == nil, let saved = loadProgressFromDisk() {
            resumableState = saved
            activeBookId = saved.bookId
            activeBookTitle = saved.title
            activeBookCoverData = saved.coverData

            // Restore partial transcript from accumulated segments
            if !saved.accumulatedSegments.isEmpty {
                partialTranscript = Transcript(
                    duration: saved.duration,
                    language: saved.language,
                    segments: saved.accumulatedSegments
                )
            }

            if !saved.isComplete {
                let progress = Double(saved.nextChunkIndex) / Double(saved.totalChunks)
                state = .transcribing(
                    progress: progress,
                    message: "Resuming chunk \(saved.nextChunkIndex + 1) of \(saved.totalChunks)..."
                )
                currentTask = Task {
                    await performTranscription()
                }
            }
        }
    }

    // MARK: - Background Task Handler

    private func handleBackgroundTask(_ task: BGProcessingTask) {
        if resumableState == nil {
            if let saved = loadProgressFromDisk() {
                resumableState = saved
                activeBookId = saved.bookId
                activeBookTitle = saved.title
                activeBookCoverData = saved.coverData
            } else {
                task.setTaskCompleted(success: true)
                return
            }
        }

        guard let rs = resumableState, !rs.isComplete else {
            task.setTaskCompleted(success: true)
            clearResumableState()
            return
        }

        task.expirationHandler = { [weak self] in
            Task { @MainActor [weak self] in
                self?.currentTask?.cancel()
                self?.currentTask = nil
                self?.saveProgressToDisk()
                self?.scheduleBackgroundTask()
            }
        }

        let progress = Double(rs.nextChunkIndex) / Double(rs.totalChunks)
        state = .transcribing(
            progress: progress,
            message: "Transcribing chunk \(rs.nextChunkIndex + 1) of \(rs.totalChunks)..."
        )

        currentTask = Task {
            await performTranscription()
            task.setTaskCompleted(success: true)
        }
    }

    // MARK: - Whisper Model

    private func ensureWhisperContext() async throws {
        if whisperContext != nil { return }
        guard let modelURL = Self.modelURL else {
            throw TranscriptionError.modelNotFound
        }
        whisperContext = try WhisperContext.createContext(path: modelURL.path)
        print("[Whisper] Model loaded from \(modelURL.lastPathComponent)")
    }

    // MARK: - Transcription Pipeline

    private func performTranscription() async {
        guard var rs = resumableState else { return }

        state = .preparing

        do {
            try await ensureWhisperContext()
        } catch {
            state = .error("Failed to load whisper model: \(error.localizedDescription)")
            return
        }

        guard let ctx = whisperContext else {
            state = .error("Whisper context unavailable")
            return
        }

        for chunkIndex in rs.nextChunkIndex..<rs.totalChunks {
            guard !Task.isCancelled else {
                if !liveMode { saveProgressToDisk() }
                return
            }

            let startTime = Double(chunkIndex) * rs.chunkDuration
            let endTime = min(startTime + rs.chunkDuration, rs.duration)
            let progress = Double(chunkIndex) / Double(rs.totalChunks)

            state = .transcribing(
                progress: progress,
                message: "Transcribing chunk \(chunkIndex + 1) of \(rs.totalChunks)..."
            )

            do {
                // Convert audio chunk to 16 kHz mono Float samples
                let samples = try await extractSamples(
                    from: rs.fileURL,
                    startTime: startTime,
                    endTime: endTime
                )

                // Run whisper on background thread (actor-isolated)
                let whisperSegments = await ctx.fullTranscribe(
                    samples: samples,
                    timeOffset: startTime
                )

                // Convert whisper segments to our Transcript model
                let chunkSegments = whisperSegments.map { seg in
                    TranscriptSegment(
                        start: seg.start,
                        end: seg.end,
                        text: seg.text,
                        words: seg.words.map { w in
                            TranscriptWord(word: w.text, start: w.start, end: w.end)
                        }
                    )
                }

                rs.accumulatedSegments.append(contentsOf: chunkSegments)
                rs.completedChunkIndex = chunkIndex
                resumableState = rs

                // Update partial transcript for live lyrics display
                partialTranscript = Transcript(
                    duration: rs.duration,
                    language: rs.language,
                    segments: rs.accumulatedSegments
                )

                // Periodically save progress to disk (every 5 chunks) — skip in live mode
                if !liveMode && chunkIndex % 5 == 0 {
                    saveProgressToDisk()
                }
            } catch {
                if Task.isCancelled {
                    if !liveMode { saveProgressToDisk() }
                    return
                }
                state = .error("Transcription failed on chunk \(chunkIndex + 1): \(error.localizedDescription)")
                return
            }
        }

        if liveMode {
            // Live mode: transcript stays in partialTranscript for read-along,
            // nothing is saved or emitted — just go idle.
            clearResumableState()
            state = .idle
        } else {
            let transcript = Transcript(
                duration: rs.duration,
                language: rs.language,
                segments: rs.accumulatedSegments
            )

            clearResumableState()
            partialTranscript = nil
            state = .completed(transcript)
        }
    }

    // MARK: - Audio Sample Extraction

    /// Extract a time range from an audio file and return 16 kHz mono Float samples
    /// suitable for whisper.cpp input.
    private func extractSamples(
        from sourceURL: URL,
        startTime: Double,
        endTime: Double
    ) async throws -> [Float] {
        let asset = AVURLAsset(url: sourceURL)

        // Target format: 16 kHz, mono, Float32
        guard let outputFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: 16000,
            channels: 1,
            interleaved: false
        ) else {
            throw TranscriptionError.audioConversionFailed
        }

        // Read the source file
        let file = try AVAudioFile(forReading: sourceURL)
        let sourceFormat = file.processingFormat
        let sourceSampleRate = sourceFormat.sampleRate

        // Calculate frame range
        let startFrame = AVAudioFramePosition(startTime * sourceSampleRate)
        let frameCount = AVAudioFrameCount((endTime - startTime) * sourceSampleRate)

        file.framePosition = startFrame

        guard let sourceBuffer = AVAudioPCMBuffer(
            pcmFormat: sourceFormat,
            frameCapacity: frameCount
        ) else {
            throw TranscriptionError.audioConversionFailed
        }

        try file.read(into: sourceBuffer, frameCount: frameCount)

        // Convert to 16 kHz mono
        guard let converter = AVAudioConverter(from: sourceFormat, to: outputFormat) else {
            throw TranscriptionError.audioConversionFailed
        }

        let outputFrameCount = AVAudioFrameCount(
            Double(sourceBuffer.frameLength) * 16000.0 / sourceSampleRate
        )
        guard let outputBuffer = AVAudioPCMBuffer(
            pcmFormat: outputFormat,
            frameCapacity: outputFrameCount
        ) else {
            throw TranscriptionError.audioConversionFailed
        }

        var error: NSError?
        var isDone = false
        converter.convert(to: outputBuffer, error: &error) { _, outStatus in
            if isDone {
                outStatus.pointee = .noDataNow
                return nil
            }
            isDone = true
            outStatus.pointee = .haveData
            return sourceBuffer
        }

        if let error {
            throw error
        }

        // Extract Float array
        guard let channelData = outputBuffer.floatChannelData else {
            throw TranscriptionError.audioConversionFailed
        }

        let count = Int(outputBuffer.frameLength)
        return Array(UnsafeBufferPointer(start: channelData[0], count: count))
    }

    // MARK: - Progress Persistence

    private func saveProgressToDisk() {
        guard let rs = resumableState else { return }
        do {
            let data = try JSONEncoder().encode(rs)
            try data.write(to: Self.progressFileURL, options: .atomic)
            print("[Whisper] Progress saved: chunk \(rs.completedChunkIndex + 1)/\(rs.totalChunks)")
        } catch {
            print("[Whisper] Failed to save progress: \(error)")
        }
    }

    private func loadProgressFromDisk() -> ResumableTranscriptionState? {
        guard FileManager.default.fileExists(atPath: Self.progressFileURL.path) else {
            return nil
        }
        do {
            let data = try Data(contentsOf: Self.progressFileURL)
            let state = try JSONDecoder().decode(ResumableTranscriptionState.self, from: data)
            print("[Whisper] Loaded saved progress: chunk \(state.completedChunkIndex + 1)/\(state.totalChunks)")
            return state
        } catch {
            print("[Whisper] Failed to load progress: \(error)")
            return nil
        }
    }

    private func clearResumableState() {
        resumableState = nil
        try? FileManager.default.removeItem(at: Self.progressFileURL)
    }

    // MARK: - Background Task Helpers

    private func endBackgroundTask() {
        if backgroundTaskID != .invalid {
            UIApplication.shared.endBackgroundTask(backgroundTaskID)
            backgroundTaskID = .invalid
        }
    }

    // MARK: - Errors

    enum TranscriptionError: LocalizedError {
        case exportFailed
        case modelNotFound
        case audioConversionFailed

        var errorDescription: String? {
            switch self {
            case .exportFailed: return "Failed to extract audio chunk"
            case .modelNotFound: return "Whisper model file not found in bundle"
            case .audioConversionFailed: return "Failed to convert audio to 16 kHz"
            }
        }
    }
}
