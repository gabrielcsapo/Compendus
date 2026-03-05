//
//  EmptyStateView.swift
//  Compendus
//
//  Custom illustrated empty states with actionable CTAs
//

import SwiftUI

/// A customizable empty state view with illustration and call-to-action
struct EmptyStateView: View {
    let icon: String
    let title: String
    let description: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    @ScaledMetric(relativeTo: .largeTitle) private var iconSize: CGFloat = 60

    var body: some View {
        VStack(spacing: 20) {
            // Illustrated icon with background circle
            ZStack {
                Circle()
                    .fill(Color.accentColor.opacity(0.1))
                    .frame(width: iconSize * 1.8, height: iconSize * 1.8)

                Image(systemName: icon)
                    .font(.system(size: iconSize))
                    .foregroundStyle(Color.accentColor)
                    .symbolRenderingMode(.hierarchical)
            }
            .accessibilityHidden(true)

            VStack(spacing: 8) {
                Text(title)
                    .font(.title2)
                    .fontWeight(.semibold)
                    .multilineTextAlignment(.center)

                Text(description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 32)

            if let actionTitle = actionTitle, let action = action {
                Button(action: action) {
                    Text(actionTitle)
                        .fontWeight(.medium)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 12)
                }
                .buttonStyle(.borderedProminent)
                .padding(.top, 8)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

/// Error state with retry action
struct ErrorStateView: View {
    let message: String
    var retryAction: (() -> Void)? = nil

    var body: some View {
        EmptyStateView(
            icon: "exclamationmark.triangle",
            title: "Something Went Wrong",
            description: message,
            actionTitle: retryAction != nil ? "Try Again" : nil,
            action: retryAction
        )
    }
}

/// Search empty state
struct SearchEmptyStateView: View {
    let query: String

    var body: some View {
        EmptyStateView(
            icon: "magnifyingglass",
            title: "No Results",
            description: "No books found matching \"\(query)\". Try a different search term."
        )
    }
}

/// Library-specific empty states
enum LibraryEmptyState {
    case empty
    case noEbooks
    case noAudiobooks
    case noComics

    var icon: String {
        switch self {
        case .empty: return "books.vertical"
        case .noEbooks: return "book.closed"
        case .noAudiobooks: return "headphones"
        case .noComics: return "book.pages"
        }
    }

    var title: String {
        switch self {
        case .empty: return "Your Library is Empty"
        case .noEbooks: return "No Ebooks"
        case .noAudiobooks: return "No Audiobooks"
        case .noComics: return "No Comics"
        }
    }

    var description: String {
        switch self {
        case .empty: return "Connect to your server to start browsing your book collection."
        case .noEbooks: return "No ebooks found in your library."
        case .noAudiobooks: return "No audiobooks found in your library."
        case .noComics: return "No comics found in your library."
        }
    }
}

struct LibraryEmptyStateView: View {
    let state: LibraryEmptyState
    var refreshAction: (() -> Void)? = nil

    var body: some View {
        EmptyStateView(
            icon: state.icon,
            title: state.title,
            description: state.description,
            actionTitle: state == .empty && refreshAction != nil ? "Refresh" : nil,
            action: refreshAction
        )
    }
}

/// Home tab empty state
struct DownloadsEmptyStateView: View {
    var body: some View {
        EmptyStateView(
            icon: "house",
            title: "Welcome Home",
            description: "Your downloaded books and reading activity will appear here. Head to your library to download some books!"
        )
    }
}

#Preview("Empty Library") {
    LibraryEmptyStateView(state: .empty) {
        print("Refresh tapped")
    }
}

#Preview("Error State") {
    ErrorStateView(message: "Unable to connect to the server. Please check your connection and try again.") {
        print("Retry tapped")
    }
}

#Preview("Search Empty") {
    SearchEmptyStateView(query: "fantasy dragons")
}

#Preview("Downloads Empty") {
    DownloadsEmptyStateView()
}
