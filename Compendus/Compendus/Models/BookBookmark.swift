//
//  BookBookmark.swift
//  Compendus
//
//  Universal page-level bookmark model for all book formats (EPUB, PDF, comic).
//  Separate from BookHighlight which is text-range-based.
//

import Foundation
import UIKit
import SwiftData

@Model
final class BookBookmark {
    @Attribute(.unique) var id: String
    var bookId: String
    var pageIndex: Int              // Global page index (EPUB: globalPageIndex, PDF/comic: zero-based page)
    var color: String               // Hex color (e.g. "#ff6b6b")
    var note: String?               // Optional user note
    var format: String              // "epub", "pdf", "comic"
    var title: String?              // Chapter or page label for display
    var progression: Double         // 0.0–1.0 total progression at bookmark point
    var createdAt: Date
    var profileId: String = ""        // Profile that created this bookmark (empty = legacy/unassigned)

    init(
        id: String = UUID().uuidString,
        bookId: String,
        pageIndex: Int,
        color: String = "#ff6b6b",
        note: String? = nil,
        format: String,
        title: String? = nil,
        progression: Double = 0.0,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.bookId = bookId
        self.pageIndex = pageIndex
        self.color = color
        self.note = note
        self.format = format
        self.title = title
        self.progression = progression
        self.createdAt = createdAt
    }

    var uiColor: UIColor {
        UIColor(hex: color) ?? .systemRed
    }
}
