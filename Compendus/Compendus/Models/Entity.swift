//
//  Entity.swift
//  Compendus
//
//  Models for the Living Library knowledge graph (/api/graph/*).
//

import Foundation

/// A node in the knowledge graph: a person, place, idea, work, etc.
/// The list endpoint omits `mentions`; the detail endpoint includes them.
struct GraphEntity: Codable, Identifiable, Hashable {
    let id: String
    let type: String
    let canonicalName: String
    let summary: String?
    let mentionCount: Int
    let bookCount: Int
    let dateText: String?
    let mentions: [EntityMention]?
}

/// One grounded occurrence of an entity, anchored to a passage in a book.
struct EntityMention: Codable, Hashable {
    let passageId: String
    let bookId: String
    let bookTitle: String
    let chapterTitle: String?
    let position: Double?
    let surfaceText: String
    let snippet: String
}

/// A grounded next step to wander to, with a human-readable reason.
struct WanderStep: Codable, Identifiable, Hashable {
    let kind: String
    let reason: String
    let entityId: String?
    let entityName: String?
    let entityType: String?
    let bookTitle: String?
    let snippet: String?

    var id: String { (entityId ?? "none") + "|" + reason }
}

struct EntitiesResponse: Codable {
    let success: Bool
    let entities: [GraphEntity]
}

struct EntityDetailResponse: Codable {
    let success: Bool
    let entity: GraphEntity
}

struct WanderResponse: Codable {
    let success: Bool
    let steps: [WanderStep]
}
