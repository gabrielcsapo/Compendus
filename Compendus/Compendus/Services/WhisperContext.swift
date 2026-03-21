//
//  WhisperContext.swift
//  Compendus
//
//  Swift wrapper around whisper.cpp C API with segment and
//  token-level timestamps for karaoke-style lyrics display.
//

import Foundation
import whisper
import EPUBReader

enum WhisperError: Error, LocalizedError {
    case couldNotInitializeContext
    case modelNotFound

    var errorDescription: String? {
        switch self {
        case .couldNotInitializeContext: return "Failed to initialize whisper model"
        case .modelNotFound: return "Whisper model file not found"
        }
    }
}

/// Thread-safe wrapper around a whisper.cpp context.
/// All access is serialised through the actor.
actor WhisperContext {
    private var context: OpaquePointer

    init(context: OpaquePointer) {
        self.context = context
    }

    deinit {
        whisper_free(context)
    }

    // MARK: - Factory

    static func createContext(path: String) throws -> WhisperContext {
        var params = whisper_context_default_params()
        #if targetEnvironment(simulator)
        params.use_gpu = false
        #endif
        guard let ctx = whisper_init_from_file_with_params(path, params) else {
            throw WhisperError.couldNotInitializeContext
        }
        return WhisperContext(context: ctx)
    }

    // MARK: - Transcription

    /// Result of a single whisper segment with word-level timing.
    struct Segment {
        let start: Double   // seconds
        let end: Double     // seconds
        let text: String
        let words: [Word]
    }

    struct Word {
        let text: String
        let start: Double   // seconds
        let end: Double     // seconds
    }

    /// Run full transcription on 16 kHz mono Float samples.
    /// Returns segments with word-level timestamps.
    func fullTranscribe(samples: [Float], timeOffset: Double = 0) -> [Segment] {
        let maxThreads = max(1, min(8, ProcessInfo.processInfo.processorCount - 2))
        var params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY)

        "en".withCString { en in
            params.print_realtime   = false
            params.print_progress   = false
            params.print_timestamps = false
            params.print_special    = false
            params.translate        = false
            params.language         = en
            params.n_threads        = Int32(maxThreads)
            params.offset_ms        = 0
            params.no_context       = true
            params.single_segment   = false
            params.token_timestamps = true
            params.no_timestamps    = false
            // thold_pt controls minimum token probability for timestamps
            params.thold_pt         = 0.01

            samples.withUnsafeBufferPointer { buf in
                if whisper_full(context, params, buf.baseAddress, Int32(buf.count)) != 0 {
                    print("[Whisper] Failed to run model")
                }
            }
        }

        return extractSegments(timeOffset: timeOffset)
    }

    // MARK: - Result Extraction

    private func extractSegments(timeOffset: Double) -> [Segment] {
        let nSegments = whisper_full_n_segments(context)
        var segments: [Segment] = []

        for i in 0..<nSegments {
            // Segment-level timestamps (centiseconds → seconds)
            let t0 = Double(whisper_full_get_segment_t0(context, i)) / 100.0 + timeOffset
            let t1 = Double(whisper_full_get_segment_t1(context, i)) / 100.0 + timeOffset
            let text = String(cString: whisper_full_get_segment_text(context, i))
                .trimmingCharacters(in: .whitespaces)

            // Token-level words
            let nTokens = whisper_full_n_tokens(context, i)
            var words: [Word] = []

            for j in 0..<nTokens {
                let tokenData = whisper_full_get_token_data(context, i, j)
                guard let cText = whisper_full_get_token_text(context, i, j) else { continue }
                let tokenText = String(cString: cText)

                // Skip special tokens (e.g. [_BEG_], [_SOT_], timestamps)
                if tokenData.id >= whisper_token_eot(context) { continue }
                let trimmed = tokenText.trimmingCharacters(in: .whitespaces)
                if trimmed.isEmpty { continue }

                let wStart = Double(tokenData.t0) / 100.0 + timeOffset
                let wEnd = Double(tokenData.t1) / 100.0 + timeOffset

                words.append(Word(text: trimmed, start: wStart, end: wEnd))
            }

            if !text.isEmpty {
                segments.append(Segment(start: t0, end: t1, text: text, words: words))
            }
        }

        return segments
    }
}
