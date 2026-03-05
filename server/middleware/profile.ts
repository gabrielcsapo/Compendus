import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { db, profiles } from "../../app/lib/db";

// Extend Hono context with profile variables
declare module "hono" {
  interface ContextVariableMap {
    profileId: string;
    profileName: string;
    isAdmin: boolean;
  }
}

/**
 * Global middleware that reads the profile from X-Profile-Id header (iOS)
 * or compendus-profile cookie (web). Sets profileId, profileName, isAdmin
 * on the Hono context.
 *
 * If exactly 1 profile exists and no header/cookie is sent, auto-selects it
 * for backward compatibility.
 */
export const profileMiddleware = createMiddleware(async (c, next) => {
  // Try header first (iOS), then cookie (web)
  const profileId =
    c.req.header("X-Profile-Id") || getCookie(c, "compendus-profile");

  if (profileId) {
    const profile = db
      .select()
      .from(profiles)
      .where(eq(profiles.id, profileId))
      .get();
    if (profile) {
      c.set("profileId", profile.id);
      c.set("profileName", profile.name);
      c.set("isAdmin", profile.isAdmin ?? false);
    }
  }

  // Backward compat: if no profile selected and exactly 1 profile exists, auto-select
  if (!c.get("profileId")) {
    const allProfiles = db.select().from(profiles).all();
    if (allProfiles.length === 1) {
      const profile = allProfiles[0];
      c.set("profileId", profile.id);
      c.set("profileName", profile.name);
      c.set("isAdmin", profile.isAdmin ?? false);
    }
  }

  await next();
});

/**
 * Middleware that requires a valid profile to be selected.
 * Returns 401 if no profile is set.
 */
export const requireProfile = createMiddleware(async (c, next) => {
  if (!c.get("profileId")) {
    return c.json(
      { success: false, error: "Profile required", code: "NO_PROFILE" },
      401,
    );
  }
  await next();
});

/**
 * Middleware that requires the current profile to be an admin.
 * Returns 403 if not admin.
 */
export const requireAdmin = createMiddleware(async (c, next) => {
  if (!c.get("profileId")) {
    return c.json(
      { success: false, error: "Profile required", code: "NO_PROFILE" },
      401,
    );
  }
  if (!c.get("isAdmin")) {
    return c.json(
      { success: false, error: "Admin access required", code: "FORBIDDEN" },
      403,
    );
  }
  await next();
});
