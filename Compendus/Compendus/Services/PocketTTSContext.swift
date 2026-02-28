//
//  PocketTTSContext.swift
//  Compendus
//
//  Wrapper around PocketTtsEngine for iOS read-along integration.
//  Provides a simple async API that returns raw audio samples
//  compatible with AVAudioPlayerNode scheduling.
//

import Foundation
import os.log

private let logger = Logger(subsystem: "com.compendus.tts", category: "PocketTTSContext")

enum PocketTTSError: Error, LocalizedError {
    case modelNotFound
    case generationFailed(String)

    var errorDescription: String? {
        switch self {
        case .modelNotFound: return "PocketTTS model not found in bundle"
        case .generationFailed(let msg): return "TTS generation failed: \(msg)"
        }
    }
}

/// Manages PocketTTS engine and audio generation.
/// Thread-safe via serial DispatchQueue for all synthesis calls.
final class PocketTTSContext {
    /// The PocketTTS engine instance.
    let engine: PocketTtsEngine

    /// The active voice index (0-7).
    private(set) var activeVoiceIndex: UInt32

    /// Result of a single TTS generation.
    struct TTSResult {
        let audioSamples: [Float]
    }

    /// Serial queue for all TTS inference — prevents concurrent access.
    private static let ttsQueue = DispatchQueue(label: "com.compendus.tts.generation", qos: .userInitiated)

    init(modelPath: String, voiceIndex: UInt32, speed: Float = 1.0) throws {
        logger.info("Loading PocketTTS model from \(modelPath)")
        self.engine = try PocketTtsEngine(modelPath: modelPath)
        self.activeVoiceIndex = voiceIndex

        let config = TtsConfig(
            voiceIndex: voiceIndex,
            temperature: 0.55,
            topP: 0.85,
            speed: speed,
            consistencySteps: 2,
            useFixedSeed: false,
            seed: 42
        )
        try engine.configure(config: config)
        logger.info("PocketTTS engine ready, voice=\(voiceIndex)")
    }

    /// Convenience factory using bundle resource paths.
    static func createFromBundle(voiceIndex: UInt32) throws -> PocketTTSContext {
        guard let modelPath = PocketTTSModelManager.findModelDirectory() else {
            throw PocketTTSError.modelNotFound
        }
        return try PocketTTSContext(modelPath: modelPath, voiceIndex: voiceIndex)
    }

    // MARK: - Generation

    /// Generate speech audio with per-chunk streaming callback.
    /// Each audio chunk is forwarded to `onChunk` as it arrives from the Mimi decoder,
    /// enabling immediate playback scheduling. Also collects all samples for caching.
    /// The `onChunk` callback is called on `ttsQueue` — AVAudioPlayerNode.scheduleBuffer
    /// is thread-safe so callers can schedule directly from the callback.
    func generateAudioStreaming(
        text: String,
        onChunk: @escaping (_ samples: [Float]) -> Void
    ) async throws -> TTSResult {
        let engine = self.engine

        return try await withCheckedThrowingContinuation { continuation in
            Self.ttsQueue.async {
                let handler = StreamingPlaybackHandler(onChunk: onChunk)
                do {
                    logger.info("startTrueStreaming begin for: \"\(text.prefix(60))\"")
                    try engine.startTrueStreaming(text: text, handler: handler)
                    logger.info("startTrueStreaming returned: \(handler.collectedSamples.count) total samples, error=\(handler.error ?? "none")")
                    if let error = handler.error {
                        continuation.resume(throwing: PocketTTSError.generationFailed(error))
                    } else {
                        continuation.resume(returning: TTSResult(audioSamples: handler.collectedSamples))
                    }
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    /// Collects audio chunks AND forwards each to a callback for immediate playback.
    private class StreamingPlaybackHandler: TtsEventHandler {
        private(set) var collectedSamples: [Float] = []
        private(set) var error: String?
        private let onChunk: ([Float]) -> Void
        private var chunkCount = 0

        init(onChunk: @escaping ([Float]) -> Void) {
            self.onChunk = onChunk
        }

        func onAudioChunk(chunk: AudioChunk) {
            chunkCount += 1
            let data = chunk.audioData
            let header = data.prefix(4).map { String(format: "%02X", $0) }.joined(separator: " ")
            logger.info("onAudioChunk[\(self.chunkCount)]: \(data.count) bytes, sampleRate=\(chunk.sampleRate), isFinal=\(chunk.isFinal), header=\(header)")

            let samples = PocketTTSContext.extractSamples(from: data)
            logger.info("onAudioChunk[\(self.chunkCount)]: extracted \(samples.count) samples")

            if !samples.isEmpty {
                collectedSamples.append(contentsOf: samples)
                onChunk(samples)
            }
        }

        func onProgress(progress: Float) {
            logger.info("onProgress: \(progress)")
        }

        func onComplete() {
            logger.info("onComplete: total collected \(self.collectedSamples.count) samples from \(self.chunkCount) chunks")
        }

        func onError(message: String) {
            logger.error("onError: \(message)")
            error = message
        }
    }

    // MARK: - Audio Parsing

    /// Extract float32 samples from audio data (WAV or raw float32 PCM).
    /// Tries WAV parsing first; falls back to raw float32 PCM (Mimi decoder output).
    static func extractSamples(from data: Data) -> [Float] {
        guard !data.isEmpty else { return [] }

        // Check for RIFF/WAV header
        if data.count > 44,
           let magic = String(data: data.prefix(4), encoding: .ascii),
           magic == "RIFF" {
            return extractSamplesFromWav(data)
        }

        // Raw float32 PCM from Mimi decoder (24kHz mono)
        let sampleCount = data.count / MemoryLayout<Float>.size
        guard sampleCount > 0 else { return [] }
        var samples = [Float](repeating: 0, count: sampleCount)
        data.withUnsafeBytes { rawBuffer in
            let floatBuffer = rawBuffer.bindMemory(to: Float.self)
            for i in 0..<sampleCount {
                samples[i] = floatBuffer[i]
            }
        }
        logger.info("extractSamples: raw float32 PCM, \(sampleCount) samples from \(data.count) bytes, first few: [\(samples.prefix(4).map { String(format: "%.4f", $0) }.joined(separator: ", "))]")
        return samples
    }

    /// Extract raw float32 samples from WAV data.
    /// PocketTTS outputs 24kHz mono 16-bit integer PCM WAV.
    /// We convert Int16 samples to Float32 [-1.0, 1.0] for AVAudioPlayerNode.
    private static func extractSamplesFromWav(_ data: Data) -> [Float] {
        guard data.count > 44 else { return [] }

        // Find the "data" chunk (may not be at fixed offset)
        var dataOffset = 12  // Start after "RIFF" + size + "WAVE"
        while dataOffset < data.count - 8 {
            let chunkId = String(data: data.subdata(in: dataOffset..<dataOffset+4), encoding: .ascii) ?? ""
            let chunkSize = data.subdata(in: dataOffset+4..<dataOffset+8).withUnsafeBytes {
                $0.load(as: UInt32.self).littleEndian
            }

            if chunkId == "data" {
                let sampleDataOffset = dataOffset + 8
                let end = min(sampleDataOffset + Int(chunkSize), data.count)
                let sampleData = data.subdata(in: sampleDataOffset..<end)

                // Int16 PCM: 2 bytes per sample
                let sampleCount = sampleData.count / MemoryLayout<Int16>.size
                var samples = [Float](repeating: 0, count: sampleCount)
                sampleData.withUnsafeBytes { rawBuffer in
                    let int16Buffer = rawBuffer.bindMemory(to: Int16.self)
                    for i in 0..<sampleCount {
                        samples[i] = Float(int16Buffer[i]) / 32767.0
                    }
                }
                return samples
            }

            dataOffset += 8 + Int(chunkSize)
        }

        return []
    }
}
