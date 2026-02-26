//
//  HighlightColorPicker.swift
//  Compendus
//
//  Shared color picker sheet for highlighting text in readers
//

import SwiftUI

struct HighlightColorPicker: View {
    @Environment(HighlightColorManager.self) private var highlightColorManager

    var bookId: String? = nil
    let text: String
    let onSelectColor: (String) -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                // Preview of selected text
                if !text.isEmpty {
                    Text("\"\(text)\"")
                        .font(.subheadline)
                        .italic()
                        .lineLimit(3)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal)
                }

                // Color options
                HStack(spacing: 16) {
                    ForEach(highlightColorManager.colorsForBook(bookId), id: \.preset.id) { item in
                        Button {
                            onSelectColor(item.preset.hex)
                        } label: {
                            VStack(spacing: 6) {
                                Circle()
                                    .fill(Color(uiColor: UIColor(hex: item.preset.hex) ?? .yellow))
                                    .frame(width: 44, height: 44)
                                    .shadow(radius: 2)

                                Text(item.label)
                                    .font(.caption2)
                                    .foregroundStyle(.primary)
                            }
                        }
                    }
                }
                .padding(.horizontal)

                Spacer()
            }
            .padding(.top, 20)
            .navigationTitle("Highlight Color")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel", action: onCancel)
                }
            }
        }
    }
}
