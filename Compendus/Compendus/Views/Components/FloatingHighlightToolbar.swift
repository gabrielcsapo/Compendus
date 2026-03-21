//
//  FloatingHighlightToolbar.swift
//  Compendus
//
//  Floating context menu that appears near selected text.
//  Single-row layout: color dots | note | copy.
//

import SwiftUI
import EPUBReader

struct FloatingHighlightToolbar: View {
    @Environment(HighlightColorManager.self) private var highlightColorManager

    var bookId: String? = nil
    let selectionRect: CGRect
    let containerSize: CGSize
    let onSelectColor: (String) -> Void
    let onAddNote: () -> Void
    let onCopy: () -> Void
    let onDismiss: () -> Void

    // Show above selection when there's enough room; otherwise below.
    private var showAbove: Bool {
        selectionRect.minY > 80
    }

    private var toolbarY: CGFloat {
        if showAbove {
            return selectionRect.minY - 10
        } else {
            return selectionRect.maxY + 10
        }
    }

    private var toolbarX: CGFloat {
        let x = selectionRect.midX
        // Clamp so toolbar doesn't overflow screen edges (estimated half-width ~160)
        return max(160, min(x, containerSize.width - 160))
    }

    var body: some View {
        ZStack {
            // Tap-to-dismiss background
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { onDismiss() }

            // Single-row toolbar
            HStack(spacing: 10) {
                // Color dots
                ForEach(highlightColorManager.colorsForBook(bookId), id: \.preset.id) { item in
                    Button {
                        onSelectColor(item.preset.hex)
                    } label: {
                        Circle()
                            .fill(Color(uiColor: UIColor(hex: item.preset.hex) ?? .yellow))
                            .frame(width: 28, height: 28)
                    }
                }

                // Vertical divider between colors and actions
                Capsule()
                    .fill(.separator)
                    .frame(width: 1, height: 22)

                // Add Note
                Button {
                    onAddNote()
                } label: {
                    Image(systemName: "note.text")
                        .font(.system(size: 17))
                        .foregroundStyle(.primary)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }

                // Copy
                Button {
                    onCopy()
                } label: {
                    Image(systemName: "doc.on.doc")
                        .font(.system(size: 17))
                        .foregroundStyle(.primary)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
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
            .fixedSize()
            .position(x: toolbarX, y: toolbarY)
        }
    }
}
