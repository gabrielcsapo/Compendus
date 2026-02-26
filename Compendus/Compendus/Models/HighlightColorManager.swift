//
//  HighlightColorManager.swift
//  Compendus
//
//  Observable manager for user-customizable highlight preset colors.
//  Supports app-wide defaults and per-book custom color sets.
//  Persists to UserDefaults following the ThemeManager pattern.
//

import Foundation
import SwiftUI

struct HighlightPresetColor: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var hex: String

    init(id: String = UUID().uuidString, name: String, hex: String) {
        self.id = id
        self.name = name
        self.hex = hex
    }
}

@Observable
class HighlightColorManager {
    var colors: [HighlightPresetColor] {
        didSet { persistColors() }
    }

    /// Per-book custom color sets. When a book has an entry, those colors
    /// are used instead of app-wide defaults.
    var bookColors: [String: [HighlightPresetColor]] {
        didSet { persistBookColors() }
    }

    static let maxColors = 5
    static let minColors = 1

    static let defaultColors: [HighlightPresetColor] = [
        HighlightPresetColor(id: "default-yellow", name: "Highlight", hex: "#ffeb3b"),
        HighlightPresetColor(id: "default-blue", name: "Note", hex: "#42a5f5"),
        HighlightPresetColor(id: "default-pink", name: "Important", hex: "#ef5350"),
    ]

    var canAddMore: Bool {
        colors.count < Self.maxColors
    }

    var canRemove: Bool {
        colors.count > Self.minColors
    }

    init() {
        if let data = UserDefaults.standard.data(forKey: "highlightPresetColors"),
           let saved = try? JSONDecoder().decode([HighlightPresetColor].self, from: data),
           !saved.isEmpty {
            self.colors = saved
        } else {
            self.colors = Self.defaultColors
        }

        if let data = UserDefaults.standard.data(forKey: "highlightBookColors"),
           let saved = try? JSONDecoder().decode([String: [HighlightPresetColor]].self, from: data) {
            self.bookColors = saved
        } else {
            self.bookColors = [:]
        }

        // Migration: convert old per-book label overrides to per-book color sets
        if bookColors.isEmpty,
           let oldData = UserDefaults.standard.data(forKey: "highlightBookLabels"),
           let oldLabels = try? JSONDecoder().decode([String: [String: String]].self, from: oldData),
           !oldLabels.isEmpty {
            var migrated: [String: [HighlightPresetColor]] = [:]
            for (bookId, labelOverrides) in oldLabels {
                var bookSet = self.colors
                for i in bookSet.indices {
                    if let overrideName = labelOverrides[bookSet[i].id], !overrideName.isEmpty {
                        bookSet[i].name = overrideName
                    }
                }
                migrated[bookId] = bookSet
            }
            self.bookColors = migrated
            UserDefaults.standard.removeObject(forKey: "highlightBookLabels")
        }
    }

    // MARK: - App-wide color management

    func addColor(name: String, hex: String) {
        guard canAddMore else { return }
        colors.append(HighlightPresetColor(name: name, hex: hex))
    }

    func removeColor(id: String) {
        guard canRemove else { return }
        colors.removeAll { $0.id == id }
    }

    func updateColor(id: String, name: String, hex: String) {
        guard let index = colors.firstIndex(where: { $0.id == id }) else { return }
        colors[index].name = name
        colors[index].hex = hex
    }

    func moveColor(from source: IndexSet, to destination: Int) {
        colors.move(fromOffsets: source, toOffset: destination)
    }

    func resetToDefaults() {
        colors = Self.defaultColors
    }

    // MARK: - Per-book colors

    /// Whether a book has custom colors (not using app-wide defaults)
    func hasCustomColors(for bookId: String) -> Bool {
        bookColors[bookId] != nil
    }

    /// Set a complete custom color set for a book
    func setBookColors(_ colors: [HighlightPresetColor], for bookId: String) {
        bookColors[bookId] = colors
    }

    /// Remove per-book custom colors, reverting to app-wide defaults
    func resetBookColors(for bookId: String) {
        bookColors.removeValue(forKey: bookId)
    }

    /// Returns colors resolved for a specific book.
    /// If the book has custom colors, uses those; otherwise uses app-wide defaults.
    func colorsForBook(_ bookId: String?) -> [(preset: HighlightPresetColor, label: String)] {
        let resolved: [HighlightPresetColor]
        if let bookId, let custom = bookColors[bookId] {
            resolved = custom
        } else {
            resolved = colors
        }
        return resolved.map { ($0, $0.name) }
    }

    func addBookColor(name: String, hex: String, for bookId: String) {
        var bookSet = bookColors[bookId] ?? colors
        guard bookSet.count < Self.maxColors else { return }
        bookSet.append(HighlightPresetColor(name: name, hex: hex))
        bookColors[bookId] = bookSet
    }

    func removeBookColor(id: String, for bookId: String) {
        guard var bookSet = bookColors[bookId], bookSet.count > Self.minColors else { return }
        bookSet.removeAll { $0.id == id }
        bookColors[bookId] = bookSet
    }

    func updateBookColor(id: String, name: String, hex: String, for bookId: String) {
        guard var bookSet = bookColors[bookId],
              let index = bookSet.firstIndex(where: { $0.id == id }) else { return }
        bookSet[index].name = name
        bookSet[index].hex = hex
        bookColors[bookId] = bookSet
    }

    func moveBookColor(from source: IndexSet, to destination: Int, for bookId: String) {
        guard var bookSet = bookColors[bookId] else { return }
        bookSet.move(fromOffsets: source, toOffset: destination)
        bookColors[bookId] = bookSet
    }

    // MARK: - Persistence

    private func persistColors() {
        if let data = try? JSONEncoder().encode(colors) {
            UserDefaults.standard.set(data, forKey: "highlightPresetColors")
        }
    }

    private func persistBookColors() {
        if let data = try? JSONEncoder().encode(bookColors) {
            UserDefaults.standard.set(data, forKey: "highlightBookColors")
        }
    }
}
