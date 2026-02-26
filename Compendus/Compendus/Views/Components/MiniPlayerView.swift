//
//  MiniPlayerView.swift
//  Compendus
//
//  Compact audiobook player bar shown above the tab bar
//

import SwiftUI

struct MiniPlayerView: View {
    @Environment(AudiobookPlayer.self) private var player

    var body: some View {
        if player.hasActiveSession && !player.isFullPlayerPresented {
            HStack(spacing: 12) {
                // Cover art thumbnail
                if let coverData = player.currentBook?.coverData,
                   let uiImage = UIImage(data: coverData) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(width: 44, height: 44)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                } else {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color.gray.opacity(0.3))
                        .frame(width: 44, height: 44)
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
                        .frame(width: 32, height: 32)
                }

                // Skip forward
                Button {
                    player.skipForward()
                } label: {
                    Image(systemName: "forward.fill")
                        .font(.callout)
                        .frame(width: 32, height: 32)
                }
            }
            .padding(.horizontal, 14)
            .frame(height: 56)
            .background {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(.ultraThickMaterial)
                    .shadow(color: .black.opacity(0.2), radius: 12, x: 0, y: 4)
                    .shadow(color: .black.opacity(0.08), radius: 2, x: 0, y: 1)
            }
            .overlay(alignment: .bottom) {
                // Progress bar along bottom edge
                GeometryReader { geo in
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(Color.accentColor)
                        .frame(
                            width: geo.size.width * (player.duration > 0 ? player.currentTime / player.duration : 0),
                            height: 3
                        )
                }
                .frame(height: 3)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                .padding(.horizontal, 1)
            }
            .padding(.horizontal, 8)
            .padding(.bottom, 6)
            .contentShape(Rectangle())
            .onTapGesture {
                player.isFullPlayerPresented = true
            }
        }
    }
}
