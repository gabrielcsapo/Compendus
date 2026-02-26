//
//  TranscribeButton.swift
//  Compendus
//
//  Transcription trigger button for audiobooks — triggers server-side
//  Whisper transcription and downloads the result for lyrics display.
//

import SwiftUI
import SwiftData

struct TranscribeButton: View {
    let book: DownloadedBook

    @Environment(APIService.self) private var apiService
    @Environment(\.modelContext) private var modelContext

    enum TranscriptionState: Equatable {
        case checking
        case idle
        case starting
        case transcribing(progress: Int, message: String)
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
                Button {
                    Task { await startTranscription() }
                } label: {
                    Label("Transcribe", systemImage: "waveform")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)

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
            await checkStatus()
        }
        .onDisappear {
            pollingTask?.cancel()
        }
    }

    private func checkStatus() async {
        // If we already have transcript data locally, we're done
        if book.transcriptData != nil {
            state = .completed
            return
        }

        // Check server for transcript availability
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
}
