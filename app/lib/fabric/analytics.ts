/**
 * Fleet analytics — the Idle Fleet's ledger, shared by the HTTP route and the
 * web's server actions. Attribution uses work_items.completed_by (permanent)
 * and leased_at→completed_at for processing time.
 */
import { rawDb } from "../db";

export function fleetAnalytics(sinceHours = 168) {
  const hours = Math.min(24 * 14, Math.max(1, sinceHours));
  const since = Math.floor(Date.now() / 1000) - hours * 3600;

  const perDevice = rawDb
    .prepare(
      `SELECT d.id, d.name, d.platform,
              COUNT(w.id) AS completed,
              ROUND(AVG(CASE WHEN w.leased_at IS NOT NULL THEN w.completed_at - w.leased_at END), 1) AS avgSeconds,
              SUM(CASE WHEN w.completed_at >= ? THEN 1 ELSE 0 END) AS inWindow
       FROM fabric_devices d
       LEFT JOIN work_items w ON w.completed_by = d.id AND w.status = 'done'
       GROUP BY d.id ORDER BY completed DESC`,
    )
    .all(since);

  const perDeviceKind = rawDb
    .prepare(
      `SELECT COALESCE(d.name, '(reaped)') AS device, w.kind, COUNT(*) AS done,
              ROUND(AVG(CASE WHEN w.leased_at IS NOT NULL THEN w.completed_at - w.leased_at END), 1) AS avgSeconds
       FROM work_items w LEFT JOIN fabric_devices d ON d.id = w.completed_by
       WHERE w.status = 'done' AND w.completed_by IS NOT NULL
       GROUP BY w.completed_by, w.kind ORDER BY done DESC`,
    )
    .all();

  const perKind = rawDb
    .prepare(
      `SELECT kind,
              SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
              SUM(CASE WHEN status IN ('queued','leased') THEN 1 ELSE 0 END) AS open,
              ROUND(AVG(CASE WHEN status = 'done' THEN attempts END), 2) AS avgAttempts,
              ROUND(AVG(CASE WHEN status = 'done' AND leased_at IS NOT NULL THEN completed_at - leased_at END), 1) AS avgSeconds
       FROM work_items GROUP BY kind ORDER BY done DESC`,
    )
    .all();

  const timeline = rawDb
    .prepare(
      `SELECT strftime('%Y-%m-%dT%H:00', completed_at, 'unixepoch') AS hour, COUNT(*) AS done
       FROM work_items WHERE status = 'done' AND completed_at >= ?
       GROUP BY hour ORDER BY hour`,
    )
    .all(Math.floor(Date.now() / 1000) - 24 * 3600);

  const artifacts = rawDb
    .prepare(
      `SELECT kind, COUNT(*) AS count, SUM(bytes) AS bytes FROM fabric_artifacts GROUP BY kind`,
    )
    .all();

  const recentFailures = rawDb
    .prepare(
      `SELECT kind, error, attempts, created_at AS createdAt FROM work_items
       WHERE status = 'failed' ORDER BY created_at DESC LIMIT 12`,
    )
    .all();

  return {
    sinceHours: hours,
    perDevice,
    perDeviceKind,
    perKind,
    timeline,
    artifacts,
    recentFailures,
  };
}
