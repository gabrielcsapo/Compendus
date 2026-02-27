//
//  TranscriptionPill.swift
//  Compendus
//
//  Floating pill for audiobook transcription controls.
//  Mirrors ReadAlongPill's visual language for a consistent experience.
//

import SwiftUI

struct TranscriptionPill: View {
    let book: DownloadedBook
    let showLyrics: Bool
    let onToggleLyrics: () -> Void
    let onStartLiveTranscription: () -> Void
    let onStartFullTranscription: () -> Void
    let onDismiss: () -> Void

    @Environment(AudiobookPlayer.self) private var player
    @Environment(OnDeviceTranscriptionService.self) private var transcriptionService

    @State private var showingOptionsSheet = false

    // MARK: - Computed

    private var hasTranscript: Bool {
        book.hasTranscript || partialTranscriptForBook != nil
    }

    private var isTranscribing: Bool {
        transcriptionService.activeBookId == book.id && transcriptionService.isActive
    }

    private var transcriptionProgress: Double? {
        guard isTranscribing,
              case .transcribing(let progress, _) = transcriptionService.state else {
            return nil
        }
        return progress
    }

    private var partialTranscriptForBook: Transcript? {
        guard transcriptionService.activeBookId == book.id else { return nil }
        return transcriptionService.partialTranscript
    }

    private static let speedOptions: [Double] = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0]

    var body: some View {
        Group {
            if isTranscribing {
                transcribingPill
            } else if hasTranscript {
                transcriptReadyPill
            } else {
                availablePill
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: isTranscribing)
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: hasTranscript)
        .sheet(isPresented: $showingOptionsSheet) {
            optionsSheet
        }
    }

    // MARK: - Available State

    private var availablePill: some View {
        HStack(spacing: 8) {
            Image(systemName: "text.quote")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Text("Transcription available")
                .font(.subheadline.weight(.medium))
                .lineLimit(1)

            Spacer()

            Button {
                withAnimation { onDismiss() }
            } label: {
                Image(systemName: "xmark")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 24, height: 24)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial)
        .clipShape(Capsule())
        .contentShape(Capsule())
        .onTapGesture {
            showingOptionsSheet = true
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    // MARK: - Transcribing State

    private var transcribingPill: some View {
        HStack(spacing: 10) {
            // Progress ring
            ZStack {
                Circle()
                    .stroke(Color.primary.opacity(0.1), lineWidth: 2.5)
                    .frame(width: 32, height: 32)

                if let tp = transcriptionProgress {
                    Circle()
                        .trim(from: 0, to: tp)
                        .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .frame(width: 32, height: 32)
                        .animation(.linear(duration: 0.3), value: tp)
                }

                Image(systemName: "waveform")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.primary)
            }
            .frame(width: 32, height: 32)

            VStack(alignment: .leading, spacing: 1) {
                Text("Transcribing")
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)

                if let progress = transcriptionProgress {
                    Text("\(Int(progress * 100))% complete")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }

            Spacer()

            // Cancel
            Button {
                transcriptionService.cancel()
            } label: {
                Image(systemName: "xmark")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 24, height: 24)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial)
        .clipShape(Capsule())
        .shadow(color: .black.opacity(0.1), radius: 8, y: 2)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    // MARK: - Transcript Ready State

    private var transcriptReadyPill: some View {
        HStack(spacing: 8) {
            Image(systemName: showLyrics ? "text.quote.fill" : "text.quote")
                .font(.subheadline)
                .foregroundStyle(showLyrics ? .primary : .secondary)

            Text("Transcript")
                .font(.subheadline.weight(.medium))
                .lineLimit(1)

            if showLyrics {
                Text("On")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Button {
                withAnimation { onDismiss() }
            } label: {
                Image(systemName: "xmark")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 24, height: 24)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial)
        .clipShape(Capsule())
        .contentShape(Capsule())
        .onTapGesture {
            showingOptionsSheet = true
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    // MARK: - Options Sheet

    private var optionsSheet: some View {
        NavigationStack {
            List {
                // Transcription options (only if no transcript yet)
                if !hasTranscript {
                    Section {
                        Button {
                            showingOptionsSheet = false
                            onStartLiveTranscription()
                        } label: {
                            Label {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Live Transcribe")
                                    Text("Transcribe from current position")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            } icon: {
                                Image(systemName: "waveform")
                            }
                        }

                        Button {
                            showingOptionsSheet = false
                            onStartFullTranscription()
                        } label: {
                            Label {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Full Book")
                                    Text("Transcribe entire audiobook for lyrics")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            } icon: {
                                Image(systemName: "book.closed")
                            }
                        }
                    } header: {
                        Text("Transcription")
                    }
                }

                // Display options (when transcript exists)
                if hasTranscript {
                    Section {
                        Button {
                            onToggleLyrics()
                        } label: {
                            Label {
                                HStack {
                                    Text("Show Lyrics")
                                    Spacer()
                                    if showLyrics {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(.accent)
                                    }
                                }
                            } icon: {
                                Image(systemName: "text.quote")
                            }
                        }
                    } header: {
                        Text("Display")
                    }
                }

                // Playback settings
                Section {
                    HStack {
                        Label("Speed", systemImage: "gauge.with.dots.needle.67percent")
                        Spacer()
                        Picker("Speed", selection: Binding(
                            get: { player.playbackRate },
                            set: { player.setPlaybackRate($0) }
                        )) {
                            ForEach(Self.speedOptions, id: \.self) { speed in
                                Text(speed == 1.0 ? "1x" : "\(String(format: "%.2g", speed))x")
                                    .tag(Float(speed))
                            }
                        }
                        .pickerStyle(.menu)
                    }
                } header: {
                    Text("Playback")
                }
            }
            .navigationTitle("Transcription Options")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        showingOptionsSheet = false
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
