//
//  HighlightMigration.swift
//  Compendus
//
//  Migrates old Readium-format highlight locators to the new custom format.
//  Old format: Readium Locator JSON with href, type, locations, text fields.
//  New format: { "format": "epub", "href": "...", "range": { XPath data } }
//
//  Since XPath data cannot be reconstructed from Readium's Locator (which uses
//  CSS selectors and text fragments), migrated highlights keep their text and
//  metadata but won't have precise range data for rendering. They remain in the
//  highlights list and can be navigated to by chapter, but won't show inline
//  marks until the user re-highlights the passage.
//

import Foundation
import SwiftData

enum HighlightMigration {
    /// Check and migrate any old-format EPUB highlights.
    /// Call this once on app launch or when opening the highlights view.
    @MainActor
    static func migrateIfNeeded(modelContext: ModelContext) {
        let descriptor = FetchDescriptor<BookHighlight>()
        guard let allHighlights = try? modelContext.fetch(descriptor) else { return }

        var migrated = 0
        for highlight in allHighlights {
            if migrateHighlight(highlight) {
                migrated += 1
            }
        }

        if migrated > 0 {
            try? modelContext.save()
        }
    }

    /// Attempt to migrate a single highlight's locatorJSON.
    /// Returns true if migration was performed.
    private static func migrateHighlight(_ highlight: BookHighlight) -> Bool {
        guard let data = highlight.locatorJSON.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return false
        }

        // Already migrated or PDF format
        if json["format"] != nil {
            return false
        }

        // Detect Readium Locator format: has "href" and "type" fields
        // but no "format" field
        guard let href = json["href"] as? String else {
            return false
        }

        // Check if this looks like a Readium Locator (has "type" with media type)
        let type = json["type"] as? String ?? ""
        let isReadiumFormat = type.contains("xhtml") || type.contains("xml") || type.contains("html")
            || json["locations"] != nil || json["text"] != nil

        guard isReadiumFormat else {
            return false
        }

        // Extract the chapter href (strip any URL prefix to get relative path)
        var chapterHref = href
        if let url = URL(string: href) {
            chapterHref = url.lastPathComponent
        }

        // Build new format locator (without XPath range data since we can't
        // reconstruct it from Readium's format)
        let newLocator: [String: Any] = [
            "format": "epub",
            "href": chapterHref,
            "migrated": true // Flag indicating this highlight lacks range data
        ]

        if let newData = try? JSONSerialization.data(withJSONObject: newLocator),
           let newJSON = String(data: newData, encoding: .utf8) {
            highlight.locatorJSON = newJSON
            return true
        }

        return false
    }
}
