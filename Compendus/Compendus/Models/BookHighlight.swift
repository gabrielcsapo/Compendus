//
//  BookHighlight.swift
//  Compendus
//
//  SwiftData model for locally stored book highlights
//

import Foundation
import UIKit
import SwiftData

@Model
final class BookHighlight {
    @Attribute(.unique) var id: String
    var bookId: String
    var locatorJSON: String       // Serialized Readium Locator for precise position
    var text: String              // The highlighted text
    var note: String?             // Optional user note
    var color: String             // Hex color (e.g. "#ffff00")
    var progression: Double       // 0.0 - 1.0 position in book
    var chapterTitle: String?     // Chapter name for display
    var createdAt: Date

    init(
        id: String = UUID().uuidString,
        bookId: String,
        locatorJSON: String,
        text: String,
        note: String? = nil,
        color: String = "#ffff00",
        progression: Double = 0.0,
        chapterTitle: String? = nil,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.bookId = bookId
        self.locatorJSON = locatorJSON
        self.text = text
        self.note = note
        self.color = color
        self.progression = progression
        self.chapterTitle = chapterTitle
        self.createdAt = createdAt
    }

    /// Available highlight colors
    static let colors: [(name: String, hex: String)] = [
        ("Yellow", "#ffeb3b"),
        ("Blue", "#42a5f5"),
        ("Pink", "#ef5350"),
    ]

    /// Convert hex string to UIColor
    var uiColor: UIColor {
        UIColor(hex: color) ?? .yellow
    }
}

// MARK: - UIColor hex extension

extension UIColor {
    convenience init?(hex: String) {
        var hexSanitized = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        hexSanitized = hexSanitized.replacingOccurrences(of: "#", with: "")

        var rgb: UInt64 = 0
        guard Scanner(string: hexSanitized).scanHexInt64(&rgb) else { return nil }

        let r, g, b, a: CGFloat
        switch hexSanitized.count {
        case 6:
            r = CGFloat((rgb & 0xFF0000) >> 16) / 255.0
            g = CGFloat((rgb & 0x00FF00) >> 8) / 255.0
            b = CGFloat(rgb & 0x0000FF) / 255.0
            a = 1.0
        case 8:
            r = CGFloat((rgb & 0xFF000000) >> 24) / 255.0
            g = CGFloat((rgb & 0x00FF0000) >> 16) / 255.0
            b = CGFloat((rgb & 0x0000FF00) >> 8) / 255.0
            a = CGFloat(rgb & 0x000000FF) / 255.0
        default:
            return nil
        }

        self.init(red: r, green: g, blue: b, alpha: a)
    }

    var hexString: String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        getRed(&r, green: &g, blue: &b, alpha: &a)
        return String(format: "#%02x%02x%02x", Int(r * 255), Int(g * 255), Int(b * 255))
    }
}
