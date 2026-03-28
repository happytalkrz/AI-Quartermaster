import { Hono } from "hono";
import type { JobStore } from "../queue/job-store.js";
import type { JobQueue } from "../queue/job-queue.js";

/**
 * Creates dashboard API routes.
 */
export function createDashboardRoutes(store: JobStore, queue: JobQueue): Hono {
  const api = new Hono();

  // List all jobs
  api.get("/api/jobs", (c) => {
    const jobs = store.list();
    const status = queue.getStatus();
    return c.json({ jobs, queue: status });
  });

  // Get single job
  api.get("/api/jobs/:id", (c) => {
    const job = store.get(c.req.param("id"));
    if (!job) return c.json({ error: "Job not found" }, 404);
    return c.json(job);
  });

  // Cancel a job
  api.post("/api/jobs/:id/cancel", (c) => {
    const id = c.req.param("id");
    const cancelled = queue.cancel(id);
    if (!cancelled) return c.json({ error: "Job not found or not cancellable" }, 404);
    return c.json({ status: "cancelled", id });
  });

  // Delete a completed/failed job
  api.delete("/api/jobs/:id", (c) => {
    const id = c.req.param("id");
    const job = store.get(id);
    if (!job) return c.json({ error: "Job not found" }, 404);
    if (job.status === "queued" || job.status === "running") {
      return c.json({ error: "Cannot delete active job. Cancel it first." }, 400);
    }
    const deleted = store.remove(id);
    if (!deleted) return c.json({ error: "Failed to delete" }, 500);
    return c.json({ status: "deleted", id });
  });

  // SSE endpoint for real-time updates
  api.get("/api/events", (c) => {
    // Simple SSE - send current state every 2 seconds
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = () => {
          try {
            const jobs = store.list();
            const status = queue.getStatus();
            const data = JSON.stringify({ jobs: jobs.slice(0, 20), queue: status });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          } catch {
            // stream closed
          }
        };
        send();
        intervalId = setInterval(send, 2000);
        // Clean up when client disconnects
        // Note: in practice, Hono handles this
        setTimeout(() => {
          clearInterval(intervalId);
          try { controller.close(); } catch { /* already closed */ }
        }, 300000); // 5 min max
      },
      cancel() {
        clearInterval(intervalId);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  });

  return api;
}
