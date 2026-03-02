//
//  CardView.swift
//  Compendus
//
//  Reusable card container with consistent styling.
//  Replaces ad-hoc .background + .clipShape + .shadow combinations.
//

import SwiftUI

struct CardView<Content: View>: View {
    var padding: CGFloat = Spacing.lg
    var cornerRadius: CGFloat = Radius.large
    var shadowStyle: ShadowStyle = Shadow.subtle
    @ViewBuilder let content: () -> Content

    var body: some View {
        content()
            .padding(padding)
            .background(Color(.systemBackground))
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .shadow(shadowStyle)
    }
}

#Preview {
    VStack(spacing: 16) {
        CardView {
            VStack(alignment: .leading, spacing: 8) {
                Text("Card Title")
                    .font(.headline)
                Text("Some card content goes here")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }

        CardView(shadowStyle: Shadow.medium) {
            Text("Elevated Card")
                .font(.headline)
        }
    }
    .padding()
    .background(Color(.systemGroupedBackground))
}
