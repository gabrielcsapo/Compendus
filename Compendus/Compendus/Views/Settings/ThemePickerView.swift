//
//  ThemePickerView.swift
//  Compendus
//
//  Theme selection and custom theme creation
//

import SwiftUI
import EPUBReader

struct ThemePickerView: View {
    @Environment(ThemeManager.self) private var themeManager
    @Environment(\.colorScheme) private var colorScheme
    @State private var showingCreateSheet = false

    private let columns = [
        GridItem(.flexible()),
        GridItem(.flexible()),
        GridItem(.flexible())
    ]

    var body: some View {
        List {
            // Live preview
            Section {
                ThemePreviewCard(theme: themeManager.activeTheme, colorScheme: colorScheme)
            } header: {
                Text("Preview")
            }

            // Built-in themes
            Section {
                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(AppTheme.builtInThemes) { theme in
                        ThemeGridItem(
                            theme: theme,
                            isSelected: themeManager.activeTheme.id == theme.id,
                            colorScheme: colorScheme
                        ) {
                            themeManager.setActiveTheme(theme)
                        }
                    }
                }
                .padding(.vertical, 8)
            } header: {
                Text("Built-in Themes")
            }

            // Custom themes
            Section {
                if themeManager.customThemes.isEmpty {
                    Text("No custom themes yet")
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.vertical, 8)
                } else {
                    LazyVGrid(columns: columns, spacing: 16) {
                        ForEach(themeManager.customThemes) { theme in
                            ThemeGridItem(
                                theme: theme,
                                isSelected: themeManager.activeTheme.id == theme.id,
                                colorScheme: colorScheme
                            ) {
                                themeManager.setActiveTheme(theme)
                            }
                            .contextMenu {
                                Button(role: .destructive) {
                                    themeManager.deleteCustomTheme(id: theme.id)
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                        }
                    }
                    .padding(.vertical, 8)
                }

                Button {
                    showingCreateSheet = true
                } label: {
                    Label("Create Custom Theme", systemImage: "plus.circle")
                }
            } header: {
                Text("Custom Themes")
            }
        }
        .navigationTitle("App Theme")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showingCreateSheet) {
            CreateThemeSheet()
        }
    }
}

// MARK: - Theme Grid Item

private struct ThemeGridItem: View {
    let theme: AppTheme
    let isSelected: Bool
    let colorScheme: ColorScheme
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 8) {
                ZStack {
                    Circle()
                        .fill(theme.accentColor(for: colorScheme))
                        .frame(width: 52, height: 52)

                    if isSelected {
                        Circle()
                            .strokeBorder(.primary, lineWidth: 3)
                            .frame(width: 58, height: 58)

                        Image(systemName: "checkmark")
                            .font(.caption.bold())
                            .foregroundStyle(.primary)
                    }
                }

                Text(theme.name)
                    .font(.caption)
                    .fontWeight(isSelected ? .semibold : .regular)
                    .foregroundStyle(isSelected ? .primary : .secondary)
                    .lineLimit(1)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(theme.name) theme")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

// MARK: - Theme Preview Card

private struct ThemePreviewCard: View {
    let theme: AppTheme
    let colorScheme: ColorScheme

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 16) {
                // Simulated accent button
                Text("Button")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(theme.accentColor(for: colorScheme))
                    .foregroundStyle(colorScheme == .dark ? .black : .white)
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                // Simulated progress bar
                VStack(alignment: .leading, spacing: 4) {
                    Text("Progress")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 2)
                                .fill(Color(.systemGray5))
                            RoundedRectangle(cornerRadius: 2)
                                .fill(theme.accentColor(for: colorScheme))
                                .frame(width: geo.size.width * 0.6)
                        }
                    }
                    .frame(height: 6)
                }

                Spacer()
            }

            HStack(spacing: 12) {
                // Simulated icon
                ZStack {
                    Circle()
                        .fill(theme.accentColor(for: colorScheme).opacity(0.1))
                        .frame(width: 36, height: 36)
                    Image(systemName: "book.fill")
                        .font(.caption)
                        .foregroundStyle(theme.accentColor(for: colorScheme))
                }

                // Simulated tab icons
                ForEach(["books.vertical.fill", "arrow.down.circle", "highlighter", "gear"], id: \.self) { icon in
                    Image(systemName: icon)
                        .font(.caption)
                        .foregroundStyle(icon == "books.vertical.fill" ? theme.accentColor(for: colorScheme) : Color.secondary)
                }

                Spacer()
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Create Theme Sheet

private struct CreateThemeSheet: View {
    @Environment(ThemeManager.self) private var themeManager
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme

    @State private var themeName = ""
    @State private var selectedColor = Color(red: 0.976, green: 0.824, blue: 0.898) // #F9D2E5

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Theme Name", text: $themeName)
                } header: {
                    Text("Name")
                }

                Section {
                    ColorPicker("Accent Color", selection: $selectedColor, supportsOpacity: false)

                    // Preview of derived colors
                    HStack(spacing: 12) {
                        VStack(spacing: 4) {
                            Circle()
                                .fill(derivedLightColor)
                                .frame(width: 40, height: 40)
                            Text("Light")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }

                        VStack(spacing: 4) {
                            Circle()
                                .fill(selectedColor)
                                .frame(width: 40, height: 40)
                            Text("Dark")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 4)
                } header: {
                    Text("Color")
                } footer: {
                    Text("A slightly darker variant is automatically generated for light mode.")
                }

                Section {
                    ThemePreviewCard(
                        theme: previewTheme,
                        colorScheme: colorScheme
                    )
                } header: {
                    Text("Preview")
                }
            }
            .navigationTitle("New Theme")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        themeManager.addCustomTheme(name: themeName, seedHex: selectedColorHex)
                        dismiss()
                    }
                    .disabled(themeName.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var selectedColorHex: String {
        let uiColor = UIColor(selectedColor)
        return uiColor.hexString
    }

    private var derivedLightColor: Color {
        let hex = selectedColorHex
        let theme = AppTheme.custom(name: "preview", seedHex: hex)
        return theme.accentColor(for: .light)
    }

    private var previewTheme: AppTheme {
        AppTheme.custom(name: themeName.isEmpty ? "Custom" : themeName, seedHex: selectedColorHex)
    }
}

#Preview {
    NavigationStack {
        ThemePickerView()
    }
    .environment(ThemeManager())
}
