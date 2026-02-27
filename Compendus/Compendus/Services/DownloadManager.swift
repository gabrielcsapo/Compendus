//
//  DownloadManager.swift
//  Compendus
//
//  Handles downloading books for offline reading with background session support.
//  Downloads continue when the app is backgrounded or terminated.
//

import Foundation
import SwiftData

enum DownloadError: LocalizedError {
    case conversionNotSupported
    case conversionFailed(String)

    var errorDescription: String? {
        switch self {
        case .conversionNotSupported:
            return "This book format is not supported. The server could not convert it to EPUB."
        case .conversionFailed(let message):
            return "Failed to convert to EPUB: \(message)"
        }
    }
}

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

        var isCompleted: Bool {
            if case .completed = self { return true }
            return false
        }
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
    @ObservationIgnored private var _session: URLSession?

    /// Set by CompendusApp on appear for background session handling
    weak var appDelegate: AppDelegate?
    /// Set by CompendusApp on appear for creating ModelContexts in delegate callbacks
    var modelContainer: ModelContainer?
    /// Set by CompendusApp on appear for auto-queueing background generation
    weak var backgroundProcessingManager: BackgroundProcessingManager?
    /// Set by CompendusApp on appear for reading auto-generation settings
    weak var appSettings: AppSettings?
    /// Set by CompendusApp on appear for reading selected voice
    weak var pocketTTSModelManager: PocketTTSModelManager?

    private static let backgroundSessionIdentifier = "com.compendus.background-download"

    private var session: URLSession {
        if let existing = _session {
            return existing
        }
        let config = URLSessionConfiguration.background(withIdentifier: Self.backgroundSessionIdentifier)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.timeoutIntervalForResource = 3600  // 1 hour max for entire download
        config.allowsCellularAccess = true
        let newSession = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        _session = newSession
        return newSession
    }

    init(config: ServerConfig, apiService: APIService) {
        self.config = config
        self.apiService = apiService
        super.init()
    }

    // MARK: - Public API

    /// Download a book for offline reading.
    /// The download runs in the background and completes even if the app is suspended.
    /// Returns the existing DownloadedBook if already downloaded, or nil if download was started.
    @MainActor
    func downloadBook(_ book: Book, modelContext: ModelContext) async throws -> DownloadedBook? {
        // Check if already downloaded
        let bookId = book.id
        let descriptor = FetchDescriptor<DownloadedBook>(
            predicate: #Predicate { $0.id == bookId }
        )
        if let existing = try? modelContext.fetch(descriptor).first {
            return existing
        }

        // Check if already pending/downloading
        let pendingDescriptor = FetchDescriptor<PendingDownload>(
            predicate: #Predicate { $0.id == bookId }
        )
        if let existing = try? modelContext.fetch(pendingDescriptor).first {
            if existing.status == "downloading" || existing.status == "pending" {
                print("[DownloadManager] Download already in progress for \(bookId)")
                return nil
            }
            // Remove stale failed/completed pending download
            modelContext.delete(existing)
        }

        // Determine download URL and final format
        let isCbr = book.format.lowercased() == "cbr"
        let isNonEpubEbook = book.isEbook && book.format.lowercased() != "epub"
        let downloadURL: URL?
        let localFormat: String

        if isCbr {
            downloadURL = config.bookAsCbzURL(for: book.id)
            localFormat = "cbz"
            print("[DownloadManager] Converting CBR to CBZ for offline reading: \(book.id)")
        } else if isNonEpubEbook {
            // All non-EPUB ebooks are converted to EPUB for reading
            // PDFs need async conversion first; MOBI/AZW3 are converted inline by the server
            if book.format.lowercased() == "pdf" {
                try await ensureEpubConversion(bookId: book.id)
            }
            downloadURL = config.bookAsEpubURL(for: book.id)
            localFormat = "epub"
            print("[DownloadManager] Downloading \(book.format.uppercased()) as EPUB: \(book.id)")
        } else {
            downloadURL = apiService.bookDownloadURL(bookId: book.id, format: book.format)
            localFormat = book.format
        }

        guard let downloadURL = downloadURL else {
            throw APIError.invalidURL
        }

        // Pre-fetch cover before starting download
        var coverData: Data? = nil
        if book.coverUrl != nil {
            coverData = try? await apiService.fetchCover(bookId: book.id)
        }

        // Persist download intent in SwiftData
        let pending = PendingDownload.from(book: book, downloadURL: downloadURL, localFormat: localFormat)
        pending.status = "downloading"
        pending.coverData = coverData
        modelContext.insert(pending)
        try modelContext.save()

        // Initialize progress tracking
        let progress = DownloadProgress(
            id: book.id,
            progress: 0,
            bytesReceived: 0,
            totalBytes: Int64(book.fileSize ?? 0),
            state: .downloading
        )
        activeDownloads[book.id] = progress

        // Start background download task
        let task = session.downloadTask(with: downloadURL)
        task.taskDescription = book.id  // Persists across app termination
        task.resume()

        return nil
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
            state: .downloading
        )
        activeDownloads[progressId] = progress

        // EPUB version downloads use a simple foreground data task since they're
        // typically small and the user is actively waiting in the reader
        let (data, _) = try await URLSession.shared.data(from: downloadURL)

        let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let booksDir = documentsURL.appendingPathComponent("books", isDirectory: true)
        try FileManager.default.createDirectory(at: booksDir, withIntermediateDirectories: true)

        let fileName = "\(bookId).epub"
        let destinationURL = booksDir.appendingPathComponent(fileName)

        if FileManager.default.fileExists(atPath: destinationURL.path) {
            try FileManager.default.removeItem(at: destinationURL)
        }

        try data.write(to: destinationURL)

        downloadedBook.epubLocalPath = "books/\(fileName)"
        try modelContext.save()

        activeDownloads.removeValue(forKey: progressId)
    }

    /// Retry a failed download using the persisted PendingDownload metadata
    @MainActor
    func retryDownload(_ pending: PendingDownload, modelContext: ModelContext) {
        guard let downloadURL = URL(string: pending.downloadURL) else { return }

        // Reset status
        pending.status = "downloading"
        pending.errorMessage = nil
        try? modelContext.save()

        // Initialize progress tracking
        let progress = DownloadProgress(
            id: pending.id,
            progress: 0,
            bytesReceived: 0,
            totalBytes: Int64(pending.fileSize),
            state: .downloading
        )
        activeDownloads[pending.id] = progress

        // Start background download task
        let task = session.downloadTask(with: downloadURL)
        task.taskDescription = pending.id
        task.resume()
    }

    /// Cancel all active and pending downloads
    @MainActor
    func cancelAllDownloads(modelContext: ModelContext) {
        // Cancel all tracked active downloads
        let bookIds = Array(activeDownloads.keys)
        for bookId in bookIds {
            cancelDownload(bookId: bookId, modelContext: modelContext)
        }

        // Also clean up any pending downloads not in activeDownloads
        let descriptor = FetchDescriptor<PendingDownload>(
            predicate: #Predicate { $0.status == "pending" || $0.status == "downloading" || $0.status == "failed" }
        )
        if let remaining = try? modelContext.fetch(descriptor) {
            for pending in remaining {
                cancelDownload(bookId: pending.id, modelContext: modelContext)
            }
        }
    }

    /// Cancel a download in progress
    @MainActor
    func cancelDownload(bookId: String, modelContext: ModelContext? = nil) {
        session.getAllTasks { tasks in
            for task in tasks {
                if task.taskDescription == bookId {
                    task.cancel()
                }
            }
        }

        activeDownloads.removeValue(forKey: bookId)

        if let modelContext = modelContext {
            let descriptor = FetchDescriptor<PendingDownload>(
                predicate: #Predicate { $0.id == bookId }
            )
            if let pending = try? modelContext.fetch(descriptor).first {
                modelContext.delete(pending)
                try? modelContext.save()
            }
        }
    }

    /// Delete a downloaded book
    @MainActor
    func deleteBook(_ book: DownloadedBook, modelContext: ModelContext) throws {
        if let fileURL = book.fileURL {
            try? FileManager.default.removeItem(at: fileURL)
        }
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

    // MARK: - EPUB Conversion

    /// Ensure EPUB conversion is complete on the server before downloading.
    /// Used for formats like PDF that require async server-side conversion.
    /// MOBI/AZW3 are converted inline by the /as-epub endpoint and don't need this.
    private func ensureEpubConversion(bookId: String) async throws {
        let response: ConversionResponse
        do {
            response = try await apiService.convertToEpub(bookId: bookId)
        } catch let error as APIError {
            if case .serverError(400, _) = error {
                throw DownloadError.conversionNotSupported
            }
            throw error
        }

        if response.alreadyConverted == true {
            return
        }

        guard let jobId = response.jobId else {
            throw DownloadError.conversionNotSupported
        }

        // Poll for completion
        while true {
            try await Task.sleep(for: .seconds(2))
            let progress = try await apiService.getJobProgress(jobId: jobId)

            if progress.status == "completed" {
                return
            } else if progress.status == "error" {
                throw DownloadError.conversionFailed(progress.message ?? "Conversion failed")
            }
        }
    }

    // MARK: - Background Session Reconnection

    /// Reconnect to any in-progress background downloads after app launch.
    func reconnectBackgroundSession() {
        session.getAllTasks { [weak self] tasks in
            guard let self = self else { return }

            DispatchQueue.main.async {
                for task in tasks {
                    guard let bookId = task.taskDescription else { continue }

                    let progress = DownloadProgress(
                        id: bookId,
                        progress: task.countOfBytesExpectedToReceive > 0
                            ? Double(task.countOfBytesReceived) / Double(task.countOfBytesExpectedToReceive)
                            : 0,
                        bytesReceived: task.countOfBytesReceived,
                        totalBytes: task.countOfBytesExpectedToReceive,
                        state: .downloading
                    )
                    self.activeDownloads[bookId] = progress
                }

                if !tasks.isEmpty {
                    print("[DownloadManager] Reconnected to \(tasks.count) in-progress download(s)")
                }
            }
        }
    }

    // MARK: - Metadata Sync

    private static let syncInterval: TimeInterval = 3600
    private static let lastSyncKey = "lastMetadataSyncTimestamp"

    @MainActor
    func syncDownloadedBooksMetadata(modelContext: ModelContext, force: Bool = false) async {
        if !force {
            let lastSync = UserDefaults.standard.double(forKey: Self.lastSyncKey)
            if lastSync > 0 && Date.now.timeIntervalSince1970 - lastSync < Self.syncInterval {
                return
            }
        }

        guard config.isConfigured else { return }

        let descriptor = FetchDescriptor<DownloadedBook>()
        guard let downloadedBooks = try? modelContext.fetch(descriptor), !downloadedBooks.isEmpty else { return }

        print("[DownloadManager] Syncing metadata for \(downloadedBooks.count) downloaded books")

        await withTaskGroup(of: (String, Book?, Data?).self) { group in
            for downloadedBook in downloadedBooks {
                let bookId = downloadedBook.id
                group.addTask {
                    do {
                        let book = try await self.apiService.fetchBook(id: bookId).book
                        var coverData: Data? = nil
                        if book.coverUrl != nil {
                            coverData = try? await self.apiService.fetchCover(bookId: bookId)
                        }
                        return (bookId, book, coverData)
                    } catch {
                        print("[DownloadManager] Failed to sync metadata for \(bookId): \(error.localizedDescription)")
                        return (bookId, nil, nil)
                    }
                }
            }

            for await (bookId, book, coverData) in group {
                guard let book = book,
                      let downloadedBook = downloadedBooks.first(where: { $0.id == bookId }) else { continue }
                downloadedBook.updateMetadata(from: book, coverData: coverData)
            }
        }

        do {
            try modelContext.save()
            UserDefaults.standard.set(Date.now.timeIntervalSince1970, forKey: Self.lastSyncKey)
            print("[DownloadManager] Metadata sync complete")
        } catch {
            print("[DownloadManager] Failed to save synced metadata: \(error.localizedDescription)")
        }
    }

    // MARK: - Auto Background Processing

    private func autoQueueBackgroundProcessing(bookId: String, format: String) {
        guard let manager = backgroundProcessingManager,
              let settings = appSettings else { return }

        let isEbook = ["epub"].contains(format)
        let isAudiobook = ["m4b", "mp3", "m4a"].contains(format)

        if isEbook && settings.autoGenerateTTS {
            guard let voiceManager = pocketTTSModelManager else {
                print("[DownloadManager] PocketTTS model manager not available, skipping TTS auto-queue")
                return
            }
            let voiceId = Int(voiceManager.selectedVoiceIndex)
            manager.enqueue(.ttsGeneration(bookId: bookId, voiceId: voiceId))
            print("[DownloadManager] Auto-queued TTS generation for \(bookId)")
        }

        if isAudiobook && settings.autoTranscribeAudiobooks {
            manager.enqueue(.transcription(bookId: bookId))
            print("[DownloadManager] Auto-queued transcription for \(bookId)")
        }
    }
}

// MARK: - URLSessionDownloadDelegate

extension DownloadManager: URLSessionDownloadDelegate {
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let bookId = downloadTask.taskDescription else { return }

        guard let container = modelContainer else {
            print("[DownloadManager] No model container available for background completion")
            return
        }

        // Create a fresh ModelContext for this background thread
        let context = ModelContext(container)

        let descriptor = FetchDescriptor<PendingDownload>(
            predicate: #Predicate { $0.id == bookId }
        )
        guard let pending = try? context.fetch(descriptor).first else {
            print("[DownloadManager] No PendingDownload found for \(bookId)")
            return
        }

        do {
            let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
            let booksDir = documentsURL.appendingPathComponent("books", isDirectory: true)
            try FileManager.default.createDirectory(at: booksDir, withIntermediateDirectories: true)

            let fileName = "\(bookId).\(pending.format)"
            let destinationURL = booksDir.appendingPathComponent(fileName)

            if FileManager.default.fileExists(atPath: destinationURL.path) {
                try FileManager.default.removeItem(at: destinationURL)
            }

            try FileManager.default.moveItem(at: location, to: destinationURL)

            let actualFileSize: Int
            if let attrs = try? FileManager.default.attributesOfItem(atPath: destinationURL.path),
               let size = attrs[.size] as? Int {
                actualFileSize = size
            } else {
                actualFileSize = pending.fileSize
            }

            let downloadedBook = pending.toDownloadedBook(
                localPath: "books/\(fileName)",
                fileSize: actualFileSize,
                coverData: pending.coverData
            )

            context.insert(downloadedBook)
            context.delete(pending)
            try context.save()

            let format = downloadedBook.format.lowercased()
            DispatchQueue.main.async {
                self.activeDownloads[bookId]?.state = .completed
                self.activeDownloads[bookId]?.progress = 1.0
                HapticFeedback.success()

                // Auto-queue background generation if enabled
                self.autoQueueBackgroundProcessing(bookId: bookId, format: format)

                // Clean up progress tracking after a short delay
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                    self.activeDownloads.removeValue(forKey: bookId)
                }
            }

            print("[DownloadManager] Download completed for \(bookId)")
        } catch {
            print("[DownloadManager] Failed to process completed download for \(bookId): \(error)")

            pending.status = "failed"
            pending.errorMessage = error.localizedDescription
            try? context.save()

            DispatchQueue.main.async {
                self.activeDownloads[bookId]?.state = .failed(error)
                HapticFeedback.error()
            }
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let bookId = downloadTask.taskDescription else { return }

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
        guard let bookId = task.taskDescription, let error = error else { return }

        // Ignore cancellation errors
        if (error as NSError).code == NSURLErrorCancelled { return }

        print("[DownloadManager] Download failed for book \(bookId)")
        print("[DownloadManager] Error: \(error.localizedDescription)")
        if let urlError = error as? URLError {
            print("[DownloadManager] URLError code: \(urlError.code.rawValue)")
        }
        if let response = task.response as? HTTPURLResponse {
            print("[DownloadManager] HTTP Status: \(response.statusCode)")
        }

        // Update PendingDownload status
        if let container = modelContainer {
            let context = ModelContext(container)
            let descriptor = FetchDescriptor<PendingDownload>(
                predicate: #Predicate { $0.id == bookId }
            )
            if let pending = try? context.fetch(descriptor).first {
                pending.status = "failed"
                pending.errorMessage = error.localizedDescription
                try? context.save()
            }
        }

        DispatchQueue.main.async {
            self.activeDownloads[bookId]?.state = .failed(error)
            HapticFeedback.error()
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async {
            self.appDelegate?.backgroundSessionCompletionHandler?()
            self.appDelegate?.backgroundSessionCompletionHandler = nil
            print("[DownloadManager] Background session events processed")
        }
    }
}
