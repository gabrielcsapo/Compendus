//
//  HighlightColorsSettingsView.swift
//  Compendus
//
//  Settings view for customizing highlight color presets
//

import SwiftUI

struct HighlightColorsSettingsView: View {
    @Environment(HighlightColorManager.self) private var colorManager
    @State private var showingAddSheet = false
    @State private var showingResetConfirmation = false
    @State private var editingColor: HighlightPresetColor?

    var body: some View {
        List {
            Section {
                ForEach(colorManager.colors) { preset in
                    Button {
                        editingColor = preset
                    } label: {
                        HStack(spacing: 12) {
                            Circle()
                                .fill(Color(uiColor: UIColor(hex: preset.hex) ?? .yellow))
                                .frame(width: 28, height: 28)
                                .overlay {
                                    Circle()
                                        .strokeBorder(.white.opacity(0.3), lineWidth: 1)
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
                    for index in indexSet {
                        let color = colorManager.colors[index]
                        colorManager.removeColor(id: color.id)
                    }
                }
                .onMove { source, destination in
                    colorManager.moveColor(from: source, to: destination)
                }
                .deleteDisabled(!colorManager.canRemove)
            } header: {
                Text("Highlight Colors")
            } footer: {
                Text("These colors appear as quick-select options when highlighting text. You can customize labels per-book in Reader Settings.")
            }

            Section {
                Button {
                    showingAddSheet = true
                } label: {
                    Label("Add Color", systemImage: "plus.circle")
                }
                .disabled(!colorManager.canAddMore)
            } footer: {
                if !colorManager.canAddMore {
                    Text("Maximum of \(HighlightColorManager.maxColors) preset colors reached.")
                }
            }

            Section {
                Button(role: .destructive) {
                    showingResetConfirmation = true
                } label: {
                    Label("Reset to Defaults", systemImage: "arrow.counterclockwise")
                }
            }
        }
        .navigationTitle("Highlight Colors")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            EditButton()
        }
        .sheet(isPresented: $showingAddSheet) {
            AddHighlightColorSheet()
        }
        .sheet(item: $editingColor) { preset in
            EditHighlightColorSheet(preset: preset)
        }
        .confirmationDialog("Reset to Defaults?", isPresented: $showingResetConfirmation) {
            Button("Reset", role: .destructive) {
                colorManager.resetToDefaults()
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This will replace your highlight colors with the defaults (Highlight, Note, Important).")
        }
    }
}

// MARK: - Add Color Sheet

private struct AddHighlightColorSheet: View {
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
                    Text("Default Label")
                }

                Section {
                    ColorPicker("Color", selection: $selectedColor, supportsOpacity: false)

                    HStack {
                        Circle()
                            .fill(selectedColor)
                            .frame(width: 44, height: 44)
                            .overlay {
                                Circle()
                                    .strokeBorder(.white.opacity(0.3), lineWidth: 1)
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
            .navigationTitle("New Highlight Color")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        let hex = UIColor(selectedColor).hexString
                        colorManager.addColor(name: labelName, hex: hex)
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

private struct EditHighlightColorSheet: View {
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
                    Text("Default Label")
                }

                Section {
                    ColorPicker("Color", selection: $selectedColor, supportsOpacity: false)

                    HStack {
                        Circle()
                            .fill(selectedColor)
                            .frame(width: 44, height: 44)
                            .overlay {
                                Circle()
                                    .strokeBorder(.white.opacity(0.3), lineWidth: 1)
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
            .navigationTitle("Edit Highlight Color")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        let hex = UIColor(selectedColor).hexString
                        colorManager.updateColor(id: preset.id, name: labelName, hex: hex)
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
