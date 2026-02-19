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
    var series: String?
    var seriesNumber: Double?
    var duration: Int?              // Audiobooks (in seconds)
    var narrator: String?           // Audiobooks
    var chaptersData: Data?         // JSON encoded chapters for audiobooks
    var pageCount: Int?             // Comics page count (cached)
    var epubLocalPath: String?       // Local path for converted EPUB version

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

        return DownloadedBook(
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
    }
}
