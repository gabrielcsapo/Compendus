//
//  PendingBookEdit.swift
//  Compendus
//
//  SwiftData model for queuing offline book edits for background sync
//

import Foundation
import SwiftData

@Model
final class PendingBookEdit {
    @Attribute(.unique) var id: String
    var bookId: String
    var operationType: String       // "metadata", "addTag", "removeTag"
    var payload: Data               // JSON-encoded operation data
    var createdAt: Date
    var retryCount: Int
    var profileId: String = ""       // Profile that queued this edit (empty = legacy/unassigned)

    init(
        id: String = UUID().uuidString,
        bookId: String,
        operationType: String,
        payload: Data,
        createdAt: Date = Date(),
        retryCount: Int = 0
    ) {
        self.id = id
        self.bookId = bookId
        self.operationType = operationType
        self.payload = payload
        self.createdAt = createdAt
        self.retryCount = retryCount
    }

    /// Create a pending metadata update
    static func metadataUpdate(bookId: String, request: UpdateBookRequest) -> PendingBookEdit? {
        guard let payload = try? JSONEncoder().encode(request) else { return nil }
        return PendingBookEdit(bookId: bookId, operationType: "metadata", payload: payload)
    }

    /// Create a pending add-tag operation
    static func addTag(bookId: String, name: String) -> PendingBookEdit? {
        guard let payload = try? JSONEncoder().encode(["name": name]) else { return nil }
        return PendingBookEdit(bookId: bookId, operationType: "addTag", payload: payload)
    }

    /// Create a pending remove-tag operation
    static func removeTag(bookId: String, tagId: String) -> PendingBookEdit? {
        guard let payload = try? JSONEncoder().encode(["tagId": tagId]) else { return nil }
        return PendingBookEdit(bookId: bookId, operationType: "removeTag", payload: payload)
    }

    /// Create a pending isRead toggle
    static func toggleRead(bookId: String, isRead: Bool) -> PendingBookEdit? {
        var request = UpdateBookRequest()
        request.isRead = isRead
        guard let payload = try? JSONEncoder().encode(request) else { return nil }
        return PendingBookEdit(bookId: bookId, operationType: "metadata", payload: payload)
    }

    /// Create a pending rating/review update
    static func rateBook(bookId: String, rating: Int?, review: String?) -> PendingBookEdit? {
        var request = UpdateBookRequest()
        request.rating = rating
        request.review = review
        guard let payload = try? JSONEncoder().encode(request) else { return nil }
        return PendingBookEdit(bookId: bookId, operationType: "metadata", payload: payload)
    }
}
