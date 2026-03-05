//
//  ServerConfig.swift
//  Compendus
//
//  Server connection configuration with UserDefaults persistence
//

import Foundation

@Observable
class ServerConfig {
    private let defaults = UserDefaults.standard
    private let serverURLKey = "serverURL"
    private let profileIdKey = "selectedProfileId"
    private let profileNameKey = "selectedProfileName"
    private let profileAvatarKey = "selectedProfileAvatar"
    private let profileIsAdminKey = "selectedProfileIsAdmin"
    private let invalidatedProfileIdKey = "invalidatedProfileId"

    var serverURL: String {
        didSet {
            defaults.set(serverURL, forKey: serverURLKey)
        }
    }

    var selectedProfileId: String? {
        didSet {
            if let id = selectedProfileId {
                defaults.set(id, forKey: profileIdKey)
            } else {
                defaults.removeObject(forKey: profileIdKey)
            }
        }
    }

    var selectedProfileName: String? {
        didSet {
            if let name = selectedProfileName {
                defaults.set(name, forKey: profileNameKey)
            } else {
                defaults.removeObject(forKey: profileNameKey)
            }
        }
    }

    var selectedProfileAvatar: String? {
        didSet {
            if let avatar = selectedProfileAvatar {
                defaults.set(avatar, forKey: profileAvatarKey)
            } else {
                defaults.removeObject(forKey: profileAvatarKey)
            }
        }
    }

    var selectedProfileIsAdmin: Bool {
        didSet {
            defaults.set(selectedProfileIsAdmin, forKey: profileIsAdminKey)
        }
    }

    /// When a profile is deleted server-side, the old profileId is stored here
    /// so local data can be migrated to a new profile.
    var invalidatedProfileId: String? {
        didSet {
            if let id = invalidatedProfileId {
                defaults.set(id, forKey: invalidatedProfileIdKey)
            } else {
                defaults.removeObject(forKey: invalidatedProfileIdKey)
            }
        }
    }

    var isConfigured: Bool {
        !serverURL.isEmpty
    }

    var isProfileSelected: Bool {
        selectedProfileId != nil
    }

    var baseURL: URL? {
        guard !serverURL.isEmpty else { return nil }

        var urlString = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)

        // Add http:// if no scheme provided
        if !urlString.hasPrefix("http://") && !urlString.hasPrefix("https://") {
            urlString = "http://\(urlString)"
        }

        // Remove trailing slash
        if urlString.hasSuffix("/") {
            urlString.removeLast()
        }

        return URL(string: urlString)
    }

    init() {
        self.serverURL = defaults.string(forKey: serverURLKey) ?? ""
        self.selectedProfileId = defaults.string(forKey: profileIdKey)
        self.selectedProfileName = defaults.string(forKey: profileNameKey)
        self.selectedProfileAvatar = defaults.string(forKey: profileAvatarKey)
        self.selectedProfileIsAdmin = defaults.bool(forKey: profileIsAdminKey)
        self.invalidatedProfileId = defaults.string(forKey: invalidatedProfileIdKey)
    }

    /// Build a URL for an API endpoint
    func apiURL(_ path: String) -> URL? {
        guard let base = baseURL else { return nil }
        let cleanPath = path.hasPrefix("/") ? path : "/\(path)"
        return URL(string: "\(base.absoluteString)\(cleanPath)")
    }

    /// Whether the current profile's avatar is an uploaded image (vs emoji)
    var hasImageAvatar: Bool {
        selectedProfileAvatar?.hasPrefix("data/") ?? false
    }

    /// Build a URL for the current profile's avatar image (nil if emoji or no avatar)
    var selectedProfileAvatarURL: URL? {
        guard hasImageAvatar, let id = selectedProfileId else { return nil }
        return avatarURL(for: id)
    }

    /// Build a URL for a profile avatar image
    func avatarURL(for profileId: String) -> URL? {
        apiURL("/avatars/\(profileId).jpg")
    }

    /// Build a URL for a book cover (full size 600x900)
    func coverURL(for bookId: String) -> URL? {
        apiURL("/covers/\(bookId).jpg")
    }

    /// Build a URL for a book cover thumbnail (200x300)
    func coverThumbnailURL(for bookId: String) -> URL? {
        apiURL("/covers/\(bookId).thumb.jpg")
    }

    /// Build a URL for downloading a book file
    func bookFileURL(for bookId: String, format: String) -> URL? {
        apiURL("/books/\(bookId).\(format)")
    }

    /// Build a URL for downloading a CBR as CBZ (for offline reading support)
    func bookAsCbzURL(for bookId: String) -> URL? {
        apiURL("/books/\(bookId)/as-cbz")
    }

    /// Build a URL for triggering EPUB conversion (supports PDF, MOBI, AZW3)
    func convertToEpubURL(for bookId: String) -> URL? {
        apiURL("/api/books/\(bookId)/convert-to-epub")
    }

    /// Build a URL for downloading the converted EPUB (auto-converts MOBI/AZW3 on first request)
    func bookAsEpubURL(for bookId: String) -> URL? {
        apiURL("/books/\(bookId)/as-epub")
    }

    /// Build a URL for checking job progress
    func jobProgressURL(for jobId: String) -> URL? {
        apiURL("/api/jobs/\(jobId)")
    }

    /// Build a URL for a comic page
    func comicPageURL(for bookId: String, format: String, page: Int) -> URL? {
        apiURL("/comic/\(bookId)/\(format)/page/\(page)")
    }

    /// Build a URL for comic info (page count)
    func comicInfoURL(for bookId: String, format: String) -> URL? {
        apiURL("/comic/\(bookId)/\(format)/info")
    }

    func selectProfile(_ profile: Profile) {
        selectedProfileId = profile.id
        selectedProfileName = profile.name
        selectedProfileAvatar = profile.avatar
        selectedProfileIsAdmin = profile.isAdmin
    }

    func clearProfile() {
        selectedProfileId = nil
        selectedProfileName = nil
        selectedProfileAvatar = nil
        selectedProfileIsAdmin = false
    }

    /// Called when the server rejects the current profile (deleted server-side).
    /// Stores the old profileId so local SwiftData records can be migrated to a new profile.
    func invalidateProfile() {
        invalidatedProfileId = selectedProfileId
        clearProfile()
    }

    /// Clear the invalidated profile after data has been migrated.
    func clearInvalidatedProfile() {
        invalidatedProfileId = nil
    }

    /// Test connection to the server
    func testConnection() async -> Bool {
        guard let url = apiURL("/api/books?limit=1") else { return false }

        do {
            let (_, response) = try await URLSession.shared.data(from: url)
            guard let httpResponse = response as? HTTPURLResponse else { return false }
            return (200...299).contains(httpResponse.statusCode)
        } catch {
            return false
        }
    }
}
