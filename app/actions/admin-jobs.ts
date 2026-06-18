"use server";

/**
 * Server-action wrappers for the admin workspace — thin assertAdmin shims
 * over app/lib/admin-workspace.ts. NOTE: the admin UI currently calls the
 * REST mirrors under /api/admin/workspace/* instead (server-action responses
 * hang client-side — react-flight-router stream bug); these remain for
 * programmatic use and for when that bug is fixed.
 */
import { eq } from "drizzle-orm";
import { db, profiles } from "../lib/db";
import { resolveProfileId } from "../lib/profile";
import * as ws from "../lib/admin-workspace";

export type { JobsSummary, SidebarCounts, AdminJobRow } from "../lib/admin-workspace";

function assertAdmin(): void {
  const profileId = resolveProfileId();
  const profile = profileId
    ? db.select().from(profiles).where(eq(profiles.id, profileId)).get()
    : undefined;
  if (!profile?.isAdmin) throw new Error("Admin profile required");
}

export async function adminJobsSummary() {
  assertAdmin();
  return ws.adminJobsSummary();
}

export async function adminSidebarCounts() {
  assertAdmin();
  return ws.adminSidebarCounts();
}

export async function adminPauseQueue(minutes: number) {
  assertAdmin();
  return ws.adminPauseQueue(minutes);
}

export async function adminResumeQueue() {
  assertAdmin();
  return ws.adminResumeQueue();
}

export async function adminRetryJob(jobId: string) {
  assertAdmin();
  return ws.adminRetryJob(jobId);
}

export async function adminDismissJob(jobId: string) {
  assertAdmin();
  return ws.adminDismissJob(jobId);
}

export async function adminRetryAllErrors() {
  assertAdmin();
  return ws.adminRetryAllErrors();
}

export async function adminClearCompleted() {
  assertAdmin();
  return ws.adminClearCompleted();
}

export async function adminGetJobLogs(jobId: string) {
  assertAdmin();
  return ws.adminGetJobLogs(jobId);
}

export async function adminJobsList(opts: {
  view: "attention" | "active" | "history";
  page: number;
  pageSize: number;
  q?: string;
}) {
  assertAdmin();
  return ws.adminJobsList(opts);
}
