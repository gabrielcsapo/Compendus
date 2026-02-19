//
//  PageJumpView.swift
//  Compendus
//
//  Sheet allowing the user to jump to a specific page via slider.
//

import SwiftUI

struct PageJumpView: View {
    let totalPages: Int
    let currentPage: Int
    let onJump: (Double) -> Void

    @State private var targetPage: Double
    @Environment(\.dismiss) private var dismiss

    init(totalPages: Int, currentPage: Int, onJump: @escaping (Double) -> Void) {
        self.totalPages = totalPages
        self.currentPage = currentPage
        self.onJump = onJump
        self._targetPage = State(initialValue: Double(currentPage))
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()

                Text("Page \(Int(targetPage)) of \(totalPages)")
                    .font(.title2.monospacedDigit().weight(.medium))

                Slider(
                    value: $targetPage,
                    in: 1...Double(max(1, totalPages)),
                    step: 1
                )
                .padding(.horizontal, 24)

                HStack {
                    Text("1")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text("\(totalPages)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 24)

                Spacer()
            }
            .navigationTitle("Go to Page")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Go") {
                        let progression = Double(Int(targetPage) - 1) / Double(max(1, totalPages - 1))
                        onJump(progression)
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
    }
}
