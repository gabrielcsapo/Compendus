//
//  WidgetDataManager.swift
//  Compendus
//
//  Shared data manager for widget communication using App Group UserDefaults
//

import Foundation

/// App Group identifier - must match the one configured in Xcode Signing & Capabilities
let appGroupIdentifier = "group.com.gabrielcsapo.Compendus.shared"

/// Lightweight book data structure for widget display
struct WidgetBook: Codable {
    let id: String
    let title: String
    let author: String
    let format: String
    let progress: Double
    let coverData: Data?
    let lastReadAt: Date

    var progressPercentage: Int {
        Int(progress * 100)
    }

    var formatIcon: String {
        switch format.lowercased() {
        case "epub", "mobi", "azw", "azw3":
            return "book.closed.fill"
        case "pdf":
            return "doc.fill"
        case "cbr", "cbz":
            return "book.pages.fill"
        case "m4b", "mp3", "m4a":
            return "headphones"
        default:
            return "book.fill"
        }
    }

    var isAudiobook: Bool {
        ["m4b", "mp3", "m4a"].contains(format.lowercased())
    }
}

/// Manager for reading/writing widget data via App Group UserDefaults
class WidgetDataManager {
    static let shared = WidgetDataManager()

    private let currentBookKey = "currentlyReadingBook"

    private var sharedDefaults: UserDefaults? {
        UserDefaults(suiteName: appGroupIdentifier)
    }

    private init() {}

    /// Save the currently reading book for widget display
    func saveCurrentBook(_ book: WidgetBook) {
        guard let defaults = sharedDefaults else {
            print("[WidgetDataManager] Failed to access shared UserDefaults")
            return
        }

        do {
            let data = try JSONEncoder().encode(book)
            defaults.set(data, forKey: currentBookKey)
            print("[WidgetDataManager] Saved book: \(book.title)")
        } catch {
            print("[WidgetDataManager] Failed to encode book: \(error)")
        }
    }

    /// Get the currently reading book for widget display
    func getCurrentBook() -> WidgetBook? {
        guard let defaults = sharedDefaults,
              let data = defaults.data(forKey: currentBookKey) else {
            return nil
        }

        do {
            return try JSONDecoder().decode(WidgetBook.self, from: data)
        } catch {
            print("[WidgetDataManager] Failed to decode book: \(error)")
            return nil
        }
    }

    /// Clear the currently reading book
    func clearCurrentBook() {
        sharedDefaults?.removeObject(forKey: currentBookKey)
    }
}
