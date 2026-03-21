//
//  BookHighlightColorsEditor.swift
//  Compendus
//
//  Per-book highlight color editor. Allows adding, removing, editing,
//  and reordering custom colors for a specific book.
//

import SwiftUI
import EPUBReader

struct BookHighlightColorsEditor: View {
    let bookId: String

    @Environment(HighlightColorManager.self) private var colorManager
    @State private var showingAddSheet = false
    @State private var showingResetConfirmation = false
    @State private var editingColor: HighlightPresetColor?

    private var bookColorSet: [HighlightPresetColor] {
        colorManager.bookColors[bookId] ?? colorManager.colors
    }

    private var hasCustom: Bool {
        colorManager.hasCustomColors(for: bookId)
    }

    var body: some View {
        List {
            Section {
                ForEach(bookColorSet) { preset in
                    Button {
                        ensureCustomColorsExist()
                        editingColor = preset
                    } label: {
                        HStack(spacing: 12) {
                            Circle()
                                .fill(Color(uiColor: UIColor(hex: preset.hex) ?? .yellow))
                                .frame(width: 28, height: 28)
                                .overlay {
                                    Circle()
                                        .strokeBorder(Color.primary.opacity(0.15), lineWidth: 1)
                                }

                            Text(preset.name)
                                .foregroundStyle(.primary)

                            Spacer()

                            Image(systemName: "chevron.right")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
                .onDelete { indexSet in
                    ensureCustomColorsExist()
                    for index in indexSet {
                        let color = bookColorSet[index]
                        colorManager.removeBookColor(id: color.id, for: bookId)
                    }
                }
                .onMove { source, destination in
                    ensureCustomColorsExist()
                    colorManager.moveBookColor(from: source, to: destination, for: bookId)
                }
                .deleteDisabled(bookColorSet.count <= HighlightColorManager.minColors)
            } header: {
                Text("Colors for This Book")
            } footer: {
                if hasCustom {
                    Text("These colors are specific to this book.")
                } else {
                    Text("Using app-wide default colors. Changes here will create a custom set for this book.")
                }
            }

            Section {
                Button {
                    ensureCustomColorsExist()
                    showingAddSheet = true
                } label: {
                    Label("Add Color", systemImage: "plus.circle")
                }
                .disabled(bookColorSet.count >= HighlightColorManager.maxColors)
            } footer: {
                if bookColorSet.count >= HighlightColorManager.maxColors {
                    Text("Maximum of \(HighlightColorManager.maxColors) colors reached.")
                }
            }

            if hasCustom {
                Section {
                    Button(role: .destructive) {
                        showingResetConfirmation = true
                    } label: {
                        Label("Reset to App Defaults", systemImage: "arrow.counterclockwise")
                    }
                }
            }
        }
        .navigationTitle("Book Highlight Colors")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            EditButton()
        }
        .sheet(isPresented: $showingAddSheet) {
            BookAddColorSheet(bookId: bookId)
        }
        .sheet(item: $editingColor) { preset in
            BookEditColorSheet(bookId: bookId, preset: preset)
        }
        .confirmationDialog("Reset to Defaults?", isPresented: $showingResetConfirmation) {
            Button("Reset", role: .destructive) {
                colorManager.resetBookColors(for: bookId)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will remove custom colors for this book and use the app-wide defaults instead.")
        }
    }

    private func ensureCustomColorsExist() {
        if !hasCustom {
            colorManager.setBookColors(colorManager.colors, for: bookId)
        }
    }
}

// MARK: - Add Color Sheet

private struct BookAddColorSheet: View {
    let bookId: String

    @Environment(HighlightColorManager.self) private var colorManager
    @Environment(\.dismiss) private var dismiss

    @State private var labelName = ""
    @State private var selectedColor = Color.green

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("e.g. Theme, Character, Quote", text: $labelName)
                } header: {
                    Text("Label")
                }

                Section {
                    ColorPicker("Color", selection: $selectedColor, supportsOpacity: false)

                    HStack {
                        Circle()
                            .fill(selectedColor)
                            .frame(width: 44, height: 44)
                            .overlay {
                                Circle()
                                    .strokeBorder(Color.primary.opacity(0.15), lineWidth: 1)
                            }
                        Text(labelName.isEmpty ? "Preview" : labelName)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 4)
                } header: {
                    Text("Color")
                }
            }
            .navigationTitle("New Color")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        let hex = UIColor(selectedColor).hexString
                        colorManager.addBookColor(name: labelName, hex: hex, for: bookId)
                        dismiss()
                    }
                    .disabled(labelName.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

// MARK: - Edit Color Sheet

private struct BookEditColorSheet: View {
    let bookId: String
    let preset: HighlightPresetColor

    @Environment(HighlightColorManager.self) private var colorManager
    @Environment(\.dismiss) private var dismiss

    @State private var labelName = ""
    @State private var selectedColor = Color.yellow

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("e.g. Theme, Character, Quote", text: $labelName)
                } header: {
                    Text("Label")
                }

                Section {
                    ColorPicker("Color", selection: $selectedColor, supportsOpacity: false)

                    HStack {
                        Circle()
                            .fill(selectedColor)
                            .frame(width: 44, height: 44)
                            .overlay {
                                Circle()
                                    .strokeBorder(Color.primary.opacity(0.15), lineWidth: 1)
                            }
                        Text(labelName.isEmpty ? "Preview" : labelName)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 4)
                } header: {
                    Text("Color")
                }
            }
            .navigationTitle("Edit Color")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        if !colorManager.hasCustomColors(for: bookId) {
                            colorManager.setBookColors(colorManager.colors, for: bookId)
                        }
                        let hex = UIColor(selectedColor).hexString
                        colorManager.updateBookColor(id: preset.id, name: labelName, hex: hex, for: bookId)
                        dismiss()
                    }
                    .disabled(labelName.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear {
                labelName = preset.name
                if let uiColor = UIColor(hex: preset.hex) {
                    selectedColor = Color(uiColor: uiColor)
                }
            }
        }
        .presentationDetents([.medium])
    }
}
