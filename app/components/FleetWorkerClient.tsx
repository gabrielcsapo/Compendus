"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The browser fleet worker — open this page on any machine (a work laptop, a
 * spare desktop) and the tab becomes an Idle Fleet device. No install: it
 * leases js-kernel jobs, fetches each kernel bundle by content hash, verifies
 * the hash with WebCrypto before executing, runs it in-tab, and posts the
 * result back. Kernels are pure compute (payload in, result out), so the only
 * thing this page grants them is CPU.
 *
 * Eligibility mirrors the native workers where the platform allows: when the
 * Battery API exists we only work while charging; otherwise (desktops,
 * Safari) we assume mains power. Work pauses when the tab is hidden.
 */

interface LeasedJob {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
}

const TOKEN_KEY = "compendus-fleet-token";
const NAME_KEY = "compendus-fleet-name";
const SUFFIX_KEY = "compendus-fleet-suffix";

/**
 * navigator.platform is identical across machines of the same kind ("MacIntel"
 * on every Mac), so two laptops both defaulted to "browser-macintel" and were
 * indistinguishable on the fleet dashboard. A per-browser random suffix
 * (persisted per browser profile) keeps default names unique; legacy
 * suffix-less names upgrade in place and the lease-time self-heal renames the
 * server's device row on the next poll.
 */
function browserSuffix(): string {
  let suffix = localStorage.getItem(SUFFIX_KEY);
  if (!suffix) {
    suffix = [...crypto.getRandomValues(new Uint8Array(2))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    localStorage.setItem(SUFFIX_KEY, suffix);
  }
  return suffix;
}

const CAPABILITIES = {
  runtimes: ["echo", "js-kernel"],
  kinds: { echo: 1, "kernel-wordstats": 1, "convert-pdf-ccd": 1, "convert-pdf-epub": 1 },
  ramClass: 8,
};

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const kernelCache = new Map<string, (payload: unknown) => Promise<unknown>>();

async function loadKernel(
  hash: string,
  token: string,
): Promise<(payload: unknown) => Promise<unknown>> {
  const cached = kernelCache.get(hash);
  if (cached) return cached;
  const res = await fetch(`/api/fabric/kernels/${hash}`, {
    headers: { "X-Fabric-Token": token },
  });
  if (!res.ok) throw new Error(`kernel fetch ${res.status}`);
  const bytes = await res.arrayBuffer();
  if ((await sha256Hex(bytes)) !== hash) throw new Error("kernel hash mismatch");
  const url = URL.createObjectURL(new Blob([bytes], { type: "text/javascript" }));
  try {
    const mod = await import(/* @vite-ignore */ url);
    kernelCache.set(hash, mod.default);
    return mod.default;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function FleetWorkerClient() {
  const [token, setToken] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [working, setWorking] = useState(false);
  const [charging, setCharging] = useState<boolean | null>(null);
  const [jobsDone, setJobsDone] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const loopRef = useRef(false);

  const append = useCallback((line: string) => {
    setLog((l) => [`${new Date().toLocaleTimeString()} ${line}`, ...l].slice(0, 50));
  }, []);

  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_KEY));
    const platformSlug = navigator.platform.toLowerCase().replace(/\W+/g, "-");
    const stored = localStorage.getItem(NAME_KEY);
    // Upgrade legacy ambiguous defaults ("browser-macintel") with this
    // browser's suffix; user-chosen names are left untouched.
    const name =
      !stored || stored === `browser-${platformSlug}`
        ? `browser-${platformSlug}-${browserSuffix()}`
        : stored;
    if (stored !== name) localStorage.setItem(NAME_KEY, name);
    setDeviceName(name);
    // Battery API (Chrome): only work while charging, like the native fleet.
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{
        charging: boolean;
        addEventListener: (e: string, f: () => void) => void;
      }>;
    };
    if (nav.getBattery) {
      nav.getBattery().then((b) => {
        setCharging(b.charging);
        b.addEventListener("chargingchange", () => setCharging(b.charging));
      });
    } else {
      setCharging(true); // no battery info → assume mains (desktop)
    }
  }, []);

  const enroll = useCallback(async () => {
    const res = await fetch("/api/fabric/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: deviceName, platform: "web", capabilities: CAPABILITIES }),
    });
    const d = await res.json();
    if (d?.success && d.token) {
      localStorage.setItem(TOKEN_KEY, d.token);
      localStorage.setItem(NAME_KEY, deviceName);
      setToken(d.token);
      append(`enrolled as ${deviceName}`);
    } else {
      append(`enrollment failed: ${d?.error ?? res.status} (admin profile required)`);
    }
  }, [deviceName, append]);

  const runOne = useCallback(
    async (authToken: string): Promise<boolean> => {
      const headers = { "X-Fabric-Token": authToken, "Content-Type": "application/json" };
      const lease = await fetch("/api/fabric/lease", {
        method: "POST",
        headers,
        body: JSON.stringify({ capabilities: CAPABILITIES, deviceName }),
      }).then((r) => r.json());
      const job = lease?.job as LeasedJob | null;
      if (!job) return false;
      append(`leased ${job.kind}`);
      try {
        let result: unknown;
        let artifactHash: string | undefined;
        if (typeof job.payload.kernelHash === "string") {
          const kernel = await loadKernel(job.payload.kernelHash, authToken);
          if (typeof job.payload.fileRef === "string") {
            const fres = await fetch(job.payload.fileRef, {
              headers: { "X-Fabric-Token": authToken },
            });
            if (!fres.ok) throw new Error(`file fetch ${fres.status}`);
            (job.payload as Record<string, unknown>).__bytes = await fres.arrayBuffer();
          }
          // Long kernels (PDF conversions run minutes) must outlive the
          // 10-min lease TTL — heartbeat while computing.
          const beat = setInterval(() => {
            fetch(`/api/fabric/work/${job.id}/heartbeat`, { method: "POST", headers }).catch(
              () => {},
            );
          }, 120_000);
          let out: {
            artifactJson?: string;
            artifactBytes?: Uint8Array;
            mime?: string;
            result?: Record<string, unknown>;
          };
          try {
            out = (await kernel(job.payload)) as typeof out;
          } finally {
            clearInterval(beat);
          }
          // artifactJson = text blob; artifactBytes = binary blob (raw bytes,
          // never base64 — GB-scale artifacts exceed V8's max string length).
          const blobBody: BodyInit | null =
            typeof out?.artifactJson === "string"
              ? out.artifactJson
              : out?.artifactBytes instanceof Uint8Array
                ? new Blob([out.artifactBytes as Uint8Array<ArrayBuffer>])
                : null;
          if (blobBody !== null) {
            const up = await fetch(`/api/fabric/work/${job.id}/artifact`, {
              method: "POST",
              headers: {
                "X-Fabric-Token": authToken,
                "Content-Type":
                  out.mime ??
                  (typeof blobBody === "string" ? "application/json" : "application/octet-stream"),
              },
              body: blobBody,
            }).then((r) => r.json());
            if (!up?.artifactHash) throw new Error("artifact upload failed");
            artifactHash = up.artifactHash as string;
            result = { ...out.result, artifactHash };
          } else {
            result = out;
          }
        } else if (job.kind === "echo") {
          result = { echoed: String(job.payload.text).toUpperCase() };
        } else {
          await fetch(`/api/fabric/work/${job.id}/release`, {
            method: "POST",
            headers,
            body: JSON.stringify({ reason: `no browser handler for ${job.kind}` }),
          });
          return true;
        }
        const done = await fetch(`/api/fabric/work/${job.id}/result`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            result,
            modelId: `browser/${navigator.userAgent.includes("Chrome") ? "chrome" : "web"}`,
            ...(artifactHash ? { artifactHash, mime: "application/json" } : {}),
          }),
        }).then((r) => r.json());
        if (done?.success) {
          setJobsDone((n) => n + 1);
          append(`completed ${job.kind}`);
        } else {
          append(`result rejected: ${done?.error ?? "?"}`);
        }
      } catch (e) {
        append(`failed: ${e instanceof Error ? e.message : e}`);
        await fetch(`/api/fabric/work/${job.id}/release`, {
          method: "POST",
          headers,
          body: JSON.stringify({ reason: "browser handler error" }),
        }).catch(() => {});
      }
      return true;
    },
    [deviceName, append],
  );

  useEffect(() => {
    if (!working || !token) return;
    loopRef.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!loopRef.current) return;
      // Charging-gated only: a backgrounded tab still works (browsers throttle
      // its timers to ~1/min, which is acceptable pacing — better than a worker
      // that silently stops the moment you switch tabs).
      const eligible = charging !== false;
      let didWork = false;
      if (eligible) {
        try {
          didWork = await runOne(token);
        } catch {
          append("lease failed — retrying");
        }
      }
      timer = setTimeout(tick, didWork ? 500 : 15_000);
    };
    tick();
    return () => {
      loopRef.current = false;
      clearTimeout(timer);
    };
  }, [working, token, charging, runOne, append]);

  return (
    <main className="container mx-auto max-w-2xl px-6 my-10">
      <h1 className="text-2xl font-bold text-foreground">Fleet Worker</h1>
      <p className="text-foreground-muted mt-1 text-sm">
        This tab can work for your library. No install — it fetches signed compute kernels and runs
        them right here while you leave it open{charging === false ? " (paused: on battery)" : ""}.
      </p>

      {!token ? (
        <div className="mt-6 flex gap-2">
          <input
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
            placeholder="Device name"
          />
          <button
            onClick={enroll}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
          >
            Enroll This Browser
          </button>
        </div>
      ) : (
        <div className="mt-6 flex items-center gap-4">
          <button
            onClick={() => setWorking((w) => !w)}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${
              working ? "bg-red-600 hover:bg-red-700" : "bg-primary hover:bg-primary-hover"
            }`}
          >
            {working ? "Stop Working" : "Start Working"}
          </button>
          <span className="text-sm text-foreground-muted">
            {working ? "Working — leave this tab open" : "Idle"} · {jobsDone} jobs this session
          </span>
        </div>
      )}

      {token && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-foreground-muted">Device name</span>
          <input
            value={deviceName}
            onChange={(e) => {
              setDeviceName(e.target.value);
              localStorage.setItem(NAME_KEY, e.target.value);
            }}
            className="rounded border border-border bg-surface px-2 py-1 text-xs text-foreground w-56"
          />
          <span className="text-xs text-foreground-muted">renames on next poll</span>
        </div>
      )}

      <div className="mt-6 rounded-lg border border-border bg-surface p-3 h-72 overflow-y-auto">
        {log.length === 0 ? (
          <p className="text-xs text-foreground-muted">Activity will appear here.</p>
        ) : (
          log.map((line, i) => (
            <div key={i} className="font-mono text-xs text-foreground-muted py-0.5">
              {line}
            </div>
          ))
        )}
      </div>
    </main>
  );
}
