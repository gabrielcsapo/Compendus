//
//  ExploreView.swift
//  Compendus
//
//  Server-driven explore view — renders whatever sections the API returns
//

import SwiftUI

// MARK: - View Model types (decoded from /api/explore)

struct ExploreViewModel: Codable {
    let sections: [ExploreSection]
}

struct ExploreSection: Codable, Identifiable {
    let id: String
    let title: String
    let books: [Book]
    let action: ExploreAction?
}

struct ExploreAction: Codable {
    let label: String
}

// MARK: - ExploreView

struct ExploreView: View {
    @Environment(APIService.self) private var apiService

    var onBookTap: (Book) -> Void
    var onSeriesTap: ((String) -> Void)?
    /// Called when a "See All" action with a series name is tapped
    var onSeeAllSeries: ((String) -> Void)?

    @State private var viewModel: ExploreViewModel?
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading && viewModel == nil {
                exploreSkeletons
            } else if let error = errorMessage {
                ErrorStateView(message: error) {
                    Task { await loadExplore() }
                }
            } else if let vm = viewModel {
                if vm.sections.isEmpty {
                    emptyState
                } else {
                    exploreContent(vm)
                }
            }
        }
        .task { await loadExplore() }
        .refreshable { await loadExplore() }
    }

    // MARK: - Content

    private func exploreContent(_ vm: ExploreViewModel) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                ForEach(vm.sections) { section in
                    ExploreSectionView(
                        section: section,
                        onBookTap: onBookTap,
                        onSeeAll: seeAllAction(for: section)
                    )
                }
            }
            .padding(.vertical, 16)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func seeAllAction(for section: ExploreSection) -> (() -> Void)? {
        guard section.action != nil else { return nil }
        // Extract series name from section id (e.g. "series_Fantasy" → "Fantasy")
        if section.id.hasPrefix("series_") {
            let name = String(section.id.dropFirst("series_".count))
            return { onSeeAllSeries?(name) }
        }
        return nil
    }

    // MARK: - Skeleton

    private var exploreSkeletons: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                ForEach(0..<4, id: \.self) { _ in
                    ExploreSectionSkeleton()
                }
            }
            .padding(.vertical, 16)
        }
    }

    // MARK: - Empty

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "books.vertical")
                .font(.system(size: 48))
                .foregroundStyle(.tertiary)
            Text("Your library is empty")
                .font(.headline)
                .foregroundStyle(.secondary)
            Text("Add some books to get started.")
                .font(.subheadline)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.top, 80)
    }

    // MARK: - Load

    private func loadExplore() async {
        if viewModel == nil { isLoading = true }
        errorMessage = nil
        do {
            viewModel = try await apiService.fetchExplore()
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

// MARK: - Section view

private struct ExploreSectionView: View {
    let section: ExploreSection
    var onBookTap: (Book) -> Void
    var onSeeAll: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header
            HStack(alignment: .firstTextBaseline) {
                Text(section.title)
                    .font(.title3)
                    .fontWeight(.semibold)
                    .padding(.horizontal, 20)

                Spacer()

                if let action = section.action, let onSeeAll {
                    Button(action.label, action: onSeeAll)
                        .font(.subheadline)
                        .foregroundStyle(.tint)
                        .padding(.horizontal, 20)
                }
            }

            // Horizontal book carousel
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(section.books) { book in
                        ExploreBookCard(book: book)
                            .onTapGesture { onBookTap(book) }
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }
}

// MARK: - Book card

private struct ExploreBookCard: View {
    let book: Book

    private let cardWidth: CGFloat = 110
    private let aspectRatio: CGFloat = 2.0 / 3.0

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Cover
            CachedCoverImage(bookId: book.id, hasCover: book.coverUrl != nil, format: book.format)
                .aspectRatio(aspectRatio, contentMode: .fit)
                .frame(width: cardWidth)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .shadow(color: .black.opacity(0.15), radius: 3, x: 0, y: 2)
                .overlay(alignment: .bottom) {
                    if let progress = book.readingProgress, progress > 0 {
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Rectangle().fill(Color.black.opacity(0.3))
                                Rectangle()
                                    .fill(Color.accentColor)
                                    .frame(width: geo.size.width * progress)
                            }
                        }
                        .frame(height: 4)
                        .clipShape(RoundedRectangle(cornerRadius: 2))
                        .padding(4)
                    }
                }

            // Title + author
            VStack(alignment: .leading, spacing: 2) {
                Text(book.title)
                    .font(.caption)
                    .fontWeight(.medium)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                Text(book.authorsDisplay)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(width: cardWidth)
        .contentShape(Rectangle())
    }
}

// MARK: - Skeleton

private struct ExploreSectionSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ShimmerRectangle(cornerRadius: 4)
                .frame(width: 140, height: 20)
                .padding(.horizontal, 20)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(0..<6, id: \.self) { _ in
                        VStack(alignment: .leading, spacing: 6) {
                            ShimmerRectangle(cornerRadius: 8)
                                .frame(width: 110, height: 165)
                            ShimmerRectangle(cornerRadius: 3)
                                .frame(width: 90, height: 12)
                            ShimmerRectangle(cornerRadius: 3)
                                .frame(width: 70, height: 10)
                        }
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }
}
