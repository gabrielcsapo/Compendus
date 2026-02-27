//
//  ReadAlongBanner.swift
//  Compendus
//
//  Entry point banner shown when an EPUB has a matching audiobook or
//  when TTS is available for read-aloud mode.
//

import SwiftUI

struct ReadAlongBanner: View {
    enum Mode {
        case audiobook(title: String, hasTranscript: Bool)
        case tts
    }

    let mode: Mode
    let onStart: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: iconName)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 1) {
                Text(titleText)
                    .font(.subheadline)
                    .lineLimit(1)
                if let subtitle = subtitleText {
                    Text(subtitle)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            Button(action: onStart) {
                Text(buttonText)
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(.tint)
                    .foregroundStyle(.white)
                    .clipShape(Capsule())
            }

            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 24, height: 24)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .frame(minHeight: 44)
        .background(.ultraThinMaterial)
        .transition(.move(edge: .top).combined(with: .opacity))
    }

    private var iconName: String {
        switch mode {
        case .audiobook: return "headphones"
        case .tts: return "speaker.wave.2"
        }
    }

    private var titleText: String {
        switch mode {
        case .audiobook: return "Read Along available"
        case .tts: return "Read Aloud available"
        }
    }

    private var subtitleText: String? {
        switch mode {
        case .audiobook(_, let hasTranscript):
            return hasTranscript ? nil : "Requires full transcription first"
        case .tts:
            return "On-device text-to-speech"
        }
    }

    private var buttonText: String {
        switch mode {
        case .audiobook(_, let hasTranscript):
            return hasTranscript ? "Start" : "Transcribe"
        case .tts:
            return "Start"
        }
    }
}
