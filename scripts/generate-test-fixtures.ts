/**
 * Generate test fixtures for metadata-writer tests.
 * Creates minimal valid EPUB, PDF, and MP3 files with basic metadata.
 */

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import NodeID3 from "node-id3";

const fixturesDir = join(import.meta.dirname, "../tests/fixtures");

async function generateEpubFixture() {
  const zip = new JSZip();

  // mimetype file (must be first and uncompressed)
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  // container.xml
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );

  // content.opf (package document with metadata)
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="uid">urn:uuid:12345678-1234-1234-1234-123456789012</dc:identifier>
    <dc:title>Original Title</dc:title>
    <dc:creator>Original Author</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2024-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>`,
  );

  // Navigation document
  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Navigation</title></head>
<body>
  <nav epub:type="toc">
    <ol><li><a href="chapter1.xhtml">Chapter 1</a></li></ol>
  </nav>
</body>
</html>`,
  );

  // Chapter content
  zip.file(
    "OEBPS/chapter1.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 1</title></head>
<body>
  <h1>Chapter 1</h1>
  <p>This is a test EPUB file for metadata writing tests.</p>
</body>
</html>`,
  );

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    mimeType: "application/epub+zip",
  });

  writeFileSync(join(fixturesDir, "sample.epub"), buffer);
  console.log("Created sample.epub");
}

async function generatePdfFixture() {
  const pdfDoc = await PDFDocument.create();

  // Set some initial metadata
  pdfDoc.setTitle("Original PDF Title");
  pdfDoc.setAuthor("Original PDF Author");
  pdfDoc.setSubject("A test PDF document");
  pdfDoc.setCreator("Test Generator");

  // Add a blank page (PDF needs at least one page)
  pdfDoc.addPage([612, 792]); // Letter size

  const buffer = await pdfDoc.save();
  writeFileSync(join(fixturesDir, "sample.pdf"), Buffer.from(buffer));
  console.log("Created sample.pdf");
}

async function generateMp3Fixture() {
  // Create a minimal valid MP3 file
  // MP3 frame header: sync word (0xFFE0), no CRC, layer 3, version 1
  // This creates a silent 1-frame MP3 that's valid for ID3 tag testing

  // Minimal MP3 with a single silent frame
  // Frame header: 0xFF 0xFB (MPEG1 Layer3, no CRC)
  // Bitrate 128kbps, 44100Hz, stereo
  const frameHeader = Buffer.from([0xff, 0xfb, 0x90, 0x00]);

  // Minimal frame data (padding to make valid frame size for 128kbps @ 44100Hz = 417 bytes)
  const frameSize = 417;
  const frameData = Buffer.alloc(frameSize - frameHeader.length, 0);

  // Combine into minimal MP3
  const mp3Buffer = Buffer.concat([frameHeader, frameData]);

  const mp3Path = join(fixturesDir, "sample.mp3");
  writeFileSync(mp3Path, mp3Buffer);

  // Add ID3 tags using node-id3
  const tags: NodeID3.Tags = {
    title: "Original MP3 Title",
    artist: "Original MP3 Artist",
    album: "Original Album",
    year: "2024",
    publisher: "Original Publisher",
  };

  NodeID3.write(tags, mp3Path);
  console.log("Created sample.mp3");
}

// Ensure fixtures directory exists
mkdirSync(fixturesDir, { recursive: true });

// Generate all fixtures
await generateEpubFixture();
await generatePdfFixture();
await generateMp3Fixture();

console.log("Test fixtures generated successfully!");
