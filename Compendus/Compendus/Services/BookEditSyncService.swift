//
//  BookEditSyncService.swift
//  Compendus
//
//  Background sync service for queued book edits (offline support)
//

import Foundation
import SwiftData
import BackgroundTasks
import UIKit

@Observable
@MainActor
class BookEditSyncService {
    static let backgroundTaskIdentifier = "com.compendus.edit-sync"

    let apiService: APIService
    var modelContainer: ModelContainer?
    var hasPendingEdits = false
    private(set) var isSyncing = false

    init(apiService: APIService) {
        self.apiService = apiService
    }

    // MARK: - Background Task Registration

    nonisolated static func registerBackgroundTask(service: BookEditSyncService) {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: backgroundTaskIdentifier,
            using: nil
        ) { task in
            guard let refreshTask = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            Task { @MainActor in
                service.handleBackgroundTask(refreshTask)
            }
        }
    }

    // MARK: - Lifecycle

    func handleAppForegrounded() {
        guard let modelContainer else { return }
        Task {
            await processPendingEdits(container: modelContainer)
        }
    }

    func scheduleBackgroundTaskIfNeeded() {
        guard hasPendingEdits else { return }

        let request = BGAppRefreshTaskRequest(identifier: Self.backgroundTaskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 5 * 60) // 5 minutes

        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            print("[EditSync] Failed to schedule background task: \(error)")
        }
    }

    // MARK: - Sync Logic

    /// Queue a pending edit and try to sync immediately
    func queueAndSync(_ edit: PendingBookEdit, modelContext: ModelContext) {
        modelContext.insert(edit)
        try? modelContext.save()
        hasPendingEdits = true

        Task {
            await processPendingEditsWithContext(modelContext)
        }
    }

    /// Process all pending edits, syncing each to the server
    @discardableResult
    func processPendingEdits(container: ModelContainer) async -> Bool {
        let context = ModelContext(container)
        return await processPendingEditsWithContext(context)
    }

    @discardableResult
    func processPendingEditsWithContext(_ modelContext: ModelContext) async -> Bool {
        guard !isSyncing else { return false }
        isSyncing = true
        defer {
            isSyncing = false
            updatePendingStatus(modelContext: modelContext)
        }

        let pid = apiService.config.selectedProfileId ?? ""
        let descriptor = FetchDescriptor<PendingBookEdit>(
            predicate: #Predicate { $0.profileId == pid || $0.profileId.isEmpty },
            sortBy: [SortDescriptor(\.createdAt, order: .forward)]
        )
        guard let pendingEdits = try? modelContext.fetch(descriptor), !pendingEdits.isEmpty else {
            hasPendingEdits = false
            return true
        }

        for edit in pendingEdits {
            do {
                try await processEdit(edit, modelContext: modelContext)
                modelContext.delete(edit)
                try? modelContext.save()
            } catch let error as APIError {
                switch error {
                case .networkError:
                    // Network unavailable — stop processing, try again later
                    edit.retryCount += 1
                    try? modelContext.save()
                    scheduleBackgroundTaskIfNeeded()
                    return false
                case .serverNotConfigured:
                    // Can't sync without server — stop
                    return false
                default:
                    // Server error (4xx/5xx) — skip this edit to avoid infinite retries
                    if edit.retryCount >= 3 {
                        modelContext.delete(edit)
                        try? modelContext.save()
                    } else {
                        edit.retryCount += 1
                        try? modelContext.save()
                    }
                }
            } catch {
                // Unknown error — treat as network issue
                edit.retryCount += 1
                try? modelContext.save()
                scheduleBackgroundTaskIfNeeded()
                return false
            }
        }

        return true
    }

    // MARK: - Process Individual Edit

    private func processEdit(_ edit: PendingBookEdit, modelContext: ModelContext) async throws {
        switch edit.operationType {
        case "metadata":
            let request = try JSONDecoder().decode(UpdateBookRequest.self, from: edit.payload)
            let response = try await apiService.updateBook(id: edit.bookId, updates: request)
            updateLocalBook(bookId: edit.bookId, serverBook: response.book, modelContext: modelContext)

        case "addTag":
            let payload = try JSONDecoder().decode([String: String].self, from: edit.payload)
            guard let name = payload["name"] else { return }
            _ = try await apiService.addTag(bookId: edit.bookId, name: name)

        case "removeTag":
            let payload = try JSONDecoder().decode([String: String].self, from: edit.payload)
            guard let tagId = payload["tagId"] else { return }
            try await apiService.removeTag(bookId: edit.bookId, tagId: tagId)

        default:
            break
        }
    }

    private func updateLocalBook(bookId: String, serverBook: Book, modelContext: ModelContext) {
        let pid = apiService.config.selectedProfileId ?? ""
        let descriptor = FetchDescriptor<DownloadedBook>(
            predicate: #Predicate { $0.id == bookId && ($0.profileId == pid || $0.profileId.isEmpty) }
        )
        if let downloadedBook = try? modelContext.fetch(descriptor).first {
            downloadedBook.updateMetadata(from: serverBook)
            try? modelContext.save()
        }
    }

    // MARK: - Background Task Handler

    private func handleBackgroundTask(_ task: BGAppRefreshTask) {
        task.expirationHandler = { [weak self] in
            Task { @MainActor [weak self] in
                self?.scheduleBackgroundTaskIfNeeded()
            }
        }

        guard let modelContainer else {
            task.setTaskCompleted(success: false)
            return
        }

        Task {
            let success = await processPendingEdits(container: modelContainer)
            task.setTaskCompleted(success: success)
            if hasPendingEdits {
                scheduleBackgroundTaskIfNeeded()
            }
        }
    }

    private func updatePendingStatus(modelContext: ModelContext) {
        let pid = apiService.config.selectedProfileId ?? ""
        let descriptor = FetchDescriptor<PendingBookEdit>(
            predicate: #Predicate { $0.profileId == pid || $0.profileId.isEmpty }
        )
        let count = (try? modelContext.fetchCount(descriptor)) ?? 0
        hasPendingEdits = count > 0
    }
}
