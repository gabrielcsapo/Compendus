//
//  HighlightsView.swift
//  Compendus
//
//  App-wide highlights tab showing all highlights grouped by book
//

import SwiftUI
import SwiftData

struct HighlightsView: View {
    @Query(sort: \BookHighlight.createdAt, order: .reverse) private var allHighlights: [BookHighlight]
    @Query private var allBooks: [DownloadedBook]

    @Environment(\.modelContext) private var modelContext
    @State private var searchText = ""
    @State private var bookToOpen: DownloadedBook?
    @State private var editingHighlight: BookHighlight?

    /// Highlights grouped by bookId, sorted by most recent highlight first
    private var groupedHighlights: [(book: DownloadedBook?, bookId: String, highlights: [BookHighlight])] {
        let filtered = searchText.isEmpty ? allHighlights : allHighlights.filter { highlight in
            highlight.text.localizedCaseInsensitiveContains(searchText) ||
            (highlight.note?.localizedCaseInsensitiveContains(searchText) ?? false) ||
            (highlight.chapterTitle?.localizedCaseInsensitiveContains(searchText) ?? false)
        }

        let grouped = Dictionary(grouping: filtered) { $0.bookId }

        return grouped.map { bookId, highlights in
            let book = allBooks.first { $0.id == bookId }
            return (book: book, bookId: bookId, highlights: highlights)
        }
        .sorted { a, b in
            let aDate = a.highlights.first?.createdAt ?? .distantPast
            let bDate = b.highlights.first?.createdAt ?? .distantPast
            return aDate > bDate
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if allHighlights.isEmpty {
                    ContentUnavailableView {
                        Label("No Highlights", systemImage: "highlighter")
                    } description: {
                        Text("Highlights you create while reading will appear here.")
                    }
                } else if groupedHighlights.isEmpty {
                    ContentUnavailableView.search(text: searchText)
                } else {
                    List {
                        ForEach(groupedHighlights, id: \.bookId) { group in
                            Section {
                                ForEach(group.highlights, id: \.id) { highlight in
                                    HighlightRow(highlight: highlight)
                                        .contentShape(Rectangle())
                                        .onTapGesture {
                                            if let book = group.book {
                                                bookToOpen = book
                                            }
                                        }
                                        .swipeActions(edge: .leading) {
                                            Button {
                                                editingHighlight = highlight
                                            } label: {
                                                Label("Note", systemImage: "note.text")
                                            }
                                            .tint(.blue)
                                        }
                                }
                                .onDelete { indexSet in
                                    for index in indexSet {
                                        let highlight = group.highlights[index]
                                        modelContext.delete(highlight)
                                    }
                                    try? modelContext.save()
                                }
                            } header: {
                                BookSectionHeader(book: group.book, highlightCount: group.highlights.count)
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("Highlights")
            .searchable(text: $searchText, prompt: "Search highlights")
            .fullScreenCover(item: $bookToOpen) { book in
                ReaderContainerView(book: book)
            }
            .sheet(item: $editingHighlight) { highlight in
                EditNoteSheet(highlight: highlight) {
                    try? modelContext.save()
                }
            }
        }
    }
}

// MARK: - Book Section Header

private struct BookSectionHeader: View {
    let book: DownloadedBook?
    let highlightCount: Int

    var body: some View {
        HStack(spacing: 10) {
            // Book cover thumbnail
            if let coverData = book?.coverData, let uiImage = UIImage(data: coverData) {
                Image(uiImage: uiImage)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(width: 30, height: 44)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            } else {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.gray.opacity(0.2))
                    .frame(width: 30, height: 44)
                    .overlay {
                        Image(systemName: "book.closed")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(book?.title ?? "Unknown Book")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                HStack(spacing: 4) {
                    if let author = book?.authorsDisplay, !author.isEmpty {
                        Text(author)
                            .lineLimit(1)
                    }
                    Text("·")
                    Text("\(highlightCount) highlight\(highlightCount == 1 ? "" : "s")")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            Spacer()
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Highlight Row

private struct HighlightRow: View {
    let highlight: BookHighlight

    var body: some View {
        HStack(spacing: 12) {
            // Color indicator
            RoundedRectangle(cornerRadius: 3)
                .fill(Color(uiColor: highlight.uiColor))
                .frame(width: 4)

            VStack(alignment: .leading, spacing: 4) {
                // Highlighted text
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
                } else {
                    Text("Add note...")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }

                // Metadata row
                HStack {
                    if let chapter = highlight.chapterTitle {
                        Text(chapter)
                            .lineLimit(1)
                    }

                    Spacer()

                    Text(highlight.createdAt, style: .date)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    HighlightsView()
        .modelContainer(for: [DownloadedBook.self, BookHighlight.self], inMemory: true)
}
