import JSZip from "jszip";
import type { EpubStructure, ManifestItem, EpubMetadata } from "./types";

interface EditingSession {
  bookId: string;
  zip: JSZip;
  isDirty: boolean;
  openedAt: number;
  lastAccessedAt: number;
  opfPath: string;
  opfDir: string;
}

const sessions = new Map<string, EditingSession>();
const SESSION_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

// Cleanup expired sessions every 5 minutes
setInterval(cleanupExpiredSessions, 5 * 60 * 1000);

function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [bookId, session] of sessions) {
    if (now - session.lastAccessedAt > SESSION_EXPIRY_MS) {
      sessions.delete(bookId);
      console.log(`[Editor] Session expired for book ${bookId}`);
    }
  }
}

function touchSession(session: EditingSession): void {
  session.lastAccessedAt = Date.now();
}

/**
 * Parse container.xml to find the OPF file path
 */
async function findOpfPath(zip: JSZip): Promise<{ opfPath: string; opfDir: string } | null> {
  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  if (!containerXml) return null;

  const match = containerXml.match(/full-path="([^"]+)"/);
  if (!match) return null;

  const opfPath = match[1];
  const opfDir = opfPath.substring(0, opfPath.lastIndexOf("/") + 1);
  return { opfPath, opfDir };
}

/**
 * Parse the OPF content to extract structure
 */
function parseOpf(
  opfContent: string,
  _opfDir: string,
): {
  metadata: EpubMetadata;
  manifest: Map<string, { href: string; mediaType: string; properties?: string }>;
  spine: string[];
} {
  // Parse metadata
  const titleMatch = opfContent.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
  const creatorMatches = [...opfContent.matchAll(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/gi)];
  const languageMatch = opfContent.match(/<dc:language[^>]*>([^<]+)<\/dc:language>/i);
  const publisherMatch = opfContent.match(/<dc:publisher[^>]*>([^<]+)<\/dc:publisher>/i);
  const descriptionMatch = opfContent.match(/<dc:description[^>]*>([\s\S]*?)<\/dc:description>/i);

  const metadata: EpubMetadata = {
    title: titleMatch?.[1]?.trim() || "Untitled",
    authors: creatorMatches.map((m) => m[1].trim()),
    language: languageMatch?.[1]?.trim() || "en",
    publisher: publisherMatch?.[1]?.trim(),
    description: descriptionMatch?.[1]?.trim(),
  };

  // Parse manifest
  const manifest = new Map<string, { href: string; mediaType: string; properties?: string }>();
  const itemMatches = opfContent.matchAll(/<item\s+([^>]+)\/?>/gi);
  for (const tagMatch of itemMatches) {
    const attrs = tagMatch[1];
    const idMatch = attrs.match(/id\s*=\s*["']([^"']+)["']/i);
    const hrefMatch = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
    const mediaTypeMatch = attrs.match(/media-type\s*=\s*["']([^"']+)["']/i);
    const propertiesMatch = attrs.match(/properties\s*=\s*["']([^"']+)["']/i);

    if (idMatch && hrefMatch) {
      manifest.set(idMatch[1], {
        href: hrefMatch[1],
        mediaType: mediaTypeMatch?.[1] || "application/octet-stream",
        properties: propertiesMatch?.[1],
      });
    }
  }

  // Parse spine
  const spineMatches = opfContent.matchAll(/<itemref\s+[^>]*idref="([^"]+)"[^>]*\/?>/gi);
  const spine: string[] = [];
  for (const match of spineMatches) {
    spine.push(match[1]);
  }

  return { metadata, manifest, spine };
}

export async function openSession(bookId: string, buffer: Buffer): Promise<EpubStructure> {
  const zip = await JSZip.loadAsync(buffer);

  const paths = await findOpfPath(zip);
  if (!paths) {
    throw new Error("Invalid EPUB: could not find OPF file path in container.xml");
  }

  const session: EditingSession = {
    bookId,
    zip,
    isDirty: false,
    openedAt: Date.now(),
    lastAccessedAt: Date.now(),
    opfPath: paths.opfPath,
    opfDir: paths.opfDir,
  };

  sessions.set(bookId, session);
  console.log(`[Editor] Session opened for book ${bookId}`);

  return getStructureFromSession(session);
}

export function getSession(bookId: string): EditingSession | null {
  const session = sessions.get(bookId);
  if (!session) return null;
  touchSession(session);
  return session;
}

export function closeSession(bookId: string): void {
  sessions.delete(bookId);
  console.log(`[Editor] Session closed for book ${bookId}`);
}

export function hasSession(bookId: string): boolean {
  return sessions.has(bookId);
}

export async function getFileContent(bookId: string, path: string): Promise<string | null> {
  const session = getSession(bookId);
  if (!session) return null;

  const file = session.zip.file(path);
  if (!file) return null;

  return file.async("string");
}

export async function setFileContent(bookId: string, path: string, content: string): Promise<void> {
  const session = getSession(bookId);
  if (!session) throw new Error("No editing session found");

  session.zip.file(path, content);
  session.isDirty = true;
}

export async function saveSession(bookId: string): Promise<Buffer> {
  const session = getSession(bookId);
  if (!session) throw new Error("No editing session found");

  const buffer = await session.zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    // mimetype must be stored uncompressed as the first entry
    mimeType: "application/epub+zip",
  });

  session.isDirty = false;
  return buffer;
}

export async function getStructure(bookId: string): Promise<EpubStructure | null> {
  const session = getSession(bookId);
  if (!session) return null;

  return getStructureFromSession(session);
}

async function getStructureFromSession(session: EditingSession): Promise<EpubStructure> {
  const opfContent = await session.zip.file(session.opfPath)?.async("string");
  if (!opfContent) {
    throw new Error("Could not read OPF file from EPUB");
  }

  const { metadata, manifest, spine } = parseOpf(opfContent, session.opfDir);

  const manifestItems: ManifestItem[] = [];
  for (const [id, item] of manifest) {
    const absolutePath = item.href.startsWith("/")
      ? item.href.slice(1)
      : session.opfDir + item.href;
    const spineIndex = spine.indexOf(id);
    const isNav = item.properties?.includes("nav") || false;
    const isCover = item.properties?.includes("cover-image") || false;

    manifestItems.push({
      id,
      href: item.href,
      absolutePath,
      mediaType: item.mediaType,
      isSpineItem: spineIndex >= 0,
      spineIndex,
      isNavDoc: isNav,
      isCoverImage: isCover,
    });
  }

  // Find nav doc path
  const navItem = manifestItems.find((i) => i.isNavDoc);

  return {
    opfPath: session.opfPath,
    opfDir: session.opfDir,
    metadata,
    manifest: manifestItems,
    spine,
    navDocPath: navItem?.absolutePath || null,
  };
}

/**
 * Update the spine order in the OPF.
 * Rewrites the <spine> block in content.opf with the new order.
 */
export async function updateSpine(bookId: string, newSpine: string[]): Promise<void> {
  const session = getSession(bookId);
  if (!session) throw new Error("No editing session found");

  const opfContent = await session.zip.file(session.opfPath)?.async("string");
  if (!opfContent) throw new Error("Could not read OPF file");

  // Build new spine block
  const spineItems = newSpine.map((idref) => `    <itemref idref="${idref}"/>`).join("\n");
  const tocAttr = opfContent.match(/<spine\s+[^>]*toc="([^"]+)"/)?.[1];
  const spineOpenTag = tocAttr ? `<spine toc="${tocAttr}">` : "<spine>";
  const newSpineBlock = `${spineOpenTag}\n${spineItems}\n  </spine>`;

  // Replace the existing spine block
  const updatedOpf = opfContent.replace(/<spine[^>]*>[\s\S]*?<\/spine>/i, newSpineBlock);

  session.zip.file(session.opfPath, updatedOpf);
  session.isDirty = true;
}

/**
 * Add a new file to the EPUB and register it in the manifest.
 */
export async function addFile(
  bookId: string,
  path: string,
  content: string,
  mediaType: string,
  addToSpine: boolean = false,
): Promise<void> {
  const session = getSession(bookId);
  if (!session) throw new Error("No editing session found");

  // Add file to ZIP
  session.zip.file(path, content);

  // Generate a manifest ID from the filename
  const filename = path.split("/").pop() || path;
  const id = filename.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "-");

  // Add to manifest in OPF
  const opfContent = await session.zip.file(session.opfPath)?.async("string");
  if (!opfContent) throw new Error("Could not read OPF file");

  const href = path.startsWith(session.opfDir) ? path.slice(session.opfDir.length) : path;

  const manifestEntry = `    <item id="${id}" href="${href}" media-type="${mediaType}"/>`;
  let updatedOpf = opfContent.replace(/<\/manifest>/i, `${manifestEntry}\n  </manifest>`);

  // Optionally add to spine
  if (addToSpine) {
    const spineEntry = `    <itemref idref="${id}"/>`;
    updatedOpf = updatedOpf.replace(/<\/spine>/i, `${spineEntry}\n  </spine>`);
  }

  session.zip.file(session.opfPath, updatedOpf);
  session.isDirty = true;
}

/**
 * Remove a file from the EPUB and unregister it from manifest and spine.
 */
export async function removeFile(bookId: string, path: string): Promise<void> {
  const session = getSession(bookId);
  if (!session) throw new Error("No editing session found");

  // Remove file from ZIP
  session.zip.remove(path);

  // Remove from manifest in OPF
  const opfContent = await session.zip.file(session.opfPath)?.async("string");
  if (!opfContent) throw new Error("Could not read OPF file");

  // Find the manifest item by href
  const href = path.startsWith(session.opfDir) ? path.slice(session.opfDir.length) : path;

  // Find the item ID for this href
  const itemMatch = opfContent.match(
    new RegExp(`<item\\s+[^>]*href=["']${escapeRegex(href)}["'][^>]*/?>`, "i"),
  );
  let itemId: string | null = null;
  if (itemMatch) {
    const idMatch = itemMatch[0].match(/id\s*=\s*["']([^"']+)["']/i);
    if (idMatch) itemId = idMatch[1];
  }

  // Remove the manifest entry
  let updatedOpf = opfContent.replace(
    new RegExp(`\\s*<item\\s+[^>]*href=["']${escapeRegex(href)}["'][^>]*/?>`, "gi"),
    "",
  );

  // Remove from spine if present
  if (itemId) {
    updatedOpf = updatedOpf.replace(
      new RegExp(`\\s*<itemref\\s+[^>]*idref=["']${escapeRegex(itemId)}["'][^>]*/?>`, "gi"),
      "",
    );
  }

  session.zip.file(session.opfPath, updatedOpf);
  session.isDirty = true;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
