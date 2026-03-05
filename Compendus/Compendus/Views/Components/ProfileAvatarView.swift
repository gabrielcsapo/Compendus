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
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    case .failure:
                        fallbackContent
                    default:
                        ProgressView()
                            .controlSize(.small)
                    }
                }
                .frame(width: size, height: size)
                .clipShape(Circle())
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
}
