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
            consistencySteps: 4,
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

    /// Generate speech audio from text.
    /// Runs on a serial DispatchQueue to prevent concurrent access.
    /// Returns raw Float samples (24kHz mono) extracted from the WAV output.
    func generateAudio(text: String, speed: Float = 1.0) async throws -> TTSResult {
        let engine = self.engine

        return try await withCheckedThrowingContinuation { continuation in
            Self.ttsQueue.async {
                do {
                    let result = try engine.synthesize(text: text)
                    let samples = Self.extractSamplesFromWav(result.audioData)
                    continuation.resume(returning: TTSResult(audioSamples: samples))
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    // MARK: - WAV Parsing

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
