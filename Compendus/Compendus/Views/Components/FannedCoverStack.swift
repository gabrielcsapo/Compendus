//
//  FannedCoverStack.swift
//  Compendus
//
//  Shared fan-out layout for series cover images
//

import SwiftUI

struct FannedCoverStack<Cover: View>: View {
    let count: Int
    let cover: (Int) -> Cover
    let placeholder: AnyView?

    private let bookAspectRatio: CGFloat = 2/3

    init(
        count: Int,
        @ViewBuilder cover: @escaping (Int) -> Cover,
        placeholder: (() -> some View)? = Optional<() -> EmptyView>.none
    ) {
        self.count = count
        self.cover = cover
        self.placeholder = placeholder.map { AnyView($0()) }
    }

    var body: some View {
        ZStack {
            if count == 0 {
                if let placeholder {
                    placeholder
                } else {
                    defaultPlaceholder
                }
            } else if count == 1 {
                coverView(at: 0, total: 1)
            } else {
                let total = min(count, 3)
                ForEach(0..<total, id: \.self) { index in
                    coverView(at: index, total: total)
                        .rotationEffect(.degrees(rotation(for: index, total: total)))
                        .offset(x: offset(for: index, total: total))
                        .zIndex(Double(index))
                }
            }
        }
        .aspectRatio(bookAspectRatio, contentMode: .fit)
    }

    @ViewBuilder
    private func coverView(at index: Int, total: Int) -> some View {
        cover(index)
            .aspectRatio(bookAspectRatio, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .shadow(color: .black.opacity(0.2), radius: 6, x: 0, y: 3)
    }

    @ViewBuilder
    private var defaultPlaceholder: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(Color.gray.opacity(0.2))
            .overlay {
                Image(systemName: "books.vertical")
                    .font(.largeTitle)
                    .foregroundStyle(.secondary)
            }
    }

    // MARK: - Fan Layout

    private func rotation(for index: Int, total: Int) -> Double {
        switch total {
        case 1: return 0
        case 2: return index == 0 ? -4 : 4
        default: return [-6, 0, 6][index]
        }
    }

    private func offset(for index: Int, total: Int) -> CGFloat {
        switch total {
        case 1: return 0
        case 2: return index == 0 ? -6 : 6
        default: return [-8, 0, 8][index]
        }
    }
}

// MARK: - Previews

private struct PreviewCover: View {
    let color: Color

    var body: some View {
        RoundedRectangle(cornerRadius: 6)
            .fill(
                LinearGradient(
                    colors: [color, color.opacity(0.6)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
    }
}

#Preview("3 Books") {
    let colors: [Color] = [.blue, .purple, .orange]
    FannedCoverStack(count: 3) { index in
        PreviewCover(color: colors[index])
    }
    .frame(width: 180)
    .padding()
}

#Preview("2 Books") {
    let colors: [Color] = [.green, .red]
    FannedCoverStack(count: 2) { index in
        PreviewCover(color: colors[index])
    }
    .frame(width: 180)
    .padding()
}

#Preview("1 Book") {
    FannedCoverStack(count: 1) { _ in
        PreviewCover(color: .indigo)
    }
    .frame(width: 180)
    .padding()
}

#Preview("Empty") {
    FannedCoverStack(count: 0) { _ in
        EmptyView()
    }
    .frame(width: 180)
    .padding()
}
