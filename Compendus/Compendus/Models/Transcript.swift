//
//  Transcript.swift
//  Compendus
//
//  Models for audiobook transcription (Whisper-generated lyrics)
//

import Foundation

struct Transcript: Codable {
    let duration: Double
    let language: String
    let segments: [TranscriptSegment]
}

struct TranscriptSegment: Codable, Identifiable {
    var id: String { "\(start)-\(end)" }
    let start: Double
    let end: Double
    let text: String
    let words: [TranscriptWord]

    enum CodingKeys: String, CodingKey {
        case start, end, text, words
    }
}

struct TranscriptWord: Codable {
    let word: String
    let start: Double
    let end: Double
}

// MARK: - API Response Types

struct TranscribeResponse: Codable {
    let success: Bool
    let jobId: String?
    let alreadyTranscribed: Bool?
    let pending: Bool?
    let error: String?
    let message: String?
}

struct TranscriptDataResponse: Codable {
    let success: Bool
    let transcript: Transcript?
    let error: String?
}

struct TranscriptStatusResponse: Codable {
    let success: Bool
    let hasTranscript: Bool?
    let error: String?
}
