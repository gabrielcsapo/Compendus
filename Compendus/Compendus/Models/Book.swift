//
//  Book.swift
//  Compendus
//
//  API response model for books from the server
//

import Foundation

/// Book model matching the server's ApiBook format
struct Book: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let subtitle: String?
    let authors: [String]
    let publisher: String?
    let publishedDate: String?
    let description: String?
    let isbn: String?
    let isbn10: String?
    let isbn13: String?
    let language: String?
    let pageCount: Int?
    let format: String
    let series: String?
    let seriesNumber: String?  // Server returns String, not Double
    let coverUrl: String?      // Server uses coverUrl, not coverPath
    let addedAt: String?       // Server uses addedAt, not createdAt

    // These fields are in the database but not exposed in ApiBook
    // We'll get them from a separate endpoint or infer them
    var fileSize: Int?
    var duration: Int?           // Audiobooks (in seconds)
    var narrator: String?        // Audiobooks
    var chapters: [Chapter]?     // Audiobooks

    var authorsDisplay: String {
        authors.isEmpty ? "Unknown Author" : authors.joined(separator: ", ")
    }

    var formatDisplay: String {
        format.uppercased()
    }

    var fileSizeDisplay: String {
        guard let size = fileSize else { return "Unknown" }
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(size))
    }

    var durationDisplay: String? {
        guard let duration = duration else { return nil }
        let hours = duration / 3600
        let minutes = (duration % 3600) / 60
        if hours > 0 {
            return "\(hours)h \(minutes)m"
        }
        return "\(minutes)m"
    }

    var isAudiobook: Bool {
        ["m4b", "mp3", "m4a"].contains(format.lowercased())
    }

    var isComic: Bool {
        ["cbr", "cbz"].contains(format.lowercased())
    }

    var isEbook: Bool {
        ["epub", "pdf", "mobi", "azw", "azw3"].contains(format.lowercased())
    }

    var seriesNumberDouble: Double? {
        guard let num = seriesNumber else { return nil }
        return Double(num)
    }

    // Custom coding keys to handle optional fields not in API response
    enum CodingKeys: String, CodingKey {
        case id, title, subtitle, authors, publisher, publishedDate
        case description, isbn, isbn10, isbn13, language, pageCount
        case format, series, seriesNumber, coverUrl, addedAt
        case fileSize, duration, narrator, chapters
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        subtitle = try container.decodeIfPresent(String.self, forKey: .subtitle)
        authors = try container.decodeIfPresent([String].self, forKey: .authors) ?? []
        publisher = try container.decodeIfPresent(String.self, forKey: .publisher)
        publishedDate = try container.decodeIfPresent(String.self, forKey: .publishedDate)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        isbn = try container.decodeIfPresent(String.self, forKey: .isbn)
        isbn10 = try container.decodeIfPresent(String.self, forKey: .isbn10)
        isbn13 = try container.decodeIfPresent(String.self, forKey: .isbn13)
        language = try container.decodeIfPresent(String.self, forKey: .language)
        pageCount = try container.decodeIfPresent(Int.self, forKey: .pageCount)
        format = try container.decode(String.self, forKey: .format)
        series = try container.decodeIfPresent(String.self, forKey: .series)
        seriesNumber = try container.decodeIfPresent(String.self, forKey: .seriesNumber)
        coverUrl = try container.decodeIfPresent(String.self, forKey: .coverUrl)
        addedAt = try container.decodeIfPresent(String.self, forKey: .addedAt)
        fileSize = try container.decodeIfPresent(Int.self, forKey: .fileSize)
        duration = try container.decodeIfPresent(Int.self, forKey: .duration)
        narrator = try container.decodeIfPresent(String.self, forKey: .narrator)
        chapters = try container.decodeIfPresent([Chapter].self, forKey: .chapters)
    }

    init(
        id: String,
        title: String,
        subtitle: String? = nil,
        authors: [String] = [],
        publisher: String? = nil,
        publishedDate: String? = nil,
        description: String? = nil,
        isbn: String? = nil,
        isbn10: String? = nil,
        isbn13: String? = nil,
        language: String? = nil,
        pageCount: Int? = nil,
        format: String,
        series: String? = nil,
        seriesNumber: String? = nil,
        coverUrl: String? = nil,
        addedAt: String? = nil,
        fileSize: Int? = nil,
        duration: Int? = nil,
        narrator: String? = nil,
        chapters: [Chapter]? = nil
    ) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.authors = authors
        self.publisher = publisher
        self.publishedDate = publishedDate
        self.description = description
        self.isbn = isbn
        self.isbn10 = isbn10
        self.isbn13 = isbn13
        self.language = language
        self.pageCount = pageCount
        self.format = format
        self.series = series
        self.seriesNumber = seriesNumber
        self.coverUrl = coverUrl
        self.addedAt = addedAt
        self.fileSize = fileSize
        self.duration = duration
        self.narrator = narrator
        self.chapters = chapters
    }
}

struct Chapter: Codable, Identifiable, Hashable {
    var id: String { "\(startTime)-\(title)" }
    let title: String
    let startTime: Double  // in seconds
    let endTime: Double?

    enum CodingKeys: String, CodingKey {
        case title, startTime, endTime
    }

    var startTimeDisplay: String {
        let hours = Int(startTime) / 3600
        let minutes = (Int(startTime) % 3600) / 60
        let seconds = Int(startTime) % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, seconds)
        }
        return String(format: "%d:%02d", minutes, seconds)
    }
}

/// Search result wrapper from API
struct SearchResult: Codable {
    let book: Book
    let relevance: Double
    let highlights: SearchHighlights?
}

struct SearchHighlights: Codable {
    let title: String?
    let authors: String?
    let description: String?
    let content: String?
    let chapterTitle: String?
}

/// API response for /api/books and /api/search
struct BooksResponse: Codable {
    let success: Bool
    let query: String
    let total: Int
    let totalCount: Int?  // Total items in database (for pagination)
    let limit: Int
    let offset: Int
    let results: [SearchResult]

    /// Extract just the books from results
    var books: [Book] {
        results.map { $0.book }
    }
}

/// Alias for search - same format
typealias SearchResponse = BooksResponse

/// API response for /api/books/:id
struct BookResponse: Codable {
    let success: Bool
    let book: Book
}
