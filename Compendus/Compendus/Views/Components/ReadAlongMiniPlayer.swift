//
//  ReadAlongMiniPlayer.swift
//  Compendus
//
//  Small floating circle for controlling read-along playback.
//  Shown initially when read-along activates; transitions to
//  toolbar controls after the first page navigation.
//

import SwiftUI

struct ReadAlongMiniPlayer: View {
    @Environment(AudiobookPlayer.self) private var player
    @Environment(ReadAlongService.self) private var readAlong
    @Environment(OnDeviceTranscriptionService.self) private var transcriptionService

    // MARK: - Computed Properties

    private var currentTime: Double {
        readAlong.isTTSMode ? readAlong.ttsCurrentTime : player.currentTime
    }

    private var duration: Double {
        readAlong.isTTSMode ? readAlong.ttsDuration : player.duration
    }

    private var isPlaying: Bool {
        readAlong.isTTSMode ? readAlong.ttsIsPlaying : player.isPlaying
    }

    private var progress: Double {
        duration > 0 ? currentTime / duration : 0
    }

    private var isLoading: Bool {
        readAlong.state == .loading || readAlong.state == .buffering
    }

    private var transcriptionProgress: Double? {
        if !readAlong.isTTSMode,
           readAlong.state == .loading,
           case .transcribing(let progress, _) = transcriptionService.state {
            return progress
        }
        return nil
    }

    var body: some View {
        ZStack {
            // Outer progress ring
            Circle()
                .stroke(Color.primary.opacity(0.1), lineWidth: 3)
                .frame(width: 52, height: 52)

            // Progress indicator
            if let tp = transcriptionProgress {
                Circle()
                    .trim(from: 0, to: tp)
                    .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .frame(width: 52, height: 52)
            } else if !isLoading {
                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .frame(width: 52, height: 52)
                    .animation(.linear(duration: 0.3), value: progress)
            }

            // Background circle
            Circle()
                .fill(.ultraThinMaterial)
                .frame(width: 46, height: 46)

            // Center content
            if isLoading {
                ProgressView()
                    .scaleEffect(0.7)
            } else {
                Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.primary)
                    .contentTransition(.symbolEffect(.replace))
            }
        }
        .frame(width: 52, height: 52)
        .shadow(color: .black.opacity(0.15), radius: 6, y: 2)
        .contentShape(Circle())
        .onTapGesture {
            if !isLoading {
                readAlong.togglePlayPause()
            }
        }
        // Cancel X button
        .overlay(alignment: .topTrailing) {
            Button {
                readAlong.deactivate()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 7, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 16, height: 16)
                    .background(Color.gray.opacity(0.8))
                    .clipShape(Circle())
            }
            .offset(x: 2, y: -2)
        }
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: isPlaying)
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: isLoading)
    }
}
