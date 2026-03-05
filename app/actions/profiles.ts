"use server";

import { db, profiles, type Profile } from "../lib/db";
import { eq } from "drizzle-orm";
import { resolveProfileId } from "../lib/profile";

export type ApiProfile = {
  id: string;
  name: string;
  avatar: string | null;
  avatarUrl: string | null;
  hasPin: boolean;
  isAdmin: boolean;
  createdAt: string | null;
};

function toApiProfile(profile: Profile): ApiProfile {
  let avatarUrl: string | null = null;
  if (profile.avatar?.startsWith("data/avatars/")) {
    avatarUrl = `/avatars/${profile.id}.jpg`;
  }

  return {
    id: profile.id,
    name: profile.name,
    avatar: profile.avatar,
    avatarUrl,
    hasPin: !!profile.pinHash,
    isAdmin: profile.isAdmin ?? false,
    createdAt: profile.createdAt
      ? profile.createdAt instanceof Date
        ? profile.createdAt.toISOString()
        : new Date((profile.createdAt as number) * 1000).toISOString()
      : null,
  };
}

export async function getProfiles(): Promise<ApiProfile[]> {
  const allProfiles = db.select().from(profiles).all();
  return allProfiles.map(toApiProfile);
}

export async function getCurrentProfile(): Promise<ApiProfile | null> {
  const profileId = resolveProfileId();
  if (!profileId) return null;
  const profile = db.select().from(profiles).where(eq(profiles.id, profileId)).get();
  if (!profile) return null;
  return toApiProfile(profile);
}
