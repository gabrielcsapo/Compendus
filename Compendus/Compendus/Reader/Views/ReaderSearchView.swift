//
//  ReaderSearchView.swift
//  Compendus
//
//  Search sheet for finding text within the current book.
//

import SwiftUI
import EPUBReader

struct ReaderSearchView: View {
    let engine: any ReaderEngine
    let onNavigate: (ReaderLocation) -> Void

    @State private var query = ""
    @State private var results: [ReaderSearchResult] = []
    @State private var isSearching = false
    @State private var hasSearched = false
    @State private var searchTask: Task<Void, Never>?
    @Environment(\.dismiss) private var dismiss
    @Environment(ThemeManager.self) private var themeManager

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
                        Text("Search for text in this book")
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

                                HStack {
                                    if let title = result.chapterTitle {
                                        Text(title)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                    }

                                    Spacer()

                                    if let pageIndex = result.location.pageIndex {
                                        Text("Page \(pageIndex + 1)")
                                            .font(.caption)
                                            .foregroundStyle(.tertiary)
                                    }
                                }
                            }
                            .padding(.vertical, 2)
                        }
                        .foregroundStyle(.primary)
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle(hasSearched && !results.isEmpty ? "\(results.count) Results" : "Search")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search in book")
            .onChange(of: query) { _, newValue in
                // Cancel any in-flight search
                searchTask?.cancel()

                let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else {
                    results = []
                    hasSearched = false
                    isSearching = false
                    return
                }

                // Debounced live search — 300ms delay
                searchTask = Task {
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    guard !Task.isCancelled else { return }
                    await runSearch(trimmed)
                }
            }
            .onSubmit(of: .search) {
                // Immediate search on explicit submit
                searchTask?.cancel()
                let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { return }
                searchTask = Task {
                    await runSearch(trimmed)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func runSearch(_ trimmed: String) async {
        isSearching = true
        hasSearched = true
        let searchResults = await engine.search(query: trimmed)
        guard !Task.isCancelled else { return }
        results = searchResults
        isSearching = false
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
         Text(matchText).bold().foregroundColor(themeManager.accentColor) +
         Text(afterMatch))
    }
}
