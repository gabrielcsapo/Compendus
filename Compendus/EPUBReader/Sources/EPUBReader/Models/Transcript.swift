//
//  Transcript.swift
//  Compendus
//
//  Models for audiobook transcription (Whisper-generated lyrics)
//

import Foundation

public struct Transcript: Codable {
    public let duration: Double
    public let language: String
    public let segments: [TranscriptSegment]

    public init(duration: Double, language: String, segments: [TranscriptSegment]) {
        self.duration = duration
        self.language = language
        self.segments = segments
    }
}

public struct TranscriptSegment: Codable, Identifiable {
    public var id: String { "\(start)-\(end)" }
    public let start: Double
    public let end: Double
    public let text: String
    public let words: [TranscriptWord]

    public init(start: Double, end: Double, text: String, words: [TranscriptWord]) {
        self.start = start
        self.end = end
        self.text = text
        self.words = words
    }

    enum CodingKeys: String, CodingKey {
        case start, end, text, words
    }
}

public struct TranscriptWord: Codable {
    public let word: String
    public let start: Double
    public let end: Double

    public init(word: String, start: Double, end: Double) {
        self.word = word
        self.start = start
        self.end = end
    }
}

// MARK: - API Response Types

public struct TranscribeResponse: Codable {
    public let success: Bool
    public let jobId: String?
    public let alreadyTranscribed: Bool?
    public let pending: Bool?
    public let error: String?
    public let message: String?
}

public struct TranscriptDataResponse: Codable {
    public let success: Bool
    public let transcript: Transcript?
    public let error: String?
}

public struct TranscriptStatusResponse: Codable {
    public let success: Bool
    public let hasTranscript: Bool?
    public let error: String?
}
