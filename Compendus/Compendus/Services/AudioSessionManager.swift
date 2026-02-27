//
//  AudioSessionManager.swift
//  Compendus
//
//  Centralized audio session configuration to avoid conflicts
//  between AudiobookPlayer and ReadAlongService TTS mode.
//

import AVFoundation
import os.log

private let logger = Logger(subsystem: "com.compendus.audio", category: "SessionManager")

enum AudioSessionManager {

    enum Mode {
        case audiobook    // .playback + .spokenAudio
        case tts          // .playback + .spokenAudio
        case inactive
    }

    static func activate(for mode: Mode) throws {
        let session = AVAudioSession.sharedInstance()
        switch mode {
        case .audiobook:
            try session.setCategory(.playback, mode: .spokenAudio)
            try session.setActive(true)
            logger.info("Audio session activated for audiobook")
        case .tts:
            try session.setCategory(.playback, mode: .spokenAudio)
            // Match the TTS engine sample rate (24kHz) to avoid resampling artifacts
            try session.setPreferredSampleRate(24000)
            // Use a small I/O buffer for smooth playback
            try session.setPreferredIOBufferDuration(0.01)
            try session.setActive(true)
            logger.info("Audio session activated for TTS (preferred rate: 24kHz)")
        case .inactive:
            try session.setActive(false, options: .notifyOthersOnDeactivation)
            logger.info("Audio session deactivated")
        }
    }

    static func deactivate() {
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            logger.info("Audio session deactivated")
        } catch {
            logger.warning("Audio session deactivation failed: \(error)")
        }
    }
}
