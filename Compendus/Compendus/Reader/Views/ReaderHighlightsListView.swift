//
//  ReaderHighlightsListView.swift
//  Compendus
//
//  Unified highlights list view used by UnifiedReaderView.
//  Replaces the duplicated EPUBHighlightsView and PDFHighlightsView.
//

import SwiftUI

struct ReaderHighlightsListView: View {
    let highlights: [BookHighlight]
    let onSelect: (BookHighlight) -> Void
    let onDelete: (BookHighlight) -> Void
    var onEditNote: ((BookHighlight) -> Void)?

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if highlights.isEmpty {
                    ContentUnavailableView {
                        Label("No Highlights", systemImage: "highlighter")
                    } description: {
                        Text("Select text while reading to create highlights.")
                    }
                } else {
                    List {
                        ForEach(highlights, id: \.id) { highlight in
                            Button {
                                onSelect(highlight)
                            } label: {
                                HStack(spacing: 12) {
                                    // Color indicator
                                    RoundedRectangle(cornerRadius: 3)
                                        .fill(Color(uiColor: highlight.uiColor))
                                        .frame(width: 4)

                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("\"\(highlight.text)\"")
                                            .font(.subheadline)
                                            .italic()
                                            .lineLimit(3)
                                            .foregroundStyle(.primary)

                                        // Note display
                                        if let note = highlight.note, !note.isEmpty {
                                            Text(note)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                                .lineLimit(2)
                                        } else if onEditNote != nil {
                                            Text("Add note...")
                                                .font(.caption)
                                                .foregroundStyle(.tertiary)
                                        }

                                        HStack {
                                            if let chapter = highlight.chapterTitle {
                                                Text(chapter)
                                                    .font(.caption)
                                                    .foregroundStyle(.secondary)
                                                    .lineLimit(1)
                                            }

                                            Spacer()

                                            Text("\(Int(highlight.progression * 100))%")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }
                                .padding(.vertical, 4)
                            }
                            .swipeActions(edge: .leading) {
                                if onEditNote != nil {
                                    Button {
                                        onEditNote?(highlight)
                                    } label: {
                                        Label("Note", systemImage: "note.text")
                                    }
                                    .tint(.blue)
                                }
                            }
                        }
                        .onDelete { indexSet in
                            for index in indexSet {
                                onDelete(highlights[index])
                            }
                        }
                    }
                }
            }
            .navigationTitle("Highlights")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
