//
//  DeviceReadingPosition.swift
//  Compendus
//
//  A reading position reported by ANOTHER device for a book, pulled during sync
//  so the user can see where each device left off and optionally jump to it.
//  The current device's own position lives on DownloadedBook; these are the rest.
//

import Foundation
import SwiftData

@Model
final class DeviceReadingPosition {
    /// Composite identity "bookId|deviceId" so sync upserts are stable.
    @Attribute(.unique) var id: String
    var bookId: String
    var deviceId: String
    var deviceName: String
    var deviceType: String
    var readingProgress: Double
    var lastPosition: String?
    var lastReadAt: Date?
    var profileId: String

    init(
        bookId: String,
        deviceId: String,
        deviceName: String,
        deviceType: String,
        readingProgress: Double,
        lastPosition: String?,
        lastReadAt: Date?,
        profileId: String
    ) {
        self.id = Self.compositeId(bookId: bookId, deviceId: deviceId)
        self.bookId = bookId
        self.deviceId = deviceId
        self.deviceName = deviceName
        self.deviceType = deviceType
        self.readingProgress = readingProgress
        self.lastPosition = lastPosition
        self.lastReadAt = lastReadAt
        self.profileId = profileId
    }

    static func compositeId(bookId: String, deviceId: String) -> String {
        "\(bookId)|\(deviceId)"
    }
}
