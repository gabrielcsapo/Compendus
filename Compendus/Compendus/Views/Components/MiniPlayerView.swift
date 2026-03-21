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

    @State private var showStopConfirmation = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                // X — stops the session
                Button {
                    showStopConfirmation = true
                } label: {
                    Image(systemName: "xmark")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 28, height: 44)
                }
                .accessibilityLabel("Stop playback")
                .confirmationDialog("Stop playback?", isPresented: $showStopConfirmation, titleVisibility: .visible) {
                    Button("Stop", role: .destructive) { player.stop() }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("This will end your listening session.")
                }

                // Cover art — tap opens full player
                LocalCoverImage(
                    bookId: player.currentBook?.id ?? "",
                    coverData: player.currentBook?.coverData,
                    format: player.currentBook?.format ?? "m4b"
                )
                .frame(width: 44, height: 44)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .onTapGesture { player.isFullPlayerPresented = true }

                // Title, chapter, and author — tap opens full player
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
                .onTapGesture { player.isFullPlayerPresented = true }

                // Speed picker
                Menu {
                    ForEach([0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0], id: \.self) { speed in
                        Button {
                            player.setPlaybackRate(Float(speed))
                        } label: {
                            HStack {
                                Text("\(speed, specifier: "%.2g")x")
                                if player.playbackRate == Float(speed) {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                } label: {
                    Text("\(player.playbackRate, specifier: "%.2g")x")
                        .font(.caption.weight(.semibold))
                        .frame(width: 36, height: 44)
                }
                .accessibilityLabel("Playback speed")

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
        .gesture(
            DragGesture(minimumDistance: 40)
                .onEnded { value in
                    if value.translation.height < -30 && value.predictedEndTranslation.height < -60 {
                        player.isFullPlayerPresented = true
                    }
                }
        )
    }
}
