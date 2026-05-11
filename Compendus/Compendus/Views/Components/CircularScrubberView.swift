//
//  CircularScrubberView.swift
//  Compendus
//
//  Circular arc scrubber for the audiobook full player.
//  - Drag anywhere on the ring to seek
//  - Dead zone at the top prevents wrap-around jumps
//  - Floating time tooltip appears during scrub
//  - Inner area shows cover art + book progress arc overlay
//

import SwiftUI

struct CircularScrubberView: View {
    /// Current playback position in seconds.
    let currentTime: Double
    /// Total duration in seconds.
    let duration: Double
    /// Called while the user drags to seek (live preview).
    let onSeek: (Double) -> Void
    /// Cover image to render inside the ring.
    let coverImage: UIImage?
    /// Format identifier for placeholder icon.
    let bookFormat: String
    /// Chapters for tick marks + snap + live tooltip resolution (P2.6).
    var chapters: [Chapter] = []

    @Environment(ThemeManager.self) private var themeManager
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    // Geometry
    private let ringLineWidth: CGFloat = 8
    /// Degrees of dead zone gap centred at the top (12 o'clock).
    private let deadZoneDegrees: Double = 20
    /// Snap window — drag thumb within this distance of a chapter boundary
    /// to snap onto it.
    private let snapWindowSeconds: Double = 30

    // Drag state
    @GestureState private var isDragging = false
    @State private var dragProgress: Double? = nil   // non-nil while dragging
    @State private var tooltipAngle: Double = 0       // radians, for tooltip position
    /// The chapter index we last snapped to during this drag — used to
    /// suppress repeat haptics while the thumb hovers over the same boundary.
    @State private var lastSnappedChapterIdx: Int? = nil

    private var displayProgress: Double {
        dragProgress ?? (duration > 0 ? currentTime / duration : 0)
    }

    /// Arc start/end angles, leaving the dead zone gap at the top.
    private var startAngle: Angle { .degrees(90 + deadZoneDegrees / 2) }
    private var endAngle: Angle   { .degrees(90 - deadZoneDegrees / 2 + 360) }
    private var arcSpanDegrees: Double { 360 - deadZoneDegrees }

    var body: some View {
        GeometryReader { geo in
            let size = min(geo.size.width, geo.size.height)
            let center = CGPoint(x: geo.size.width / 2, y: geo.size.height / 2)
            // Ring stroke is centred on the circle's perimeter; inset by half lineWidth
            let radius = (size / 2) - ringLineWidth / 2

            ZStack {
                // Cover art fills the inner circle — ring draws on top of its edges
                coverContent(diameter: size - ringLineWidth * 2)

                // Track ring (background)
                Circle()
                    .trim(
                        from: deadZoneFraction / 2,
                        to: 1 - deadZoneFraction / 2
                    )
                    .stroke(
                        Color.primary.opacity(0.15),
                        style: StrokeStyle(lineWidth: ringLineWidth, lineCap: .round)
                    )
                    .rotationEffect(.degrees(90))

                // Chapter tick marks (P2.6) — small notches on the track at
                // each chapter boundary. Brighten while dragging so users
                // can see what they're snapping to.
                if !chapters.isEmpty && duration > 0 {
                    ForEach(Array(chapters.enumerated()), id: \.offset) { _, chapter in
                        let progress = min(max(chapter.startTime / duration, 0), 1)
                        if progress > 0.001 { // skip the very-start (covered by dead zone)
                            chapterTick(
                                progress: progress,
                                center: center,
                                radius: radius,
                                emphasized: isDragging
                            )
                        }
                    }
                }

                // Progress arc
                Circle()
                    .trim(
                        from: deadZoneFraction / 2,
                        to: deadZoneFraction / 2 + displayProgress * (1 - deadZoneFraction)
                    )
                    .stroke(
                        themeManager.accentColor,
                        style: StrokeStyle(lineWidth: ringLineWidth, lineCap: .round)
                    )
                    .rotationEffect(.degrees(90))
                    .animation(
                        isDragging || reduceMotion ? .none : .linear(duration: 0.1),
                        value: displayProgress
                    )

                // Thumb dot
                thumbDot(center: center, radius: radius)

                // Tooltip shown during drag
                if isDragging, let progress = dragProgress {
                    tooltipView(progress: progress, center: center, radius: radius)
                }

                // Invisible wide drag ring (much larger hit area than the stroke)
                Circle()
                    .stroke(Color.clear, lineWidth: ringLineWidth + 36)
                    .contentShape(Circle().stroke(lineWidth: ringLineWidth + 36))
                    .gesture(
                        DragGesture(minimumDistance: 0, coordinateSpace: .local)
                            .updating($isDragging) { _, state, _ in state = true }
                            .onChanged { value in
                                let angle = angleFromCenter(
                                    point: value.location,
                                    center: center
                                )
                                if let rawProgress = progressFromAngle(angle) {
                                    let snapped = applySnap(to: rawProgress)
                                    dragProgress = snapped
                                    tooltipAngle = angle
                                    onSeek(snapped * duration)
                                }
                            }
                            .onEnded { value in
                                let angle = angleFromCenter(
                                    point: value.location,
                                    center: center
                                )
                                if let rawProgress = progressFromAngle(angle) {
                                    let snapped = applySnap(to: rawProgress)
                                    onSeek(snapped * duration)
                                }
                                dragProgress = nil
                                lastSnappedChapterIdx = nil
                            }
                    )
            }
            .clipShape(Circle())
        }
        .aspectRatio(1, contentMode: .fit)
    }

    // MARK: - Sub-views

    @ViewBuilder
    private func thumbDot(center: CGPoint, radius: CGFloat) -> some View {
        let angle = thumbAngle
        let x = center.x + cos(angle) * radius
        let y = center.y + sin(angle) * radius

        Circle()
            .fill(themeManager.accentColor)
            .frame(width: isDragging ? 18 : 12, height: isDragging ? 18 : 12)
            .shadow(color: themeManager.accentColor.opacity(0.6), radius: isDragging ? 6 : 3)
            .animation(.spring(response: 0.2), value: isDragging)
            .position(x: x, y: y)
    }

    @ViewBuilder
    private func coverContent(diameter: CGFloat) -> some View {
        // Cover fits fully inside the circle with no cropping.
        // The inscribed square of a circle has side ≈ diameter * 0.707;
        // we use 0.68 to add a small breathing gap from the ring edge.
        let coverSize = diameter * 0.68
        Group {
            if let image = coverImage {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: coverSize, height: coverSize)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            } else {
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color(.systemGray5))
                    .frame(width: coverSize, height: coverSize)
                    .overlay {
                        Image(systemName: CoverImageDecoder.placeholderIcon(for: bookFormat))
                            .font(.system(size: coverSize * 0.3))
                            .foregroundStyle(.secondary)
                    }
            }
        }
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private func tooltipView(progress: Double, center: CGPoint, radius: CGFloat) -> some View {
        let time = progress * duration
        let timeLabel = formatTime(time)
        let remaining = max(0, duration - time)
        let chapter = chapterAtTime(time)

        // Position tooltip toward center, offset from thumb
        let angle = tooltipAngle
        let tooltipRadius = radius * 0.5
        let x = center.x + cos(angle) * tooltipRadius
        let y = center.y + sin(angle) * tooltipRadius

        VStack(spacing: 2) {
            if let chapterTitle = chapter?.title, !chapterTitle.isEmpty {
                Text(chapterTitle)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
            }
            Text("\(timeLabel) elapsed · \(formatTime(remaining)) left")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .frame(maxWidth: radius * 1.4)
        .position(x: x, y: y)
        .transition(.opacity.combined(with: .scale(scale: 0.85)))
        .animation(.spring(response: 0.15), value: isDragging)
        .allowsHitTesting(false)
    }

    /// A small notch drawn perpendicular to the ring at the given progress.
    /// Used for chapter boundaries (P2.6).
    @ViewBuilder
    private func chapterTick(progress: Double, center: CGPoint, radius: CGFloat, emphasized: Bool) -> some View {
        let arcStart = startAngle.radians
        let arcSpan = arcSpanDegrees * (.pi / 180)
        let angle = arcStart + progress * arcSpan
        // Inner / outer endpoints of the tick (a small radial line)
        let inner = radius - ringLineWidth / 2 - 1
        let outer = radius + ringLineWidth / 2 + 1
        let p1 = CGPoint(x: center.x + cos(angle) * inner, y: center.y + sin(angle) * inner)
        let p2 = CGPoint(x: center.x + cos(angle) * outer, y: center.y + sin(angle) * outer)

        Path { path in
            path.move(to: p1)
            path.addLine(to: p2)
        }
        .stroke(
            Color.primary.opacity(emphasized ? 0.6 : 0.3),
            style: StrokeStyle(lineWidth: 1.5, lineCap: .round)
        )
        .animation(.easeInOut(duration: 0.15), value: emphasized)
    }

    /// Maps raw drag-progress to a snapped value when within
    /// `snapWindowSeconds` of a chapter boundary. Emits a haptic on entry
    /// to a snap window (debounced via `lastSnappedChapterIdx`).
    private func applySnap(to rawProgress: Double) -> Double {
        guard !chapters.isEmpty, duration > 0 else {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            return rawProgress
        }
        let rawTime = rawProgress * duration
        var bestIdx: Int? = nil
        var bestDelta: Double = .infinity
        for (idx, chapter) in chapters.enumerated() {
            let delta = abs(chapter.startTime - rawTime)
            if delta < snapWindowSeconds && delta < bestDelta {
                bestDelta = delta
                bestIdx = idx
            }
        }
        if let idx = bestIdx {
            if lastSnappedChapterIdx != idx {
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                Task { @MainActor in lastSnappedChapterIdx = idx }
            }
            return min(max(chapters[idx].startTime / duration, 0), 1)
        }
        // Not snapping — soft scrub haptic, reset snap memory
        if lastSnappedChapterIdx != nil {
            Task { @MainActor in lastSnappedChapterIdx = nil }
        }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        return rawProgress
    }

    /// Resolve the chapter containing a given playback time (or nearest
    /// preceding chapter). Returns nil if no chapters.
    private func chapterAtTime(_ time: Double) -> Chapter? {
        guard !chapters.isEmpty else { return nil }
        var result: Chapter? = nil
        for chapter in chapters {
            if chapter.startTime <= time { result = chapter } else { break }
        }
        return result ?? chapters.first
    }

    // MARK: - Geometry helpers

    private var deadZoneFraction: Double { deadZoneDegrees / 360 }

    /// Radians of the thumb on the unit circle (standard math coords).
    private var thumbAngle: Double {
        let arcStart = startAngle.radians   // bottom-left of arc in standard SwiftUI coords
        let arcSpan  = arcSpanDegrees * (.pi / 180)
        return arcStart + displayProgress * arcSpan
    }

    /// Convert a point in local coordinates to an angle in radians
    /// (standard math: 0 = right, increases clockwise in screen coords).
    private func angleFromCenter(point: CGPoint, center: CGPoint) -> Double {
        atan2(point.y - center.y, point.x - center.x)
    }

    /// Map a raw angle (radians) to a scrubber progress value [0, 1],
    /// returning nil if the touch falls inside the dead zone.
    private func progressFromAngle(_ angle: Double) -> Double? {
        // Convert angle to degrees, 0 = right, clockwise positive.
        var degrees = angle * (180 / .pi)
        // Shift so that 0° = top (12 o'clock): subtract 90 and wrap.
        degrees -= 90
        if degrees < 0 { degrees += 360 }

        // Arc starts at deadZone/2 past the top and spans arcSpanDegrees.
        let arcStart = deadZoneDegrees / 2
        let arcEnd   = arcStart + arcSpanDegrees

        // Dead zone check
        if degrees < arcStart || degrees > arcEnd { return nil }

        return (degrees - arcStart) / arcSpanDegrees
    }

    private func formatTime(_ seconds: Double) -> String {
        let hours   = Int(seconds) / 3600
        let minutes = (Int(seconds) % 3600) / 60
        let secs    = Int(seconds) % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, secs)
        }
        return String(format: "%d:%02d", minutes, secs)
    }
}

#Preview {
    struct PreviewWrapper: View {
        @State private var time: Double = 1800

        var body: some View {
            VStack(spacing: 24) {
                CircularScrubberView(
                    currentTime: time,
                    duration: 7200,
                    onSeek: { time = $0 },
                    coverImage: nil,
                    bookFormat: "m4b"
                )
                .frame(width: 280, height: 280)
                .environment(ThemeManager())

                Text(formatTime(time))
                    .font(.title2.monospacedDigit())
            }
            .padding()
        }

        private func formatTime(_ s: Double) -> String {
            let h = Int(s) / 3600
            let m = (Int(s) % 3600) / 60
            let sec = Int(s) % 60
            return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
        }
    }

    return PreviewWrapper()
}
