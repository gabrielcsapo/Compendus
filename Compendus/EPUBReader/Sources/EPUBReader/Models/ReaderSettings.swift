//
//  ReaderSettings.swift
//  Compendus
//
//  Reader-specific settings for EPUB and PDF readers
//

import Foundation
import SwiftUI

// MARK: - Reader Theme

public enum ReaderTheme: String, CaseIterable, Identifiable, Hashable {
    case light = "light"
    case dark = "dark"
    case sepia = "sepia"

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .light: return "Light"
        case .dark: return "Dark"
        case .sepia: return "Sepia"
        }
    }

    public var icon: String {
        switch self {
        case .light: return "sun.max"
        case .dark: return "moon"
        case .sepia: return "book"
        }
    }

    public var backgroundColor: UIColor {
        switch self {
        case .light: return UIColor.white
        case .dark: return UIColor(red: 0.11, green: 0.11, blue: 0.118, alpha: 1.0) // #1C1C1E
        case .sepia: return UIColor(red: 0.957, green: 0.925, blue: 0.91, alpha: 1.0) // #faf4e8
        }
    }

    public var textColor: UIColor {
        switch self {
        case .light: return UIColor(red: 0.071, green: 0.071, blue: 0.071, alpha: 1.0) // #121212
        case .dark: return UIColor(red: 0.996, green: 0.996, blue: 0.996, alpha: 1.0) // #FEFEFE
        case .sepia: return UIColor(red: 0.071, green: 0.071, blue: 0.071, alpha: 1.0) // #121212
        }
    }

    public var previewColor: SwiftUI.Color {
        SwiftUI.Color(uiColor: backgroundColor)
    }

    public var previewBorderColor: SwiftUI.Color {
        switch self {
        case .light: return .gray.opacity(0.3)
        case .dark: return .gray.opacity(0.5)
        case .sepia: return .brown.opacity(0.3)
        }
    }

    /// CSS hex color string for the background
    public var backgroundColorHex: String {
        backgroundColor.hexString
    }

    /// CSS hex color string for the text
    public var textColorHex: String {
        textColor.hexString
    }

    /// SwiftUI ColorScheme for sheets and controls
    public var colorScheme: ColorScheme {
        switch self {
        case .dark: return .dark
        case .light, .sepia: return .light
        }
    }

    /// Semi-transparent overlay background matching the theme
    public var overlayBackgroundColor: UIColor {
        backgroundColor.withAlphaComponent(0.6)
    }

    /// Secondary container background (e.g. page indicator pill)
    public var secondaryBackgroundColor: UIColor {
        switch self {
        case .light: return UIColor.systemFill
        case .dark: return UIColor(white: 0.2, alpha: 1.0)
        case .sepia: return UIColor(red: 0.92, green: 0.89, blue: 0.85, alpha: 1.0)
        }
    }

    /// Border color for small controls (e.g. color picker circles)
    public var borderColor: UIColor {
        switch self {
        case .light: return UIColor.black.withAlphaComponent(0.15)
        case .dark: return UIColor.white.withAlphaComponent(0.3)
        case .sepia: return UIColor.brown.withAlphaComponent(0.25)
        }
    }

    /// Placeholder/skeleton fill color
    public var placeholderColor: UIColor {
        switch self {
        case .light: return UIColor.systemGray5
        case .dark: return UIColor(white: 0.18, alpha: 1.0)
        case .sepia: return UIColor(red: 0.91, green: 0.88, blue: 0.83, alpha: 1.0)
        }
    }

    /// Loading indicator track color
    public var loadingTrackColor: UIColor {
        textColor.withAlphaComponent(0.15)
    }

    /// Loading indicator bar color
    public var loadingBarColor: UIColor {
        textColor.withAlphaComponent(0.6)
    }
}

// MARK: - Reader Layout

public enum ReaderLayout: String, CaseIterable, Identifiable, Hashable {
    case auto = "auto"
    case single = "single"
    case twoPage = "twoPage"

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .auto: return "Auto"
        case .single: return "Single Page"
        case .twoPage: return "Two Pages"
        }
    }

    public var icon: String {
        switch self {
        case .auto: return "rectangle.split.2x1"
        case .single: return "rectangle"
        case .twoPage: return "rectangle.split.2x1.fill"
        }
    }
}

// MARK: - Reader Font

public enum ReaderFont: String, CaseIterable, Identifiable, Hashable {
    case serif = "serif"
    case sansSerif = "sans-serif"
    case bookerly = "Bookerly"
    case amazonEmber = "AmazonEmber"
    case dejaVuSansMono = "DejaVuSansMono"
    case openDyslexic = "OpenDyslexic"

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .serif: return "Serif"
        case .sansSerif: return "Sans Serif"
        case .bookerly: return "Bookerly"
        case .amazonEmber: return "Amazon Ember"
        case .dejaVuSansMono: return "DejaVu Sans Mono"
        case .openDyslexic: return "OpenDyslexic"
        }
    }

    public var description: String {
        switch self {
        case .serif: return "Classic book typography"
        case .sansSerif: return "Clean modern appearance"
        case .bookerly: return "Designed for comfortable reading"
        case .amazonEmber: return "Modern, clean display typeface"
        case .dejaVuSansMono: return "Monospace with broad character coverage"
        case .openDyslexic: return "Designed for readers with dyslexia"
        }
    }

    /// CSS font-family value for WKWebView injection
    public var cssFontFamily: String {
        switch self {
        case .serif: return "Georgia, 'Times New Roman', serif"
        case .sansSerif: return "-apple-system, 'Helvetica Neue', sans-serif"
        case .bookerly: return "'Bookerly', Georgia, serif"
        case .amazonEmber: return "'Amazon Ember', 'Helvetica Neue', sans-serif"
        case .dejaVuSansMono: return "'DejaVu Sans Mono', monospace"
        case .openDyslexic: return "'OpenDyslexic', sans-serif"
        }
    }

    /// iOS PostScript font name for UIFont / SwiftUI preview
    public var previewFontName: String {
        switch self {
        case .serif: return "Georgia"
        case .sansSerif: return ".AppleSystemUIFont"
        case .bookerly: return "Bookerly-Regular"
        case .amazonEmber: return "AmazonEmber-Bold"
        case .dejaVuSansMono: return "DejaVuSansMono"
        case .openDyslexic: return "OpenDyslexic"
        }
    }

    /// Whether this font requires a bundled @font-face declaration for WKWebView
    public var isCustomBundled: Bool {
        switch self {
        case .bookerly, .amazonEmber, .dejaVuSansMono: return true
        default: return false
        }
    }

    /// Bundle font file descriptor for custom fonts (nil for system fonts)
    public var bundledFontFile: (name: String, ext: String, cssFamily: String, weight: String)? {
        switch self {
        case .bookerly: return ("Bookerly-Regular", "ttf", "Bookerly", "normal")
        case .amazonEmber: return ("Amazon-Ember-Bold", "ttf", "Amazon Ember", "bold")
        case .dejaVuSansMono: return ("DejaVuSansMono", "ttf", "DejaVu Sans Mono", "normal")
        default: return nil
        }
    }
}

// MARK: - Reader Settings

@MainActor
@Observable
public class ReaderSettings {
    public var theme: ReaderTheme {
        didSet {
            UserDefaults.standard.set(theme.rawValue, forKey: "readerTheme")
        }
    }

    public var fontFamily: ReaderFont {
        didSet {
            UserDefaults.standard.set(fontFamily.rawValue, forKey: "readerFontFamily")
        }
    }

    /// Font size in pixels (e.g. 16, 18, 20, 24)
    public var fontSize: Double {
        didSet {
            UserDefaults.standard.set(fontSize, forKey: "readerFontSize")
        }
    }

    /// Line height (1.0 = tight, 2.0 = loose)
    public var lineHeight: Double {
        didSet {
            UserDefaults.standard.set(lineHeight, forKey: "readerLineHeight")
        }
    }

    /// Page layout (auto, single, twoPage)
    public var layout: ReaderLayout {
        didSet {
            UserDefaults.standard.set(layout.rawValue, forKey: "readerLayout")
        }
    }

    public init() {
        self.theme = ReaderTheme(rawValue: UserDefaults.standard.string(forKey: "readerTheme") ?? "light") ?? .light
        self.fontFamily = ReaderFont(rawValue: UserDefaults.standard.string(forKey: "readerFontFamily") ?? "serif") ?? .serif

        // Migrate from old multiplier format (0.5-3.0) to pixel format (12-36)
        let storedSize = UserDefaults.standard.object(forKey: "readerFontSize") as? Double ?? 18.0
        if storedSize <= 5.0 {
            // Old multiplier format — convert to pixels
            let convertedSize = round(storedSize * 16)
            self.fontSize = convertedSize
            UserDefaults.standard.set(convertedSize, forKey: "readerFontSize")
        } else {
            self.fontSize = storedSize
        }

        self.lineHeight = UserDefaults.standard.object(forKey: "readerLineHeight") as? Double ?? 1.4
        self.layout = ReaderLayout(rawValue: UserDefaults.standard.string(forKey: "readerLayout") ?? "auto") ?? .auto
    }

    /// Resolve the effective layout for a given viewport width.
    public func resolvedLayout(for viewportWidth: CGFloat) -> ReaderLayout {
        switch layout {
        case .auto:
            return viewportWidth >= 700 ? .twoPage : .single
        case .single, .twoPage:
            return layout
        }
    }

    // MARK: - Native Font Properties

    /// Native UIFont for body text
    public var nativeFont: UIFont {
        let size = CGFloat(fontSize)
        if let font = UIFont(name: fontFamily.previewFontName, size: size) {
            return font
        }
        switch fontFamily {
        case .sansSerif: return .systemFont(ofSize: size)
        default: return UIFont(name: "Georgia", size: size) ?? .systemFont(ofSize: size)
        }
    }

    /// Native UIFont for bold text
    public var nativeBoldFont: UIFont {
        let size = CGFloat(fontSize)
        let base = nativeFont
        if let descriptor = base.fontDescriptor.withSymbolicTraits(.traitBold) {
            return UIFont(descriptor: descriptor, size: size)
        }
        return .boldSystemFont(ofSize: size)
    }

    /// Native UIFont for italic text
    public var nativeItalicFont: UIFont {
        let size = CGFloat(fontSize)
        let base = nativeFont
        if let descriptor = base.fontDescriptor.withSymbolicTraits(.traitItalic) {
            return UIFont(descriptor: descriptor, size: size)
        }
        return .italicSystemFont(ofSize: size)
    }

    /// Native UIFont for bold italic text
    public var nativeBoldItalicFont: UIFont {
        let size = CGFloat(fontSize)
        let base = nativeFont
        if let descriptor = base.fontDescriptor.withSymbolicTraits([.traitBold, .traitItalic]) {
            return UIFont(descriptor: descriptor, size: size)
        }
        return .boldSystemFont(ofSize: size)
    }

    /// Native monospace font for code
    public var nativeMonoFont: UIFont {
        let size = CGFloat(fontSize) * 0.9
        return .monospacedSystemFont(ofSize: size, weight: .regular)
    }

    /// Native paragraph style with line height and justified alignment
    public var nativeParagraphStyle: NSMutableParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.lineHeightMultiple = CGFloat(lineHeight)
        style.paragraphSpacing = CGFloat(fontSize) * 0.5
        style.alignment = .justified
        style.hyphenationFactor = 1.0
        return style
    }
}

// MARK: - Reader Theme Sheet Modifier

public extension View {
    /// Styles a sheet to match the current reader theme (background, color scheme, transparent list backgrounds).
    func readerThemed(_ settings: ReaderSettings) -> some View {
        self
            .preferredColorScheme(settings.theme.colorScheme)
            .presentationBackground(Color(uiColor: settings.theme.backgroundColor))
            .scrollContentBackground(.hidden)
    }
}
