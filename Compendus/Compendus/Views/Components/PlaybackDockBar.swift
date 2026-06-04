//
//  PlaybackDockBar.swift
//  Compendus
//
//  One docked, music-player-style bottom bar that drives any PlaybackController
//  (audiobook player or read-along/TTS). Collapsed: a compact now-playing row
//  with a progress strip. Tap to expand into the full transport (scrubber, skip,
//  speed). Full-width, flush to the bottom edge — not a floating pill.
//

import SwiftUI

struct PlaybackDockBar<C: PlaybackController>: View {
    let controller: C
    var bottomInset: CGFloat = 0
    var accent: Color = .accentColor
    /// Optional secondary options (e.g. read-along voice / download).
    var onOptions: (() -> Void)? = nil

    @State private var expanded = false
    @State private var isScrubbing = false
    @State private var scrubValue: Double = 0

    private static var speeds: [Float] { [0.5, 0.75, 1.0, 1.25, 1.5, 2.0] }

    private var isPlaying: Bool { controller.playbackIsPlaying }
    private var isLoading: Bool { controller.playbackIsBuffering }
    private var duration: Double { controller.playbackDuration }
    private var displayTime: Double { isScrubbing ? scrubValue : controller.playbackCurrentTime }

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(.separator.opacity(0.5)).frame(height: 0.5)

            VStack(spacing: 0) {
                compactRow
                if expanded && !isLoading {
                    expandedControls.padding(.top, 14)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)

            if !expanded {
                progressStrip.padding(.top, 8)
            }
        }
        .padding(.bottom, max(bottomInset, 12))
        .frame(maxWidth: .infinity)
        .background(.ultraThinMaterial)
        .animation(.spring(response: 0.3, dampingFraction: 0.85), value: expanded)
        .animation(.spring(response: 0.3, dampingFraction: 0.85), value: isPlaying)
        .onChange(of: isLoading) { _, loading in if loading { expanded = false } }
    }

    // MARK: Compact row

    private var compactRow: some View {
        HStack(spacing: 12) {
            // Tappable info area — toggles expand
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(accent.opacity(0.15)).frame(width: 34, height: 34)
                    if isLoading {
                        ProgressView().scaleEffect(0.7)
                    } else {
                        Image(systemName: "waveform")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(accent)
                    }
                }

                VStack(alignment: .leading, spacing: 1) {
                    Text(controller.playbackTitle)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    if !isLoading {
                        Text(timeLabel)
                            .font(.caption2)
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    } else {
                        Text("Preparing\u{2026}")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer(minLength: 4)

                if !isLoading {
                    Image(systemName: "chevron.up")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                }
            }
            .contentShape(Rectangle())
            .onTapGesture {
                guard !isLoading else { return }
                withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { expanded.toggle() }
            }

            // Play / pause
            Button {
                if !isLoading { controller.playbackTogglePlayPause() }
            } label: {
                Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.primary)
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 36, height: 36)
            }
            .accessibilityLabel(isPlaying ? "Pause" : "Play")

            // Close
            Button { controller.playbackStop() } label: {
                Image(systemName: "xmark")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 28, height: 36)
            }
            .accessibilityLabel("Stop")
        }
    }

    private var timeLabel: String {
        var s = "\(formatTime(displayTime)) / \(formatTime(duration))"
        let rate = controller.playbackRate
        if rate != 1.0 { s += "  ·  \(speedLabel(rate))" }
        return s
    }

    // MARK: Progress strip (collapsed)

    private var progressStrip: some View {
        GeometryReader { geo in
            Rectangle()
                .fill(Color.primary.opacity(0.12))
                .frame(height: 3)
                .overlay(alignment: .leading) {
                    Rectangle()
                        .fill(accent)
                        .frame(width: geo.size.width * controller.playbackProgress)
                        .animation(.linear(duration: 0.3), value: controller.playbackProgress)
                }
        }
        .frame(height: 3)
    }

    // MARK: Expanded transport

    private var expandedControls: some View {
        VStack(spacing: 12) {
            // Scrubber — seek on release so TTS doesn't regenerate mid-drag.
            VStack(spacing: 2) {
                Slider(
                    value: Binding(
                        get: { isScrubbing ? scrubValue : controller.playbackCurrentTime },
                        set: { scrubValue = $0 }
                    ),
                    in: 0...max(duration, 0.1),
                    onEditingChanged: { editing in
                        if editing {
                            isScrubbing = true
                            scrubValue = controller.playbackCurrentTime
                        } else {
                            isScrubbing = false
                            controller.playbackSeek(to: scrubValue)
                        }
                    }
                )
                .tint(accent)
                HStack {
                    Text(formatTime(displayTime)).monospacedDigit()
                    Spacer()
                    Text("-\(formatTime(max(0, duration - displayTime)))").monospacedDigit()
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            }

            HStack(spacing: 36) {
                Button { controller.playbackSkipBackward() } label: {
                    Image(systemName: "gobackward.15").font(.title2)
                }
                Button { controller.playbackTogglePlayPause() } label: {
                    Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                        .font(.system(size: 46))
                        .contentTransition(.symbolEffect(.replace))
                }
                Button { controller.playbackSkipForward() } label: {
                    Image(systemName: "goforward.30").font(.title2)
                }
            }
            .foregroundStyle(.primary)

            HStack {
                Menu {
                    ForEach(Self.speeds, id: \.self) { speed in
                        Button { controller.playbackSetRate(speed) } label: {
                            if controller.playbackRate == speed {
                                Label(speedLabel(speed), systemImage: "checkmark")
                            } else {
                                Text(speedLabel(speed))
                            }
                        }
                    }
                } label: {
                    Label(speedLabel(controller.playbackRate), systemImage: "speedometer")
                        .font(.caption.weight(.medium))
                }
                Spacer()
                if let onOptions {
                    Button { onOptions() } label: {
                        Label("Options", systemImage: "slider.horizontal.3")
                            .font(.caption.weight(.medium))
                    }
                }
            }
            .foregroundStyle(.secondary)
        }
        .transition(.opacity.combined(with: .move(edge: .bottom)))
    }

    // MARK: Helpers

    private func speedLabel(_ rate: Float) -> String {
        if rate == 1.0 { return "1x" }
        if rate == floor(rate) { return "\(Int(rate))x" }
        return "\(String(format: "%.2g", rate))x"
    }

    private func formatTime(_ seconds: Double) -> String {
        guard seconds.isFinite && seconds >= 0 else { return "0:00" }
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return "\(mins):\(String(format: "%02d", secs))"
    }
}
