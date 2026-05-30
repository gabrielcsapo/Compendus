//
//  KokoroModelManager.swift
//  Compendus
//
//  Manages Kokoro model availability and voice selection.
//  The model + 54 voice embeddings are bundled with the app under KokoroModel/.
//  Voices are exposed to the app as a stable UInt32 catalog index (mapping to a Kokoro
//  voice-ID string internally) so the read-along plumbing stays index-based.
//

import Foundation
import os.log

private let logger = Logger(subsystem: "com.compendus.tts", category: "KokoroModel")

/// Describes a Kokoro voice surfaced in the app.
struct KokoroVoice: Identifiable, Equatable {
    let id: UInt32        // stable catalog index
    let voiceID: String   // Kokoro voice ID, e.g. "af_heart"
    let name: String      // display name, e.g. "Heart"
    let gender: String    // "Female" / "Male"

    var displayName: String { "\(name) (\(gender))" }
}

@MainActor
@Observable
class KokoroModelManager {

    // MARK: - Voice Library

    /// Curated English voice catalog (American + British). Kokoro ships 54 voices across
    /// 10 languages; we surface the English presets the library reads aloud with.
    /// Indices are stable — do not reorder (they're persisted in UserDefaults / cache).
    static let allVoices: [KokoroVoice] = [
        KokoroVoice(id: 0,  voiceID: "af_heart",   name: "Heart",    gender: "Female"),
        KokoroVoice(id: 1,  voiceID: "af_bella",   name: "Bella",    gender: "Female"),
        KokoroVoice(id: 2,  voiceID: "af_nicole",  name: "Nicole",   gender: "Female"),
        KokoroVoice(id: 3,  voiceID: "af_sarah",   name: "Sarah",    gender: "Female"),
        KokoroVoice(id: 4,  voiceID: "af_sky",     name: "Sky",      gender: "Female"),
        KokoroVoice(id: 5,  voiceID: "am_michael", name: "Michael",  gender: "Male"),
        KokoroVoice(id: 6,  voiceID: "am_fenrir",  name: "Fenrir",   gender: "Male"),
        KokoroVoice(id: 7,  voiceID: "am_puck",    name: "Puck",     gender: "Male"),
        KokoroVoice(id: 8,  voiceID: "am_adam",    name: "Adam",     gender: "Male"),
        KokoroVoice(id: 9,  voiceID: "bf_emma",    name: "Emma",     gender: "Female"),
        KokoroVoice(id: 10, voiceID: "bf_isabella", name: "Isabella", gender: "Female"),
        KokoroVoice(id: 11, voiceID: "bm_george",  name: "George",   gender: "Male"),
        KokoroVoice(id: 12, voiceID: "bm_lewis",   name: "Lewis",    gender: "Male"),
    ]

    /// Default voice ID if a persisted/looked-up index is out of range.
    static let fallbackVoiceID = "af_heart"

    /// Map a catalog index to its Kokoro voice ID.
    static func voiceID(forIndex index: UInt32) -> String {
        allVoices.first { $0.id == index }?.voiceID ?? fallbackVoiceID
    }

    // MARK: - State

    var selectedVoiceIndex: UInt32 {
        didSet { UserDefaults.standard.set(Int(selectedVoiceIndex), forKey: "kokoro_selected_voice") }
    }

    // MARK: - Model Path

    private static var _cachedModelDirectory: String?
    private static var _modelDirectoryResolved = false

    /// Whether the bundled model files are available.
    var isModelAvailable: Bool { Self.findModelDirectory() != nil }

    /// Locate the bundled Kokoro model directory (cached after first lookup).
    /// Validates by checking for the E2E CoreML model inside.
    static func findModelDirectory() -> String? {
        if _modelDirectoryResolved { return _cachedModelDirectory }
        _modelDirectoryResolved = true

        let fm = FileManager.default

        // 1. Folder reference: KokoroModel/ (explicit folder reference)
        if let path = Bundle.main.path(forResource: "KokoroModel", ofType: nil) {
            let modelDir = (path as NSString).appendingPathComponent("kokoro_5s.mlmodelc")
            if fm.fileExists(atPath: modelDir) {
                logger.info("Found Kokoro model at KokoroModel/: \(path)")
                _cachedModelDirectory = path
                return path
            }
        }

        // 2. Xcode file-sync flattened: kokoro_5s.mlmodelc at bundle root
        if let modelURL = Bundle.main.url(forResource: "kokoro_5s", withExtension: "mlmodelc") {
            let dir = modelURL.deletingLastPathComponent().path
            logger.info("Found Kokoro model (flat) at: \(dir)")
            _cachedModelDirectory = dir
            return dir
        }

        logger.warning("Kokoro model not found in bundle")
        return nil
    }

    // MARK: - Voice Access

    var selectedVoice: KokoroVoice? {
        Self.allVoices.first { $0.id == selectedVoiceIndex }
    }

    var availableVoices: [KokoroVoice] { Self.allVoices }

    // MARK: - Init

    init() {
        let saved = UserDefaults.standard.integer(forKey: "kokoro_selected_voice")
        let valid = Self.allVoices.contains { $0.id == UInt32(saved) }
        self.selectedVoiceIndex = valid ? UInt32(saved) : 0  // default Heart
    }
}
