//
//  SyncService.swift
//  Compendus
//
//  Bidirectional sync service for reading progress, highlights, bookmarks,
//  and reading sessions between local SwiftData and the Compendus server.
//

import Foundation
import SwiftData
import BackgroundTasks
import UIKit

@Observable
@MainActor
class SyncService {
    static let backgroundTaskIdentifier = "com.compendus.data-sync"

    let apiService: APIService
    var modelContainer: ModelContainer?
    private(set) var isSyncing = false

    init(apiService: APIService) {
        self.apiService = apiService
    }

    // MARK: - Per-Profile Last Sync Time

    private func lastSyncKey(for profileId: String) -> String {
        // v3: reset after fixing updatedAt conflict bug
        "lastSyncTimestamp-v3-\(profileId)"
    }

    func lastSyncTime(for profileId: String) -> Date? {
        UserDefaults.standard.object(forKey: lastSyncKey(for: profileId)) as? Date
    }

    private func setLastSyncTime(_ date: Date, for profileId: String) {
        UserDefaults.standard.set(date, forKey: lastSyncKey(for: profileId))
    }

    // MARK: - Background Task Registration

    nonisolated static func registerBackgroundTask(service: SyncService) {
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
            await sync(container: modelContainer)
        }
    }

    func scheduleBackgroundTask() {
        let request = BGAppRefreshTaskRequest(identifier: Self.backgroundTaskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60) // 15 minutes

        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            print("[Sync] Failed to schedule background task: \(error)")
        }
    }

    // MARK: - Main Sync

    @discardableResult
    func sync(container: ModelContainer) async -> Bool {
        guard !isSyncing else { return false }
        guard apiService.config.isConfigured, apiService.config.isProfileSelected else { return false }
        guard let profileId = apiService.config.selectedProfileId else { return false }

        isSyncing = true
        defer { isSyncing = false }

        let modelContext = ModelContext(container)
        let since = lastSyncTime(for: profileId)

        print("[Sync] ========== Starting sync ==========")
        print("[Sync] Profile: \(profileId)")
        print("[Sync] Server: \(apiService.config.serverURL ?? "nil")")
        print("[Sync] Since: \(since?.description ?? "nil (full sync)")")

        do {
            // Refresh profile info (name, avatar, admin status)
            if let profile = try? await apiService.fetchCurrentProfile() {
                print("[Sync] Profile refreshed: \(profile.name) (admin=\(profile.isAdmin))")
                apiService.config.selectProfile(profile)
            } else {
                print("[Sync] WARNING: Could not refresh profile info")
            }

            // Pull from server and merge locally
            try await pullReadingProgress(since: since, profileId: profileId, modelContext: modelContext)
            try await pullHighlights(since: since, profileId: profileId, modelContext: modelContext)
            try await pullBookmarks(since: since, profileId: profileId, modelContext: modelContext)
            try await pullReadingSessions(since: since, profileId: profileId, modelContext: modelContext)

            // Push local changes to server
            try await pushReadingProgress(since: since, profileId: profileId, modelContext: modelContext)
            try await pushHighlights(since: since, profileId: profileId, modelContext: modelContext)
            try await pushBookmarks(since: since, profileId: profileId, modelContext: modelContext)
            try await pushReadingSessions(since: since, profileId: profileId, modelContext: modelContext)

            setLastSyncTime(Date(), for: profileId)
            print("[Sync] ========== Sync complete ==========")
            return true
        } catch {
            print("[Sync] ========== Sync FAILED ==========")
            print("[Sync] Error: \(error)")
            return false
        }
    }

    // MARK: - Background Task Handler

    private func handleBackgroundTask(_ task: BGAppRefreshTask) {
        task.expirationHandler = { [weak self] in
            Task { @MainActor [weak self] in
                self?.scheduleBackgroundTask()
            }
        }

        guard let modelContainer else {
            task.setTaskCompleted(success: false)
            return
        }

        Task {
            let success = await sync(container: modelContainer)
            task.setTaskCompleted(success: success)
            scheduleBackgroundTask()
        }
    }

    // MARK: - Pull: Reading Progress

    private func pullReadingProgress(since: Date?, profileId: String, modelContext: ModelContext) async throws {
        guard var url = apiService.config.apiURL("/api/sync/reading-progress") else {
            print("[Sync:Pull:Progress] Skipped — no API URL")
            return
        }

        if let since {
            let sinceStr = ISO8601DateFormatter().string(from: since)
            url = apiService.config.apiURL("/api/sync/reading-progress?since=\(sinceStr)") ?? url
        }

        print("[Sync:Pull:Progress] GET \(url)")
        let response: SyncDataResponse<ServerReadingProgress> = try await fetchJSON(url: url)
        print("[Sync:Pull:Progress] Received \(response.data.count) records from server")

        var merged = 0, skipped = 0, notFound = 0
        for record in response.data {
            let bookId = record.bookId
            let descriptor = FetchDescriptor<DownloadedBook>(
                predicate: #Predicate { $0.id == bookId }
            )
            guard let localBook = try? modelContext.fetch(descriptor).first else {
                notFound += 1
                continue
            }

            // Conflict resolution: server wins if its updatedAt is newer
            let serverUpdatedAt = record.updatedAt
            let localUpdatedAt = localBook.lastReadAt ?? .distantPast

            if serverUpdatedAt > localUpdatedAt {
                localBook.readingProgress = record.readingProgress ?? 0
                if let pos = record.lastPosition {
                    localBook.lastPosition = pos
                }
                localBook.lastReadAt = record.lastReadAt
                localBook.isRead = record.isRead ?? false
                if let rating = record.rating {
                    localBook.rating = rating
                }
                if let review = record.review {
                    localBook.review = review
                }
                merged += 1
            } else {
                skipped += 1
            }
        }

        print("[Sync:Pull:Progress] Merged: \(merged), Skipped (local newer): \(skipped), Not downloaded: \(notFound)")
        try? modelContext.save()
    }

    // MARK: - Pull: Highlights

    private func pullHighlights(since: Date?, profileId: String, modelContext: ModelContext) async throws {
        guard var url = apiService.config.apiURL("/api/sync/highlights") else {
            print("[Sync:Pull:Highlights] Skipped — no API URL")
            return
        }

        if let since {
            let sinceStr = ISO8601DateFormatter().string(from: since)
            url = apiService.config.apiURL("/api/sync/highlights?since=\(sinceStr)") ?? url
        }

        print("[Sync:Pull:Highlights] GET \(url)")
        let response: SyncDataResponse<ServerHighlight> = try await fetchJSON(url: url)
        print("[Sync:Pull:Highlights] Received \(response.data.count) records from server")

        for record in response.data {
            let recordId = record.id
            let descriptor = FetchDescriptor<BookHighlight>(
                predicate: #Predicate { $0.id == recordId }
            )
            let existing = try? modelContext.fetch(descriptor).first

            // Handle soft-delete
            if record.deletedAt != nil {
                if let existing {
                    modelContext.delete(existing)
                }
                continue
            }

            if let existing {
                // Conflict resolution: server wins if newer
                let serverTime = record.updatedAt
                let localTime = existing.createdAt

                if serverTime > localTime {
                    existing.bookId = record.bookId
                    existing.locatorJSON = record.startPosition
                    existing.text = record.text
                    existing.note = record.note
                    existing.color = record.color ?? "#ffff00"
                    existing.profileId = profileId
                }
            } else {
                // Insert new highlight from server
                let highlight = BookHighlight(
                    id: record.id,
                    bookId: record.bookId,
                    locatorJSON: record.startPosition,
                    text: record.text,
                    note: record.note,
                    color: record.color ?? "#ffff00",
                    progression: 0.0,
                    chapterTitle: nil,
                    createdAt: record.createdAt
                )
                highlight.profileId = profileId
                modelContext.insert(highlight)
            }
        }

        try? modelContext.save()
    }

    // MARK: - Pull: Bookmarks

    private func pullBookmarks(since: Date?, profileId: String, modelContext: ModelContext) async throws {
        guard var url = apiService.config.apiURL("/api/sync/bookmarks") else {
            print("[Sync:Pull:Bookmarks] Skipped — no API URL")
            return
        }

        if let since {
            let sinceStr = ISO8601DateFormatter().string(from: since)
            url = apiService.config.apiURL("/api/sync/bookmarks?since=\(sinceStr)") ?? url
        }

        print("[Sync:Pull:Bookmarks] GET \(url)")
        let response: SyncDataResponse<ServerBookmark> = try await fetchJSON(url: url)
        print("[Sync:Pull:Bookmarks] Received \(response.data.count) records from server")

        for record in response.data {
            let recordId = record.id
            let descriptor = FetchDescriptor<BookBookmark>(
                predicate: #Predicate { $0.id == recordId }
            )
            let existing = try? modelContext.fetch(descriptor).first

            // Handle soft-delete
            if record.deletedAt != nil {
                if let existing {
                    modelContext.delete(existing)
                }
                continue
            }

            // Parse position JSON to extract iOS fields
            let posData = Self.decodeBookmarkPosition(record.position)

            if let existing {
                // Conflict resolution: server wins if newer
                let serverTime = record.updatedAt
                let localTime = existing.createdAt

                if serverTime > localTime {
                    existing.bookId = record.bookId
                    existing.pageIndex = posData?.pageIndex ?? 0
                    existing.color = record.color ?? "#ff6b6b"
                    existing.note = record.note
                    existing.format = posData?.format ?? "epub"
                    existing.title = record.title
                    existing.progression = posData?.progression ?? 0.0
                    existing.profileId = profileId
                }
            } else {
                // Insert new bookmark from server
                let bookmark = BookBookmark(
                    id: record.id,
                    bookId: record.bookId,
                    pageIndex: posData?.pageIndex ?? 0,
                    color: record.color ?? "#ff6b6b",
                    note: record.note,
                    format: posData?.format ?? "epub",
                    title: record.title,
                    progression: posData?.progression ?? 0.0,
                    createdAt: record.createdAt
                )
                bookmark.profileId = profileId
                modelContext.insert(bookmark)
            }
        }

        try? modelContext.save()
    }

    // MARK: - Pull: Reading Sessions

    private func pullReadingSessions(since: Date?, profileId: String, modelContext: ModelContext) async throws {
        guard var url = apiService.config.apiURL("/api/sync/reading-sessions") else {
            print("[Sync:Pull:Sessions] Skipped — no API URL")
            return
        }

        if let since {
            let sinceStr = ISO8601DateFormatter().string(from: since)
            url = apiService.config.apiURL("/api/sync/reading-sessions?since=\(sinceStr)") ?? url
        }

        print("[Sync:Pull:Sessions] GET \(url)")
        let response: SyncDataResponse<ServerReadingSession> = try await fetchJSON(url: url)
        print("[Sync:Pull:Sessions] Received \(response.data.count) records from server")

        for record in response.data {
            let recordId = record.id
            let descriptor = FetchDescriptor<ReadingSession>(
                predicate: #Predicate { $0.id == recordId }
            )
            let existing = try? modelContext.fetch(descriptor).first

            // Reading sessions are insert-only — skip if already exists
            if existing != nil { continue }

            let startInfo = Self.decodeSessionPosition(record.startPosition)
            let endInfo = Self.decodeSessionPosition(record.endPosition)

            let session = ReadingSession(
                id: record.id,
                bookId: record.bookId,
                format: startInfo?.format ?? "epub",
                startedAt: record.startedAt,
                endedAt: record.endedAt ?? record.startedAt,
                startPage: startInfo?.page,
                endPage: endInfo?.page,
                totalBookPages: startInfo?.totalPages,
                startCharacterOffset: startInfo?.charOffset,
                endCharacterOffset: endInfo?.charOffset,
                audioPlaybackRate: startInfo?.rate
            )
            session.profileId = profileId
            modelContext.insert(session)
        }

        try? modelContext.save()
    }

    // MARK: - Push: Reading Progress

    private func pushReadingProgress(since: Date?, profileId: String, modelContext: ModelContext) async throws {
        let descriptor = FetchDescriptor<DownloadedBook>(
            predicate: #Predicate { $0.profileId == profileId }
        )
        guard let books = try? modelContext.fetch(descriptor) else {
            print("[Sync:Push:Progress] Skipped — fetch failed")
            return
        }

        print("[Sync:Push:Progress] Total downloaded books for profile: \(books.count)")
        for book in books {
            let hasLastRead = book.lastReadAt != nil
            let progress = book.readingProgress
            print("[Sync:Push:Progress]   Book '\(book.title ?? book.id)' — progress=\(progress), lastReadAt=\(book.lastReadAt?.description ?? "nil"), profileId='\(book.profileId)'")
            if let since, let lastReadAt = book.lastReadAt {
                print("[Sync:Push:Progress]     since=\(since), lastReadAt=\(lastReadAt), willPush=\(lastReadAt > since)")
            } else if !hasLastRead {
                print("[Sync:Push:Progress]     No lastReadAt — will NOT push")
            }
        }

        // Filter to books modified since last sync
        let modifiedBooks = books.filter { book in
            guard let lastReadAt = book.lastReadAt else { return false }
            if let since { return lastReadAt > since }
            return true
        }

        guard !modifiedBooks.isEmpty else {
            print("[Sync:Push:Progress] No modified books to push")
            return
        }
        guard let url = apiService.config.apiURL("/api/sync/reading-progress") else {
            print("[Sync:Push:Progress] Skipped — no API URL")
            return
        }

        print("[Sync:Push:Progress] Pushing \(modifiedBooks.count) book(s) to PUT \(url)")

        // Server expects PUT with a single record per request
        // Skip books that don't exist on the server (404)
        var pushed = 0, skippedFK = 0, errors = 0
        for book in modifiedBooks {
            // Use Date() (now) for updatedAt so the push always wins the server's
            // conflict check. Using lastReadAt would lose to the server's migration-time
            // updatedAt, causing the update to be silently rejected (conflict: true).
            let body = ServerReadingProgress(
                bookId: book.id,
                readingProgress: book.readingProgress,
                lastPosition: book.lastPosition,
                lastReadAt: book.lastReadAt,
                isRead: book.isRead,
                rating: book.rating,
                review: book.review,
                updatedAt: Date()
            )
            do {
                print("[Sync:Push:Progress]   PUT book=\(book.id) progress=\(book.readingProgress) isRead=\(book.isRead) rating=\(book.rating ?? -1)")
                try await putJSON(url: url, body: body)
                pushed += 1
                print("[Sync:Push:Progress]   ✓ Success")
            } catch APIError.serverError(let code, let msg) where code == 404 {
                skippedFK += 1
                print("[Sync:Push:Progress]   ✗ 404 — book not on server, skipping")
            } catch {
                errors += 1
                print("[Sync:Push:Progress]   ✗ Error: \(error)")
                throw error
            }
        }
        print("[Sync:Push:Progress] Done — pushed: \(pushed), skipped (404): \(skippedFK), errors: \(errors)")
    }

    // MARK: - Push: Highlights

    private func pushHighlights(since: Date?, profileId: String, modelContext: ModelContext) async throws {
        let descriptor = FetchDescriptor<BookHighlight>(
            predicate: #Predicate { $0.profileId == profileId }
        )
        guard let highlights = try? modelContext.fetch(descriptor) else {
            print("[Sync:Push:Highlights] Skipped — fetch failed")
            return
        }

        print("[Sync:Push:Highlights] Total highlights for profile: \(highlights.count)")

        // Filter to highlights created/modified since last sync
        let modified = highlights.filter { highlight in
            if let since { return highlight.createdAt > since }
            return true
        }

        guard !modified.isEmpty else {
            print("[Sync:Push:Highlights] No modified highlights to push")
            return
        }

        // Server expects { highlights: [...] } with startPosition/endPosition fields
        let serverHighlights = modified.map { h in
            ServerHighlight(
                id: h.id,
                bookId: h.bookId,
                startPosition: h.locatorJSON,
                endPosition: "",
                text: h.text,
                note: h.note,
                color: h.color,
                createdAt: h.createdAt,
                updatedAt: h.createdAt,
                deletedAt: nil
            )
        }

        guard let url = apiService.config.apiURL("/api/sync/highlights") else { return }
        print("[Sync:Push:Highlights] POST \(url) — \(serverHighlights.count) highlight(s)")
        try await postJSON(url: url, body: HighlightsPushBody(highlights: serverHighlights))
        print("[Sync:Push:Highlights] ✓ Success")
    }

    // MARK: - Push: Bookmarks

    private func pushBookmarks(since: Date?, profileId: String, modelContext: ModelContext) async throws {
        let descriptor = FetchDescriptor<BookBookmark>(
            predicate: #Predicate { $0.profileId == profileId }
        )
        guard let bookmarks = try? modelContext.fetch(descriptor) else {
            print("[Sync:Push:Bookmarks] Skipped — fetch failed")
            return
        }

        print("[Sync:Push:Bookmarks] Total bookmarks for profile: \(bookmarks.count)")

        // Filter to bookmarks created/modified since last sync
        let modified = bookmarks.filter { bookmark in
            if let since { return bookmark.createdAt > since }
            return true
        }

        guard !modified.isEmpty else {
            print("[Sync:Push:Bookmarks] No modified bookmarks to push")
            return
        }

        // Server expects { bookmarks: [...] } with a `position` string field
        // We encode pageIndex/format/progression as JSON in the position string
        let serverBookmarks = modified.map { b in
            ServerBookmark(
                id: b.id,
                bookId: b.bookId,
                position: Self.encodeBookmarkPosition(pageIndex: b.pageIndex, format: b.format, progression: b.progression),
                title: b.title,
                note: b.note,
                color: b.color,
                createdAt: b.createdAt,
                updatedAt: b.createdAt,
                deletedAt: nil
            )
        }

        guard let url = apiService.config.apiURL("/api/sync/bookmarks") else { return }
        print("[Sync:Push:Bookmarks] POST \(url) — \(serverBookmarks.count) bookmark(s)")
        try await postJSON(url: url, body: BookmarksPushBody(bookmarks: serverBookmarks))
        print("[Sync:Push:Bookmarks] ✓ Success")
    }

    // MARK: - Push: Reading Sessions

    private func pushReadingSessions(since: Date?, profileId: String, modelContext: ModelContext) async throws {
        let descriptor = FetchDescriptor<ReadingSession>(
            predicate: #Predicate { $0.profileId == profileId }
        )
        guard let sessions = try? modelContext.fetch(descriptor) else {
            print("[Sync:Push:Sessions] Skipped — fetch failed")
            return
        }

        print("[Sync:Push:Sessions] Total sessions for profile: \(sessions.count)")

        // Filter to sessions created since last sync
        let newSessions = sessions.filter { session in
            if let since { return session.startedAt > since }
            return true
        }

        guard !newSessions.isEmpty else {
            print("[Sync:Push:Sessions] No new sessions to push")
            return
        }

        // Server expects { sessions: [...] } with startPosition/endPosition as strings
        // We encode iOS-specific fields (page, charOffset, format, etc.) as JSON in position strings
        let serverSessions = newSessions.map { s in
            ServerReadingSession(
                id: s.id,
                bookId: s.bookId,
                startedAt: s.startedAt,
                endedAt: s.endedAt,
                pagesRead: s.pagesRead,
                startPosition: Self.encodeSessionPosition(
                    page: s.startPage,
                    charOffset: s.startCharacterOffset,
                    format: s.format,
                    totalPages: s.totalBookPages,
                    rate: s.audioPlaybackRate
                ),
                endPosition: Self.encodeSessionPosition(
                    page: s.endPage,
                    charOffset: s.endCharacterOffset
                )
            )
        }

        guard let url = apiService.config.apiURL("/api/sync/reading-sessions") else { return }
        print("[Sync:Push:Sessions] POST \(url) — \(serverSessions.count) session(s)")
        try await postJSON(url: url, body: SessionsPushBody(sessions: serverSessions))
        print("[Sync:Push:Sessions] ✓ Success")
    }

    // MARK: - HTTP Helpers

    /// ISO8601 formatter that handles fractional seconds (JavaScript's toISOString() includes .000)
    private static let iso8601WithFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let iso8601Basic = ISO8601DateFormatter()

    private func fetchJSON<T: Decodable>(url: URL) async throws -> T {
        var request = URLRequest(url: url)
        if let profileId = apiService.config.selectedProfileId {
            request.setValue(profileId, forHTTPHeaderField: "X-Profile-Id")
        }

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            guard (200...299).contains(httpResponse.statusCode) else {
                let message = String(data: data, encoding: .utf8)
                throw APIError.serverError(httpResponse.statusCode, message)
            }

            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .custom { decoder in
                let container = try decoder.singleValueContainer()
                let string = try container.decode(String.self)
                if let date = Self.iso8601WithFractional.date(from: string) { return date }
                if let date = Self.iso8601Basic.date(from: string) { return date }
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "Invalid ISO8601 date: \(string)"
                )
            }
            return try decoder.decode(T.self, from: data)
        } catch let error as APIError {
            throw error
        } catch let error as DecodingError {
            throw APIError.decodingError(error)
        } catch {
            throw APIError.networkError(error)
        }
    }

    private func postJSON<T: Encodable>(url: URL, body: T, method: String = "POST") async throws {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let profileId = apiService.config.selectedProfileId {
            request.setValue(profileId, forHTTPHeaderField: "X-Profile-Id")
        }

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let bodyData = try encoder.encode(body)
        request.httpBody = bodyData

        // Log the request body for debugging
        if let bodyStr = String(data: bodyData, encoding: .utf8) {
            let truncated = bodyStr.count > 500 ? String(bodyStr.prefix(500)) + "..." : bodyStr
            print("[Sync:HTTP] \(method) \(url) — body: \(truncated)")
        }

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            let responseStr = String(data: data, encoding: .utf8) ?? "(no body)"
            print("[Sync:HTTP] \(method) \(url) — response \(httpResponse.statusCode): \(responseStr.prefix(300))")
            guard (200...299).contains(httpResponse.statusCode) else {
                throw APIError.serverError(httpResponse.statusCode, responseStr)
            }
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.networkError(error)
        }
    }

    private func putJSON<T: Encodable>(url: URL, body: T) async throws {
        try await postJSON(url: url, body: body, method: "PUT")
    }

    // MARK: - Position Encoding/Decoding

    /// Bookmark position is stored as JSON in the server's `position` text field
    private struct BookmarkPositionData: Codable {
        let pageIndex: Int
        let format: String
        let progression: Double
    }

    /// Session extra data is stored as JSON in the server's `startPosition`/`endPosition` text fields
    private struct SessionPositionData: Codable {
        var page: Int?
        var charOffset: Int?
        var format: String?
        var totalPages: Int?
        var rate: Float?
    }

    private static func encodeBookmarkPosition(pageIndex: Int, format: String, progression: Double) -> String {
        let data = BookmarkPositionData(pageIndex: pageIndex, format: format, progression: progression)
        guard let json = try? JSONEncoder().encode(data),
              let str = String(data: json, encoding: .utf8) else { return "{}" }
        return str
    }

    private static func decodeBookmarkPosition(_ position: String) -> BookmarkPositionData? {
        guard let data = position.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(BookmarkPositionData.self, from: data)
    }

    private static func encodeSessionPosition(page: Int? = nil, charOffset: Int? = nil, format: String? = nil, totalPages: Int? = nil, rate: Float? = nil) -> String? {
        guard page != nil || charOffset != nil || format != nil else { return nil }
        let data = SessionPositionData(page: page, charOffset: charOffset, format: format, totalPages: totalPages, rate: rate)
        guard let json = try? JSONEncoder().encode(data),
              let str = String(data: json, encoding: .utf8) else { return nil }
        return str
    }

    private static func decodeSessionPosition(_ position: String?) -> SessionPositionData? {
        guard let pos = position, let data = pos.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(SessionPositionData.self, from: data)
    }
}

// MARK: - Server Response Wrapper

/// All server sync GET endpoints return { success: true, data: [...] }
private struct SyncDataResponse<T: Decodable>: Decodable {
    let success: Bool
    let data: [T]
}

// MARK: - Server DTOs: Reading Progress

/// Matches GET /api/sync/reading-progress response shape and PUT request body
private struct ServerReadingProgress: Codable {
    let bookId: String
    let readingProgress: Double?
    let lastPosition: String?
    let lastReadAt: Date?
    let isRead: Bool?
    let rating: Int?
    let review: String?
    let updatedAt: Date
}

// MARK: - Server DTOs: Highlights

/// Matches GET /api/sync/highlights response shape and POST request item shape
/// iOS `locatorJSON` maps to `startPosition`; `endPosition` is unused by iOS
private struct ServerHighlight: Codable {
    let id: String
    let bookId: String
    let startPosition: String
    let endPosition: String
    let text: String
    let note: String?
    let color: String?
    let createdAt: Date
    let updatedAt: Date
    let deletedAt: Date?
}

/// POST /api/sync/highlights expects { highlights: [...] }
private struct HighlightsPushBody: Encodable {
    let highlights: [ServerHighlight]
}

// MARK: - Server DTOs: Bookmarks

/// Matches GET /api/sync/bookmarks response shape and POST request item shape
/// iOS bookmark fields (pageIndex, format, progression) are encoded as JSON in `position`
private struct ServerBookmark: Codable {
    let id: String
    let bookId: String
    let position: String
    let title: String?
    let note: String?
    let color: String?
    let createdAt: Date
    let updatedAt: Date
    let deletedAt: Date?
}

/// POST /api/sync/bookmarks expects { bookmarks: [...] }
private struct BookmarksPushBody: Encodable {
    let bookmarks: [ServerBookmark]
}

// MARK: - Server DTOs: Reading Sessions

/// Matches GET /api/sync/reading-sessions response shape and POST request item shape
/// iOS-specific fields (format, page, charOffset, etc.) are encoded as JSON in position strings
private struct ServerReadingSession: Codable {
    let id: String
    let bookId: String
    let startedAt: Date
    let endedAt: Date?
    let pagesRead: Int?
    let startPosition: String?
    let endPosition: String?
}

/// POST /api/sync/reading-sessions expects { sessions: [...] }
private struct SessionsPushBody: Encodable {
    let sessions: [ServerReadingSession]
}
