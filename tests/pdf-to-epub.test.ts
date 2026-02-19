import { describe, it, expect, afterAll } from "vitest";
import { convertPdfToEpub } from "../app/lib/processing/pdf-to-epub";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import JSZip from "jszip";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures", "pdfs");
const outputDir = join(__dirname, "output");

// Ensure output directory exists for manual inspection
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

// Load fixtures once
const simpleTextPdf = readFileSync(join(fixturesDir, "simple-text.pdf"));
const withImagesPdf = readFileSync(join(fixturesDir, "with-images.pdf"));
const multiChapterPdf = readFileSync(join(fixturesDir, "multi-chapter.pdf"));
const blankPdf = readFileSync(join(fixturesDir, "blank.pdf"));

// Collect generated EPUBs to write to output/ for manual inspection
const generatedEpubs: { name: string; buffer: Buffer }[] = [];

function saveForInspection(name: string, buffer: Buffer) {
  generatedEpubs.push({ name, buffer });
}

afterAll(() => {
  for (const { name, buffer } of generatedEpubs) {
    writeFileSync(join(outputDir, `${name}.epub`), buffer);
  }
});

async function parseEpub(buffer: Buffer) {
  return JSZip.loadAsync(buffer);
}

describe("convertPdfToEpub", () => {
  describe("EPUB structure", () => {
    it("should produce a valid EPUB ZIP with all required files", async () => {
      const epub = await convertPdfToEpub(simpleTextPdf, { title: "Test" });

      expect(Buffer.isBuffer(epub)).toBe(true);
      expect(epub.length).toBeGreaterThan(0);

      const zip = await parseEpub(epub);
      expect(zip.file("mimetype")).not.toBeNull();
      expect(zip.file("META-INF/container.xml")).not.toBeNull();
      expect(zip.file("OEBPS/content.opf")).not.toBeNull();
      expect(zip.file("OEBPS/toc.xhtml")).not.toBeNull();
      expect(zip.file("OEBPS/styles.css")).not.toBeNull();
    });

    it("should have uncompressed mimetype with correct value", async () => {
      const epub = await convertPdfToEpub(simpleTextPdf, { title: "Test" });
      const zip = await parseEpub(epub);

      const mimetype = await zip.file("mimetype")!.async("string");
      expect(mimetype).toBe("application/epub+zip");
    });

    it("should have container.xml pointing to content.opf", async () => {
      const epub = await convertPdfToEpub(simpleTextPdf, { title: "Test" });
      const zip = await parseEpub(epub);

      const container = await zip.file("META-INF/container.xml")!.async("string");
      expect(container).toContain('full-path="OEBPS/content.opf"');
      expect(container).toContain('media-type="application/oebps-package+xml"');
    });

    it("should generate at least one chapter XHTML file", async () => {
      const epub = await convertPdfToEpub(simpleTextPdf, { title: "Test" });
      const zip = await parseEpub(epub);

      const chapterFile = zip.file("OEBPS/chapter-1.xhtml");
      expect(chapterFile).not.toBeNull();
    });

    it("should produce valid XHTML in chapter files", async () => {
      const epub = await convertPdfToEpub(simpleTextPdf, { title: "Test" });
      const zip = await parseEpub(epub);

      const html = await zip.file("OEBPS/chapter-1.xhtml")!.async("string");
      expect(html).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(html).toContain('xmlns="http://www.w3.org/1999/xhtml"');
      expect(html).toContain("<body>");
      expect(html).toContain("</body>");
    });

    it("should list all chapters in both manifest and spine", async () => {
      const epub = await convertPdfToEpub(multiChapterPdf, { title: "Chapters" });
      const zip = await parseEpub(epub);

      const opf = await zip.file("OEBPS/content.opf")!.async("string");
      const chapterFiles = Object.keys(zip.files).filter(
        (f) => f.startsWith("OEBPS/chapter-") && f.endsWith(".xhtml"),
      );
      expect(chapterFiles.length).toBeGreaterThanOrEqual(1);

      for (const file of chapterFiles) {
        const id = file.replace("OEBPS/", "").replace(".xhtml", "");
        expect(opf).toContain(`id="${id}"`);
        expect(opf).toContain(`idref="${id}"`);
      }
    });

    it("should include CSS stylesheet in the manifest", async () => {
      const epub = await convertPdfToEpub(simpleTextPdf, { title: "CSS" });
      const zip = await parseEpub(epub);

      const opf = await zip.file("OEBPS/content.opf")!.async("string");
      expect(opf).toContain('id="styles"');
      expect(opf).toContain('href="styles.css"');
      expect(opf).toContain('media-type="text/css"');
    });
  });

  describe("metadata", () => {
    it("should embed provided title, authors, and language", async () => {
      const epub = await convertPdfToEpub(simpleTextPdf, {
        title: "My PDF Book",
        authors: ["Alice", "Bob"],
        language: "fr",
      });

      const zip = await parseEpub(epub);
      const opf = await zip.file("OEBPS/content.opf")!.async("string");

      expect(opf).toContain("<dc:title>My PDF Book</dc:title>");
      expect(opf).toContain("<dc:creator>Alice</dc:creator>");
      expect(opf).toContain("<dc:creator>Bob</dc:creator>");
      expect(opf).toContain("<dc:language>fr</dc:language>");
    });

    it("should use sensible defaults when metadata is empty", async () => {
      const epub = await convertPdfToEpub(simpleTextPdf, {});
      const zip = await parseEpub(epub);
      const opf = await zip.file("OEBPS/content.opf")!.async("string");

      expect(opf).toContain("<dc:title>Untitled</dc:title>");
      expect(opf).toContain("<dc:creator>Unknown</dc:creator>");
      expect(opf).toContain("<dc:language>en</dc:language>");
    });

    it("should escape special characters in metadata", async () => {
      const epub = await convertPdfToEpub(simpleTextPdf, {
        title: 'Book "Title" & <More>',
        authors: ["O'Brien & Sons"],
      });

      const zip = await parseEpub(epub);
      const opf = await zip.file("OEBPS/content.opf")!.async("string");

      expect(opf).toContain("&amp;");
      expect(opf).toContain("&lt;");
      expect(opf).toContain("&quot;");
      // Should NOT contain unescaped angle brackets from title
      expect(opf).not.toContain("<More>");
    });
  });

  describe("text extraction", () => {
    it("should extract text from the Yukon PDF (simple-text.pdf)", async () => {
      const epub = await convertPdfToEpub(simpleTextPdf, { title: "Yukon" });
      saveForInspection("simple-text", epub);
      const zip = await parseEpub(epub);

      const html = await zip.file("OEBPS/chapter-1.xhtml")!.async("string");
      expect(html).toContain("PDF Test File");
      expect(html).toContain("Yukon Department of Education");
    });

    it("should extract text from an image-heavy PDF (with-images.pdf)", async () => {
      const epub = await convertPdfToEpub(withImagesPdf, { title: "Samantha" });
      saveForInspection("with-images", epub);
      const zip = await parseEpub(epub);

      // Collect all chapter content
      const chapterFiles = Object.keys(zip.files).filter(
        (f) => f.startsWith("OEBPS/chapter-") && f.endsWith(".xhtml"),
      );
      const allContent = await Promise.all(
        chapterFiles.map((f) => zip.file(f)!.async("string")),
      );
      const combined = allContent.join("\n");

      // 15-page illustrated children's book — should extract story text
      expect(combined).toContain("Samantha");
      expect(combined).toContain("monkey");
    });

    it("should extract text from the multi-chapter PDF", async () => {
      const epub = await convertPdfToEpub(multiChapterPdf, { title: "Chapters" });
      saveForInspection("multi-chapter", epub);
      const zip = await parseEpub(epub);

      // Collect all chapter content
      const chapterFiles = Object.keys(zip.files).filter(
        (f) => f.startsWith("OEBPS/chapter-") && f.endsWith(".xhtml"),
      );
      const allContent = await Promise.all(
        chapterFiles.map((f) => zip.file(f)!.async("string")),
      );
      const combined = allContent.join("\n");

      expect(combined).toContain("The Beginning");
      expect(combined).toContain("The Journey");
      expect(combined).toContain("The Resolution");
    });
  });

  describe("chapter detection", () => {
    it("should detect multiple chapters from multi-chapter PDF", async () => {
      const epub = await convertPdfToEpub(multiChapterPdf, { title: "A Sample Book" });
      const zip = await parseEpub(epub);

      const chapterFiles = Object.keys(zip.files).filter(
        (f) => f.startsWith("OEBPS/chapter-") && f.endsWith(".xhtml"),
      );

      // The multi-chapter PDF has 3 chapter headings (plus a title page)
      // so we expect at least 2 chapter files
      expect(chapterFiles.length).toBeGreaterThanOrEqual(2);
    });

    it("should include chapter titles in the TOC", async () => {
      const epub = await convertPdfToEpub(multiChapterPdf, { title: "A Sample Book" });
      const zip = await parseEpub(epub);

      const toc = await zip.file("OEBPS/toc.xhtml")!.async("string");
      expect(toc).toContain('<nav epub:type="toc"');
      expect(toc).toContain("<ol>");
      expect(toc).toContain(".xhtml");
    });

    it("should produce a single chapter for a single-page PDF", async () => {
      const epub = await convertPdfToEpub(simpleTextPdf, { title: "Single Page" });
      const zip = await parseEpub(epub);

      const chapterFiles = Object.keys(zip.files).filter(
        (f) => f.startsWith("OEBPS/chapter-") && f.endsWith(".xhtml"),
      );
      expect(chapterFiles.length).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("should handle a blank PDF without crashing", async () => {
      const epub = await convertPdfToEpub(blankPdf, { title: "Blank" });

      expect(Buffer.isBuffer(epub)).toBe(true);

      const zip = await parseEpub(epub);
      expect(zip.file("OEBPS/content.opf")).not.toBeNull();
      expect(zip.file("OEBPS/chapter-1.xhtml")).not.toBeNull();
    });

    it("should handle a large image-heavy PDF without crashing", async () => {
      // 15-page illustrated book (2.5MB) — should complete without errors
      const epub = await convertPdfToEpub(withImagesPdf, { title: "Image Heavy" });

      expect(Buffer.isBuffer(epub)).toBe(true);

      const zip = await parseEpub(epub);
      // Should still produce valid EPUB structure
      expect(zip.file("OEBPS/content.opf")).not.toBeNull();

      const html = await zip.file("OEBPS/chapter-1.xhtml")!.async("string");
      expect(html).toContain("</body>");
      expect(html).toContain("</html>");
    });
  });

  describe("progress callback", () => {
    it("should call onProgress with increasing percentages", async () => {
      const calls: { percent: number; message: string }[] = [];

      await convertPdfToEpub(simpleTextPdf, { title: "Progress" }, {
        onProgress: (percent, message) => {
          calls.push({ percent, message });
        },
      });

      expect(calls.length).toBeGreaterThan(0);

      // Should start low and end at 100
      expect(calls[0].percent).toBeLessThan(50);
      expect(calls[calls.length - 1].percent).toBe(100);
      expect(calls[calls.length - 1].message).toBe("Conversion complete");

      // Percentages should be non-decreasing
      for (let i = 1; i < calls.length; i++) {
        expect(calls[i].percent).toBeGreaterThanOrEqual(calls[i - 1].percent);
      }
    });

    it("should work without onProgress (no callback)", async () => {
      // Should not throw when options are omitted
      const epub = await convertPdfToEpub(simpleTextPdf, { title: "No Progress" });
      expect(Buffer.isBuffer(epub)).toBe(true);
    });
  });
});
