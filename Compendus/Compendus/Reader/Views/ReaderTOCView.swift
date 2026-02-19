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

    var body: some View {
        NavigationStack {
            Group {
                if items.isEmpty {
                    ContentUnavailableView {
                        Label("No Table of Contents", systemImage: "list.bullet")
                    } description: {
                        Text("This book doesn't have a table of contents.")
                    }
                } else {
                    List {
                        ForEach(flattenedItems) { item in
                            Button {
                                onSelect(item)
                            } label: {
                                HStack {
                                    Text(item.title)
                                        .foregroundStyle(.primary)
                                        .padding(.leading, CGFloat(item.level) * 16)

                                    Spacer()

                                    if isCurrentItem(item) {
                                        Image(systemName: "bookmark.fill")
                                            .foregroundStyle(.blue)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Table of Contents")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
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
