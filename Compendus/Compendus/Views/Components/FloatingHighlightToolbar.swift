//
//  FloatingHighlightToolbar.swift
//  Compendus
//
//  Floating context menu that appears near selected text.
//  Single-row layout: color dots | note | copy.
//

import SwiftUI
import CCReader

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
    @State private var showingColorPalette = false
    /// Measured toolbar width, used to clamp it on-screen. Seeded with a sane
    /// estimate so the first layout (before measurement) is already close.
    @State private var measuredWidth: CGFloat = 280

    /// The book's highlight colors, for the multicolor swatch gradient.
    private var paletteColors: [Color] {
        let cs = highlightColorManager.colorsForBook(bookId)
            .map { Color(uiColor: UIColor(hex: $0.preset.hex) ?? .yellow) }
        return cs.isEmpty ? [.yellow, .green, .blue, .pink] : cs
    }

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
        // Center on the selection, but keep the whole bar on-screen using its
        // MEASURED half-width plus a margin (the bar's width varies — e.g. the
        // Define button only shows for short selections — so a fixed estimate
        // would still clip).
        let half = measuredWidth / 2
        let pad: CGFloat = 8
        let minX = half + pad
        let maxX = max(minX, containerSize.width - half - pad)
        return min(max(selectionRect.midX, minX), maxX)
    }

    var body: some View {
        ZStack {
            // Tap-to-dismiss background
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { onDismiss() }

            // Single-row toolbar
            HStack(spacing: 10) {
                // Highlight color: a single multicolor swatch that opens a color
                // palette popover. Collapsing the per-color dots into one button
                // keeps the bar narrow so it doesn't run off the screen edges.
                Button {
                    showingColorPalette = true
                } label: {
                    Circle()
                        .fill(AngularGradient(colors: paletteColors + [paletteColors.first ?? .yellow], center: .center))
                        .frame(width: 28, height: 28)
                        .overlay(Circle().strokeBorder(.white.opacity(0.55), lineWidth: 1.5))
                }
                .accessibilityLabel("Highlight color")
                .popover(isPresented: $showingColorPalette) {
                    HStack(spacing: 16) {
                        ForEach(highlightColorManager.colorsForBook(bookId), id: \.preset.id) { item in
                            Button {
                                onSelectColor(item.preset.hex)
                                showingColorPalette = false
                            } label: {
                                Circle()
                                    .fill(Color(uiColor: UIColor(hex: item.preset.hex) ?? .yellow))
                                    .frame(width: 32, height: 32)
                                    .overlay(Circle().strokeBorder(.separator, lineWidth: 0.5))
                            }
                            .accessibilityLabel("\(item.preset.name) highlight")
                        }
                    }
                    .padding(16)
                    .presentationCompactAdaptation(.popover)
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
            .background {
                // Measure the bar's actual width so toolbarX can clamp it fully
                // on-screen regardless of which buttons are present.
                GeometryReader { g in
                    Color.clear
                        .onAppear { measuredWidth = g.size.width }
                        .onChange(of: g.size.width) { _, w in measuredWidth = w }
                }
            }
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
