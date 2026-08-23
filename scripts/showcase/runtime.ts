import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { SHOWCASE_DATA_DIR } from "./seed.js";

export const SHOWCASE_PORT = Number(process.env.SHOWCASE_PORT || 4310);
export const SHOWCASE_URL = `http://127.0.0.1:${SHOWCASE_PORT}`;

export function buildShowcaseApp() {
  if (process.env.SHOWCASE_SKIP_WEB_BUILD === "1") return;
  execFileSync("pnpm", ["build"], {
    cwd: process.cwd(),
    env: { ...process.env, COMPENDUS_DATA_DIR: SHOWCASE_DATA_DIR, PAUSE_PROCESSING: "1" },
    stdio: "inherit",
  });
}

async function waitForServer(server: ChildProcess, timeoutMs = 45_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (server.exitCode != null) {
      throw new Error(`Showcase server exited with code ${server.exitCode}`);
    }
    try {
      const response = await fetch(`${SHOWCASE_URL}/api/profiles`);
      if (response.ok) return;
    } catch {
      // The first few requests race Vite startup.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Showcase server did not become ready at ${SHOWCASE_URL}`);
}

export async function startShowcaseServer() {
  let logs = "";
  const server = spawn("node", ["--import", "tsx", "server.ts"], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      COMPENDUS_DATA_DIR: SHOWCASE_DATA_DIR,
      PAUSE_PROCESSING: "1",
      PORT: String(SHOWCASE_PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const remember = (chunk: Buffer) => {
    logs = `${logs}${chunk.toString()}`.slice(-12_000);
  };
  server.stdout?.on("data", remember);
  server.stderr?.on("data", remember);

  try {
    await waitForServer(server);
  } catch (error) {
    throw new Error(`${String(error)}\n${logs}`);
  }

  return {
    url: SHOWCASE_URL,
    stop() {
      if (server.pid && server.exitCode == null) {
        try {
          process.kill(-server.pid, "SIGTERM");
        } catch {
          server.kill("SIGTERM");
        }
      }
    },
  };
}
