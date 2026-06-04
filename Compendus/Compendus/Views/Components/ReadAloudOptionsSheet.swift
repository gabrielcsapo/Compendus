//
//  ReadAloudOptionsSheet.swift
//  Compendus
//
//  The "Read Aloud Options" popover (Listen / Voice / Speed / Download). Extracted from
//  ReadAlongPill so it can be presented both by the pill and directly from the reader's
//  ⋯ overflow menu.
//

import SwiftUI

struct ReadAloudOptionsSheet: View {
    /// Which sources are available for this book.
    let availableSources: [ReadAlongPill.Source]
    /// Book ID for cache queries and pre-generation.
    let bookId: String
    /// Whether a matching audiobook has a transcript ready.
    var audiobookHasTranscript: Bool = true

    let onStartAudiobook: () -> Void
    let onStartTTS: () -> Void
    /// Callback to restart TTS with a new voice index.
    var onChangeVoice: ((UInt32) -> Void)?
    /// Callback to queue TTS pre-generation for later.
    var onDownloadForLater: (() -> Void)?

    @Environment(\.dismiss) private var dismiss
    @Environment(ReadAlongService.self) private var readAlong
    @Environment(KokoroModelManager.self) private var voiceManager
    @Environment(TTSAudioCache.self) private var ttsAudioCache

    @State private var showingVoicePicker = false

    private static let speedOptions: [Float] = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]

    private var isActive: Bool { readAlong.isActive }

    private var hasDualSources: Bool {
        availableSources.contains(where: { if case .audiobook = $0 { return true }; return false }) &&
        availableSources.contains(where: {
            if case .tts = $0 { return true }
            if case .ttsCached = $0 { return true }
            return false
        })
    }

    private var hasTTSSource: Bool {
        availableSources.contains(where: {
            if case .tts = $0 { return true }
            if case .ttsCached = $0 { return true }
            return false
        })
    }

    private var cachedChapters: Int {
        ttsAudioCache.cachedChapterCount(for: bookId)
    }

    var body: some View {
        NavigationStack {
            List {
                // Start/switch options (hidden when already active with single source)
                if !isActive || hasDualSources {
                    Section {
                        if hasDualSources {
                            Button {
                                dismiss()
                                onStartAudiobook()
                            } label: {
                                Label {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("Read Along")
                                        Text(audiobookHasTranscript ? "Follow along with audiobook" : "Requires transcription first")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                } icon: {
                                    Image(systemName: "headphones")
                                }
                            }

                            Button {
                                dismiss()
                                onStartTTS()
                            } label: {
                                Label {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("Read Aloud")
                                        Text("On-device text-to-speech · \(voiceManager.selectedVoice?.name ?? "Default")")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                } icon: {
                                    Image(systemName: "speaker.wave.2")
                                }
                            }
                        } else if availableSources.contains(where: { if case .audiobook = $0 { return true }; return false }) {
                            Button {
                                dismiss()
                                onStartAudiobook()
                            } label: {
                                Label {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("Start Read Along")
                                        Text(audiobookHasTranscript ? "Follow along with audiobook" : "Requires transcription first")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                } icon: {
                                    Image(systemName: "headphones")
                                }
                            }
                        } else {
                            Button {
                                dismiss()
                                onStartTTS()
                            } label: {
                                Label {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("Start Read Aloud")
                                        Text("On-device text-to-speech")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                } icon: {
                                    Image(systemName: "speaker.wave.2")
                                }
                            }
                        }
                    } header: {
                        Text("Listen")
                    }
                }

                // TTS settings
                if hasTTSSource {
                    Section {
                        // Voice
                        Button {
                            showingVoicePicker = true
                        } label: {
                            HStack {
                                Label("Voice", systemImage: "person.wave.2")
                                Spacer()
                                Text(voiceManager.selectedVoice?.displayName ?? "Default")
                                    .foregroundStyle(.secondary)
                            }
                        }

                        // Speed
                        HStack {
                            Label("Speed", systemImage: "gauge.with.dots.needle.67percent")
                            Spacer()
                            Picker("Speed", selection: Binding(
                                get: { readAlong.ttsPlaybackRate },
                                set: { readAlong.setTTSPlaybackRate($0) }
                            )) {
                                ForEach(Self.speedOptions, id: \.self) { speed in
                                    Text(speed == 1.0 ? "1x" : (speed == floor(speed) ? "\(Int(speed))x" : "\(String(format: "%.2g", speed))x"))
                                        .tag(speed)
                                }
                            }
                            .pickerStyle(.menu)
                            .labelsHidden()
                        }

                        // Download for later
                        if let onDownloadForLater {
                            Button {
                                dismiss()
                                onDownloadForLater()
                            } label: {
                                Label {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("Download for Later")
                                        if cachedChapters > 0 {
                                            Text("\(cachedChapters) chapters cached")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        } else {
                                            Text("Pre-generate audio · runs while connected to power")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                } icon: {
                                    Image(systemName: "arrow.down.circle")
                                }
                            }
                        }
                    } header: {
                        Text("Text-to-Speech")
                    }
                }
            }
            .navigationTitle("Read Aloud Options")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
        .sheet(isPresented: $showingVoicePicker) { voicePickerSheet }
    }

    private var voicePickerSheet: some View {
        NavigationStack {
            List(voiceManager.availableVoices) { voice in
                Button {
                    if voice.id != voiceManager.selectedVoiceIndex {
                        voiceManager.selectedVoiceIndex = voice.id
                        onChangeVoice?(voice.id)
                    }
                    showingVoicePicker = false
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(voice.name).font(.body)
                            Text(voice.gender).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if voice.id == voiceManager.selectedVoiceIndex {
                            Image(systemName: "checkmark").foregroundStyle(.accent)
                        }
                    }
                }
                .foregroundStyle(.primary)
            }
            .navigationTitle("Voice")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { showingVoicePicker = false }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
