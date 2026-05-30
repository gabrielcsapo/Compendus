//
//  KokoroTTSContext.swift
//  Compendus
//
//  Wrapper around the vendored Kokoro-82M CoreML engine for read-along.
//  Mirrors the old PocketTTSContext API so ReadAlongService barely changes:
//  a simple async call that returns raw 24 kHz float samples (for AVAudioPlayerNode
//  scheduling) plus real per-word timestamps derived from the model's pred_dur output.
//

import CoreML
import Foundation
import os.log

private let logger = Logger(subsystem: "com.compendus.tts", category: "KokoroTTSContext")

enum KokoroTTSError: Error, LocalizedError {
    case modelNotFound
    case generationFailed(String)

    var errorDescription: String? {
        switch self {
        case .modelNotFound: return "Kokoro model not found in bundle"
        case .generationFailed(let msg): return "TTS generation failed: \(msg)"
        }
    }
}

/// Manages the Kokoro engine and audio generation.
/// Thread-safe via a serial DispatchQueue for all synthesis calls.
final class KokoroTTSContext {

    /// The loaded Kokoro model.
    private let model: KokoroTTSModel

    /// The active Kokoro voice ID (e.g. "af_heart").
    let voiceID: String

    /// Output sample rate (Kokoro is fixed 24 kHz mono).
    static let sampleRate = 24000

    /// The model is fixed at 128 input tokens / 120 000 output samples (5 s). Keep each
    /// synthesis call comfortably under that so long sentences aren't truncated mid-word.
    private static let maxTokensPerChunk = 64

    /// Result of a single TTS generation for one sentence.
    struct TTSResult {
        let audioSamples: [Float]
        /// Per-word timestamps, sentence-relative (seconds from the start of this sentence).
        let alignedWords: [AlignedWord]
    }

    /// Serial queue for all TTS inference — prevents concurrent CoreML access.
    private static let ttsQueue = DispatchQueue(label: "com.compendus.tts.generation", qos: .userInitiated)

    init(modelDirectory: URL, voiceID: String, computeUnits: MLComputeUnits? = nil) throws {
        logger.info("Loading Kokoro model from \(modelDirectory.path), voice=\(voiceID)")
        let units = computeUnits ?? KokoroTTSContext.preferredComputeUnits()
        self.model = try KokoroTTSModel.fromBundle(directory: modelDirectory, computeUnits: units)
        self.voiceID = voiceID
        logger.info("Kokoro engine ready, voice=\(voiceID)")
    }

    /// Convenience factory using the bundled model + voice catalog index.
    static func createFromBundle(voiceIndex: UInt32) throws -> KokoroTTSContext {
        guard let dir = KokoroModelManager.findModelDirectory() else {
            throw KokoroTTSError.modelNotFound
        }
        let voiceID = KokoroModelManager.voiceID(forIndex: voiceIndex)
        return try KokoroTTSContext(modelDirectory: URL(fileURLWithPath: dir), voiceID: voiceID)
    }

    /// Which CoreML compute units to run the model on.
    ///
    /// On the Simulator, the GPU/ANE compute paths produce numerically invalid output
    /// (NaN/Inf, out-of-range samples) for this model, so force `.cpuOnly` — the only path
    /// that computes correct audio in the Simulator (slow, but correct).
    ///
    /// On device, default to `.all` (Neural Engine). The ANE compiler can produce incorrect
    /// output for this model on some hardware; `kokoro_disable_ane` is the escape hatch.
    private static func preferredComputeUnits() -> MLComputeUnits {
        #if targetEnvironment(simulator)
        return .cpuOnly
        #else
        return UserDefaults.standard.bool(forKey: "kokoro_disable_ane") ? .cpuAndGPU : .all
        #endif
    }

    // MARK: - Generation

    /// Generate speech audio for one sentence with a per-(sub)chunk streaming callback.
    ///
    /// Kokoro is non-autoregressive and capped at ~5 s per call, so a long sentence is
    /// split into sub-chunks at word boundaries; each is synthesized and its samples are
    /// forwarded to `onChunk` immediately (enabling near-instant playback) and accumulated.
    /// Returned word timings are sentence-relative; the caller offsets them to chapter time.
    ///
    /// `onChunk` is invoked on `ttsQueue` — `AVAudioPlayerNode.scheduleBuffer` is
    /// thread-safe so callers can schedule directly from the callback.
    func generateAudioStreaming(
        text: String,
        onChunk: @escaping (_ samples: [Float]) -> Void
    ) async throws -> TTSResult {
        let model = self.model
        let voiceID = self.voiceID

        return try await withCheckedThrowingContinuation { continuation in
            Self.ttsQueue.async {
                do {
                    let parts = Self.splitForSynthesis(text, model: model)
                    var allSamples: [Float] = []
                    var allWords: [AlignedWord] = []
                    var cumulativeSec: Double = 0

                    for part in parts {
                        let (audio, words) = try model.synthesizeWithTimings(text: part, voice: voiceID)
                        guard !audio.isEmpty else { continue }

                        onChunk(audio)
                        allSamples.append(contentsOf: audio)

                        let offset = Float(cumulativeSec)
                        for w in words {
                            allWords.append(AlignedWord(
                                text: w.text,
                                startTime: w.startTime + offset,
                                endTime: w.endTime + offset))
                        }
                        cumulativeSec += Double(audio.count) / Double(Self.sampleRate)
                    }

                    logger.info("Kokoro generated \(allSamples.count) samples, \(allWords.count) words from \(parts.count) chunk(s)")
                    continuation.resume(returning: TTSResult(audioSamples: allSamples, alignedWords: allWords))
                } catch {
                    logger.error("Kokoro generation failed: \(error.localizedDescription)")
                    continuation.resume(throwing: KokoroTTSError.generationFailed(error.localizedDescription))
                }
            }
        }
    }

    // MARK: - Chunking

    /// Split text into sub-chunks whose phoneme-token count each stays within the model's
    /// 5 s / 128-token budget, breaking only at word boundaries.
    private static func splitForSynthesis(_ text: String, model: KokoroTTSModel) -> [String] {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        if model.phonemeTokenCount(for: trimmed) <= maxTokensPerChunk { return [trimmed] }

        let words = trimmed.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        var chunks: [String] = []
        var current: [String] = []

        for word in words {
            let candidate = (current + [word]).joined(separator: " ")
            if !current.isEmpty && model.phonemeTokenCount(for: candidate) > maxTokensPerChunk {
                chunks.append(current.joined(separator: " "))
                current = [word]
            } else {
                current.append(word)
            }
        }
        if !current.isEmpty { chunks.append(current.joined(separator: " ")) }
        return chunks
    }
}
