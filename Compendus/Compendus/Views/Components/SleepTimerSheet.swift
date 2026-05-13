//
//  SleepTimerSheet.swift
//  Compendus
//
//  Detent sheet for setting / extending / cancelling an audiobook sleep timer.
//  Replaces the confirmationDialog action sheet so we can show the remaining
//  countdown and let users extend an active timer without having to dismiss
//  and re-open.
//

import SwiftUI
import Combine

struct SleepTimerSheet: View {
    let fireDate: Date?
    let canEndOfChapter: Bool
    let onSetMinutes: (Int) -> Void
    let onSetEndOfChapter: () -> Void
    let onCancel: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var customMinutes: Int = 20
    @State private var now: Date = Date()

    private let presets: [Int] = [5, 15, 30, 45, 60]
    private let countdownTimer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var remaining: TimeInterval? {
        guard let fireDate else { return nil }
        return max(0, fireDate.timeIntervalSince(now))
    }

    var body: some View {
        VStack(spacing: 18) {
            // Drag indicator
            Capsule()
                .fill(Color(.systemFill))
                .frame(width: 36, height: 5)
                .padding(.top, 8)

            if let remaining {
                activeTimerView(remaining: remaining)
            } else {
                pickerView
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 24)
        .onReceive(countdownTimer) { _ in now = Date() }
    }

    // MARK: - Active

    @ViewBuilder
    private func activeTimerView(remaining: TimeInterval) -> some View {
        VStack(spacing: 4) {
            Text("Sleep timer")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Text(formatRemaining(remaining))
                .font(.system(size: 56, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .contentTransition(.numericText())
                .animation(.snappy, value: Int(remaining))
            Text("until pause")
                .font(.footnote)
                .foregroundStyle(.tertiary)
        }
        .padding(.top, 8)

        HStack(spacing: 12) {
            Button {
                onSetMinutes(Int(remaining / 60) + 5)
            } label: {
                Label("+5 min", systemImage: "plus.circle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)

            Button {
                onSetMinutes(Int(remaining / 60) + 15)
            } label: {
                Label("+15 min", systemImage: "plus.circle.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
        }

        Button(role: .destructive) {
            onCancel()
            dismiss()
        } label: {
            Label("Cancel timer", systemImage: "stop.circle")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
    }

    // MARK: - Picker

    @ViewBuilder
    private var pickerView: some View {
        Text("Sleep timer")
            .font(.headline)
            .frame(maxWidth: .infinity, alignment: .leading)

        // Preset chips
        FlowChips(
            items: presets.map { "\($0) min" },
            onTap: { idx in
                onSetMinutes(presets[idx])
                dismiss()
            }
        )

        if canEndOfChapter {
            Button {
                onSetEndOfChapter()
                dismiss()
            } label: {
                Label("End of current chapter", systemImage: "text.line.first.and.arrowtriangle.forward")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
        }

        // Custom duration
        VStack(alignment: .leading, spacing: 8) {
            Text("Custom")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            HStack(spacing: 12) {
                Stepper(value: $customMinutes, in: 1...180, step: 5) {
                    Text("\(customMinutes) min")
                        .font(.body.monospacedDigit())
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Button("Start") {
                    onSetMinutes(customMinutes)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.regular)
            }
        }
        .padding(.top, 4)
    }

    private func formatRemaining(_ seconds: TimeInterval) -> String {
        let total = Int(seconds.rounded())
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, s)
        }
        return String(format: "%d:%02d", m, s)
    }
}

/// Lightweight wrapping row of pill-shaped buttons.
private struct FlowChips: View {
    let items: [String]
    let onTap: (Int) -> Void

    var body: some View {
        HStack(spacing: 8) {
            ForEach(items.indices, id: \.self) { idx in
                Button {
                    onTap(idx)
                } label: {
                    Text(items[idx])
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .frame(maxWidth: .infinity)
                        .background(Color(.tertiarySystemFill))
                        .clipShape(Capsule())
                        .foregroundStyle(.primary)
                }
                .buttonStyle(.plain)
            }
        }
    }
}
