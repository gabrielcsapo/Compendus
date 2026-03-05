//
//  AudioLyricsView.swift
//  Compendus
//
//  Karaoke-style lyrics display synchronized with audiobook playback
//  or scroll-driven in reader mode. Uses a typewriter layout: the active
//  line stays centered, with past lines above and future lines below.
//

import SwiftUI

struct AudioLyricsView: View {
    let transcript: Transcript
    let currentTime: Double
    let onSeek: (Double) -> Void
    /// When true, the active segment follows scroll position instead of currentTime.
    var scrollDriven: Bool = false
    /// Initial segment to scroll to on appear (for reader mode).
    var initialSegment: Int = 0
    /// Called when the active segment changes (for tracking position).
    var onActiveSegmentChanged: ((Int) -> Void)?

    @Environment(ThemeManager.self) private var themeManager
    @State private var activeSegmentIndex: Int = -1

    var body: some View {
        GeometryReader { geometry in
            let centerY = geometry.size.height / 2

            ScrollViewReader { proxy in
                ScrollView(showsIndicators: false) {
                    LazyVStack(spacing: 12) {
                        // Top spacer to allow centering the first segment
                        Spacer()
                            .frame(height: centerY - 40)
                            .id("top-spacer")

                        ForEach(Array(transcript.segments.enumerated()), id: \.offset) { index, segment in
                            LyricsLineView(
                                segment: segment,
                                isActive: index == activeSegmentIndex,
                                isPast: activeSegmentIndex > -1 && index < activeSegmentIndex,
                                distance: activeSegmentIndex >= 0 ? abs(index - activeSegmentIndex) : 0,
                                currentTime: currentTime,
                                accentColor: themeManager.accentColor
                            )
                            .id(index)
                            .onTapGesture {
                                if scrollDriven {
                                    // In reader mode, tap to select this segment
                                    activeSegmentIndex = index
                                } else {
                                    onSeek(segment.start)
                                }
                            }
                        }

                        // Bottom spacer to allow centering the last segment
                        Spacer()
                            .frame(height: centerY - 40)
                            .id("bottom-spacer")
                    }
                    .padding(.horizontal, 24)
                }
                .onChange(of: activeSegmentIndex) { _, newIndex in
                    guard newIndex >= 0 else { return }
                    onActiveSegmentChanged?(newIndex)
                    guard !scrollDriven else { return }
                    withAnimation(.easeInOut(duration: 0.3)) {
                        proxy.scrollTo(newIndex, anchor: .center)
                    }
                }
                .onAppear {
                    if scrollDriven && initialSegment > 0 {
                        // Scroll to starting position without animation
                        proxy.scrollTo(initialSegment, anchor: .center)
                    }
                }
            }
        }
        .onChange(of: currentTime) { _, newTime in
            guard !scrollDriven else { return }
            updateActiveSegment(for: newTime)
        }
        .onChange(of: transcript.segments.count) { _, _ in
            guard !scrollDriven else { return }
            updateActiveSegment(for: currentTime)
        }
        .onAppear {
            if scrollDriven {
                activeSegmentIndex = initialSegment
            } else {
                updateActiveSegment(for: currentTime)
            }
        }
    }

    private func updateActiveSegment(for time: Double) {
        let segments = transcript.segments
        guard !segments.isEmpty else {
            activeSegmentIndex = -1
            return
        }

        // Binary search for the segment containing the current time
        var lo = 0
        var hi = segments.count - 1
        while lo <= hi {
            let mid = (lo + hi) / 2
            if time < segments[mid].start {
                hi = mid - 1
            } else if time > segments[mid].end {
                lo = mid + 1
            } else {
                activeSegmentIndex = mid
                return
            }
        }

        // If between segments or past all segments, keep showing the
        // previous one so the lyrics don't go blank during recognition gaps.
        if lo > 0 {
            activeSegmentIndex = lo - 1
        } else {
            activeSegmentIndex = -1
        }
    }
}

// MARK: - Lyrics Line View

private struct LyricsLineView: View {
    let segment: TranscriptSegment
    let isActive: Bool
    let isPast: Bool
    let distance: Int
    let currentTime: Double
    let accentColor: Color

    var body: some View {
        Group {
            if isActive {
                activeLineContent
            } else {
                Text(segment.text)
                    .font(.title3)
                    .foregroundColor(isPast ? Color.primary.opacity(opacityForDistance) : Color.secondary.opacity(opacityForDistance))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 6)
        .padding(.horizontal, 12)
        .background(
            isActive
                ? RoundedRectangle(cornerRadius: 10)
                    .fill(accentColor.opacity(0.12))
                : nil
        )
        .contentShape(Rectangle())
        .scaleEffect(isActive ? 1.0 : scaleForDistance, anchor: .leading)
        .animation(.easeInOut(duration: 0.2), value: isActive)
    }

    /// Lines fade out the further they are from the active line.
    private var opacityForDistance: Double {
        switch distance {
        case 0: return 1.0
        case 1: return 0.6
        case 2: return 0.4
        case 3: return 0.25
        default: return 0.15
        }
    }

    /// Lines scale down slightly the further they are from active.
    private var scaleForDistance: CGFloat {
        switch distance {
        case 0: return 1.0
        case 1: return 0.97
        case 2: return 0.95
        default: return 0.93
        }
    }

    @ViewBuilder
    private var activeLineContent: some View {
        // Word-level karaoke highlighting
        let words = segment.words
        if words.isEmpty {
            Text(segment.text)
                .font(.title3)
                .fontWeight(.semibold)
                .foregroundStyle(.primary)
        } else {
            Text(buildKaraokeText(words: words))
                .font(.title3)
        }
    }

    private func buildKaraokeText(words: [TranscriptWord]) -> AttributedString {
        var result = AttributedString()
        for word in words {
            var part = AttributedString(word.word + " ")
            let isWordActive = currentTime >= word.start && currentTime < word.end
            let isWordPast = currentTime >= word.end
            part.foregroundColor = isWordActive ? accentColor : isWordPast ? .primary : .secondary
            part.font = .title3.weight(isWordActive ? .bold : .semibold)
            result.append(part)
        }
        return result
    }
}
