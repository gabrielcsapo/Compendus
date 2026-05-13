//
//  AudioFABView.swift
//  Compendus
//
//  Compact circular audio player surfaced inside readers when an audiobook
//  session is active. Replaces the full-width MiniPlayerView strip that
//  otherwise overlays the reader's status bar and top chrome.
//
//  Tap            — toggle play/pause
//  Long-press     — open the full audiobook player
//  Swipe up       — open the full audiobook player
//

import SwiftUI

struct AudioFABView: View {
    @Environment(AudiobookPlayer.self) private var player
    @Environment(ThemeManager.self) private var themeManager

    private let diameter: CGFloat = 64
    private let ringWidth: CGFloat = 3

    private var progress: Double {
        guard player.duration > 0 else { return 0 }
        return player.currentTime / player.duration
    }

    var body: some View {
        ZStack {
            // Backing disc — subtle material so the glyph stays readable on
            // any cover art.
            Circle()
                .fill(.ultraThinMaterial)
                .overlay(
                    Circle().stroke(.white.opacity(0.25), lineWidth: 0.5)
                )

            // Cover art clipped to a slightly smaller circle so the progress
            // ring sits between the cover and the perimeter.
            LocalCoverImage(
                bookId: player.currentBook?.id ?? "",
                coverData: player.currentBook?.coverData,
                format: player.currentBook?.format ?? "m4b"
            )
            .frame(width: diameter - ringWidth * 4, height: diameter - ringWidth * 4)
            .clipShape(Circle())

            // Translucent disc for glyph contrast
            Circle()
                .fill(.black.opacity(0.35))
                .frame(width: diameter - ringWidth * 4, height: diameter - ringWidth * 4)

            // Play / pause glyph
            Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.white)
                .contentTransition(.symbolEffect(.replace))

            // Progress ring around the perimeter
            Circle()
                .trim(from: 0, to: max(0.001, progress))
                .stroke(themeManager.accentColor, style: StrokeStyle(lineWidth: ringWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.linear(duration: 0.5), value: progress)
        }
        .frame(width: diameter, height: diameter)
        .shadow(color: .black.opacity(0.25), radius: 6, y: 2)
        .contentShape(Circle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(player.isPlaying ? "Pause audiobook" : "Resume audiobook")
        .accessibilityHint("Long-press to open the full player.")
        .onTapGesture {
            if player.isPlaying { player.pause() } else { player.play() }
        }
        .onLongPressGesture(minimumDuration: 0.35) {
            player.isFullPlayerPresented = true
        }
        .gesture(
            DragGesture(minimumDistance: 20)
                .onEnded { value in
                    if value.translation.height < -20 && value.predictedEndTranslation.height < -40 {
                        player.isFullPlayerPresented = true
                    }
                }
        )
    }
}
