import { Hono } from "hono";
import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { processBook } from "../../app/lib/processing";
import { db, books } from "../../app/lib/db";
import Busboy from "busboy";
import { createWriteStream, readFileSync, unlinkSync, mkdtempSync, rmdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Readable } from "stream";

interface ParsedFile {
  fieldName: string;
  fileName: string;
  tempPath: string;
}

interface ParsedMultipart {
  files: ParsedFile[];
  fields: Record<string, string>;
  cleanup: () => void;
}

/**
 * Stream multipart form data to temp files on disk instead of buffering in memory.
 * This prevents OOM crashes for large uploads (1GB+ audiobooks).
 */
function parseMultipartToDisk(c: Context): Promise<ParsedMultipart> {
  return new Promise((resolve, reject) => {
    const contentType = c.req.header("content-type");
    if (!contentType) {
      resolve({ files: [], fields: {}, cleanup: () => {} });
      return;
    }

    const busboy = Busboy({
      headers: { "content-type": contentType },
    });

    const tmpDir = mkdtempSync(join(tmpdir(), "compendus-upload-"));
    const files: ParsedFile[] = [];
    const fields: Record<string, string> = {};
    const writePromises: Promise<void>[] = [];

    busboy.on("file", (fieldName, stream, info) => {
      const tempPath = join(tmpDir, `${fieldName}-${Date.now()}`);
      files.push({ fieldName, fileName: info.filename, tempPath });

      const writePromise = new Promise<void>((res, rej) => {
        const ws = createWriteStream(tempPath);
        stream.pipe(ws);
        ws.on("finish", res);
        ws.on("error", rej);
      });
      writePromises.push(writePromise);
    });

    busboy.on("field", (name, value) => {
      fields[name] = value;
    });

    busboy.on("finish", async () => {
      try {
        await Promise.all(writePromises);
        resolve({
          files,
          fields,
          cleanup: () => {
            for (const f of files) {
              try { unlinkSync(f.tempPath); } catch {}
            }
            try { rmdirSync(tmpDir); } catch {}
          },
        });
      } catch (err) {
        reject(err);
      }
    });

    busboy.on("error", reject);

    const body = c.req.raw.body;
    if (!body) {
      resolve({ files: [], fields: {}, cleanup: () => {} });
      return;
    }

    Readable.fromWeb(body as any).pipe(busboy);
  });
}

const app = new Hono();

// POST /api/upload - upload a book file
app.post("/api/upload", async (c) => {
  const parsed = await parseMultipartToDisk(c);
  try {
    const fileEntry = parsed.files.find((f) => f.fieldName === "file");

    if (!fileEntry) {
      return c.json({ success: false, error: "no_file" }, 400);
    }

    // Validate file type
    const validExtensions = [
      ".pdf",
      ".epub",
      ".mobi",
      ".azw",
      ".azw3",
      ".cbr",
      ".cbz",
      ".m4b",
      ".m4a",
      ".mp3",
    ];
    const hasValidExtension = validExtensions.some((ext) =>
      fileEntry.fileName.toLowerCase().endsWith(ext),
    );

    if (!hasValidExtension) {
      return c.json({ success: false, error: "invalid_format" }, 400);
    }

    // Extract optional metadata overrides from form fields
    const metadata: Record<string, unknown> = {};
    const metadataFields = [
      "title",
      "isbn",
      "isbn13",
      "isbn10",
      "publisher",
      "publishedDate",
      "description",
      "language",
    ];
    for (const field of metadataFields) {
      const value = parsed.fields[field];
      if (value) {
        metadata[field] = value;
      }
    }
    // Handle authors as JSON array
    const authorsStr = parsed.fields["authors"];
    if (authorsStr) {
      try {
        metadata.authors = JSON.parse(authorsStr);
      } catch {
        metadata.authors = [authorsStr];
      }
    }
    // Handle pageCount as number
    const pageCountStr = parsed.fields["pageCount"];
    if (pageCountStr) {
      metadata.pageCount = parseInt(pageCountStr, 10);
    }

    // Read the file from disk (single buffer instead of 3x copies from formData)
    const buffer = readFileSync(fileEntry.tempPath);

    // Process the book with metadata overrides
    const result = await processBook(buffer, fileEntry.fileName, {
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });

    if (result.success && result.bookId) {
      const book = await db.select().from(books).where(eq(books.id, result.bookId)).get();
      if (book) {
        return c.json({
          success: true,
          book: {
            id: book.id,
            title: book.title,
            format: book.format,
          },
        });
      }
    }

    return c.json(result, result.success ? 200 : 400);
  } catch (error) {
    console.error("Upload error:", error);
    return c.json({ success: false, error: "upload_failed" }, 500);
  } finally {
    parsed.cleanup();
  }
});

// POST /api/upload-multifile - upload multiple audio files as a single audiobook
app.post("/api/upload-multifile", async (c) => {
  const parsed = await parseMultipartToDisk(c);
  try {
    const { processMultiFileAudiobookWithProgress } = await import("../../app/lib/processing");
    const { isFFmpegAvailable } = await import("../../app/lib/processing/audio");

    // Check if ffmpeg is available first
    if (!(await isFFmpegAvailable())) {
      return c.json({ success: false, error: "ffmpeg_not_installed" }, 400);
    }

    const folderName = parsed.fields["folderName"];

    if (!folderName) {
      return c.json({ success: false, error: "no_folder_name" }, 400);
    }

    // Read files from disk
    const files: Array<{ buffer: Buffer; fileName: string }> = [];
    const validExtensions = [".mp3", ".m4a", ".m4b"];

    for (const fileEntry of parsed.files) {
      if (fileEntry.fieldName.startsWith("file_")) {
        const hasValidExtension = validExtensions.some((ext) =>
          fileEntry.fileName.toLowerCase().endsWith(ext),
        );
        if (hasValidExtension) {
          files.push({
            buffer: readFileSync(fileEntry.tempPath),
            fileName: fileEntry.fileName,
          });
        }
      }
    }

    // Clean up temp files now that we've read them into buffers
    parsed.cleanup();

    if (files.length < 2) {
      return c.json({ success: false, error: "need_multiple_files" }, 400);
    }

    // Create job ID immediately so we can return it to the client
    const { createJob } = await import("../../app/lib/queue");
    const jobId = `merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createJob(jobId);

    // Start processing in the background (don't await)
    processMultiFileAudiobookWithProgress(files, folderName, {}, jobId)
      .catch((error) => {
        console.error("Background merge error:", error);
      });

    // Return immediately with jobId so client can subscribe to SSE
    return c.json({
      success: true,
      jobId,
      pending: true,
    });
  } catch (error) {
    console.error("Multi-file upload error:", error);
    return c.json({ success: false, error: "upload_failed" }, 500);
  } finally {
    parsed.cleanup();
  }
});

export { app as uploadRoutes };
