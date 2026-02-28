//
//  TTSTranscriptBuilder.swift
//  Compendus
//
//  Converts TTS sentence spans into Transcript-compatible data
//  with estimated word-level timing, unifying the output format
//  across transcription and PocketTTS generation.
//

import Foundation

enum TTSTranscriptBuilder {

    /// Convert completed TTS sentence spans into a Transcript.
    /// Each span becomes a TranscriptSegment with estimated word-level timing.
    static func buildTranscript(
        from sentences: [TextProcessingUtils.SentenceSpan],
        language: String = "en"
    ) -> Transcript {
        var segments: [TranscriptSegment] = []
        for sentence in sentences {
            guard sentence.audioEndTime > sentence.audioStartTime else { continue }
            let words: [TranscriptWord]
            if !sentence.wordTimings.isEmpty {
                // Use word-level timestamps
                words = sentence.wordTimings.map {
                    TranscriptWord(word: $0.word, start: $0.start, end: $0.end)
                }
            } else {
                // Fall back to proportional estimation
                words = estimateWordTimings(
                    sentence: sentence.text,
                    startTime: sentence.audioStartTime,
                    endTime: sentence.audioEndTime
                )
            }
            segments.append(TranscriptSegment(
                start: sentence.audioStartTime,
                end: sentence.audioEndTime,
                text: sentence.text,
                words: words
            ))
        }
        let duration = sentences.last?.audioEndTime ?? 0
        return Transcript(duration: duration, language: language, segments: segments)
    }

    /// Build a transcript from multiple chapters worth of sentence spans.
    /// Each chapter's spans should have timing relative to the chapter start;
    /// this method offsets them to be cumulative across chapters.
    static func buildFullBookTranscript(
        chapters: [[TextProcessingUtils.SentenceSpan]],
        language: String = "en"
    ) -> Transcript {
        var allSegments: [TranscriptSegment] = []
        var cumulativeOffset: Double = 0

        for chapterSentences in chapters {
            for sentence in chapterSentences {
                guard sentence.audioEndTime > sentence.audioStartTime else { continue }
                let words: [TranscriptWord]
                if !sentence.wordTimings.isEmpty {
                    words = sentence.wordTimings.map {
                        TranscriptWord(
                            word: $0.word,
                            start: $0.start + cumulativeOffset,
                            end: $0.end + cumulativeOffset
                        )
                    }
                } else {
                    words = estimateWordTimings(
                        sentence: sentence.text,
                        startTime: cumulativeOffset + sentence.audioStartTime,
                        endTime: cumulativeOffset + sentence.audioEndTime
                    )
                }
                allSegments.append(TranscriptSegment(
                    start: cumulativeOffset + sentence.audioStartTime,
                    end: cumulativeOffset + sentence.audioEndTime,
                    text: sentence.text,
                    words: words
                ))
            }
            if let lastEnd = chapterSentences.last?.audioEndTime {
                cumulativeOffset += lastEnd
            }
        }

        return Transcript(
            duration: cumulativeOffset,
            language: language,
            segments: allSegments
        )
    }

    /// Estimate word-level timing by distributing the sentence duration
    /// proportionally by character count. Longer words take more time.
    static func estimateWordTimings(
        sentence: String,
        startTime: Double,
        endTime: Double
    ) -> [TranscriptWord] {
        let words = sentence.split(whereSeparator: { $0.isWhitespace })
        guard !words.isEmpty else { return [] }

        let totalDuration = endTime - startTime
        guard totalDuration > 0 else { return [] }

        let totalChars = words.reduce(0) { $0 + $1.count }
        guard totalChars > 0 else { return [] }

        var result: [TranscriptWord] = []
        var currentTime = startTime

        for word in words {
            let fraction = Double(word.count) / Double(totalChars)
            let wordDuration = totalDuration * fraction
            result.append(TranscriptWord(
                word: String(word),
                start: currentTime,
                end: currentTime + wordDuration
            ))
            currentTime += wordDuration
        }

        // Snap the last word's end time to avoid floating point drift
        if var last = result.last {
            last = TranscriptWord(word: last.word, start: last.start, end: endTime)
            result[result.count - 1] = last
        }

        return result
    }
}
