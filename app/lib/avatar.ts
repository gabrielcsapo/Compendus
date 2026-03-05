/**
 * Determine if an avatar value is an image path (vs emoji).
 */
export function isAvatarImage(avatar: string | null | undefined): boolean {
  return !!avatar && avatar.startsWith("data/");
}

/**
 * Get the URL for a profile's avatar image.
 * Returns null if the avatar is an emoji or not set.
 */
export function getAvatarUrl(profile: {
  id: string;
  avatar: string | null;
  avatarUrl?: string | null;
}): string | null {
  if (profile.avatarUrl) return profile.avatarUrl;
  if (profile.avatar?.startsWith("data/")) {
    return `/avatars/${profile.id}.jpg`;
  }
  return null;
}
