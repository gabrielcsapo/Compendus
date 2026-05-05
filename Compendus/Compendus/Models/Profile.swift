//
//  Profile.swift
//  Compendus
//
//  Profile model for multi-user profile system
//

import Foundation

struct Profile: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let avatar: String?
    let avatarUrl: String?
    let hasPin: Bool
    let isAdmin: Bool
    /// User-set daily reading goal in minutes. Drives the goal ring + celebrations.
    /// Optional in the JSON for backwards-compatibility with older server builds.
    let dailyGoalMinutes: Int?
    let createdAt: String?

    /// Whether the avatar is an uploaded image (vs emoji or nil)
    var hasImageAvatar: Bool {
        avatar?.hasPrefix("data/") ?? false
    }
}

struct ProfilesResponse: Codable {
    let success: Bool
    let profiles: [Profile]
}

struct ProfileResponse: Codable {
    let success: Bool
    let profile: Profile?
    let error: String?
    let code: String?
}

struct ProfileCreateRequest: Codable {
    let name: String
    let avatar: String?
    let pin: String?
}

struct ProfileSelectRequest: Codable {
    let pin: String?
}
