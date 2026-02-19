import { Hono } from "hono";
import { getJob, subscribeToJob } from "../../app/lib/jobs";

const app = new Hono();

// GET /api/jobs/:id/progress - SSE endpoint for job progress
app.get("/api/jobs/:id/progress", async (c) => {
  const jobId = c.req.param("id");

  // Check if job exists
  const job = getJob(jobId);
  if (!job) {
    return c.json({ success: false, error: "job_not_found" }, 404);
  }

  // Create SSE response
  const encoder = new TextEncoder();
  let isClosed = false;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (data: unknown) => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          isClosed = true;
          unsubscribe?.();
        }
      };

      // Send current job state immediately
      sendEvent(job);

      // If job is already complete, close the stream
      if (job.status === "completed" || job.status === "error") {
        isClosed = true;
        controller.close();
        return;
      }

      // Subscribe to updates
      unsubscribe = subscribeToJob(jobId, (updatedJob) => {
        if (isClosed) return;
        sendEvent(updatedJob);

        // Close stream when job completes
        if (updatedJob.status === "completed" || updatedJob.status === "error") {
          isClosed = true;
          unsubscribe?.();
          try {
            controller.close();
          } catch {
            // Already closed
          }
        }
      });
    },
    cancel() {
      isClosed = true;
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

// GET /api/jobs/:id - Get current job state (polling endpoint)
app.get("/api/jobs/:id", async (c) => {
  const jobId = c.req.param("id");
  const job = getJob(jobId);

  if (!job) {
    return c.json({ success: false, error: "job_not_found" }, 404);
  }

  return c.json({ success: true, ...job });
});

export { app as jobsRoutes };
