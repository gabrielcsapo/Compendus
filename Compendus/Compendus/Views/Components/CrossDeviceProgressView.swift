//
//  CrossDeviceProgressView.swift
//  Compendus
//
//  Shows where each OTHER device left off in a book, so the user can see
//  per-device reading positions (one device on page 50, another on page 80).
//  Backed by DeviceReadingPosition rows kept current by SyncService. Renders
//  nothing when no other device has a position for this book.
//

import SwiftUI
import SwiftData

struct CrossDeviceProgressView: View {
    let bookId: String
    /// Optional tap handler: receives the tapped device's position so the host
    /// can open the reader there. When nil, rows are informational only.
    var onJump: ((DeviceReadingPosition) -> Void)?

    @Query private var positions: [DeviceReadingPosition]

    init(bookId: String, onJump: ((DeviceReadingPosition) -> Void)? = nil) {
        self.bookId = bookId
        self.onJump = onJump
        let ownId = DeviceIdentity.deviceId
        _positions = Query(
            filter: #Predicate<DeviceReadingPosition> { $0.bookId == bookId && $0.deviceId != ownId },
            sort: \.readingProgress,
            order: .reverse
        )
    }

    var body: some View {
        if !positions.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Other Devices")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                ForEach(positions) { pos in
                    row(pos)
                }
            }
        }
    }

    @ViewBuilder
    private func row(_ pos: DeviceReadingPosition) -> some View {
        let canJump = onJump != nil && pos.lastPosition != nil
        let content = HStack(spacing: 10) {
            Image(systemName: DeviceIdentity.icon(for: pos.deviceType))
                .font(.body)
                .foregroundStyle(.secondary)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(pos.deviceName.isEmpty ? pos.deviceType : pos.deviceName)
                    .font(.subheadline)
                    .lineLimit(1)
                if let when = relativeString(pos.lastReadAt) {
                    Text("Last read \(when)")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            Spacer()
            Text("\(Int((pos.readingProgress * 100).rounded()))%")
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
            if canJump {
                Image(systemName: "arrow.up.forward.app")
                    .font(.caption)
                    .foregroundStyle(.tint)
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))

        if canJump, let onJump {
            Button { onJump(pos) } label: { content }
                .buttonStyle(.plain)
        } else {
            content
        }
    }

    private func relativeString(_ date: Date?) -> String? {
        guard let date else { return nil }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}
