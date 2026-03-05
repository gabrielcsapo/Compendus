import { Suspense } from "react";
import { readdirSync, statSync } from "fs";
import { resolve } from "path";
import { desc } from "drizzle-orm";
import { db } from "../lib/db";
import { books, backgroundJobs } from "../lib/db/schema";
import { BOOKS_DIR } from "../lib/storage";
import { AdminDataClient } from "../components/AdminDataClient";

interface FileInfo {
  name: string;
  size: number;
  path: string;
  bookId: string | null;
}

interface BookRecord {
  id: string;
  title: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  format: string;
}

export default function AdminData() {
  return (
    <Suspense fallback={<AdminDataSkeleton />}>
      <AdminDataContent />
    </Suspense>
  );
}

async function AdminDataContent() {
  // Get all files from data/books directory
  const files: FileInfo[] = [];
  try {
    const fileNames = readdirSync(BOOKS_DIR);
    for (const name of fileNames) {
      const filePath = resolve(BOOKS_DIR, name);
      try {
        const stat = statSync(filePath);
        if (stat.isFile()) {
          // Extract bookId from filename (e.g., "uuid.epub" -> "uuid")
          const bookId = name.replace(/\.[^.]+$/, "");
          files.push({
            name,
            size: stat.size,
            path: filePath,
            bookId,
          });
        }
      } catch {
        // Skip files we can't stat
      }
    }
  } catch {
    // Directory might not exist
  }

  // Get all books from database
  const allBooks = await db
    .select({
      id: books.id,
      title: books.title,
      fileName: books.fileName,
      filePath: books.filePath,
      fileSize: books.fileSize,
      format: books.format,
    })
    .from(books);

  // Create lookup maps
  const bookById = new Map<string, BookRecord>();
  for (const book of allBooks) {
    bookById.set(book.id, book as BookRecord);
  }

  const fileByBookId = new Map<string, FileInfo>();
  for (const file of files) {
    if (file.bookId) {
      fileByBookId.set(file.bookId, file);
    }
  }

  // Categorize files
  const orphanedFiles: FileInfo[] = []; // Files without database entry
  const matchedFiles: (FileInfo & { book: BookRecord })[] = []; // Files with database entry
  const missingFiles: BookRecord[] = []; // Database entries without files

  for (const file of files) {
    const book = file.bookId ? bookById.get(file.bookId) : null;
    if (book) {
      matchedFiles.push({ ...file, book });
    } else {
      orphanedFiles.push(file);
    }
  }

  for (const book of allBooks) {
    if (!fileByBookId.has(book.id)) {
      missingFiles.push(book as BookRecord);
    }
  }

  // Sort by name
  orphanedFiles.sort((a, b) => a.name.localeCompare(b.name));
  matchedFiles.sort((a, b) => a.name.localeCompare(b.name));
  missingFiles.sort((a, b) => a.title.localeCompare(b.title));

  // Calculate total sizes
  const orphanedSize = orphanedFiles.reduce((sum, f) => sum + f.size, 0);
  const matchedSize = matchedFiles.reduce((sum, f) => sum + f.size, 0);

  // Get background jobs (most recent first, limit 100)
  const jobs = db
    .select()
    .from(backgroundJobs)
    .orderBy(desc(backgroundJobs.updatedAt))
    .limit(100)
    .all()
    .map((job) => ({
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress ?? 0,
      message: job.message ?? "",
      logs: job.logs ?? "",
      createdAt: job.createdAt ? job.createdAt.getTime() : 0,
      updatedAt: job.updatedAt ? job.updatedAt.getTime() : 0,
    }));

  return (
    <AdminDataClient
      orphanedFiles={orphanedFiles}
      matchedFiles={matchedFiles}
      missingFiles={missingFiles}
      totalFiles={files.length}
      totalBooks={allBooks.length}
      orphanedSize={orphanedSize}
      matchedSize={matchedSize}
      booksDir={BOOKS_DIR}
      jobs={jobs}
    />
  );
}

function AdminDataSkeleton() {
  return (
    <div className="container my-8 px-6 mx-auto animate-pulse">
      <div className="h-8 bg-surface-elevated rounded w-64 mb-6" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 bg-surface-elevated rounded-xl" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 bg-surface-elevated rounded" />
        ))}
      </div>
    </div>
  );
}
