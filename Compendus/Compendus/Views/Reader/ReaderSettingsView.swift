//
//  ReaderSettingsView.swift
//  Compendus
//
//  Settings sheet for EPUB and PDF readers
//

import SwiftUI

struct ReaderSettingsView: View {
    @Environment(ReaderSettings.self) private var readerSettings
    @Environment(HighlightColorManager.self) private var highlightColorManager
    @Environment(\.dismiss) private var dismiss

    let format: ReaderFormat
    var bookId: String? = nil

    enum ReaderFormat {
        case epub
        case pdf
    }

    var body: some View {
        NavigationStack {
            Form {
                themeSection

                if format == .epub {
                    layoutSection
                    fontSection
                    fontSizeSection
                    lineHeightSection
                }

                if format == .pdf {
                    pdfInfoSection
                }

                highlightCategoriesSection
            }
            .navigationTitle("Reader Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    // MARK: - Theme Section

    @ViewBuilder
    private var themeSection: some View {
        @Bindable var settings = readerSettings

        Section("Theme") {
            HStack(spacing: 20) {
                Spacer()
                ForEach(ReaderTheme.allCases) { theme in
                    Button {
                        settings.theme = theme
                    } label: {
                        VStack(spacing: 8) {
                            Circle()
                                .fill(theme.previewColor)
                                .frame(width: 48, height: 48)
                                .overlay {
                                    Circle()
                                        .strokeBorder(
                                            settings.theme == theme ? .accentColor : theme.previewBorderColor,
                                            lineWidth: settings.theme == theme ? 3 : 1
                                        )
                                }
                                .shadow(color: .black.opacity(0.1), radius: 2, y: 1)

                            Text(theme.displayName)
                                .font(.caption)
                                .fontWeight(settings.theme == theme ? .semibold : .regular)
                                .foregroundStyle(settings.theme == theme ? .primary : .secondary)
                        }
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
            }
            .padding(.vertical, 8)
        }
    }

    // MARK: - Layout Section

    @ViewBuilder
    private var layoutSection: some View {
        @Bindable var settings = readerSettings

        Section {
            ForEach(ReaderLayout.allCases) { layout in
                Button {
                    settings.layout = layout
                } label: {
                    HStack {
                        Label(layout.displayName, systemImage: layout.icon)
                        Spacer()
                        if settings.layout == layout {
                            Image(systemName: "checkmark")
                                .foregroundStyle(.blue)
                                .fontWeight(.semibold)
                        }
                    }
                }
                .foregroundStyle(.primary)
            }
        } header: {
            Text("Layout")
        } footer: {
            Text("Auto uses two-page layout on iPad and Mac when there is enough screen width.")
        }
    }

    // MARK: - Font Section

    private static let previewSentence = "The quick brown fox jumps over the lazy dog."

    @ViewBuilder
    private var fontSection: some View {
        @Bindable var settings = readerSettings

        Section("Font") {
            ForEach(ReaderFont.allCases) { font in
                let isSelected = settings.fontFamily == font
                Button {
                    settings.fontFamily = font
                } label: {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(font.displayName)
                                .font(.custom(font.previewFontName, size: 17))

                            Text(Self.previewSentence)
                                .font(.custom(font.previewFontName, size: 14))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)

                            Text(font.description)
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }

                        Spacer()

                        if isSelected {
                            Image(systemName: "checkmark")
                                .foregroundStyle(.blue)
                                .fontWeight(.semibold)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .foregroundStyle(.primary)
            }
        }
    }

    // MARK: - Font Size Section

    @ViewBuilder
    private var fontSizeSection: some View {
        @Bindable var settings = readerSettings

        Section("Font Size: \(Int(settings.fontSize))px") {
            HStack(spacing: 12) {
                Text("Aa")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                Slider(
                    value: $settings.fontSize,
                    in: 12...36,
                    step: 1
                )

                Text("Aa")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Line Height Section

    @ViewBuilder
    private var lineHeightSection: some View {
        @Bindable var settings = readerSettings

        Section("Line Height: \(String(format: "%.1f", settings.lineHeight))") {
            HStack(spacing: 12) {
                Text("Tight")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Slider(
                    value: $settings.lineHeight,
                    in: 1.0...2.0,
                    step: 0.1
                )

                Text("Loose")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - PDF Info Section

    @ViewBuilder
    private var pdfInfoSection: some View {
        Section {
            // empty section, footer only
        } footer: {
            Text("Font and text changes are not available for PDF files. PDFs use their own embedded fonts and layout.")
        }
    }

    // MARK: - Highlight Categories Section

    @ViewBuilder
    private var highlightCategoriesSection: some View {
        Section {
            ForEach(highlightColorManager.colors) { preset in
                HighlightCategoryRow(
                    preset: preset,
                    bookId: bookId,
                    highlightColorManager: highlightColorManager
                )
            }

            if bookId != nil, highlightColorManager.bookLabels[bookId!] != nil {
                Button(role: .destructive) {
                    highlightColorManager.resetLabels(for: bookId!)
                } label: {
                    Label("Reset to Defaults", systemImage: "arrow.counterclockwise")
                        .font(.subheadline)
                }
            }
        } header: {
            Text("Highlight Categories")
        } footer: {
            if bookId != nil {
                Text("Customize labels for this book. Changes only apply to this book.")
            } else {
                Text("Default labels for highlight colors.")
            }
        }
    }
}

// MARK: - Highlight Category Row

private struct HighlightCategoryRow: View {
    let preset: HighlightPresetColor
    let bookId: String?
    let highlightColorManager: HighlightColorManager

    @State private var labelText: String = ""
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(Color(uiColor: UIColor(hex: preset.hex) ?? .yellow))
                .frame(width: 24, height: 24)
                .overlay {
                    Circle()
                        .strokeBorder(.white.opacity(0.3), lineWidth: 1)
                }

            TextField(preset.name, text: $labelText)
                .font(.subheadline)
                .focused($isFocused)
                .onChange(of: isFocused) { _, focused in
                    if !focused {
                        saveLabel()
                    }
                }
                .onSubmit {
                    saveLabel()
                }
        }
        .onAppear {
            labelText = highlightColorManager.label(for: preset.id, bookId: bookId)
        }
    }

    private func saveLabel() {
        let trimmed = labelText.trimmingCharacters(in: .whitespaces)
        if let bookId {
            highlightColorManager.setLabel(for: preset.id, bookId: bookId, label: trimmed)
        }
    }
}

#Preview {
    ReaderSettingsView(format: .epub)
        .environment(ReaderSettings())
        .environment(HighlightColorManager())
}
