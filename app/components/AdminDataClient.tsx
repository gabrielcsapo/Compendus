"use client";

import React, { useState } from "react";
import { Link } from "react-flight-router/client";
import {
  deleteOrphanedFile,
  deleteMissingFileRecord,
  deleteBook,
  cancelBackgroundJob,
} from "../actions/books";

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

interface JobRecord {
  id: string;
  type: string;
  status: string;
  progress: number;
  message: string;
  logs: string;
  createdAt: number;
  updatedAt: number;
}

interface AdminDataClientProps {
  orphanedFiles: FileInfo[];
  matchedFiles: (FileInfo & { book: BookRecord })[];
  missingFiles: BookRecord[];
  totalFiles: number;
  totalBooks: number;
  orphanedSize: number;
  matchedSize: number;
  booksDir: string;
  jobs: JobRecord[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function AdminDataClient({
  orphanedFiles: initialOrphanedFiles,
  matchedFiles: initialMatchedFiles,
  missingFiles: initialMissingFiles,
  totalFiles,
  totalBooks,
  orphanedSize: initialOrphanedSize,
  matchedSize,
  booksDir,
  jobs: initialJobs,
}: AdminDataClientProps) {
  const [orphanedFiles, setOrphanedFiles] = useState(initialOrphanedFiles);
  const [matchedFiles, setMatchedFiles] = useState(initialMatchedFiles);
  const [missingFiles, setMissingFiles] = useState(initialMissingFiles);
  const [orphanedSize, setOrphanedSize] = useState(initialOrphanedSize);
  const [jobs, setJobs] = useState(initialJobs);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  // Matched files: search, filter, pagination
  const [matchedSearch, setMatchedSearch] = useState("");
  const [matchedFormatFilter, setMatchedFormatFilter] = useState<string>("all");
  const [matchedPage, setMatchedPage] = useState(1);
  const [matchedPageSize, setMatchedPageSize] = useState(50);

  const matchedFormats = Array.from(
    new Set(matchedFiles.map((f) => f.book.format.toLowerCase())),
  ).sort();

  const filteredMatchedFiles = matchedFiles.filter((file) => {
    const search = matchedSearch.toLowerCase().replace(/[^\w\s]/g, "");
    const matchesSearch =
      !search ||
      file.book.title.toLowerCase().replace(/[^\w\s]/g, "").includes(search) ||
      file.name.toLowerCase().replace(/[^\w\s]/g, "").includes(search) ||
      file.book.format.toLowerCase().includes(search);
    const matchesFormat =
      matchedFormatFilter === "all" ||
      file.book.format.toLowerCase() === matchedFormatFilter;
    return matchesSearch && matchesFormat;
  });

  const matchedTotalPages = Math.max(
    1,
    Math.ceil(filteredMatchedFiles.length / matchedPageSize),
  );
  const clampedPage = Math.min(matchedPage, matchedTotalPages);
  const paginatedMatchedFiles = filteredMatchedFiles.slice(
    (clampedPage - 1) * matchedPageSize,
    clampedPage * matchedPageSize,
  );

  const handleCancelJob = async (job: JobRecord) => {
    const action = job.status === "running"
      ? "Cancel"
      : job.status === "pending"
        ? "Cancel"
        : "Clear";
    if (!confirm(`${action} job "${job.id}"?`)) return;

    setDeleting(job.id);
    const result = await cancelBackgroundJob(job.id);
    setDeleting(null);

    if (result.success) {
      if (job.status === "completed" || job.status === "error") {
        setJobs((prev) => prev.filter((j) => j.id !== job.id));
      } else {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id ? { ...j, status: "error", message: "Cancelled", progress: 0 } : j,
          ),
        );
      }
    } else {
      alert(result.message);
    }
  };

  const handleDeleteOrphanedFile = async (file: FileInfo) => {
    if (!confirm(`Delete orphaned file "${file.name}"? This cannot be undone.`))
      return;

    setDeleting(file.path);
    const result = await deleteOrphanedFile(file.path);
    setDeleting(null);

    if (result.success) {
      setOrphanedFiles((prev) => prev.filter((f) => f.path !== file.path));
      setOrphanedSize((prev) => prev - file.size);
    } else {
      alert(result.message);
    }
  };

  const handleDeleteMissingRecord = async (book: BookRecord) => {
    if (
      !confirm(
        `Delete database record for "${book.title}"? This cannot be undone.`,
      )
    )
      return;

    setDeleting(book.id);
    const result = await deleteMissingFileRecord(book.id);
    setDeleting(null);

    if (result.success) {
      setMissingFiles((prev) => prev.filter((b) => b.id !== book.id));
    } else {
      alert(result.message);
    }
  };

  const handleDeleteMatchedBook = async (
    file: FileInfo & { book: BookRecord },
  ) => {
    if (
      !confirm(
        `Delete "${file.book.title}" and its file? This cannot be undone.`,
      )
    )
      return;

    setDeleting(file.book.id);
    const success = await deleteBook(file.book.id);
    setDeleting(null);

    if (success) {
      setMatchedFiles((prev) => prev.filter((f) => f.book.id !== file.book.id));
    } else {
      alert("Failed to delete book");
    }
  };

  return (
    <main className="container my-8 px-6 mx-auto max-w-6xl">
      <div className="mb-8">
        <Link to="/" className="text-primary hover:underline text-sm">
          &larr; Back to Library
        </Link>
        <h1 className="text-2xl font-bold text-foreground mt-2">
          Data Administration
        </h1>
        <p className="text-foreground-muted text-sm mt-1">
          Comparing files in{" "}
          <code className="bg-surface-elevated px-1 rounded">{booksDir}</code>{" "}
          with database records
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-surface-elevated rounded-lg p-4">
          <div className="text-2xl font-bold text-foreground">{totalFiles}</div>
          <div className="text-sm text-foreground-muted">Files on Disk</div>
        </div>
        <div className="bg-surface-elevated rounded-lg p-4">
          <div className="text-2xl font-bold text-foreground">{totalBooks}</div>
          <div className="text-sm text-foreground-muted">Database Records</div>
        </div>
        <div className="bg-surface-elevated rounded-lg p-4">
          <div className="text-2xl font-bold text-warning">
            {orphanedFiles.length}
          </div>
          <div className="text-sm text-foreground-muted">Orphaned Files</div>
          <div className="text-xs text-foreground-muted">
            {formatBytes(orphanedSize)}
          </div>
        </div>
        <div className="bg-surface-elevated rounded-lg p-4">
          <div className="text-2xl font-bold text-error">
            {missingFiles.length}
          </div>
          <div className="text-sm text-foreground-muted">Missing Files</div>
        </div>
      </div>

      {/* Background Jobs Section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
          <span className="w-3 h-3 bg-primary rounded-full"></span>
          Background Jobs ({jobs.length})
        </h2>
        <p className="text-sm text-foreground-muted mb-4">
          Persistent job queue for transcription, conversion, and other long-running tasks.
        </p>
        {jobs.length === 0 ? (
          <div className="bg-surface-elevated rounded-lg p-4 text-foreground-muted">
            No background jobs found.
          </div>
        ) : (
          <div className="bg-surface-elevated rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 text-foreground-muted font-medium">
                    Job ID
                  </th>
                  <th className="text-left p-3 text-foreground-muted font-medium">
                    Type
                  </th>
                  <th className="text-left p-3 text-foreground-muted font-medium">
                    Status
                  </th>
                  <th className="text-left p-3 text-foreground-muted font-medium">
                    Progress
                  </th>
                  <th className="text-left p-3 text-foreground-muted font-medium">
                    Message
                  </th>
                  <th className="text-right p-3 text-foreground-muted font-medium">
                    Updated
                  </th>
                  <th className="text-right p-3 text-foreground-muted font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <React.Fragment key={job.id}>
                    <tr
                      className="border-b border-border last:border-0 hover:bg-surface cursor-pointer"
                      onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
                    >
                      <td className="p-3 text-foreground font-mono text-xs">
                        <span className="mr-1.5 text-foreground-muted">
                          {expandedJob === job.id ? "\u25BC" : "\u25B6"}
                        </span>
                        {job.id}
                      </td>
                      <td className="p-3 text-foreground-muted capitalize">
                        {job.type}
                      </td>
                      <td className="p-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                            job.status === "completed"
                              ? "bg-green-500/10 text-green-700 dark:text-green-400"
                              : job.status === "running"
                                ? "bg-blue-500/10 text-blue-700 dark:text-blue-400"
                                : job.status === "error"
                                  ? "bg-red-500/10 text-red-700 dark:text-red-400"
                                  : "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
                          }`}
                        >
                          {job.status === "running" && (
                            <span className="w-1.5 h-1.5 bg-current rounded-full animate-pulse" />
                          )}
                          {job.status}
                        </span>
                      </td>
                      <td className="p-3 text-foreground-muted">
                        {job.status === "running" || job.status === "completed" ? (
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-surface rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary rounded-full transition-all"
                                style={{ width: `${job.progress}%` }}
                              />
                            </div>
                            <span className="text-xs">{job.progress}%</span>
                          </div>
                        ) : (
                          <span className="text-xs">—</span>
                        )}
                      </td>
                      <td className="p-3 text-foreground-muted text-xs max-w-[200px] truncate">
                        {job.message || "—"}
                      </td>
                      <td className="p-3 text-foreground-muted text-xs text-right whitespace-nowrap" suppressHydrationWarning>
                        {job.updatedAt
                          ? new Date(job.updatedAt).toLocaleString()
                          : "—"}
                      </td>
                      <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleCancelJob(job)}
                          disabled={deleting === job.id}
                          className="text-error hover:text-error/80 disabled:opacity-50 text-xs"
                        >
                          {deleting === job.id
                            ? "..."
                            : job.status === "running" || job.status === "pending"
                              ? "Cancel"
                              : "Clear"}
                        </button>
                      </td>
                    </tr>
                    {expandedJob === job.id && (
                      <tr className="border-b border-border">
                        <td colSpan={7} className="p-0">
                          <pre className="p-3 bg-surface text-foreground-muted text-xs font-mono overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap">
                            {job.logs || "No logs captured yet."}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Orphaned Files Section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
          <span className="w-3 h-3 bg-warning rounded-full"></span>
          Orphaned Files ({orphanedFiles.length})
        </h2>
        <p className="text-sm text-foreground-muted mb-4">
          These files exist on disk but have no corresponding database entry.
          They can potentially be deleted.
        </p>
        {orphanedFiles.length === 0 ? (
          <div className="bg-surface-elevated rounded-lg p-4 text-foreground-muted">
            No orphaned files found.
          </div>
        ) : (
          <div className="bg-surface-elevated rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 text-foreground-muted font-medium">
                    Filename
                  </th>
                  <th className="text-right p-3 text-foreground-muted font-medium">
                    Size
                  </th>
                  <th className="text-right p-3 text-foreground-muted font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {orphanedFiles.map((file) => (
                  <tr
                    key={file.name}
                    className="border-b border-border last:border-0 hover:bg-surface"
                  >
                    <td className="p-3 text-foreground font-mono text-xs">
                      {file.name}
                    </td>
                    <td className="p-3 text-foreground-muted text-right">
                      {formatBytes(file.size)}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => handleDeleteOrphanedFile(file)}
                        disabled={deleting === file.path}
                        className="text-error hover:text-error/80 disabled:opacity-50 text-xs"
                      >
                        {deleting === file.path ? "Deleting..." : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Missing Files Section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
          <span className="w-3 h-3 bg-error rounded-full"></span>
          Missing Files ({missingFiles.length})
        </h2>
        <p className="text-sm text-foreground-muted mb-4">
          These database entries have no corresponding file on disk. The books
          may need to be re-imported or the records deleted.
        </p>
        {missingFiles.length === 0 ? (
          <div className="bg-surface-elevated rounded-lg p-4 text-foreground-muted">
            No missing files found.
          </div>
        ) : (
          <div className="bg-surface-elevated rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 text-foreground-muted font-medium">
                    Title
                  </th>
                  <th className="text-left p-3 text-foreground-muted font-medium">
                    Format
                  </th>
                  <th className="text-left p-3 text-foreground-muted font-medium">
                    ID
                  </th>
                  <th className="text-right p-3 text-foreground-muted font-medium">
                    Expected Size
                  </th>
                  <th className="text-right p-3 text-foreground-muted font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {missingFiles.map((book) => (
                  <tr
                    key={book.id}
                    className="border-b border-border last:border-0 hover:bg-surface"
                  >
                    <td className="p-3 text-foreground">
                      <Link
                        to={`/book/${book.id}`}
                        className="hover:text-primary"
                      >
                        {book.title}
                      </Link>
                    </td>
                    <td className="p-3 text-foreground-muted uppercase">
                      {book.format}
                    </td>
                    <td className="p-3 text-foreground-muted font-mono text-xs">
                      {book.id}
                    </td>
                    <td className="p-3 text-foreground-muted text-right">
                      {formatBytes(book.fileSize)}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => handleDeleteMissingRecord(book)}
                        disabled={deleting === book.id}
                        className="text-error hover:text-error/80 disabled:opacity-50 text-xs"
                      >
                        {deleting === book.id ? "Deleting..." : "Delete Record"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Matched Files Section */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
          <span className="w-3 h-3 bg-success rounded-full"></span>
          Matched Files ({matchedFiles.length})
        </h2>
        <p className="text-sm text-foreground-muted mb-4">
          These files are properly linked to database records. Total size:{" "}
          {formatBytes(matchedSize)}
        </p>

        {/* Search and Filter Controls */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <input
            type="text"
            placeholder="Search by title, filename, or format..."
            value={matchedSearch}
            onChange={(e) => {
              setMatchedSearch(e.target.value);
              setMatchedPage(1);
            }}
            className="flex-1 px-3 py-2 text-sm bg-surface-elevated border border-border rounded-lg text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <select
            value={matchedFormatFilter}
            onChange={(e) => {
              setMatchedFormatFilter(e.target.value);
              setMatchedPage(1);
            }}
            className="px-3 py-2 text-sm bg-surface-elevated border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Formats</option>
            {matchedFormats.map((fmt) => (
              <option key={fmt} value={fmt}>
                {fmt.toUpperCase()}
              </option>
            ))}
          </select>
          <select
            value={matchedPageSize}
            onChange={(e) => {
              setMatchedPageSize(Number(e.target.value));
              setMatchedPage(1);
            }}
            className="px-3 py-2 text-sm bg-surface-elevated border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value={25}>25 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
          </select>
        </div>

        {(matchedSearch || matchedFormatFilter !== "all") && (
          <p className="text-xs text-foreground-muted mb-3">
            Showing {filteredMatchedFiles.length} of {matchedFiles.length} files
          </p>
        )}

        {matchedFiles.length === 0 ? (
          <div className="bg-surface-elevated rounded-lg p-4 text-foreground-muted">
            No matched files found.
          </div>
        ) : filteredMatchedFiles.length === 0 ? (
          <div className="bg-surface-elevated rounded-lg p-4 text-foreground-muted">
            No files match your search criteria.
          </div>
        ) : (
          <>
            <div className="bg-surface-elevated rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 text-foreground-muted font-medium">
                      Title
                    </th>
                    <th className="text-left p-3 text-foreground-muted font-medium">
                      Filename
                    </th>
                    <th className="text-left p-3 text-foreground-muted font-medium">
                      Format
                    </th>
                    <th className="text-right p-3 text-foreground-muted font-medium">
                      Size
                    </th>
                    <th className="text-right p-3 text-foreground-muted font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedMatchedFiles.map((file) => (
                    <tr
                      key={file.name}
                      className="border-b border-border last:border-0 hover:bg-surface"
                    >
                      <td className="p-3 text-foreground">
                        <Link
                          to={`/book/${file.book.id}`}
                          className="hover:text-primary"
                        >
                          {file.book.title}
                        </Link>
                      </td>
                      <td className="p-3 text-foreground-muted font-mono text-xs">
                        {file.name}
                      </td>
                      <td className="p-3 text-foreground-muted uppercase">
                        {file.book.format}
                      </td>
                      <td className="p-3 text-foreground-muted text-right">
                        {formatBytes(file.size)}
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => handleDeleteMatchedBook(file)}
                          disabled={deleting === file.book.id}
                          className="text-error hover:text-error/80 disabled:opacity-50 text-xs"
                        >
                          {deleting === file.book.id ? "Deleting..." : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {matchedTotalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-xs text-foreground-muted">
                  Page {clampedPage} of {matchedTotalPages}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setMatchedPage(1)}
                    disabled={clampedPage <= 1}
                    className="px-2 py-1 text-xs rounded bg-surface-elevated border border-border text-foreground hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    First
                  </button>
                  <button
                    onClick={() => setMatchedPage(clampedPage - 1)}
                    disabled={clampedPage <= 1}
                    className="px-2 py-1 text-xs rounded bg-surface-elevated border border-border text-foreground hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Prev
                  </button>
                  {Array.from({ length: matchedTotalPages }, (_, i) => i + 1)
                    .filter(
                      (p) =>
                        p === 1 ||
                        p === matchedTotalPages ||
                        Math.abs(p - clampedPage) <= 2,
                    )
                    .reduce<(number | "ellipsis")[]>((acc, p, i, arr) => {
                      if (i > 0 && p - (arr[i - 1] as number) > 1)
                        acc.push("ellipsis");
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((p, i) =>
                      p === "ellipsis" ? (
                        <span
                          key={`ellipsis-${i}`}
                          className="px-1 text-xs text-foreground-muted"
                        >
                          ...
                        </span>
                      ) : (
                        <button
                          key={p}
                          onClick={() => setMatchedPage(p)}
                          className={`px-2 py-1 text-xs rounded border ${
                            p === clampedPage
                              ? "bg-primary text-white border-primary"
                              : "bg-surface-elevated border-border text-foreground hover:bg-surface"
                          }`}
                        >
                          {p}
                        </button>
                      ),
                    )}
                  <button
                    onClick={() => setMatchedPage(clampedPage + 1)}
                    disabled={clampedPage >= matchedTotalPages}
                    className="px-2 py-1 text-xs rounded bg-surface-elevated border border-border text-foreground hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                  <button
                    onClick={() => setMatchedPage(matchedTotalPages)}
                    disabled={clampedPage >= matchedTotalPages}
                    className="px-2 py-1 text-xs rounded bg-surface-elevated border border-border text-foreground hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Last
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
