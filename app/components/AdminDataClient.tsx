"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-flight-router/client";
import { useToast } from "./ToastContext";
import {
  deleteOrphanedFile,
  deleteMissingFileRecord,
  deleteBook,
  adminDataStats,
  adminListFiles,
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

type MatchedFile = FileInfo & { book: BookRecord };

interface AdminStats {
  totalFiles: number;
  totalBooks: number;
  orphanedCount: number;
  orphanedSize: number;
  matchedCount: number;
  matchedSize: number;
  missingCount: number;
  jobCount: number;
  booksDir: string;
  matchedFormats: string[];
}

interface InitialFilePage {
  items: unknown[];
  total: number;
  totalSize: number;
  pageSize: number;
}

interface AdminDataClientProps {
  stats: AdminStats;
  initialMatched: InitialFilePage;
  initialOrphaned: InitialFilePage;
  initialMissing: InitialFilePage;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function getFileExtension(name: string): string {
  return (name.split(".").pop() || "").toLowerCase();
}

function OrphanedFilePreview({ file }: { file: FileInfo }) {
  const ext = getFileExtension(file.name);
  const previewUrl = `/api/admin/preview/${encodeURIComponent(file.name)}`;

  if (ext === "pdf") {
    return (
      <iframe
        src={previewUrl}
        className="w-full h-full min-h-[60vh] rounded border border-border"
      />
    );
  }

  if (ext === "epub") {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-foreground-muted">
        <p className="text-sm mb-3">
          EPUB files cannot be previewed directly. Download to inspect.
        </p>
        <a
          href={previewUrl}
          download={file.name}
          className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90"
        >
          Download File
        </a>
      </div>
    );
  }

  if (["m4b", "m4a", "mp3"].includes(ext)) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 min-h-[200px]">
        <p className="text-sm text-foreground-muted">Audio preview</p>
        <audio controls className="w-full max-w-lg">
          <source src={previewUrl} />
          Your browser does not support the audio element.
        </audio>
      </div>
    );
  }

  if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext)) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px]">
        <img
          src={previewUrl}
          alt={file.name}
          className="max-w-full max-h-[70vh] object-contain rounded"
        />
      </div>
    );
  }

  if (["cbz", "cbr"].includes(ext)) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-foreground-muted">
        <p className="text-sm mb-3">
          Comic archive files cannot be previewed directly. Download to inspect.
        </p>
        <a
          href={previewUrl}
          download={file.name}
          className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90"
        >
          Download File
        </a>
      </div>
    );
  }

  // Fallback for unknown types
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-foreground-muted">
      <p className="text-sm mb-3">No preview available for .{ext} files.</p>
      <a
        href={previewUrl}
        download={file.name}
        className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90"
      >
        Download File
      </a>
    </div>
  );
}

interface GraphCoverage {
  total: number;
  completed: number;
  remaining: number;
  queuedExtractJobs: number;
  byStatus: Record<string, number>;
}

/**
 * Living Library coverage + backfill control. Surfaces how much of the library
 * has a knowledge graph and lets an admin queue extraction for the rest. The job
 * processor drains these one at a time, so it's safe to fire the whole library.
 */
function LivingLibrarySection() {
  const { showToast } = useToast();
  const [stats, setStats] = useState<GraphCoverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/backfill-graph");
      const data = await res.json();
      if (data.success) setStats(data as GraphCoverage);
    } catch {
      // leave stats null; the section shows a fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startBackfill = async (force: boolean) => {
    const scope = force
      ? "Re-analyze the ENTIRE library? This re-queues every book, including ones already analyzed."
      : `Queue Living Library analysis for ${stats?.remaining ?? "all"} un-analyzed book(s)?`;
    if (
      !confirm(
        `${scope}\n\nBooks process one at a time in the background and this can take a long while.`,
      )
    ) {
      return;
    }
    setStarting(true);
    try {
      const res = await fetch(`/api/admin/backfill-graph${force ? "?force=true" : ""}`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, "success");
        await load();
      } else {
        showToast(data.error || "Failed to start backfill", "error");
      }
    } catch {
      showToast("Failed to start backfill", "error");
    } finally {
      setStarting(false);
    }
  };

  const pct = stats && stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
  const erroredCount = stats?.byStatus.error ?? 0;

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
        <span className="w-3 h-3 bg-amber-500 rounded-full"></span>
        Graph Data
      </h2>
      <p className="text-sm text-foreground-muted mb-4">
        Extract entities, relationships, and passages so books appear in Wander and the knowledge
        graph. Books are processed one at a time in the background.
      </p>
      {loading ? (
        <div className="bg-surface-elevated rounded-lg p-4 text-foreground-muted">
          Loading graph coverage…
        </div>
      ) : stats ? (
        <div className="bg-surface-elevated rounded-lg p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <div>
              <div className="text-2xl font-bold text-foreground">{stats.completed}</div>
              <div className="text-sm text-foreground-muted">Analyzed</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">{stats.remaining}</div>
              <div className="text-sm text-foreground-muted">Remaining</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">{stats.queuedExtractJobs}</div>
              <div className="text-sm text-foreground-muted">Queued</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">{stats.total}</div>
              <div className="text-sm text-foreground-muted">Total Books</div>
            </div>
          </div>

          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-2 bg-surface rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs text-foreground-muted whitespace-nowrap">{pct}% analyzed</span>
          </div>

          {erroredCount > 0 && (
            <p className="text-xs text-error mb-3">
              {erroredCount} book{erroredCount === 1 ? "" : "s"} failed last time — re-running the
              backfill retries them.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => startBackfill(false)}
              disabled={starting || stats.remaining === 0}
              className="px-3 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {starting
                ? "Queuing…"
                : stats.remaining === 0
                  ? "All books analyzed"
                  : `Analyze ${stats.remaining} remaining`}
            </button>
            <button
              onClick={() => startBackfill(true)}
              disabled={starting}
              className="px-3 py-2 text-sm rounded-lg border border-border text-foreground-muted hover:text-foreground hover:bg-surface disabled:opacity-50"
            >
              Re-analyze all
            </button>
            <button
              onClick={load}
              disabled={starting}
              className="px-3 py-2 text-sm text-foreground-muted hover:text-foreground disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-surface-elevated rounded-lg p-4 text-foreground-muted">
          Couldn't load graph coverage.
        </div>
      )}
    </section>
  );
}

/** Page numbers with ellipsis around the current page. */
function buildPageList(totalPages: number, current: number): (number | "ellipsis")[] {
  return Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter((p) => p === 1 || p === totalPages || Math.abs(p - current) <= 2)
    .reduce<(number | "ellipsis")[]>((acc, p, i, arr) => {
      if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push("ellipsis");
      acc.push(p);
      return acc;
    }, []);
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onChange(1)}
        disabled={page <= 1}
        className="px-2 py-1 text-xs rounded bg-surface-elevated border border-border text-foreground hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
      >
        First
      </button>
      <button
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="px-2 py-1 text-xs rounded bg-surface-elevated border border-border text-foreground hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Prev
      </button>
      {buildPageList(totalPages, page).map((p, i) =>
        p === "ellipsis" ? (
          <span key={`ellipsis-${i}`} className="px-1 text-xs text-foreground-muted">
            ...
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={`px-2 py-1 text-xs rounded border ${
              p === page
                ? "bg-primary text-white border-primary"
                : "bg-surface-elevated border-border text-foreground hover:bg-surface"
            }`}
          >
            {p}
          </button>
        ),
      )}
      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="px-2 py-1 text-xs rounded bg-surface-elevated border border-border text-foreground hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Next
      </button>
      <button
        onClick={() => onChange(totalPages)}
        disabled={page >= totalPages}
        className="px-2 py-1 text-xs rounded bg-surface-elevated border border-border text-foreground hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Last
      </button>
    </div>
  );
}

interface FileSectionState<T> {
  items: T[];
  total: number;
  totalSize: number;
  page: number;
  q: string;
  format: string;
  pageSize: number;
  loading: boolean;
}

export function AdminDataClient({
  stats: initialStats,
  initialMatched,
  initialOrphaned,
  initialMissing,
}: AdminDataClientProps) {
  const { showToast } = useToast();

  const [stats, setStats] = useState<AdminStats>(initialStats);

  // --- Per-section state, seeded from the server-rendered first page ---
  const [matched, setMatched] = useState<FileSectionState<MatchedFile>>({
    items: initialMatched.items as MatchedFile[],
    total: initialMatched.total,
    totalSize: initialMatched.totalSize,
    page: 1,
    q: "",
    format: "all",
    pageSize: initialMatched.pageSize,
    loading: false,
  });
  const [orphaned, setOrphaned] = useState<FileSectionState<FileInfo>>({
    items: initialOrphaned.items as FileInfo[],
    total: initialOrphaned.total,
    totalSize: initialOrphaned.totalSize,
    page: 1,
    q: "",
    format: "all",
    pageSize: initialOrphaned.pageSize,
    loading: false,
  });
  const [missing, setMissing] = useState<FileSectionState<BookRecord>>({
    items: initialMissing.items as BookRecord[],
    total: initialMissing.total,
    totalSize: initialMissing.totalSize,
    page: 1,
    q: "",
    format: "all",
    pageSize: initialMissing.pageSize,
    loading: false,
  });
  // Out-of-order response guards: only apply the latest request per section.
  const matchedReq = useRef(0);
  const orphanedReq = useRef(0);
  const missingReq = useRef(0);

  const [deleting, setDeleting] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<FileInfo | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadBookIdRef = useRef<string | null>(null);

  // --- Fetchers ----------------------------------------------------------
  const fetchFiles = useCallback(
    async (
      category: "matched" | "orphaned" | "missing",
      reqRef: React.MutableRefObject<number>,
      setState: React.Dispatch<React.SetStateAction<FileSectionState<never>>>,
      args: { page: number; q: string; format: string; pageSize: number },
    ) => {
      const reqId = ++reqRef.current;
      setState((s) => ({ ...s, loading: true }));
      try {
        const res = await adminListFiles({
          category,
          page: args.page,
          pageSize: args.pageSize,
          q: args.q,
          format: args.format,
        });
        if (reqId !== reqRef.current) return; // stale response
        setState((s) => ({
          ...s,
          items: res.items as never[],
          total: res.total,
          totalSize: res.totalSize,
          loading: false,
        }));
      } catch {
        if (reqId !== reqRef.current) return;
        setState((s) => ({ ...s, loading: false }));
        showToast("Failed to load data", "error");
      }
    },
    [showToast],
  );

  const refreshStats = useCallback(async () => {
    try {
      setStats(await adminDataStats());
    } catch {
      // keep prior stats on failure
    }
  }, []);

  // --- Debounced search per section -------------------------------------
  const useDebouncedSearch = (q: string, deps: unknown[], run: () => void, skipFirst: boolean) => {
    const first = useRef(skipFirst);
    useEffect(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      const t = setTimeout(run, 300);
      return () => clearTimeout(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
  };

  // Matched: refetch on search/format change (debounced, resets to page 1).
  useDebouncedSearch(
    matched.q,
    [matched.q, matched.format, matched.pageSize],
    () => {
      setMatched((s) => ({ ...s, page: 1 }));
      fetchFiles("matched", matchedReq, setMatched as never, {
        page: 1,
        q: matched.q,
        format: matched.format,
        pageSize: matched.pageSize,
      });
    },
    true,
  );
  useDebouncedSearch(
    orphaned.q,
    [orphaned.q, orphaned.pageSize],
    () => {
      setOrphaned((s) => ({ ...s, page: 1 }));
      fetchFiles("orphaned", orphanedReq, setOrphaned as never, {
        page: 1,
        q: orphaned.q,
        format: "all",
        pageSize: orphaned.pageSize,
      });
    },
    true,
  );
  useDebouncedSearch(
    missing.q,
    [missing.q, missing.pageSize],
    () => {
      setMissing((s) => ({ ...s, page: 1 }));
      fetchFiles("missing", missingReq, setMissing as never, {
        page: 1,
        q: missing.q,
        format: "all",
        pageSize: missing.pageSize,
      });
    },
    true,
  );

  // --- Page-change handlers ---------------------------------------------
  const goMatchedPage = (page: number) => {
    setMatched((s) => ({ ...s, page }));
    fetchFiles("matched", matchedReq, setMatched as never, {
      page,
      q: matched.q,
      format: matched.format,
      pageSize: matched.pageSize,
    });
  };
  const goOrphanedPage = (page: number) => {
    setOrphaned((s) => ({ ...s, page }));
    fetchFiles("orphaned", orphanedReq, setOrphaned as never, {
      page,
      q: orphaned.q,
      format: "all",
      pageSize: orphaned.pageSize,
    });
  };
  const goMissingPage = (page: number) => {
    setMissing((s) => ({ ...s, page }));
    fetchFiles("missing", missingReq, setMissing as never, {
      page,
      q: missing.q,
      format: "all",
      pageSize: missing.pageSize,
    });
  };

  // Re-fetch the current page of a section (used after mutations).
  const reloadMatched = useCallback(() => {
    fetchFiles("matched", matchedReq, setMatched as never, {
      page: matched.page,
      q: matched.q,
      format: matched.format,
      pageSize: matched.pageSize,
    });
  }, [fetchFiles, matched.page, matched.q, matched.format, matched.pageSize]);
  const reloadOrphaned = useCallback(() => {
    fetchFiles("orphaned", orphanedReq, setOrphaned as never, {
      page: orphaned.page,
      q: orphaned.q,
      format: "all",
      pageSize: orphaned.pageSize,
    });
  }, [fetchFiles, orphaned.page, orphaned.q, orphaned.pageSize]);
  const reloadMissing = useCallback(() => {
    fetchFiles("missing", missingReq, setMissing as never, {
      page: missing.page,
      q: missing.q,
      format: "all",
      pageSize: missing.pageSize,
    });
  }, [fetchFiles, missing.page, missing.q, missing.pageSize]);

  const matchedTotalPages = Math.max(1, Math.ceil(matched.total / matched.pageSize));
  const orphanedTotalPages = Math.max(1, Math.ceil(orphaned.total / orphaned.pageSize));
  const missingTotalPages = Math.max(1, Math.ceil(missing.total / missing.pageSize));

  // --- Mutation handlers -------------------------------------------------
  const handleDeleteOrphanedFile = async (file: FileInfo) => {
    if (!confirm(`Delete orphaned file "${file.name}"? This cannot be undone.`)) return;

    setDeleting(file.path);
    const result = await deleteOrphanedFile(file.path);
    setDeleting(null);

    if (result.success) {
      reloadOrphaned();
      refreshStats();
    } else {
      showToast(result.message, "error");
    }
  };

  const handleUploadMissingFile = (book: BookRecord) => {
    uploadBookIdRef.current = book.id;
    if (fileInputRef.current) {
      fileInputRef.current.accept = `.${book.format}`;
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const bookId = uploadBookIdRef.current;
    if (!file || !bookId) return;

    setUploading(bookId);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`/api/books/${bookId}/file`, {
        method: "POST",
        body: formData,
      });
      const result = await res.json();

      if (result.success) {
        // The file moved from "missing" to "matched": refresh both + stats.
        reloadMissing();
        reloadMatched();
        refreshStats();
      } else {
        showToast(result.message || result.error || "Upload failed", "error");
      }
    } catch {
      showToast("Upload failed", "error");
    } finally {
      setUploading(null);
      uploadBookIdRef.current = null;
    }
  };

  const handleDeleteMissingRecord = async (book: BookRecord) => {
    if (!confirm(`Delete database record for "${book.title}"? This cannot be undone.`)) return;

    setDeleting(book.id);
    const result = await deleteMissingFileRecord(book.id);
    setDeleting(null);

    if (result.success) {
      reloadMissing();
      refreshStats();
    } else {
      showToast(result.message, "error");
    }
  };

  const handleDeleteMatchedBook = async (file: MatchedFile) => {
    if (!confirm(`Delete "${file.book.title}" and its file? This cannot be undone.`)) return;

    setDeleting(file.book.id);
    const success = await deleteBook(file.book.id);
    setDeleting(null);

    if (success) {
      reloadMatched();
      refreshStats();
    } else {
      showToast("Failed to delete book", "error");
    }
  };

  const sectionSpinner = (loading: boolean) =>
    loading ? <span className="text-xs text-foreground-muted ml-2">Loading…</span> : null;

  return (
    <div>
      <input type="file" ref={fileInputRef} onChange={handleFileSelected} className="hidden" />
      <p className="text-foreground-muted text-sm mb-8">
        Comparing files in{" "}
        <code className="bg-surface-elevated px-1 rounded">{stats.booksDir}</code> with database
        records
      </p>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-surface-elevated rounded-lg p-4">
          <div className="text-2xl font-bold text-foreground">{stats.totalFiles}</div>
          <div className="text-sm text-foreground-muted">Files on Disk</div>
        </div>
        <div className="bg-surface-elevated rounded-lg p-4">
          <div className="text-2xl font-bold text-foreground">{stats.totalBooks}</div>
          <div className="text-sm text-foreground-muted">Database Records</div>
        </div>
        <div className="bg-surface-elevated rounded-lg p-4">
          <div className="text-2xl font-bold text-warning">{stats.orphanedCount}</div>
          <div className="text-sm text-foreground-muted">Orphaned Files</div>
          <div className="text-xs text-foreground-muted">{formatBytes(stats.orphanedSize)}</div>
        </div>
        <div className="bg-surface-elevated rounded-lg p-4">
          <div className="text-2xl font-bold text-error">{stats.missingCount}</div>
          <div className="text-sm text-foreground-muted">Missing Files</div>
        </div>
      </div>

      {/* Graph Data Section */}
      <LivingLibrarySection />

      {/* Orphaned Files Section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
          <span className="w-3 h-3 bg-warning rounded-full"></span>
          Orphaned Files ({stats.orphanedCount}){sectionSpinner(orphaned.loading)}
        </h2>
        <p className="text-sm text-foreground-muted mb-4">
          These files exist on disk but have no corresponding database entry. They can potentially
          be deleted.
        </p>

        <div className="mb-4">
          <input
            type="text"
            placeholder="Search by filename..."
            value={orphaned.q}
            onChange={(e) => setOrphaned((s) => ({ ...s, q: e.target.value }))}
            className="w-full sm:max-w-md px-3 py-2 text-sm bg-surface-elevated border border-border rounded-lg text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {orphaned.items.length === 0 ? (
          <div className="bg-surface-elevated rounded-lg p-4 text-foreground-muted">
            {orphaned.q ? "No orphaned files match your search." : "No orphaned files found."}
          </div>
        ) : (
          <>
            <div className="bg-surface-elevated rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 text-foreground-muted font-medium">Filename</th>
                    <th className="text-right p-3 text-foreground-muted font-medium">Size</th>
                    <th className="text-right p-3 text-foreground-muted font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orphaned.items.map((file) => (
                    <tr
                      key={file.name}
                      className="border-b border-border last:border-0 hover:bg-surface"
                    >
                      <td className="p-3 text-foreground font-mono text-xs">{file.name}</td>
                      <td className="p-3 text-foreground-muted text-right">
                        {formatBytes(file.size)}
                      </td>
                      <td className="p-3 text-right flex items-center justify-end gap-2">
                        <button
                          onClick={() => setPreviewFile(file)}
                          className="text-primary hover:text-primary/80 text-xs"
                        >
                          View
                        </button>
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
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-foreground-muted">
                Page {orphaned.page} of {orphanedTotalPages} · {formatBytes(orphaned.totalSize)}
              </p>
              <Pagination
                page={orphaned.page}
                totalPages={orphanedTotalPages}
                onChange={goOrphanedPage}
              />
            </div>
          </>
        )}
      </section>

      {/* Orphaned File Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPreviewFile(null)} />
          <div className="relative bg-surface border border-border rounded-xl shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <h3 className="text-lg font-semibold text-foreground">{previewFile.name}</h3>
                <p className="text-sm text-foreground-muted">
                  {formatBytes(previewFile.size)} &middot;{" "}
                  {previewFile.name.split(".").pop()?.toUpperCase()}
                </p>
              </div>
              <button
                onClick={() => setPreviewFile(null)}
                className="text-foreground-muted hover:text-foreground text-xl leading-none px-2"
              >
                &times;
              </button>
            </div>
            <div className="flex-1 overflow-hidden p-4 min-h-0">
              <OrphanedFilePreview file={previewFile} />
            </div>
          </div>
        </div>
      )}

      {/* Missing Files Section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
          <span className="w-3 h-3 bg-error rounded-full"></span>
          Missing Files ({stats.missingCount}){sectionSpinner(missing.loading)}
        </h2>
        <p className="text-sm text-foreground-muted mb-4">
          These database entries have no corresponding file on disk. The books may need to be
          re-imported or the records deleted.
        </p>

        <div className="mb-4">
          <input
            type="text"
            placeholder="Search by title, filename, or format..."
            value={missing.q}
            onChange={(e) => setMissing((s) => ({ ...s, q: e.target.value }))}
            className="w-full sm:max-w-md px-3 py-2 text-sm bg-surface-elevated border border-border rounded-lg text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {missing.items.length === 0 ? (
          <div className="bg-surface-elevated rounded-lg p-4 text-foreground-muted">
            {missing.q ? "No missing files match your search." : "No missing files found."}
          </div>
        ) : (
          <>
            <div className="bg-surface-elevated rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 text-foreground-muted font-medium">Title</th>
                    <th className="text-left p-3 text-foreground-muted font-medium">Format</th>
                    <th className="text-left p-3 text-foreground-muted font-medium">ID</th>
                    <th className="text-right p-3 text-foreground-muted font-medium">
                      Expected Size
                    </th>
                    <th className="text-right p-3 text-foreground-muted font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {missing.items.map((book) => (
                    <tr
                      key={book.id}
                      className="border-b border-border last:border-0 hover:bg-surface"
                    >
                      <td className="p-3 text-foreground">
                        <Link to={`/book/${book.id}`} className="hover:text-primary">
                          {book.title}
                        </Link>
                      </td>
                      <td className="p-3 text-foreground-muted uppercase">{book.format}</td>
                      <td className="p-3 text-foreground-muted font-mono text-xs">{book.id}</td>
                      <td className="p-3 text-foreground-muted text-right">
                        {formatBytes(book.fileSize)}
                      </td>
                      <td className="p-3 text-right flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleUploadMissingFile(book)}
                          disabled={uploading === book.id}
                          className="text-primary hover:text-primary/80 disabled:opacity-50 text-xs"
                        >
                          {uploading === book.id ? "Uploading..." : "Upload File"}
                        </button>
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
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-foreground-muted">
                Page {missing.page} of {missingTotalPages}
              </p>
              <Pagination
                page={missing.page}
                totalPages={missingTotalPages}
                onChange={goMissingPage}
              />
            </div>
          </>
        )}
      </section>

      {/* Matched Files Section */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
          <span className="w-3 h-3 bg-success rounded-full"></span>
          Matched Files ({stats.matchedCount}){sectionSpinner(matched.loading)}
        </h2>
        <p className="text-sm text-foreground-muted mb-4">
          These files are properly linked to database records. Total size:{" "}
          {formatBytes(stats.matchedSize)}
        </p>

        {/* Search and Filter Controls */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <input
            type="text"
            placeholder="Search by title, filename, or format..."
            value={matched.q}
            onChange={(e) => setMatched((s) => ({ ...s, q: e.target.value }))}
            className="flex-1 px-3 py-2 text-sm bg-surface-elevated border border-border rounded-lg text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <select
            value={matched.format}
            onChange={(e) => setMatched((s) => ({ ...s, format: e.target.value }))}
            className="px-3 py-2 text-sm bg-surface-elevated border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Formats</option>
            {stats.matchedFormats.map((fmt) => (
              <option key={fmt} value={fmt}>
                {fmt.toUpperCase()}
              </option>
            ))}
          </select>
          <select
            value={matched.pageSize}
            onChange={(e) =>
              setMatched((s) => ({ ...s, pageSize: Number(e.target.value), page: 1 }))
            }
            className="px-3 py-2 text-sm bg-surface-elevated border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value={25}>25 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
          </select>
        </div>

        {(matched.q || matched.format !== "all") && (
          <p className="text-xs text-foreground-muted mb-3">
            Showing {matched.total} of {stats.matchedCount} files · {formatBytes(matched.totalSize)}
          </p>
        )}

        {stats.matchedCount === 0 ? (
          <div className="bg-surface-elevated rounded-lg p-4 text-foreground-muted">
            No matched files found.
          </div>
        ) : matched.items.length === 0 ? (
          <div className="bg-surface-elevated rounded-lg p-4 text-foreground-muted">
            No files match your search criteria.
          </div>
        ) : (
          <>
            <div className="bg-surface-elevated rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 text-foreground-muted font-medium">Title</th>
                    <th className="text-left p-3 text-foreground-muted font-medium">Filename</th>
                    <th className="text-left p-3 text-foreground-muted font-medium">Format</th>
                    <th className="text-right p-3 text-foreground-muted font-medium">Size</th>
                    <th className="text-right p-3 text-foreground-muted font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {matched.items.map((file) => (
                    <tr
                      key={file.name}
                      className="border-b border-border last:border-0 hover:bg-surface"
                    >
                      <td className="p-3 text-foreground">
                        <Link to={`/book/${file.book.id}`} className="hover:text-primary">
                          {file.book.title}
                        </Link>
                      </td>
                      <td className="p-3 text-foreground-muted font-mono text-xs">{file.name}</td>
                      <td className="p-3 text-foreground-muted uppercase">{file.book.format}</td>
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
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-foreground-muted">
                Page {matched.page} of {matchedTotalPages}
              </p>
              <Pagination
                page={matched.page}
                totalPages={matchedTotalPages}
                onChange={goMatchedPage}
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
