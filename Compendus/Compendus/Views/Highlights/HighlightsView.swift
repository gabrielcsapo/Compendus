//
//  HighlightsView.swift
//  Compendus
//
//  App-wide highlights tab showing books with highlight counts,
//  with drill-down to individual highlights per book.
//

import SwiftUI
import SwiftData
import EPUBReader

struct HighlightsView: View {
    @Query(sort: \BookHighlight.createdAt, order: .reverse) private var allHighlightsQuery: [BookHighlight]
    @Query private var allBooksQuery: [DownloadedBook]

    @Environment(ServerConfig.self) private var serverConfig

    @State private var searchText = ""

    private var allHighlights: [BookHighlight] {
        let pid = serverConfig.selectedProfileId ?? ""
        return allHighlightsQuery.filter { $0.profileId == pid || $0.profileId.isEmpty }
    }

    private var allBooks: [DownloadedBook] {
        let pid = serverConfig.selectedProfileId ?? ""
        return allBooksQuery.filter { $0.profileId == pid || $0.profileId.isEmpty }
    }

    /// Cached grouped highlights to avoid recomputing on every render
    private var groupedHighlights: [(book: DownloadedBook?, bookId: String, highlights: [BookHighlight])] {
        computeGroupedHighlights()
    }

    private func computeGroupedHighlights() -> [(book: DownloadedBook?, bookId: String, highlights: [BookHighlight])] {
        let filtered = searchText.isEmpty ? allHighlights : allHighlights.filter { highlight in
            highlight.text.localizedCaseInsensitiveContains(searchText) ||
            (highlight.note?.localizedCaseInsensitiveContains(searchText) ?? false) ||
            (highlight.chapterTitle?.localizedCaseInsensitiveContains(searchText) ?? false)
        }

        let grouped = Dictionary(grouping: filtered) { $0.bookId }

        // Build a lookup dictionary for O(1) book lookups instead of O(n) per group
        let bookLookup = Dictionary(uniqueKeysWithValues: allBooks.map { ($0.id, $0) })

        return grouped.map { bookId, highlights in
            let book = bookLookup[bookId]
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
                    EmptyStateView(
                        icon: "highlighter",
                        title: "No Highlights",
                        description: "Highlights you create while reading will appear here."
                    )
                } else if groupedHighlights.isEmpty {
                    SearchEmptyStateView(query: searchText)
                } else {
                    List {
                        ForEach(groupedHighlights, id: \.bookId) { group in
                            NavigationLink(value: group.bookId) {
                                BookHighlightRow(book: group.book, highlights: group.highlights)
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("Highlights")
            .searchable(text: $searchText, prompt: "Search highlights")
            .navigationDestination(for: String.self) { bookId in
                let highlights = groupedHighlights.first { $0.bookId == bookId }
                BookHighlightsDetailView(
                    book: highlights?.book,
                    bookId: bookId,
                    highlights: highlights?.highlights ?? []
                )
            }
        }
    }
}

// MARK: - Book Highlight Row (top-level list item)

private struct BookHighlightRow: View {
    let book: DownloadedBook?
    let highlights: [BookHighlight]

    private var mostRecentDate: Date? {
        highlights.first?.createdAt
    }

    /// Distinct highlight colors used in this book
    private var highlightColors: [UIColor] {
        var seen = Set<String>()
        var colors: [UIColor] = []
        for h in highlights {
            if seen.insert(h.color).inserted {
                colors.append(h.uiColor)
            }
            if colors.count >= 4 { break }
        }
        return colors
    }

    var body: some View {
        HStack(spacing: 12) {
            // Book cover thumbnail
            LocalCoverImage(bookId: book?.id ?? "", coverData: book?.coverData, format: book?.format ?? "epub")
                .frame(width: 44, height: 64)
                .clipShape(RoundedRectangle(cornerRadius: 6))

            VStack(alignment: .leading, spacing: 4) {
                Text(book?.title ?? "Unknown Book")
                    .font(.body.weight(.semibold))
                    .lineLimit(2)

                if let author = book?.authorsDisplay, !author.isEmpty {
                    Text(author)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                HStack(spacing: 8) {
                    // Highlight count
                    Label("\(highlights.count)", systemImage: "highlighter")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    // Color dots
                    HStack(spacing: 4) {
                        ForEach(highlightColors, id: \.self) { color in
                            Circle()
                                .fill(Color(uiColor: color))
                                .frame(width: 8, height: 8)
                        }
                    }

                    Spacer()

                    // Most recent date
                    if let date = mostRecentDate {
                        Text(date, style: .date)
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Book Highlights Detail View

private struct BookHighlightsDetailView: View {
    let book: DownloadedBook?
    let bookId: String
    let highlights: [BookHighlight]

    @Environment(\.modelContext) private var modelContext
    @Environment(ReaderSettings.self) private var readerSettings
    @State private var bookToOpen: DownloadedBook?
    @State private var highlightPosition: String?
    @State private var editingHighlight: BookHighlight?

    var body: some View {
        List {
            ForEach(highlights, id: \.id) { highlight in
                HighlightRow(highlight: highlight)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        if let book {
                            highlightPosition = highlight.locatorJSON
                            bookToOpen = book
                        }
                    }
                    .swipeActions(edge: .leading) {
                        Button {
                            editingHighlight = highlight
                        } label: {
                            Label("Note", systemImage: "note.text")
                        }
                        .tint(.accentColor)
                    }
            }
            .onDelete { indexSet in
                for index in indexSet {
                    let highlight = highlights[index]
                    modelContext.delete(highlight)
                }
                try? modelContext.save()
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(book?.title ?? "Highlights")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if book != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        bookToOpen = book
                    } label: {
                        Label("Open Book", systemImage: "book")
                    }
                }
            }
        }
        .fullScreenCover(item: $bookToOpen) { book in
            ReaderContainerView(book: book, initialPosition: highlightPosition)
                .environment(readerSettings)
        }
        .onChange(of: bookToOpen) { _, newValue in
            if newValue == nil {
                highlightPosition = nil
            }
        }
        .sheet(item: $editingHighlight) { highlight in
            EditNoteSheet(highlight: highlight) {
                try? modelContext.save()
            }
        }
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
