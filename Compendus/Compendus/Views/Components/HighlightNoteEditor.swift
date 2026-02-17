//
//  HighlightNoteEditor.swift
//  Compendus
//
//  Reusable editor for adding/editing notes on highlights.
//  Used for both "new highlight with note" and "edit existing note" flows.
//
//  Also contains HighlightEditSheet for editing existing highlights
//  (change color, edit note, copy text, delete).
//

import SwiftUI

struct HighlightNoteEditor: View {
    let highlightText: String
    @Binding var note: String
    /// When non-nil, shows a color picker row (used for new highlights)
    var selectedColor: Binding<String>? = nil
    let onSave: () -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                // Quoted text preview
                Text("\"\(highlightText)\"")
                    .font(.subheadline)
                    .italic()
                    .foregroundStyle(.secondary)
                    .lineLimit(4)
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.systemGray6))
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                // Note input
                VStack(alignment: .leading, spacing: 6) {
                    Text("Note")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(.secondary)

                    TextEditor(text: $note)
                        .frame(minHeight: 100, maxHeight: 200)
                        .padding(8)
                        .background(Color(.systemGray6))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .scrollContentBackground(.hidden)
                }

                // Color picker row (only for new highlights)
                if let colorBinding = selectedColor {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Color")
                            .font(.caption)
                            .fontWeight(.medium)
                            .foregroundStyle(.secondary)

                        HStack(spacing: 12) {
                            ForEach(BookHighlight.colors, id: \.hex) { color in
                                Button {
                                    colorBinding.wrappedValue = color.hex
                                } label: {
                                    Circle()
                                        .fill(Color(uiColor: UIColor(hex: color.hex) ?? .yellow))
                                        .frame(width: 36, height: 36)
                                        .overlay {
                                            if colorBinding.wrappedValue == color.hex {
                                                Image(systemName: "checkmark")
                                                    .font(.system(size: 14, weight: .bold))
                                                    .foregroundStyle(.white)
                                                    .shadow(radius: 1)
                                            }
                                        }
                                        .overlay {
                                            Circle()
                                                .strokeBorder(.white.opacity(0.3), lineWidth: 1)
                                        }
                                }
                            }
                        }
                    }
                }

                Spacer()
            }
            .padding()
            .navigationTitle(selectedColor != nil ? "Highlight with Note" : "Edit Note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { onCancel() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") { onSave() }
                        .bold()
                }
            }
        }
    }
}

// MARK: - Highlight Edit Sheet

/// Sheet for editing an existing highlight: change color, edit note, copy text, or delete.
struct HighlightEditSheet: View {
    let highlight: BookHighlight
    let onChangeColor: (String) -> Void
    let onSaveNote: (String?) -> Void
    let onCopy: () -> Void
    let onDelete: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var noteText: String = ""
    @State private var selectedColor: String = ""

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                // Quoted text preview
                Text("\"\(highlight.text)\"")
                    .font(.subheadline)
                    .italic()
                    .foregroundStyle(.secondary)
                    .lineLimit(4)
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.systemGray6))
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                // Color picker
                VStack(alignment: .leading, spacing: 6) {
                    Text("Color")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(.secondary)

                    HStack(spacing: 12) {
                        ForEach(BookHighlight.colors, id: \.hex) { color in
                            Button {
                                selectedColor = color.hex
                                onChangeColor(color.hex)
                            } label: {
                                Circle()
                                    .fill(Color(uiColor: UIColor(hex: color.hex) ?? .yellow))
                                    .frame(width: 36, height: 36)
                                    .overlay {
                                        if selectedColor == color.hex {
                                            Image(systemName: "checkmark")
                                                .font(.system(size: 14, weight: .bold))
                                                .foregroundStyle(.white)
                                                .shadow(radius: 1)
                                        }
                                    }
                                    .overlay {
                                        Circle()
                                            .strokeBorder(.white.opacity(0.3), lineWidth: 1)
                                    }
                            }
                        }
                    }
                }

                // Note
                VStack(alignment: .leading, spacing: 6) {
                    Text("Note")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(.secondary)

                    TextEditor(text: $noteText)
                        .frame(minHeight: 80, maxHeight: 150)
                        .padding(8)
                        .background(Color(.systemGray6))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .scrollContentBackground(.hidden)
                }

                // Action buttons
                HStack(spacing: 12) {
                    Button {
                        onCopy()
                        dismiss()
                    } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)

                    Button(role: .destructive) {
                        onDelete()
                        dismiss()
                    } label: {
                        Label("Delete", systemImage: "trash")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }

                Spacer()
            }
            .padding()
            .navigationTitle("Edit Highlight")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") {
                        let trimmed = noteText.trimmingCharacters(in: .whitespacesAndNewlines)
                        onSaveNote(trimmed.isEmpty ? nil : trimmed)
                        dismiss()
                    }
                    .bold()
                }
            }
            .onAppear {
                noteText = highlight.note ?? ""
                selectedColor = highlight.color
            }
        }
    }
}
