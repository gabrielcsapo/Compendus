//
//  AudioLyricsView.swift
//  Compendus
//
//  Karaoke-style lyrics display synchronized with audiobook playback.
//  Shows word-level highlighting on the active line and auto-scrolls.
//

import SwiftUI

struct AudioLyricsView: View {
    let transcript: Transcript
    let currentTime: Double
    let onSeek: (Double) -> Void

    @Environment(ThemeManager.self) private var themeManager
    @State private var activeSegmentIndex: Int = -1

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(Array(transcript.segments.enumerated()), id: \.offset) { index, segment in
                        LyricsLineView(
                            segment: segment,
                            isActive: index == activeSegmentIndex,
                            isPast: activeSegmentIndex > -1 && index < activeSegmentIndex,
                            currentTime: currentTime,
                            accentColor: themeManager.accentColor
                        )
                        .id(index)
                        .onTapGesture {
                            onSeek(segment.start)
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
            }
            .onChange(of: activeSegmentIndex) { _, newIndex in
                guard newIndex >= 0 else { return }
                withAnimation(.easeInOut(duration: 0.3)) {
                    proxy.scrollTo(newIndex, anchor: .center)
                }
            }
        }
        .onChange(of: currentTime) { _, newTime in
            updateActiveSegment(for: newTime)
        }
        .onChange(of: transcript.segments.count) { _, _ in
            // Resync when new segments are added (partial transcript growing)
            updateActiveSegment(for: currentTime)
        }
        .onAppear {
            updateActiveSegment(for: currentTime)
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
    let currentTime: Double
    let accentColor: Color

    var body: some View {
        Group {
            if isActive {
                activeLineContent
            } else {
                Text(segment.text)
                    .font(.body)
                    .foregroundColor(isPast ? Color.primary.opacity(0.5) : Color.secondary.opacity(0.35))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
        .padding(.horizontal, 8)
        .background(
            isActive
                ? RoundedRectangle(cornerRadius: 8)
                    .fill(accentColor.opacity(0.1))
                : nil
        )
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var activeLineContent: some View {
        // Word-level karaoke highlighting
        let words = segment.words
        if words.isEmpty {
            Text(segment.text)
                .font(.body)
                .fontWeight(.semibold)
                .foregroundStyle(.primary)
        } else {
            // Use a wrapping text approach
            words.reduce(Text("")) { result, word in
                let isWordActive = currentTime >= word.start && currentTime < word.end
                let isWordPast = currentTime >= word.end

                let color: Color = isWordActive
                    ? accentColor
                    : isWordPast
                        ? .primary
                        : .secondary

                let weight: Font.Weight = isWordActive ? .bold : .semibold

                return result + Text(word.word + " ")
                    .foregroundColor(color)
                    .fontWeight(weight)
            }
            .font(.body)
        }
    }
}
