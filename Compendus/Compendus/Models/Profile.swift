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
    let hasPin: Bool
    let isAdmin: Bool
    let createdAt: String?
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
