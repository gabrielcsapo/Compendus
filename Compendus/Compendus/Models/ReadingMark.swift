//
//  ReadingMark.swift
//  Compendus
//
//  Unified persistence model for everything a user "marks" while reading:
//  bookmarks (position-only), highlights (selected text range), and
//  audiobook moments (playback-position markers). Replaces the previous
//  split between BookBookmark (in-app) and BookHighlight (in EPUBReader pkg).
//

import Foundation
import UIKit
import SwiftData
import EPUBReader

public enum MarkKind: String, Codable, CaseIterable, Sendable {
    case bookmark         // visual formats — page or position only
    case highlight        // EPUB/PDF — selected text range
    case audiobookMoment  // audiobook — timestamp marker
}

@Model
final class ReadingMark {
    @Attribute(.unique) var id: String
    var bookId: String

    /// Stored as the raw value of MarkKind. SwiftData stores enums as their
    /// raw value automatically, but keeping a String avoids any Codable
    /// gotchas across migrations. Internal access so #Predicate filters can
    /// reference it (Predicates can't see computed properties).
    var kindRaw: String
    var kind: MarkKind {
        get { MarkKind(rawValue: kindRaw) ?? .bookmark }
        set { kindRaw = newValue.rawValue }
    }

    var format: String                 // "epub", "pdf", "comic", "audiobook"
    var locatorJSON: String?           // engine-format position (EPUB CFI / PDF rects)
    var pageIndex: Int?                // convenience for visual formats / chapter index
    var timestampSeconds: Double?      // audiobook
    var text: String?                  // selected text (highlights only)
    var note: String?
    var color: String                  // Hex, e.g. "#ffff00"
    var chapterTitle: String?
    var progression: Double            // 0.0–1.0
    var profileId: String              // empty = legacy/unassigned
    var createdAt: Date

    init(
        id: String = UUID().uuidString,
        bookId: String,
        kind: MarkKind,
        format: String,
        locatorJSON: String? = nil,
        pageIndex: Int? = nil,
        timestampSeconds: Double? = nil,
        text: String? = nil,
        note: String? = nil,
        color: String = "#ffff00",
        chapterTitle: String? = nil,
        progression: Double = 0.0,
        profileId: String = "",
        createdAt: Date = Date()
    ) {
        self.id = id
        self.bookId = bookId
        self.kindRaw = kind.rawValue
        self.format = format
        self.locatorJSON = locatorJSON
        self.pageIndex = pageIndex
        self.timestampSeconds = timestampSeconds
        self.text = text
        self.note = note
        self.color = color
        self.chapterTitle = chapterTitle
        self.progression = progression
        self.profileId = profileId
        self.createdAt = createdAt
    }

    var uiColor: UIColor {
        UIColor(hex: color) ?? .systemYellow
    }

    /// Convert to the engine-side render value (highlights only).
    func toHighlightRenderInfo() -> HighlightRenderInfo? {
        guard kind == .highlight, let locatorJSON else { return nil }
        return HighlightRenderInfo(id: id, locatorJSON: locatorJSON, color: color)
    }
}

extension Array where Element == ReadingMark {
    /// Map highlights to engine render values. Convenient for `engine.applyHighlights(marks.renderableHighlights())`.
    func renderableHighlights() -> [HighlightRenderInfo] {
        compactMap { $0.toHighlightRenderInfo() }
    }
}
