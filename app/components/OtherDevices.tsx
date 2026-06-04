"use client";

import { useEffect, useState } from "react";
import { getWebDeviceId } from "@/lib/web-device";
import type { DeviceReadingProgress } from "@/actions/reader";

/**
 * "Other Devices" reading-progress list for the book detail page. Filters out
 * THIS browser (by its localStorage device id) so it shows only the positions
 * reported by the user's other devices (iPhone, iPad, another browser, …).
 * Renders nothing until the own id is known or when there are no other devices.
 */
export function OtherDevices({ devices }: { devices: DeviceReadingProgress[] }) {
  const [ownId, setOwnId] = useState<string | undefined>(undefined);

  useEffect(() => {
    setOwnId(getWebDeviceId());
  }, []);

  if (ownId === undefined) return null;
  const others = devices.filter((d) => d.deviceId !== ownId);
  if (others.length === 0) return null;

  return (
    <div className="max-w-xs pt-2">
      <div className="text-xs text-foreground-muted mb-1.5">Other devices</div>
      <div className="space-y-1.5">
        {others.map((d) => (
          <div
            key={d.deviceId}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-elevated border border-border"
          >
            <DeviceIcon type={d.deviceType} />
            <div className="min-w-0">
              <div className="text-sm text-foreground truncate">{d.deviceName || d.deviceType}</div>
              {d.lastReadAt && (
                <div className="text-xs text-foreground-muted">
                  Last read {relativeTime(d.lastReadAt)}
                </div>
              )}
            </div>
            <span className="ml-auto text-sm font-medium text-foreground tabular-nums">
              {Math.round(d.readingProgress * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeviceIcon({ type }: { type: string }) {
  const cls = "w-4 h-4 text-foreground-muted shrink-0";
  // Phone / tablet → device frame; everything else (web, mac) → monitor.
  if (type === "iPhone" || type === "iPad") {
    return (
      <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <rect x="7" y="3" width="10" height="18" rx="2" strokeWidth={2} />
        <path strokeLinecap="round" strokeWidth={2} d="M11 18h2" />
      </svg>
    );
  }
  return (
    <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="3" y="4" width="18" height="12" rx="2" strokeWidth={2} />
      <path strokeLinecap="round" strokeWidth={2} d="M8 20h8M12 16v4" />
    </svg>
  );
}

function relativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(epochMs).toLocaleDateString();
}
