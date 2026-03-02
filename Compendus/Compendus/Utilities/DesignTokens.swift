//
//  DesignTokens.swift
//  Compendus
//
//  Centralized design system tokens for consistent spacing, radii,
//  shadows, opacity, and typography across the app.
//

import SwiftUI

// MARK: - Spacing

enum Spacing {
    /// 2pt — hairline gaps
    static let xxs: CGFloat = 2
    /// 4pt — tight spacing (between icon and label, inline elements)
    static let xs: CGFloat = 4
    /// 8pt — compact spacing (list item internal padding)
    static let sm: CGFloat = 8
    /// 12pt — standard spacing (section gaps, card internal padding)
    static let md: CGFloat = 12
    /// 16pt — comfortable spacing (between cards, horizontal padding)
    static let lg: CGFloat = 16
    /// 20pt — generous spacing (screen edge padding)
    static let xl: CGFloat = 20
    /// 24pt — section spacing
    static let xxl: CGFloat = 24
    /// 32pt — large section breaks
    static let xxxl: CGFloat = 32
}

// MARK: - Corner Radius

enum Radius {
    /// 4pt — small elements (progress bars, thumbnails, badges)
    static let small: CGFloat = 4
    /// 6pt — book covers, compact cards
    static let medium: CGFloat = 6
    /// 8pt — standard cards, buttons
    static let standard: CGFloat = 8
    /// 12pt — large cards, sections
    static let large: CGFloat = 12
    /// 14pt — floating toolbars, prominent UI
    static let xlarge: CGFloat = 14
}

// MARK: - Shadows

struct ShadowStyle {
    let color: Color
    let radius: CGFloat
    let x: CGFloat
    let y: CGFloat
}

enum Shadow {
    /// Subtle lift — cards in lists
    static let subtle = ShadowStyle(color: .black.opacity(0.05), radius: 2, x: 0, y: 1)
    /// Light — book covers, floating elements
    static let light = ShadowStyle(color: .black.opacity(0.12), radius: 3, x: 0, y: 2)
    /// Medium — hero covers, modals
    static let medium = ShadowStyle(color: .black.opacity(0.15), radius: 6, x: 0, y: 3)
    /// Elevated — prominent floating UI (toolbars, popovers)
    static let elevated = ShadowStyle(color: .black.opacity(0.2), radius: 8, x: 0, y: 4)
}

extension View {
    func shadow(_ style: ShadowStyle) -> some View {
        self.shadow(color: style.color, radius: style.radius, x: style.x, y: style.y)
    }
}

// MARK: - Opacity

enum Opacity {
    /// 0.05 — very faint overlays, subtle shadows
    static let faint: Double = 0.05
    /// 0.1 — light overlays, hover states
    static let light: Double = 0.1
    /// 0.15 — medium overlays, dimming
    static let medium: Double = 0.15
    /// 0.2 — heavy overlays
    static let heavy: Double = 0.2
    /// 0.3 — dark overlays, scrims
    static let scrim: Double = 0.3
    /// 0.6 — backdrop blur overlays
    static let backdrop: Double = 0.6
}

// MARK: - Icon Sizes

enum IconSize {
    /// 12pt — inline tiny icons
    static let tiny: CGFloat = 12
    /// 17pt — standard body icons (SF Symbols in body text)
    static let body: CGFloat = 17
    /// 22pt — toolbar/nav icons
    static let toolbar: CGFloat = 22
    /// 40pt — empty state icons
    static let emptyState: CGFloat = 40
    /// 48pt — hero icons
    static let hero: CGFloat = 48
}
