//
//  DownloadManager.swift
//  Compendus
//
//  Handles downloading books for offline reading with background session support.
//  Downloads continue when the app is backgrounded or terminated.
//

import Foundation
import SwiftData
import CCReader
import CryptoKit
import PDFKit
import AVFoundation

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

enum DownloadError: LocalizedError {
    case insufficientStorage(required: Int64, available: Int64)
    case sizeMismatch(expected: Int64, actual: Int64)
    case checksumMismatch
    case invalidArtifact(String)

    var errorDescription: String? {
        switch self {
        case .insufficientStorage(let required, let available):
            let formatter = ByteCountFormatter()
            formatter.countStyle = .file
            let req = formatter.string(fromByteCount: required)
            let avail = formatter.string(fromByteCount: available)
            return "Not enough storage. This book requires \(req) but only \(avail) is available. Free up space or delete some downloads."
        case .sizeMismatch(let expected, let actual):
            return "The download was incomplete (expected \(expected) bytes, received \(actual))."
        case .checksumMismatch:
            return "The downloaded file failed its integrity check. Please retry it."
        case .invalidArtifact(let reason):
            return "The downloaded file could not be verified: \(reason)"
        }
    }
}

@Observable
class DownloadManager: NSObject {
    let config: ServerConfig
    let apiService: APIService

    private(set) var activeDownloads: [String: DownloadProgress] = [:]
    /// Whether a metadata sync is currently in progress.
    private(set) var isSyncingMetadata: Bool = false
    private(set) var isVerifyingLibrary: Bool = false
    private(set) var verificationTotal: Int = 0
    private(set) var verificationCompleted: Int = 0
    private(set) var verificationFailures: Int = 0
    private(set) var lastLibraryVerificationAt: Date?
    @ObservationIgnored private var _session: URLSession?
    @ObservationIgnored private var _foregroundSession: URLSession?

    /// Whether new downloads should use the foreground session instead of the
    /// background one. Always true on the Simulator, where the background-download
    /// daemon (`nsurlsessiond`) is unavailable and tasks fail immediately with
    /// `NSURLErrorUnknown` ("unknown error"). On device it flips to true only after
    /// a background task fails to set up, so we transparently recover.
    @ObservationIgnored private var preferForegroundSession: Bool = {
        #if targetEnvironment(simulator)
        return true
        #else
        return false
        #endif
    }()

    /// Book IDs already retried on the foreground session, to avoid retry loops.
    @ObservationIgnored private var foregroundRetriedBookIds: Set<String> = []

    /// Set by CompendusApp on appear for background session handling
    weak var appDelegate: AppDelegate?
    /// Set by CompendusApp on appear for creating ModelContexts in delegate callbacks
    var modelContainer: ModelContainer?
    /// Set by CompendusApp on appear for auto-queueing background generation
    weak var backgroundProcessingManager: BackgroundProcessingManager?
    /// Set by CompendusApp on appear for reading auto-generation settings
    weak var appSettings: AppSettings?
    /// Set by CompendusApp on appear for reading selected voice
    weak var kokoroModelManager: KokoroModelManager?

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
        NetworkSessionRegistry.shared.registerTransferSession(newSession)
        _session = newSession
        return newSession
    }

    /// Foreground fallback session (standard configuration) used when the
    /// background session's daemon is unavailable. Downloads here do not survive
    /// app termination, but they work where background sessions cannot.
    private var foregroundSession: URLSession {
        if let existing = _foregroundSession {
            return existing
        }
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForResource = 3600
        config.allowsCellularAccess = true
        let newSession = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        NetworkSessionRegistry.shared.registerTransferSession(newSession)
        _foregroundSession = newSession
        return newSession
    }

    /// The session new download tasks should be started on.
    private var downloadSession: URLSession {
        preferForegroundSession ? foregroundSession : session
    }

    /// Start a download task on the appropriate session.
    @discardableResult
    private func startDownloadTask(request: URLRequest, bookId: String, resumeData: Data? = nil) -> URLSessionDownloadTask {
        let task = resumeData.map { downloadSession.downloadTask(withResumeData: $0) }
            ?? downloadSession.downloadTask(with: request)
        task.taskDescription = bookId  // Persists across app termination (background session)
        if ConnectivityMonitor.shared.permitsNetworkRequests {
            task.resume()
        } else {
            task.suspend()
        }
        return task
    }

    init(config: ServerConfig, apiService: APIService) {
        self.config = config
        self.apiService = apiService
        super.init()
    }

    // MARK: - Public API

    /// Keep background URLSession from mutating files while the catalog is in
    /// recovery mode and cannot record a transactional completion.
    func suspendAllTransfersForDatabaseRecovery() {
        let suspend: (URLSession) -> Void = { session in
            session.getAllTasks { $0.forEach { $0.suspend() } }
        }
        suspend(session)
        if let foreground = _foregroundSession { suspend(foreground) }
    }

    /// Download a book for offline reading.
    /// The download runs in the background and completes even if the app is suspended.
    /// Returns the existing DownloadedBook if already downloaded, or nil if download was started.
    @MainActor
    func downloadBook(
        _ book: Book,
        modelContext: ModelContext,
        replacingExisting: Bool = false
    ) async throws -> DownloadedBook? {
        // Check if already downloaded
        let bookId = book.id
        let descriptor = FetchDescriptor<DownloadedBook>(
            predicate: #Predicate { $0.id == bookId }
        )
        if let existing = try? modelContext.fetch(descriptor).first, !replacingExisting {
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

        // Resolve the exact immutable artifact before queueing. This gives the
        // client the converted format, byte length, digest, and peak disk need.
        let manifest = try await apiService.fetchDownloadManifest(bookId: book.id)
        guard let downloadURL = URL(string: manifest.url, relativeTo: config.baseURL)?.absoluteURL else {
            throw APIError.invalidURL
        }
        let homeURL = URL(fileURLWithPath: NSHomeDirectory())
        let availableBytes = (try? homeURL.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]))?.volumeAvailableCapacityForImportantUsage ?? 0
        if manifest.peakDiskBytes > availableBytes {
            throw DownloadError.insufficientStorage(required: manifest.peakDiskBytes, available: availableBytes)
        }

        // Pre-fetch cover before starting download
        var coverData: Data? = nil
        if book.coverUrl != nil {
            coverData = try? await apiService.fetchCover(bookId: book.id)
        }

        // Persist download intent in SwiftData
        let pending = PendingDownload.from(book: book, manifest: manifest, downloadURL: downloadURL)
        pending.profileId = apiService.config.selectedProfileId ?? ""
        pending.status = "downloading"
        pending.coverData = coverData
        modelContext.insert(pending)
        try modelContext.save()

        // Initialize progress tracking
        let progress = DownloadProgress(
            id: book.id,
            progress: 0,
            bytesReceived: 0,
            totalBytes: manifest.byteLength,
            state: .downloading
        )
        activeDownloads[book.id] = progress

        // Start download task (background session, or foreground fallback)
        startDownloadTask(request: apiService.authenticatedRequest(for: downloadURL), bookId: book.id)

        return nil
    }

    /// Re-fetch and replace a damaged or missing artifact while preserving the
    /// existing book record, reading position, highlights, and review metadata.
    @MainActor
    func repairDownload(_ downloaded: DownloadedBook, modelContext: ModelContext) async throws {
        guard ConnectivityMonitor.shared.permitsNetworkRequests else { throw APIError.offline }
        let response = try await apiService.fetchBook(id: downloaded.id)
        _ = try await downloadBook(response.book, modelContext: modelContext, replacingExisting: true)
    }

    /// Download the converted EPUB version for a PDF book
    @MainActor
    func downloadEpubVersion(bookId: String, modelContext: ModelContext) async throws {
        guard ConnectivityMonitor.shared.permitsNetworkRequests else { throw APIError.offline }
        let descriptor = FetchDescriptor<DownloadedBook>(
            predicate: #Predicate { $0.id == bookId }
        )
        guard let downloadedBook = try? modelContext.fetch(descriptor).first else {
            throw APIError.invalidURL
        }
        guard downloadedBook.format.lowercased() != "epub" else {
            throw APIError.invalidURL
        }

        let manifest = try await apiService.fetchDownloadManifest(bookId: bookId, variant: "epub")
        guard let downloadURL = URL(string: manifest.url, relativeTo: config.baseURL)?.absoluteURL else {
            throw APIError.invalidURL
        }

        let progressId = "\(bookId)-epub"
        let progress = DownloadProgress(
            id: progressId,
            progress: 0,
            bytesReceived: 0,
            totalBytes: manifest.byteLength,
            state: .downloading
        )
        activeDownloads[progressId] = progress

        let (temporaryURL, response) = try await apiService.session.download(
            for: apiService.authenticatedRequest(for: downloadURL)
        )
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw APIError.serverError((response as? HTTPURLResponse)?.statusCode ?? 0, nil)
        }
        _ = try verifyArtifact(
            at: temporaryURL,
            expectedBytes: manifest.byteLength,
            expectedSHA256: manifest.sha256,
            format: "epub"
        )

        let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let installed = try installRegularArtifact(
            from: temporaryURL,
            bookId: bookId,
            format: "epub",
            documentsURL: documentsURL
        )

        let priorMetadata = (
            path: downloadedBook.epubLocalPath,
            hash: downloadedBook.epubArtifactSHA256,
            byteLength: downloadedBook.epubArtifactByteLength,
            verification: downloadedBook.epubVerificationStatus
        )
        downloadedBook.epubLocalPath = installed.localPath
        downloadedBook.epubArtifactSHA256 = manifest.sha256.lowercased()
        downloadedBook.epubArtifactByteLength = manifest.byteLength
        downloadedBook.epubVerificationStatus = "verified"
        do {
            try modelContext.save()
        } catch {
            rollbackInstall(
                destination: installed.destination,
                backup: installed.backup,
                journal: installed.journal
            )
            downloadedBook.epubLocalPath = priorMetadata.path
            downloadedBook.epubArtifactSHA256 = priorMetadata.hash
            downloadedBook.epubArtifactByteLength = priorMetadata.byteLength
            downloadedBook.epubVerificationStatus = priorMetadata.verification
            throw error
        }
        finishInstall(backup: installed.backup, journal: installed.journal)

        activeDownloads.removeValue(forKey: progressId)
    }

    /// Retry a failed download using the persisted PendingDownload metadata
    @MainActor
    func retryDownload(_ pending: PendingDownload, modelContext: ModelContext) {
        pending.status = "pending"
        pending.errorMessage = nil
        try? modelContext.save()
        Task { @MainActor in
            do {
                let manifest = try await apiService.fetchDownloadManifest(bookId: pending.bookId)
                guard let downloadURL = URL(string: manifest.url, relativeTo: config.baseURL)?.absoluteURL else {
                    throw APIError.invalidURL
                }
                let homeURL = URL(fileURLWithPath: NSHomeDirectory())
                let available = (try? homeURL.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]))?.volumeAvailableCapacityForImportantUsage ?? 0
                guard manifest.peakDiskBytes <= available else {
                    throw DownloadError.insufficientStorage(required: manifest.peakDiskBytes, available: available)
                }
                let canResume = pending.artifactId == manifest.artifactId
                let resumeData = canResume ? pending.resumeData : nil
                pending.artifactId = manifest.artifactId
                pending.expectedSHA256 = manifest.sha256.lowercased()
                pending.expectedByteLength = manifest.byteLength
                pending.peakDiskBytes = manifest.peakDiskBytes
                pending.artifactVersion = manifest.artifactVersion
                pending.ccdVersion = manifest.ccdVersion
                pending.format = manifest.format
                pending.originalFormat = manifest.originalFormat
                pending.downloadURL = downloadURL.absoluteString
                pending.fileSize = Int(manifest.byteLength)
                pending.resumeData = nil
                pending.status = "downloading"
                try modelContext.save()
                activeDownloads[pending.id] = DownloadProgress(
                    id: pending.id,
                    progress: 0,
                    bytesReceived: 0,
                    totalBytes: manifest.byteLength,
                    state: .downloading
                )
                startDownloadTask(
                    request: apiService.authenticatedRequest(for: downloadURL),
                    bookId: pending.id,
                    resumeData: resumeData
                )
            } catch {
                pending.status = "failed"
                pending.errorMessage = error.localizedDescription
                try? modelContext.save()
                activeDownloads[pending.id]?.state = .failed(error)
            }
        }
    }

    /// Remove failed downloads from activeDownloads that have been in a failed state
    /// for longer than the specified interval. Called periodically or on app foreground.
    @MainActor
    func cleanupStaleFailedDownloads() {
        let staleIds = activeDownloads.compactMap { id, progress -> String? in
            if case .failed = progress.state {
                return id
            }
            return nil
        }
        for id in staleIds {
            activeDownloads.removeValue(forKey: id)
        }
    }

    /// Retry all failed pending downloads. Call when network connectivity is restored.
    @MainActor
    func retryFailedDownloads(modelContext: ModelContext) {
        let descriptor = FetchDescriptor<PendingDownload>(
            predicate: #Predicate { $0.status == "failed" || $0.status == "interrupted" }
        )
        guard let failedDownloads = try? modelContext.fetch(descriptor), !failedDownloads.isEmpty else {
            return
        }

        for pending in failedDownloads {
            retryDownload(pending, modelContext: modelContext)
        }
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
            predicate: #Predicate { $0.status == "pending" || $0.status == "downloading" || $0.status == "failed" || $0.status == "interrupted" || $0.status == "verifying" || $0.status == "installing" }
        )
        if let remaining = try? modelContext.fetch(descriptor) {
            for pending in remaining {
                cancelDownload(bookId: pending.id, modelContext: modelContext)
            }
        }
    }

    /// Suspend URLSession tasks as well as application-level retry/sync traffic.
    /// Suspended tasks retain their partial bytes and resume when Offline Mode ends.
    @MainActor
    func setTransfersPausedForOfflineMode(_ paused: Bool, modelContext: ModelContext) {
        let updateSession: (URLSession) -> Void = { session in
            session.getAllTasks { tasks in
                for task in tasks {
                    if paused { task.suspend() } else { task.resume() }
                }
            }
        }
        updateSession(session)
        if let foreground = _foregroundSession { updateSession(foreground) }

        let descriptor = FetchDescriptor<PendingDownload>()
        if let pending = try? modelContext.fetch(descriptor) {
            for item in pending {
                if paused, ["pending", "downloading"].contains(item.status) {
                    item.status = "paused"
                    activeDownloads[item.id]?.state = .waiting
                } else if !paused, item.status == "paused" {
                    item.status = "downloading"
                    activeDownloads[item.id]?.state = .downloading
                }
            }
            try? modelContext.save()
        }
    }

    /// Cancel a download in progress
    @MainActor
    func cancelDownload(bookId: String, modelContext: ModelContext? = nil) {
        let cancelMatching: (URLSession) -> Void = { session in
            session.getAllTasks { tasks in
                for task in tasks where task.taskDescription == bookId {
                    task.cancel()
                }
            }
        }
        cancelMatching(session)
        if let foreground = _foregroundSession {
            cancelMatching(foreground)
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
        if let epubURL = book.epubFileURL { try? FileManager.default.removeItem(at: epubURL) }
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        for root in ["comic-cache", "tts-cache"] {
            try? FileManager.default.removeItem(at: documents.appendingPathComponent(root).appendingPathComponent(book.id))
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

    // MARK: - Background Session Reconnection

    /// Reconcile an install that was interrupted between the filesystem swap
    /// and the SwiftData commit. A surviving PendingDownload means the commit
    /// did not finish, so restore the last committed artifact; no pending row
    /// means the database commit won and only transaction debris remains.
    @MainActor
    func recoverInterruptedInstalls() {
        guard let container = modelContainer else { return }
        let fm = FileManager.default
        let documents = fm.urls(for: .documentDirectory, in: .userDomainMask).first!
        let documentsPrefix = documents.standardizedFileURL.path + "/"
        let staging = documents.appendingPathComponent(".download-staging", isDirectory: true)
        guard let entries = try? fm.contentsOfDirectory(
            at: staging,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) else { return }

        let context = ModelContext(container)
        var recovered = 0
        for journalURL in entries where journalURL.lastPathComponent.hasSuffix(".install-journal.json") {
            guard let data = try? Data(contentsOf: journalURL),
                  let journal = try? JSONDecoder().decode(InstallJournal.self, from: data) else {
                try? fm.removeItem(at: journalURL)
                continue
            }
            let destination = URL(fileURLWithPath: journal.destinationPath).standardizedFileURL
            guard destination.path.hasPrefix(documentsPrefix) else {
                try? fm.removeItem(at: journalURL)
                continue
            }
            let backup = journal.backupPath.map { URL(fileURLWithPath: $0).standardizedFileURL }
            guard backup == nil || backup!.path.hasPrefix(documentsPrefix) else {
                try? fm.removeItem(at: journalURL)
                continue
            }

            let bookId = journal.bookId
            let descriptor = FetchDescriptor<PendingDownload>(
                predicate: #Predicate { $0.id == bookId }
            )
            let pending = try? context.fetch(descriptor).first
            if let pending {
                do {
                    if let backup, fm.fileExists(atPath: backup.path) {
                        if fm.fileExists(atPath: destination.path) { try fm.removeItem(at: destination) }
                        try fm.moveItem(at: backup, to: destination)
                    } else if backup == nil, fm.fileExists(atPath: destination.path) {
                        try fm.removeItem(at: destination)
                    }
                } catch {
                    pending.status = "interrupted"
                    pending.errorMessage = "Installation recovery needs attention: \(error.localizedDescription)"
                    continue
                }
                pending.status = "interrupted"
                pending.errorMessage = "Installation was interrupted and safely rolled back. Retry to continue."
                recovered += 1
            } else if let backup {
                do {
                    if fm.fileExists(atPath: backup.path) { try fm.removeItem(at: backup) }
                } catch {
                    continue
                }
            }
            try? fm.removeItem(at: journalURL)
        }
        try? context.save()

        // Staging contains no URLSession resume data. Once journals have been
        // reconciled, ordinary remaining files are abandoned pre-journal
        // copies. Preserve journals/backups if recovery itself needs a retry.
        if let leftovers = try? fm.contentsOfDirectory(
            at: staging,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) {
            for url in leftovers where
                !url.lastPathComponent.hasSuffix(".install-journal.json") &&
                !url.lastPathComponent.hasSuffix(".install-backup") {
                try? fm.removeItem(at: url)
            }
        }
        if recovered > 0 {
            print("[DownloadManager] Recovered \(recovered) interrupted install(s)")
        }
    }

    /// Reconnect to any in-progress background downloads after app launch.
    func reconnectBackgroundSession() {
        session.getAllTasks { [weak self] tasks in
            guard let self = self else { return }

            DispatchQueue.main.async {
                for task in tasks {
                    guard let bookId = task.taskDescription else { continue }

                    if !ConnectivityMonitor.shared.permitsNetworkRequests {
                        task.suspend()
                    }

                    let taskIsSuspended = task.state == .suspended || !ConnectivityMonitor.shared.permitsNetworkRequests
                    let progress = DownloadProgress(
                        id: bookId,
                        progress: task.countOfBytesExpectedToReceive > 0
                            ? Double(task.countOfBytesReceived) / Double(task.countOfBytesExpectedToReceive)
                            : 0,
                        bytesReceived: task.countOfBytesReceived,
                        totalBytes: task.countOfBytesExpectedToReceive,
                        state: taskIsSuspended ? .waiting : .downloading
                    )
                    self.activeDownloads[bookId] = progress
                }

                if let container = self.modelContainer {
                    let context = ModelContext(container)
                    let taskIds = Set(tasks.compactMap(\.taskDescription))
                    let descriptor = FetchDescriptor<PendingDownload>()
                    if let pending = try? context.fetch(descriptor) {
                        for item in pending where taskIds.contains(item.id) {
                            if let task = tasks.first(where: { $0.taskDescription == item.id }), task.state == .suspended {
                                item.status = "paused"
                            }
                        }
                        for item in pending where
                            ["pending", "downloading", "paused", "verifying", "installing"].contains(item.status) &&
                            !taskIds.contains(item.id) {
                            item.status = "interrupted"
                            item.errorMessage = "The transfer was interrupted. Retry to continue."
                        }
                        try? context.save()
                    }
                }

                if !tasks.isEmpty {
                    print("[DownloadManager] Reconnected to \(tasks.count) in-progress download(s)")
                }
            }
        }
    }

    /// Verify that every database record is backed by a complete, readable local
    /// artifact. This performs no network requests and is safe in airplane mode.
    @MainActor
    func verifyAllDownloads(modelContext: ModelContext) async {
        let profileId = config.selectedProfileId ?? ""
        let descriptor = FetchDescriptor<DownloadedBook>(
            predicate: #Predicate { $0.profileId == profileId || $0.profileId.isEmpty }
        )
        guard let books = try? modelContext.fetch(descriptor) else { return }
        isVerifyingLibrary = true
        verificationTotal = books.count
        verificationCompleted = 0
        verificationFailures = 0
        defer { isVerifyingLibrary = false }

        for book in books {
            let url = book.fileURL
            let packDir = book.ccdPackDir
            let isPack = book.isReflowable
            let expectedHash = book.artifactSHA256
            let expectedBytes = Int64(book.fileSize)
            let format = book.format
            let result = await Task.detached(priority: .utility) {
                await Self.verifyInstalled(
                    url: url,
                    packDir: packDir,
                    isPack: isPack,
                    expectedHash: expectedHash,
                    expectedBytes: expectedBytes,
                    format: format
                )
            }.value
            var combinedResult = result
            if let epubURL = book.epubFileURL {
                let epubHash = book.epubArtifactSHA256
                let epubBytes = book.epubArtifactByteLength
                let epubResult = await Task.detached(priority: .utility) {
                    Self.verifyAlternateEPUB(
                        url: epubURL,
                        expectedHash: epubHash,
                        expectedBytes: epubBytes
                    )
                }.value
                book.epubVerificationStatus = epubResult
                if result == "verified", epubResult != "verified" {
                    combinedResult = epubResult
                }
            } else {
                book.epubVerificationStatus = nil
            }
            book.verificationStatus = combinedResult
            if combinedResult == "verified" {
                book.verifiedAt = Date()
            } else {
                verificationFailures += 1
            }
            verificationCompleted += 1
        }
        try? modelContext.save()
        lastLibraryVerificationAt = Date()
    }

    nonisolated private static func verifyAlternateEPUB(
        url: URL,
        expectedHash: String,
        expectedBytes: Int64
    ) -> String {
        do {
            guard FileManager.default.fileExists(atPath: url.path) else { return "missing" }
            let values = try url.resourceValues(forKeys: [.fileSizeKey])
            let actualBytes = Int64(values.fileSize ?? 0)
            if expectedBytes > 0, actualBytes != expectedBytes { return "corrupt" }
            if !expectedHash.isEmpty, try sha256File(url) != expectedHash.lowercased() { return "corrupt" }
            try CCDPack.validateEPUB(at: url)
            return "verified"
        } catch {
            return "corrupt"
        }
    }

    private static func verifyInstalled(
        url: URL?,
        packDir: URL?,
        isPack: Bool,
        expectedHash: String,
        expectedBytes: Int64,
        format: String
    ) async -> String {
        do {
            if isPack {
                guard let packDir, FileManager.default.fileExists(atPath: packDir.path) else { return "missing" }
                try CCDPack.validateInstalledPack(at: packDir)
                return "verified"
            }
            guard let url, FileManager.default.fileExists(atPath: url.path) else { return "missing" }
            let values = try url.resourceValues(forKeys: [.fileSizeKey])
            guard Int64(values.fileSize ?? 0) == expectedBytes else { return "corrupt" }
            if !expectedHash.isEmpty, try sha256File(url) != expectedHash.lowercased() { return "corrupt" }
            if format.lowercased() == "cbz" { try CCDPack.validateCBZ(at: url) }
            if format.lowercased() == "pdf" {
                guard let document = PDFDocument(url: url), document.pageCount > 0 else { return "corrupt" }
            }
            if ["m4b", "m4a", "mp3"].contains(format.lowercased()) {
                let asset = AVURLAsset(url: url)
                let playable = try await asset.load(.isPlayable)
                let duration = try await asset.load(.duration)
                guard playable && duration.seconds.isFinite && duration.seconds > 0 else { return "corrupt" }
            }
            return "verified"
        } catch {
            return "corrupt"
        }
    }

    nonisolated private static func sha256File(_ url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1024 * 1024), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    // MARK: - Metadata Sync

    private static let syncInterval: TimeInterval = 3600
    private static let lastSyncKey = "lastMetadataSyncTimestamp"
    /// Keep launch/refresh metadata reconciliation from flooding the server and
    /// URLSession connection pool for large offline libraries.
    private static let maxConcurrentMetadataRequests = 6

    @MainActor
    func syncDownloadedBooksMetadata(modelContext: ModelContext, force: Bool = false) async {
        guard config.isConfigured, let profileId = config.selectedProfileId else { return }
        let profileSyncKey = "\(Self.lastSyncKey)-\(profileId)"

        if !force {
            let lastSync = UserDefaults.standard.double(forKey: profileSyncKey)
            if lastSync > 0 && Date.now.timeIntervalSince1970 - lastSync < Self.syncInterval {
                return
            }
        }

        // Legacy unassigned downloads are visible to the selected profile until
        // the profile migration flow claims them, matching the rest of the app.
        let descriptor = FetchDescriptor<DownloadedBook>(
            predicate: #Predicate { $0.profileId == profileId || $0.profileId.isEmpty }
        )
        guard let downloadedBooks = try? modelContext.fetch(descriptor), !downloadedBooks.isEmpty else { return }
        let downloadedBooksById = Dictionary(
            downloadedBooks.map { ($0.id, $0) },
            uniquingKeysWith: { existing, candidate in
                candidate.profileId == profileId ? candidate : existing
            }
        )
        let bookIds = Array(downloadedBooksById.keys)

        isSyncingMetadata = true
        defer { isSyncingMetadata = false }

        print("[DownloadManager] Syncing metadata for \(bookIds.count) downloaded books")

        await withTaskGroup(of: (String, Book?, Data?).self) { group in
            var pendingBookIds = bookIds.makeIterator()

            func enqueue(_ bookId: String) {
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

            for _ in 0..<min(Self.maxConcurrentMetadataRequests, bookIds.count) {
                if let bookId = pendingBookIds.next() {
                    enqueue(bookId)
                }
            }

            while let (bookId, book, coverData) = await group.next() {
                guard let book = book,
                      let downloadedBook = downloadedBooksById[bookId] else {
                    if let nextBookId = pendingBookIds.next() {
                        enqueue(nextBookId)
                    }
                    continue
                }
                downloadedBook.updateMetadata(from: book, coverData: coverData)

                if let nextBookId = pendingBookIds.next() {
                    enqueue(nextBookId)
                }
            }
        }

        do {
            try modelContext.save()
            UserDefaults.standard.set(Date.now.timeIntervalSince1970, forKey: profileSyncKey)
            print("[DownloadManager] Metadata sync complete")
        } catch {
            print("[DownloadManager] Failed to save synced metadata: \(error.localizedDescription)")
        }
    }

    // MARK: - Auto Background Processing

    private func autoQueueBackgroundProcessing(bookId: String, format: String) {
        guard let manager = backgroundProcessingManager,
              let settings = appSettings else { return }

        let isEbook = ["epub", "mobi", "azw", "azw3"].contains(format)
        let isAudiobook = ["m4b", "mp3", "m4a"].contains(format)

        if isEbook && settings.autoGenerateTTS {
            guard let voiceManager = kokoroModelManager else {
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

    private func verifyArtifact(at url: URL, expectedBytes: Int64, expectedSHA256: String, format: String) throws -> Int {
        let values = try url.resourceValues(forKeys: [.fileSizeKey])
        let actualBytes = Int64(values.fileSize ?? 0)
        guard actualBytes == expectedBytes else {
            throw DownloadError.sizeMismatch(expected: expectedBytes, actual: actualBytes)
        }
        guard try sha256(of: url) == expectedSHA256.lowercased() else {
            throw DownloadError.checksumMismatch
        }
        switch format.lowercased() {
        case "pdf":
            let prefix = try FileHandle(forReadingFrom: url).read(upToCount: 5) ?? Data()
            guard prefix == Data("%PDF-".utf8) else { throw DownloadError.invalidArtifact("invalid PDF header") }
        case "cbz":
            try CCDPack.validateCBZ(at: url)
        case "epub":
            try CCDPack.validateEPUB(at: url)
        default:
            guard actualBytes > 0 else { throw DownloadError.invalidArtifact("empty file") }
        }
        return Int(actualBytes)
    }

    private func sha256(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1024 * 1024), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    /// Move a verified ordinary artifact through same-volume staging and into its
    /// final path. The returned closure removes the install if SwiftData commit fails.
    private struct RegularInstall {
        let localPath: String
        let destination: URL
        let backup: URL?
        let journal: URL
    }

    private struct InstallJournal: Codable {
        let bookId: String
        let destinationPath: String
        let backupPath: String?
    }

    private func beginInstallJournal(
        bookId: String,
        destination: URL,
        backup: URL?,
        documentsURL: URL
    ) throws -> URL {
        let stagingDir = documentsURL.appendingPathComponent(".download-staging", isDirectory: true)
        try FileManager.default.createDirectory(at: stagingDir, withIntermediateDirectories: true)
        // A random filename prevents an untrusted server-side identifier from
        // influencing the local path. The actual book ID lives in the payload.
        let journalURL = stagingDir.appendingPathComponent("\(UUID().uuidString).install-journal.json")
        let journal = InstallJournal(
            bookId: bookId,
            destinationPath: destination.path,
            backupPath: backup?.path
        )
        try JSONEncoder().encode(journal).write(to: journalURL, options: .atomic)
        return journalURL
    }

    private func rollbackInstall(destination: URL, backup: URL?, journal: URL) {
        let fm = FileManager.default
        do {
            if let backup, fm.fileExists(atPath: backup.path) {
                if fm.fileExists(atPath: destination.path) {
                    try fm.removeItem(at: destination)
                }
                try fm.moveItem(at: backup, to: destination)
            } else if backup == nil, fm.fileExists(atPath: destination.path) {
                try fm.removeItem(at: destination)
            }
            try? fm.removeItem(at: journal)
        } catch {
            // Keep the journal and backup so launch recovery can retry instead
            // of turning a transient filesystem error into data loss.
            print("[DownloadManager] Install rollback deferred to launch recovery: \(error)")
        }
    }

    private func finishInstall(backup: URL?, journal: URL) {
        if let backup { try? FileManager.default.removeItem(at: backup) }
        try? FileManager.default.removeItem(at: journal)
    }

    private func installRegularArtifact(from source: URL, bookId: String, format: String, documentsURL: URL) throws -> RegularInstall {
        let fm = FileManager.default
        let stagingDir = documentsURL.appendingPathComponent(".download-staging", isDirectory: true)
        try fm.createDirectory(at: stagingDir, withIntermediateDirectories: true)
        let staged = stagingDir.appendingPathComponent("\(UUID().uuidString).\(format)")
        try fm.moveItem(at: source, to: staged)
        let booksDir = documentsURL.appendingPathComponent("books", isDirectory: true)
        try fm.createDirectory(at: booksDir, withIntermediateDirectories: true)
        let destination = booksDir.appendingPathComponent("\(bookId).\(format)")
        let backup = fm.fileExists(atPath: destination.path)
            ? stagingDir.appendingPathComponent("\(UUID().uuidString).install-backup")
            : nil
        let journal = try beginInstallJournal(
            bookId: bookId,
            destination: destination,
            backup: backup,
            documentsURL: documentsURL
        )
        do {
            if let backup { try fm.moveItem(at: destination, to: backup) }
            try fm.moveItem(at: staged, to: destination)
        } catch {
            rollbackInstall(destination: destination, backup: backup, journal: journal)
            throw error
        }
        return RegularInstall(
            localPath: "books/\(bookId).\(format)",
            destination: destination,
            backup: backup,
            journal: journal
        )
    }
}

// MARK: - URLSessionDownloadDelegate

extension DownloadManager: URLSessionDownloadDelegate {
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let bookId = downloadTask.taskDescription else { return }

        // A download task writes the response body to disk even for error
        // responses (e.g. a 404/500 JSON error from the CCD pack endpoint when a
        // book isn't ready). Treating that as a successful file produces a
        // confusing unzip failure downstream, so reject non-2xx responses here.
        if let http = downloadTask.response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            print("[DownloadManager] Download for \(bookId) returned HTTP \(http.statusCode)")
            let error = NSError(domain: "DownloadManager", code: http.statusCode, userInfo: [
                NSLocalizedDescriptionKey: "The server couldn't provide this book (HTTP \(http.statusCode)). It may still be processing — try again later."
            ])
            DispatchQueue.main.async { self.markDownloadFailed(bookId: bookId, error: error) }
            return
        }

        guard let container = modelContainer else {
            print("[DownloadManager] No model container available for background completion")
            return
        }

        // Read pending download data on background context and snapshot all properties
        // immediately, before any context changes can detach the object.
        let bgContext = ModelContext(container)

        let descriptor = FetchDescriptor<PendingDownload>(
            predicate: #Predicate { $0.id == bookId }
        )
        guard let pending = try? bgContext.fetch(descriptor).first else {
            print("[DownloadManager] No PendingDownload found for \(bookId)")
            return
        }

        // Snapshot all properties while the background context is still alive.
        // [String] (authors) is a transformable attribute that requires fault resolution,
        // so we must read it here before the object can be detached.
        let pendingFormat = pending.format
        let pendingOriginalFormat = pending.originalFormat
        let pendingCoverData = pending.coverData
        let pendingBookId = pending.bookId
        let pendingTitle = pending.title
        let pendingAuthors = pending.authors
        let pendingSubtitle = pending.subtitle
        let pendingPublisher = pending.publisher
        let pendingPublishedDate = pending.publishedDate
        let pendingBookDescription = pending.bookDescription
        let pendingSeries = pending.series
        let pendingSeriesNumber = pending.seriesNumber
        let pendingDuration = pending.duration
        let pendingNarrator = pending.narrator
        let pendingChaptersData = pending.chaptersData
        let pendingPageCount = pending.pageCount
        let pendingProfileId = pending.profileId
        let pendingArtifactId = pending.artifactId
        let pendingExpectedSHA256 = pending.expectedSHA256
        let pendingExpectedByteLength = pending.expectedByteLength
        let pendingArtifactVersion = pending.artifactVersion
        let pendingCcdVersion = pending.ccdVersion
        pending.status = "verifying"
        try? bgContext.save()

        do {
            // File operations must happen synchronously on this thread
            let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!

            let localPath: String
            let storedFormat: String
            let actualFileSize: Int
            let installedURL: URL
            var replacedFileBackup: URL?
            var replacedDirectoryBackup: URL?
            var installJournalURL: URL?

            actualFileSize = try verifyArtifact(
                at: location,
                expectedBytes: pendingExpectedByteLength,
                expectedSHA256: pendingExpectedSHA256,
                format: pendingFormat
            )
            pending.status = "installing"
            try? bgContext.save()

            if pendingFormat.lowercased() == "ccdpack" {
                // Reflowable ebook: the download is a CCD pack ZIP. Unpack it into
                // the stable per-book pack dir; no raw .epub is ever stored.
                let packDir = documentsURL
                    .appendingPathComponent("ccd-packs", isDirectory: true)
                    .appendingPathComponent(bookId, isDirectory: true)
                let stagingDir = documentsURL.appendingPathComponent(".download-staging", isDirectory: true)
                try FileManager.default.createDirectory(at: stagingDir, withIntermediateDirectories: true)
                if FileManager.default.fileExists(atPath: packDir.path) {
                    replacedDirectoryBackup = stagingDir
                        .appendingPathComponent("\(UUID().uuidString).install-backup", isDirectory: true)
                }
                installJournalURL = try beginInstallJournal(
                    bookId: bookId,
                    destination: packDir,
                    backup: replacedDirectoryBackup,
                    documentsURL: documentsURL
                )
                do {
                    if let replacedDirectoryBackup {
                        try FileManager.default.moveItem(at: packDir, to: replacedDirectoryBackup)
                    }
                    try CCDPack.install(zipURL: location, into: packDir)
                } catch {
                    if let installJournalURL {
                        rollbackInstall(
                            destination: packDir,
                            backup: replacedDirectoryBackup,
                            journal: installJournalURL
                        )
                    }
                    throw error
                }
                try? FileManager.default.removeItem(at: location)
                // localPath is a marker pointing at the pack dir (the reader derives
                // the manifest/resources paths from the book id).
                localPath = "ccd-packs/\(bookId)"
                storedFormat = pendingOriginalFormat.isEmpty ? "epub" : pendingOriginalFormat.lowercased()
                installedURL = packDir
            } else {
                let installed = try installRegularArtifact(
                    from: location,
                    bookId: bookId,
                    format: pendingFormat,
                    documentsURL: documentsURL
                )
                localPath = installed.localPath
                installedURL = installed.destination
                replacedFileBackup = installed.backup
                installJournalURL = installed.journal
                storedFormat = pendingFormat
            }

            let format = storedFormat.lowercased()

            // Perform SwiftData mutations on the main thread so @Query updates
            // atomically and PendingDownload objects are never detached mid-render.
            DispatchQueue.main.async {
                let mainContext = ModelContext(container)

                let existingDescriptor = FetchDescriptor<DownloadedBook>(
                    predicate: #Predicate { $0.id == bookId }
                )
                let downloadedBook: DownloadedBook
                var supersededURL: URL?
                if let existing = try? mainContext.fetch(existingDescriptor).first {
                    downloadedBook = existing
                    let oldURL = documentsURL.appendingPathComponent(existing.localPath)
                    if oldURL.standardizedFileURL != installedURL.standardizedFileURL {
                        supersededURL = oldURL
                    }
                    existing.title = pendingTitle
                    existing.subtitle = pendingSubtitle
                    existing.authors = pendingAuthors
                    existing.publisher = pendingPublisher
                    existing.publishedDate = pendingPublishedDate
                    existing.bookDescription = pendingBookDescription
                    existing.format = storedFormat
                    existing.fileSize = actualFileSize
                    existing.localPath = localPath
                    existing.coverData = pendingCoverData ?? existing.coverData
                    existing.series = pendingSeries
                    existing.seriesNumber = pendingSeriesNumber
                    existing.duration = pendingDuration
                    existing.narrator = pendingNarrator
                    existing.chaptersData = pendingChaptersData
                    existing.pageCount = pendingPageCount
                    existing.profileId = pendingProfileId
                } else {
                    downloadedBook = DownloadedBook(
                        id: pendingBookId,
                        title: pendingTitle,
                        subtitle: pendingSubtitle,
                        authors: pendingAuthors,
                        publisher: pendingPublisher,
                        publishedDate: pendingPublishedDate,
                        bookDescription: pendingBookDescription,
                        format: storedFormat,
                        fileSize: actualFileSize,
                        localPath: localPath,
                        coverData: pendingCoverData,
                        series: pendingSeries,
                        seriesNumber: pendingSeriesNumber,
                        duration: pendingDuration,
                        narrator: pendingNarrator,
                        chaptersData: pendingChaptersData,
                        pageCount: pendingPageCount,
                        profileId: pendingProfileId
                    )
                    mainContext.insert(downloadedBook)
                }
                downloadedBook.artifactId = pendingArtifactId
                downloadedBook.artifactSHA256 = pendingExpectedSHA256
                downloadedBook.artifactVersion = pendingArtifactVersion
                downloadedBook.ccdVersion = pendingCcdVersion
                downloadedBook.ccdStatus = pendingFormat.lowercased() == "ccdpack" ? "ready" : nil
                downloadedBook.verificationStatus = "verified"
                downloadedBook.verifiedAt = Date()

                // Delete the PendingDownload from the main context
                let deleteDescriptor = FetchDescriptor<PendingDownload>(
                    predicate: #Predicate { $0.id == bookId }
                )
                if let pendingToDelete = try? mainContext.fetch(deleteDescriptor).first {
                    mainContext.delete(pendingToDelete)
                }

                do {
                    try mainContext.save()
                } catch {
                    print("[DownloadManager] Failed to save completed download for \(bookId): \(error)")
                    if let installJournalURL {
                        self.rollbackInstall(
                            destination: installedURL,
                            backup: replacedFileBackup ?? replacedDirectoryBackup,
                            journal: installJournalURL
                        )
                    }
                    self.markDownloadFailed(bookId: bookId, error: error)
                    return
                }

                if let installJournalURL {
                    self.finishInstall(
                        backup: replacedFileBackup ?? replacedDirectoryBackup,
                        journal: installJournalURL
                    )
                }
                if let supersededURL {
                    try? FileManager.default.removeItem(at: supersededURL)
                }

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

            DispatchQueue.main.async {
                let mainContext = ModelContext(container)
                let failDescriptor = FetchDescriptor<PendingDownload>(
                    predicate: #Predicate { $0.id == bookId }
                )
                if let pendingToFail = try? mainContext.fetch(failDescriptor).first {
                    pendingToFail.status = "failed"
                    pendingToFail.errorMessage = error.localizedDescription
                    try? mainContext.save()
                }

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

        // The background-download daemon (nsurlsessiond) can be unavailable —
        // notably in the Simulator — failing the task immediately with
        // NSURLErrorUnknown ("unknown error") before any request goes out. When
        // that happens, transparently retry the download once on a foreground
        // session instead of surfacing the cryptic failure to the user.
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain,
           nsError.code == NSURLErrorUnknown,
           !preferForegroundSession,
           !foregroundRetriedBookIds.contains(bookId) {
            foregroundRetriedBookIds.insert(bookId)
            preferForegroundSession = true
            print("[DownloadManager] Background session unavailable; retrying \(bookId) on foreground session")
            DispatchQueue.main.async {
                guard let container = self.modelContainer else {
                    self.markDownloadFailed(bookId: bookId, error: error)
                    return
                }
                let ctx = ModelContext(container)
                let descriptor = FetchDescriptor<PendingDownload>(
                    predicate: #Predicate { $0.id == bookId }
                )
                guard let pending = try? ctx.fetch(descriptor).first,
                      let url = URL(string: pending.downloadURL) else {
                    self.markDownloadFailed(bookId: bookId, error: error)
                    return
                }
                pending.status = "downloading"
                pending.errorMessage = nil
                try? ctx.save()
                self.activeDownloads[bookId]?.state = .downloading
                let request = self.apiService.authenticatedRequest(for: url)
                self.startDownloadTask(request: request, bookId: bookId)
            }
            return
        }

        // Update PendingDownload status on main thread to avoid detaching
        // objects from the context while @Query still holds references
        let resumeData = (error as NSError).userInfo[NSURLSessionDownloadTaskResumeData] as? Data
        DispatchQueue.main.async {
            self.markDownloadFailed(bookId: bookId, error: error, interrupted: resumeData != nil, resumeData: resumeData)
        }
    }

    /// Mark a download as failed and surface the error to the UI. Must be called
    /// on the main thread.
    private func markDownloadFailed(bookId: String, error: Error, interrupted: Bool = false, resumeData: Data? = nil) {
        if let container = self.modelContainer {
            let mainContext = ModelContext(container)
            let descriptor = FetchDescriptor<PendingDownload>(
                predicate: #Predicate { $0.id == bookId }
            )
            if let pending = try? mainContext.fetch(descriptor).first {
                pending.status = interrupted ? "interrupted" : "failed"
                pending.errorMessage = error.localizedDescription
                pending.resumeData = resumeData
                try? mainContext.save()
            }
        }

        self.activeDownloads[bookId]?.state = .failed(error)
        HapticFeedback.error()
    }

    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
           let serverTrust = challenge.protectionSpace.serverTrust,
           LocalNetworkSessionDelegate.isLocalNetworkHost(challenge.protectionSpace.host) {
            completionHandler(.useCredential, URLCredential(trust: serverTrust))
        } else {
            completionHandler(.performDefaultHandling, nil)
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
