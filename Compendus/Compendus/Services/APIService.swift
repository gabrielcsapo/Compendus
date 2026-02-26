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
        }
    }
}

@Observable
class APIService {
    let config: ServerConfig

    init(config: ServerConfig) {
        self.config = config
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

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
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

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
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

    // MARK: - Downloads

    /// Get URL for downloading a book file
    func bookDownloadURL(bookId: String, format: String) -> URL? {
        config.bookFileURL(for: bookId, format: format)
    }

    // MARK: - Private Helpers

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
            let (data, response) = try await URLSession.shared.data(from: url)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
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
