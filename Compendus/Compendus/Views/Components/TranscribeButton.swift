//
//  TranscribeButton.swift
//  Compendus
//
//  Transcription trigger button for audiobooks — supports both server-side
//  Whisper transcription and on-device Speech framework transcription.
//

import SwiftUI
import SwiftData

struct TranscribeButton: View {
    let book: DownloadedBook

    @Environment(APIService.self) private var apiService
    @Environment(OnDeviceTranscriptionService.self) private var onDeviceService
    @Environment(\.modelContext) private var modelContext

    enum TranscriptionState: Equatable {
        case checking
        case idle
        case starting
        case transcribing(progress: Int, message: String)
        case onDeviceTranscribing(progress: Double, message: String)
        case completed
        case error(String)
    }

    @State private var state: TranscriptionState = .idle
    @State private var pollingTask: Task<Void, Never>?

    var body: some View {
        Group {
            switch state {
            case .checking:
                EmptyView()

            case .idle:
                if onDeviceService.isAvailable {
                    Menu {
                        Button {
                            Task { await startTranscription() }
                        } label: {
                            Label("Server Transcription", systemImage: "cloud")
                        }

                        Button {
                            startOnDeviceTranscription()
                        } label: {
                            Label("On-Device Transcription (best while charging)", systemImage: "iphone")
                        }
                    } label: {
                        Label("Transcribe", systemImage: "waveform")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                } else {
                    Button {
                        Task { await startTranscription() }
                    } label: {
                        Label("Transcribe", systemImage: "waveform")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }

            case .starting:
                HStack(spacing: 8) {
                    ProgressView()
                        .scaleEffect(0.7)
                    Text("Starting transcription...")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

            case .transcribing(let progress, let message):
                VStack(spacing: 6) {
                    ProgressView(value: Double(progress), total: 100)
                        .tint(.accentColor)
                    HStack {
                        Text(message)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        Spacer()
                        Text("\(progress)%")
                            .font(.caption)
                            .fontWeight(.medium)
                    }
                }

            case .onDeviceTranscribing(let progress, let message):
                VStack(spacing: 6) {
                    ProgressView(value: progress)
                        .tint(.accentColor)
                    HStack {
                        Text(message)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        Spacer()
                        Text("\(Int(progress * 100))%")
                            .font(.caption)
                            .fontWeight(.medium)
                        Button {
                            onDeviceService.cancel()
                            state = .idle
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.secondary)
                        }
                    }
                }

            case .completed:
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                    Text("Transcript available")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

            case .error(let message):
                VStack(spacing: 8) {
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                        Text(message)
                            .font(.caption)
                            .foregroundStyle(.red)
                            .lineLimit(2)
                    }
                    Button {
                        Task { await startTranscription() }
                    } label: {
                        Label("Retry", systemImage: "arrow.clockwise")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
        .task {
            // If the service is actively transcribing this book, sync state
            if onDeviceService.activeBookId == book.id {
                handleOnDeviceStateChange(onDeviceService.state)
            } else {
                await checkStatus()
            }
        }
        .onDisappear {
            pollingTask?.cancel()
        }
        .onChange(of: onDeviceService.state) { _, newState in
            handleOnDeviceStateChange(newState)
        }
        .onChange(of: book.transcriptData) { _, newValue in
            if newValue == nil && state == .completed {
                state = .idle
            }
        }
    }

    // MARK: - Status Check

    private func checkStatus() async {
        // If we already have transcript data locally, we're done
        if book.transcriptData != nil {
            state = .completed
            return
        }

        // Check server for transcript availability (from any source)
        do {
            let status = try await apiService.getTranscriptStatus(bookId: book.id)
            if status.hasTranscript == true {
                // Transcript exists on server but not downloaded — download it
                await downloadAndCacheTranscript()
            } else {
                state = .idle
            }
        } catch {
            state = .idle
        }
    }

    // MARK: - Server Transcription

    private func startTranscription() async {
        state = .starting
        do {
            let response = try await apiService.transcribe(bookId: book.id)

            if response.alreadyTranscribed == true {
                await downloadAndCacheTranscript()
                return
            }

            if let jobId = response.jobId {
                state = .transcribing(progress: 0, message: "Starting transcription...")
                startPolling(jobId: jobId)
            } else if let message = response.message ?? response.error {
                state = .error(message)
            }
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    private func startPolling(jobId: String) {
        pollingTask?.cancel()
        pollingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                guard !Task.isCancelled else { return }

                do {
                    let progress = try await apiService.getJobProgress(jobId: jobId)

                    if progress.status == "completed" {
                        await downloadAndCacheTranscript()
                        return
                    } else if progress.status == "error" {
                        state = .error(progress.message ?? "Transcription failed")
                        return
                    } else {
                        state = .transcribing(
                            progress: progress.progress ?? 0,
                            message: progress.message ?? "Transcribing..."
                        )
                    }
                } catch {
                    state = .error("Lost connection to server")
                    return
                }
            }
        }
    }

    @MainActor
    private func downloadAndCacheTranscript() async {
        do {
            let response = try await apiService.fetchTranscript(bookId: book.id)
            if let transcript = response.transcript {
                let data = try JSONEncoder().encode(transcript)
                book.transcriptData = data
                try? modelContext.save()
                state = .completed
            } else {
                state = .error("No transcript data received")
            }
        } catch {
            state = .error("Failed to download transcript")
        }
    }

    // MARK: - On-Device Transcription

    private func startOnDeviceTranscription() {
        guard let fileURL = book.fileURL else {
            state = .error("Audio file not found")
            return
        }
        let duration = Double(book.duration ?? 0)
        guard duration > 0 else {
            state = .error("Unknown audio duration")
            return
        }
        onDeviceService.transcribe(
            fileURL: fileURL,
            duration: duration,
            bookId: book.id,
            title: book.title,
            coverData: book.coverData
        )
    }

    private func handleOnDeviceStateChange(_ newState: OnDeviceTranscriptionService.TranscriptionState) {
        // Only handle state changes for this book
        guard onDeviceService.activeBookId == book.id else { return }

        switch newState {
        case .idle:
            break
        case .preparing:
            state = .onDeviceTranscribing(progress: 0, message: "Preparing...")
        case .transcribing(let progress, let message):
            state = .onDeviceTranscribing(progress: progress, message: message)
        case .completed(let transcript):
            // Live mode transcriptions are ephemeral (used for read-along only) — don't save
            guard !onDeviceService.liveMode else {
                onDeviceService.state = .idle
                return
            }

            // Save transcript locally
            if let data = try? JSONEncoder().encode(transcript) {
                book.transcriptData = data
                try? modelContext.save()
            }
            state = .completed
            onDeviceService.state = .idle

            // Upload to server so other clients can use it (fire-and-forget)
            Task {
                try? await apiService.uploadTranscript(bookId: book.id, transcript: transcript)
            }
        case .error(let message):
            state = .error(message)
            onDeviceService.state = .idle
        }
    }
}
