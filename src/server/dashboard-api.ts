import { Hono, type Context, type Next } from "hono";
import { randomUUID } from "crypto";
import type { JobStore, Job } from "../queue/job-store.js";
import type { JobQueue } from "../queue/job-queue.js";
import { loadConfig, updateConfigSection } from "../config/loader.js";
import { maskSensitiveConfig } from "../utils/config-masker.js";

// In-memory session token store: token → expiry timestamp
const sessionTokens = new Map<string, number>();
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

// SSE client management
interface SSEClient {
  id: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
}

const sseClients = new Map<string, SSEClient>();
const encoder = new TextEncoder();

function broadcastToAllClients(event: string, data: any): void {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const clientsToRemove: string[] = [];

  for (const [clientId, client] of sseClients) {
    try {
      client.controller.enqueue(encoder.encode(message));
    } catch {
      // Client disconnected, mark for removal
      clientsToRemove.push(clientId);
    }
  }

  // Clean up disconnected clients
  for (const clientId of clientsToRemove) {
    sseClients.delete(clientId);
  }
}

function pruneExpiredTokens(): void {
  const now = Date.now();
  for (const [token, expiry] of sessionTokens) {
    if (now > expiry) sessionTokens.delete(token);
  }
}

function isValidSessionToken(token: string): boolean {
  pruneExpiredTokens();
  const expiry = sessionTokens.get(token);
  return expiry !== undefined && Date.now() <= expiry;
}

/**
 * Creates dashboard API routes.
 * If apiKey is provided, all /api/* routes require `Authorization: Bearer <key>`.
 * SSE endpoints (/api/events, /api/jobs/:id/logs/stream) cannot set headers in the
 * browser EventSource API, so they accept a short-lived session token via ?token=<token>.
 * Obtain a session token from POST /api/auth with the Bearer key.
 */
export function createDashboardRoutes(store: JobStore, queue: JobQueue, apiKey?: string): Hono {
  const api = new Hono();

  // Subscribe to JobStore events for real-time broadcasts
  store.on('jobDeleted', (job: Job) => {
    broadcastToAllClients('jobDeleted', { id: job.id, job });
  });

  store.on('jobUpdated', (job: Job) => {
    broadcastToAllClients('jobUpdated', { id: job.id, job });
  });

  store.on('jobCreated', (job: Job) => {
    broadcastToAllClients('jobCreated', { id: job.id, job });
  });

  if (apiKey) {
    // POST /api/auth — exchange Bearer key for a short-lived session token
    api.post("/api/auth", (c) => {
      const auth = c.req.header("Authorization");
      if (!auth || auth !== `Bearer ${apiKey}`) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      pruneExpiredTokens();
      const token = randomUUID();
      sessionTokens.set(token, Date.now() + SESSION_TTL_MS);
      return c.json({ token, expiresIn: SESSION_TTL_MS });
    });

    // Auth middleware for regular (non-SSE) API endpoints — Bearer header only
    const bearerAuth = async (c: Context, next: Next) => {
      const auth = c.req.header("Authorization");
      if (!auth || auth !== `Bearer ${apiKey}`) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      await next();
    };

    api.use("/api/jobs", bearerAuth);
    api.use("/api/jobs/*", bearerAuth);
    api.use("/api/stats", bearerAuth);
    api.use("/api/config", bearerAuth);

    // SSE endpoints use short-lived session token from ?token= query param
    const sseTokenAuth = async (c: Context, next: Next) => {
      const token = c.req.query("token");
      if (!token || !isValidSessionToken(token)) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      await next();
    };

    api.use("/api/events", sseTokenAuth);
    api.use("/api/jobs/:id/logs/stream", sseTokenAuth);
  }

  // Get configuration (masked for security)
  api.get("/api/config", (c) => {
    try {
      const projectRoot = process.cwd();
      const config = loadConfig(projectRoot);
      const maskedConfig = maskSensitiveConfig(config);
      return c.json({ config: maskedConfig });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return c.json({ error: `Failed to load configuration: ${message}` }, 500);
    }
  });

  // Update configuration
  api.put("/api/config", async (c) => {
    try {
      const body = await c.req.json();
      if (!body || typeof body !== "object") {
        return c.json({ error: "Invalid request body" }, 400);
      }

      updateConfigSection(process.cwd(), body);
      return c.json({ success: true, message: "Configuration updated successfully" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const isValidationError = message.includes("validation") || message.includes("Invalid") || message.includes("not found");
      const status = isValidationError ? 400 : 500;
      const prefix = isValidationError ? "Configuration validation failed" : "Failed to update configuration";
      return c.json({ error: `${prefix}: ${message}` }, status);
    }
  });

  // List all jobs (exclude archived by default, ?include=archived to show)
  api.get("/api/jobs", (c) => {
    const includeArchived = c.req.query("include") === "archived";
    const jobs = includeArchived ? store.list() : store.list().filter(j => j.status !== "archived");
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

  // Aggregate stats
  api.get("/api/stats", (c) => {
    const jobs = store.list();
    const total = jobs.length;
    const successCount = jobs.filter(j => j.status === "success").length;
    const failureCount = jobs.filter(j => j.status === "failure").length;
    const runningCount = jobs.filter(j => j.status === "running").length;
    const queuedCount  = jobs.filter(j => j.status === "queued").length;
    const cancelledCount = jobs.filter(j => j.status === "cancelled").length;

    const completed = jobs.filter(j => j.completedAt && j.startedAt);
    const avgDurationMs = completed.length > 0
      ? Math.round(completed.reduce((sum, j) => {
          return sum + (new Date(j.completedAt!).getTime() - new Date(j.startedAt!).getTime());
        }, 0) / completed.length)
      : 0;

    const successRate = total > 0 ? Math.round((successCount / total) * 100) : 0;

    return c.json({
      total,
      successCount,
      failureCount,
      runningCount,
      queuedCount,
      cancelledCount,
      avgDurationMs,
      successRate,
    });
  });

  // SSE stream for job logs
  api.get("/api/jobs/:id/logs/stream", (c) => {
    const id = c.req.param("id");
    let lastLogCount = 0;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = () => {
          try {
            const job = store.get(id);
            if (!job) {
              controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: "Job not found" })}\n\n`));
              clearInterval(intervalId);
              try { controller.close(); } catch { /* already closed */ }
              return;
            }
            const logs = job.logs || [];
            if (logs.length > lastLogCount) {
              const newLines = logs.slice(lastLogCount);
              lastLogCount = logs.length;
              for (const line of newLines) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ line, status: job.status })}\n\n`));
              }
            }
            // Send status update so client knows when job finishes
            if (job.status !== "running" && job.status !== "queued") {
              controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ status: job.status })}\n\n`));
              clearInterval(intervalId);
              try { controller.close(); } catch { /* already closed */ }
            }
          } catch {
            // stream closed
          }
        };
        send();
        intervalId = setInterval(send, 1000);
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

  // Retry a failed job
  api.post("/api/jobs/:id/retry", async (c) => {
    const id = c.req.param("id");
    const job = store.get(id);
    if (!job) return c.json({ error: "Job not found" }, 404);
    if (job.status !== "failure" && job.status !== "cancelled") {
      return c.json({ error: "Only failed or cancelled jobs can be retried" }, 400);
    }
    const newJob = queue.retryJob(id);
    if (!newJob) {
      return c.json({ error: "Failed to retry job" }, 500);
    }
    return c.json({ status: "queued", id: newJob.id });
  });

  // SSE endpoint for real-time updates
  api.get("/api/events", (c) => {
    const clientId = randomUUID();
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const stream = new ReadableStream({
      start(controller) {
        // Register client
        sseClients.set(clientId, { id: clientId, controller });

        // Send initial state
        const sendInitialState = () => {
          try {
            const jobs = store.list();
            const status = queue.getStatus();
            const data = JSON.stringify({ jobs: jobs.slice(0, 20), queue: status });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          } catch {
            // stream closed
          }
        };

        sendInitialState();

        // Send periodic updates for fallback (reduced frequency since real-time events handle most updates)
        intervalId = setInterval(sendInitialState, 10000); // 10 seconds instead of 2

        // Auto-cleanup after 5 minutes
        setTimeout(() => {
          clearInterval(intervalId);
          sseClients.delete(clientId);
          try { controller.close(); } catch { /* already closed */ }
        }, 300000);
      },
      cancel() {
        clearInterval(intervalId);
        sseClients.delete(clientId);
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
