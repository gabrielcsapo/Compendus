//
//  HighlightColorManager.swift
//  Compendus
//
//  Observable manager for user-customizable highlight preset colors.
//  Supports app-wide default labels and per-book label overrides.
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

    /// Per-book label overrides: [bookId: [colorId: label]]
    var bookLabels: [String: [String: String]] {
        didSet { persistBookLabels() }
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

        if let data = UserDefaults.standard.data(forKey: "highlightBookLabels"),
           let saved = try? JSONDecoder().decode([String: [String: String]].self, from: data) {
            self.bookLabels = saved
        } else {
            self.bookLabels = [:]
        }
    }

    // MARK: - Color management

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

    // MARK: - Per-book labels

    /// Get the label for a color, resolving per-book overrides
    func label(for colorId: String, bookId: String?) -> String {
        if let bookId,
           let overrides = bookLabels[bookId],
           let label = overrides[colorId],
           !label.isEmpty {
            return label
        }
        return colors.first { $0.id == colorId }?.name ?? ""
    }

    /// Set a per-book label override for a color
    func setLabel(for colorId: String, bookId: String, label: String) {
        var overrides = bookLabels[bookId] ?? [:]
        let defaultName = colors.first { $0.id == colorId }?.name ?? ""
        if label == defaultName || label.isEmpty {
            overrides.removeValue(forKey: colorId)
        } else {
            overrides[colorId] = label
        }
        if overrides.isEmpty {
            bookLabels.removeValue(forKey: bookId)
        } else {
            bookLabels[bookId] = overrides
        }
    }

    /// Remove all per-book label overrides for a book
    func resetLabels(for bookId: String) {
        bookLabels.removeValue(forKey: bookId)
    }

    /// Returns colors with labels resolved for a specific book
    func colorsForBook(_ bookId: String?) -> [(preset: HighlightPresetColor, label: String)] {
        colors.map { preset in
            (preset: preset, label: label(for: preset.id, bookId: bookId))
        }
    }

    // MARK: - Persistence

    private func persistColors() {
        if let data = try? JSONEncoder().encode(colors) {
            UserDefaults.standard.set(data, forKey: "highlightPresetColors")
        }
    }

    private func persistBookLabels() {
        if let data = try? JSONEncoder().encode(bookLabels) {
            UserDefaults.standard.set(data, forKey: "highlightBookLabels")
        }
    }
}
