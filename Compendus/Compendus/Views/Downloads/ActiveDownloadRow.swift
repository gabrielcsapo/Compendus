//
//  ActiveDownloadRow.swift
//  Compendus
//
//  Row view for an in-progress, pending, or failed download
//

import SwiftUI
import SwiftData

struct ActiveDownloadRow: View {
    let pending: PendingDownload
    let progress: DownloadProgress?
    var onCancel: () -> Void
    var onRetry: () -> Void

    /// Standard book cover aspect ratio (2:3)
    private let bookAspectRatio: CGFloat = 2/3

    private var isFailed: Bool {
        if let progress, case .failed = progress.state { return true }
        return pending.status == "failed"
    }

    private var isWaiting: Bool {
        if let progress {
            if case .waiting = progress.state { return true }
            return false
        }
        return pending.status == "pending"
    }

    private var currentProgress: Double {
        progress?.progress ?? 0
    }

    var body: some View {
        HStack(spacing: 12) {
            // Cover thumbnail
            coverView
                .frame(width: 50)

            // Info + progress
            VStack(alignment: .leading, spacing: 4) {
                Text(pending.title)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(1)

                Text(pending.authors.joined(separator: ", "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                if isFailed {
                    HStack(spacing: 4) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.caption2)
                        Text(pending.errorMessage ?? "Download failed")
                            .font(.caption2)
                    }
                    .foregroundStyle(.red)
                    .lineLimit(1)
                } else if isWaiting {
                    HStack(spacing: 6) {
                        ProgressView()
                            .scaleEffect(0.6)
                            .frame(width: 12, height: 12)
                        Text("Waiting...")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    // Download progress
                    VStack(alignment: .leading, spacing: 2) {
                        ProgressView(value: currentProgress)
                            .progressViewStyle(LinearProgressViewStyle())

                        HStack {
                            if let progress {
                                Text(progress.progressDisplay)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .monospacedDigit()
                            }

                            Spacer()

                            Text("\(Int(currentProgress * 100))%")
                                .font(.caption2)
                                .fontWeight(.medium)
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                        }
                    }
                }
            }

            Spacer(minLength: 0)

            // Action button
            if isFailed {
                Button(action: onRetry) {
                    Image(systemName: "arrow.clockwise.circle.fill")
                        .font(.title2)
                        .foregroundStyle(.blue)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Retry download")
            } else {
                Button(action: onCancel) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Cancel download")
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 16)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var coverView: some View {
        if let coverData = pending.coverData, let uiImage = UIImage(data: coverData) {
            Image(uiImage: uiImage)
                .resizable()
                .aspectRatio(bookAspectRatio, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 4))
                .shadow(color: .black.opacity(0.1), radius: 2, x: 0, y: 1)
        } else {
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.gray.opacity(0.2))
                .aspectRatio(bookAspectRatio, contentMode: .fit)
                .overlay {
                    Image(systemName: bookIcon)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
        }
    }

    private var bookIcon: String {
        let fmt = pending.format.lowercased()
        if ["m4b", "mp3", "m4a"].contains(fmt) {
            return "headphones"
        } else if ["cbr", "cbz"].contains(fmt) {
            return "book.pages"
        }
        return "book.closed"
    }
}
