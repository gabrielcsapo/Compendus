//
//  PocketTTSModelManager.swift
//  Compendus
//
//  Manages the PocketTTS model availability and voice selection.
//  All 8 voices are bundled with the app (~4.2MB total).
//

import Foundation
import os.log

private let logger = Logger(subsystem: "com.compendus.tts", category: "PocketTTSModel")

/// Describes a PocketTTS voice.
struct PocketTTSVoice: Identifiable, Equatable {
    let id: UInt32       // voice index (0-7)
    let name: String     // e.g. "Alba"
    let gender: String   // e.g. "Female"

    var displayName: String {
        "\(name) (\(gender))"
    }
}

@MainActor
@Observable
class PocketTTSModelManager {

    // MARK: - Voice Library

    /// All known PocketTTS voices (indices 0-7).
    static let allVoices: [PocketTTSVoice] = [
        PocketTTSVoice(id: 0, name: "Alba", gender: "Female"),
        PocketTTSVoice(id: 1, name: "Marius", gender: "Male"),
        PocketTTSVoice(id: 2, name: "Javert", gender: "Male"),
        PocketTTSVoice(id: 3, name: "Jean", gender: "Male"),
        PocketTTSVoice(id: 4, name: "Fantine", gender: "Female"),
        PocketTTSVoice(id: 5, name: "Cosette", gender: "Female"),
        PocketTTSVoice(id: 6, name: "Eponine", gender: "Female"),
        PocketTTSVoice(id: 7, name: "Azelma", gender: "Female"),
    ]

    // MARK: - State

    var selectedVoiceIndex: UInt32 {
        didSet { UserDefaults.standard.set(Int(selectedVoiceIndex), forKey: "pockettts_selected_voice") }
    }

    // MARK: - Model Path

    /// Cached model directory path (computed once at init).
    private static var _cachedModelDirectory: String?
    private static var _modelDirectoryResolved = false

    /// Whether the bundled model files are available.
    var isModelAvailable: Bool {
        Self.findModelDirectory() != nil
    }

    /// Locate the PocketTTS model directory in the app bundle.
    /// Result is cached after first lookup.
    static func findModelDirectory() -> String? {
        if _modelDirectoryResolved { return _cachedModelDirectory }
        _modelDirectoryResolved = true

        let fm = FileManager.default

        // 1. Folder reference: PocketTTSModel/ (explicit folder reference outside synced group)
        if let path = Bundle.main.path(forResource: "PocketTTSModel", ofType: nil) {
            let modelFile = (path as NSString).appendingPathComponent("model.safetensors")
            if fm.fileExists(atPath: modelFile) {
                logger.info("Found PocketTTS model at PocketTTSModel/: \(path)")
                _cachedModelDirectory = path
                return path
            }
        }

        // 2. Folder reference: PocketTTS/ (alternative name)
        if let path = Bundle.main.path(forResource: "PocketTTS", ofType: nil) {
            let modelFile = (path as NSString).appendingPathComponent("model.safetensors")
            if fm.fileExists(atPath: modelFile) {
                logger.info("Found PocketTTS model at PocketTTS/: \(path)")
                _cachedModelDirectory = path
                return path
            }
        }

        // 3. Fallback: Models/ directory name
        if let path = Bundle.main.path(forResource: "Models", ofType: nil) {
            let modelFile = (path as NSString).appendingPathComponent("model.safetensors")
            if fm.fileExists(atPath: modelFile) {
                logger.info("Found PocketTTS model at Models/: \(path)")
                _cachedModelDirectory = path
                return path
            }
        }

        // 4. Xcode file-sync flattened: model.safetensors at bundle root
        if let modelURL = Bundle.main.url(forResource: "model", withExtension: "safetensors") {
            let dir = modelURL.deletingLastPathComponent().path
            logger.info("Found PocketTTS model (flat) at: \(dir)")
            _cachedModelDirectory = dir
            return dir
        }

        logger.warning("PocketTTS model not found in bundle")
        return nil
    }

    // MARK: - Voice Access

    /// The currently selected voice.
    var selectedVoice: PocketTTSVoice? {
        Self.allVoices.first { $0.id == selectedVoiceIndex }
    }

    /// All available voices (all are bundled).
    var availableVoices: [PocketTTSVoice] {
        Self.allVoices
    }

    // MARK: - Init

    init() {
        let saved = UserDefaults.standard.integer(forKey: "pockettts_selected_voice")
        self.selectedVoiceIndex = UInt32(saved)  // defaults to 0 (Alba) if not set
    }
}
