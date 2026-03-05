//
//  APIService.swift
//  Compendus
//
//  REST API client for communicating with the Compendus server
//

import Foundation

enum APIError: LocalizedError {
    case serverNotConfigured
    case invalidURL
    case networkError(Error)
    case invalidResponse
    case decodingError(Error)
    case serverError(Int, String?)
    case profileRequired

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
            return "Server error (\(code)): \(message ?? "Unknown error")"
        case .profileRequired:
            return "Your profile is no longer available on the server. Please select a new profile."
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
        configuration.waitsForConnectivity = true
        self.session = URLSession(configuration: configuration)
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
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            guard (200...299).contains(httpResponse.statusCode) else {
                let message = String(data: data, encoding: .utf8)
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
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            guard (200...299).contains(httpResponse.statusCode) else {
                let message = String(data: data, encoding: .utf8)
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

        let (data, response) = try await session.data(for: request)
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

        let (_, response) = try await session.data(for: request)
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
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            guard (200...299).contains(httpResponse.statusCode) else {
                let message = String(data: data, encoding: .utf8)
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
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            guard (200...299).contains(httpResponse.statusCode) else {
                let message = String(data: data, encoding: .utf8)
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

        let (_, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.serverError((response as? HTTPURLResponse)?.statusCode ?? 0, nil)
        }
    }

    // MARK: - Downloads

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
        let (data, response) = try await session.data(for: request)
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
        let (data, response) = try await session.data(for: request)
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
        let (data, response) = try await session.data(for: request)
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

    /// Create a new profile
    func createProfile(name: String, avatar: String? = nil, pin: String? = nil) async throws -> Profile {
        guard let url = config.apiURL("/api/profiles") else {
            throw APIError.invalidURL
        }
        var request = buildRequest(url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(ProfileCreateRequest(name: name, avatar: avatar, pin: pin))
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        let decoded = try JSONDecoder().decode(ProfileResponse.self, from: data)
        guard (200...299).contains(httpResponse.statusCode), let profile = decoded.profile else {
            throw APIError.serverError(httpResponse.statusCode, decoded.error)
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
        let (_, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.invalidResponse
        }
    }

    // MARK: - Private Helpers

    /// Build a URLRequest for the given URL, automatically adding the X-Profile-Id header
    private func buildRequest(_ url: URL) -> URLRequest {
        var request = URLRequest(url: url)
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

    private func fetchData(_ url: URL) async throws -> Data {
        do {
            let request = buildRequest(url)
            let (data, response) = try await session.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }

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
                let message = String(data: data, encoding: .utf8)
                throw APIError.serverError(httpResponse.statusCode, message)
            }

            return data
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.networkError(error)
        }
    }
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
struct UpdateBookRequest: Codable {
    var title: String?
    var subtitle: String?
    var authors: [String]?
    var publisher: String?
    var publishedDate: String?
    var description: String?
    var isbn: String?
    var language: String?
    var pageCount: Int?
    var series: String?
    var seriesNumber: String?
    var isRead: Bool?
    var rating: Int?
    var review: String?
    var source: String = "ios"

    enum CodingKeys: String, CodingKey {
        case title, subtitle, authors, publisher, publishedDate
        case description, isbn, language, pageCount, series, seriesNumber
        case isRead, rating, review, source
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
    let createdAt: Int?
}

struct BookTagsResponse: Codable {
    let success: Bool
    let tags: [BookTag]
}

struct AddTagResponse: Codable {
    let success: Bool
    let tag: BookTag
}
