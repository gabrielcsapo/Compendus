//
//  FloatingHighlightToolbar.swift
//  Compendus
//
//  Floating context menu that appears near selected text.
//  Styled to resemble the native Apple Books highlight menu.
//

import SwiftUI

struct FloatingHighlightToolbar: View {
    @Environment(HighlightColorManager.self) private var highlightColorManager

    var bookId: String? = nil
    let selectionRect: CGRect
    let containerSize: CGSize
    let onSelectColor: (String) -> Void
    let onCustomColor: () -> Void
    let onAddNote: () -> Void
    let onCopy: () -> Void
    let onDismiss: () -> Void

    // Show above selection when there's enough room; otherwise below.
    private var showAbove: Bool {
        selectionRect.minY > 220
    }

    private var toolbarY: CGFloat {
        if showAbove {
            return selectionRect.minY - 10
        } else {
            return selectionRect.maxY + 10
        }
    }

    private var toolbarWidth: CGFloat {
        let count = CGFloat(highlightColorManager.colors.count + 1)
        let dotSize: CGFloat = 28
        let spacing: CGFloat = highlightColorManager.colors.count > 3 ? 8 : 12
        let padding: CGFloat = 32
        return max(220, count * dotSize + (count - 1) * spacing + padding)
    }

    private var toolbarX: CGFloat {
        let half = toolbarWidth / 2
        let x = selectionRect.midX
        return max(half + 8, min(x, containerSize.width - half - 8))
    }

    var body: some View {
        ZStack {
            // Tap-to-dismiss background
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { onDismiss() }

            // Context menu
            VStack(spacing: 0) {
                // Color dots row with labels
                HStack(spacing: highlightColorManager.colors.count > 3 ? 8 : 12) {
                    ForEach(highlightColorManager.colorsForBook(bookId), id: \.preset.id) { item in
                        Button {
                            onSelectColor(item.preset.hex)
                        } label: {
                            VStack(spacing: 4) {
                                Circle()
                                    .fill(Color(uiColor: UIColor(hex: item.preset.hex) ?? .yellow))
                                    .frame(width: 28, height: 28)

                                Text(item.label)
                                    .font(.system(size: 9))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                    }

                    // Custom color picker
                    Button {
                        onCustomColor()
                    } label: {
                        VStack(spacing: 4) {
                            ZStack {
                                Circle()
                                    .fill(
                                        AngularGradient(
                                            colors: [.red, .yellow, .green, .cyan, .blue, .purple, .red],
                                            center: .center
                                        )
                                    )
                                    .frame(width: 28, height: 28)
                                Circle()
                                    .fill(.white)
                                    .frame(width: 12, height: 12)
                            }

                            Text("Custom")
                                .font(.system(size: 9))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                }
                .padding(.vertical, 10)
                .padding(.horizontal, 16)

                Divider()

                // Menu items
                menuItem(icon: "note.text", label: "Add Note") {
                    onAddNote()
                }

                Divider()

                menuItem(icon: "doc.on.doc", label: "Copy") {
                    onCopy()
                }
            }
            .frame(width: toolbarWidth)
            .background {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(.regularMaterial)
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(.separator, lineWidth: 0.5)
                    }
                    .shadow(color: .black.opacity(0.15), radius: 16, y: 6)
                    .shadow(color: .black.opacity(0.08), radius: 2, y: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .position(x: toolbarX, y: toolbarY)
        }
    }

    private func menuItem(icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 15))
                    .foregroundStyle(.primary)
                    .frame(width: 22)
                Text(label)
                    .font(.system(size: 15))
                    .foregroundStyle(.primary)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
    }
}
