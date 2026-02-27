//
//  TextProcessingUtils.swift
//  Compendus
//
//  Shared text processing utilities for TTS sentence splitting
//  and preprocessing. Used by ReadAlongService and TTSPreGenerationService.
//

import Foundation
import NaturalLanguage

enum TextProcessingUtils {

    /// A span of text corresponding to one sentence (or sub-sentence chunk)
    /// with its position in the chapter's plain text and optional audio timing.
    struct SentenceSpan {
        let text: String
        let plainTextRange: NSRange
        var audioStartTime: Double = 0  // cumulative start within chapter
        var audioEndTime: Double = 0    // cumulative end within chapter
    }

    /// Maximum characters per TTS chunk. PocketTTS handles longer sequences but
    /// we chunk for sentence-level highlighting and streaming playback.
    static let maxCharsPerChunk = 500

    /// Split text into sentence spans using NLTokenizer.
    /// Long sentences are further split at clause boundaries.
    static func sentencize(_ text: String, maxChunkSize: Int = maxCharsPerChunk) -> [SentenceSpan] {
        let tokenizer = NLTokenizer(unit: .sentence)
        tokenizer.string = text
        let nsText = text as NSString

        var spans: [SentenceSpan] = []
        tokenizer.enumerateTokens(in: text.startIndex..<text.endIndex) { range, _ in
            let nsRange = NSRange(range, in: text)
            let sentenceText = nsText.substring(with: nsRange)
            let trimmed = sentenceText.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                if trimmed.count > maxChunkSize {
                    spans.append(contentsOf: splitLongSentence(trimmed, baseRange: nsRange, maxChunkSize: maxChunkSize))
                } else {
                    spans.append(SentenceSpan(text: trimmed, plainTextRange: nsRange))
                }
            }
            return true
        }

        return spans
    }

    /// Split a long sentence at clause boundaries to keep each chunk under maxChunkSize.
    /// Tries semicolons first, then commas/colons, then conjunctions, then mid-point whitespace.
    static func splitLongSentence(_ text: String, baseRange: NSRange, maxChunkSize: Int = maxCharsPerChunk) -> [SentenceSpan] {
        guard text.count > maxChunkSize else {
            return [SentenceSpan(text: text, plainTextRange: baseRange)]
        }

        let clausePatterns = [
            "(?<=;)\\s+",
            "(?<=,)\\s+",
            "(?<=:)\\s+",
            "\\s+(?=\\b(?:and|but|or|yet|so|which|that|because|although|while|when|where|if)\\b)"
        ]

        for pattern in clausePatterns {
            let parts = splitByPattern(text, pattern: pattern)
            if parts.count > 1 {
                let recombined = recombineParts(parts, maxLength: maxChunkSize)
                var spans: [SentenceSpan] = []
                var offset = 0
                for chunk in recombined {
                    let nsRange = NSRange(location: baseRange.location + offset, length: chunk.count)
                    if chunk.count > maxChunkSize {
                        spans.append(contentsOf: splitLongSentence(chunk, baseRange: nsRange, maxChunkSize: maxChunkSize))
                    } else {
                        spans.append(SentenceSpan(text: chunk, plainTextRange: nsRange))
                    }
                    offset += chunk.count
                }
                return spans
            }
        }

        // Last resort: split at nearest whitespace to midpoint
        let mid = text.index(text.startIndex, offsetBy: text.count / 2)
        if let spaceRange = text.rangeOfCharacter(from: .whitespaces, range: mid..<text.endIndex)
            ?? text.rangeOfCharacter(from: .whitespaces, options: .backwards, range: text.startIndex..<mid) {
            let first = String(text[text.startIndex..<spaceRange.lowerBound]).trimmingCharacters(in: .whitespaces)
            let second = String(text[spaceRange.upperBound...]).trimmingCharacters(in: .whitespaces)
            var result: [SentenceSpan] = []
            if !first.isEmpty {
                let r = NSRange(location: baseRange.location, length: first.count)
                result.append(contentsOf: splitLongSentence(first, baseRange: r, maxChunkSize: maxChunkSize))
            }
            if !second.isEmpty {
                let r = NSRange(location: baseRange.location + text.count - second.count, length: second.count)
                result.append(contentsOf: splitLongSentence(second, baseRange: r, maxChunkSize: maxChunkSize))
            }
            return result
        }

        return [SentenceSpan(text: text, plainTextRange: baseRange)]
    }

    /// Preprocess text for better TTS output.
    static func preprocessTextForTTS(_ text: String) -> String {
        var result = text
        result = removeHyphensFromCompoundWords(result)
        result = convertParentheticalsToDashes(result)
        result = convertSlashesToDashes(result)
        return result
    }

    // MARK: - Private Helpers

    static func splitByPattern(_ text: String, pattern: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [text] }
        let range = NSRange(text.startIndex..., in: text)
        var parts: [String] = []
        var lastEnd = text.startIndex
        regex.enumerateMatches(in: text, range: range) { match, _, _ in
            if let match = match, let matchRange = Range(match.range, in: text) {
                let part = String(text[lastEnd..<matchRange.lowerBound]).trimmingCharacters(in: .whitespaces)
                if !part.isEmpty { parts.append(part) }
                lastEnd = matchRange.upperBound
            }
        }
        let remaining = String(text[lastEnd...]).trimmingCharacters(in: .whitespaces)
        if !remaining.isEmpty { parts.append(remaining) }
        return parts
    }

    static func recombineParts(_ parts: [String], maxLength: Int) -> [String] {
        var chunks: [String] = []
        var current = ""
        for part in parts {
            let combined = current.isEmpty ? part : current + " " + part
            if combined.count > maxLength && !current.isEmpty {
                chunks.append(current)
                current = part
            } else {
                current = combined
            }
        }
        if !current.isEmpty { chunks.append(current) }
        return chunks
    }

    /// "time-delayed" → "time delayed"
    static func removeHyphensFromCompoundWords(_ text: String) -> String {
        let pattern = "(?<=\\p{L})-(?=\\p{L})"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return text }
        let range = NSRange(text.startIndex..., in: text)
        return regex.stringByReplacingMatches(in: text, range: range, withTemplate: " ")
    }

    /// "(or not)" → "- or not -"
    static func convertParentheticalsToDashes(_ text: String) -> String {
        var result = text
        let pattern = "\\(([^)]+)\\)([.,;:!?]?)(?=(\\s+\\w|\\s*$))"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return text }
        let range = NSRange(result.startIndex..., in: result)
        let matches = regex.matches(in: result, range: range)
        for match in matches.reversed() {
            guard let contentRange = Range(match.range(at: 1), in: result),
                  let fullRange = Range(match.range, in: result) else { continue }
            let content = String(result[contentRange])
            let punctuation: String
            if match.range(at: 2).length > 0, let r = Range(match.range(at: 2), in: result) {
                punctuation = String(result[r])
            } else {
                punctuation = ""
            }
            let followedByMoreText = match.range(at: 3).length > 0 &&
                Range(match.range(at: 3), in: result).map { !result[$0].trimmingCharacters(in: .whitespaces).isEmpty } ?? false
            let replacement: String
            if punctuation.isEmpty && followedByMoreText {
                replacement = "- \(content) -"
            } else {
                replacement = "- \(content) -\(punctuation)"
            }
            result.replaceSubrange(fullRange, with: replacement)
        }
        return result
    }

    /// "and/or" → "and - or"
    static func convertSlashesToDashes(_ text: String) -> String {
        let pattern = "(?<=\\w)/(?=\\w)"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return text }
        let range = NSRange(text.startIndex..., in: text)
        return regex.stringByReplacingMatches(in: text, range: range, withTemplate: " - ")
    }
}
