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
    let selectedText: String
    let selectionRect: CGRect
    let containerSize: CGSize
    let onSelectColor: (String) -> Void
    let onAddNote: () -> Void
    let onCopy: () -> Void
    let onDismiss: () -> Void
    let onSearchInBook: ((String) -> Void)?
    let onShare: ((String) -> Void)?

    @State private var showingDefinition = false

    private var firstWord: String {
        let pattern = try? NSRegularExpression(pattern: "[\\p{L}\\p{N}'-]+")
        guard let pattern else { return "" }
        let range = NSRange(selectedText.startIndex..., in: selectedText)
        guard let match = pattern.firstMatch(in: selectedText, range: range),
              let r = Range(match.range, in: selectedText) else { return "" }
        return String(selectedText[r]).lowercased()
    }

    private var canDefine: Bool {
        let words = selectedText.split(whereSeparator: { $0.isWhitespace })
        return !firstWord.isEmpty && words.count <= 4
    }

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
                    .accessibilityLabel("\(item.preset.name) highlight")
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
                .accessibilityLabel("Add note")

                // Define (only for short selections — single word lookup is most useful)
                if canDefine {
                    Button {
                        showingDefinition = true
                    } label: {
                        Image(systemName: "character.book.closed")
                            .font(.system(size: 17))
                            .foregroundStyle(.primary)
                            .frame(width: 32, height: 32)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel("Define \(firstWord)")
                }

                // Search in book
                if let onSearchInBook {
                    Button {
                        onSearchInBook(selectedText)
                    } label: {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 17))
                            .foregroundStyle(.primary)
                            .frame(width: 32, height: 32)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel("Search in book")
                }

                // Share
                if let onShare {
                    Button {
                        onShare(selectedText)
                    } label: {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 17))
                            .foregroundStyle(.primary)
                            .frame(width: 32, height: 32)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel("Share")
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
                .accessibilityLabel("Copy")
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
        .sheet(isPresented: $showingDefinition) {
            DefinitionSheet(term: firstWord)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }
}

/// Wraps UIReferenceLibraryViewController for inline system dictionary lookup.
private struct DefinitionSheet: UIViewControllerRepresentable {
    let term: String

    func makeUIViewController(context: Context) -> UIViewController {
        if UIReferenceLibraryViewController.dictionaryHasDefinition(forTerm: term) {
            return UIReferenceLibraryViewController(term: term)
        }
        // Fallback: a simple "no definition" view. Wrap in a UIHostingController for SwiftUI text.
        let host = UIHostingController(rootView: NoDefinitionView(term: term))
        return host
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}

private struct NoDefinitionView: View {
    let term: String
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "book.closed")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text("No definition available")
                .font(.headline)
            Text("\u{201C}\(term)\u{201D} isn\u{2019}t in the system dictionary.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
