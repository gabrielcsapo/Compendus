//
//  GuidedViewFAB.swift
//  Compendus
//
//  Prominent floating toggle for panel-by-panel "guided view" in the comic
//  reader. The icon is a custom masonry-style grid of comic panels — when
//  the FAB is on, one panel lights up in the accent color so the metaphor
//  ("highlight the boxes") is immediately readable.
//

import SwiftUI

struct GuidedViewFAB: View {
    @Binding var isOn: Bool

    private let diameter: CGFloat = 64

    var body: some View {
        Button {
            isOn.toggle()
            HapticFeedback.lightImpact()
        } label: {
            ZStack {
                Circle()
                    .fill(.ultraThinMaterial)
                    .overlay(
                        Circle()
                            .stroke(isOn ? Color.accentColor.opacity(0.55) : .white.opacity(0.25),
                                    lineWidth: isOn ? 1.5 : 0.5)
                    )

                PanelGridIcon(highlight: isOn)
                    .frame(width: diameter * 0.5, height: diameter * 0.5)
            }
            .frame(width: diameter, height: diameter)
            .shadow(color: .black.opacity(0.25), radius: 6, y: 2)
            .animation(.spring(response: 0.35, dampingFraction: 0.7), value: isOn)
        }
        .accessibilityLabel(isOn ? "Exit panel-by-panel view" : "Read panel by panel")
    }
}

/// Masonry-style icon depicting a comic page laid out as five panels of
/// mixed sizes. In the `highlight` state, the largest panel is tinted with
/// the accent color and the others are dimmed — visualizing the guided-view
/// behavior of focusing one panel at a time.
private struct PanelGridIcon: View {
    let highlight: Bool

    var body: some View {
        Canvas { context, size in
            // Layout uses a 5×5 unit grid for crisp proportions at any size.
            let unit = min(size.width, size.height) / 5
            let gap: CGFloat = max(1, unit * 0.18)
            let radius: CGFloat = unit * 0.18

            // Five panels in a comic-style masonry layout:
            //   ┌──────┬───┐
            //   │  A   │ B │
            //   ├──┬───┴───┤
            //   │C │   D   │
            //   ├──┴───────┤
            //   │     E    │
            //   └──────────┘
            let panels: [(rect: CGRect, isPrimary: Bool)] = [
                (CGRect(x: 0, y: 0, width: unit * 3, height: unit * 2), true),                // A — primary
                (CGRect(x: unit * 3 + gap, y: 0, width: unit * 2 - gap, height: unit * 2), false), // B
                (CGRect(x: 0, y: unit * 2 + gap, width: unit * 2, height: unit * 1.5 - gap), false), // C
                (CGRect(x: unit * 2 + gap, y: unit * 2 + gap, width: unit * 3 - gap, height: unit * 1.5 - gap), false), // D
                (CGRect(x: 0, y: unit * 3.5 + gap, width: unit * 5, height: unit * 1.5 - gap), false) // E
            ]

            for panel in panels {
                let path = Path(roundedRect: panel.rect, cornerRadius: radius)
                if highlight && panel.isPrimary {
                    context.fill(path, with: .color(.accentColor))
                } else if highlight {
                    context.fill(path, with: .color(.primary.opacity(0.35)))
                } else {
                    context.fill(path, with: .color(.primary.opacity(0.78)))
                }
            }
        }
    }
}
