"use client";

/**
 * REST client for the admin workspace UI. Mirrors the server actions in
 * app/actions/admin-jobs.ts via /api/admin/workspace/* — server-action
 * responses currently hang client-side (react-flight-router stream bug, also
 * visible on the fleet page's polling), so the admin UI uses plain fetch.
 */
import type { JobsSummary, SidebarCounts, AdminJobRow } from "./admin-workspace";

export type { JobsSummary, SidebarCounts, AdminJobRow };

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

export const adminRest = {
  summary: () => get<JobsSummary>("/api/admin/workspace/summary"),
  counts: () => get<SidebarCounts>("/api/admin/workspace/counts"),
  jobs: (opts: { view: string; page: number; pageSize: number; q?: string }) =>
    get<{ items: AdminJobRow[]; total: number }>(
      `/api/admin/workspace/jobs?view=${opts.view}&page=${opts.page}&pageSize=${opts.pageSize}&q=${encodeURIComponent(opts.q ?? "")}`,
    ),
  jobLogs: (id: string) =>
    get<{ logs: string }>(`/api/admin/workspace/job-logs/${encodeURIComponent(id)}`).then(
      (r) => r.logs,
    ),
  retryJob: (id: string) =>
    post<{ success: boolean; message: string }>(
      `/api/admin/workspace/jobs/${encodeURIComponent(id)}/retry`,
    ),
  dismissJob: (id: string) =>
    post<{ success: boolean; message: string }>(`/api/admin/jobs/${encodeURIComponent(id)}/cancel`),
  retryAllErrors: () => post<{ retried: number }>("/api/admin/workspace/jobs/retry-all-errors"),
  clearCompleted: () => post<{ cleared: number }>("/api/admin/workspace/jobs/clear-completed"),
  pause: (minutes: number) => post<{ paused: boolean }>("/api/admin/jobs/pause", { minutes }),
  resume: () => post<{ paused: boolean }>("/api/admin/jobs/resume"),
};
