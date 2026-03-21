//
//  FilterChipBar.swift
//  Compendus
//
//  Shared scrollable pill chip row component
//

import SwiftUI

struct FilterChip: Identifiable {
    let id: String
    let label: String
    let systemImage: String?
}

struct FilterChipBar: View {
    let chips: [FilterChip]
    @Binding var selectedId: String
    var trailingContent: AnyView? = nil

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(chips) { chip in
                    chipButton(chip)
                }
                if let trailing = trailingContent {
                    trailing
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 4)
        }
    }

    private func chipButton(_ chip: FilterChip) -> some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) {
                selectedId = chip.id
            }
        } label: {
            HStack(spacing: 4) {
                if let icon = chip.systemImage {
                    Image(systemName: icon)
                        .font(.caption)
                }
                Text(chip.label)
                    .font(.subheadline)
                    .fontWeight(.medium)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(
                Capsule()
                    .fill(selectedId == chip.id ? Color.accentColor : Color(.secondarySystemFill))
            )
            .foregroundStyle(selectedId == chip.id ? Color.white : Color.primary)
        }
        .buttonStyle(.plain)
    }
}
