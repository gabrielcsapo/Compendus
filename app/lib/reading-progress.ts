// Shared per-device reading-progress logic used by both the iOS sync endpoint
// (server/routes/sync.ts) and the web reading-progress action (app/actions/
// reader.ts), so the cross-device roll-up has exactly one implementation.
//
// Server-only (uses the better-sqlite3 `db`). Do not import from client components.

import { db, userBookState, deviceBookProgress } from "./db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

function tsToUnixSeconds(value: Date | number): number {
  return value instanceof Date ? Math.floor(value.getTime() / 1000) : value;
}

/**
 * Recompute the book-level position roll-up in userBookState from all of a
 * book's per-device rows: furthest readingProgress wins (and carries its
 * lastPosition), most-recent lastReadAt wins. Book-level fields (isRead/rating/
 * review) are owned by userBookState directly and left untouched here.
 */
function recomputeReadingProgressRollup(profileId: string, bookId: string, now: Date) {
  const rows = db
    .select()
    .from(deviceBookProgress)
    .where(and(eq(deviceBookProgress.profileId, profileId), eq(deviceBookProgress.bookId, bookId)))
    .all();
  if (rows.length === 0) return;

  let furthest = rows[0];
  let latestReadAt: Date | null = null;
  for (const r of rows) {
    if ((r.readingProgress ?? 0) > (furthest.readingProgress ?? 0)) furthest = r;
    if (r.lastReadAt) {
      const d =
        r.lastReadAt instanceof Date
          ? r.lastReadAt
          : new Date(tsToUnixSeconds(r.lastReadAt) * 1000);
      if (!latestReadAt || d > latestReadAt) latestReadAt = d;
    }
  }

  const existing = db
    .select()
    .from(userBookState)
    .where(and(eq(userBookState.profileId, profileId), eq(userBookState.bookId, bookId)))
    .get();

  if (existing) {
    db.update(userBookState)
      .set({
        readingProgress: furthest.readingProgress ?? 0,
        lastPosition: furthest.lastPosition,
        lastReadAt: latestReadAt,
        updatedAt: now,
      })
      .where(eq(userBookState.id, existing.id))
      .run();
  } else {
    db.insert(userBookState)
      .values({
        id: randomUUID(),
        profileId,
        bookId,
        readingProgress: furthest.readingProgress ?? 0,
        lastPosition: furthest.lastPosition,
        lastReadAt: latestReadAt,
        isRead: false,
        updatedAt: now,
      })
      .run();
  }
}

export interface DeviceProgressInput {
  profileId: string;
  bookId: string;
  deviceId: string;
  deviceName?: string;
  deviceType?: string;
  readingProgress?: number;
  lastPosition?: string | null;
  lastReadAt?: Date | null;
  /** Client-supplied stamp used to drop out-of-order writes from the same device. */
  updatedAt?: Date | null;
  now?: Date;
}

/**
 * Upsert this device's own reading position (never clobbering other devices),
 * then roll the per-device positions up into userBookState. The book-level
 * record is created if missing. Returns nothing; throws on FK violation (caller
 * decides how to surface "book not on server").
 */
export function upsertDeviceReadingProgress(input: DeviceProgressInput): void {
  const now = input.now ?? new Date();
  const clientTs = input.updatedAt ? tsToUnixSeconds(input.updatedAt) : null;

  const existingDevice = db
    .select()
    .from(deviceBookProgress)
    .where(
      and(
        eq(deviceBookProgress.profileId, input.profileId),
        eq(deviceBookProgress.bookId, input.bookId),
        eq(deviceBookProgress.deviceId, input.deviceId),
      ),
    )
    .get();

  // Guard against a stale (out-of-order) push from the same device overwriting a
  // newer position it already recorded.
  const deviceIsStale =
    existingDevice && clientTs !== null && tsToUnixSeconds(existingDevice.updatedAt) > clientTs;

  if (existingDevice) {
    const updates: Record<string, unknown> = {
      deviceName: input.deviceName ?? existingDevice.deviceName,
      deviceType: input.deviceType ?? existingDevice.deviceType,
      updatedAt: now,
    };
    if (!deviceIsStale) {
      if (input.readingProgress !== undefined) updates.readingProgress = input.readingProgress;
      if (input.lastPosition !== undefined) updates.lastPosition = input.lastPosition;
      if (input.lastReadAt !== undefined) updates.lastReadAt = input.lastReadAt;
    }
    db.update(deviceBookProgress)
      .set(updates)
      .where(eq(deviceBookProgress.id, existingDevice.id))
      .run();
  } else {
    db.insert(deviceBookProgress)
      .values({
        id: randomUUID(),
        profileId: input.profileId,
        bookId: input.bookId,
        deviceId: input.deviceId,
        deviceName: input.deviceName ?? "",
        deviceType: input.deviceType ?? "other",
        readingProgress: input.readingProgress ?? 0,
        lastPosition: input.lastPosition ?? null,
        lastReadAt: input.lastReadAt ?? null,
        updatedAt: now,
      })
      .run();
  }

  recomputeReadingProgressRollup(input.profileId, input.bookId, now);
}
