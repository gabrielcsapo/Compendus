//
//  MiniPlayerView.swift
//  Compendus
//
//  Inline mini player shown inside the custom bottom bar, above the tab icons.
//

import SwiftUI

struct MiniPlayerView: View {
    @Environment(AudiobookPlayer.self) private var player

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                // Cover art
                if let coverData = player.currentBook?.coverData,
                   let uiImage = UIImage(data: coverData) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(width: 48, height: 48)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                } else {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.gray.opacity(0.3))
                        .frame(width: 48, height: 48)
                        .overlay {
                            Image(systemName: "headphones")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                }

                // Title and author
                VStack(alignment: .leading, spacing: 2) {
                    Text(player.currentBook?.title ?? "")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .lineLimit(1)
                    Text(player.currentBook?.authorsDisplay ?? "")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer()

                // Stop
                Button {
                    player.stop()
                } label: {
                    Image(systemName: "stop.fill")
                        .font(.callout)
                        .frame(width: 36, height: 36)
                }

                // Play/Pause
                Button {
                    if player.isPlaying {
                        player.pause()
                    } else {
                        player.play()
                    }
                } label: {
                    Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                        .font(.title3)
                        .frame(width: 36, height: 36)
                }

                // Skip forward
                Button {
                    player.skipForward()
                } label: {
                    Image(systemName: "forward.fill")
                        .font(.callout)
                        .frame(width: 36, height: 36)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            // Progress bar at bottom edge
            GeometryReader { geo in
                Rectangle()
                    .fill(Color.primary.opacity(0.3))
                    .frame(height: 3)
                    .overlay(alignment: .leading) {
                        Rectangle()
                            .fill(Color.primary)
                            .frame(
                                width: geo.size.width * (player.duration > 0 ? player.currentTime / player.duration : 0)
                            )
                    }
            }
            .frame(height: 3)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            player.isFullPlayerPresented = true
        }
        .frame(height: 67)
    }
}
