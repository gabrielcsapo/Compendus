// Client-only device identity for the web app, mirroring the iOS DeviceIdentity
// helper so the browser reports itself as a distinct device when saving reading
// progress. Stored in localStorage; safe to call only in the browser.

const ID_KEY = "compendus.webDeviceId";
const NAME_KEY = "compendus.webDeviceName";

export interface WebDevice {
  deviceId: string;
  deviceName: string;
  deviceType: string;
}

function createDeviceId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

/** Stable per-browser identifier (persisted in localStorage). */
export function getWebDeviceId(): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = createDeviceId();
    localStorage.setItem(ID_KEY, id);
  }
  return id;
}

/** Friendly name, e.g. "Chrome on macOS". User override wins. */
function getWebDeviceName(): string {
  if (typeof localStorage !== "undefined") {
    const override = localStorage.getItem(NAME_KEY);
    if (override && override.trim()) return override.trim();
  }
  return defaultDeviceName();
}

function getWebDeviceType(): string {
  return "Web";
}

/** Full identity, or undefined when not in a browser. */
export function getWebDevice(): WebDevice | undefined {
  const deviceId = getWebDeviceId();
  if (!deviceId) return undefined;
  return { deviceId, deviceName: getWebDeviceName(), deviceType: getWebDeviceType() };
}

function defaultDeviceName(): string {
  if (typeof navigator === "undefined") return "Web";
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const os = /Macintosh|Mac OS/.test(ua)
    ? "macOS"
    : /Windows/.test(ua)
      ? "Windows"
      : /Linux/.test(ua)
        ? "Linux"
        : /iPhone|iPad|iPod/.test(ua)
          ? "iOS"
          : /Android/.test(ua)
            ? "Android"
            : "";
  return os ? `${browser} on ${os}` : browser;
}
