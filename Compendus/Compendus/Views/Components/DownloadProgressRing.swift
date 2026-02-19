//
//  DownloadProgressRing.swift
//  Compendus
//
//  Circular progress indicator for download overlay on covers
//

import SwiftUI

/// A circular progress ring for download progress
struct DownloadProgressRing: View {
    let progress: Double
    var lineWidth: CGFloat = 4
    var size: CGFloat = 50

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            // Background circle
            Circle()
                .stroke(Color.gray.opacity(0.3), lineWidth: lineWidth)

            // Progress arc
            Circle()
                .trim(from: 0, to: progress)
                .stroke(
                    Color.accentColor,
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .animation(reduceMotion ? .none : .linear(duration: 0.2), value: progress)

            // Percentage text
            Text("\(Int(progress * 100))%")
                .font(.system(size: size * 0.25, weight: .semibold, design: .rounded))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
        .accessibilityLabel("Download progress: \(Int(progress * 100)) percent")
    }
}

/// An animated download button with SF Symbols transitions
struct AnimatedDownloadButton: View {
    enum State {
        case idle
        case downloading(progress: Double)
        case completed
        case failed
    }

    let state: State
    var onTap: (() -> Void)?
    var onCancel: (() -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button {
            switch state {
            case .idle:
                onTap?()
            case .downloading:
                onCancel?()
            case .completed:
                onTap?()
            case .failed:
                onTap?()
            }
        } label: {
            HStack {
                iconView
                    .contentTransition(.symbolEffect(.replace))

                textView
            }
            .frame(maxWidth: .infinity)
            .padding()
            .background(backgroundColor)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .disabled(state.isDownloading)
    }

    @ViewBuilder
    private var iconView: some View {
        switch state {
        case .idle:
            Image(systemName: "arrow.down.circle")
                .symbolEffect(.bounce, value: state.isIdle)
        case .downloading(let progress):
            ZStack {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                    .scaleEffect(0.8)
            }
        case .completed:
            Image(systemName: "checkmark.circle.fill")
                .symbolEffect(.bounce, value: state.isCompleted)
        case .failed:
            Image(systemName: "exclamationmark.circle")
        }
    }

    @ViewBuilder
    private var textView: some View {
        switch state {
        case .idle:
            Text("Download")
        case .downloading(let progress):
            Text("\(Int(progress * 100))%")
                .monospacedDigit()
        case .completed:
            Text("Read")
        case .failed:
            Text("Retry")
        }
    }

    private var backgroundColor: Color {
        switch state {
        case .idle:
            return .blue
        case .downloading:
            return .gray
        case .completed:
            return .accentColor
        case .failed:
            return .red
        }
    }
}

extension AnimatedDownloadButton.State {
    var isIdle: Bool {
        if case .idle = self { return true }
        return false
    }

    var isDownloading: Bool {
        if case .downloading = self { return true }
        return false
    }

    var isCompleted: Bool {
        if case .completed = self { return true }
        return false
    }
}

/// A compact progress ring for overlaying on book covers
struct CoverProgressOverlay: View {
    let progress: Double
    var showPercentage: Bool = false

    var body: some View {
        ZStack {
            // Semi-transparent background
            Color.black.opacity(0.5)
                .clipShape(RoundedRectangle(cornerRadius: 8))

            // Progress ring
            DownloadProgressRing(
                progress: progress,
                lineWidth: 3,
                size: 40
            )
        }
    }
}

#Preview("Download Button States") {
    VStack(spacing: 16) {
        AnimatedDownloadButton(state: .idle)
        AnimatedDownloadButton(state: .downloading(progress: 0.45))
        AnimatedDownloadButton(state: .completed)
        AnimatedDownloadButton(state: .failed)
    }
    .padding()
}

#Preview("Progress Ring") {
    VStack(spacing: 20) {
        DownloadProgressRing(progress: 0.0)
        DownloadProgressRing(progress: 0.25)
        DownloadProgressRing(progress: 0.5)
        DownloadProgressRing(progress: 0.75)
        DownloadProgressRing(progress: 1.0)
    }
    .padding()
    .background(Color.black)
}
