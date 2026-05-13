//
//  NotesSheet.swift
//  Compendus
//
//  Unified Notes sheet — Highlights and Bookmarks together in a single
//  destination, switched by a segmented control. Replaces the two separate
//  sheets that previously sat side-by-side in the reader's overflow menu.
//

import SwiftUI

enum NotesTab: Hashable {
    case highlights
    case bookmarks
}

struct NotesSheet: View {
    @Binding var tab: NotesTab
    let highlights: [ReadingMark]
    let bookmarks: [ReadingMark]

    let onSelectHighlight: (ReadingMark) -> Void
    let onDeleteHighlight: (ReadingMark) -> Void
    let onEditHighlightNote: (ReadingMark) -> Void

    let onSelectBookmark: (ReadingMark) -> Void
    let onDeleteBookmark: (ReadingMark) -> Void

    let hideHighlights: Bool   // comics: highlights aren't supported

    @Environment(\.dismiss) private var dismiss
    @Environment(ThemeManager.self) private var themeManager

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if !hideHighlights {
                    Picker("Notes", selection: $tab) {
                        Text("Highlights").tag(NotesTab.highlights)
                        Text("Bookmarks").tag(NotesTab.bookmarks)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                }

                Group {
                    if tab == .highlights {
                        highlightsList
                    } else {
                        bookmarksList
                    }
                }
            }
            .navigationTitle("Notes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .onAppear {
                if hideHighlights { tab = .bookmarks }
            }
        }
    }

    @ViewBuilder
    private var highlightsList: some View {
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
                        onSelectHighlight(highlight)
                    } label: {
                        HStack(spacing: 12) {
                            RoundedRectangle(cornerRadius: 3)
                                .fill(Color(uiColor: highlight.uiColor))
                                .frame(width: 4)

                            VStack(alignment: .leading, spacing: 4) {
                                Text("\"\(highlight.text ?? "")\"")
                                    .font(.subheadline)
                                    .italic()
                                    .lineLimit(3)
                                    .foregroundStyle(.primary)

                                if let note = highlight.note, !note.isEmpty {
                                    Text(note)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                } else {
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
                        Button {
                            onEditHighlightNote(highlight)
                        } label: {
                            Label("Note", systemImage: "note.text")
                        }
                        .tint(themeManager.accentColor)
                    }
                }
                .onDelete { indexSet in
                    for index in indexSet {
                        onDeleteHighlight(highlights[index])
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var bookmarksList: some View {
        if bookmarks.isEmpty {
            ContentUnavailableView(
                "No Bookmarks",
                systemImage: "bookmark",
                description: Text("Bookmark pages from the menu to save them here.")
            )
        } else {
            List {
                ForEach(bookmarks, id: \.id) { bookmark in
                    Button {
                        onSelectBookmark(bookmark)
                    } label: {
                        HStack(spacing: 12) {
                            Circle()
                                .fill(Color(uiColor: bookmark.uiColor))
                                .frame(width: 12, height: 12)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(bookmarkTitle(for: bookmark))
                                    .font(.subheadline)
                                if let note = bookmark.note, !note.isEmpty {
                                    Text(note)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                }
                            }
                            Spacer()
                            Text("\(Int(bookmark.progression * 100))%")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.tertiary)
                        }
                    }
                    .foregroundStyle(.primary)
                }
                .onDelete { indexSet in
                    for index in indexSet {
                        onDeleteBookmark(bookmarks[index])
                    }
                }
            }
        }
    }

    private func bookmarkTitle(for bookmark: ReadingMark) -> String {
        if let title = bookmark.chapterTitle, !title.isEmpty { return title }
        if let page = bookmark.pageIndex { return "Page \(page + 1)" }
        return "Bookmark"
    }
}
