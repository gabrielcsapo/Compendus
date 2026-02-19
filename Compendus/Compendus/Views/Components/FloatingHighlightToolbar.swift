//
//  FloatingHighlightToolbar.swift
//  Compendus
//
//  Floating color picker toolbar that appears near selected text.
//  Styled to resemble the native iOS text callout bar.
//

import SwiftUI

struct FloatingHighlightToolbar: View {
    let selectionRect: CGRect
    let containerSize: CGSize
    let onSelectColor: (String) -> Void
    let onCustomColor: () -> Void
    let onAddNote: () -> Void
    let onCopy: () -> Void
    let onDismiss: () -> Void

    // Show above selection when there's enough room; otherwise below.
    private var showAbove: Bool {
        selectionRect.minY > 60
    }

    private var toolbarY: CGFloat {
        if showAbove {
            return selectionRect.minY - 10
        } else {
            return selectionRect.maxY + 10
        }
    }

    private var toolbarX: CGFloat {
        let half: CGFloat = 130
        let x = selectionRect.midX
        return max(half, min(x, containerSize.width - half))
    }

    var body: some View {
        ZStack {
            // Tap-to-dismiss background
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { onDismiss() }

            // Toolbar
            HStack(spacing: 0) {
                // Preset colors
                ForEach(BookHighlight.colors, id: \.hex) { color in
                    Button {
                        onSelectColor(color.hex)
                    } label: {
                        Circle()
                            .fill(Color(uiColor: UIColor(hex: color.hex) ?? .yellow))
                            .frame(width: 26, height: 26)
                    }
                    .padding(.horizontal, 6)
                }

                separator

                // Custom color picker
                Button {
                    onCustomColor()
                } label: {
                    ZStack {
                        Circle()
                            .fill(
                                AngularGradient(
                                    colors: [.red, .yellow, .green, .cyan, .blue, .purple, .red],
                                    center: .center
                                )
                            )
                            .frame(width: 26, height: 26)
                        Circle()
                            .fill(.white)
                            .frame(width: 12, height: 12)
                    }
                }
                .padding(.horizontal, 6)

                separator

                // Note
                Button {
                    onAddNote()
                } label: {
                    Image(systemName: "note.text")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.primary)
                        .frame(width: 32, height: 32)
                }

                // Copy
                Button {
                    onCopy()
                } label: {
                    Image(systemName: "doc.on.doc")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.primary)
                        .frame(width: 32, height: 32)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(.regularMaterial)
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(.separator, lineWidth: 0.5)
                    }
                    .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
                    .shadow(color: .black.opacity(0.08), radius: 2, y: 1)
            }
            .position(x: toolbarX, y: toolbarY)
        }
    }

    private var separator: some View {
        Divider()
            .frame(height: 22)
            .padding(.horizontal, 2)
    }
}
