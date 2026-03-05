import { getRequest } from "react-flight-router/server";
import { db, profiles } from "./db";
import { eq } from "drizzle-orm";

/**
 * Resolve the current profileId from the request cookie.
 * Falls back to auto-selecting if exactly one profile exists.
 * Works inside server components and server actions where
 * the Hono context is not available.
 */
export function resolveProfileId(): string | undefined {
  const request = getRequest();
  if (request) {
    const cookieHeader = request.headers.get("Cookie") ?? "";
    const match = cookieHeader.match(/(?:^|;\s*)compendus-profile=([^;]+)/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const profile = db.select().from(profiles).where(eq(profiles.id, id)).get();
      if (profile) return profile.id;
    }
  }
  // Fallback: auto-select if exactly one profile exists
  const allProfiles = db.select().from(profiles).all();
  if (allProfiles.length === 1) return allProfiles[0].id;
  return undefined;
}
