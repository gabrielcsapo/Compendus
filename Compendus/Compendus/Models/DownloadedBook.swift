//
//  DownloadedBook.swift
//  Compendus
//
//  SwiftData model for offline book storage
//

import Foundation
import SwiftData

@Model
final class DownloadedBook {
    @Attribute(.unique) var id: String
    var title: String
    var subtitle: String?
    var authors: [String]
    var publisher: String?
    var publishedDate: String?
    var bookDescription: String?
    var format: String
    var fileSize: Int
    var localPath: String           // Relative path in app documents
    var coverData: Data?            // Cached cover image
    var downloadedAt: Date
    var lastReadAt: Date?
    var readingProgress: Double     // 0.0 - 1.0
    var lastPosition: String?       // Format-specific position (page number, CFI, timestamp)
    var isRead: Bool = false        // Explicitly marked as read/completed
    var rating: Int?                // 1-5 star rating, nil = unrated
    var review: String?             // Free-text review
    var series: String?
    var seriesNumber: Double?
    var duration: Int?              // Audiobooks (in seconds)
    var narrator: String?           // Audiobooks
    var chaptersData: Data?         // JSON encoded chapters for audiobooks
    var pageCount: Int?             // Comics page count (cached)
    var epubLocalPath: String?       // Local path for converted EPUB version
    var transcriptData: Data?        // JSON encoded transcript for audiobooks
    var ttsTranscriptData: Data?      // JSON encoded transcript from TTS generation
    var ttsVoiceId: Int?              // Voice index used for TTS generation (cache invalidation key)

    init(
        id: String,
        title: String,
        subtitle: String? = nil,
        authors: [String],
        publisher: String? = nil,
        publishedDate: String? = nil,
        bookDescription: String? = nil,
        format: String,
        fileSize: Int,
        localPath: String,
        coverData: Data? = nil,
        downloadedAt: Date = Date(),
        series: String? = nil,
        seriesNumber: Double? = nil,
        duration: Int? = nil,
        narrator: String? = nil,
        chaptersData: Data? = nil,
        pageCount: Int? = nil
    ) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.authors = authors
        self.publisher = publisher
        self.publishedDate = publishedDate
        self.bookDescription = bookDescription
        self.format = format
        self.fileSize = fileSize
        self.localPath = localPath
        self.coverData = coverData
        self.downloadedAt = downloadedAt
        self.lastReadAt = nil
        self.readingProgress = 0.0
        self.lastPosition = nil
        self.isRead = false
        self.rating = nil
        self.review = nil
        self.series = series
        self.seriesNumber = seriesNumber
        self.duration = duration
        self.narrator = narrator
        self.chaptersData = chaptersData
        self.pageCount = pageCount
    }

    var authorsDisplay: String {
        authors.joined(separator: ", ")
    }

    var formatDisplay: String {
        format.uppercased()
    }

    var fileSizeDisplay: String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(fileSize))
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

    var chapters: [Chapter]? {
        guard let data = chaptersData else { return nil }
        return try? JSONDecoder().decode([Chapter].self, from: data)
    }

    var transcript: Transcript? {
        guard let data = transcriptData else { return nil }
        return try? JSONDecoder().decode(Transcript.self, from: data)
    }

    var hasTranscript: Bool {
        transcriptData != nil
    }

    var ttsTranscript: Transcript? {
        guard let data = ttsTranscriptData else { return nil }
        return try? JSONDecoder().decode(Transcript.self, from: data)
    }

    var hasTTSTranscript: Bool {
        ttsTranscriptData != nil
    }

    /// Get the full file URL in the app's documents directory
    var fileURL: URL? {
        guard let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
            return nil
        }
        return documentsURL.appendingPathComponent(localPath)
    }

    /// Get the full file URL for the converted EPUB version
    var epubFileURL: URL? {
        guard let path = epubLocalPath,
              let documentsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
            return nil
        }
        return documentsURL.appendingPathComponent(path)
    }

    var hasEpubVersion: Bool {
        if let path = epubLocalPath,
           let url = epubFileURL {
            return !path.isEmpty && FileManager.default.fileExists(atPath: url.path)
        }
        return false
    }

    /// Update metadata from a fresh server Book response
    /// Preserves local-only fields (localPath, coverData, downloadedAt, reading progress, etc.)
    func updateMetadata(from book: Book, coverData: Data? = nil) {
        title = book.title
        subtitle = book.subtitle
        authors = book.authors
        publisher = book.publisher
        publishedDate = book.publishedDate
        bookDescription = book.description
        series = book.series
        narrator = book.narrator
        duration = book.duration
        pageCount = book.pageCount

        if let numStr = book.seriesNumber {
            seriesNumber = Double(numStr)
        } else {
            seriesNumber = nil
        }

        if let chapters = book.chapters {
            chaptersData = try? JSONEncoder().encode(chapters)
        }

        // Sync read status, rating, and review from server
        if let serverIsRead = book.isRead {
            isRead = serverIsRead
        }
        if let serverRating = book.rating {
            rating = serverRating
        }
        if let serverReview = book.review {
            review = serverReview
        }

        // Update cover if new data is provided
        if let newCover = coverData {
            self.coverData = newCover
        }
    }

    /// Create from a Book API response
    static func from(book: Book, localPath: String, coverData: Data? = nil) -> DownloadedBook {
        var chaptersData: Data? = nil
        if let chapters = book.chapters {
            chaptersData = try? JSONEncoder().encode(chapters)
        }

        // Convert seriesNumber from String to Double
        var seriesNumberDouble: Double? = nil
        if let numStr = book.seriesNumber {
            seriesNumberDouble = Double(numStr)
        }

        let downloaded = DownloadedBook(
            id: book.id,
            title: book.title,
            subtitle: book.subtitle,
            authors: book.authors,
            publisher: book.publisher,
            publishedDate: book.publishedDate,
            bookDescription: book.description,
            format: book.format,
            fileSize: book.fileSize ?? 0,
            localPath: localPath,
            coverData: coverData,
            series: book.series,
            seriesNumber: seriesNumberDouble,
            duration: book.duration,
            narrator: book.narrator,
            chaptersData: chaptersData,
            pageCount: book.pageCount
        )
        downloaded.isRead = book.isRead ?? false
        downloaded.rating = book.rating
        downloaded.review = book.review
        return downloaded
    }
}
