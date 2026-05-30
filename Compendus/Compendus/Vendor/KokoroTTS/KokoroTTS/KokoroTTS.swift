import CoreML
import Foundation
import os

/// Kokoro-82M text-to-speech — CoreML-based, runs on Neural Engine.
///
/// Lightweight (82M params) non-autoregressive TTS model.
/// Supports 10 languages with 54 preset voices. Designed for iOS/iPad deployment.
///
/// Uses an end-to-end CoreML model (`kokoro_5s.mlmodelc`) that runs the full
/// pipeline (BERT → duration → alignment → prosody → decoder) in one call.
///
/// ```swift
/// let tts = try await KokoroTTSModel.fromPretrained()
/// let audio = try tts.synthesize(text: "Hello world", voice: "af_heart")
/// ```
public final class KokoroTTSModel {

    /// Default HuggingFace model ID.
    public static let defaultModelId = "aufklarer/Kokoro-82M-CoreML"
    /// Default voice preset.
    public static let defaultVoice = "af_heart"
    /// Output sample rate.
    public static let outputSampleRate = 24000

    let config: KokoroConfig
    var network: KokoroNetwork?
    let phonemizer: KokoroPhonemizer
    var voiceEmbeddings: [String: [Float]]

    var _isLoaded: Bool { network != nil }

    init(config: KokoroConfig, network: KokoroNetwork, phonemizer: KokoroPhonemizer, voiceEmbeddings: [String: [Float]]) {
        self.config = config
        self.network = network
        self.phonemizer = phonemizer
        self.voiceEmbeddings = voiceEmbeddings
    }

    // MARK: - Synthesis

    /// Synthesize speech from text.
    public func synthesize(
        text: String,
        voice: String = "af_heart",
        language: String = "en",
        speed: Float = 1.0
    ) throws -> [Float] {
        try synthesizeCore(text: text, voice: voice, language: language, speed: speed).audio
    }

    /// Synthesize speech and return real per-word timestamps derived from the model's
    /// `pred_dur` (per-token duration) output.
    ///
    /// The E2E CoreML model already predicts a frame count for every phoneme token and
    /// exposes it as `pred_dur`; `synthesize()` discards it. Here we keep it, convert
    /// frame counts to seconds (self-calibrating against the produced audio length), and
    /// group phoneme tokens into words at the phonemizer's whitespace boundaries. Words
    /// are zipped to the source text's whitespace-words by index (both are in source order).
    public func synthesizeWithTimings(
        text: String,
        voice: String = "af_heart",
        language: String = "en",
        speed: Float = 1.0
    ) throws -> (audio: [Float], words: [AlignedWord]) {
        let core = try synthesizeCore(text: text, voice: voice, language: language, speed: speed)
        let words = alignedWords(from: core, sourceText: text)
        return (core.audio, words)
    }

    /// Internal synthesis result carrying everything needed for both audio-only and
    /// timestamped callers.
    private struct CoreSynthesis {
        let audio: [Float]                              // trimmed PCM, 24 kHz mono
        let validSamples: Int                           // length before trim
        let speechEnd: Int                              // sample index where real speech ends
        let tokenDurations: [Float]                     // pred_dur per token (valid tokens)
        let wordSpans: [KokoroPhonemizer.PhonemeWordSpan]
    }

    private func synthesizeCore(
        text: String, voice: String, language: String, speed: Float
    ) throws -> CoreSynthesis {
        guard _isLoaded, let network else {
            throw AudioModelError.inferenceFailed(
                operation: "kokoro-synthesize", reason: "Model not loaded")
        }

        let (tokenIds, wordSpans) = phonemizer.tokenizeWithWordSpans(
            text, maxLength: config.maxPhonemeLength, language: language)
        let tokenCount = min(tokenIds.count, 128)

        guard let styleVector = voiceEmbeddings[voice] else {
            let available = Array(voiceEmbeddings.keys).sorted().prefix(5)
            throw AudioModelError.voiceNotFound(
                voice: voice,
                searchPath: "Available: \(available.joined(separator: ", "))...")
        }

        let padTo = 128
        let paddedIds = phonemizer.pad(Array(tokenIds.prefix(padTo)), to: padTo)

        let inputIds = try createInt32Array(shape: [1, padTo], values: paddedIds.map { Int32($0) })
        let maskArray = try createInt32Array(shape: [1, padTo], values: (0..<padTo).map { Int32($0 < tokenCount ? 1 : 0) })
        let refS = try createFloatArray(shape: [1, config.styleDim], values: styleVector)
        let speedArray = try createFloatArray(shape: [1], values: [speed])

        let t0 = CFAbsoluteTimeGetCurrent()
        let result = try network.predictE2E(inputIds: inputIds, attentionMask: maskArray, refS: refS, speed: speedArray)
        let elapsed = CFAbsoluteTimeGetCurrent() - t0

        let validSamples = min(result.audioLengthSamples, result.audio.count)
        guard validSamples > 0 else {
            return CoreSynthesis(audio: [], validSamples: 0, speechEnd: 0, tokenDurations: [], wordSpans: [])
        }

        var audio = [Float](repeating: 0, count: validSamples)
        if result.audio.dataType == .float16 {
            let ptr = result.audio.dataPointer.bindMemory(to: Float16.self, capacity: validSamples)
            for i in 0..<validSamples { audio[i] = Float(ptr[i]) }
        } else {
            let ptr = result.audio.dataPointer.bindMemory(to: Float.self, capacity: validSamples)
            for i in 0..<validSamples { audio[i] = ptr[i] }
        }

        // Kokoro's E2E model often emits 100–300 ms of trailing artifacts
        // past the real speech (random low-energy noise + an occasional
        // loud-spike click, observed on iPhone playback). Find where real
        // speech actually ended by walking backwards through 10 ms windows
        // and locating the last window above a silence-energy threshold —
        // then zero everything past that, plus a short ramp-down on the
        // last few ms of real speech to avoid a click at the new boundary.
        // Use a 50 ms window with a higher silence floor and require the
        // window to be SUSTAINED above threshold — Kokoro's trailing
        // artifacts are often a single 10–20 ms spike with low surrounding
        // energy, so a tight short window otherwise mistakes them for
        // speech. Real speech tails consistently above ~0.03 RMS over a
        // 50 ms span; isolated artifact spikes don't.
        let win = max(1, Int(0.050 * Double(config.sampleRate)))
        let silenceRMS: Float = 0.030
        var speechEnd = validSamples
        var i = validSamples - win
        while i > 0 {
            var sumSq: Float = 0
            for j in 0..<win { let v = audio[i + j]; sumSq += v * v }
            let rms = sqrt(sumSq / Float(win))
            if rms > silenceRMS { speechEnd = i + win; break }
            i -= win / 2  // 50 % overlap so we don't miss a window boundary
        }
        // Zero the trailing artifact region.
        if speechEnd < validSamples {
            for k in speechEnd..<validSamples { audio[k] = 0 }
        }
        // Linear fade-out on the last ~10 ms of the kept signal so the
        // boundary between speech and the silenced region is also smooth.
        let fadeSamples = min(speechEnd, Int(0.010 * Double(config.sampleRate)))
        if fadeSamples >= 2 {
            let start = speechEnd - fadeSamples
            let denom = Float(fadeSamples - 1)
            for k in 0..<fadeSamples {
                let gain = Float(fadeSamples - 1 - k) / denom
                audio[start + k] *= gain
            }
        }

        let durations = readDurations(result.predDur, count: tokenCount)

        let duration = Double(validSamples) / Double(config.sampleRate)
        let elapsedMs = elapsed * 1000
        AudioLog.inference.info("Kokoro E2E: \(tokenCount) tokens → \(validSamples) samples (\(String(format: "%.1f", duration))s) in \(String(format: "%.0f", elapsedMs))ms")

        return CoreSynthesis(
            audio: audio, validSamples: validSamples, speechEnd: speechEnd,
            tokenDurations: durations, wordSpans: wordSpans)
    }

    /// Read per-token durations (`pred_dur`) into a Float array, handling the tensor dtype.
    private func readDurations(_ arr: MLMultiArray, count: Int) -> [Float] {
        let n = min(count, arr.count)
        guard n > 0 else { return [] }
        var out = [Float](repeating: 0, count: n)
        switch arr.dataType {
        case .float16:
            let p = arr.dataPointer.bindMemory(to: Float16.self, capacity: arr.count)
            for i in 0..<n { out[i] = Float(p[i]) }
        case .int32:
            let p = arr.dataPointer.bindMemory(to: Int32.self, capacity: arr.count)
            for i in 0..<n { out[i] = Float(p[i]) }
        default:
            let p = arr.dataPointer.bindMemory(to: Float.self, capacity: arr.count)
            for i in 0..<n { out[i] = p[i] }
        }
        return out
    }

    /// Convert per-token durations + word spans into per-word timestamps.
    /// Times are self-calibrated: total frames map linearly onto the produced audio
    /// length, then clamped to the post-trim speech end so words don't overhang silence.
    private func alignedWords(from core: CoreSynthesis, sourceText: String) -> [AlignedWord] {
        let durations = core.tokenDurations
        let tokenCount = durations.count
        guard tokenCount > 0, core.validSamples > 0 else { return [] }

        let totalFrames = durations.reduce(0, +)
        guard totalFrames > 0 else { return [] }

        let fullDurationSec = Double(core.validSamples) / Double(config.sampleRate)
        let secPerFrame = fullDurationSec / Double(totalFrames)
        let speechEndSec = Double(core.speechEnd) / Double(config.sampleRate)

        // Prefix sums of frame counts for O(1) span lookups.
        var prefix = [Double](repeating: 0, count: tokenCount + 1)
        for i in 0..<tokenCount { prefix[i + 1] = prefix[i] + Double(durations[i]) }

        // Source words in order — zipped to phoneme word spans by index.
        let sourceWords = sourceText.split(whereSeparator: { $0.isWhitespace }).map(String.init)

        var words: [AlignedWord] = []
        words.reserveCapacity(core.wordSpans.count)
        for (idx, span) in core.wordSpans.enumerated() {
            let s = min(span.tokenStart, tokenCount)
            let e = min(span.tokenEnd, tokenCount)
            guard e > s else { continue }
            var start = prefix[s] * secPerFrame
            var end = prefix[e] * secPerFrame
            start = min(max(start, 0), speechEndSec)
            end = min(max(end, start), speechEndSec)
            let label = idx < sourceWords.count ? sourceWords[idx] : ""
            words.append(AlignedWord(text: label, startTime: Float(start), endTime: Float(end)))
        }
        return words
    }

    /// List available voice presets.
    public var availableVoices: [String] {
        Array(voiceEmbeddings.keys).sorted()
    }

    /// Number of phoneme tokens (including BOS/EOS) the given text would produce.
    /// Used by callers to split text so each synthesis call stays within the model's
    /// fixed 128-token / 5-second (120 000-sample) input/output budget.
    public func phonemeTokenCount(for text: String, language: String = "en") -> Int {
        phonemizer.tokenize(text, maxLength: Int.max, language: language).count
    }

    // MARK: - Helpers

    private func createInt32Array(shape: [Int], values: [Int32]) throws -> MLMultiArray {
        let arr = try MLMultiArray(shape: shape.map { $0 as NSNumber }, dataType: .int32)
        let ptr = arr.dataPointer.assumingMemoryBound(to: Int32.self)
        for i in 0..<values.count { ptr[i] = values[i] }
        return arr
    }

    private func createFloatArray(shape: [Int], values: [Float]) throws -> MLMultiArray {
        let arr = try MLMultiArray(shape: shape.map { $0 as NSNumber }, dataType: .float32)
        let ptr = arr.dataPointer.assumingMemoryBound(to: Float.self)
        for i in 0..<values.count { ptr[i] = values[i] }
        return arr
    }

    // MARK: - Warmup

    /// Warm up CoreML model by running a dummy inference.
    public func warmUp() throws {
        _ = try? synthesize(text: "hello", voice: availableVoices.first ?? "af_heart")
    }

    // MARK: - Model Loading

    /// Load the Kokoro model from a local directory (the app bundle's `KokoroModel/`).
    ///
    /// This is the Compendus-vendored loader: all assets are bundled, so there is no
    /// network download (the upstream `fromPretrained` + `HuggingFaceDownloader` path
    /// was removed). The `directory` must contain `kokoro_5s.mlmodelc`,
    /// `G2PEncoder/Decoder.mlmodelc`, `vocab_index.json`, `g2p_vocab.json`,
    /// `us_gold.json`, `us_silver.json`, and `voices/*.json`.
    ///
    /// - Parameter computeUnits: Which hardware the main CoreML model runs on.
    ///   Defaults to `.all` (Neural Engine preferred). Pass `.cpuAndGPU` to bypass
    ///   the Neural Engine — useful as a fallback on platforms where the ANE
    ///   compiler produces incorrect output for this model.
    public static func fromBundle(
        directory: URL,
        computeUnits: MLComputeUnits = .all
    ) throws -> KokoroTTSModel {
        AudioLog.modelLoading.info("Loading bundled Kokoro model from \(directory.path)")

        // Load vocabulary
        let vocabURL = directory.appendingPathComponent("vocab_index.json")
        guard FileManager.default.fileExists(atPath: vocabURL.path) else {
            throw AudioModelError.modelLoadFailed(
                modelId: "kokoro", reason: "vocab_index.json not found in \(directory.path)")
        }
        let phonemizer = try KokoroPhonemizer.loadVocab(from: vocabURL)
        try phonemizer.loadDictionaries(from: directory)

        // Load G2P models
        let g2pEncoderURL = directory.appendingPathComponent("G2PEncoder.mlmodelc", isDirectory: true)
        let g2pDecoderURL = directory.appendingPathComponent("G2PDecoder.mlmodelc", isDirectory: true)
        let g2pVocabURL = directory.appendingPathComponent("g2p_vocab.json")
        if FileManager.default.fileExists(atPath: g2pEncoderURL.path) &&
           FileManager.default.fileExists(atPath: g2pDecoderURL.path) {
            try phonemizer.loadG2PModels(
                encoderURL: g2pEncoderURL, decoderURL: g2pDecoderURL, vocabURL: g2pVocabURL)
            AudioLog.modelLoading.debug("Loaded CoreML G2P encoder + decoder")
        }

        // Load voice embeddings
        var voiceEmbeddings = [String: [Float]]()
        let voicesDir = directory.appendingPathComponent("voices")
        if FileManager.default.fileExists(atPath: voicesDir.path) {
            let files = try FileManager.default.contentsOfDirectory(at: voicesDir, includingPropertiesForKeys: nil)
            for file in files where file.pathExtension == "json" {
                let voiceName = file.deletingPathExtension().lastPathComponent
                if let embedding = try? loadVoiceEmbedding(from: file, styleDim: KokoroConfig.default.styleDim) {
                    voiceEmbeddings[voiceName] = embedding
                }
            }
            AudioLog.modelLoading.debug("Loaded \(voiceEmbeddings.count) voice presets")
        }

        // Load E2E CoreML model
        let network = try KokoroNetwork(directory: directory, computeUnits: computeUnits)
        AudioLog.modelLoading.debug("Loaded Kokoro E2E model")
        AudioLog.modelLoading.info("Kokoro model loaded successfully")

        return KokoroTTSModel(
            config: .default, network: network,
            phonemizer: phonemizer, voiceEmbeddings: voiceEmbeddings)
    }

    /// Load voice embedding from JSON file.
    private static func loadVoiceEmbedding(from url: URL, styleDim: Int) throws -> [Float] {
        let data = try Data(contentsOf: url)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let embedding = json["embedding"] as? [Double] else { return [] }
        return embedding.prefix(styleDim).map { Float($0) }
    }
}
