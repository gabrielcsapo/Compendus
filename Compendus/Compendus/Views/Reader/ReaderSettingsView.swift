//
//  ReaderSettingsView.swift
//  Compendus
//
//  Settings sheet for EPUB and PDF readers
//

import SwiftUI

struct ReaderSettingsView: View {
    @Environment(ReaderSettings.self) private var readerSettings
    @Environment(\.dismiss) private var dismiss

    let format: ReaderFormat

    enum ReaderFormat {
        case epub
        case pdf
    }

    var body: some View {
        NavigationStack {
            Form {
                themeSection

                if format == .epub {
                    fontSection
                    fontSizeSection
                    lineHeightSection
                }

                if format == .pdf {
                    pdfInfoSection
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
                                            settings.theme == theme ? .blue : theme.previewBorderColor,
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

}

#Preview {
    ReaderSettingsView(format: .epub)
        .environment(ReaderSettings())
}
