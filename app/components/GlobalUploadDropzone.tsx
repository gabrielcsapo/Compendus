"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-flight-router/client";

interface UploadItem {
  id: string;
  fileName: string;
  fileSize: number;
  progress: number;
  mergeProgress?: number; // Separate progress for merge phase (0-100)
  status: "uploading" | "processing" | "merging" | "done" | "error";
  error?: string;
  bookId?: number;
  jobId?: string; // Job ID for SSE progress tracking
}

const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".m4b"];

function isAudioFile(name: string): boolean {
  return AUDIO_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

/**
 * Get a File from a FileSystemFileEntry
 */
function getFileFromEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

/**
 * Read all entries from a directory (handles batching)
 */
async function readAllDirectoryEntries(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  const entries: FileSystemEntry[] = [];
  let batch: FileSystemEntry[];

  do {
    batch = await new Promise((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    entries.push(...batch);
  } while (batch.length > 0);

  return entries;
}

/**
 * Extract all audio files from a directory entry
 */
async function getAudioFilesFromDirectory(dirEntry: FileSystemDirectoryEntry): Promise<File[]> {
  const files: File[] = [];
  const reader = dirEntry.createReader();
  const entries = await readAllDirectoryEntries(reader);

  for (const entry of entries) {
    if (entry.isFile && isAudioFile(entry.name)) {
      try {
        const file = await getFileFromEntry(entry as FileSystemFileEntry);
        files.push(file);
      } catch {
        // Skip files that can't be read
      }
    }
  }

  return files;
}

/**
 * Upload multiple audio files as a single audiobook
 */
function uploadMultiFileAudiobook(
  files: File[],
  folderName: string,
  onProgress: (progress: number) => void,
  onMergeStart: (jobId: string) => void,
): Promise<{
  success: boolean;
  error?: string;
  jobId?: string;
  pending?: boolean;
  book?: { id: number; title: string; format: string };
}> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();

    // Add folder name
    formData.append("folderName", folderName);

    // Add all files with index for ordering
    files.forEach((file, index) => {
      formData.append(`file_${index}`, file);
    });

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        onProgress(percent);
      }
    });

    xhr.upload.addEventListener("load", () => {
      // Upload complete, server-side merging will start
      onMergeStart("pending");
    });

    xhr.addEventListener("load", () => {
      try {
        const response = JSON.parse(xhr.responseText);
        resolve(response);
      } catch {
        resolve({ success: false, error: "parse_error" });
      }
    });

    xhr.addEventListener("error", () => {
      resolve({ success: false, error: "network_error" });
    });

    xhr.open("POST", "/api/upload-multifile");
    xhr.send(formData);
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function uploadFileWithProgress(
  file: File,
  onProgress: (progress: number) => void,
): Promise<{
  success: boolean;
  error?: string;
  book?: { id: number; title: string; format: string };
}> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        onProgress(percent);
      }
    });

    xhr.addEventListener("load", () => {
      try {
        const response = JSON.parse(xhr.responseText);
        resolve(response);
      } catch {
        resolve({ success: false, error: "parse_error" });
      }
    });

    xhr.addEventListener("error", () => {
      resolve({ success: false, error: "network_error" });
    });

    xhr.open("POST", "/api/upload");
    xhr.send(formData);
  });
}

export function GlobalUploadDropzone() {
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [showToast, setShowToast] = useState(false);
  const dragCounterRef = useRef(0);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const updateUpload = useCallback((id: string, updates: Partial<UploadItem>) => {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...updates } : u)));
  }, []);

  const handleMultiFileAudiobook = useCallback(
    async (files: File[], folderName: string) => {
      const totalSize = files.reduce((sum, f) => sum + f.size, 0);

      // Create upload item for the merged audiobook
      const uploadId = `multifile-${folderName}-${Date.now()}`;
      const uploadItem: UploadItem = {
        id: uploadId,
        fileName: `${folderName} (${files.length} files)`,
        fileSize: totalSize,
        progress: 0,
        status: "uploading",
      };

      setUploads((prev) => [...prev, uploadItem]);
      setShowToast(true);

      // Clear any existing timeout
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }

      let eventSource: EventSource | null = null;

      // Helper to auto-hide toast after completion (defined outside try for catch access)
      const scheduleAutoHide = () => {
        if (toastTimeoutRef.current) {
          clearTimeout(toastTimeoutRef.current);
        }
        toastTimeoutRef.current = setTimeout(() => {
          setUploads((prev) => {
            const hasActive = prev.some(
              (u) => u.status === "uploading" || u.status === "processing" || u.status === "merging",
            );
            if (!hasActive) {
              const successCount = prev.filter((u) => u.status === "done").length;
              if (successCount > 0) {
                window.dispatchEvent(new CustomEvent("library-updated"));
              }
              setShowToast(false);
              return [];
            }
            return prev;
          });
        }, 3000);
      };

      try {
        const result = await uploadMultiFileAudiobook(
          files,
          folderName,
          (progress) => {
            updateUpload(uploadId, {
              progress,
              status: progress === 100 ? "merging" : "uploading",
            });
          },
          () => {
            // Upload complete, switch to merging status
            updateUpload(uploadId, { status: "merging", mergeProgress: 0 });
          },
        );

        // Handle error responses immediately
        if (result.error === "duplicate") {
          updateUpload(uploadId, { status: "error", error: "Already in library" });
          scheduleAutoHide();
          return;
        } else if (result.error === "ffmpeg_not_installed") {
          updateUpload(uploadId, { status: "error", error: "ffmpeg not installed" });
          scheduleAutoHide();
          return;
        } else if (!result.success && !result.pending) {
          updateUpload(uploadId, { status: "error", error: result.error || "Upload failed" });
          scheduleAutoHide();
          return;
        }

        // If we got a jobId, subscribe to SSE for real-time merge progress
        if (result.jobId) {
          // Set up SSE connection for progress updates
          eventSource = new EventSource(`/api/jobs/${result.jobId}/progress`);

          eventSource.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              if (data.status === "running") {
                updateUpload(uploadId, {
                  mergeProgress: data.progress || 0,
                  status: "merging",
                });
              } else if (data.status === "completed") {
                eventSource?.close();
                // Job completed - update UI with success
                updateUpload(uploadId, {
                  status: "done",
                  progress: 100,
                  mergeProgress: 100,
                  bookId: data.result?.bookId,
                });
                // Schedule auto-hide now that job is complete
                scheduleAutoHide();
              } else if (data.status === "error") {
                eventSource?.close();
                const errorMsg = data.result?.error;
                if (errorMsg === "duplicate") {
                  updateUpload(uploadId, { status: "error", error: "Already in library" });
                } else {
                  updateUpload(uploadId, { status: "error", error: errorMsg || "Merge failed" });
                }
                // Schedule auto-hide for error
                scheduleAutoHide();
              }
            } catch {
              // Ignore parse errors
            }
          };

          eventSource.onerror = () => {
            eventSource?.close();
            // Only set error if still merging (use setUploads for conditional update)
            setUploads((prev) =>
              prev.map((u) =>
                u.id === uploadId && u.status === "merging"
                  ? { ...u, status: "error" as const, error: "Connection lost" }
                  : u,
              ),
            );
            scheduleAutoHide();
          };
        } else if (result.success && result.book) {
          // Immediate success (no background job)
          updateUpload(uploadId, { status: "done", progress: 100, mergeProgress: 100, bookId: result.book.id });
          scheduleAutoHide();
        }
      } catch {
        eventSource?.close();
        updateUpload(uploadId, { status: "error", error: "Upload failed" });
        scheduleAutoHide();
      }
    },
    [updateUpload],
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
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

      const validFiles = fileArray.filter((file) =>
        validExtensions.some((ext) => file.name.toLowerCase().endsWith(ext)),
      );

      if (validFiles.length === 0) return;

      // Create upload items
      const newUploads: UploadItem[] = validFiles.map((file) => ({
        id: `${file.name}-${Date.now()}-${Math.random()}`,
        fileName: file.name,
        fileSize: file.size,
        progress: 0,
        status: "uploading" as const,
      }));

      setUploads((prev) => [...prev, ...newUploads]);
      setShowToast(true);

      // Clear any existing timeout
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }

      // Upload files
      for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        const uploadId = newUploads[i].id;

        try {
          const result = await uploadFileWithProgress(file, (progress) => {
            updateUpload(uploadId, {
              progress,
              status: progress === 100 ? "processing" : "uploading",
            });
          });

          if (result.success) {
            updateUpload(uploadId, { status: "done", progress: 100, bookId: result.book?.id });
          } else if (result.error === "duplicate") {
            updateUpload(uploadId, { status: "error", error: "Already in library" });
          } else {
            updateUpload(uploadId, { status: "error", error: "Upload failed" });
          }
        } catch {
          updateUpload(uploadId, { status: "error", error: "Upload failed" });
        }
      }

      // Auto-hide toast after all uploads complete (with delay)
      toastTimeoutRef.current = setTimeout(() => {
        setUploads((prev) => {
          const hasActive = prev.some((u) => u.status === "uploading" || u.status === "processing");
          if (!hasActive) {
            // Check if any were successful
            const successCount = prev.filter((u) => u.status === "done").length;
            if (successCount > 0) {
              // Trigger a soft refresh by dispatching a custom event
              window.dispatchEvent(new CustomEvent("library-updated"));
            }
            return [];
          }
          return prev;
        });
        setShowToast(false);
      }, 3000);
    },
    [updateUpload],
  );

  const dismissUpload = useCallback((id: string) => {
    setUploads((prev) => {
      const filtered = prev.filter((u) => u.id !== id);
      if (filtered.length === 0) {
        setShowToast(false);
      }
      return filtered;
    });
  }, []);

  const clearCompleted = useCallback(() => {
    setUploads((prev) => {
      const active = prev.filter((u) => u.status === "uploading" || u.status === "processing");
      if (active.length === 0) {
        setShowToast(false);
      }
      return active;
    });
  }, []);

  // Global drag/drop listeners
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current++;

      // Check if drag target is within a no-global-drop zone
      const target = e.target as HTMLElement;
      if (target.closest("[data-no-global-drop]")) {
        return;
      }

      if (e.dataTransfer?.types.includes("Files")) {
        setIsDragging(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current--;
      if (dragCounterRef.current === 0) {
        setIsDragging(false);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();

      // Hide overlay when dragging over a no-global-drop zone
      const target = e.target as HTMLElement;
      if (target.closest("[data-no-global-drop]")) {
        setIsDragging(false);
      }
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragging(false);

      // Check if drop target is within a no-global-drop zone
      const target = e.target as HTMLElement;
      if (target.closest("[data-no-global-drop]")) {
        return;
      }

      const items = e.dataTransfer?.items;

      // Check for folder drops with audio files
      if (items) {
        for (const item of Array.from(items)) {
          const entry = item.webkitGetAsEntry?.();
          if (entry?.isDirectory) {
            const audioFiles = await getAudioFilesFromDirectory(
              entry as FileSystemDirectoryEntry,
            );
            if (audioFiles.length > 1) {
              // Multi-file audiobook - merge and upload
              handleMultiFileAudiobook(audioFiles, entry.name);
              return;
            }
          }
        }
      }

      // Fall back to existing single-file handling
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        handleFiles(files);
      }
    };

    document.addEventListener("dragenter", handleDragEnter);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);

    return () => {
      document.removeEventListener("dragenter", handleDragEnter);
      document.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
    };
  }, [handleFiles]);

  const activeCount = uploads.filter(
    (u) => u.status === "uploading" || u.status === "processing" || u.status === "merging",
  ).length;
  const doneCount = uploads.filter((u) => u.status === "done").length;
  const errorCount = uploads.filter((u) => u.status === "error").length;

  return (
    <>
      {/* Drop hint indicator - bottom left corner */}
      {!isDragging && !showToast && (
        <label className="fixed bottom-4 left-4 z-40 flex items-center gap-2 px-3 py-2 bg-surface/80 backdrop-blur-sm border border-border rounded-lg text-xs text-foreground-muted opacity-60 hover:opacity-100 hover:border-primary hover:text-primary transition-all cursor-pointer">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          <span>Drop or click to upload</span>
          <input
            type="file"
            multiple
            accept=".pdf,.epub,.mobi,.azw,.azw3,.cbr,.cbz,.m4b,.m4a,.mp3"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleFiles(e.target.files);
                e.target.value = "";
              }
            }}
          />
        </label>
      )}

      {/* Full-screen drop overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-50 bg-primary/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="bg-surface border-2 border-dashed border-primary rounded-2xl p-12 shadow-2xl">
            <div className="flex flex-col items-center">
              <div className="w-20 h-20 rounded-full bg-primary-light flex items-center justify-center mb-4">
                <svg
                  className="w-10 h-10 text-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
              </div>
              <p className="text-xl font-semibold text-foreground">Drop files to upload</p>
              <p className="text-foreground-muted mt-1">PDF, EPUB, CBZ, M4B, MP3</p>
              <p className="text-foreground-muted/60 text-sm mt-0.5">Also accepts MOBI, AZW, CBR (auto-converted)</p>
            </div>
          </div>
        </div>
      )}

      {/* Upload progress toast */}
      {showToast && uploads.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 w-80 bg-surface border border-border rounded-xl shadow-xl overflow-hidden">
          {/* Header */}
          <div className="bg-surface-elevated px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              {activeCount > 0 ? (
                <>
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm font-medium text-foreground">
                    Uploading {activeCount} {activeCount === 1 ? "file" : "files"}...
                  </span>
                </>
              ) : (
                <>
                  <svg
                    className="w-4 h-4 text-success"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span className="text-sm font-medium text-foreground">
                    {doneCount} uploaded{errorCount > 0 && `, ${errorCount} failed`}
                  </span>
                </>
              )}
            </div>
            <button
              onClick={clearCompleted}
              className="text-foreground-muted hover:text-foreground text-xs"
            >
              Clear
            </button>
          </div>

          {/* Upload list */}
          <div className="max-h-64 overflow-y-auto">
            {uploads.map((upload) => (
              <div
                key={upload.id}
                className="px-4 py-3 border-b border-border last:border-b-0 flex items-center gap-3"
              >
                {/* Status icon */}
                <div className="flex-shrink-0">
                  {upload.status === "done" ? (
                    <div className="w-8 h-8 rounded-full bg-success-light flex items-center justify-center">
                      <svg
                        className="w-4 h-4 text-success"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </div>
                  ) : upload.status === "error" ? (
                    <div className="w-8 h-8 rounded-full bg-error-light flex items-center justify-center">
                      <svg
                        className="w-4 h-4 text-error"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-primary-light flex items-center justify-center">
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>

                {/* File info */}
                <div className="flex-1 min-w-0">
                  {upload.status === "done" && upload.bookId ? (
                    <Link
                      to={`/book/${upload.bookId}`}
                      className="text-sm text-foreground truncate block hover:text-primary hover:underline transition-colors"
                    >
                      {upload.fileName}
                    </Link>
                  ) : (
                    <p className="text-sm text-foreground truncate">{upload.fileName}</p>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-foreground-muted">
                      {formatFileSize(upload.fileSize)}
                    </span>
                    {upload.status === "uploading" && (
                      <span className="text-xs text-primary">{upload.progress}%</span>
                    )}
                    {upload.status === "processing" && (
                      <span className="text-xs text-primary">Processing...</span>
                    )}
                    {upload.status === "merging" && (
                      <span className="text-xs text-accent">
                        {upload.mergeProgress !== undefined && upload.mergeProgress > 0
                          ? `Merging: ${upload.mergeProgress}%`
                          : "Merging audio files..."}
                      </span>
                    )}
                    {upload.error && <span className="text-xs text-error">{upload.error}</span>}
                  </div>
                  {(upload.status === "uploading" ||
                    upload.status === "processing" ||
                    upload.status === "merging") && (
                    <div className="w-full bg-surface-elevated rounded-full h-1 mt-1 overflow-hidden">
                      {upload.status === "merging" ? (
                        upload.mergeProgress !== undefined && upload.mergeProgress > 0 ? (
                          <div
                            className="h-1 bg-accent rounded-full transition-all duration-150"
                            style={{ width: `${upload.mergeProgress}%` }}
                          />
                        ) : (
                          <div className="h-1 bg-accent rounded-full animate-indeterminate-progress" />
                        )
                      ) : (
                        <div
                          className="h-1 rounded-full transition-all duration-150 bg-primary"
                          style={{ width: `${upload.progress}%` }}
                        />
                      )}
                    </div>
                  )}
                </div>

                {/* Dismiss button */}
                {(upload.status === "done" || upload.status === "error") && (
                  <button
                    onClick={() => dismissUpload(upload.id)}
                    className="flex-shrink-0 text-foreground-muted hover:text-foreground"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
