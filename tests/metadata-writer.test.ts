import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeMetadataToFile } from "../app/lib/processing/metadata-writer";
import { extractEpubMetadata } from "../app/lib/processing/epub";
import { copyFileSync, unlinkSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");
const tempDir = join(__dirname, "temp");

// Ensure temp directory exists
if (!existsSync(tempDir)) {
  mkdirSync(tempDir, { recursive: true });
}

describe("metadata-writer", () => {
  describe("EPUB", () => {
    const sourceEpub = join(fixturesDir, "sample.epub");
    const tempEpub = join(tempDir, "test.epub");

    beforeEach(() => {
      copyFileSync(sourceEpub, tempEpub);
    });

    afterEach(() => {
      if (existsSync(tempEpub)) {
        unlinkSync(tempEpub);
      }
    });

    it("should update title and authors", async () => {
      const result = await writeMetadataToFile(tempEpub, "epub", {
        title: "New Title",
        authors: ["Author One", "Author Two"],
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe("epub");

      // Verify by re-reading
      const buffer = readFileSync(tempEpub);
      const metadata = await extractEpubMetadata(buffer);
      expect(metadata.title).toBe("New Title");
      expect(metadata.authors).toContain("Author One");
      expect(metadata.authors).toContain("Author Two");
    });

    it("should update publisher and description", async () => {
      const result = await writeMetadataToFile(tempEpub, "epub", {
        title: "Test Book",
        authors: ["Test Author"],
        publisher: "Test Publisher Inc.",
        description: "A fascinating book about testing.",
      });

      expect(result.success).toBe(true);

      // Verify OPF contains the new values
      const buffer = readFileSync(tempEpub);
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(buffer);
      const opf = await zip.file("OEBPS/content.opf")?.async("string");

      expect(opf).toContain("Test Publisher Inc.");
      expect(opf).toContain("A fascinating book about testing.");
    });

    it("should add series metadata", async () => {
      const result = await writeMetadataToFile(tempEpub, "epub", {
        title: "Book Title",
        authors: ["Author"],
        series: "My Amazing Series",
        seriesNumber: "3",
      });

      expect(result.success).toBe(true);

      // Verify calibre:series meta tag was added
      const buffer = readFileSync(tempEpub);
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(buffer);
      const opf = await zip.file("OEBPS/content.opf")?.async("string");

      expect(opf).toContain('name="calibre:series"');
      expect(opf).toContain('content="My Amazing Series"');
      expect(opf).toContain('name="calibre:series_index"');
      expect(opf).toContain('content="3"');
    });

    it("should add ISBN identifier", async () => {
      const result = await writeMetadataToFile(tempEpub, "epub", {
        title: "ISBN Book",
        authors: ["Author"],
        isbn: "9781234567890",
      });

      expect(result.success).toBe(true);

      const buffer = readFileSync(tempEpub);
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(buffer);
      const opf = await zip.file("OEBPS/content.opf")?.async("string");

      expect(opf).toContain('scheme="ISBN"');
      expect(opf).toContain("9781234567890");
    });

    it("should escape XML special characters", async () => {
      const result = await writeMetadataToFile(tempEpub, "epub", {
        title: 'Book with <special> & "characters"',
        authors: ["Author's Name"],
      });

      expect(result.success).toBe(true);

      const buffer = readFileSync(tempEpub);
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(buffer);
      const opf = await zip.file("OEBPS/content.opf")?.async("string");

      // Should be properly escaped
      expect(opf).toContain("&lt;special&gt;");
      expect(opf).toContain("&amp;");
      expect(opf).toContain("&quot;characters&quot;");
      expect(opf).toContain("Author&apos;s Name");
    });

    it("should handle invalid EPUB gracefully", async () => {
      // Create a non-EPUB file
      const invalidPath = join(tempDir, "invalid.epub");
      require("fs").writeFileSync(invalidPath, "not a zip file");

      const result = await writeMetadataToFile(invalidPath, "epub", {
        title: "Test",
        authors: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      unlinkSync(invalidPath);
    });
  });

  describe("PDF", () => {
    const sourcePdf = join(fixturesDir, "sample.pdf");
    const tempPdf = join(tempDir, "test.pdf");

    beforeEach(() => {
      copyFileSync(sourcePdf, tempPdf);
    });

    afterEach(() => {
      if (existsSync(tempPdf)) {
        unlinkSync(tempPdf);
      }
    });

    it("should update title and author", async () => {
      const result = await writeMetadataToFile(tempPdf, "pdf", {
        title: "Updated PDF Title",
        authors: ["PDF Author One", "PDF Author Two"],
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe("pdf");

      // Verify by re-reading using pdf-lib
      const { PDFDocument } = await import("pdf-lib");
      const buffer = readFileSync(tempPdf);
      const pdfDoc = await PDFDocument.load(buffer);

      expect(pdfDoc.getTitle()).toBe("Updated PDF Title");
      expect(pdfDoc.getAuthor()).toBe("PDF Author One, PDF Author Two");
    });

    it("should add publisher to keywords", async () => {
      const result = await writeMetadataToFile(tempPdf, "pdf", {
        title: "Test PDF",
        authors: ["Author"],
        publisher: "Test Publishing House",
      });

      expect(result.success).toBe(true);

      const { PDFDocument } = await import("pdf-lib");
      const buffer = readFileSync(tempPdf);
      const pdfDoc = await PDFDocument.load(buffer);

      const keywords = pdfDoc.getKeywords();
      expect(keywords).toContain("Publisher: Test Publishing House");
    });

    it("should update description as subject", async () => {
      const result = await writeMetadataToFile(tempPdf, "pdf", {
        title: "Test PDF",
        authors: ["Author"],
        description: "This is a test PDF document about testing.",
      });

      expect(result.success).toBe(true);

      const { PDFDocument } = await import("pdf-lib");
      const buffer = readFileSync(tempPdf);
      const pdfDoc = await PDFDocument.load(buffer);

      expect(pdfDoc.getSubject()).toBe("This is a test PDF document about testing.");
    });

    it("should add keywords for ISBN and series", async () => {
      const result = await writeMetadataToFile(tempPdf, "pdf", {
        title: "Test PDF",
        authors: ["Author"],
        isbn: "9781234567890",
        series: "Test Series",
        seriesNumber: "5",
        language: "en",
      });

      expect(result.success).toBe(true);

      const { PDFDocument } = await import("pdf-lib");
      const buffer = readFileSync(tempPdf);
      const pdfDoc = await PDFDocument.load(buffer);

      const keywords = pdfDoc.getKeywords();
      expect(keywords).toContain("ISBN: 9781234567890");
      expect(keywords).toContain("Series: Test Series");
      expect(keywords).toContain("Book 5");
      expect(keywords).toContain("Language: en");
    });

    it("should set creator to Compendus", async () => {
      const result = await writeMetadataToFile(tempPdf, "pdf", {
        title: "Test PDF",
        authors: [],
      });

      expect(result.success).toBe(true);

      const { PDFDocument } = await import("pdf-lib");
      const buffer = readFileSync(tempPdf);
      const pdfDoc = await PDFDocument.load(buffer);

      expect(pdfDoc.getCreator()).toBe("Compendus");
    });
  });

  describe("MP3", () => {
    const sourceMp3 = join(fixturesDir, "sample.mp3");
    const tempMp3 = join(tempDir, "test.mp3");

    beforeEach(() => {
      copyFileSync(sourceMp3, tempMp3);
    });

    afterEach(() => {
      if (existsSync(tempMp3)) {
        unlinkSync(tempMp3);
      }
    });

    it("should update title and artist", async () => {
      const result = await writeMetadataToFile(tempMp3, "mp3", {
        title: "Updated MP3 Title",
        authors: ["Artist One", "Artist Two"],
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe("mp3");

      // Verify by re-reading using node-id3
      const NodeID3 = await import("node-id3");
      const tags = NodeID3.read(tempMp3);

      expect(tags.title).toBe("Updated MP3 Title");
      expect(tags.artist).toBe("Artist One, Artist Two");
    });

    it("should update publisher", async () => {
      const result = await writeMetadataToFile(tempMp3, "mp3", {
        title: "Test MP3",
        authors: ["Artist"],
        publisher: "Test Records",
      });

      expect(result.success).toBe(true);

      const NodeID3 = await import("node-id3");
      const tags = NodeID3.read(tempMp3);

      expect(tags.publisher).toBe("Test Records");
    });

    it("should add series as content group", async () => {
      const result = await writeMetadataToFile(tempMp3, "mp3", {
        title: "Audiobook Chapter",
        authors: ["Narrator"],
        series: "My Audiobook Series",
        seriesNumber: "5",
      });

      expect(result.success).toBe(true);

      const NodeID3 = await import("node-id3");
      const tags = NodeID3.read(tempMp3);

      expect(tags.contentGroup).toBe("My Audiobook Series");
      expect(tags.trackNumber).toBe("5");
    });

    it("should extract year from publishedDate", async () => {
      const result = await writeMetadataToFile(tempMp3, "mp3", {
        title: "Test MP3",
        authors: [],
        publishedDate: "2023-06-15",
      });

      expect(result.success).toBe(true);

      const NodeID3 = await import("node-id3");
      const tags = NodeID3.read(tempMp3);

      expect(tags.year).toBe("2023");
    });
  });

  describe("M4B/M4A", () => {
    it("should fail gracefully for non-existent files", async () => {
      // M4B/M4A writing requires ffmpeg and a real file
      // With a non-existent file, it should fail gracefully
      const result = await writeMetadataToFile("/fake/path.m4b", "m4b", {
        title: "Title",
        authors: [],
      });

      // Should fail (file doesn't exist) or skip if ffmpeg unavailable
      // Either way, we get an error message
      expect(result.error).toBeDefined();
    });
  });

  describe("unsupported formats", () => {
    it("should return success with skip message for MOBI", async () => {
      const result = await writeMetadataToFile("/fake/path.mobi", "mobi", {
        title: "Title",
        authors: [],
      });

      expect(result.success).toBe(true);
      expect(result.error).toContain("does not support");
      expect(result.format).toBe("mobi");
    });

    it("should return success with skip message for AZW3", async () => {
      const result = await writeMetadataToFile("/fake/path.azw3", "azw3", {
        title: "Title",
        authors: [],
      });

      expect(result.success).toBe(true);
      expect(result.error).toContain("does not support");
    });

    it("should return success with skip message for comic formats", async () => {
      const cbzResult = await writeMetadataToFile("/fake/path.cbz", "cbz", {
        title: "Title",
        authors: [],
      });
      expect(cbzResult.success).toBe(true);
      expect(cbzResult.error).toContain("does not support");
    });
  });
});
