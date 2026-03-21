//
//  ReaderSettingsView.swift
//  Compendus
//
//  Settings sheet for EPUB and PDF readers
//

import SwiftUI
import EPUBReader

struct ReaderSettingsView: View {
    @Environment(ReaderSettings.self) private var readerSettings
    @Environment(HighlightColorManager.self) private var highlightColorManager
    @Environment(ThemeManager.self) private var themeManager
    @Environment(\.dismiss) private var dismiss

    let format: ReaderFormat
    var bookId: String? = nil

    enum ReaderFormat {
        case epub
        case pdf
        case comic
    }

    var body: some View {
        NavigationStack {
            Form {
                themeSection

                if format == .epub || format == .comic {
                    layoutSection
                }

                if format == .epub {
                    fontSection
                    textPreviewSection
                    fontSizeSection
                    lineHeightSection
                }

                if format == .pdf {
                    pdfInfoSection
                }

                if format == .comic {
                    comicInfoSection
                }

                if format != .comic {
                    highlightCategoriesSection
                }
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
                                            settings.theme == theme ? themeManager.accentColor : theme.previewBorderColor,
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
                                .foregroundStyle(themeManager.accentColor)
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

    // MARK: - Text Preview Section

    @ViewBuilder
    private var textPreviewSection: some View {
        Section("Preview") {
            Text(Self.loremIpsum)
                .font(.custom(readerSettings.fontFamily.previewFontName, size: readerSettings.fontSize))
                .lineSpacing((readerSettings.lineHeight - 1.0) * readerSettings.fontSize)
                .foregroundStyle(Color(uiColor: readerSettings.theme.textColor))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .frame(height: 160, alignment: .top)
                .clipped()
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color(uiColor: readerSettings.theme.backgroundColor))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(readerSettings.theme.previewBorderColor, lineWidth: 1)
                )
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                .listRowBackground(Color.clear)
                .animation(.easeInOut(duration: 0.2), value: readerSettings.fontFamily)
                .animation(.easeInOut(duration: 0.2), value: readerSettings.fontSize)
                .animation(.easeInOut(duration: 0.2), value: readerSettings.lineHeight)
                .animation(.easeInOut(duration: 0.2), value: readerSettings.theme)
        }
    }

    // MARK: - Font Section

    private static let previewSentence = "The quick brown fox jumps over the lazy dog."
    private static let loremIpsum = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat."

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
                                .foregroundStyle(themeManager.accentColor)
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

    // MARK: - Comic Info Section

    @ViewBuilder
    private var comicInfoSection: some View {
        Section {
            // empty section, footer only
        } footer: {
            Text("Comics display fixed-layout pages. Font and text settings do not apply.")
        }
    }

    // MARK: - Highlight Categories Section

    @ViewBuilder
    private var highlightCategoriesSection: some View {
        Section {
            if let bookId {
                ForEach(highlightColorManager.colorsForBook(bookId), id: \.preset.id) { item in
                    HStack(spacing: 12) {
                        Circle()
                            .fill(Color(uiColor: UIColor(hex: item.preset.hex) ?? .yellow))
                            .frame(width: 24, height: 24)
                            .overlay {
                                Circle()
                                    .strokeBorder(Color.primary.opacity(0.15), lineWidth: 1)
                            }
                        Text(item.label)
                            .font(.subheadline)
                    }
                }

                NavigationLink {
                    BookHighlightColorsEditor(bookId: bookId)
                } label: {
                    Label("Edit Colors for This Book", systemImage: "paintpalette")
                        .font(.subheadline)
                }

                if highlightColorManager.hasCustomColors(for: bookId) {
                    Button(role: .destructive) {
                        highlightColorManager.resetBookColors(for: bookId)
                    } label: {
                        Label("Reset to App Defaults", systemImage: "arrow.counterclockwise")
                            .font(.subheadline)
                    }
                }
            } else {
                ForEach(highlightColorManager.colors) { preset in
                    HStack(spacing: 12) {
                        Circle()
                            .fill(Color(uiColor: UIColor(hex: preset.hex) ?? .yellow))
                            .frame(width: 24, height: 24)
                            .overlay {
                                Circle()
                                    .strokeBorder(Color.primary.opacity(0.15), lineWidth: 1)
                            }
                        Text(preset.name)
                            .font(.subheadline)
                    }
                }
            }
        } header: {
            Text("Highlight Categories")
        } footer: {
            if let bookId {
                if highlightColorManager.hasCustomColors(for: bookId) {
                    Text("This book uses custom highlight colors.")
                } else {
                    Text("Using app-wide default colors. Tap edit to customize for this book.")
                }
            } else {
                Text("Default highlight colors. Customize per-book in Reader Settings.")
            }
        }
    }
}

#Preview {
    ReaderSettingsView(format: .epub)
        .environment(ReaderSettings())
        .environment(HighlightColorManager())
}
