//
//  TextAlignmentEngine.swift
//  Compendus
//
//  Aligns Whisper transcript words to EPUB chapter text for read-along
//  sentence highlighting. Uses sequential word walk with fuzzy matching
//  and drift resync.
//

import Foundation
import os.log

private let alignLogger = Logger(subsystem: "com.compendus.reader", category: "TextAlignment")

/// Maps character offsets in plain text to NSRange in the attributed string.
/// Built during `AttributedStringBuilder.build(from:)`.
struct PlainTextToAttrStringMap {
    struct Entry {
        let plainTextRange: NSRange
        let attrStringRange: NSRange
    }
    var entries: [Entry] = []

    /// Convert a plain text character range to the corresponding attributed string range.
    func attrStringRange(for plainTextRange: NSRange) -> NSRange? {
        // Find the entry that contains the start of the plain text range
        guard let startEntry = entries.first(where: {
            NSLocationInRange(plainTextRange.location, $0.plainTextRange)
        }) else { return nil }

        // Find the entry that contains the end of the plain text range
        let endOffset = plainTextRange.location + plainTextRange.length
        guard let endEntry = entries.first(where: {
            NSLocationInRange(max(0, endOffset - 1), $0.plainTextRange)
        }) else { return nil }

        // Map offsets proportionally within entries
        let startDelta = plainTextRange.location - startEntry.plainTextRange.location
        let attrStart = startEntry.attrStringRange.location + startDelta

        let endDelta = endOffset - endEntry.plainTextRange.location
        let attrEnd = endEntry.attrStringRange.location + endDelta

        guard attrEnd > attrStart else { return nil }
        return NSRange(location: attrStart, length: attrEnd - attrStart)
    }

    /// Find the plain text offset for a given attributed string location.
    /// Returns the start of the content node containing (or following) the location.
    /// Accurate to the node/paragraph level — no intra-node delta mapping,
    /// which is unreliable when attributed string and plain text lengths differ.
    func plainTextOffset(forAttrStringLocation location: Int) -> Int? {
        // Try to find the entry containing this location
        if let entry = entries.first(where: {
            NSLocationInRange(location, $0.attrStringRange)
        }) {
            return entry.plainTextRange.location
        }
        // Location is in a gap (e.g., standalone image) — use the next text entry
        if let next = entries.first(where: { $0.attrStringRange.location > location }) {
            return next.plainTextRange.location
        }
        return nil
    }
}

class TextAlignmentEngine {

    struct AlignmentResult {
        /// Range of the active sentence in the full chapter attributed string.
        let sentenceRange: NSRange
        /// 0.0–1.0 confidence that the alignment is correct.
        let matchConfidence: Double
        /// Updated cursor position in the chapter plain text.
        let lastMatchedCursorPosition: Int
    }

    // MARK: - Configuration

    /// Maximum characters to search forward from cursor for a single word match.
    private let searchWindow = 300
    /// Number of consecutive unmatched words before triggering resync.
    private let resyncThreshold = 10
    /// Maximum Levenshtein distance for fuzzy matching.
    private let maxEditDistance = 2

    // MARK: - State

    private var consecutiveUnmatched = 0
    private var totalAlignCalls = 0

    // MARK: - Public API

    /// Align transcript words to EPUB chapter text and return the active sentence range.
    ///
    /// - Parameters:
    ///   - transcriptWords: Words from the current transcript segment(s), ordered by time.
    ///   - currentTime: The current audio playback time in seconds.
    ///   - chapterPlainText: The full plain text of the current EPUB chapter.
    ///   - cursorPosition: Where to start searching in the plain text (advanced by previous calls).
    ///   - plainTextToAttrStringMap: Maps plain text offsets to attributed string offsets.
    /// - Returns: The sentence range in the attributed string, or nil if alignment failed.
    func align(
        transcriptWords: [TranscriptWord],
        currentTime: Double,
        chapterPlainText: String,
        cursorPosition: Int,
        plainTextToAttrStringMap: PlainTextToAttrStringMap
    ) -> AlignmentResult? {
        guard !transcriptWords.isEmpty, !chapterPlainText.isEmpty else {
            alignLogger.warning("align: empty input — words=\(transcriptWords.count), textLen=\(chapterPlainText.count)")
            return nil
        }

        totalAlignCalls += 1
        let shouldLog = totalAlignCalls % 20 == 1

        var cursor = cursorPosition
        var lastMatchedPosition: Int?
        var totalWords = 0
        var matchedWords = 0

        // Find the transcript word closest to currentTime
        let activeWordIndex = findActiveWordIndex(in: transcriptWords, at: currentTime)

        // Walk through transcript words, matching against chapter text
        for (index, word) in transcriptWords.enumerated() {
            // Only process words up to slightly ahead of current time
            guard word.start <= currentTime + 2.0 else { break }

            totalWords += 1
            let normalized = normalizeWord(word.word)
            guard !normalized.isEmpty else { continue }

            if let matchPos = findWordInText(
                normalized,
                in: chapterPlainText,
                startingAt: cursor,
                window: searchWindow
            ) {
                cursor = matchPos + normalized.count
                matchedWords += 1
                consecutiveUnmatched = 0

                if index == activeWordIndex || (lastMatchedPosition == nil && index >= activeWordIndex) {
                    lastMatchedPosition = matchPos
                }
            } else {
                consecutiveUnmatched += 1

                // Trigger resync if too many misses
                if consecutiveUnmatched >= resyncThreshold {
                    alignLogger.info("Resync triggered after \(self.consecutiveUnmatched) misses at cursor=\(cursor)")
                    let remainingWords = Array(transcriptWords.suffix(from: min(index + 1, transcriptWords.count)))
                    if let newCursor = resync(
                        upcomingWords: remainingWords,
                        chapterPlainText: chapterPlainText,
                        searchFromPosition: cursor
                    ) {
                        cursor = newCursor
                        consecutiveUnmatched = 0
                        alignLogger.info("Resync succeeded, new cursor=\(newCursor)")
                    } else {
                        alignLogger.info("Resync failed — audio may not match ebook text")
                        // Reset counter so we don't re-trigger on every word
                        consecutiveUnmatched = 0
                        // Can't resync — audio might be in content not in the ebook
                        return nil
                    }
                }
            }
        }

        // If we matched the active word, find the sentence containing it
        if shouldLog {
            alignLogger.info("Align result: \(matchedWords)/\(totalWords) matched, cursor \(cursorPosition)->\(cursor), activeIdx=\(activeWordIndex), lastMatch=\(String(describing: lastMatchedPosition))")
        }

        guard let matchPos = lastMatchedPosition ?? (cursor > cursorPosition ? cursorPosition : nil) else {
            if shouldLog {
                alignLogger.info("No match position found")
            }
            return nil
        }

        let sentenceRange = findSentenceBounds(around: matchPos, in: chapterPlainText)
        guard sentenceRange.length > 0 else { return nil }

        // Convert to attributed string range
        guard let attrRange = plainTextToAttrStringMap.attrStringRange(for: sentenceRange) else {
            return nil
        }

        let confidence = totalWords > 0 ? Double(matchedWords) / Double(totalWords) : 0
        return AlignmentResult(
            sentenceRange: attrRange,
            matchConfidence: confidence,
            lastMatchedCursorPosition: cursor
        )
    }

    /// Attempt to resync after alignment drift by searching for a phrase of upcoming words.
    func resync(
        upcomingWords: [TranscriptWord],
        chapterPlainText: String,
        searchFromPosition: Int
    ) -> Int? {
        // Build a phrase from the next 5-8 words
        let phraseWords = upcomingWords.prefix(8).map { normalizeWord($0.word) }.filter { !$0.isEmpty }
        guard phraseWords.count >= 3 else { return nil }

        let phrase = phraseWords.joined(separator: " ")
        let text = chapterPlainText
        let startIndex = text.index(text.startIndex, offsetBy: min(searchFromPosition, text.count))
        let searchRange = startIndex..<text.endIndex

        // Try exact phrase match first
        if let range = text.range(of: phrase, options: .caseInsensitive, range: searchRange) {
            return text.distance(from: text.startIndex, to: range.lowerBound)
        }

        // Try with a shorter phrase (first 4 words)
        let shortPhrase = phraseWords.prefix(4).joined(separator: " ")
        if let range = text.range(of: shortPhrase, options: .caseInsensitive, range: searchRange) {
            return text.distance(from: text.startIndex, to: range.lowerBound)
        }

        return nil
    }

    /// Reset internal state (call when switching chapters).
    func reset() {
        consecutiveUnmatched = 0
    }

    // MARK: - Word Matching

    /// Find a word in the chapter text starting from a cursor position.
    private func findWordInText(
        _ normalizedWord: String,
        in text: String,
        startingAt cursor: Int,
        window: Int
    ) -> Int? {
        guard cursor < text.count else { return nil }

        let startIndex = text.index(text.startIndex, offsetBy: cursor)
        let endOffset = min(cursor + window, text.count)
        let endIndex = text.index(text.startIndex, offsetBy: endOffset)
        let searchSlice = text[startIndex..<endIndex]

        // Try exact match (case-insensitive)
        if let range = searchSlice.range(of: normalizedWord, options: .caseInsensitive) {
            // Verify it's at a word boundary
            let matchStart = text.distance(from: text.startIndex, to: range.lowerBound)
            if isWordBoundary(at: range.lowerBound, in: text) {
                return matchStart
            }
        }

        // Try fuzzy match — scan word-by-word in the search window
        var scanIndex = startIndex
        while scanIndex < endIndex {
            // Find the next word boundary
            guard let wordRange = nextWordRange(from: scanIndex, in: text, limit: endIndex) else { break }
            let candidate = String(text[wordRange]).lowercased()

            if levenshteinDistance(normalizedWord, candidate) <= maxEditDistance {
                return text.distance(from: text.startIndex, to: wordRange.lowerBound)
            }

            scanIndex = wordRange.upperBound
        }

        return nil
    }

    /// Find the range of the next word starting from a given index.
    private func nextWordRange(from start: String.Index, in text: String, limit: String.Index) -> Range<String.Index>? {
        // Skip non-alphanumeric characters
        var idx = start
        while idx < limit && !text[idx].isLetter && !text[idx].isNumber {
            idx = text.index(after: idx)
        }
        guard idx < limit else { return nil }

        let wordStart = idx
        while idx < limit && (text[idx].isLetter || text[idx].isNumber || text[idx] == "'") {
            idx = text.index(after: idx)
        }
        guard idx > wordStart else { return nil }
        return wordStart..<idx
    }

    /// Check if the character at the given index is at a word boundary.
    private func isWordBoundary(at index: String.Index, in text: String) -> Bool {
        if index == text.startIndex { return true }
        let prev = text[text.index(before: index)]
        return !prev.isLetter && !prev.isNumber
    }

    // MARK: - Sentence Detection

    /// Find the sentence boundaries around a character position in the plain text.
    private func findSentenceBounds(around position: Int, in text: String) -> NSRange {
        guard position < text.count else { return NSRange(location: 0, length: 0) }

        let terminators: Set<Character> = [".", "!", "?"]

        // Scan backward to find sentence start
        var sentenceStart = position
        let startIndex = text.index(text.startIndex, offsetBy: position)

        var backIdx = startIndex
        while backIdx > text.startIndex {
            let prevIdx = text.index(before: backIdx)
            let ch = text[prevIdx]

            // Double newline is a paragraph boundary
            if ch == "\n" {
                if prevIdx > text.startIndex && text[text.index(before: prevIdx)] == "\n" {
                    sentenceStart = text.distance(from: text.startIndex, to: backIdx)
                    break
                }
            }

            // Sentence terminator followed by whitespace
            if terminators.contains(ch) {
                sentenceStart = text.distance(from: text.startIndex, to: backIdx)
                break
            }

            backIdx = prevIdx
        }
        if backIdx == text.startIndex {
            sentenceStart = 0
        }

        // Scan forward to find sentence end
        var sentenceEnd = position
        var fwdIdx = startIndex
        while fwdIdx < text.endIndex {
            let ch = text[fwdIdx]

            if terminators.contains(ch) {
                sentenceEnd = text.distance(from: text.startIndex, to: text.index(after: fwdIdx))
                break
            }

            if ch == "\n" {
                let nextIdx = text.index(after: fwdIdx)
                if nextIdx < text.endIndex && text[nextIdx] == "\n" {
                    sentenceEnd = text.distance(from: text.startIndex, to: fwdIdx)
                    break
                }
            }

            fwdIdx = text.index(after: fwdIdx)
        }
        if fwdIdx >= text.endIndex {
            sentenceEnd = text.count
        }

        // Trim leading whitespace
        let startTrimIdx = text.index(text.startIndex, offsetBy: sentenceStart)
        var trimmedStart = startTrimIdx
        while trimmedStart < text.endIndex && text[trimmedStart].isWhitespace {
            trimmedStart = text.index(after: trimmedStart)
        }
        sentenceStart = text.distance(from: text.startIndex, to: trimmedStart)

        guard sentenceEnd > sentenceStart else { return NSRange(location: position, length: 0) }
        return NSRange(location: sentenceStart, length: sentenceEnd - sentenceStart)
    }

    // MARK: - Helpers

    /// Find the index of the transcript word being spoken at `currentTime`.
    private func findActiveWordIndex(in words: [TranscriptWord], at time: Double) -> Int {
        // Binary search for the word whose time range contains currentTime
        var low = 0
        var high = words.count - 1

        while low <= high {
            let mid = (low + high) / 2
            let word = words[mid]

            if time < word.start {
                high = mid - 1
            } else if time > word.end {
                low = mid + 1
            } else {
                return mid
            }
        }

        // If between words, return the most recent word
        return max(0, high)
    }

    /// Normalize a word for comparison: lowercase, strip punctuation.
    private func normalizeWord(_ word: String) -> String {
        word.lowercased()
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .filter { $0.isLetter || $0.isNumber || $0 == "'" }
    }

    /// Compute Levenshtein edit distance between two strings.
    private func levenshteinDistance(_ a: String, _ b: String) -> Int {
        let aChars = Array(a)
        let bChars = Array(b)
        let m = aChars.count
        let n = bChars.count

        if m == 0 { return n }
        if n == 0 { return m }

        // Quick check: if lengths differ by more than maxEditDistance, skip
        if abs(m - n) > maxEditDistance { return abs(m - n) }

        var prev = Array(0...n)
        var curr = Array(repeating: 0, count: n + 1)

        for i in 1...m {
            curr[0] = i
            for j in 1...n {
                let cost = aChars[i - 1] == bChars[j - 1] ? 0 : 1
                curr[j] = min(
                    prev[j] + 1,        // deletion
                    curr[j - 1] + 1,     // insertion
                    prev[j - 1] + cost   // substitution
                )
            }
            swap(&prev, &curr)
        }

        return prev[n]
    }
}
