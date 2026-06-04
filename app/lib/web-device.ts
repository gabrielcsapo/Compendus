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

/** Stable per-browser identifier (persisted in localStorage). */
export function getWebDeviceId(): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ID_KEY, id);
  }
  return id;
}

/** Friendly name, e.g. "Chrome on macOS". User override wins. */
export function getWebDeviceName(): string {
  if (typeof localStorage !== "undefined") {
    const override = localStorage.getItem(NAME_KEY);
    if (override && override.trim()) return override.trim();
  }
  return defaultDeviceName();
}

export function setWebDeviceName(name: string | null): void {
  if (typeof localStorage === "undefined") return;
  if (name && name.trim()) localStorage.setItem(NAME_KEY, name.trim());
  else localStorage.removeItem(NAME_KEY);
}

export function getWebDeviceType(): string {
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
