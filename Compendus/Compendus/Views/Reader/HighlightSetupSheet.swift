//
//  HighlightSetupSheet.swift
//  Compendus
//
//  First-time setup sheet for per-book highlight colors.
//  Shown when opening a book for the first time.
//

import SwiftUI

struct HighlightSetupSheet: View {
    let bookId: String
    let bookTitle: String
    let onUseDefaults: () -> Void
    let onCustomize: () -> Void

    @Environment(HighlightColorManager.self) private var highlightColorManager
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                VStack(spacing: 8) {
                    Image(systemName: "highlighter")
                        .font(.system(size: 40))
                        .foregroundStyle(.accent)

                    Text("Set Up Highlights")
                        .font(.title2.bold())

                    Text("Choose how you want to categorize highlights for this book.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }
                .padding(.top, 20)

                // Preview of default colors
                VStack(alignment: .leading, spacing: 8) {
                    Text("Default Colors")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(.secondary)

                    HStack(spacing: 16) {
                        Spacer()
                        ForEach(highlightColorManager.colors) { preset in
                            VStack(spacing: 6) {
                                Circle()
                                    .fill(Color(uiColor: UIColor(hex: preset.hex) ?? .yellow))
                                    .frame(width: 36, height: 36)
                                    .overlay {
                                        Circle()
                                            .strokeBorder(.white.opacity(0.3), lineWidth: 1)
                                    }
                                Text(preset.name)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                    }
                    .padding()
                    .background(Color(.systemGray6))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .padding(.horizontal)

                Spacer()

                VStack(spacing: 12) {
                    Button {
                        onUseDefaults()
                        dismiss()
                    } label: {
                        Text("Use Defaults")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                    }
                    .buttonStyle(.borderedProminent)

                    Button {
                        onCustomize()
                        dismiss()
                    } label: {
                        Text("Customize for This Book")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                    }
                    .buttonStyle(.bordered)
                }
                .padding(.horizontal)
                .padding(.bottom, 20)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        onUseDefaults()
                        dismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
