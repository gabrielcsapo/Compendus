//
//  ProfileAvatarView.swift
//  Compendus
//
//  Reusable avatar view that renders image, emoji, or initials fallback
//

import SwiftUI

struct ProfileAvatarView: View {
    let avatar: String?
    let avatarURL: URL?
    let name: String
    let size: CGFloat

    @State private var loadedImage: UIImage?
    @State private var loadFailed = false

    /// Initialize with a Profile model and ServerConfig
    init(profile: Profile, serverConfig: ServerConfig, size: CGFloat = 44) {
        self.avatar = profile.avatar
        self.name = profile.name
        self.size = size
        if profile.hasImageAvatar {
            self.avatarURL = serverConfig.avatarURL(for: profile.id)
        } else {
            self.avatarURL = nil
        }
    }

    /// Initialize from the current profile stored in ServerConfig
    init(serverConfig: ServerConfig, size: CGFloat = 44) {
        self.avatar = serverConfig.selectedProfileAvatar
        self.name = serverConfig.selectedProfileName ?? "?"
        self.size = size
        self.avatarURL = serverConfig.selectedProfileAvatarURL
    }

    var body: some View {
        ZStack {
            Circle()
                .fill(Color(.systemGray5))
                .frame(width: size, height: size)

            if let url = avatarURL {
                if let loadedImage {
                    Image(uiImage: loadedImage)
                        .resizable()
                        .scaledToFill()
                        .frame(width: size, height: size)
                        .clipShape(Circle())
                } else if loadFailed {
                    fallbackContent
                } else {
                    ProgressView()
                        .controlSize(.small)
                        .frame(width: size, height: size)
                        .task(id: url) {
                            await loadAvatar(from: url)
                        }
                }
            } else if let avatar, !avatar.isEmpty, !avatar.hasPrefix("data/") {
                Text(avatar)
                    .font(.system(size: size * 0.5))
            } else {
                fallbackContent
            }
        }
    }

    private var fallbackContent: some View {
        Text(String(name.prefix(1).uppercased()))
            .font(.system(size: size * 0.35, weight: .semibold))
            .foregroundStyle(.secondary)
    }

    private func loadAvatar(from url: URL) async {
        let session = URLSession(
            configuration: .default,
            delegate: LocalNetworkSessionDelegate.shared,
            delegateQueue: nil
        )
        do {
            let (data, _) = try await session.data(from: url)
            if let image = UIImage(data: data) {
                loadedImage = image
            } else {
                loadFailed = true
            }
        } catch {
            loadFailed = true
        }
    }
}
