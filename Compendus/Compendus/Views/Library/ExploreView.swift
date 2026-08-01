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
    let purchases: [ExplorePurchaseIdea]?
    let curatedAt: String?
    let curationSource: String?
}

struct ExploreSection: Codable, Identifiable {
    let id: String
    let title: String
    let subtitle: String?
    let books: [Book]
    let reasons: [String: String]?
    let action: ExploreAction?
}

struct ExplorePurchaseIdea: Codable, Identifiable {
    let id: String
    let title: String
    let authors: [String]
    let formatHint: String
    let reason: String
    let coverUrl: String?
    let isbn13: String?
    let purchaseUrl: String
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
                if let purchases = vm.purchases, !purchases.isEmpty {
                    ExplorePurchaseSection(items: purchases)
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
                VStack(alignment: .leading, spacing: 3) {
                    Text(section.title)
                        .font(.title3)
                        .fontWeight(.semibold)
                    if let subtitle = section.subtitle {
                        Text(subtitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
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
                        Button {
                            onBookTap(book)
                        } label: {
                            ExploreBookCard(book: book, reason: section.reasons?[book.id])
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(book.title), by \(book.authorsDisplay)")
                        .accessibilityHint("Opens book details")
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
    let reason: String?

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var cardWidth: CGFloat { LibraryLayout.carouselCoverWidth(horizontalSizeClass) }
    private let aspectRatio: CGFloat = LibraryLayout.coverAspect

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

                if let reason {
                    Text(reason)
                        .font(.caption2)
                        .foregroundStyle(.tint)
                        .lineLimit(3)
                        .padding(.top, 2)
                }
            }
        }
        .frame(width: cardWidth)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
    }
}

// MARK: - Verified purchase ideas

private struct ExplorePurchaseSection: View {
    let items: [ExplorePurchaseIdea]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Consider Adding")
                    .font(.title3.weight(.semibold))
                Text("Verified titles you do not currently own. Buying requires internet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 20)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(items) { item in
                        if let url = URL(string: item.purchaseUrl) {
                            Link(destination: url) {
                                VStack(alignment: .leading, spacing: 6) {
                                    ZStack {
                                        RoundedRectangle(cornerRadius: 10)
                                            .fill(.tint.opacity(0.12))
                                        Image(systemName: item.formatHint == "audiobook" ? "headphones" : item.formatHint == "comic" ? "text.bubble" : "book.closed")
                                            .font(.title)
                                            .foregroundStyle(.tint)
                                    }
                                    .frame(width: 132, height: 92)
                                    Text(item.title)
                                        .font(.caption.weight(.medium))
                                        .foregroundStyle(.primary)
                                        .lineLimit(2)
                                    Text(item.authors.first ?? "Unknown author")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                    Text(item.reason)
                                        .font(.caption2)
                                        .foregroundStyle(.tint)
                                        .lineLimit(3)
                                }
                                .frame(width: 132, alignment: .leading)
                            }
                            .buttonStyle(.plain)
                            .accessibilityHint("Opens a purchase search in your browser")
                        }
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }
}

// MARK: - Skeleton

private struct ExploreSectionSkeleton: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var coverWidth: CGFloat { LibraryLayout.carouselCoverWidth(horizontalSizeClass) }
    private var coverHeight: CGFloat { LibraryLayout.carouselCoverHeight(horizontalSizeClass) }

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
                                .frame(width: coverWidth, height: coverHeight)
                            ShimmerRectangle(cornerRadius: 3)
                                .frame(width: coverWidth * 0.82, height: 12)
                            ShimmerRectangle(cornerRadius: 3)
                                .frame(width: coverWidth * 0.64, height: 10)
                        }
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }
}
