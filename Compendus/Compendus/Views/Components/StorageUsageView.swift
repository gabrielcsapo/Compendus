//
//  StorageUsageView.swift
//  Compendus
//
//  Storage usage indicator component
//

import SwiftUI

struct StorageUsageView: View {
    @Environment(StorageManager.self) private var storageManager

    var onTap: (() -> Void)?

    init(onTap: (() -> Void)? = nil) {
        self.onTap = onTap
    }

    var body: some View {
        Button {
            onTap?()
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Storage Used")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Spacer()
                    HStack(spacing: 4) {
                        Text(storageManager.totalStorageUsedDisplay())
                            .font(.subheadline)
                            .fontWeight(.medium)
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }

                GeometryReader { geometry in
                    let totalWidth = geometry.size.width
                    let usedBytes = storageManager.totalStorageUsed()
                    let availableBytes = storageManager.availableDiskSpace()
                    let totalBytes = usedBytes + availableBytes
                    let usedRatio = totalBytes > 0 ? CGFloat(usedBytes) / CGFloat(totalBytes) : 0

                    ZStack(alignment: .leading) {
                        // Background
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color(.systemGray5))
                            .frame(height: 8)

                        // Used portion
                        RoundedRectangle(cornerRadius: 4)
                            .fill(usageColor(ratio: usedRatio))
                            .frame(width: max(4, totalWidth * usedRatio), height: 8)
                    }
                }
                .frame(height: 8)

                HStack {
                    Text("\(storageManager.availableDiskSpaceDisplay()) available")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
            }
            .padding(Spacing.lg)
            .background(Color(.systemBackground))
            .clipShape(RoundedRectangle(cornerRadius: Radius.large, style: .continuous))
            .shadow(Shadow.subtle)
        }
        .buttonStyle(.plain)
    }

    private func usageColor(ratio: CGFloat) -> Color {
        if ratio > 0.9 {
            return .red
        } else if ratio > 0.7 {
            return .orange
        } else {
            return .accentColor
        }
    }
}

#Preview {
    StorageUsageView()
        .environment(StorageManager())
        .padding()
}
