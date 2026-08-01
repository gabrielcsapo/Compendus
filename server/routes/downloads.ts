import { Hono } from "hono";
import { streamFileResponse } from "../lib/file-serving";
import { resolveDownloadArtifact, resolveDownloadArtifactByHash } from "../lib/download-artifacts";

const app = new Hono();

function statusFor(error: unknown): 400 | 404 | 409 | 500 {
  const message = error instanceof Error ? error.message : "";
  if (message === "invalid_variant" || message === "invalid_artifact") return 400;
  if (message === "book_not_found") return 404;
  if (
    message === "ccd_not_ready" ||
    message === "ccd_not_found" ||
    message === "converted_epub_not_ready" ||
    message === "artifact_not_found"
  )
    return 409;
  return 500;
}

app.get("/api/downloads/:bookId/manifest", async (c) => {
  try {
    const variant = c.req.query("variant");
    const artifact = await resolveDownloadArtifact(c.req.param("bookId"), variant);
    const query = new URLSearchParams({ artifact: artifact.sha256 });
    if (variant) query.set("variant", variant);
    return c.json({
      artifactId: `${artifact.bookId}:${artifact.sha256}`,
      bookId: artifact.bookId,
      url: `/api/downloads/${artifact.bookId}/file?${query.toString()}`,
      format: artifact.format,
      originalFormat: artifact.originalFormat,
      byteLength: artifact.byteLength,
      sha256: artifact.sha256,
      artifactVersion: artifact.artifactVersion,
      ccdVersion: artifact.ccdVersion,
      peakDiskBytes: artifact.peakDiskBytes,
    });
  } catch (error) {
    const status = statusFor(error);
    return c.json({ error: error instanceof Error ? error.message : "artifact_failed" }, status);
  }
});

app.get("/api/downloads/:bookId/file", async (c) => {
  try {
    const expectedArtifact = c.req.query("artifact");
    const artifact = expectedArtifact
      ? await resolveDownloadArtifactByHash(
          c.req.param("bookId"),
          expectedArtifact,
          c.req.query("variant"),
        )
      : await resolveDownloadArtifact(c.req.param("bookId"), c.req.query("variant"));
    return streamFileResponse(c, artifact.path, {
      contentType: artifact.format === "ccdpack" ? "application/zip" : undefined,
      disposition: `attachment; filename="${artifact.bookId}.${artifact.format === "ccdpack" ? "zip" : artifact.format}"`,
      cacheControl: "private, no-transform, max-age=31536000, immutable",
      headers: {
        "X-Artifact-SHA256": artifact.sha256,
        "X-Artifact-Version": String(artifact.artifactVersion),
      },
      etag: `"sha256-${artifact.sha256}"`,
    });
  } catch (error) {
    const status = statusFor(error);
    return c.json({ error: error instanceof Error ? error.message : "artifact_failed" }, status);
  }
});

export { app as downloadRoutes };
