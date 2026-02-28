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
    /// Respects dialogue boundaries — prefers splitting outside quotation marks.
    /// Tries semicolons first, then commas/colons, then conjunctions, then mid-point whitespace.
    static func splitLongSentence(_ text: String, baseRange: NSRange, maxChunkSize: Int = maxCharsPerChunk) -> [SentenceSpan] {
        guard text.count > maxChunkSize else {
            return [SentenceSpan(text: text, plainTextRange: baseRange)]
        }

        // Try splitting at dialogue boundaries first (between quoted and non-quoted segments)
        let dialogueParts = splitAtDialogueBoundaries(text)
        if dialogueParts.count > 1 {
            let recombined = recombineParts(dialogueParts, maxLength: maxChunkSize)
            if recombined.count > 1 {
                var spans: [SentenceSpan] = []
                var offset = 0
                for chunk in recombined {
                    let nsRange = NSRange(location: baseRange.location + offset, length: chunk.count)
                    if chunk.count > maxChunkSize {
                        spans.append(contentsOf: splitLongSentence(chunk, baseRange: nsRange, maxChunkSize: maxChunkSize))
                    } else {
                        let trimmed = chunk.trimmingCharacters(in: .whitespaces)
                        if !trimmed.isEmpty {
                            spans.append(SentenceSpan(text: trimmed, plainTextRange: nsRange))
                        }
                    }
                    offset += chunk.count
                }
                if !spans.isEmpty { return spans }
            }
        }

        let clausePatterns = [
            "(?<=;)\\s+",
            "(?<=,)\\s+",
            "(?<=:)\\s+",
            "\\s+(?=\\b(?:and|but|or|yet|so|which|that|because|although|while|when|where|if)\\b)"
        ]

        for pattern in clausePatterns {
            let parts = splitByPatternOutsideQuotes(text, pattern: pattern)
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
        result = expandAbbreviations(result)
        result = expandNumbers(result)
        result = normalizeEmDashesAndEllipsis(result)
        result = cleanQuotationMarks(result)
        result = expandRomanNumerals(result)
        result = removeHyphensFromCompoundWords(result)
        result = convertParentheticalsToDashes(result)
        result = convertSlashesToDashes(result)
        return result
    }

    // MARK: - Text Preprocessing

    /// Expand common abbreviations to their full forms for natural speech.
    static func expandAbbreviations(_ text: String) -> String {
        let abbreviations: [(pattern: String, replacement: String)] = [
            ("\\bMr\\.", "Mister"),
            ("\\bMrs\\.", "Missus"),
            ("\\bMs\\.", "Miss"),
            ("\\bDr\\.", "Doctor"),
            ("\\bSt\\.", "Saint"),
            ("\\bProf\\.", "Professor"),
            ("\\bSgt\\.", "Sergeant"),
            ("\\bCpt\\.", "Captain"),
            ("\\bCapt\\.", "Captain"),
            ("\\bLt\\.", "Lieutenant"),
            ("\\bGen\\.", "General"),
            ("\\bGov\\.", "Governor"),
            ("\\bSen\\.", "Senator"),
            ("\\bRep\\.", "Representative"),
            ("\\bRev\\.", "Reverend"),
            ("\\bJr\\.", "Junior"),
            ("\\bSr\\.", "Senior"),
            ("\\betc\\.", "etcetera"),
            ("\\bvs\\.", "versus"),
            ("\\bvs\\b", "versus"),
            ("\\bapt\\.", "apartment"),
            ("\\bft\\.", "feet"),
            ("\\bin\\.", "inches"),
            ("\\blbs?\\.", "pounds"),
            ("\\boz\\.", "ounces"),
        ]

        var result = text
        for (pattern, replacement) in abbreviations {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) else { continue }
            let range = NSRange(result.startIndex..., in: result)
            result = regex.stringByReplacingMatches(in: result, range: range, withTemplate: replacement)
        }
        return result
    }

    /// Expand numeric values to a speakable form.
    static func expandNumbers(_ text: String) -> String {
        var result = text

        // Currency: $1,234.56 → "1234 dollars and 56 cents"
        if let currencyRegex = try? NSRegularExpression(pattern: "\\$([\\d,]+)(?:\\.(\\d{2}))?" ) {
            let range = NSRange(result.startIndex..., in: result)
            let matches = currencyRegex.matches(in: result, range: range)
            for match in matches.reversed() {
                guard let fullRange = Range(match.range, in: result),
                      let dollarsRange = Range(match.range(at: 1), in: result) else { continue }
                let dollarsStr = result[dollarsRange].replacingOccurrences(of: ",", with: "")
                guard let dollars = Int(dollarsStr) else { continue }
                var spoken = "\(numberToWords(dollars)) dollar\(dollars == 1 ? "" : "s")"
                if match.range(at: 2).length > 0, let centsRange = Range(match.range(at: 2), in: result) {
                    if let cents = Int(String(result[centsRange])), cents > 0 {
                        spoken += " and \(numberToWords(cents)) cent\(cents == 1 ? "" : "s")"
                    }
                }
                result.replaceSubrange(fullRange, with: spoken)
            }
        }

        // Percentages: 42% → "42 percent"
        if let pctRegex = try? NSRegularExpression(pattern: "(\\d+(?:\\.\\d+)?)%") {
            let range = NSRange(result.startIndex..., in: result)
            result = pctRegex.stringByReplacingMatches(in: result, range: range, withTemplate: "$1 percent")
        }

        // Remove commas from numbers: 1,234 → 1234 (so the model reads them naturally)
        if let commaNumRegex = try? NSRegularExpression(pattern: "(\\d),(?=\\d{3}\\b)") {
            let range = NSRange(result.startIndex..., in: result)
            result = commaNumRegex.stringByReplacingMatches(in: result, range: range, withTemplate: "$1")
        }

        return result
    }

    /// Convert a number (0–9999) to English words.
    private static func numberToWords(_ n: Int) -> String {
        if n == 0 { return "zero" }
        let ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
                     "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
                     "seventeen", "eighteen", "nineteen"]
        let tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]

        var result = ""
        var num = n

        if num >= 1000 {
            result += ones[num / 1000] + " thousand "
            num %= 1000
        }
        if num >= 100 {
            result += ones[num / 100] + " hundred "
            num %= 100
        }
        if num >= 20 {
            result += tens[num / 10]
            if num % 10 > 0 { result += " " + ones[num % 10] }
        } else if num > 0 {
            result += ones[num]
        }

        return result.trimmingCharacters(in: .whitespaces)
    }

    /// Convert em-dashes to commas and ellipsis to pauses for natural prosody.
    static func normalizeEmDashesAndEllipsis(_ text: String) -> String {
        var result = text
        // Em-dash (—) and en-dash (–) → comma for a natural pause
        result = result.replacingOccurrences(of: "—", with: ",")
        result = result.replacingOccurrences(of: "–", with: ",")
        // Ellipsis → period for a longer pause
        result = result.replacingOccurrences(of: "…", with: ".")
        result = result.replacingOccurrences(of: "...", with: ".")
        // Clean up double punctuation that may result
        if let doublePunct = try? NSRegularExpression(pattern: "([,.]){2,}") {
            let range = NSRange(result.startIndex..., in: result)
            result = doublePunct.stringByReplacingMatches(in: result, range: range, withTemplate: "$1")
        }
        return result
    }

    /// Strip or normalize fancy quotation marks that can confuse TTS models.
    static func cleanQuotationMarks(_ text: String) -> String {
        var result = text
        // Curly quotes → straight quotes (model handles these better)
        result = result.replacingOccurrences(of: "\u{201C}", with: "\"") // "
        result = result.replacingOccurrences(of: "\u{201D}", with: "\"") // "
        result = result.replacingOccurrences(of: "\u{2018}", with: "'")  // '
        result = result.replacingOccurrences(of: "\u{2019}", with: "'")  // '
        return result
    }

    /// Expand Roman numerals when preceded by "chapter", "book", "part", "volume", "act", "scene".
    static func expandRomanNumerals(_ text: String) -> String {
        let contextWords = "(?:chapter|book|part|volume|act|scene|section)"
        guard let regex = try? NSRegularExpression(
            pattern: "\\b\(contextWords)\\s+((?:X{0,3})(?:IX|IV|V?I{0,3}))\\b",
            options: .caseInsensitive
        ) else { return text }

        var result = text
        let range = NSRange(result.startIndex..., in: result)
        let matches = regex.matches(in: result, range: range)

        for match in matches.reversed() {
            guard let romanRange = Range(match.range(at: 1), in: result) else { continue }
            let roman = String(result[romanRange]).uppercased()
            if let value = romanToInt(roman), value > 0 {
                result.replaceSubrange(romanRange, with: numberToWords(value))
            }
        }
        return result
    }

    /// Convert a Roman numeral string to an integer (1–39).
    private static func romanToInt(_ s: String) -> Int? {
        let map: [Character: Int] = ["I": 1, "V": 5, "X": 10, "L": 50]
        var total = 0
        var prev = 0
        for ch in s.reversed() {
            guard let val = map[ch] else { return nil }
            if val < prev {
                total -= val
            } else {
                total += val
            }
            prev = val
        }
        return total > 0 ? total : nil
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

    // MARK: - Dialogue-Aware Chunking

    /// Split text at boundaries between quoted dialogue and narration.
    /// e.g. `"Hello," she said, "how are you?"` → [`"Hello," she said,`, `"how are you?"`]
    static func splitAtDialogueBoundaries(_ text: String) -> [String] {
        var parts: [String] = []
        var current = ""
        var inQuote = false
        let quoteChars: Set<Character> = ["\"", "\u{201C}", "\u{201D}"]

        for ch in text {
            if quoteChars.contains(ch) {
                if inQuote {
                    // Closing quote — include it, then look for a natural break
                    current.append(ch)
                    inQuote = false
                } else {
                    // Opening quote — split here if we have accumulated narration
                    if !current.trimmingCharacters(in: .whitespaces).isEmpty {
                        parts.append(current)
                        current = ""
                    }
                    current.append(ch)
                    inQuote = true
                }
            } else {
                current.append(ch)
            }
        }
        if !current.isEmpty { parts.append(current) }

        return parts
    }

    /// Like splitByPattern but avoids splitting inside quotation marks.
    static func splitByPatternOutsideQuotes(_ text: String, pattern: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [text] }
        let range = NSRange(text.startIndex..., in: text)

        // Build a set of ranges that are inside quotes
        let quoteRanges = findQuotedRanges(in: text)

        var parts: [String] = []
        var lastEnd = text.startIndex

        regex.enumerateMatches(in: text, range: range) { match, _, _ in
            if let match = match, let matchRange = Range(match.range, in: text) {
                // Skip this split point if it's inside a quoted region
                let matchStart = text.distance(from: text.startIndex, to: matchRange.lowerBound)
                let isInsideQuote = quoteRanges.contains { $0.contains(matchStart) }
                guard !isInsideQuote else { return }

                let part = String(text[lastEnd..<matchRange.lowerBound]).trimmingCharacters(in: .whitespaces)
                if !part.isEmpty { parts.append(part) }
                lastEnd = matchRange.upperBound
            }
        }
        let remaining = String(text[lastEnd...]).trimmingCharacters(in: .whitespaces)
        if !remaining.isEmpty { parts.append(remaining) }
        return parts
    }

    /// Find ranges of text enclosed in quotation marks.
    private static func findQuotedRanges(in text: String) -> [ClosedRange<Int>] {
        var ranges: [ClosedRange<Int>] = []
        let quoteChars: Set<Character> = ["\"", "\u{201C}", "\u{201D}"]
        var quoteStart: Int?

        for (i, ch) in text.enumerated() {
            if quoteChars.contains(ch) {
                if let start = quoteStart {
                    ranges.append(start...i)
                    quoteStart = nil
                } else {
                    quoteStart = i
                }
            }
        }
        return ranges
    }
}
