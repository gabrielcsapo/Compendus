//
//  InlineMediaPlayerView.swift
//  Compendus
//
//  Truly inline media player positioned at the exact frame of a media
//  attachment inside the UITextView. No modals, no overlays.
//
//  Video mode: AVPlayerLayer at attachment size, centered play/pause button,
//              thin progress bar at bottom. AVPlayer created lazily on first play.
//  Audio mode: Compact bar with play/pause, scrubber slider, time labels.
//              AVPlayer created lazily on first play.
//

import UIKit
import AVFoundation

@MainActor
class InlineMediaPlayerView: UIView {

    enum Mode { case video, audio }

    private let url: URL
    private let mode: Mode

    // Lazy — created on first play tap
    private var player: AVPlayer?
    private var playerLayer: AVPlayerLayer?
    private var timeObserver: Any?
    private var isPlaying = false

    // Shared controls
    private let playPauseButton = UIButton(type: .system)

    // Video-only
    private let videoProgressBar = UIView()
    private let videoProgressTrack = UIView()

    // Audio-only
    private let slider = UISlider()
    private let currentTimeLabel = UILabel()
    private let durationLabel = UILabel()

    init(url: URL, mode: Mode) {
        self.url = url
        self.mode = mode
        super.init(frame: .zero)
        clipsToBounds = true

        if mode == .video {
            setupVideoLayout()
        } else {
            setupAudioLayout()
        }
    }

    required init?(coder: NSCoder) { fatalError() }

    nonisolated deinit {
        // Remove time observer directly — player and observer are already
        // captured without actor isolation in the stored properties.
        MainActor.assumeIsolated {
            if let observer = timeObserver {
                player?.removeTimeObserver(observer)
            }
            player?.pause()
            player?.replaceCurrentItem(with: nil)
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        playerLayer?.frame = bounds
    }

    // MARK: - Public

    /// Stop playback and release the player. Called when page changes or book closes.
    func stopPlayback() {
        cleanupPlayer()
        isPlaying = false
        updatePlayPauseIcon()

        // Reset audio slider
        if mode == .audio {
            slider.value = 0
            currentTimeLabel.text = "0:00"
        }
        // Reset video progress
        if mode == .video {
            videoProgressTrack.frame.size.width = 0
        }
    }

    // MARK: - Video Layout

    private func setupVideoLayout() {
        // Transparent so the thumbnail beneath shows through
        backgroundColor = .clear

        // Centered play button
        let circleSize: CGFloat = 50
        playPauseButton.setImage(
            UIImage(systemName: "play.fill")?
                .withConfiguration(UIImage.SymbolConfiguration(pointSize: 24, weight: .medium)),
            for: .normal
        )
        playPauseButton.tintColor = .white
        playPauseButton.backgroundColor = UIColor.black.withAlphaComponent(0.5)
        playPauseButton.layer.cornerRadius = circleSize / 2
        playPauseButton.addTarget(self, action: #selector(togglePlayPause), for: .touchUpInside)
        playPauseButton.translatesAutoresizingMaskIntoConstraints = false
        addSubview(playPauseButton)

        // Thin progress bar at bottom
        videoProgressBar.backgroundColor = UIColor.white.withAlphaComponent(0.3)
        videoProgressBar.translatesAutoresizingMaskIntoConstraints = false
        addSubview(videoProgressBar)

        videoProgressTrack.backgroundColor = .white
        videoProgressTrack.frame = .zero
        videoProgressBar.addSubview(videoProgressTrack)

        NSLayoutConstraint.activate([
            playPauseButton.centerXAnchor.constraint(equalTo: centerXAnchor),
            playPauseButton.centerYAnchor.constraint(equalTo: centerYAnchor),
            playPauseButton.widthAnchor.constraint(equalToConstant: circleSize),
            playPauseButton.heightAnchor.constraint(equalToConstant: circleSize),

            videoProgressBar.leadingAnchor.constraint(equalTo: leadingAnchor),
            videoProgressBar.trailingAnchor.constraint(equalTo: trailingAnchor),
            videoProgressBar.bottomAnchor.constraint(equalTo: bottomAnchor),
            videoProgressBar.heightAnchor.constraint(equalToConstant: 3),
        ])
    }

    // MARK: - Audio Layout

    private func setupAudioLayout() {
        backgroundColor = .secondarySystemBackground
        layer.cornerRadius = 10

        // Play/pause — tintColor inherits from parent view hierarchy
        playPauseButton.setImage(
            UIImage(systemName: "play.fill")?
                .withConfiguration(UIImage.SymbolConfiguration(pointSize: 18, weight: .medium)),
            for: .normal
        )
        playPauseButton.addTarget(self, action: #selector(togglePlayPause), for: .touchUpInside)
        playPauseButton.translatesAutoresizingMaskIntoConstraints = false
        addSubview(playPauseButton)

        // Time labels
        currentTimeLabel.text = "0:00"
        currentTimeLabel.font = .monospacedDigitSystemFont(ofSize: 11, weight: .medium)
        currentTimeLabel.textColor = .secondaryLabel
        currentTimeLabel.translatesAutoresizingMaskIntoConstraints = false
        addSubview(currentTimeLabel)

        durationLabel.text = "0:00"
        durationLabel.font = .monospacedDigitSystemFont(ofSize: 11, weight: .medium)
        durationLabel.textColor = .secondaryLabel
        durationLabel.translatesAutoresizingMaskIntoConstraints = false
        addSubview(durationLabel)

        // Slider — uses inherited tintColor for minimum track
        slider.maximumTrackTintColor = .systemGray4
        slider.addTarget(self, action: #selector(sliderChanged), for: .valueChanged)
        slider.translatesAutoresizingMaskIntoConstraints = false
        addSubview(slider)

        NSLayoutConstraint.activate([
            playPauseButton.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 8),
            playPauseButton.centerYAnchor.constraint(equalTo: centerYAnchor),
            playPauseButton.widthAnchor.constraint(equalToConstant: 36),
            playPauseButton.heightAnchor.constraint(equalToConstant: 36),

            currentTimeLabel.leadingAnchor.constraint(equalTo: playPauseButton.trailingAnchor, constant: 4),
            currentTimeLabel.centerYAnchor.constraint(equalTo: centerYAnchor),

            slider.leadingAnchor.constraint(equalTo: currentTimeLabel.trailingAnchor, constant: 4),
            slider.trailingAnchor.constraint(equalTo: durationLabel.leadingAnchor, constant: -4),
            slider.centerYAnchor.constraint(equalTo: centerYAnchor),

            durationLabel.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -10),
            durationLabel.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
    }

    // MARK: - Player Lifecycle

    private func ensurePlayer() {
        guard player == nil else { return }

        let avPlayer = AVPlayer(url: url)
        self.player = avPlayer

        if mode == .video {
            let layer = AVPlayerLayer(player: avPlayer)
            layer.videoGravity = .resizeAspect
            layer.frame = bounds
            // Insert below play button and progress bar
            self.layer.insertSublayer(layer, at: 0)
            playerLayer = layer
            // Once video layer is up, give it a dark background
            backgroundColor = .black
        }

        // Time observer
        let interval = CMTime(seconds: 0.5, preferredTimescale: 600)
        timeObserver = avPlayer.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            self?.updateTimeDisplay(time)
        }

        // Load duration
        avPlayer.currentItem?.asset.loadValuesAsynchronously(forKeys: ["duration"]) { [weak self] in
            Task { @MainActor in
                guard let duration = self?.player?.currentItem?.asset.duration,
                      duration.isNumeric else { return }
                self?.durationLabel.text = self?.formatTime(duration)
            }
        }

        // End-of-playback
        NotificationCenter.default.addObserver(
            self, selector: #selector(playerDidFinish),
            name: .AVPlayerItemDidPlayToEndTime,
            object: avPlayer.currentItem
        )
    }

    private func cleanupPlayer() {
        if let observer = timeObserver {
            player?.removeTimeObserver(observer)
            timeObserver = nil
        }
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        player = nil
        playerLayer?.removeFromSuperlayer()
        playerLayer = nil
        if mode == .video {
            backgroundColor = .clear
        }
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - Actions

    @objc private func togglePlayPause() {
        if isPlaying {
            player?.pause()
            isPlaying = false
        } else {
            ensurePlayer()
            player?.play()
            isPlaying = true
        }
        updatePlayPauseIcon()
    }

    @objc private func sliderChanged() {
        guard let duration = player?.currentItem?.duration, duration.isNumeric else { return }
        let targetTime = CMTimeMultiplyByFloat64(duration, multiplier: Float64(slider.value))
        player?.seek(to: targetTime)
    }

    @objc private func playerDidFinish() {
        isPlaying = false
        updatePlayPauseIcon()
    }

    // MARK: - Time Display

    private func updateTimeDisplay(_ time: CMTime) {
        guard time.isNumeric else { return }

        if mode == .audio {
            currentTimeLabel.text = formatTime(time)
        }

        guard let duration = player?.currentItem?.duration, duration.isNumeric else { return }
        let durationSeconds = CMTimeGetSeconds(duration)
        guard durationSeconds > 0 else { return }
        let progress = Float(CMTimeGetSeconds(time) / durationSeconds)

        if mode == .audio {
            slider.value = progress
            if durationLabel.text == "0:00" {
                durationLabel.text = formatTime(duration)
            }
        } else {
            // Video: update thin progress bar
            videoProgressTrack.frame = CGRect(
                x: 0, y: 0,
                width: videoProgressBar.bounds.width * CGFloat(progress),
                height: videoProgressBar.bounds.height
            )
        }
    }

    private func formatTime(_ time: CMTime) -> String {
        let totalSeconds = Int(CMTimeGetSeconds(time))
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        return String(format: "%d:%02d", minutes, seconds)
    }

    // MARK: - Helpers

    private func updatePlayPauseIcon() {
        let iconName = isPlaying ? "pause.fill" : "play.fill"
        let size: CGFloat = mode == .video ? 24 : 18
        playPauseButton.setImage(
            UIImage(systemName: iconName)?
                .withConfiguration(UIImage.SymbolConfiguration(pointSize: size, weight: .medium)),
            for: .normal
        )
    }
}
