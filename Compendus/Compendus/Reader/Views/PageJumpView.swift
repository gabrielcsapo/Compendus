//
//  PageJumpView.swift
//  Compendus
//
//  Compact slider allowing the user to jump to a specific page.
//

import SwiftUI

struct PageJumpView: View {
    let totalPages: Int
    let currentPage: Int
    let chapterTitle: String?
    let chapterTitleForPage: ((Int) -> String?)?
    let onJump: (Double) -> Void

    @State private var targetPage: Double
    @Environment(\.dismiss) private var dismiss

    init(
        totalPages: Int,
        currentPage: Int,
        chapterTitle: String? = nil,
        chapterTitleForPage: ((Int) -> String?)? = nil,
        onJump: @escaping (Double) -> Void
    ) {
        self.totalPages = totalPages
        self.currentPage = currentPage
        self.chapterTitle = chapterTitle
        self.chapterTitleForPage = chapterTitleForPage
        self.onJump = onJump
        self._targetPage = State(initialValue: Double(currentPage))
    }

    private var displayedChapterTitle: String? {
        let page = Int(targetPage)
        if let chapterTitleForPage, let title = chapterTitleForPage(page) {
            return title
        }
        return chapterTitle
    }

    var body: some View {
        VStack(spacing: 12) {
            // Drag indicator
            Capsule()
                .fill(Color(.systemFill))
                .frame(width: 36, height: 5)
                .padding(.top, 8)

            if let title = displayedChapterTitle {
                Text(title)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .animation(.none, value: targetPage)
            }

            Text("Page \(Int(targetPage)) of \(totalPages)")
                .font(.subheadline.monospacedDigit().weight(.medium))
                .contentTransition(.numericText())
                .animation(.snappy(duration: 0.15), value: Int(targetPage))

            Slider(
                value: $targetPage,
                in: 1...Double(max(1, totalPages)),
                step: 1
            )
            .padding(.horizontal, 16)

            HStack {
                Text("1")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                Spacer()
                Text("\(totalPages)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 16)

            Button {
                let progression = Double(Int(targetPage) - 1) / Double(max(1, totalPages - 1))
                onJump(progression)
                dismiss()
            } label: {
                Text("Go to Page")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
        .padding(.horizontal, 4)
    }
}
