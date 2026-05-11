//
//  ChapterDetectionService.swift
//  Compendus
//
//  Auto-detects audiobook chapter boundaries by scanning for sustained
//  silence gaps in the PCM signal. Used to populate `DownloadedBook.chaptersData`
//  for audiobooks that ship without embedded chapter markers.
//
//  Algorithm overview:
//  1. Read PCM samples in chunks via AVAudioFile (no full-file load).
//  2. Compute RMS over 100ms windows using vDSP.
//  3. Pick an adaptive amplitude threshold from the RMS distribution
//     (so quietly-mastered books still detect correctly).
//  4. Treat runs of below-threshold windows ≥ minSilenceSeconds as
//     candidate chapter breaks; the midpoint of each run is the boundary.
//  5. Drop boundaries within 30s of start/end (intro/outro music) and
//     enforce a minimum chapter length to avoid noise.
//

import Foundation
import AVFoundation
import Accelerate

@Observable
final class ChapterDetectionService {
    var isDetecting = false
    var progress: Double = 0.0
    var errorMessage: String?

    private var currentTask: Task<Void, Never>?

    func detect(
        fileURL: URL,
        windowSeconds: Double = 0.1,
        minSilenceSeconds: Double = 2.5,
        minChapterSeconds: Double = 60.0
    ) async throws -> [Chapter] {
        await MainActor.run {
            self.isDetecting = true
            self.progress = 0
            self.errorMessage = nil
        }
        defer {
            Task { @MainActor in
                self.isDetecting = false
            }
        }

        let file = try AVAudioFile(forReading: fileURL)
        let processingFormat = file.processingFormat
        let sampleRate = processingFormat.sampleRate
        let totalFrames = file.length

        guard sampleRate > 0, totalFrames > 0 else {
            return []
        }

        let framesPerWindow = AVAudioFrameCount(max(1, Int(sampleRate * windowSeconds)))
        // Process ~60s of audio per buffer load for efficiency.
        let windowsPerChunk: AVAudioFrameCount = 600
        let framesPerChunk = framesPerWindow * windowsPerChunk

        guard let buffer = AVAudioPCMBuffer(pcmFormat: processingFormat, frameCapacity: framesPerChunk) else {
            throw NSError(
                domain: "ChapterDetectionService",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Could not allocate audio buffer."]
            )
        }

        var rmsValues: [Float] = []
        rmsValues.reserveCapacity(Int(totalFrames / Int64(framesPerWindow)) + 64)

        var framesProcessed: AVAudioFramePosition = 0
        while framesProcessed < totalFrames {
            try Task.checkCancellation()

            buffer.frameLength = 0
            try file.read(into: buffer, frameCount: framesPerChunk)
            let actualFrames = Int(buffer.frameLength)
            if actualFrames == 0 { break }

            guard let channelData = buffer.floatChannelData else {
                framesProcessed += AVAudioFramePosition(actualFrames)
                continue
            }

            let firstChannel = channelData[0]
            let windowsInChunk = actualFrames / Int(framesPerWindow)
            for w in 0..<windowsInChunk {
                let startOffset = w * Int(framesPerWindow)
                var rms: Float = 0
                vDSP_rmsqv(firstChannel + startOffset, 1, &rms, vDSP_Length(framesPerWindow))
                rmsValues.append(rms)
            }

            framesProcessed += AVAudioFramePosition(actualFrames)
            let progressSnapshot = min(1.0, Double(framesProcessed) / Double(totalFrames))
            await MainActor.run {
                self.progress = progressSnapshot
            }
        }

        guard rmsValues.count > 10 else { return [] }

        // Adaptive threshold: somewhere between the 5th-percentile noise
        // floor and the median (speech) level — captures pauses without
        // tripping on regular spoken cadence.
        let sorted = rmsValues.sorted()
        let p5 = sorted[max(0, sorted.count / 20)]
        let p50 = sorted[sorted.count / 2]
        let threshold = max(p5 * 4, p50 * 0.08)

        let windowsForMinSilence = max(1, Int(minSilenceSeconds / windowSeconds))
        var silenceCenters: [Int] = []
        var runStart: Int? = nil

        for i in 0..<rmsValues.count {
            if rmsValues[i] < threshold {
                if runStart == nil { runStart = i }
            } else if let start = runStart {
                let runLength = i - start
                if runLength >= windowsForMinSilence {
                    silenceCenters.append(start + runLength / 2)
                }
                runStart = nil
            }
        }
        if let start = runStart {
            let runLength = rmsValues.count - start
            if runLength >= windowsForMinSilence {
                silenceCenters.append(start + runLength / 2)
            }
        }

        let durationSeconds = Double(totalFrames) / sampleRate
        let edgeBuffer: Double = 30
        var boundaries: [Double] = silenceCenters
            .map { Double($0) * windowSeconds }
            .filter { $0 > edgeBuffer && $0 < durationSeconds - edgeBuffer }

        var filtered: [Double] = []
        var lastBoundary: Double = 0
        for b in boundaries {
            if b - lastBoundary >= minChapterSeconds {
                filtered.append(b)
                lastBoundary = b
            }
        }

        boundaries = filtered

        // Detection isn't useful with fewer than 2 chapters; let the caller
        // surface "no chapters detected" instead of saving a 1-chapter book.
        guard boundaries.count >= 1 else { return [] }

        // Cap at 50 chapters to avoid pathological detection noise on very
        // dialogue-heavy books.
        if boundaries.count > 49 {
            boundaries = Array(boundaries.prefix(49))
        }

        var chapters: [Chapter] = []
        var prev: Double = 0
        for (idx, time) in boundaries.enumerated() {
            chapters.append(Chapter(
                title: "Chapter \(idx + 1)",
                startTime: prev,
                endTime: time
            ))
            prev = time
        }
        chapters.append(Chapter(
            title: "Chapter \(boundaries.count + 1)",
            startTime: prev,
            endTime: durationSeconds
        ))

        return chapters
    }

    func cancel() {
        currentTask?.cancel()
        currentTask = nil
    }
}
