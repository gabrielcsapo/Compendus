//
//  BackgroundProcessingManager.swift
//  Compendus
//
//  Unified queue for background processing tasks (Whisper transcription
//  and TTS pre-generation). Ensures mutual exclusion — only one heavy
//  ML task runs at a time — and supports charging-aware scheduling.
//

import Foundation
import BackgroundTasks
import SwiftData
import UIKit
import os.log

private let logger = Logger(subsystem: "com.compendus.background", category: "ProcessingManager")

@MainActor
@Observable
class BackgroundProcessingManager {

    // MARK: - Task Definition

    enum ProcessingTask: Codable, Equatable {
        case transcription(bookId: String)
        case ttsGeneration(bookId: String, voiceId: Int)

        var bookId: String {
            switch self {
            case .transcription(let id): return id
            case .ttsGeneration(let id, _): return id
            }
        }

        var displayName: String {
            switch self {
            case .transcription: return "Transcription"
            case .ttsGeneration: return "Read-Along Generation"
            }
        }
    }

    // MARK: - State

    enum ManagerState: Equatable {
        case idle
        case processing(task: ProcessingTask, progress: Double, message: String)
    }

    var state: ManagerState = .idle

    /// Tasks waiting to be processed, persisted across app launches.
    var pendingTasks: [ProcessingTask] {
        didSet { savePendingTasks() }
    }

    var isProcessing: Bool {
        if case .processing = state { return true }
        return false
    }

    // MARK: - Dependencies

    var modelContainer: ModelContainer?
    private weak var transcriptionService: OnDeviceTranscriptionService?
    private weak var ttsPreGenerationService: TTSPreGenerationService?
    private weak var ttsAudioCache: TTSAudioCache?
    private weak var pocketTTSModelManager: PocketTTSModelManager?
    private weak var appSettings: AppSettings?

    @ObservationIgnored private var observationTask: Task<Void, Never>?
    @ObservationIgnored private var backgroundTaskID: UIBackgroundTaskIdentifier = .invalid

    // MARK: - Initialization

    init() {
        self.pendingTasks = Self.loadPendingTasks()
    }

    /// Configure dependencies. Called from CompendusApp after init.
    func configure(
        transcriptionService: OnDeviceTranscriptionService,
        ttsPreGenerationService: TTSPreGenerationService,
        ttsAudioCache: TTSAudioCache,
        pocketTTSModelManager: PocketTTSModelManager,
        appSettings: AppSettings,
        modelContainer: ModelContainer
    ) {
        self.transcriptionService = transcriptionService
        self.ttsPreGenerationService = ttsPreGenerationService
        self.ttsAudioCache = ttsAudioCache
        self.pocketTTSModelManager = pocketTTSModelManager
        self.appSettings = appSettings
        self.modelContainer = modelContainer
    }

    // MARK: - Task Queue API

    /// Add a task to the processing queue.
    /// Priority tasks go to the front of the queue.
    func enqueue(_ task: ProcessingTask, priority: Bool = false) {
        // Don't add duplicates
        guard !pendingTasks.contains(task) else {
            logger.info("Task already queued: \(task.displayName) for \(task.bookId)")
            return
        }

        // Don't queue if already processing this exact task
        if case .processing(let current, _, _) = state, current == task {
            logger.info("Task already processing: \(task.displayName) for \(task.bookId)")
            return
        }

        if priority {
            pendingTasks.insert(task, at: 0)
        } else {
            pendingTasks.append(task)
        }

        logger.info("Enqueued \(task.displayName) for \(task.bookId) (queue size: \(self.pendingTasks.count))")

        // Start processing if idle
        if !isProcessing {
            processNextTask()
        }
    }

    /// Remove a task from the queue (if not already processing).
    func dequeue(_ task: ProcessingTask) {
        pendingTasks.removeAll { $0 == task }
    }

    /// Cancel the currently processing task and clear queue.
    func cancelAll() {
        transcriptionService?.cancel()
        ttsPreGenerationService?.cancel()
        pendingTasks.removeAll()
        state = .idle
        logger.info("All background tasks cancelled")
    }

    /// Cancel a specific task.
    func cancel(_ task: ProcessingTask) {
        // If it's the active task, cancel it
        if case .processing(let current, _, _) = state, current == task {
            switch task {
            case .transcription:
                transcriptionService?.cancel()
            case .ttsGeneration:
                ttsPreGenerationService?.cancel()
            }
            state = .idle
            processNextTask()
        } else {
            dequeue(task)
        }
    }

    /// Check if a task is queued or in progress.
    func isQueued(_ task: ProcessingTask) -> Bool {
        if case .processing(let current, _, _) = state, current == task {
            return true
        }
        return pendingTasks.contains(task)
    }

    // MARK: - Task Processing

    private func processNextTask() {
        guard !isProcessing, let task = pendingTasks.first else { return }
        pendingTasks.removeFirst()

        logger.info("Starting \(task.displayName) for \(task.bookId)")

        switch task {
        case .transcription(let bookId):
            startTranscription(bookId: bookId, task: task)
        case .ttsGeneration(let bookId, let voiceId):
            startTTSGeneration(bookId: bookId, voiceId: voiceId, task: task)
        }
    }

    private func startTranscription(bookId: String, task: ProcessingTask) {
        guard let service = transcriptionService,
              let modelContainer = modelContainer else {
            logger.error("Transcription service or model container not available, re-queuing task")
            pendingTasks.insert(task, at: 0)
            state = .idle
            return
        }

        state = .processing(task: task, progress: 0, message: "Preparing transcription...")

        // Load the book and start transcription
        Task {
            let context = ModelContext(modelContainer)
            let descriptor = FetchDescriptor<DownloadedBook>(
                predicate: #Predicate { $0.id == bookId }
            )
            guard let book = try? context.fetch(descriptor).first,
                  let fileURL = book.fileURL else {
                logger.error("Book \(bookId) not found for transcription")
                state = .idle
                processNextTask()
                return
            }

            let duration = Double(book.duration ?? 0)
            service.transcribe(
                fileURL: fileURL,
                duration: duration,
                bookId: book.id,
                title: book.title,
                coverData: book.coverData
            )

            // Monitor transcription service state
            startObservingTranscription(task: task)
        }
    }

    private func startTTSGeneration(bookId: String, voiceId: Int, task: ProcessingTask) {
        guard let service = ttsPreGenerationService,
              let cache = ttsAudioCache,
              let modelContainer = modelContainer else {
            logger.error("TTS service or dependencies not available, re-queuing task")
            pendingTasks.insert(task, at: 0)
            state = .idle
            return
        }

        state = .processing(task: task, progress: 0, message: "Preparing TTS generation...")

        Task {
            let context = ModelContext(modelContainer)
            let descriptor = FetchDescriptor<DownloadedBook>(
                predicate: #Predicate { $0.id == bookId }
            )
            guard let book = try? context.fetch(descriptor).first else {
                logger.error("Book \(bookId) not found for TTS generation")
                state = .idle
                processNextTask()
                return
            }

            // Create a PocketTTS context for generation
            guard let modelDir = PocketTTSModelManager.findModelDirectory() else {
                logger.error("PocketTTS model not found, re-queuing task")
                self.pendingTasks.insert(task, at: 0)
                self.state = .idle
                return
            }

            do {
                let ttsContext = try PocketTTSContext(modelPath: modelDir, voiceIndex: UInt32(voiceId))
                service.generateForBook(
                    book,
                    voiceId: voiceId,
                    ttsContext: ttsContext,
                    cache: cache,
                    modelContainer: modelContainer
                )

                // Monitor generation service state
                startObservingTTSGeneration(task: task)
            } catch {
                logger.error("Failed to create TTS context: \(error)")
                self.pendingTasks.insert(task, at: 0)
                self.state = .idle
            }
        }
    }

    // MARK: - State Observation

    private func startObservingTranscription(task: ProcessingTask) {
        observationTask?.cancel()
        observationTask = Task { [weak self] in
            guard let self = self, let service = self.transcriptionService else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(500))
                guard !Task.isCancelled else { return }

                switch service.state {
                case .transcribing(let progress, let message):
                    self.state = .processing(task: task, progress: progress, message: message)
                case .completed:
                    logger.info("Transcription completed for \(task.bookId)")
                    self.state = .idle
                    self.processNextTask()
                    return
                case .error(let msg):
                    logger.error("Transcription failed: \(msg)")
                    self.state = .idle
                    self.processNextTask()
                    return
                case .idle:
                    self.state = .idle
                    self.processNextTask()
                    return
                default:
                    break
                }
            }
        }
    }

    private func startObservingTTSGeneration(task: ProcessingTask) {
        observationTask?.cancel()
        observationTask = Task { [weak self] in
            guard let self = self, let service = self.ttsPreGenerationService else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(500))
                guard !Task.isCancelled else { return }

                switch service.state {
                case .generating(let progress, let message):
                    self.state = .processing(task: task, progress: progress, message: message)
                case .completed:
                    logger.info("TTS generation completed for \(task.bookId)")
                    self.state = .idle
                    self.processNextTask()
                    return
                case .error(let msg):
                    logger.error("TTS generation failed: \(msg)")
                    self.state = .idle
                    self.processNextTask()
                    return
                case .idle:
                    self.state = .idle
                    self.processNextTask()
                    return
                }
            }
        }
    }

    // MARK: - Background Task Lifecycle

    func handleAppBackgrounded() {
        guard isProcessing else { return }

        // Request background execution time
        backgroundTaskID = UIApplication.shared.beginBackgroundTask { [weak self] in
            Task { @MainActor [weak self] in
                self?.ttsPreGenerationService?.saveProgressToDisk()
                self?.endBackgroundTask()
            }
        }

        scheduleBackgroundTask()
    }

    func handleAppForegrounded() {
        endBackgroundTask()

        // Resume processing if we have pending tasks and nothing is running
        if !isProcessing && !pendingTasks.isEmpty {
            processNextTask()
        }
    }

    private func endBackgroundTask() {
        if backgroundTaskID != .invalid {
            UIApplication.shared.endBackgroundTask(backgroundTaskID)
            backgroundTaskID = .invalid
        }
    }

    private func scheduleBackgroundTask() {
        let request = BGProcessingTaskRequest(identifier: TTSPreGenerationService.backgroundTaskIdentifier)
        request.requiresExternalPower = appSettings?.backgroundProcessingChargingOnly ?? true
        request.requiresNetworkConnectivity = false

        do {
            try BGTaskScheduler.shared.submit(request)
            logger.info("Scheduled background TTS generation task")
        } catch {
            logger.error("Failed to schedule background task: \(error)")
        }
    }

    static func registerBackgroundTasks(manager: BackgroundProcessingManager) {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: TTSPreGenerationService.backgroundTaskIdentifier,
            using: nil
        ) { task in
            guard let processingTask = task as? BGProcessingTask else {
                task.setTaskCompleted(success: false)
                return
            }
            Task { @MainActor in
                manager.handleBackgroundProcessingTask(processingTask)
            }
        }
    }

    private func handleBackgroundProcessingTask(_ task: BGProcessingTask) {
        task.expirationHandler = { [weak self] in
            Task { @MainActor [weak self] in
                self?.ttsPreGenerationService?.saveProgressToDisk()
                self?.scheduleBackgroundTask()
                task.setTaskCompleted(success: false)
            }
        }

        // Resume or start processing
        if !isProcessing && !pendingTasks.isEmpty {
            processNextTask()
        }

        // If nothing to do, complete immediately
        if !isProcessing && pendingTasks.isEmpty {
            task.setTaskCompleted(success: true)
            return
        }

        // The task will complete when the generation finishes
        observationTask?.cancel()
        observationTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                guard let self = self else { return }
                if !self.isProcessing {
                    task.setTaskCompleted(success: true)
                    return
                }
            }
        }
    }

    // MARK: - Persistence

    private static let pendingTasksKey = "BackgroundProcessingManager.pendingTasks"

    private func savePendingTasks() {
        guard let data = try? JSONEncoder().encode(pendingTasks) else { return }
        UserDefaults.standard.set(data, forKey: Self.pendingTasksKey)
    }

    private static func loadPendingTasks() -> [ProcessingTask] {
        guard let data = UserDefaults.standard.data(forKey: pendingTasksKey) else { return [] }
        return (try? JSONDecoder().decode([ProcessingTask].self, from: data)) ?? []
    }
}
