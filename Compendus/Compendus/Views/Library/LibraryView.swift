//
//  LibraryView.swift
//  Compendus
//
//  Browse books from the server library
//

import SwiftUI
import SwiftData

enum BookFilter: String, CaseIterable {
    case all = "All"
    case ebooks = "Ebooks"
    case audiobooks = "Audiobooks"
    case comics = "Comics"

    var icon: String {
        switch self {
        case .all: return "books.vertical"
        case .ebooks: return "book.closed"
        case .audiobooks: return "headphones"
        case .comics: return "book.pages"
        }
    }

    /// API type parameter for server-side filtering
    var apiType: String? {
        switch self {
        case .all: return nil
        case .ebooks: return "ebook"
        case .audiobooks: return "audiobook"
        case .comics: return "comic"
        }
    }
}

struct LibraryView: View {
    @Environment(APIService.self) private var apiService
    @Environment(ServerConfig.self) private var serverConfig
    @Environment(\.modelContext) private var modelContext

    @State private var books: [Book] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var searchText = ""
    @State private var hasMore = true
    @State private var offset = 0
    @State private var totalCount: Int = 0
    @State private var selectedBook: Book?
    @State private var selectedFilter: BookFilter = .all

    private let limit = 50
    private let columns = [
        GridItem(.adaptive(minimum: 150, maximum: 200), spacing: 16)
    ]

    var body: some View {
        NavigationStack {
            Group {
                if books.isEmpty && isLoading {
                    ProgressView("Loading library...")
                } else if books.isEmpty && errorMessage != nil {
                    ContentUnavailableView {
                        Label("Error", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(errorMessage ?? "Unknown error")
                    } actions: {
                        Button("Try Again") {
                            Task { await loadBooks() }
                        }
                    }
                } else if books.isEmpty {
                    ContentUnavailableView {
                        Label(selectedFilter == .all ? "No Books" : "No \(selectedFilter.rawValue)", systemImage: selectedFilter.icon)
                    } description: {
                        Text(selectedFilter == .all ? "Your library is empty" : "No \(selectedFilter.rawValue.lowercased()) found in your library")
                    }
                } else {
                    ScrollView {
                        LazyVGrid(columns: columns, spacing: 16) {
                            ForEach(Array(books.enumerated()), id: \.element.id) { index, book in
                                BookGridItem(book: book)
                                    .onTapGesture {
                                        selectedBook = book
                                    }
                                    .onAppear {
                                        // Load more when nearing the end (within last 10 items)
                                        if index >= books.count - 10 && hasMore && !isLoading {
                                            Task { await loadMoreBooks() }
                                        }
                                    }
                            }
                        }
                        .padding()

                        if isLoading && !books.isEmpty {
                            ProgressView()
                                .padding()
                        }
                    }
                }
            }
            .navigationTitle(totalCount > 0 ? "Library (\(totalCount))" : "Library")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        ForEach(BookFilter.allCases, id: \.self) { filter in
                            Button {
                                selectedFilter = filter
                            } label: {
                                Label(filter.rawValue, systemImage: filter.icon)
                                if selectedFilter == filter {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    } label: {
                        Label("Filter", systemImage: selectedFilter == .all ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                    }
                }
            }
            .searchable(text: $searchText, prompt: "Search books...")
            .onChange(of: searchText) { _, newValue in
                Task {
                    if newValue.isEmpty {
                        await loadBooks()
                    } else {
                        await searchBooks(query: newValue)
                    }
                }
            }
            .onChange(of: selectedFilter) { _, _ in
                Task {
                    await loadBooks()
                }
            }
            .refreshable {
                await loadBooks()
            }
            .task {
                if books.isEmpty {
                    await loadBooks()
                }
            }
            .sheet(item: $selectedBook) { book in
                BookDetailView(book: book)
            }
        }
    }

    private func loadBooks() async {
        isLoading = true
        errorMessage = nil
        offset = 0

        do {
            let response = try await apiService.fetchBooks(limit: limit, offset: 0, type: selectedFilter.apiType)
            books = response.books
            totalCount = response.totalCount ?? response.books.count
            hasMore = response.books.count >= limit
            offset = response.books.count
        } catch {
            // Log detailed error for debugging
            print("[LibraryView] Load error: \(error)")
            if let apiError = error as? APIError {
                errorMessage = apiError.errorDescription ?? error.localizedDescription
            } else if let urlError = error as? URLError {
                errorMessage = "Connection error: \(urlError.localizedDescription) (code: \(urlError.code.rawValue))"
            } else {
                errorMessage = error.localizedDescription
            }
        }

        isLoading = false
    }

    private func loadMoreBooks() async {
        guard hasMore, !isLoading else { return }

        isLoading = true

        do {
            let response = try await apiService.fetchBooks(limit: limit, offset: offset, type: selectedFilter.apiType)
            let newBooks = response.books
            books.append(contentsOf: newBooks)
            hasMore = newBooks.count >= limit
            offset += newBooks.count
        } catch {
            // Silently fail for pagination errors
        }

        isLoading = false
    }

    private func searchBooks(query: String) async {
        isLoading = true
        errorMessage = nil

        do {
            let response = try await apiService.searchBooks(query: query)
            books = response.books  // Use computed property that extracts books from results
            totalCount = response.books.count  // Show search result count
            hasMore = false  // Search doesn't support pagination
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }
}

#Preview {
    LibraryView()
        .environment(ServerConfig())
        .environment(APIService(config: ServerConfig()))
        .modelContainer(for: DownloadedBook.self, inMemory: true)
}
