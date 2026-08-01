//
//  Substrate.swift
//  Compendus
//
//  Models for the semantic substrate APIs. Wander remains passage-centric;
//  Pods are the one shared learning contract used by web and native clients.
//  Every Pod card and recall question resolves to an exact source locator.
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

enum PodSource: String, Codable, Hashable {
    case learningGraph = "learning-graph"
    case conceptFallback = "concept-fallback"
}

/// Canonical source anchor shared with the web reader.
struct SourceLocator: Codable, Hashable {
    let passageId: String
    let bookId: String
    let bookTitle: String
    let chapterTitle: String?
    let spineIndex: Int?
    let page: Int?
    let charStart: Int?
    let charEnd: Int?

    var locationLabel: String? {
        if let chapterTitle, !chapterTitle.isEmpty { return chapterTitle }
        if let page { return "Page \(page + 1)" }
        return nil
    }
}

struct PodSummary: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let description: String?
    let passageCount: Int
    let bookCount: Int
    let questionCount: Int?
    let source: PodSource
}

struct PodsResponse: Codable {
    let success: Bool
    let pods: [PodSummary]
    let total: Int
}

struct PodSearchResponse: Codable {
    let success: Bool
    let pods: [PodSummary]
}

struct PodSessionItem: Codable, Identifiable, Hashable {
    let ordinal: Int
    let passageId: String
    let bookId: String
    let bookTitle: String
    let snippet: String
    let module: String
    let role: String
    let transition: String
    let seen: Bool
    let source: SourceLocator

    var id: String { passageId }
}

struct PodQuestionChoice: Codable, Identifiable, Hashable {
    let id: String
    let text: String
}

struct PodSavedAnswer: Codable, Hashable {
    let selectedChoiceId: String
    let result: PodAttemptResult
}

struct PodEvidence: Codable, Hashable {
    let passageId: String
    let bookId: String
    let bookTitle: String
    let chapterTitle: String?
    let spineIndex: Int?
    let page: Int?
    let charStart: Int?
    let charEnd: Int?
    let excerpt: String

    var source: SourceLocator {
        SourceLocator(
            passageId: passageId,
            bookId: bookId,
            bookTitle: bookTitle,
            chapterTitle: chapterTitle,
            spineIndex: spineIndex,
            page: page,
            charStart: charStart,
            charEnd: charEnd
        )
    }
}

struct PodQuestion: Codable, Identifiable, Hashable {
    let id: String
    let kind: String
    let prompt: String
    let choices: [PodQuestionChoice]
    let afterOrdinal: Int
    let evidence: PodEvidence
    let savedAnswer: PodSavedAnswer?
}

struct PodSession: Codable, Identifiable, Hashable {
    let id: String
    let podId: String
    let title: String
    let revision: String
    let source: PodSource
    let items: [PodSessionItem]
    let questions: [PodQuestion]

    var seenCount: Int {
        let answeredPassages = Set(
            questions.compactMap { question in
                question.savedAnswer?.result.correct == true ? question.evidence.passageId : nil
            }
        )
        return items.lazy.filter { $0.seen || answeredPassages.contains($0.passageId) }.count
    }
}

struct PodSessionResponse: Codable {
    let success: Bool
    let session: PodSession
    let adjacent: [PodSummary]
}

struct PodAttemptRequest: Codable {
    let revision: String
    let questionId: String
    let selectedChoiceId: String
    let attemptId: String
}

struct PodAttemptResult: Codable, Hashable {
    let correct: Bool
    let feedback: String
    let evidence: PodEvidence
}

struct PodAttemptResponse: Codable {
    let success: Bool
    let result: PodAttemptResult
}

struct TrailSaveResponse: Codable {
    let success: Bool
    let id: String?
    let title: String?
}
