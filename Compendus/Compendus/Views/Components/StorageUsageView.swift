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

    @State private var usedDisplay: String = ""
    @State private var availableDisplay: String = ""
    @State private var usedRatio: CGFloat = 0

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
                        Text(usedDisplay)
                            .font(.subheadline)
                            .fontWeight(.medium)
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }

                GeometryReader { geometry in
                    let totalWidth = geometry.size.width

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
                    Text("\(availableDisplay) available")
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
        .task {
            refreshStorageInfo()
        }
    }

    private func refreshStorageInfo() {
        let sm = storageManager
        Task.detached(priority: .userInitiated) {
            let used = sm.totalStorageUsed()
            let available = sm.availableDiskSpace()
            let total = used + available
            let ratio = total > 0 ? CGFloat(used) / CGFloat(total) : 0
            let formatter = ByteCountFormatter()
            formatter.countStyle = .file
            let usedStr = formatter.string(fromByteCount: used)
            let availStr = formatter.string(fromByteCount: available)
            await MainActor.run {
                usedDisplay = usedStr
                availableDisplay = availStr
                usedRatio = ratio
            }
        }
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
