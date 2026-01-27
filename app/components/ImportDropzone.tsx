"use client";

import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router";

interface UploadProgress {
  fileName: string;
  fileSize: number;
  progress: number;
  status: "uploading" | "processing" | "done" | "error";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Upload a single file with progress tracking
function uploadFileWithProgress(
  file: File,
  onProgress: (progress: number) => void,
): Promise<{ success: boolean; error?: string }> {
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

export function ImportDropzone() {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [currentUpload, setCurrentUpload] = useState<UploadProgress | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      setIsUploading(true);
      setUploadStatus(null);

      const fileArray = Array.from(files);
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];

        setCurrentUpload({
          fileName: file.name,
          fileSize: file.size,
          progress: 0,
          status: "uploading",
        });

        try {
          const result = await uploadFileWithProgress(file, (progress) => {
            setCurrentUpload({
              fileName: file.name,
              fileSize: file.size,
              progress,
              status: progress === 100 ? "processing" : "uploading",
            });
          });

          if (result.success) {
            successCount++;
            setCurrentUpload({
              fileName: file.name,
              fileSize: file.size,
              progress: 100,
              status: "done",
            });
          } else if (result.error === "duplicate") {
            setUploadStatus(`"${file.name}" already exists in your library`);
          } else {
            errorCount++;
            setCurrentUpload({
              fileName: file.name,
              fileSize: file.size,
              progress: 100,
              status: "error",
            });
          }
        } catch (error) {
          console.error("Upload failed:", error);
          errorCount++;
          setCurrentUpload({
            fileName: file.name,
            fileSize: file.size,
            progress: 0,
            status: "error",
          });
        }
      }

      setIsUploading(false);
      setCurrentUpload(null);

      if (successCount > 0) {
        setUploadStatus(`Successfully imported ${successCount} book${successCount > 1 ? "s" : ""}`);
        // Refresh the page to show new books
        navigate(0);
      } else if (errorCount > 0 && !uploadStatus) {
        setUploadStatus(`Failed to import ${errorCount} file${errorCount > 1 ? "s" : ""}`);
      }
    },
    [navigate, uploadStatus],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFiles(files);
      }
    },
    [handleFiles],
  );

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFiles(files);
      }
    },
    [handleFiles],
  );

  return (
    <div
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        bg-surface border-2 border-dashed rounded-xl transition-all duration-200
        ${isDragging ? "border-primary bg-primary-light" : "border-border hover:border-primary/50 hover:bg-surface-elevated"}
        ${isUploading ? "pointer-events-none" : "cursor-pointer"}
      `}
    >
      <div className="flex flex-col items-center justify-center py-12 px-6">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.epub,.mobi,.azw,.azw3,.cbr,.cbz,.m4b,.m4a,.mp3"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />

        {isUploading && currentUpload ? (
          <div className="w-full max-w-xs">
            <div className="w-16 h-16 rounded-full bg-primary-light flex items-center justify-center mb-4 mx-auto">
              {currentUpload.status === "processing" ? (
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg
                  className="w-8 h-8 text-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
              )}
            </div>
            <p className="text-foreground font-medium text-center truncate mb-1">
              {currentUpload.fileName}
            </p>
            <p className="text-foreground-muted text-xs text-center mb-3">
              {formatFileSize(currentUpload.fileSize)}
            </p>
            <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-150"
                style={{ width: `${currentUpload.progress}%` }}
              />
            </div>
            <p className="text-foreground-muted text-sm text-center">
              {currentUpload.status === "processing"
                ? "Processing..."
                : `Uploading ${currentUpload.progress}%`}
            </p>
          </div>
        ) : isUploading ? (
          <>
            <div className="w-16 h-16 rounded-full bg-primary-light flex items-center justify-center mb-4">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
            <p className="text-foreground font-medium">Importing...</p>
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-full bg-primary-light flex items-center justify-center mb-4">
              <svg
                className="w-8 h-8 text-primary"
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
            <p className="text-foreground text-center font-medium">Drop files here</p>
            <p className="text-foreground-muted text-sm mt-1">or click to browse</p>
            <p className="text-foreground-muted/60 text-xs mt-3">
              Supports PDF, EPUB, MOBI, CBR, CBZ, M4B, and MP3
            </p>
          </>
        )}

        {uploadStatus && (
          <p
            className={`mt-4 text-sm font-medium ${uploadStatus.includes("Successfully") ? "text-success" : "text-warning"}`}
          >
            {uploadStatus}
          </p>
        )}
      </div>
    </div>
  );
}
