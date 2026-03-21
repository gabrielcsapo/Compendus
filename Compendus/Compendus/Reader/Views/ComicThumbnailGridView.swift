//
//  ComicThumbnailGridView.swift
//  Compendus
//
//  Page thumbnail grid for comic books, replacing the TOC view.
//  Shows a lazy grid of page thumbnails that can be tapped to jump to any page.
//

import SwiftUI
import EPUBReader

struct ComicThumbnailGridView: View {
    let engine: ComicEngine
    let onSelect: (Int) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(ReaderSettings.self) private var readerSettings

    private let columns = [
        GridItem(.adaptive(minimum: 100, maximum: 150), spacing: 12)
    ]

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(0..<engine.totalPositions, id: \.self) { pageIndex in
                            ComicThumbnailCell(
                                engine: engine,
                                pageIndex: pageIndex,
                                isSelected: pageIndex == engine.currentPage
                            )
                            .id(pageIndex)
                            .onTapGesture {
                                onSelect(pageIndex)
                                dismiss()
                            }
                        }
                    }
                    .padding()
                }
                .onAppear {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                        withAnimation {
                            proxy.scrollTo(engine.currentPage, anchor: .center)
                        }
                    }
                }
            }
            .navigationTitle("Pages")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

private struct ComicThumbnailCell: View {
    let engine: ComicEngine
    let pageIndex: Int
    let isSelected: Bool

    @State private var thumbnail: UIImage?
    @State private var isLoading = false

    var body: some View {
        VStack(spacing: 4) {
            Group {
                if let thumbnail {
                    Image(uiImage: thumbnail)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } else {
                    Rectangle()
                        .fill(Color(.systemGray5))
                        .overlay {
                            if isLoading {
                                ProgressView()
                                    .scaleEffect(0.7)
                            } else {
                                Text("\(pageIndex + 1)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                }
            }
            .frame(height: 140)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(isSelected ? Color.accentColor : Color.clear, lineWidth: 3)
            )
            .shadow(color: isSelected ? .accentColor.opacity(0.3) : .clear, radius: 4)

            Text("\(pageIndex + 1)")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(isSelected ? .primary : .secondary)
        }
        .task {
            await loadThumbnail()
        }
    }

    private func loadThumbnail() async {
        guard thumbnail == nil else { return }
        isLoading = true

        if let image = await engine.loadPageImage(pageIndex) {
            // Downscale for memory efficiency
            let maxSize: CGFloat = 200
            let scale = min(maxSize / image.size.width, maxSize / image.size.height, 1.0)
            let newSize = CGSize(width: image.size.width * scale, height: image.size.height * scale)

            let resized = await Task.detached(priority: .userInitiated) {
                UIGraphicsImageRenderer(size: newSize).image { _ in
                    image.draw(in: CGRect(origin: .zero, size: newSize))
                }
            }.value

            thumbnail = resized
        }

        isLoading = false
    }
}
