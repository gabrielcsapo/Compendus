//
//  PendingDownload.swift
//  Compendus
//
//  Persists download queue so background downloads survive app termination.
//

import Foundation
import SwiftData

@Model
final class PendingDownload {
    @Attribute(.unique) var id: String       // Same as book ID
    var bookId: String
    var title: String
    var authors: [String]
    var format: String                       // Target local format (cbz for cbr, epub for mobi)
    var originalFormat: String               // Original server format
    var fileSize: Int
    var downloadURL: String                  // Full URL string
    var status: String                       // "pending", "downloading", "completed", "failed"
    var errorMessage: String?
    var queuedAt: Date
    var coverData: Data?

    // Book metadata carried forward to create DownloadedBook on completion
    var subtitle: String?
    var publisher: String?
    var publishedDate: String?
    var bookDescription: String?
    var series: String?
    var seriesNumber: Double?
    var duration: Int?
    var narrator: String?
    var chaptersData: Data?
    var pageCount: Int?
    var profileId: String = ""       // Profile that queued this download (empty = legacy/unassigned)

    init(
        id: String,
        bookId: String,
        title: String,
        authors: [String],
        format: String,
        originalFormat: String,
        fileSize: Int,
        downloadURL: String,
        status: String = "pending",
        queuedAt: Date = Date(),
        coverData: Data? = nil,
        subtitle: String? = nil,
        publisher: String? = nil,
        publishedDate: String? = nil,
        bookDescription: String? = nil,
        series: String? = nil,
        seriesNumber: Double? = nil,
        duration: Int? = nil,
        narrator: String? = nil,
        chaptersData: Data? = nil,
        pageCount: Int? = nil
    ) {
        self.id = id
        self.bookId = bookId
        self.title = title
        self.authors = authors
        self.format = format
        self.originalFormat = originalFormat
        self.fileSize = fileSize
        self.downloadURL = downloadURL
        self.status = status
        self.queuedAt = queuedAt
        self.coverData = coverData
        self.subtitle = subtitle
        self.publisher = publisher
        self.publishedDate = publishedDate
        self.bookDescription = bookDescription
        self.series = series
        self.seriesNumber = seriesNumber
        self.duration = duration
        self.narrator = narrator
        self.chaptersData = chaptersData
        self.pageCount = pageCount
    }

    /// Create from a Book API model and resolved download URL
    static func from(book: Book, downloadURL: URL, localFormat: String) -> PendingDownload {
        var chaptersData: Data? = nil
        if let chapters = book.chapters {
            chaptersData = try? JSONEncoder().encode(chapters)
        }

        return PendingDownload(
            id: book.id,
            bookId: book.id,
            title: book.title,
            authors: book.authors,
            format: localFormat,
            originalFormat: book.format,
            fileSize: book.fileSize ?? 0,
            downloadURL: downloadURL.absoluteString,
            subtitle: book.subtitle,
            publisher: book.publisher,
            publishedDate: book.publishedDate,
            bookDescription: book.description,
            series: book.series,
            seriesNumber: book.seriesNumberDouble,
            duration: book.duration,
            narrator: book.narrator,
            chaptersData: chaptersData,
            pageCount: book.pageCount
        )
    }

    /// Convert to DownloadedBook after download completes
    func toDownloadedBook(localPath: String, fileSize: Int, coverData: Data?) -> DownloadedBook {
        DownloadedBook(
            id: bookId,
            title: title,
            subtitle: subtitle,
            authors: authors,
            publisher: publisher,
            publishedDate: publishedDate,
            bookDescription: bookDescription,
            format: format,
            fileSize: fileSize,
            localPath: localPath,
            coverData: coverData ?? self.coverData,
            series: series,
            seriesNumber: seriesNumber,
            duration: duration,
            narrator: narrator,
            chaptersData: chaptersData,
            pageCount: pageCount,
            profileId: profileId
        )
    }
}
