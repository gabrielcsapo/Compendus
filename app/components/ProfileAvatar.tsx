"use client";

import { getAvatarUrl } from "../lib/avatar";

interface ProfileAvatarProps {
  profile: {
    id: string;
    name: string;
    avatar: string | null;
    avatarUrl?: string | null;
  };
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizeMap = {
  sm: { container: "w-7 h-7", text: "text-sm", fallback: "text-xs" },
  md: { container: "w-10 h-10", text: "text-lg", fallback: "text-sm" },
  lg: { container: "w-20 h-20", text: "text-3xl", fallback: "text-xl" },
  xl: { container: "w-28 h-28", text: "text-5xl", fallback: "text-2xl" },
};

export function ProfileAvatar({
  profile,
  size = "md",
  className = "",
}: ProfileAvatarProps) {
  const avatarUrl = getAvatarUrl(profile);
  const s = sizeMap[size];

  return (
    <div
      className={`${s.container} rounded-full bg-surface-elevated border border-border flex items-center justify-center flex-shrink-0 overflow-hidden ${className}`}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={profile.name}
          className="w-full h-full object-cover"
        />
      ) : profile.avatar ? (
        <span className={s.text}>{profile.avatar}</span>
      ) : (
        <span className={`text-foreground-muted font-medium ${s.fallback}`}>
          {profile.name.charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  );
}
