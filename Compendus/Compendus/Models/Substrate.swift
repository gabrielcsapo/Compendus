//
//  Substrate.swift
//  Compendus
//
//  Models for the semantic substrate APIs (/api/wander2, /api/topics,
//  /api/trails): passage-centric wander stops, topics with coverage, and
//  curriculum study paths. Every step and study item IS a passage — real
//  author's words, grounded and openable in the reader.
//

import Foundation

/// One wander stop: a passage with its grounded next steps.
struct WanderStop: Codable, Identifiable, Hashable {
    let passageId: String
    let bookId: String
    let bookTitle: String
    let chapterTitle: String?
    let spineIndex: Int?
    /// Progress within the chapter (0-1); pairs with spineIndex as a reader locator.
    let chapterProgress: Double?
    let text: String
    let topicId: String?
    let topicLabel: String?
    let entities: [StopEntity]
    let steps: [WanderStopStep]

    var id: String { passageId }
}

struct StopEntity: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let type: String
}

/// A grounded step out of a stop, with a reason ("the same idea in …").
struct WanderStopStep: Codable, Identifiable, Hashable {
    let kind: String // same_idea | relationship | different_take | deeper | leave
    let passageId: String
    let bookId: String
    let bookTitle: String
    let snippet: String
    let reason: String

    var id: String { passageId + "|" + kind }

    var kindLabel: String {
        switch kind {
        case "same_idea": return "the same idea"
        case "relationship": return "connected"
        case "different_take": return "a different take"
        case "deeper": return "go deeper"
        case "leave": return "somewhere else"
        default: return "related"
        }
    }
}

struct WanderStopResponse: Codable {
    let success: Bool
    let stop: WanderStop?
}

/// An emergent theme spanning books, with this profile's coverage.
struct TopicSummary: Codable, Identifiable, Hashable {
    let id: String
    let label: String?
    let size: Int
    let bookCount: Int
    let coverage: TopicCoverage?

    var displayLabel: String { label ?? "An unnamed thread" }
    var coverageFraction: Double {
        guard let coverage, coverage.total > 0 else { return 0 }
        return Double(coverage.seen) / Double(coverage.total)
    }
}

struct TopicCoverage: Codable, Hashable {
    let seen: Int
    let total: Int
}

struct TopicsResponse: Codable {
    let success: Bool
    let topics: [TopicSummary]
}

/// A sequenced study path through a topic (curriculum Tier A/B).
struct StudyCurriculum: Codable, Identifiable, Hashable {
    let id: String
    let topicId: String
    let title: String
    let builder: String
    let items: [StudyItem]
}

struct StudyItem: Codable, Identifiable, Hashable {
    let ordinal: Int
    let passageId: String
    let bookId: String
    let bookTitle: String
    let snippet: String
    let module: String
    let role: String
    let transition: String
    let seen: Bool

    var id: Int { ordinal }
}

struct CurriculumResponse: Codable {
    let success: Bool
    let curriculum: StudyCurriculum?
}

struct TrailSaveResponse: Codable {
    let success: Bool
    let id: String?
    let title: String?
}
