import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import JSZip from "jszip";
import sharp from "sharp";
import type { OPS as OPSType } from "pdfjs-dist";

// pdfjs-dist OPS enum for operator list processing
const OPS: typeof OPSType = (pdfjsLib as unknown as { OPS: typeof OPSType }).OPS;

interface ConvertOptions {
  onProgress?: (percent: number, message: string) => void;
}

interface TextItem {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontName: string;
  width: number;
  height: number;
  bold: boolean;
  italic: boolean;
}

interface PageData {
  pageNum: number;
  textItems: TextItem[];
  images: { id: string; data: Buffer; mimeType: string }[];
  width: number;
  height: number;
}

interface Chapter {
  title: string;
  pages: PageData[];
}

/**
 * Convert a PDF buffer to an EPUB buffer using pure Node.js
 * Extracts text with positioning and embedded images via pdfjs-dist,
 * then assembles an EPUB using JSZip.
 */
export async function convertPdfToEpub(
  pdfBuffer: Buffer,
  metadata: { title?: string; authors?: string[]; language?: string },
  options?: ConvertOptions,
): Promise<Buffer> {
  const progress = options?.onProgress ?? (() => {});

  progress(2, "Loading PDF...");

  // Copy into a fresh Uint8Array (pdfjs may detach the underlying ArrayBuffer)
  const data = new Uint8Array(pdfBuffer.byteLength);
  data.set(pdfBuffer);

  const loadingTask = pdfjsLib.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
  });

  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;

  progress(5, `PDF loaded: ${numPages} pages`);

  // Extract content from all pages
  const pages: PageData[] = [];
  for (let i = 1; i <= numPages; i++) {
    const pct = 5 + Math.round((i / numPages) * 60);
    progress(pct, `Extracting page ${i}/${numPages}...`);

    const pageData = await extractPageContent(pdfDoc, i);
    pages.push(pageData);
  }

  progress(68, "Detecting chapters...");

  // Group pages into chapters
  const chapters = detectChapters(pages, metadata.title ?? "Untitled");

  progress(72, "Generating EPUB...");

  // Assemble EPUB
  const epubBuffer = await assembleEpub(chapters, metadata, progress);

  // Clean up
  await pdfDoc.destroy();

  progress(100, "Conversion complete");

  return epubBuffer;
}

/**
 * Extract text and images from a single PDF page
 */
async function extractPageContent(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNum: number,
): Promise<PageData> {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1.0 });

  // Extract text content
  const textContent = await page.getTextContent();
  const textItems: TextItem[] = [];

  for (const item of textContent.items) {
    if ("str" in item && item.str.trim()) {
      const tx = item.transform;
      textItems.push({
        text: item.str,
        x: tx[4],
        y: viewport.height - tx[5], // Flip Y axis (PDF is bottom-up)
        fontSize: Math.abs(tx[0]) || 12,
        fontName: item.fontName || "",
        width: item.width || 0,
        height: item.height || Math.abs(tx[0]) || 12,
        bold: /bold/i.test(item.fontName || ""),
        italic: /italic|oblique/i.test(item.fontName || ""),
      });
    }
  }

  // Extract embedded images
  const images: { id: string; data: Buffer; mimeType: string }[] = [];
  try {
    const operatorList = await page.getOperatorList();
    const imgIds = new Set<string>();

    for (let i = 0; i < operatorList.fnArray.length; i++) {
      if (
        operatorList.fnArray[i] === OPS.paintImageXObject ||
        operatorList.fnArray[i] === OPS.paintJpegXObject
      ) {
        const imgName = operatorList.argsArray[i]?.[0] as string;
        if (imgName && !imgIds.has(imgName)) {
          imgIds.add(imgName);
          try {
            const imgData = await new Promise<{
              data: Uint8Array;
              width: number;
              height: number;
              kind: number;
            }>((resolve, reject) => {
              page.objs.get(imgName, (obj: unknown) => {
                if (obj && typeof obj === "object" && "data" in obj) {
                  resolve(
                    obj as { data: Uint8Array; width: number; height: number; kind: number },
                  );
                } else {
                  reject(new Error("No image data"));
                }
              });
              // Timeout after 2 seconds
              setTimeout(() => reject(new Error("Timeout")), 2000);
            });

            // pdfjs ImageKind: 1 = GRAYSCALE_1BPP, 2 = RGB_24BPP, 3 = RGBA_32BPP
            const channels = imgData.kind === 3 ? 4 : imgData.kind === 1 ? 1 : 3;

            // Convert raw pixel data to actual PNG using sharp
            const pngBuffer = await sharp(Buffer.from(imgData.data), {
              raw: {
                width: imgData.width,
                height: imgData.height,
                channels,
              },
            })
              .png()
              .toBuffer();

            images.push({
              id: `page${pageNum}_${imgName}`,
              data: pngBuffer,
              mimeType: "image/png",
            });
          } catch {
            // Skip images that can't be extracted
          }
        }
      }
    }
  } catch {
    // Operator list extraction may fail for some PDFs
  }

  page.cleanup();

  return {
    pageNum,
    textItems,
    images,
    width: viewport.width,
    height: viewport.height,
  };
}

/**
 * Detect chapter boundaries using heuristics:
 * - Large text at the top of a page
 * - Significant font size difference from body text
 */
function detectChapters(pages: PageData[], bookTitle: string): Chapter[] {
  if (pages.length === 0) {
    return [{ title: bookTitle, pages: [] }];
  }

  // Calculate median font size as "body" text size
  const allFontSizes = pages.flatMap((p) => p.textItems.map((t) => t.fontSize));
  if (allFontSizes.length === 0) {
    return [{ title: bookTitle, pages }];
  }

  allFontSizes.sort((a, b) => a - b);
  const medianFontSize = allFontSizes[Math.floor(allFontSizes.length / 2)];
  const chapterThreshold = medianFontSize * 1.4; // 40% larger than body text

  const chapters: Chapter[] = [];
  let currentChapter: Chapter = { title: bookTitle, pages: [] };

  for (const page of pages) {
    // Check if this page starts a new chapter
    const topItems = page.textItems
      .filter((t) => t.y < page.height * 0.3) // Top 30% of page
      .sort((a, b) => a.y - b.y);

    const chapterHeading = topItems.find(
      (t) =>
        t.fontSize >= chapterThreshold &&
        t.text.length > 1 &&
        t.text.length < 100 &&
        // Not just a page number
        !/^\d+$/.test(t.text.trim()),
    );

    if (chapterHeading && currentChapter.pages.length > 0) {
      // Start a new chapter
      chapters.push(currentChapter);
      currentChapter = {
        title: chapterHeading.text.trim(),
        pages: [page],
      };
    } else {
      currentChapter.pages.push(page);
    }
  }

  // Push the last chapter
  if (currentChapter.pages.length > 0) {
    chapters.push(currentChapter);
  }

  return chapters;
}

/**
 * Convert page text items into structured HTML paragraphs
 */
function pageToHtml(page: PageData): string {
  if (page.textItems.length === 0 && page.images.length === 0) {
    return "";
  }

  // Add images for this page
  const imageHtml = page.images
    .map((img) => `    <p><img src="images/${img.id}.png" alt=""/></p>`)
    .join("\n");

  if (page.textItems.length === 0) {
    return imageHtml;
  }

  // Sort by y position (top to bottom), then x (left to right)
  const sorted = [...page.textItems].sort((a, b) => {
    const yDiff = a.y - b.y;
    if (Math.abs(yDiff) < a.height * 0.3) {
      return a.x - b.x; // Same line
    }
    return yDiff;
  });

  // Group into lines based on y position
  const lines: TextItem[][] = [];
  let currentLine: TextItem[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    const prevItem = currentLine[currentLine.length - 1];

    // Same line if y positions are close
    if (Math.abs(item.y - prevItem.y) < prevItem.height * 0.5) {
      currentLine.push(item);
    } else {
      lines.push(currentLine);
      currentLine = [item];
    }
  }
  lines.push(currentLine);

  // Group lines into paragraphs based on spacing
  const paragraphs: string[] = [];
  let currentParagraph: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineText = line.map((t) => {
      let text = escapeHtml(t.text);
      if (t.bold) text = `<strong>${text}</strong>`;
      if (t.italic) text = `<em>${text}</em>`;
      return text;
    }).join(" ");

    if (i > 0) {
      const prevLine = lines[i - 1];
      const gap = line[0].y - (prevLine[0].y + prevLine[0].height);

      // Large gap or significant font size change = new paragraph
      if (gap > prevLine[0].height * 0.8 || Math.abs(line[0].fontSize - prevLine[0].fontSize) > 2) {
        if (currentParagraph.length > 0) {
          paragraphs.push(currentParagraph.join(" "));
          currentParagraph = [];
        }
      }
    }

    currentParagraph.push(lineText);
  }

  if (currentParagraph.length > 0) {
    paragraphs.push(currentParagraph.join(" "));
  }

  const textHtml = paragraphs.map((p) => `    <p>${p}</p>`).join("\n");
  return imageHtml ? `${imageHtml}\n${textHtml}` : textHtml;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Assemble chapters into a valid EPUB 3 file
 */
async function assembleEpub(
  chapters: Chapter[],
  metadata: { title?: string; authors?: string[]; language?: string },
  progress: (pct: number, msg: string) => void,
): Promise<Buffer> {
  const zip = new JSZip();
  const title = metadata.title ?? "Untitled";
  const authors = metadata.authors ?? ["Unknown"];
  const language = metadata.language ?? "en";
  const bookId = `pdf-epub-${Date.now()}`;

  // 1. mimetype (must be first, uncompressed)
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  // 2. META-INF/container.xml
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );

  // 3. Generate chapter XHTML files and collect images
  const chapterFiles: { id: string; href: string; title: string }[] = [];
  const imageEntries: { id: string; href: string; mimeType: string }[] = [];

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    const chapterId = `chapter-${i + 1}`;
    const chapterHref = `${chapterId}.xhtml`;

    progress(72 + Math.round((i / chapters.length) * 20), `Writing chapter ${i + 1}/${chapters.length}...`);

    // Add images from all pages in this chapter to the ZIP
    for (const page of chapter.pages) {
      for (const img of page.images) {
        const imgHref = `images/${img.id}.png`;
        zip.file(`OEBPS/${imgHref}`, img.data);
        imageEntries.push({ id: img.id, href: imgHref, mimeType: img.mimeType });
      }
    }

    // Generate chapter content
    const bodyContent = chapter.pages.map((page) => pageToHtml(page)).filter(Boolean).join("\n\n    <hr/>\n\n");

    const chapterXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${language}">
<head>
  <title>${escapeHtml(chapter.title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <section>
    <h2>${escapeHtml(chapter.title)}</h2>
${bodyContent}
  </section>
</body>
</html>`;

    zip.file(`OEBPS/${chapterHref}`, chapterXhtml);
    chapterFiles.push({ id: chapterId, href: chapterHref, title: chapter.title });
  }

  // 4. CSS stylesheet
  zip.file(
    "OEBPS/styles.css",
    `body {
  font-family: serif;
  line-height: 1.6;
  margin: 1em;
  color: #333;
}
h1, h2, h3 {
  line-height: 1.3;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}
p {
  margin: 0.5em 0;
  text-align: justify;
}
hr {
  border: none;
  border-top: 1px solid #ccc;
  margin: 2em 0;
}
img {
  max-width: 100%;
  height: auto;
}
`,
  );

  // 5. content.opf (package document)
  const manifestItems = [
    `    <item id="styles" href="styles.css" media-type="text/css"/>`,
    `    <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    ...chapterFiles.map(
      (ch) => `    <item id="${ch.id}" href="${ch.href}" media-type="application/xhtml+xml"/>`,
    ),
    ...imageEntries.map(
      (img) => `    <item id="${img.id}" href="${img.href}" media-type="${img.mimeType}"/>`,
    ),
  ].join("\n");

  const spineItems = chapterFiles
    .map((ch) => `    <itemref idref="${ch.id}"/>`)
    .join("\n");

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${bookId}</dc:identifier>
    <dc:title>${escapeHtml(title)}</dc:title>
${authors.map((a) => `    <dc:creator>${escapeHtml(a)}</dc:creator>`).join("\n")}
    <dc:language>${language}</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}</meta>
  </metadata>
  <manifest>
${manifestItems}
  </manifest>
  <spine>
${spineItems}
  </spine>
</package>`,
  );

  // 6. Navigation document (EPUB 3 nav)
  const tocItems = chapterFiles
    .map((ch) => `      <li><a href="${ch.href}">${escapeHtml(ch.title)}</a></li>`)
    .join("\n");

  zip.file(
    "OEBPS/toc.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${language}">
<head>
  <title>Table of Contents</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Table of Contents</h1>
    <ol>
${tocItems}
    </ol>
  </nav>
</body>
</html>`,
  );

  progress(95, "Compressing EPUB...");

  // Generate the ZIP buffer
  const epubBuffer = await zip.generateAsync({
    type: "nodebuffer",
    mimeType: "application/epub+zip",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return epubBuffer;
}
