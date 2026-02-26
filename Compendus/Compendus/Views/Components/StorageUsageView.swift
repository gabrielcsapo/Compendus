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
                            .fill(Color.gray.opacity(0.2))
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
            .padding()
            .background(Color(.systemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .shadow(color: .black.opacity(0.05), radius: 2, y: 1)
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
