//
//  ReaderSettings.swift
//  Compendus
//
//  Reader-specific settings for EPUB and PDF readers
//

import Foundation
import SwiftUI
import ReadiumNavigator

// MARK: - Reader Theme

enum ReaderTheme: String, CaseIterable, Identifiable, Hashable {
    case light = "light"
    case dark = "dark"
    case sepia = "sepia"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .light: return "Light"
        case .dark: return "Dark"
        case .sepia: return "Sepia"
        }
    }

    var icon: String {
        switch self {
        case .light: return "sun.max"
        case .dark: return "moon"
        case .sepia: return "book"
        }
    }

    var backgroundColor: UIColor {
        switch self {
        case .light: return UIColor.white
        case .dark: return UIColor.black
        case .sepia: return UIColor(red: 0.957, green: 0.925, blue: 0.91, alpha: 1.0) // #faf4e8
        }
    }

    var textColor: UIColor {
        switch self {
        case .light: return UIColor(red: 0.071, green: 0.071, blue: 0.071, alpha: 1.0) // #121212
        case .dark: return UIColor(red: 0.996, green: 0.996, blue: 0.996, alpha: 1.0) // #FEFEFE
        case .sepia: return UIColor(red: 0.071, green: 0.071, blue: 0.071, alpha: 1.0) // #121212
        }
    }

    var previewColor: SwiftUI.Color {
        SwiftUI.Color(uiColor: backgroundColor)
    }

    var previewBorderColor: SwiftUI.Color {
        switch self {
        case .light: return .gray.opacity(0.3)
        case .dark: return .gray.opacity(0.5)
        case .sepia: return .brown.opacity(0.3)
        }
    }

    /// Maps to Readium's Theme enum
    var readiumTheme: Theme {
        switch self {
        case .light: return .light
        case .dark: return .dark
        case .sepia: return .sepia
        }
    }
}

// MARK: - Reader Font

enum ReaderFont: String, CaseIterable, Identifiable, Hashable {
    case serif = "serif"
    case sansSerif = "sans-serif"
    case openDyslexic = "OpenDyslexic"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .serif: return "Serif"
        case .sansSerif: return "Sans Serif"
        case .openDyslexic: return "OpenDyslexic"
        }
    }

    var description: String {
        switch self {
        case .serif: return "Classic book typography"
        case .sansSerif: return "Clean modern appearance"
        case .openDyslexic: return "Designed for readers with dyslexia"
        }
    }

    /// Maps to Readium's FontFamily type
    var readiumFontFamily: FontFamily {
        switch self {
        case .serif: return .serif
        case .sansSerif: return .sansSerif
        case .openDyslexic: return .openDyslexic
        }
    }

    /// iOS font name for preview text in the settings UI
    var previewFontName: String {
        switch self {
        case .serif: return "Georgia"
        case .sansSerif: return ".AppleSystemUIFont"
        case .openDyslexic: return "OpenDyslexic"
        }
    }
}

// MARK: - Reader Settings

@Observable
class ReaderSettings {
    var theme: ReaderTheme {
        didSet {
            UserDefaults.standard.set(theme.rawValue, forKey: "readerTheme")
        }
    }

    var fontFamily: ReaderFont {
        didSet {
            UserDefaults.standard.set(fontFamily.rawValue, forKey: "readerFontFamily")
        }
    }

    /// Font size multiplier (0.5 = 50%, 1.0 = 100%, 3.0 = 300%)
    var fontSize: Double {
        didSet {
            UserDefaults.standard.set(fontSize, forKey: "readerFontSize")
        }
    }

    /// Line height (1.0 = tight, 2.0 = loose)
    var lineHeight: Double {
        didSet {
            UserDefaults.standard.set(lineHeight, forKey: "readerLineHeight")
        }
    }

    init() {
        self.theme = ReaderTheme(rawValue: UserDefaults.standard.string(forKey: "readerTheme") ?? "light") ?? .light
        self.fontFamily = ReaderFont(rawValue: UserDefaults.standard.string(forKey: "readerFontFamily") ?? "serif") ?? .serif
        self.fontSize = UserDefaults.standard.object(forKey: "readerFontSize") as? Double ?? 1.0
        self.lineHeight = UserDefaults.standard.object(forKey: "readerLineHeight") as? Double ?? 1.4
    }

    /// Build EPUBPreferences from current settings for Readium navigator
    func epubPreferences() -> EPUBPreferences {
        EPUBPreferences(
            fontFamily: fontFamily.readiumFontFamily,
            fontSize: fontSize,
            lineHeight: lineHeight,
            publisherStyles: false,
            theme: theme.readiumTheme
        )
    }
}
