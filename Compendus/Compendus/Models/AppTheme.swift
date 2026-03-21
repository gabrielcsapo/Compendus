//
//  AppTheme.swift
//  Compendus
//
//  Custom app theme with adaptive accent colors for light and dark modes
//

import Foundation
import SwiftUI
import UIKit
import EPUBReader

struct AppTheme: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let isBuiltIn: Bool
    let accentLightHex: String
    let accentDarkHex: String

    /// Returns the accent color for a specific color scheme
    func accentColor(for scheme: ColorScheme) -> Color {
        let hex = scheme == .dark ? accentDarkHex : accentLightHex
        if let uiColor = UIColor(hex: hex) {
            return Color(uiColor: uiColor)
        }
        return .blue
    }

    /// A dynamic color that automatically adapts to the current light/dark mode
    var adaptiveAccentColor: Color {
        let lightColor = UIColor(hex: accentLightHex) ?? .systemBlue
        let darkColor = UIColor(hex: accentDarkHex) ?? .systemBlue
        return Color(uiColor: UIColor { traitCollection in
            traitCollection.userInterfaceStyle == .dark ? darkColor : lightColor
        })
    }
}

// MARK: - Built-in Themes

extension AppTheme {
    static let builtInThemes: [AppTheme] = [
        defaultTheme, rose, ocean, forest, amber
    ]

    static let defaultTheme = AppTheme(
        id: "default",
        name: "Default",
        isBuiltIn: true,
        accentLightHex: "#3B86F6",
        accentDarkHex: "#5A9DF6"
    )

    static let rose = AppTheme(
        id: "rose",
        name: "Rose",
        isBuiltIn: true,
        accentLightHex: "#D4849B",
        accentDarkHex: "#F9D2E5"
    )

    static let ocean = AppTheme(
        id: "ocean",
        name: "Ocean",
        isBuiltIn: true,
        accentLightHex: "#0F8A7E",
        accentDarkHex: "#2DD4BF"
    )

    static let forest = AppTheme(
        id: "forest",
        name: "Forest",
        isBuiltIn: true,
        accentLightHex: "#3D8B37",
        accentDarkHex: "#6BCB65"
    )

    static let amber = AppTheme(
        id: "amber",
        name: "Amber",
        isBuiltIn: true,
        accentLightHex: "#D97706",
        accentDarkHex: "#FBBF24"
    )
}

// MARK: - Custom Theme Factory

extension AppTheme {
    /// Creates a custom theme from a single seed hex color.
    /// The seed is used as the dark-mode accent; a darkened variant is derived for light mode.
    static func custom(name: String, seedHex: String) -> AppTheme {
        let darkHex = seedHex
        let lightHex = darkenedHex(seedHex, by: 0.25)
        return AppTheme(
            id: UUID().uuidString,
            name: name,
            isBuiltIn: false,
            accentLightHex: lightHex,
            accentDarkHex: darkHex
        )
    }

    /// Darkens a hex color by the given fraction (0.0–1.0)
    private static func darkenedHex(_ hex: String, by fraction: CGFloat) -> String {
        guard let uiColor = UIColor(hex: hex) else { return hex }
        var h: CGFloat = 0, s: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        uiColor.getHue(&h, saturation: &s, brightness: &b, alpha: &a)
        let darker = UIColor(
            hue: h,
            saturation: min(s + 0.1, 1.0),
            brightness: max(b - fraction, 0.0),
            alpha: a
        )
        return darker.hexString
    }
}
