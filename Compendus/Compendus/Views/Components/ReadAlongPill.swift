//
//  ReadAlongPill.swift
//  Compendus
//
//  Unified bottom pill for read-along / read-aloud.
//  Shows availability, source selection, and playback controls.
//

import SwiftUI

struct ReadAlongPill: View {
    enum Source {
        case audiobook
        case tts
        case ttsCached
    }

    /// Which sources are available for this book.
    let availableSources: [Source]

    /// Book ID for cache queries and pre-generation.
    let bookId: String

    /// Whether a matching audiobook has a transcript ready.
    var audiobookHasTranscript: Bool = true

    let onStartAudiobook: () -> Void
    let onStartTTS: () -> Void
    let onDismiss: () -> Void

    /// Callback to restart TTS with a new voice index.
    var onChangeVoice: ((UInt32) -> Void)?

    /// Callback to queue TTS pre-generation for later.
    var onDownloadForLater: (() -> Void)?

    @Environment(ReadAlongService.self) private var readAlong
    @Environment(AudiobookPlayer.self) private var player
    @Environment(OnDeviceTranscriptionService.self) private var transcriptionService
    @Environment(PocketTTSModelManager.self) private var voiceManager
    @Environment(TTSAudioCache.self) private var ttsAudioCache

    @State private var showingSourcePicker = false
    @State private var showingOptionsSheet = false
    @State private var showingVoicePicker = false
    @State private var showingSpeedPicker = false

    // MARK: - Computed

    private var isActive: Bool { readAlong.isActive }

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

    private static let speedOptions: [Float] = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]

    private var currentSpeedLabel: String {
        let rate = readAlong.ttsPlaybackRate
        if rate == 1.0 { return "1x" }
        if rate == floor(rate) { return "\(Int(rate))x" }
        return "\(String(format: "%.2g", rate))x"
    }

    var body: some View {
        Group {
            if isActive {
                activePill
            } else if showingSourcePicker && hasDualSources {
                dualSourcePill
            } else {
                availablePill
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: isActive)
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: showingSourcePicker)
        .sheet(isPresented: $showingOptionsSheet) {
            optionsSheet
        }
        .sheet(isPresented: $showingVoicePicker) {
            voicePickerSheet
        }
        .sheet(isPresented: $showingSpeedPicker) {
            speedPickerSheet
        }
    }

    // MARK: - Available State (single pill)

    private var availablePill: some View {
        HStack(spacing: 8) {
            Image(systemName: availableIcon)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Text(availableTitle)
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

    // MARK: - Dual Source Picker

    private var dualSourcePill: some View {
        HStack(spacing: 0) {
            // Audiobook option
            Button {
                withAnimation { showingSourcePicker = false }
                onStartAudiobook()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "headphones")
                        .font(.subheadline)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Read Along")
                            .font(.subheadline.weight(.medium))
                        Text(audiobookHasTranscript ? "Audiobook" : "Needs transcription")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
            }
            .foregroundStyle(.primary)

            Divider()
                .frame(height: 28)

            // TTS option
            Button {
                withAnimation { showingSourcePicker = false }
                onStartTTS()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "speaker.wave.2")
                        .font(.subheadline)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Read Aloud")
                            .font(.subheadline.weight(.medium))
                        Text(voiceManager.selectedVoice?.name ?? "TTS")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
            }
            .foregroundStyle(.primary)

            // Dismiss
            Button {
                withAnimation {
                    showingSourcePicker = false
                    onDismiss()
                }
            } label: {
                Image(systemName: "xmark")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 24, height: 24)
            }
            .padding(.trailing, 10)
        }
        .background(.ultraThinMaterial)
        .clipShape(Capsule())
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    // MARK: - Active State (expanded pill with controls)

    private var activePill: some View {
        HStack(spacing: 10) {
            // Progress ring or loading spinner
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
                } else if !isLoading {
                    Circle()
                        .trim(from: 0, to: progress)
                        .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .frame(width: 32, height: 32)
                        .animation(.linear(duration: 0.3), value: progress)
                }

                if isLoading {
                    ProgressView()
                        .scaleEffect(0.6)
                } else {
                    Image(systemName: readAlong.isTTSMode ? "speaker.wave.2" : "headphones")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.primary)
                }
            }
            .frame(width: 32, height: 32)

            // Title + time
            VStack(alignment: .leading, spacing: 1) {
                Text(readAlong.isTTSMode ? "Read Aloud" : "Read Along")
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)

                if !isLoading {
                    Text("\(formatTime(currentTime)) / \(formatTime(duration))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }

            Spacer()

            // Speed button (TTS only)
            if readAlong.isTTSMode && !isLoading {
                Button {
                    showingSpeedPicker = true
                } label: {
                    Text(currentSpeedLabel)
                        .font(.caption.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.primary.opacity(0.06))
                        .clipShape(Capsule())
                }
            }

            // Voice picker button (TTS only)
            if readAlong.isTTSMode && !isLoading {
                Button {
                    showingVoicePicker = true
                } label: {
                    HStack(spacing: 3) {
                        Image(systemName: "person.wave.2")
                            .font(.system(size: 12))
                        Text(voiceManager.selectedVoice?.name ?? "Voice")
                            .font(.caption2)
                    }
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.primary.opacity(0.06))
                    .clipShape(Capsule())
                }
            }

            // Play/pause
            Button {
                if !isLoading {
                    readAlong.togglePlayPause()
                }
            } label: {
                Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.primary)
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 32, height: 32)
            }

            // Close
            Button {
                readAlong.deactivate()
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
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: isPlaying)
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: isLoading)
    }

    // MARK: - Options Sheet

    private var optionsSheet: some View {
        NavigationStack {
            List {
                // Start options
                Section {
                    if hasDualSources {
                        Button {
                            showingOptionsSheet = false
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
                            showingOptionsSheet = false
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
                            showingOptionsSheet = false
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
                            showingOptionsSheet = false
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

                // TTS settings
                if hasTTSSource {
                    Section {
                        // Voice
                        Button {
                            showingOptionsSheet = false
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                                showingVoicePicker = true
                            }
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
                        }

                        // Download for later
                        if let onDownloadForLater {
                            Button {
                                showingOptionsSheet = false
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
                    Button("Done") {
                        showingOptionsSheet = false
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }

    // MARK: - Voice Picker Sheet

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
                            Text(voice.name)
                                .font(.body)
                            Text(voice.gender)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if voice.id == voiceManager.selectedVoiceIndex {
                            Image(systemName: "checkmark")
                                .foregroundStyle(.accent)
                        }
                    }
                }
                .foregroundStyle(.primary)
            }
            .navigationTitle("Voice")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        showingVoicePicker = false
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }

    // MARK: - Speed Picker Sheet

    private var speedPickerSheet: some View {
        NavigationStack {
            List(Self.speedOptions, id: \.self) { speed in
                Button {
                    readAlong.setTTSPlaybackRate(speed)
                    showingSpeedPicker = false
                } label: {
                    HStack {
                        Text(speed == 1.0 ? "Normal (1x)" : (speed == floor(speed) ? "\(Int(speed))x" : "\(String(format: "%.2g", speed))x"))
                            .font(.body)
                        Spacer()
                        if speed == readAlong.ttsPlaybackRate {
                            Image(systemName: "checkmark")
                                .foregroundStyle(.accent)
                        }
                    }
                }
                .foregroundStyle(.primary)
            }
            .navigationTitle("Playback Speed")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        showingSpeedPicker = false
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }

    // MARK: - Helpers

    private var availableIcon: String {
        let source = availableSources.first ?? .tts
        switch source {
        case .audiobook: return "headphones"
        case .tts: return "speaker.wave.2"
        case .ttsCached: return "speaker.wave.2.circle.fill"
        }
    }

    private var availableTitle: String {
        if hasDualSources {
            return "Read Along / Read Aloud available"
        }
        let source = availableSources.first ?? .tts
        switch source {
        case .audiobook: return "Read Along available"
        case .tts: return "Read Aloud available"
        case .ttsCached: return "Read Aloud ready"
        }
    }

    private func formatTime(_ seconds: Double) -> String {
        guard seconds.isFinite && seconds >= 0 else { return "0:00" }
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return "\(mins):\(String(format: "%02d", secs))"
    }
}
