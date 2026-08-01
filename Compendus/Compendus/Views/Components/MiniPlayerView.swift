//
//  MiniPlayerView.swift
//  Compendus
//
//  Inline mini player shown inside the custom bottom bar, above the tab icons.
//

import SwiftUI

struct MiniPlayerView: View {
    @Environment(AudiobookPlayer.self) private var player
    @Environment(ThemeManager.self) private var themeManager

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button {
                    player.isFullPlayerPresented = true
                } label: {
                    HStack(spacing: 10) {
                        LocalCoverImage(
                            bookId: player.currentBook?.id ?? "",
                            coverData: player.currentBook?.coverData,
                            format: player.currentBook?.format ?? "m4b"
                        )
                        .frame(width: 44, height: 44)
                        .clipShape(RoundedRectangle(cornerRadius: 6))

                        VStack(alignment: .leading, spacing: 2) {
                            Text(player.currentBook?.title ?? "")
                                .font(.subheadline)
                                .fontWeight(.semibold)
                                .lineLimit(1)
                            if let chapter = player.currentChapter {
                                Text(chapter.title)
                                    .font(.caption2)
                                    .foregroundStyle(themeManager.accentColor)
                                    .lineLimit(1)
                            } else {
                                Text(player.currentBook?.authorsDisplay ?? "")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .buttonStyle(.plain)
                .accessibilityLabel("Open player for \(player.currentBook?.title ?? "audiobook")")

                // Play/Pause
                Button {
                    if player.isPlaying { player.pause() } else { player.play() }
                } label: {
                    Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                        .font(.title3)
                        .frame(width: 44, height: 44)
                        .contentTransition(.symbolEffect(.replace))
                }
                .accessibilityLabel(player.isPlaying ? "Pause" : "Play")

            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            // Progress bar at bottom edge
            GeometryReader { geo in
                Rectangle()
                    .fill(Color.primary.opacity(0.2))
                    .frame(height: 3)
                    .overlay(alignment: .leading) {
                        Rectangle()
                            .fill(themeManager.accentColor)
                            .frame(
                                width: geo.size.width * (player.duration > 0 ? player.currentTime / player.duration : 0)
                            )
                    }
            }
            .frame(height: 3)
        }
        .frame(height: 76)
    }
}
