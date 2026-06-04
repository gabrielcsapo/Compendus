//
//  PlaybackController.swift
//  Compendus
//
//  Shared abstraction so one docked player bar (PlaybackDockBar) can drive both
//  the audiobook player (AudiobookPlayer) and read-along / TTS (ReadAlongService).
//  Members are `playback`-prefixed to avoid colliding with the concrete types'
//  existing API while they keep their own (differently-shaped) methods.
//

import Foundation
import Observation

@MainActor
protocol PlaybackController: AnyObject, Observable {
    var playbackTitle: String { get }
    var playbackSubtitle: String? { get }
    var playbackIsPlaying: Bool { get }
    var playbackIsBuffering: Bool { get }
    var playbackCurrentTime: Double { get }
    var playbackDuration: Double { get }
    var playbackRate: Float { get }

    func playbackTogglePlayPause()
    func playbackSeek(to time: Double)
    func playbackSkipBackward()
    func playbackSkipForward()
    func playbackSetRate(_ rate: Float)
    func playbackStop()
}

extension PlaybackController {
    var playbackProgress: Double {
        playbackDuration > 0 ? min(1, max(0, playbackCurrentTime / playbackDuration)) : 0
    }
}

// MARK: - AudiobookPlayer

extension AudiobookPlayer: PlaybackController {
    var playbackTitle: String { currentBook?.title ?? "Audiobook" }
    var playbackSubtitle: String? { currentChapter?.title ?? currentBook?.authorsDisplay }
    var playbackIsPlaying: Bool { isPlaying }
    var playbackIsBuffering: Bool { false }
    var playbackCurrentTime: Double { currentTime }
    var playbackDuration: Double { duration }
    // `playbackRate` requirement is satisfied by AudiobookPlayer's own stored
    // `playbackRate` property (do not redeclare — would recurse).

    func playbackTogglePlayPause() { if isPlaying { pause() } else { play() } }
    func playbackSeek(to time: Double) { seek(to: time) }
    func playbackSkipBackward() { skipBackward() }
    func playbackSkipForward() { skipForward() }
    func playbackSetRate(_ rate: Float) { setPlaybackRate(rate) }
    func playbackStop() { stop() }
}
