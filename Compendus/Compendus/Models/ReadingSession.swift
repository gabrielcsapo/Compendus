//
//  ReadingSession.swift
//  Compendus
//
//  SwiftData model for tracking reading sessions with timestamps, pages, and characters.
//

import Foundation
import SwiftData

/// A single page navigation event within a reading session.
struct PageTurn: Codable {
    let page: Int
    let timestamp: Date
    let characterOffset: Int?       // EPUB only
}

@Model
final class ReadingSession {
    @Attribute(.unique) var id: String
    var bookId: String
    var format: String              // "epub", "pdf", "comic", or "audiobook"
    var startedAt: Date
    var endedAt: Date               // Updated on each page turn + on close

    // Page tracking (epub, pdf, comic only — nil for audiobooks)
    var startPage: Int?             // globalPageIndex (EPUB) or currentPage (PDF/comic) at start
    var endPage: Int?               // Updated on page turns
    var totalBookPages: Int?        // engine.totalPositions snapshot

    // Character tracking (EPUB only)
    var startCharacterOffset: Int?  // currentPagePlainTextOffset at start
    var endCharacterOffset: Int?    // Updated on page turns

    // Page turn log (epub, pdf, comic only — nil for audiobooks)
    var pageTurnsData: Data?        // JSON-encoded [PageTurn]

    // Audiobook tracking
    var audioPlaybackRate: Float?   // e.g. 1.0, 1.5, 2.0

    /// Wall-clock duration of this session
    var durationSeconds: Int {
        Int(endedAt.timeIntervalSince(startedAt))
    }

    /// Content time for audiobooks (adjusted for playback speed).
    /// At 2x speed, 30 minutes of wall time = 60 minutes of content.
    var contentDurationSeconds: Int {
        let rate = audioPlaybackRate ?? 1.0
        return Int(Double(durationSeconds) * Double(rate))
    }

    var pagesRead: Int? {
        guard let start = startPage, let end = endPage else { return nil }
        return abs(end - start)
    }

    var charactersRead: Int? {
        guard let start = startCharacterOffset, let end = endCharacterOffset else { return nil }
        return abs(end - start)
    }

    /// Decoded page turn log
    var pageTurns: [PageTurn] {
        get {
            guard let data = pageTurnsData else { return [] }
            return (try? JSONDecoder().decode([PageTurn].self, from: data)) ?? []
        }
        set {
            pageTurnsData = try? JSONEncoder().encode(newValue)
        }
    }

    /// Number of unique pages visited in this session
    var uniquePagesVisited: Int {
        Set(pageTurns.map(\.page)).count
    }

    func appendPageTurn(page: Int, characterOffset: Int? = nil) {
        var turns = pageTurns
        turns.append(PageTurn(page: page, timestamp: Date(), characterOffset: characterOffset))
        pageTurns = turns
    }

    init(
        id: String = UUID().uuidString,
        bookId: String,
        format: String,
        startedAt: Date = Date(),
        endedAt: Date = Date(),
        startPage: Int? = nil,
        endPage: Int? = nil,
        totalBookPages: Int? = nil,
        startCharacterOffset: Int? = nil,
        endCharacterOffset: Int? = nil,
        audioPlaybackRate: Float? = nil
    ) {
        self.id = id
        self.bookId = bookId
        self.format = format
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.startPage = startPage
        self.endPage = endPage
        self.totalBookPages = totalBookPages
        self.startCharacterOffset = startCharacterOffset
        self.endCharacterOffset = endCharacterOffset
        self.audioPlaybackRate = audioPlaybackRate
    }
}
