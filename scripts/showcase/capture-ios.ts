import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import { iosShowcaseScenes, type IOSShowcaseScene } from "../../showcase/scenes.js";
import { seedShowcase, SHOWCASE_PROFILE_ID, SHOWCASE_ROOT } from "./seed.js";
import { buildShowcaseApp, startShowcaseServer } from "./runtime.js";

const bundleId = "com.csapo.Compendus";
const derivedData = resolve(SHOWCASE_ROOT, "DerivedData");
const appPath = resolve(derivedData, "Build/Products/Debug-iphonesimulator/Compendus.app");
const mastersDir = resolve(SHOWCASE_ROOT, "masters/ios");
const publicDir = resolve(process.cwd(), "docs/public");

interface SimulatorDevice {
  name: string;
  udid: string;
  state: "Booted" | "Shutdown" | string;
  isAvailable: boolean;
}

interface SimulatorRuntime {
  identifier: string;
  name: string;
  version: string;
  isAvailable: boolean;
}

interface SimulatorDeviceType {
  identifier: string;
  name: string;
}

const showcaseDeviceNames = {
  iphone: "Compendus Showcase - iPhone",
  ipad: "Compendus Showcase - iPad",
} as const;

function runSimctl(args: string[], options: { quiet?: boolean } = {}) {
  return execFileSync("xcrun", ["simctl", ...args], {
    encoding: "utf8",
    stdio: options.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

function availableDevices(): SimulatorDevice[] {
  const raw = execFileSync("xcrun", ["simctl", "list", "devices", "available", "--json"], {
    encoding: "utf8",
  });
  const parsed = JSON.parse(raw) as { devices: Record<string, SimulatorDevice[]> };
  return Object.values(parsed.devices)
    .flat()
    .filter((device) => device.isAvailable !== false);
}

function createShowcaseDevice(kind: IOSShowcaseScene["device"]): SimulatorDevice {
  const runtimesRaw = execFileSync("xcrun", ["simctl", "list", "runtimes", "available", "--json"], {
    encoding: "utf8",
  });
  const runtimes = (JSON.parse(runtimesRaw) as { runtimes: SimulatorRuntime[] }).runtimes
    .filter((runtime) => runtime.isAvailable !== false && runtime.name.startsWith("iOS "))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  const runtime = runtimes[0];
  if (!runtime) throw new Error("No available iOS simulator runtime found");

  const deviceTypesRaw = execFileSync("xcrun", ["simctl", "list", "devicetypes", "--json"], {
    encoding: "utf8",
  });
  const deviceTypes = (JSON.parse(deviceTypesRaw) as { devicetypes: SimulatorDeviceType[] })
    .devicetypes;
  const preferredNames =
    kind === "iphone"
      ? ["iPhone 17 Pro", "iPhone 17", "iPhone 16 Pro"]
      : ["iPad Pro 13-inch (M5)", "iPad Pro 13-inch (M4)", "iPad Pro (12.9-inch) (6th generation)"];
  const deviceType =
    preferredNames
      .map((name) => deviceTypes.find((candidate) => candidate.name === name))
      .find(Boolean) ??
    deviceTypes.find((candidate) =>
      candidate.name.startsWith(kind === "iphone" ? "iPhone" : "iPad"),
    );
  if (!deviceType) throw new Error(`No ${kind} simulator device type found`);

  const name = showcaseDeviceNames[kind];
  const udid = execFileSync(
    "xcrun",
    ["simctl", "create", name, deviceType.identifier, runtime.identifier],
    { encoding: "utf8" },
  ).trim();
  return { name, udid, state: "Shutdown", isAvailable: true };
}

function selectDevice(kind: IOSShowcaseScene["device"]) {
  const environmentKey = kind === "iphone" ? "SHOWCASE_IPHONE_UDID" : "SHOWCASE_IPAD_UDID";
  const pinned = process.env[environmentKey];
  const devices = availableDevices();
  if (pinned) {
    const device = devices.find((candidate) => candidate.udid === pinned);
    if (!device) throw new Error(`${environmentKey} does not identify an available simulator`);
    return device;
  }

  return (
    devices.find((device) => device.name === showcaseDeviceNames[kind]) ??
    createShowcaseDevice(kind)
  );
}

function boot(device: SimulatorDevice) {
  if (device.state !== "Booted") {
    runSimctl(["boot", device.udid]);
  }
  runSimctl(["bootstatus", device.udid, "-b"]);
}

function configure(device: SimulatorDevice, scene: IOSShowcaseScene, serverUrl: string) {
  const today = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const defaults = [
    ["hasCompletedOnboarding", "-bool", "YES"],
    ["serverURL", serverUrl],
    ["selectedProfileId", SHOWCASE_PROFILE_ID],
    ["selectedProfileName", "Alex"],
    ["selectedProfileAvatar", "A"],
    ["selectedProfileIsAdmin", "-bool", "YES"],
    ["colorScheme", scene.theme],
    ["activeThemeId", "default"],
    ["compendus.celebrated.dailyGoal", today],
    ["compendus.celebrated.streak", "-int", "365"],
    ["compendus.celebrated.booksRead", "-int", "6"],
  ];
  for (const setting of defaults) {
    runSimctl(["spawn", device.udid, "defaults", "write", bundleId, ...setting]);
  }
  runSimctl([
    "status_bar",
    device.udid,
    "override",
    "--time",
    "9:41",
    "--batteryState",
    "charged",
    "--batteryLevel",
    "100",
    "--wifiBars",
    "3",
    "--cellularBars",
    "4",
  ]);
}

function launch(device: SimulatorDevice, scene: IOSShowcaseScene) {
  const result = spawnSync(
    "xcrun",
    ["simctl", "launch", "--terminate-running-process", device.udid, bundleId],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        SIMCTL_CHILD_COMPENDUS_SHOWCASE_TAB: String(scene.tab),
        SIMCTL_CHILD_COMPENDUS_SHOWCASE_FILTER: scene.filter,
      },
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || `Unable to launch ${bundleId}`);
  }
}

async function captureIOSShowcase() {
  await seedShowcase();
  buildShowcaseApp();
  mkdirSync(mastersDir, { recursive: true });
  const server = await startShowcaseServer();

  try {
    execFileSync(
      "xcodebuild",
      [
        "-project",
        "Compendus/Compendus.xcodeproj",
        "-scheme",
        "Compendus",
        "-configuration",
        "Debug",
        "-sdk",
        "iphonesimulator",
        "-quiet",
        "-derivedDataPath",
        derivedData,
        "CODE_SIGNING_ALLOWED=NO",
        "build",
      ],
      { stdio: "inherit" },
    );
    if (!existsSync(appPath)) throw new Error(`Built app not found at ${appPath}`);

    const installed = new Set<string>();
    for (const scene of iosShowcaseScenes) {
      const device = selectDevice(scene.device);
      boot(device);
      if (!installed.has(device.udid)) {
        try {
          runSimctl(["uninstall", device.udid, bundleId], { quiet: true });
        } catch {
          // A fresh simulator may not have Compendus installed yet.
        }
        runSimctl(["install", device.udid, appPath]);
        installed.add(device.udid);
      }
      configure(device, scene, server.url);
      launch(device, scene);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 4_000));

      const master = resolve(mastersDir, `${scene.id}.png`);
      runSimctl(["io", device.udid, "screenshot", master]);
      const optimized = resolve(publicDir, scene.image.replace(/^\//, ""));
      mkdirSync(dirname(optimized), { recursive: true });
      await sharp(master).webp({ quality: 90, smartSubsample: true }).toFile(optimized);
      runSimctl(["terminate", device.udid, bundleId]);
      console.log(`Captured ${scene.id} on ${device.name}`);
    }
  } finally {
    for (const device of availableDevices().filter((candidate) => candidate.state === "Booted")) {
      try {
        runSimctl(["status_bar", device.udid, "clear"], { quiet: true });
      } catch {
        // Status bar overrides are cosmetic; do not mask capture results.
      }
      if (
        Object.values(showcaseDeviceNames).includes(
          device.name as (typeof showcaseDeviceNames)[keyof typeof showcaseDeviceNames],
        )
      ) {
        try {
          runSimctl(["shutdown", device.udid], { quiet: true });
        } catch {
          // Shutdown is cleanup only; captures are already complete.
        }
      }
    }
    server.stop();
  }
}

await captureIOSShowcase();
