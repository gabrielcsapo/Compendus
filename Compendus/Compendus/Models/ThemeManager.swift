//
//  ThemeManager.swift
//  Compendus
//
//  Observable theme engine that persists theme selection and syncs to widget
//

import Foundation
import SwiftUI
import WidgetKit

@Observable
class ThemeManager {
    var activeTheme: AppTheme {
        didSet { persist() }
    }

    var customThemes: [AppTheme] {
        didSet { persistCustomThemes() }
    }

    /// Dynamic accent color that adapts to light/dark mode automatically
    var accentColor: Color {
        activeTheme.adaptiveAccentColor
    }

    /// All available themes (built-in + custom)
    var allThemes: [AppTheme] {
        AppTheme.builtInThemes + customThemes
    }

    init() {
        // Load active theme
        let savedId = UserDefaults.standard.string(forKey: "activeThemeId") ?? "default"

        // Load custom themes
        var loaded: [AppTheme] = []
        if let data = UserDefaults.standard.data(forKey: "customThemes") {
            loaded = (try? JSONDecoder().decode([AppTheme].self, from: data)) ?? []
        }
        self.customThemes = loaded

        // Find active theme from built-ins or customs
        let all = AppTheme.builtInThemes + loaded
        self.activeTheme = all.first(where: { $0.id == savedId }) ?? .defaultTheme
    }

    func setActiveTheme(_ theme: AppTheme) {
        activeTheme = theme
    }

    func addCustomTheme(name: String, seedHex: String) {
        let theme = AppTheme.custom(name: name, seedHex: seedHex)
        customThemes.append(theme)
        activeTheme = theme
    }

    func deleteCustomTheme(id: String) {
        customThemes.removeAll { $0.id == id }
        if activeTheme.id == id {
            activeTheme = .defaultTheme
        }
    }

    // MARK: - Persistence

    private func persist() {
        UserDefaults.standard.set(activeTheme.id, forKey: "activeThemeId")
        syncToWidget()
    }

    private func persistCustomThemes() {
        if let data = try? JSONEncoder().encode(customThemes) {
            UserDefaults.standard.set(data, forKey: "customThemes")
        }
    }

    private func syncToWidget() {
        guard let shared = UserDefaults(suiteName: appGroupIdentifier) else { return }
        shared.set(activeTheme.accentLightHex, forKey: "themeAccentLightHex")
        shared.set(activeTheme.accentDarkHex, forKey: "themeAccentDarkHex")
        WidgetCenter.shared.reloadAllTimelines()
    }
}
