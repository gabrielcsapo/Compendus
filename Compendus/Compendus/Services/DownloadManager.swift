//
//  DownloadManager.swift
//  Compendus
//
//  Handles downloading books for offline reading
//

import Foundation
import SwiftData

struct DownloadProgress: Identifiable {
    let id: String  // Book ID
    var progress: Double  // 0.0 - 1.0
    var bytesReceived: Int64
    var totalBytes: Int64
    var state: DownloadState

    enum DownloadState {
        case waiting
        case downloading
        case completed
        case failed(Error)
    }

    var progressDisplay: String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        let received = formatter.string(fromByteCount: bytesReceived)
        let total = formatter.string(fromByteCount: totalBytes)
        return "\(received) / \(total)"
    }
}

@Observable
class DownloadManager: NSObject {
    let config: ServerConfig
    let apiService: APIService

    private(set) var activeDownloads: [String: DownloadProgress] = [:]
    @ObservationIgnored private var downloadTasks: [String: URLSessionDownloadTask] = [:]
    @ObservationIgnored private var completionHandlers: [String: (Result<URL, Error>) -> Void] = [:]
    @ObservationIgnored private var _session: URLSession?

    private var session: URLSession {
        if let existing = _session {
            return existing
        }
        let config = URLSessionConfiguration.default
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        // Increase timeouts for large file downloads (audiobooks can be 1GB+)
        config.timeoutIntervalForRequest = 60  // 60 seconds per request
        config.timeoutIntervalForResource = 3600  // 1 hour max for entire download
        let newSession = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        _session = newSession
        return newSession
    }

    init(config: ServerConfig, apiService: APIService) {
        self.config = config
        self.apiService = apiService
        super.init()
    }

    /// Download a book for offline reading
    @MainActor
    func downloadBook(_ book: Book, modelContext: ModelContext) async throws -> DownloadedBook {
        // Check if already downloaded
        let descriptor = FetchDescriptor<DownloadedBook>(
            predicate: #Predicate { $0.id == book.id }
        )
        if let existing = try? modelContext.fetch(descriptor).first {
            return existing
        }

        // Determine download URL and final format
        // For CBR files, download as CBZ for offline reading support
        let isCbr = book.format.lowercased() == "cbr"
        let downloadURL: URL?
        let localFormat: String

        if isCbr {
            // Download CBR as CBZ for offline iOS support
            downloadURL = config.bookAsCbzURL(for: book.id)
            localFormat = "cbz"
            print("[DownloadManager] Converting CBR to CBZ for offline reading: \(book.id)")
        } else {
            downloadURL = apiService.bookDownloadURL(bookId: book.id, format: book.format)
            localFormat = book.format
        }

        guard let downloadURL = downloadURL else {
            throw APIError.invalidURL
        }

        // Initialize progress tracking
        let progress = DownloadProgress(
            id: book.id,
            progress: 0,
            bytesReceived: 0,
            totalBytes: Int64(book.fileSize ?? 0),
            state: .waiting
        )
        activeDownloads[book.id] = progress

        // Download file
        let localURL = try await downloadFile(from: downloadURL, bookId: book.id)

        // Move to permanent location
        let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let booksDir = documentsURL.appendingPathComponent("books", isDirectory: true)
        try FileManager.default.createDirectory(at: booksDir, withIntermediateDirectories: true)

        let fileName = "\(book.id).\(localFormat)"
        let destinationURL = booksDir.appendingPathComponent(fileName)

        // Remove existing file if present
        if FileManager.default.fileExists(atPath: destinationURL.path) {
            try FileManager.default.removeItem(at: destinationURL)
        }

        try FileManager.default.moveItem(at: localURL, to: destinationURL)

        // Get actual file size from downloaded file
        let actualFileSize: Int
        if let attrs = try? FileManager.default.attributesOfItem(atPath: destinationURL.path),
           let size = attrs[.size] as? Int {
            actualFileSize = size
        } else {
            actualFileSize = book.fileSize ?? 0
        }

        // Download cover
        var coverData: Data? = nil
        if book.coverUrl != nil {
            coverData = try? await apiService.fetchCover(bookId: book.id)
        }

        // Create database entry with actual file size
        // Use local format (cbz) instead of original format (cbr) for offline reading
        let downloadedBook = DownloadedBook.from(
            book: book,
            localPath: "books/\(fileName)",
            coverData: coverData
        )
        // Override format if we converted CBR to CBZ
        if isCbr {
            downloadedBook.format = localFormat
        }
        downloadedBook.fileSize = actualFileSize
        modelContext.insert(downloadedBook)
        try modelContext.save()

        // Clean up progress tracking
        activeDownloads.removeValue(forKey: book.id)

        return downloadedBook
    }

    /// Download the converted EPUB version for a PDF book
    @MainActor
    func downloadEpubVersion(bookId: String, modelContext: ModelContext) async throws {
        let descriptor = FetchDescriptor<DownloadedBook>(
            predicate: #Predicate { $0.id == bookId }
        )
        guard let downloadedBook = try? modelContext.fetch(descriptor).first else {
            throw APIError.invalidURL
        }

        guard let downloadURL = config.bookAsEpubURL(for: bookId) else {
            throw APIError.invalidURL
        }

        let progressId = "\(bookId)-epub"
        let progress = DownloadProgress(
            id: progressId,
            progress: 0,
            bytesReceived: 0,
            totalBytes: 0,
            state: .waiting
        )
        activeDownloads[progressId] = progress

        let localURL = try await downloadFile(from: downloadURL, bookId: progressId)

        let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let booksDir = documentsURL.appendingPathComponent("books", isDirectory: true)
        try FileManager.default.createDirectory(at: booksDir, withIntermediateDirectories: true)

        let fileName = "\(bookId).epub"
        let destinationURL = booksDir.appendingPathComponent(fileName)

        if FileManager.default.fileExists(atPath: destinationURL.path) {
            try FileManager.default.removeItem(at: destinationURL)
        }

        try FileManager.default.moveItem(at: localURL, to: destinationURL)

        downloadedBook.epubLocalPath = "books/\(fileName)"
        try modelContext.save()

        activeDownloads.removeValue(forKey: progressId)
    }

    /// Cancel a download in progress
    func cancelDownload(bookId: String) {
        downloadTasks[bookId]?.cancel()
        downloadTasks.removeValue(forKey: bookId)
        activeDownloads.removeValue(forKey: bookId)
        completionHandlers.removeValue(forKey: bookId)
    }

    /// Delete a downloaded book
    @MainActor
    func deleteBook(_ book: DownloadedBook, modelContext: ModelContext) throws {
        // Delete file
        if let fileURL = book.fileURL {
            try? FileManager.default.removeItem(at: fileURL)
        }

        // Delete from database
        modelContext.delete(book)
        try modelContext.save()
    }

    /// Delete all downloaded books
    @MainActor
    func deleteAllBooks(modelContext: ModelContext) throws {
        let descriptor = FetchDescriptor<DownloadedBook>()
        let books = try modelContext.fetch(descriptor)

        for book in books {
            if let fileURL = book.fileURL {
                try? FileManager.default.removeItem(at: fileURL)
            }
            modelContext.delete(book)
        }

        try modelContext.save()
    }

    /// Check if a book is already downloaded
    @MainActor
    func isDownloaded(bookId: String, modelContext: ModelContext) -> Bool {
        let descriptor = FetchDescriptor<DownloadedBook>(
            predicate: #Predicate { $0.id == bookId }
        )
        return (try? modelContext.fetch(descriptor).first) != nil
    }

    /// Get a downloaded book by ID
    @MainActor
    func getDownloadedBook(id: String, modelContext: ModelContext) -> DownloadedBook? {
        let descriptor = FetchDescriptor<DownloadedBook>(
            predicate: #Predicate { $0.id == id }
        )
        return try? modelContext.fetch(descriptor).first
    }

    // MARK: - Private Helpers

    private func downloadFile(from url: URL, bookId: String) async throws -> URL {
        return try await withCheckedThrowingContinuation { continuation in
            let task = session.downloadTask(with: url)
            downloadTasks[bookId] = task
            completionHandlers[bookId] = { result in
                continuation.resume(with: result)
            }

            DispatchQueue.main.async {
                self.activeDownloads[bookId]?.state = .downloading
            }

            task.resume()
        }
    }
}

// MARK: - URLSessionDownloadDelegate

extension DownloadManager: URLSessionDownloadDelegate {
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let bookId = downloadTasks.first(where: { $0.value == downloadTask })?.key else { return }

        // Copy to a temporary location we control (the system will delete the original)
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        do {
            try FileManager.default.copyItem(at: location, to: tempURL)

            DispatchQueue.main.async {
                self.activeDownloads[bookId]?.state = .completed
                self.activeDownloads[bookId]?.progress = 1.0
                // Trigger success haptic feedback
                HapticFeedback.success()
            }

            completionHandlers[bookId]?(.success(tempURL))
        } catch {
            DispatchQueue.main.async {
                self.activeDownloads[bookId]?.state = .failed(error)
                // Trigger error haptic feedback
                HapticFeedback.error()
            }
            completionHandlers[bookId]?(.failure(error))
        }

        downloadTasks.removeValue(forKey: bookId)
        completionHandlers.removeValue(forKey: bookId)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let bookId = downloadTasks.first(where: { $0.value == downloadTask })?.key else { return }

        let progress = totalBytesExpectedToWrite > 0
            ? Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)
            : 0

        DispatchQueue.main.async {
            self.activeDownloads[bookId]?.progress = progress
            self.activeDownloads[bookId]?.bytesReceived = totalBytesWritten
            self.activeDownloads[bookId]?.totalBytes = totalBytesExpectedToWrite
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let downloadTask = task as? URLSessionDownloadTask,
              let bookId = downloadTasks.first(where: { $0.value == downloadTask })?.key,
              let error = error else { return }

        // Log detailed error for debugging
        print("[DownloadManager] Download failed for book \(bookId)")
        print("[DownloadManager] Error: \(error.localizedDescription)")
        if let urlError = error as? URLError {
            print("[DownloadManager] URLError code: \(urlError.code.rawValue)")
            print("[DownloadManager] URLError description: \(urlError.localizedDescription)")
        }
        if let response = downloadTask.response as? HTTPURLResponse {
            print("[DownloadManager] HTTP Status: \(response.statusCode)")
        }

        DispatchQueue.main.async {
            self.activeDownloads[bookId]?.state = .failed(error)
        }

        completionHandlers[bookId]?(.failure(error))
        downloadTasks.removeValue(forKey: bookId)
        completionHandlers.removeValue(forKey: bookId)
    }
}
