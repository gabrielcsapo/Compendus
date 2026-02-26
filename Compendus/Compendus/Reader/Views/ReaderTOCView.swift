//
//  ReaderTOCView.swift
//  Compendus
//
//  Unified table of contents view for all book formats.
//  Works with format-agnostic TOCItem types from the ReaderEngine.
//

import SwiftUI

struct ReaderTOCView: View {
    let items: [TOCItem]
    let currentLocation: ReaderLocation?
    let onSelect: (TOCItem) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(ThemeManager.self) private var themeManager

    var body: some View {
        NavigationStack {
            tocContent
                .navigationTitle("Table of Contents")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Done") { dismiss() }
                    }
                }
        }
    }

    @ViewBuilder
    private var tocContent: some View {
        if items.isEmpty {
            ContentUnavailableView {
                Label("No Table of Contents", systemImage: "list.bullet")
            } description: {
                Text("This book doesn't have a table of contents.")
            }
        } else {
            List {
                ForEach(flattenedItems) { item in
                    tocRow(for: item)
                }
            }
            .listStyle(.plain)
        }
    }

    private func tocRow(for item: TOCItem) -> some View {
        let isCurrent = isCurrentItem(item)
        return Button {
            onSelect(item)
        } label: {
            HStack(spacing: 8) {
                Text(item.title)
                    .font(fontForLevel(item.level))
                    .foregroundStyle(isCurrent ? themeManager.accentColor : Color.primary)
                    .lineLimit(2)

                Spacer(minLength: 4)

                if let pageIndex = item.location.pageIndex {
                    Text("\(pageIndex + 1)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }

                if isCurrent {
                    Image(systemName: "bookmark.fill")
                        .font(.caption)
                        .foregroundStyle(themeManager.accentColor)
                }
            }
            .padding(.leading, CGFloat(item.level) * 20)
        }
        .listRowBackground(isCurrent ? themeManager.accentColor.opacity(0.1) : Color.clear)
    }

    private func fontForLevel(_ level: Int) -> Font {
        switch level {
        case 0: return .body.weight(.medium)
        case 1: return .subheadline
        default: return .footnote
        }
    }

    /// Flatten nested TOC items for display in a flat list (with indentation via level)
    private var flattenedItems: [TOCItem] {
        var result: [TOCItem] = []
        flatten(items, into: &result)
        return result
    }

    private func flatten(_ items: [TOCItem], into result: inout [TOCItem]) {
        for item in items {
            result.append(item)
            flatten(item.children, into: &result)
        }
    }

    private func isCurrentItem(_ item: TOCItem) -> Bool {
        guard let current = currentLocation else { return false }

        // Match by href for EPUB
        if let itemHref = item.location.href, let currentHref = current.href {
            let itemBase = itemHref.components(separatedBy: "#").first ?? itemHref
            let currentBase = currentHref.components(separatedBy: "#").first ?? currentHref
            return itemBase == currentBase || currentBase.hasSuffix(itemBase) || itemBase.hasSuffix(currentBase)
        }

        // Match by page index for PDF
        if let itemPage = item.location.pageIndex, let currentPage = current.pageIndex {
            return itemPage == currentPage
        }

        return false
    }
}
