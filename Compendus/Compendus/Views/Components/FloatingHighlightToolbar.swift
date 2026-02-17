//
//  FloatingHighlightToolbar.swift
//  Compendus
//
//  Floating color picker toolbar that appears near selected text
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

    private var showAbove: Bool {
        selectionRect.minY > 70
    }

    private var toolbarY: CGFloat {
        if showAbove {
            return selectionRect.minY - 14
        } else {
            return selectionRect.maxY + 56
        }
    }

    private var toolbarX: CGFloat {
        let x = selectionRect.midX
        return max(170, min(x, containerSize.width - 170))
    }

    var body: some View {
        ZStack {
            // Tap-to-dismiss background
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { onDismiss() }

            // Toolbar
            HStack(spacing: 10) {
                ForEach(BookHighlight.colors, id: \.hex) { color in
                    Button {
                        onSelectColor(color.hex)
                    } label: {
                        Circle()
                            .fill(Color(uiColor: UIColor(hex: color.hex) ?? .yellow))
                            .frame(width: 34, height: 34)
                            .overlay {
                                Circle()
                                    .strokeBorder(.white.opacity(0.3), lineWidth: 1)
                            }
                    }
                }

                // Custom color button
                Button {
                    onCustomColor()
                } label: {
                    Circle()
                        .fill(
                            AngularGradient(
                                colors: [.red, .yellow, .green, .cyan, .blue, .purple, .red],
                                center: .center
                            )
                        )
                        .frame(width: 34, height: 34)
                        .overlay {
                            Image(systemName: "plus")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.white)
                                .shadow(radius: 1)
                        }
                }

                // Divider
                Divider()
                    .frame(height: 24)

                // Note button
                Button {
                    onAddNote()
                } label: {
                    Image(systemName: "note.text")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(.primary)
                        .frame(width: 34, height: 34)
                }

                // Copy button
                Button {
                    onCopy()
                } label: {
                    Image(systemName: "doc.on.doc")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(.primary)
                        .frame(width: 34, height: 34)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .shadow(color: .black.opacity(0.15), radius: 8, y: 2)
            .position(x: toolbarX, y: toolbarY)
        }
    }
}
