//
//  TTSAudioCache.swift
//  Compendus
//
//  Disk cache for TTS-generated audio. Stores raw PCM samples
//  and metadata per chapter so read-along doesn't re-synthesize
//  every session. Invalidates when voice selection changes.
//

import Foundation
import os.log

private let logger = Logger(subsystem: "com.compendus.tts", category: "AudioCache")

@Observable
class TTSAudioCache {

    // MARK: - Cache Metadata

    struct TTSCacheMetadata: Codable {
        let voiceId: Int
        let sampleRate: Double              // 24000 for PocketTTS
        let sentenceTimings: [SentenceTiming]
        let generatedAt: Date
    }

    struct SentenceTiming: Codable {
        let text: String
        let plainTextLocation: Int          // NSRange.location in chapter plain text
        let plainTextLength: Int            // NSRange.length in chapter plain text
        let audioStartTime: Double
        let audioEndTime: Double
        let sampleOffset: Int               // Sample offset in PCM file (Float32 index)
        let sampleCount: Int                // Number of Float32 samples
    }

    // MARK: - Cache Result

    struct CachedChapter {
        let samples: [Float]
        let metadata: TTSCacheMetadata

        /// Reconstruct SentenceSpan array from cached metadata
        var sentenceSpans: [TextProcessingUtils.SentenceSpan] {
            metadata.sentenceTimings.map { timing in
                TextProcessingUtils.SentenceSpan(
                    text: timing.text,
                    plainTextRange: NSRange(location: timing.plainTextLocation, length: timing.plainTextLength),
                    audioStartTime: timing.audioStartTime,
                    audioEndTime: timing.audioEndTime
                )
            }
        }
    }

    // MARK: - Directory Management

    private let fileManager = FileManager.default

    private var cacheBaseURL: URL {
        let docs = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first!
        return docs.appendingPathComponent("tts-cache", isDirectory: true)
    }

    private func bookCacheURL(bookId: String) -> URL {
        cacheBaseURL.appendingPathComponent(bookId, isDirectory: true)
    }

    private func pcmURL(bookId: String, spineIndex: Int) -> URL {
        bookCacheURL(bookId: bookId).appendingPathComponent("\(spineIndex).pcm")
    }

    private func metadataURL(bookId: String, spineIndex: Int) -> URL {
        bookCacheURL(bookId: bookId).appendingPathComponent("\(spineIndex).json")
    }

    // MARK: - Public API

    /// Check whether valid cached audio exists for a chapter with the given voice.
    func hasCachedAudio(bookId: String, spineIndex: Int, voiceId: Int) -> Bool {
        let metaURL = metadataURL(bookId: bookId, spineIndex: spineIndex)
        let pcm = pcmURL(bookId: bookId, spineIndex: spineIndex)

        guard fileManager.fileExists(atPath: metaURL.path),
              fileManager.fileExists(atPath: pcm.path) else {
            return false
        }

        // Validate voice matches
        guard let metadata = loadMetadata(bookId: bookId, spineIndex: spineIndex) else {
            return false
        }
        return metadata.voiceId == voiceId
    }

    /// Load cached audio samples and metadata for a chapter.
    func loadCachedAudio(bookId: String, spineIndex: Int) -> CachedChapter? {
        guard let metadata = loadMetadata(bookId: bookId, spineIndex: spineIndex) else {
            logger.warning("Failed to load metadata for \(bookId)/\(spineIndex)")
            return nil
        }

        guard let samples = loadSamples(bookId: bookId, spineIndex: spineIndex) else {
            logger.warning("Failed to load PCM samples for \(bookId)/\(spineIndex)")
            return nil
        }

        logger.info("Loaded cached TTS audio: \(bookId)/\(spineIndex) — \(samples.count) samples, \(metadata.sentenceTimings.count) sentences")
        return CachedChapter(samples: samples, metadata: metadata)
    }

    /// Cache generated TTS audio and metadata for a chapter.
    func cacheChapterAudio(
        bookId: String,
        spineIndex: Int,
        samples: [Float],
        metadata: TTSCacheMetadata
    ) {
        do {
            let bookDir = bookCacheURL(bookId: bookId)
            try fileManager.createDirectory(at: bookDir, withIntermediateDirectories: true)

            // Write PCM samples as raw Float32 data
            let pcm = pcmURL(bookId: bookId, spineIndex: spineIndex)
            let sampleData = samples.withUnsafeBufferPointer { buffer in
                Data(buffer: buffer)
            }
            try sampleData.write(to: pcm, options: .atomic)

            // Write metadata as JSON
            let meta = metadataURL(bookId: bookId, spineIndex: spineIndex)
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            let metaData = try encoder.encode(metadata)
            try metaData.write(to: meta, options: .atomic)

            logger.info("Cached TTS audio: \(bookId)/\(spineIndex) — \(samples.count) samples (\(sampleData.count) bytes)")
        } catch {
            logger.error("Failed to cache TTS audio: \(error)")
        }
    }

    /// Build cache metadata from sentence spans and their audio samples.
    static func buildMetadata(
        voiceId: Int,
        sentences: [TextProcessingUtils.SentenceSpan],
        chapterSamples: [Float]
    ) -> TTSCacheMetadata {
        var timings: [SentenceTiming] = []
        var sampleOffset = 0

        for sentence in sentences {
            let duration = sentence.audioEndTime - sentence.audioStartTime
            let sampleCount = Int(duration * 24000.0)

            timings.append(SentenceTiming(
                text: sentence.text,
                plainTextLocation: sentence.plainTextRange.location,
                plainTextLength: sentence.plainTextRange.length,
                audioStartTime: sentence.audioStartTime,
                audioEndTime: sentence.audioEndTime,
                sampleOffset: sampleOffset,
                sampleCount: sampleCount
            ))

            sampleOffset += sampleCount
        }

        return TTSCacheMetadata(
            voiceId: voiceId,
            sampleRate: 24000,
            sentenceTimings: timings,
            generatedAt: Date()
        )
    }

    /// Clear all cached audio for a specific book.
    func clearCache(for bookId: String) {
        let dir = bookCacheURL(bookId: bookId)
        guard fileManager.fileExists(atPath: dir.path) else { return }
        do {
            try fileManager.removeItem(at: dir)
            logger.info("Cleared TTS cache for book \(bookId)")
        } catch {
            logger.error("Failed to clear TTS cache for \(bookId): \(error)")
        }
    }

    /// Total disk space used by TTS cache.
    func totalCacheSize() -> Int64 {
        guard fileManager.fileExists(atPath: cacheBaseURL.path) else { return 0 }
        guard let enumerator = fileManager.enumerator(
            at: cacheBaseURL,
            includingPropertiesForKeys: [.fileSizeKey],
            options: [.skipsHiddenFiles]
        ) else { return 0 }

        var totalSize: Int64 = 0
        for case let fileURL as URL in enumerator {
            if let values = try? fileURL.resourceValues(forKeys: [.fileSizeKey]),
               let size = values.fileSize {
                totalSize += Int64(size)
            }
        }
        return totalSize
    }

    /// Clear all TTS cache.
    func clearAllCache() {
        guard fileManager.fileExists(atPath: cacheBaseURL.path) else { return }
        do {
            let contents = try fileManager.contentsOfDirectory(at: cacheBaseURL, includingPropertiesForKeys: nil)
            for url in contents {
                try fileManager.removeItem(at: url)
            }
            logger.info("Cleared all TTS cache")
        } catch {
            logger.error("Failed to clear TTS cache: \(error)")
        }
    }

    /// Get number of cached chapters for a book.
    func cachedChapterCount(for bookId: String) -> Int {
        let dir = bookCacheURL(bookId: bookId)
        guard fileManager.fileExists(atPath: dir.path),
              let contents = try? fileManager.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else {
            return 0
        }
        return contents.filter { $0.pathExtension == "pcm" }.count
    }

    // MARK: - Private Helpers

    private func loadMetadata(bookId: String, spineIndex: Int) -> TTSCacheMetadata? {
        let url = metadataURL(bookId: bookId, spineIndex: spineIndex)
        guard let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(TTSCacheMetadata.self, from: data)
    }

    private func loadSamples(bookId: String, spineIndex: Int) -> [Float]? {
        let url = pcmURL(bookId: bookId, spineIndex: spineIndex)
        guard let data = try? Data(contentsOf: url) else { return nil }
        let floatCount = data.count / MemoryLayout<Float>.size
        guard floatCount > 0 else { return nil }
        return data.withUnsafeBytes { rawBuffer in
            let floatBuffer = rawBuffer.bindMemory(to: Float.self)
            return Array(floatBuffer)
        }
    }
}
