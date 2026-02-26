//
//  HighlightNoteEditor.swift
//  Compendus
//
//  Reusable editor for adding/editing notes on highlights.
//  Used for both "new highlight with note" and "edit existing note" flows.
//
//  Also contains:
//  - EditNoteSheet: Quick note editing for an existing highlight
//  - HighlightEditSheet: Full edit (change color, edit note, copy, delete)
//

import SwiftUI

struct HighlightNoteEditor: View {
    @Environment(HighlightColorManager.self) private var highlightColorManager

    var bookId: String? = nil
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
                        Text("Category")
                            .font(.caption)
                            .fontWeight(.medium)
                            .foregroundStyle(.secondary)

                        HStack(spacing: 12) {
                            ForEach(highlightColorManager.colorsForBook(bookId), id: \.preset.id) { item in
                                Button {
                                    colorBinding.wrappedValue = item.preset.hex
                                } label: {
                                    VStack(spacing: 4) {
                                        Circle()
                                            .fill(Color(uiColor: UIColor(hex: item.preset.hex) ?? .yellow))
                                            .frame(width: 36, height: 36)
                                            .overlay {
                                                if colorBinding.wrappedValue == item.preset.hex {
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

                                        Text(item.label)
                                            .font(.system(size: 10))
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
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

// MARK: - Edit Note Sheet

/// Simple sheet for editing the note on an existing highlight.
/// Used by HighlightsView (app-wide) and UnifiedReaderView.
struct EditNoteSheet: View {
    let highlight: BookHighlight
    let onSave: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var noteText: String = ""

    var body: some View {
        HighlightNoteEditor(
            highlightText: highlight.text,
            note: $noteText,
            onSave: {
                highlight.note = noteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : noteText.trimmingCharacters(in: .whitespacesAndNewlines)
                onSave()
                dismiss()
            },
            onCancel: {
                dismiss()
            }
        )
        .presentationDetents([.medium, .large])
        .onAppear {
            noteText = highlight.note ?? ""
        }
    }
}

// MARK: - Highlight Edit Sheet

/// Sheet for editing an existing highlight: change color, edit note, copy text, or delete.
struct HighlightEditSheet: View {
    @Environment(HighlightColorManager.self) private var highlightColorManager

    var bookId: String? = nil
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
                    Text("Category")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(.secondary)

                    HStack(spacing: 12) {
                        ForEach(highlightColorManager.colorsForBook(bookId), id: \.preset.id) { item in
                            Button {
                                selectedColor = item.preset.hex
                                onChangeColor(item.preset.hex)
                            } label: {
                                VStack(spacing: 4) {
                                    Circle()
                                        .fill(Color(uiColor: UIColor(hex: item.preset.hex) ?? .yellow))
                                        .frame(width: 36, height: 36)
                                        .overlay {
                                            if selectedColor == item.preset.hex {
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

                                    Text(item.label)
                                        .font(.system(size: 10))
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
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
