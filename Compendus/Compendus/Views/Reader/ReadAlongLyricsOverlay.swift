//
//  ReadAlongLyricsOverlay.swift
//  Compendus
//
//  Karaoke-style lyrics overlay shown on top of the EPUB reader
//  during read-along (audiobook or TTS mode).
//  Wraps AudioLyricsView with reader-themed background and chapter header.
//

import SwiftUI
import EPUBReader

struct ReadAlongLyricsOverlay: View {
    let transcript: Transcript?
    let currentTime: Double
    let bookTitle: String
    let chapterTitle: String?
    let isLoading: Bool
    let scrollDriven: Bool
    let onSeek: (Double) -> Void
    var onTapBackground: (() -> Void)?

    @Environment(ReaderSettings.self) private var readerSettings

    var body: some View {
        VStack(spacing: 0) {
            // Tap zone at top to toggle the overlay bars
            Color.clear
                .frame(height: 60)
                .contentShape(Rectangle())
                .onTapGesture { onTapBackground?() }

            // Chapter header
            VStack(spacing: 4) {
                Text(bookTitle)
                    .font(.headline)
                    .lineLimit(1)
                if let chapter = chapterTitle {
                    Text(chapter)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.bottom, 8)

            if let transcript = transcript, !transcript.segments.isEmpty {
                AudioLyricsView(
                    transcript: transcript,
                    currentTime: currentTime,
                    onSeek: onSeek,
                    scrollDriven: scrollDriven
                )
            } else if isLoading {
                Spacer()
                VStack(spacing: 12) {
                    ProgressView()
                    Text("Preparing...")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            } else {
                Spacer()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: readerSettings.theme.backgroundColor))
    }
}
