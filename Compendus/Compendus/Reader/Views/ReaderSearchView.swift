//
//  ReaderSearchView.swift
//  Compendus
//
//  Search sheet for finding text within the current book.
//

import SwiftUI

struct ReaderSearchView: View {
    let engine: any ReaderEngine
    let onNavigate: (ReaderLocation) -> Void

    @State private var query = ""
    @State private var results: [ReaderSearchResult] = []
    @State private var isSearching = false
    @State private var hasSearched = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if isSearching {
                    VStack(spacing: 16) {
                        ProgressView()
                        Text("Searching...")
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxHeight: .infinity)
                } else if results.isEmpty && hasSearched {
                    ContentUnavailableView.search(text: query)
                } else if results.isEmpty {
                    ContentUnavailableView {
                        Label("Search", systemImage: "magnifyingglass")
                    } description: {
                        Text("Type to search for text in this book")
                    }
                } else {
                    List(results) { result in
                        Button {
                            onNavigate(result.location)
                            dismiss()
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                highlightedSnippet(result)
                                    .font(.subheadline)
                                    .lineLimit(3)

                                if let title = result.chapterTitle {
                                    Text(title)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .padding(.vertical, 2)
                        }
                        .foregroundStyle(.primary)
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Search")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search in book")
            .onSubmit(of: .search) {
                performSearch()
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func performSearch() {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        isSearching = true
        hasSearched = true
        Task {
            let searchResults = await engine.search(query: trimmed)
            results = searchResults
            isSearching = false
        }
    }

    @ViewBuilder
    private func highlightedSnippet(_ result: ReaderSearchResult) -> some View {
        let snippet = result.snippet
        let matchRange = result.matchRange

        // Build attributed text with highlighted match
        let beforeMatch = String(snippet[snippet.startIndex..<matchRange.lowerBound])
        let matchText = String(snippet[matchRange])
        let afterMatch = String(snippet[matchRange.upperBound..<snippet.endIndex])

        (Text(beforeMatch) +
         Text(matchText).bold().foregroundColor(.accentColor) +
         Text(afterMatch))
    }
}
