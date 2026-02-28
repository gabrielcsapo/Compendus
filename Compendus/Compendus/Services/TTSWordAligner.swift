//
//  TTSWordAligner.swift
//  Compendus
//
//  Whisper-based forced alignment for TTS-generated audio.
//  Takes raw 24kHz PCM samples and the original text, runs Whisper
//  to get word-level timestamps, then maps words back to character
//  positions in the source text.
//

import Foundation
import AVFoundation
import os.log

private let logger = Logger(subsystem: "com.compendus.tts", category: "WordAligner")

/// Provides word-level timestamp alignment for TTS-generated audio
/// by running the generated audio through Whisper speech recognition.
actor TTSWordAligner {

    // MARK: - Word Timing Model

    /// A single word with its absolute timestamp and position in the chapter plain text.
    struct WordTiming: Codable, Sendable {
        let word: String
        let start: Double           // absolute time in chapter audio (seconds)
        let end: Double             // absolute time in chapter audio (seconds)
        let plainTextOffset: Int    // character offset in chapter plain text
        let plainTextLength: Int    // character count in chapter plain text
    }

    // MARK: - State

    private var whisperContext: WhisperContext?

    // MARK: - Init

    /// Load the Whisper model. Call once before alignment.
    func loadModel() async throws {
        guard whisperContext == nil else { return }
        guard let modelURL = Bundle.main.url(forResource: "ggml-tiny.en-q8_0", withExtension: "bin") else {
            throw WhisperError.modelNotFound
        }
        whisperContext = try WhisperContext.createContext(path: modelURL.path)
        logger.info("TTSWordAligner: Whisper model loaded")
    }

    // MARK: - Alignment

    /// Align TTS audio to source text, producing word-level timestamps.
    ///
    /// - Parameters:
    ///   - samples: Raw Float32 audio samples at 24kHz mono (from PocketTTS)
    ///   - originalText: The original sentence text (before TTS preprocessing)
    ///   - sentencePlainTextRange: The sentence's NSRange in the chapter plain text
    ///   - timeOffset: Cumulative time offset for this sentence in the chapter
    /// - Returns: Array of `WordTiming` with absolute chapter timing and plain text positions.
    ///            Empty array if alignment fails (callers should fall back to estimation).
    func alignWords(
        samples: [Float],
        originalText: String,
        sentencePlainTextRange: NSRange,
        timeOffset: Double
    ) async -> [WordTiming] {
        guard let ctx = whisperContext else {
            logger.warning("Whisper context not loaded, skipping alignment")
            return []
        }

        guard !samples.isEmpty, !originalText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return []
        }

        // Downsample from 24kHz to 16kHz for Whisper
        let samples16k = downsample24kTo16k(samples)
        guard !samples16k.isEmpty else {
            logger.warning("Downsampling failed, skipping alignment")
            return []
        }

        // Run Whisper transcription with word-level timestamps
        let segments = await ctx.fullTranscribe(samples: samples16k, timeOffset: timeOffset)

        // Collect all Whisper words across segments
        var whisperWords: [(text: String, start: Double, end: Double)] = []
        for segment in segments {
            for word in segment.words {
                let trimmed = word.text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { continue }
                whisperWords.append((text: trimmed, start: word.start, end: word.end))
            }
        }

        guard !whisperWords.isEmpty else {
            logger.info("Whisper returned no words for: \"\(originalText.prefix(60))\"")
            return []
        }

        // Map Whisper words back to character positions in the original text
        return mapWordsToText(
            whisperWords: whisperWords,
            originalText: originalText,
            sentencePlainTextRange: sentencePlainTextRange
        )
    }

    // MARK: - Audio Downsampling

    /// Downsample 24kHz Float32 mono samples to 16kHz for Whisper.
    private func downsample24kTo16k(_ samples: [Float]) -> [Float] {
        let inputSampleRate: Double = 24000
        let outputSampleRate: Double = 16000

        guard let inputFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: inputSampleRate,
            channels: 1,
            interleaved: false
        ) else { return [] }

        guard let outputFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: outputSampleRate,
            channels: 1,
            interleaved: false
        ) else { return [] }

        let frameCount = AVAudioFrameCount(samples.count)
        guard let inputBuffer = AVAudioPCMBuffer(pcmFormat: inputFormat, frameCapacity: frameCount) else { return [] }
        inputBuffer.frameLength = frameCount

        // Copy samples into the input buffer
        let channelData = inputBuffer.floatChannelData![0]
        for i in 0..<Int(frameCount) {
            channelData[i] = samples[i]
        }

        guard let converter = AVAudioConverter(from: inputFormat, to: outputFormat) else { return [] }

        let outputFrameCount = AVAudioFrameCount(Double(frameCount) * outputSampleRate / inputSampleRate)
        guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: outputFrameCount) else { return [] }

        var error: NSError?
        var inputConsumed = false
        converter.convert(to: outputBuffer, error: &error) { _, outStatus in
            if inputConsumed {
                outStatus.pointee = .noDataNow
                return nil
            }
            inputConsumed = true
            outStatus.pointee = .haveData
            return inputBuffer
        }

        if let error = error {
            logger.warning("Downsampling error: \(error)")
            return []
        }

        let outputData = outputBuffer.floatChannelData![0]
        return Array(UnsafeBufferPointer(start: outputData, count: Int(outputBuffer.frameLength)))
    }

    // MARK: - Word-to-Text Mapping

    /// Map Whisper-recognized words back to character positions in the original text.
    /// Uses sequential matching: walks through the original text finding each Whisper word.
    private func mapWordsToText(
        whisperWords: [(text: String, start: Double, end: Double)],
        originalText: String,
        sentencePlainTextRange: NSRange
    ) -> [WordTiming] {
        let nsText = originalText as NSString
        var result: [WordTiming] = []
        var searchStart = 0  // Current search position in originalText

        for wWord in whisperWords {
            let needle = wWord.text.lowercased()
            let remaining = nsText.length - searchStart
            guard remaining > 0 else { break }

            // Search forward in the original text for this word
            let searchRange = NSRange(location: searchStart, length: remaining)
            let foundRange = nsText.range(
                of: wWord.text,
                options: [.caseInsensitive, .diacriticInsensitive],
                range: searchRange
            )

            if foundRange.location != NSNotFound {
                // Found exact match — record position
                let plainTextOffset = sentencePlainTextRange.location + foundRange.location
                result.append(WordTiming(
                    word: nsText.substring(with: foundRange),
                    start: wWord.start,
                    end: wWord.end,
                    plainTextOffset: plainTextOffset,
                    plainTextLength: foundRange.length
                ))
                searchStart = foundRange.location + foundRange.length
            } else {
                // Try fuzzy match: find the next word in text that starts with similar characters
                let words = splitOriginalTextIntoWords(nsText, from: searchStart)
                if let match = findBestMatch(needle: needle, candidates: words) {
                    let plainTextOffset = sentencePlainTextRange.location + match.range.location
                    result.append(WordTiming(
                        word: nsText.substring(with: match.range),
                        start: wWord.start,
                        end: wWord.end,
                        plainTextOffset: plainTextOffset,
                        plainTextLength: match.range.length
                    ))
                    searchStart = match.range.location + match.range.length
                }
                // If no match found, skip this Whisper word
            }
        }

        return result
    }

    /// Split text into word ranges from a given starting position.
    private func splitOriginalTextIntoWords(_ text: NSString, from start: Int) -> [(word: String, range: NSRange)] {
        var results: [(word: String, range: NSRange)] = []
        let length = text.length
        var i = start

        // Skip leading whitespace
        while i < length {
            let c = text.character(at: i)
            if CharacterSet.whitespacesAndNewlines.contains(Unicode.Scalar(c)!) {
                i += 1
            } else {
                break
            }
        }

        var wordStart = i
        while i <= length {
            let isEnd = i == length
            let isSpace = !isEnd && CharacterSet.whitespacesAndNewlines.contains(Unicode.Scalar(text.character(at: i))!)

            if isEnd || isSpace {
                if i > wordStart {
                    let range = NSRange(location: wordStart, length: i - wordStart)
                    results.append((word: text.substring(with: range), range: range))
                    // Only return first ~20 words for fuzzy search efficiency
                    if results.count >= 20 { break }
                }
                wordStart = i + 1
            }
            i += 1
        }

        return results
    }

    /// Find the best matching candidate for a Whisper word using prefix/edit distance.
    private func findBestMatch(
        needle: String,
        candidates: [(word: String, range: NSRange)]
    ) -> (word: String, range: NSRange)? {
        // Prefer exact case-insensitive match
        if let exact = candidates.first(where: { $0.word.lowercased() == needle }) {
            return exact
        }
        // Try prefix match (Whisper sometimes truncates)
        if let prefix = candidates.first(where: {
            $0.word.lowercased().hasPrefix(needle) || needle.hasPrefix($0.word.lowercased())
        }) {
            return prefix
        }
        // Take the first candidate if it's reasonably close
        if let first = candidates.first,
           levenshteinDistance(first.word.lowercased(), needle) <= 3 {
            return first
        }
        return nil
    }

    /// Simple Levenshtein distance for fuzzy word matching.
    private func levenshteinDistance(_ a: String, _ b: String) -> Int {
        let aChars = Array(a)
        let bChars = Array(b)
        let m = aChars.count
        let n = bChars.count

        if m == 0 { return n }
        if n == 0 { return m }

        var prev = Array(0...n)
        var curr = [Int](repeating: 0, count: n + 1)

        for i in 1...m {
            curr[0] = i
            for j in 1...n {
                let cost = aChars[i - 1] == bChars[j - 1] ? 0 : 1
                curr[j] = min(
                    prev[j] + 1,       // deletion
                    curr[j - 1] + 1,   // insertion
                    prev[j - 1] + cost // substitution
                )
            }
            prev = curr
        }

        return curr[n]
    }
}
