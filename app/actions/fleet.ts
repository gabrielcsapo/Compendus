"use server";

/**
 * Server actions for Admin → Fleet. Admin-gated the same way the HTTP routes
 * are: the resolved profile must be an admin.
 */
import { eq } from "drizzle-orm";
import { db, profiles } from "../lib/db";
import { resolveProfileId } from "../lib/profile";
import { queueStatus, requeueFailed } from "../lib/fabric";
import { fleetAnalytics } from "../lib/fabric/analytics";

function assertAdmin(): void {
  const profileId = resolveProfileId();
  const profile = profileId
    ? db.select().from(profiles).where(eq(profiles.id, profileId)).get()
    : undefined;
  if (!profile?.isAdmin) throw new Error("Admin profile required");
}

export async function getFleetOverview() {
  assertAdmin();
  return { status: queueStatus(), analytics: fleetAnalytics() };
}

/** Re-queue failed work so the fleet retries it. Returns how many were re-queued. */
export async function retryFailedWork(kind?: string): Promise<{ requeued: number }> {
  assertAdmin();
  return { requeued: requeueFailed(kind) };
}
