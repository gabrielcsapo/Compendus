//
//  APIService.swift
//  Compendus
//
//  REST API client for communicating with the Compendus server
//

import Foundation
import CCReader
import OSLog

private let apiLogger = Logger(subsystem: "com.compendus.network", category: "API")

enum APIError: LocalizedError {
    case serverNotConfigured
    case invalidURL
    case networkError(Error)
    case invalidResponse
    case decodingError(Error)
    case serverError(Int, String?)
    case profileRequired
    case offline

    var errorDescription: String? {
        switch self {
        case .serverNotConfigured:
            return "Server not configured. Please set the server URL in Settings."
        case .invalidURL:
            return "Invalid URL"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .invalidResponse:
            return "Invalid response from server"
        case .decodingError(let error):
            return "Failed to parse response: \(error.localizedDescription)"
        case .serverError(let code, let message):
            if code == 502 || code == 503 || code == 504 {
                return "The library server is starting up or busy. Give it a moment and try again."
            }
            return message.map { "Server error (\(code)): \($0)" } ?? "Server error (\(code))."
        case .profileRequired:
            return "Your profile is no longer available on the server. Please select a new profile."
        case .offline:
            return "Compendus is in Offline Mode. Turn it off when you want to contact the server."
        }
    }
}

@Observable
class APIService {
    let config: ServerConfig
    let session: URLSession

    init(config: ServerConfig) {
        self.config = config
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 120
        configuration.waitsForConnectivity = false
        let session = URLSession(configuration: configuration, delegate: LocalNetworkSessionDelegate.shared, delegateQueue: nil)
        self.session = session
        NetworkSessionRegistry.shared.registerDataSession(session)
    }

    /// The single gate for API traffic. Checking immediately before URLSession
    /// prevents queued actions from opening a connection after Offline Mode is enabled.
    func performDataRequest(_ request: URLRequest) async throws -> (Data, URLResponse) {
        guard ConnectivityMonitor.shared.permitsNetworkRequests else { throw APIError.offline }
        return try await session.data(for: request)
    }

    // MARK: - Books

    /// Fetch all books from the server with optional type filter, sorting, and series filter
    func fetchBooks(limit: Int = 50, offset: Int = 0, type: String? = nil, orderBy: String? = nil, order: String? = nil, series: String? = nil) async throws -> BooksResponse {
        guard config.isConfigured else {
            throw APIError.serverNotConfigured
        }

        var urlString = "/api/books?limit=\(limit)&offset=\(offset)"
        if let type = type {
            urlString += "&type=\(type)"
        }
        if let orderBy = orderBy {
            urlString += "&orderBy=\(orderBy)"
        }
        if let order = order {
            urlString += "&order=\(order)"
        }
        if let series = series {
            urlString += "&series=\(series.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? series)"
        }

        guard let url = config.apiURL(urlString) else {
            throw APIError.invalidURL
        }

        return try await fetch(url)
    }

    // MARK: - Semantic substrate (wander v2, Pods, trails)

    /// Start a wander: serendipitous, aimed at a free-text query, or from a book.
    func fetchWanderStart(query: String? = nil, bookId: String? = nil) async throws -> WanderStopResponse {
        guard config.isConfigured else { throw APIError.serverNotConfigured }
        var urlString = "/api/wander2/start?mode=random"
        if let query, !query.isEmpty {
            let q = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
            urlString = "/api/wander2/start?mode=query&q=\(q)"
        } else if let bookId {
            urlString = "/api/wander2/start?mode=book&bookId=\(bookId)"
        }
        guard let url = config.apiURL(urlString) else { throw APIError.invalidURL }
        return try await fetch(url)
    }

    /// Fetch one wander stop with grounded steps, excluding already-visited passages.
    /// Also records the passage as seen for coverage/learning.
    func fetchWanderStop(passageId: String, visited: [String]) async throws -> WanderStopResponse {
        guard config.isConfigured else { throw APIError.serverNotConfigured }
        let encoded = passageId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? passageId
        let visitedParam = visited.suffix(60).joined(separator: ",")
        guard let url = config.apiURL("/api/wander2/stop/\(encoded)?visited=\(visitedParam)") else {
            throw APIError.invalidURL
        }
        return try await fetch(url)
    }

    /// The shared learning collection used by both web and iOS.
    func fetchPods(limit: Int = 60, offset: Int = 0) async throws -> PodsResponse {
        guard config.isConfigured else { throw APIError.serverNotConfigured }
        guard let url = config.apiURL("/api/pods?limit=\(limit)&offset=\(offset)") else {
            throw APIError.invalidURL
        }
        return try await fetch(url)
    }

    /// Search Pods without reloading the full collection.
    func searchPods(query: String) async throws -> PodSearchResponse {
        guard config.isConfigured else { throw APIError.serverNotConfigured }
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&=+?")
        let encoded = query.addingPercentEncoding(withAllowedCharacters: allowed) ?? query
        guard let url = config.apiURL("/api/pods/search?q=\(encoded)") else {
            throw APIError.invalidURL
        }
        return try await fetch(url)
    }

    /// A compact, revision-stable source session plus already-resolved adjacent Pods.
    func fetchPodSession(podId: String) async throws -> PodSessionResponse {
        guard config.isConfigured else { throw APIError.serverNotConfigured }
        let encoded = podId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? podId
        guard let url = config.apiURL("/api/pods/\(encoded)/session") else {
            throw APIError.invalidURL
        }
        return try await fetch(url)
    }

    /// Submit one source-recall choice. The response always returns canonical evidence.
    func submitPodAttempt(
        podId: String,
        revision: String,
        questionId: String,
        selectedChoiceId: String,
        attemptId: String
    ) async throws -> PodAttemptResponse {
        guard config.isConfigured else { throw APIError.serverNotConfigured }
        let encoded = podId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? podId
        guard let url = config.apiURL("/api/pods/\(encoded)/attempts") else {
            throw APIError.invalidURL
        }
        var request = buildRequest(url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(
            PodAttemptRequest(
                revision: revision,
                questionId: questionId,
                selectedChoiceId: selectedChoiceId,
                attemptId: attemptId
            )
        )
        return try await send(request)
    }

    /// Save a wander path as a replayable trail.
    func saveTrail(path: [String], title: String? = nil) async throws -> TrailSaveResponse {
        guard config.isConfigured else { throw APIError.serverNotConfigured }
        guard let url = config.apiURL("/api/trails") else { throw APIError.invalidURL }
        var request = buildRequest(url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["path": path]
        if let title { body["title"] = title }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, _) = try await performDataRequest(request)
        return try JSONDecoder().decode(TrailSaveResponse.self, from: data)
    }

    /// Log a completed wander session for activity tracking (best-effort, never throws).
    /// `startedAt` is the session start; `ideasVisited` is how many ideas were surfaced.
    func logWanderSession(
        startedAt: Date, ideasVisited: Int, path: [String] = [], stepsTaken: [String] = []
    ) async {
        guard config.isConfigured else { return }
        guard let url = config.apiURL("/api/wander/sessions") else { return }

        var request = buildRequest(url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = [
            "startedAt": startedAt.timeIntervalSince1970 * 1000,
            "ideasVisited": max(1, ideasVisited),
        ]
        if !path.isEmpty { body["path"] = path }
        if !stepsTaken.isEmpty { body["stepsTaken"] = stepsTaken }
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        _ = try? await performDataRequest(request)
    }

    /// Fetch all series with cover data for fan-out display
    func fetchSeries() async throws -> SeriesResponse {
        guard config.isConfigured else {
            throw APIError.serverNotConfigured
        }

        guard let url = config.apiURL("/api/series") else {
            throw APIError.invalidURL
        }

        return try await fetch(url)
    }

    /// Fetch the server-driven explore view model
    func fetchExplore() async throws -> ExploreViewModel {
        guard config.isConfigured else {
            throw APIError.serverNotConfigured
        }

        guard let url = config.apiURL("/api/explore") else {
            throw APIError.invalidURL
        }

        do {
            let model: ExploreViewModel = try await fetch(url)
            cacheExplore(model)
            return model
        } catch {
            // Discovery is useful while travelling precisely when the server is
            // not reachable. Keep the last server-curated snapshot profile-scoped
            // and return it without attempting another connection.
            if let cached = loadCachedExplore() {
                return cached
            }
            throw error
        }
    }

    private func exploreCacheURL() -> URL? {
        guard let profileId = config.selectedProfileId else { return nil }
        guard let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return nil
        }
        guard let safeProfileId = profileId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) else {
            return nil
        }
        let directory = root.appendingPathComponent("ExploreCache", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("\(safeProfileId).json")
    }

    private func cacheExplore(_ model: ExploreViewModel) {
        guard let url = exploreCacheURL(), let data = try? JSONEncoder().encode(model) else { return }
        do {
            try data.write(to: url, options: .atomic)
            try FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                ofItemAtPath: url.path
            )
        } catch {
            apiLogger.warning("Could not persist Explore cache: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func loadCachedExplore() -> ExploreViewModel? {
        guard let url = exploreCacheURL(),
              let data = try? Data(contentsOf: url),
              let model = try? JSONDecoder().decode(ExploreViewModel.self, from: data)
        else { return nil }
        return model
    }

    /// Fetch a single book by ID
    func fetchBook(id: String) async throws -> BookResponse {
        guard config.isConfigured else {
            throw APIError.serverNotConfigured
        }

        guard let url = config.apiURL("/api/books/\(id)") else {
            throw APIError.invalidURL
        }

        return try await fetch(url)
    }

    /// Search books
    func searchBooks(query: String, limit: Int = 20, offset: Int = 0) async throws -> SearchResponse {
        guard config.isConfigured else {
            throw APIError.serverNotConfigured
        }

        let encodedQuery = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        guard let url = config.apiURL("/api/search?q=\(encodedQuery)&limit=\(limit)&offset=\(offset)") else {
            throw APIError.invalidURL
        }

        return try await fetch(url)
    }

    // MARK: - Covers

    /// Fetch cover image data
    func fetchCover(bookId: String) async throws -> Data {
        guard config.isConfigured else {
            throw APIError.serverNotConfigured
        }

        guard let url = config.coverURL(for: bookId) else {
            throw APIError.invalidURL
        }

        return try await fetchData(url)
    }

    /// Download the canonical CCD bundle (decompressed JSON) for a book. The
    /// reader consumes this instead of parsing the EPUB on-device.
    func fetchCcdBundle(bookId: String) async throws -> Data {
        guard config.isConfigured else {
            throw APIError.serverNotConfigured
        }
        guard let url = config.apiURL("/api/reader/\(bookId)/ccd/bundle") else {
            throw APIError.invalidURL
        }
        return try await fetchData(url)
    }

    /// Download the self-contained CCD "pack" (ZIP) for a book: the full
    /// `manifest.ccd.json` plus `resources/<handle>` for every referenced image.
    /// The reader unpacks this and reads entirely from it — no raw .epub on device.
    func fetchCcdPack(bookId: String) async throws -> Data {
        guard config.isConfigured else {
            throw APIError.serverNotConfigured
        }
        guard let url = config.apiURL("/api/reader/\(bookId)/ccd/pack") else {
            throw APIError.invalidURL
        }
        return try await fetchData(url)
    }

    // MARK: - Comics

    /// Fetch comic page count
    func fetchComicInfo(bookId: String, format: String) async throws -> ComicInfo {
        guard config.isConfigured else {
            throw APIError.serverNotConfigured
        }

        guard let url = config.comicInfoURL(for: bookId, format: format) else {
            throw APIError.invalidURL
        }

        return try await fetch(url)
    }

    /// Fetch a comic page as image data
    func fetchComicPage(bookId: String, format: String, page: Int) async throws -> Data {
        guard config.isConfigured else {
            throw APIError.serverNotConfigured
        }

        guard let url = config.comicPageURL(for: bookId, format: format, page: page) else {
            throw APIError.invalidURL
        }

        return try await fetchData(url)
    }

    // MARK: - Conversions

    /// Trigger EPUB conversion on the server (supports PDF, MOBI, AZW3)
    func convertToEpub(bookId: String) async throws -> ConversionResponse {
        guard config.isConfigured else { throw APIError.serverNotConfigured }
        guard let url = config.convertToEpubURL(for: bookId) else { throw APIError.invalidURL }

        var request = buildRequest(url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        do {
            let (data, response) = try await performDataRequest(request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            guard (200...299).contains(httpResponse.statusCode) else {
                // Never surface a raw error body to the reader: a 5xx is usually
                // the proxy's HTML "Starting Up" page. Keep a JSON {error} message
                // if present; otherwise let errorDescription give a clean,
                // status-based phrase.
                let body = (String(data: data, encoding: .utf8) ?? "")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                var message: String?
                if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let err = json["error"] as? String {
                    message = err
                } else if !body.isEmpty && !body.hasPrefix("<") {
                    message = String(body.prefix(140))
                }
                throw APIError.serverError(httpResponse.statusCode, message)
            }
            return try JSONDecoder().decode(ConversionResponse.self, from: data)
        } catch let error as APIError {
            throw error
        } catch let error as DecodingError {
            throw APIError.decodingError(error)
        } catch {
            throw APIError.networkError(error)
        }
    }

    /// Poll job progress
    func getJobProgress(jobId: String) async throws -> JobProgressResponse {
        guard config.isConfigured else { throw APIError.serverNotConfigured }
        guard let url = config.jobProgressURL(for: jobId) else { throw APIError.invalidURL }
        return try await fetch(url)
    }

    // MARK: - Transcription

    /// Trigger audiobook transcription on the server
    func transcribe(bookId: String) async throws -> TranscribeResponse {
        guard config.isConfigured else { throw APIError.serverNotConfigured }
        guard let url = config.apiURL("/api/books/\(bookId)/transcribe") else { throw APIError.invalidURL }

        var request = buildRequest(url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        do {
            let (data, response) = try await performDataRequest(request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            guard (200...299).contains(httpResponse.statusCode) else {
                // Never surface a raw error body to the reader: a 5xx is usually
                // the proxy's HTML "Starting Up" page. Keep a JSON {error} message
                // if present; otherwise let errorDescription give a clean,
                // status-based phrase.
                let body = (String(data: data, encoding: .utf8) ?? "")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                var message: String?
                if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let err = json["error"] as? String {
                    message = err
                } else if !body.isEmpty && !body.hasPrefix("<") {
                    message = String(body.prefix(140))
                }
                throw APIError.serverError(httpResponse.statusCode, message)
            }
            return try JSONDecoder().decode(TranscribeResponse.self, from: data)
        } catch let error as APIError {
            throw error
        } catch let error as DecodingError {
            throw APIError.decodingError(error)
        } catch {
            throw APIError.networkError(error)
        }
    }

    /// Fetch the transcript JSON for an audiobook
    func fetchTranscript(bookId: String) async throws -> TranscriptDataResponse {
        guard config.isConfigured else { throw APIError.serverNotConfigured }
        guard let url = config.apiURL("/api/books/\(bookId)/transcript") else { throw APIError.invalidURL }
        return try await fetch(url)
    }

    /// Check if a transcript is available for a book
    func getTranscriptStatus(bookId: String) async throws -> TranscriptStatusResponse {
        guard config.isConfigured else { throw APIError.serverNotConfigured }
        guard let url = config.apiURL("/api/books/\(bookId)/transcript-status") else { throw APIError.invalidURL }
        return try await fetch(url)
    }

    /// Upload a transcript to the server (e.g., from on-device transcription)
    func uploadTranscript(bookId: String, transcript: Transcript) async throws {
        guard config.isConfigured else { throw APIError.serverNotConfigured }
        guard let url = config.apiURL("/api/books/\(bookId)/transcript") else { throw APIError.invalidURL }

        var request = buildRequest(url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body = ["transcript": transcript]
        request.httpBody = try JSONEncoder().encode(body)

            let (data, response) = try await performDataRequest(request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            let message = String(data: data, encoding: .utf8)
            throw APIError.serverError((response as? HTTPURLResponse)?.statusCode ?? 0, message)
        }
    }

    /// Delete a transcript from the server
    func deleteTranscript(bookId: String) async throws {
        guard config.isConfigured else { throw APIError.serverNotConfigured }
        guard let url = config.apiURL("/api/books/\(bookId)/transcript") else { throw APIError.invalidURL }

        var request = buildRequest(url)
        request.httpMethod = "DELETE"

        let (_, response) = try await performDataRequest(request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.serverError((response as? HTTPURLResponse)?.statusCode ?? 0, nil)
        }
    }

    // MARK: - Book Editing

    /// Update a book's metadata on the server
    func updateBook(id: String, updates: UpdateBookRequest) async throws -> BookResponse {
        guard config.isConfigured else { throw APIError.serverNotConfigured }
        guard let url = config.apiURL("/api/books/\(id)") else { throw APIError.invalidURL }

        var request = buildRequest(url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(updates)

        do {
            let (data, response) = try await performDataRequest(request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            guard (200...299).contains(httpResponse.statusCode) else {
                // Never surface a raw error body to the reader: a 5xx is usually
                // the proxy's HTML "Starting Up" page. Keep a JSON {error} message
                // if present; otherwise let errorDescription give a clean,
                // status-based phrase.
                let body = (String(data: data, encoding: .utf8) ?? "")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                var message: String?
                if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let err = json["error"] as? String {
                    message = err
                } else if !body.isEmpty && !body.hasPrefix("<") {
                    message = String(body.prefix(140))
                }
                throw APIError.serverError(httpResponse.statusCode, message)
            }
            return try JSONDecoder().decode(BookResponse.self, from: data)
        } catch let error as APIError {
            throw error
        } catch let error as DecodingError {
            throw APIError.decodingError(error)
        } catch {
            throw APIError.networkError(error)
        }
    }

    // MARK: - Tags

    /// Fetch tags for a book
    func fetchBookTags(bookId: String) async throws -> BookTagsResponse {
        guard config.isConfigured else { throw APIError.serverNotConfigured }
        guard let url = config.apiURL("/api/books/\(bookId)/tags") else { throw APIError.invalidURL }
        return try await fetch(url)
    }

    /// Add a tag to a book by name
    func addTag(bookId: String, name: String) async throws -> AddTagResponse {
        guard config.isConfigured else { throw APIError.serverNotConfigured }
        guard let url = config.apiURL("/api/books/\(bookId)/tags") else { throw APIError.invalidURL }

        var request = buildRequest(url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["name": name])

        do {
            let (data, response) = try await performDataRequest(request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            guard (200...299).contains(httpResponse.statusCode) else {
                // Never surface a raw error body to the reader: a 5xx is usually
                // the proxy's HTML "Starting Up" page. Keep a JSON {error} message
                // if present; otherwise let errorDescription give a clean,
                // status-based phrase.
                let body = (String(data: data, encoding: .utf8) ?? "")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                var message: String?
                if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let err = json["error"] as? String {
                    message = err
                } else if !body.isEmpty && !body.hasPrefix("<") {
                    message = String(body.prefix(140))
                }
                throw APIError.serverError(httpResponse.statusCode, message)
            }
            return try JSONDecoder().decode(AddTagResponse.self, from: data)
        } catch let error as APIError {
            throw error
        } catch let error as DecodingError {
            throw APIError.decodingError(error)
        } catch {
            throw APIError.networkError(error)
        }
    }

    /// Remove a tag from a book
    func removeTag(bookId: String, tagId: String) async throws {
        guard config.isConfigured else { throw APIError.serverNotConfigured }
        guard let url = config.apiURL("/api/books/\(bookId)/tags/\(tagId)") else { throw APIError.invalidURL }

        var request = buildRequest(url)
        request.httpMethod = "DELETE"

        let (_, response) = try await performDataRequest(request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.serverError((response as? HTTPURLResponse)?.statusCode ?? 0, nil)
        }
    }

    // MARK: - Collections

    /// Fetch all collections for the current profile
    func fetchCollections() async throws -> CollectionsResponse {
        guard config.isConfigured else { throw APIError.serverNotConfigured }
        guard let url = config.apiURL("/api/collections") else { throw APIError.invalidURL }
        return try await fetch(url)
    }

    /// Fetch the collections a book belongs to
    func fetchBookCollections(bookId: String) async throws -> CollectionsResponse {
        guard config.isConfigured else { throw APIError.serverNotConfigured }
        guard let url = config.apiURL("/api/books/\(bookId)/collections") else { throw APIError.invalidURL }
        return try await fetch(url)
    }

    /// Add a book to a collection
    func addBookToCollection(bookId: String, collectionId: String) async throws {
        guard config.isConfigured else { throw APIError.serverNotConfigured }
        guard let url = config.apiURL("/api/books/\(bookId)/collections") else { throw APIError.invalidURL }

        var request = buildRequest(url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["collectionId": collectionId])

            let (data, response) = try await performDataRequest(request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            let message = String(data: data, encoding: .utf8)
            throw APIError.serverError((response as? HTTPURLResponse)?.statusCode ?? 0, message)
        }
    }

    /// Remove a book from a collection
    func removeBookFromCollection(bookId: String, collectionId: String) async throws {
        guard config.isConfigured else { throw APIError.serverNotConfigured }
        guard let url = config.apiURL("/api/books/\(bookId)/collections/\(collectionId)") else { throw APIError.invalidURL }

        var request = buildRequest(url)
        request.httpMethod = "DELETE"

        let (_, response) = try await performDataRequest(request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.serverError((response as? HTTPURLResponse)?.statusCode ?? 0, nil)
        }
    }

    // MARK: - Downloads

    func fetchDownloadManifest(bookId: String, variant: String? = nil) async throws -> DownloadArtifactManifest {
        guard config.isConfigured else { throw APIError.serverNotConfigured }
        let suffix = variant.map { "?variant=\($0)" } ?? ""
        guard let url = config.apiURL("/api/downloads/\(bookId)/manifest\(suffix)") else {
            throw APIError.invalidURL
        }
        return try await fetch(url)
    }

    /// Build an authenticated request suitable for a background URLSession.
    func authenticatedRequest(for url: URL) -> URLRequest {
        buildRequest(url)
    }

    /// Get URL for downloading a book file
    func bookDownloadURL(bookId: String, format: String) -> URL? {
        config.bookFileURL(for: bookId, format: format)
    }

    // MARK: - Profiles

    /// Fetch all profiles from the server
    func fetchProfiles() async throws -> [Profile] {
        guard let url = config.apiURL("/api/profiles") else {
            throw APIError.invalidURL
        }
        // Don't add profile header for this endpoint (it's pre-auth)
        let request = URLRequest(url: url)
        let (data, response) = try await performDataRequest(request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.invalidResponse
        }
        let decoded = try JSONDecoder().decode(ProfilesResponse.self, from: data)
        return decoded.profiles
    }

    /// Select a profile, optionally providing a PIN
    func selectProfile(id: String, pin: String? = nil) async throws -> Profile {
        guard let url = config.apiURL("/api/profiles/\(id)/select") else {
            throw APIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let pin = pin {
            request.httpBody = try JSONEncoder().encode(ProfileSelectRequest(pin: pin))
        } else {
            request.httpBody = "{}".data(using: .utf8)
        }
        let (data, response) = try await performDataRequest(request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        let decoded = try JSONDecoder().decode(ProfileResponse.self, from: data)
        if httpResponse.statusCode == 401 && decoded.code == "INVALID_PIN" {
            throw APIError.serverError(401, "Invalid PIN")
        }
        guard (200...299).contains(httpResponse.statusCode), let profile = decoded.profile else {
            throw APIError.serverError(httpResponse.statusCode, decoded.error)
        }
        return profile
    }

    /// Fetch the current profile info from the server (refreshes name/avatar)
    func fetchCurrentProfile() async throws -> Profile {
        guard let url = config.apiURL("/api/profiles/me") else {
            throw APIError.invalidURL
        }
        let request = buildRequest(url)
        let (data, response) = try await performDataRequest(request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.invalidResponse
        }
        let decoded = try JSONDecoder().decode(ProfileResponse.self, from: data)
        guard let profile = decoded.profile else {
            throw APIError.invalidResponse
        }
        // Mirror the server's daily goal into local @AppStorage so the goal
        // ring + celebrations across the app reflect changes the user made
        // on web (or another iOS device after sync).
        if let goal = profile.dailyGoalMinutes {
            UserDefaults.standard.set(goal, forKey: "compendus.dailyGoalMinutes")
        }
        return profile
    }

    /// Update the current profile's daily reading goal. Returns the refreshed
    /// profile so callers can update local state.
    @discardableResult
    func updateDailyGoal(profileId: String, minutes: Int) async throws -> Profile {
        guard let url = config.apiURL("/api/profiles/\(profileId)") else {
            throw APIError.invalidURL
        }
        var request = buildRequest(url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = ["dailyGoalMinutes": minutes]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await performDataRequest(request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.invalidResponse
        }
        let decoded = try JSONDecoder().decode(ProfileResponse.self, from: data)
        guard let profile = decoded.profile else {
            throw APIError.invalidResponse
        }
        if let goal = profile.dailyGoalMinutes {
            UserDefaults.standard.set(goal, forKey: "compendus.dailyGoalMinutes")
        }
        return profile
    }

    /// Create a new profile
    func createProfile(name: String, avatar: String? = nil, pin: String? = nil) async throws -> Profile {
        guard let url = config.apiURL("/api/profiles") else {
            throw APIError.invalidURL
        }
        var request = buildRequest(url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(ProfileCreateRequest(name: name, avatar: avatar, pin: pin))
        let (data, response) = try await performDataRequest(request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        let decoded = try JSONDecoder().decode(ProfileResponse.self, from: data)
        guard (200...299).contains(httpResponse.statusCode), let profile = decoded.profile else {
            throw APIError.serverError(httpResponse.statusCode, decoded.error)
        }
        return profile
    }

    /// Update a profile (name, avatar emoji)
    func updateProfile(id: String, name: String? = nil, avatar: String?? = nil, pin: String?? = nil) async throws -> Profile {
        guard let url = config.apiURL("/api/profiles/\(id)") else {
            throw APIError.invalidURL
        }
        var request = buildRequest(url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body: [String: Any] = [:]
        if let name { body["name"] = name }
        if let avatarValue = avatar {
            if let av = avatarValue {
                body["avatar"] = av
            } else {
                body["avatar"] = NSNull()
            }
        }
        if let pinValue = pin {
            if let p = pinValue {
                body["pin"] = p
            } else {
                body["pin"] = NSNull()
            }
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await performDataRequest(request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.invalidResponse
        }
        let decoded = try JSONDecoder().decode(ProfileResponse.self, from: data)
        guard let profile = decoded.profile else {
            throw APIError.invalidResponse
        }
        return profile
    }

    /// Upload a profile avatar image
    func uploadProfileAvatar(profileId: String, imageData: Data) async throws -> Profile {
        guard let url = config.apiURL("/api/profiles/\(profileId)/avatar") else {
            throw APIError.invalidURL
        }

        let boundary = "Boundary-\(UUID().uuidString)"
        var request = buildRequest(url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"avatar\"; filename=\"avatar.jpg\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(imageData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body

        let (data, response) = try await performDataRequest(request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.invalidResponse
        }
        let decoded = try JSONDecoder().decode(ProfileResponse.self, from: data)
        guard let profile = decoded.profile else {
            throw APIError.invalidResponse
        }
        return profile
    }

    /// Delete a profile avatar image
    func deleteProfileAvatar(profileId: String) async throws -> Profile {
        guard let url = config.apiURL("/api/profiles/\(profileId)/avatar") else {
            throw APIError.invalidURL
        }
        var request = buildRequest(url)
        request.httpMethod = "DELETE"
        let (data, response) = try await performDataRequest(request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.invalidResponse
        }
        let decoded = try JSONDecoder().decode(ProfileResponse.self, from: data)
        guard let profile = decoded.profile else {
            throw APIError.invalidResponse
        }
        return profile
    }

    /// Delete a profile by ID
    func deleteProfile(id: String) async throws {
        guard let url = config.apiURL("/api/profiles/\(id)") else {
            throw APIError.invalidURL
        }
        var request = buildRequest(url)
        request.httpMethod = "DELETE"
        let (_, response) = try await performDataRequest(request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.invalidResponse
        }
    }

    // MARK: - Private Helpers

    /// Build a URLRequest for the given URL, automatically adding the X-Profile-Id header
    private func buildRequest(_ url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        request.setValue(UUID().uuidString, forHTTPHeaderField: "X-Request-Id")
        if let profileId = config.selectedProfileId {
            request.setValue(profileId, forHTTPHeaderField: "X-Profile-Id")
        }
        return request
    }

    private func fetch<T: Decodable>(_ url: URL) async throws -> T {
        let data = try await fetchData(url)

        do {
            let decoder = JSONDecoder()
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    /// Typed non-GET request with the same status/profile handling as `fetchData`.
    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        guard ConnectivityMonitor.shared.permitsNetworkRequests else { throw APIError.offline }
        do {
            let (data, response) = try await performDataRequest(request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            if httpResponse.statusCode == 401,
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               json["code"] as? String == "NO_PROFILE" {
                await MainActor.run { config.invalidateProfile() }
                throw APIError.profileRequired
            }
            guard (200...299).contains(httpResponse.statusCode) else {
                let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
                throw APIError.serverError(httpResponse.statusCode, message)
            }
            do {
                return try JSONDecoder().decode(T.self, from: data)
            } catch {
                throw APIError.decodingError(error)
            }
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.networkError(error)
        }
    }

    private func fetchData(_ url: URL) async throws -> Data {
        guard ConnectivityMonitor.shared.permitsNetworkRequests else { throw APIError.offline }
        let startedAt = Date()
        do {
            let request = buildRequest(url)
            let (data, response) = try await performDataRequest(request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }

            let durationMs = Date().timeIntervalSince(startedAt) * 1_000
            let requestId = httpResponse.value(forHTTPHeaderField: "X-Request-Id") ?? "unknown"
            apiLogger.info(
                "GET \(url.path, privacy: .public) request_id=\(requestId, privacy: .public) status=\(httpResponse.statusCode) duration_ms=\(durationMs, format: .fixed(precision: 1)) bytes=\(data.count)"
            )

            // Detect stale profile: server says NO_PROFILE → invalidate and preserve old ID for migration
            if httpResponse.statusCode == 401 {
                if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   json["code"] as? String == "NO_PROFILE" {
                    await MainActor.run {
                        config.invalidateProfile()
                    }
                    throw APIError.profileRequired
                }
            }

            guard (200...299).contains(httpResponse.statusCode) else {
                // Never surface a raw error body to the reader: a 5xx is usually
                // the proxy's HTML "Starting Up" page. Keep a JSON {error} message
                // if present; otherwise let errorDescription give a clean,
                // status-based phrase.
                let body = (String(data: data, encoding: .utf8) ?? "")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                var message: String?
                if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let err = json["error"] as? String {
                    message = err
                } else if !body.isEmpty && !body.hasPrefix("<") {
                    message = String(body.prefix(140))
                }
                throw APIError.serverError(httpResponse.statusCode, message)
            }

            return data
        } catch let error as APIError {
            let durationMs = Date().timeIntervalSince(startedAt) * 1_000
            apiLogger.error(
                "GET \(url.path, privacy: .public) failed duration_ms=\(durationMs, format: .fixed(precision: 1)) error=\(error.localizedDescription, privacy: .public)"
            )
            throw error
        } catch {
            let durationMs = Date().timeIntervalSince(startedAt) * 1_000
            apiLogger.error(
                "GET \(url.path, privacy: .public) failed duration_ms=\(durationMs, format: .fixed(precision: 1)) error=\(error.localizedDescription, privacy: .public)"
            )
            throw APIError.networkError(error)
        }
    }
}

struct DownloadArtifactManifest: Codable {
    let artifactId: String
    let bookId: String
    let url: String
    let format: String
    let originalFormat: String
    let byteLength: Int64
    let sha256: String
    let artifactVersion: Int
    let ccdVersion: String?
    let peakDiskBytes: Int64
}

struct ComicInfo: Codable {
    let pageCount: Int
}

struct ConversionResponse: Codable {
    let success: Bool
    let jobId: String?
    let alreadyConverted: Bool?
    let pending: Bool?
    let convertedEpubSize: Int?
}

struct JobProgressResponse: Codable {
    let success: Bool
    let id: String?
    let status: String?
    let progress: Int?
    let message: String?
}

// MARK: - Book Editing Types

/// Request body for updating book metadata (only encodes non-nil fields)
nonisolated struct UpdateBookRequest: Codable {
    var title: String? = nil
    var subtitle: String? = nil
    var authors: [String]? = nil
    var publisher: String? = nil
    var publishedDate: String? = nil
    var description: String? = nil
    var isbn: String? = nil
    var language: String? = nil
    var pageCount: Int? = nil
    var series: String? = nil
    var seriesNumber: String? = nil
    var isRead: Bool? = nil
    var isSetAside: Bool? = nil
    var rating: Int? = nil
    var review: String? = nil
    var source: String = "ios"

    enum CodingKeys: String, CodingKey {
        case title, subtitle, authors, publisher, publishedDate
        case description, isbn, language, pageCount, series, seriesNumber
        case isRead, isSetAside, rating, review, source
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(title, forKey: .title)
        try container.encodeIfPresent(subtitle, forKey: .subtitle)
        try container.encodeIfPresent(authors, forKey: .authors)
        try container.encodeIfPresent(publisher, forKey: .publisher)
        try container.encodeIfPresent(publishedDate, forKey: .publishedDate)
        try container.encodeIfPresent(description, forKey: .description)
        try container.encodeIfPresent(isbn, forKey: .isbn)
        try container.encodeIfPresent(language, forKey: .language)
        try container.encodeIfPresent(pageCount, forKey: .pageCount)
        try container.encodeIfPresent(series, forKey: .series)
        try container.encodeIfPresent(seriesNumber, forKey: .seriesNumber)
        try container.encodeIfPresent(isRead, forKey: .isRead)
        try container.encodeIfPresent(isSetAside, forKey: .isSetAside)
        try container.encodeIfPresent(rating, forKey: .rating)
        try container.encodeIfPresent(review, forKey: .review)
        try container.encode(source, forKey: .source)
    }
}

// MARK: - Tag Types

struct BookTag: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let color: String?
    // Server returns this as an ISO-8601 string; keep as String? so decoding doesn't fail.
    let createdAt: String?
}

struct BookTagsResponse: Codable {
    let success: Bool
    let tags: [BookTag]
}

struct AddTagResponse: Codable {
    let success: Bool
    let tag: BookTag
}

// MARK: - Collection Types

/// A library collection. Named `BookCollection` to avoid shadowing the
/// Swift standard library `Collection` protocol.
struct BookCollection: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let color: String?
    let icon: String?
}

struct CollectionsResponse: Codable {
    let success: Bool
    let collections: [BookCollection]
}
