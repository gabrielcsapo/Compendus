import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { createHash, randomBytes } from "crypto";
import { db, profiles, type Profile } from "../../app/lib/db";
import { requireAdmin } from "../middleware/profile";

const app = new Hono();

// --- PIN utilities ---

function hashPin(pin: string, salt: string): string {
  return createHash("sha256")
    .update(salt + pin)
    .digest("hex");
}

function generateSalt(): string {
  return randomBytes(16).toString("hex");
}

function createPinHash(pin: string): string {
  const salt = generateSalt();
  const hash = hashPin(pin, salt);
  return `${salt}:${hash}`;
}

function verifyPin(pin: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  return hashPin(pin, salt) === hash;
}

// --- Helper to sanitize profile for API response ---

function toApiProfile(profile: Profile) {
  return {
    id: profile.id,
    name: profile.name,
    avatar: profile.avatar,
    hasPin: !!profile.pinHash,
    isAdmin: profile.isAdmin ?? false,
    createdAt: profile.createdAt
      ? (profile.createdAt instanceof Date
          ? profile.createdAt.toISOString()
          : new Date(profile.createdAt * 1000).toISOString())
      : null,
  };
}

// --- Routes ---

// GET /api/profiles — List all profiles (public, for picker screen)
app.get("/api/profiles", (c) => {
  const allProfiles = db.select().from(profiles).all();
  return c.json({
    success: true,
    profiles: allProfiles.map(toApiProfile),
  });
});

// GET /api/profiles/me — Get current profile info
app.get("/api/profiles/me", (c) => {
  const profileId = c.get("profileId");
  if (!profileId) {
    return c.json(
      { success: false, error: "No profile selected", code: "NO_PROFILE" },
      401,
    );
  }

  const profile = db
    .select()
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .get();
  if (!profile) {
    return c.json(
      { success: false, error: "Profile not found", code: "NOT_FOUND" },
      404,
    );
  }

  return c.json({ success: true, profile: toApiProfile(profile) });
});

// POST /api/profiles — Create a new profile
// First profile: anyone can create (auto-admin). After: admin only.
app.post("/api/profiles", async (c) => {
  const allProfiles = db.select().from(profiles).all();
  const isFirstProfile = allProfiles.length === 0;

  // After the first profile, only admins can create
  if (!isFirstProfile && !c.get("isAdmin")) {
    return c.json(
      {
        success: false,
        error: "Only admins can create profiles",
        code: "FORBIDDEN",
      },
      403,
    );
  }

  const body = await c.req.json<{
    name: string;
    avatar?: string;
    pin?: string;
  }>();

  if (!body.name || body.name.trim().length === 0) {
    return c.json(
      { success: false, error: "Name is required", code: "VALIDATION" },
      400,
    );
  }

  // Check for duplicate name
  const existing = db
    .select()
    .from(profiles)
    .where(eq(profiles.name, body.name.trim()))
    .get();
  if (existing) {
    return c.json(
      {
        success: false,
        error: "A profile with this name already exists",
        code: "DUPLICATE",
      },
      409,
    );
  }

  const id = randomUUID();
  const pinHash = body.pin ? createPinHash(body.pin) : null;

  db.insert(profiles)
    .values({
      id,
      name: body.name.trim(),
      avatar: body.avatar || null,
      pinHash,
      isAdmin: isFirstProfile, // First profile is always admin
    })
    .run();

  const profile = db.select().from(profiles).where(eq(profiles.id, id)).get()!;

  return c.json({ success: true, profile: toApiProfile(profile) }, 201);
});

// PUT /api/profiles/:id — Update a profile (self or admin)
app.put("/api/profiles/:id", async (c) => {
  const targetId = c.req.param("id");
  const currentProfileId = c.get("profileId");
  const isAdmin = c.get("isAdmin");

  // Must be self or admin
  if (targetId !== currentProfileId && !isAdmin) {
    return c.json(
      {
        success: false,
        error: "Can only edit your own profile",
        code: "FORBIDDEN",
      },
      403,
    );
  }

  const existing = db
    .select()
    .from(profiles)
    .where(eq(profiles.id, targetId))
    .get();
  if (!existing) {
    return c.json(
      { success: false, error: "Profile not found", code: "NOT_FOUND" },
      404,
    );
  }

  const body = await c.req.json<{
    name?: string;
    avatar?: string;
    pin?: string | null; // null = remove PIN
    isAdmin?: boolean;
  }>();

  const updates: Partial<{
    name: string;
    avatar: string | null;
    pinHash: string | null;
    isAdmin: boolean;
    updatedAt: Date;
  }> = {
    updatedAt: new Date(),
  };

  if (body.name !== undefined) {
    if (body.name.trim().length === 0) {
      return c.json(
        { success: false, error: "Name cannot be empty", code: "VALIDATION" },
        400,
      );
    }
    // Check duplicate name (excluding self)
    const duplicate = db
      .select()
      .from(profiles)
      .where(eq(profiles.name, body.name.trim()))
      .get();
    if (duplicate && duplicate.id !== targetId) {
      return c.json(
        { success: false, error: "Name already taken", code: "DUPLICATE" },
        409,
      );
    }
    updates.name = body.name.trim();
  }

  if (body.avatar !== undefined) {
    updates.avatar = body.avatar;
  }

  if (body.pin !== undefined) {
    updates.pinHash = body.pin ? createPinHash(body.pin) : null;
  }

  // Only admins can change admin status, and not on themselves
  if (body.isAdmin !== undefined && isAdmin && targetId !== currentProfileId) {
    updates.isAdmin = body.isAdmin;
  }

  db.update(profiles).set(updates).where(eq(profiles.id, targetId)).run();

  const updated = db
    .select()
    .from(profiles)
    .where(eq(profiles.id, targetId))
    .get()!;
  return c.json({ success: true, profile: toApiProfile(updated) });
});

// DELETE /api/profiles/:id — Delete a profile (admin only, can't delete self)
app.delete("/api/profiles/:id", requireAdmin, (c) => {
  const targetId = c.req.param("id");
  const currentProfileId = c.get("profileId");

  if (targetId === currentProfileId) {
    return c.json(
      {
        success: false,
        error: "Cannot delete your own profile",
        code: "SELF_DELETE",
      },
      400,
    );
  }

  const existing = db
    .select()
    .from(profiles)
    .where(eq(profiles.id, targetId))
    .get();
  if (!existing) {
    return c.json(
      { success: false, error: "Profile not found", code: "NOT_FOUND" },
      404,
    );
  }

  // FK cascades will delete all per-user data
  db.delete(profiles).where(eq(profiles.id, targetId)).run();

  return c.json({ success: true });
});

// POST /api/profiles/:id/select — Select/switch to a profile (verify PIN if set)
app.post("/api/profiles/:id/select", async (c) => {
  const targetId = c.req.param("id");

  const profile = db
    .select()
    .from(profiles)
    .where(eq(profiles.id, targetId))
    .get();
  if (!profile) {
    return c.json(
      { success: false, error: "Profile not found", code: "NOT_FOUND" },
      404,
    );
  }

  // Verify PIN if the profile has one
  if (profile.pinHash) {
    let body: { pin?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      // No body provided
    }
    if (!body.pin || !verifyPin(body.pin, profile.pinHash)) {
      return c.json(
        { success: false, error: "Invalid PIN", code: "INVALID_PIN" },
        401,
      );
    }
  }

  // Set cookie for web clients
  setCookie(c, "compendus-profile", profile.id, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    maxAge: 365 * 24 * 60 * 60, // 1 year
  });

  return c.json({ success: true, profile: toApiProfile(profile) });
});

// POST /api/profiles/logout — Clear profile selection
app.post("/api/profiles/logout", (c) => {
  deleteCookie(c, "compendus-profile", { path: "/" });
  return c.json({ success: true });
});

export { app as profileRoutes };
