//
//  BookmarkEditSheet.swift
//  Compendus
//
//  Sheet for editing a bookmark's color and note, or removing the bookmark.
//

import SwiftUI
import EPUBReader

struct BookmarkEditSheet: View {
    @Bindable var bookmark: BookBookmark
    let bookId: String
    let onSave: () -> Void
    let onDelete: () -> Void

    @Environment(HighlightColorManager.self) private var highlightColorManager
    @State private var noteText: String = ""

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                // Page info
                HStack(spacing: 10) {
                    Image(systemName: "bookmark.fill")
                        .foregroundStyle(Color(uiColor: bookmark.uiColor))
                        .font(.title2)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(bookmark.title ?? "Page \(bookmark.pageIndex + 1)")
                            .font(.headline)
                        Text("\(Int(bookmark.progression * 100))% through book")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal)

                // Color picker
                VStack(alignment: .leading, spacing: 8) {
                    Text("Color")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal)

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            ForEach(highlightColorManager.colorsForBook(bookId), id: \.preset.id) { item in
                                Button {
                                    bookmark.color = item.preset.hex
                                } label: {
                                    VStack(spacing: 4) {
                                        Circle()
                                            .fill(Color(uiColor: UIColor(hex: item.preset.hex) ?? .yellow))
                                            .frame(width: 36, height: 36)
                                            .overlay {
                                                if bookmark.color == item.preset.hex {
                                                    Image(systemName: "checkmark")
                                                        .font(.system(size: 14, weight: .bold))
                                                        .foregroundStyle(.white)
                                                        .shadow(radius: 1)
                                                }
                                            }
                                            .overlay {
                                                Circle()
                                                    .strokeBorder(Color.primary.opacity(0.15), lineWidth: 1)
                                            }

                                        Text(item.label)
                                            .font(.system(size: 10))
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                    }
                                }
                            }
                        }
                        .padding(.horizontal)
                    }
                }

                // Note input
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
                .padding(.horizontal)

                Spacer()

                // Delete button
                Button(role: .destructive) {
                    onDelete()
                } label: {
                    Label("Remove Bookmark", systemImage: "trash")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .padding(.horizontal)
                .padding(.bottom, 8)
            }
            .padding(.top)
            .navigationTitle("Edit Bookmark")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        bookmark.note = noteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            ? nil
                            : noteText.trimmingCharacters(in: .whitespacesAndNewlines)
                        onSave()
                    }
                }
            }
            .onAppear {
                noteText = bookmark.note ?? ""
            }
        }
    }
}
