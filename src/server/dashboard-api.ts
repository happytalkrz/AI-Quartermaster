import { Hono, type Context, type Next } from "hono";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { JobStore, Job } from "../queue/job-store.js";
import type { JobQueue } from "../queue/job-queue.js";
import { loadConfig, updateConfigSection, addProjectToConfig, removeProjectFromConfig, updateProjectInConfig } from "../config/loader.js";
import { validateConfig } from "../config/validator.js";
import { maskSensitiveConfig } from "../utils/config-masker.js";
import type { ProjectConfig, AQConfig } from "../types/config.js";
import type { ConfigWatcher } from "../config/config-watcher.js";
import { setGlobalLogLevel, getLogger } from "../utils/logger.js";
import { CreateProjectRequestSchema, UpdateConfigRequestSchema } from "../types/api.js";
import { SelfUpdater } from "../update/self-updater.js";

// In-memory session token store: token → expiry timestamp
const sessionTokens = new Map<string, number>();
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

// SSE client management
interface SSEClient {
  id: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
}

// SSE event data types
type SSEEventData =
  | { event: 'jobDeleted'; data: { id: string; job: Job } }
  | { event: 'jobUpdated'; data: { id: string; job: Job } }
  | { event: 'jobCreated'; data: { id: string; job: Job } }
  | { event: 'configChanged'; data: { changes: unknown; timestamp: string } };

const sseClients = new Map<string, SSEClient>();
const encoder = new TextEncoder();

function broadcastToAllClients<T extends SSEEventData['event']>(
  event: T,
  data: Extract<SSEEventData, { event: T }>['data']
): void {
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
 * Applies runtime configuration changes to system components.
 */
export function applyConfigChanges(oldConfig: AQConfig, newConfig: AQConfig, queue: JobQueue): void {
  const logger = getLogger();

  // Update JobQueue concurrency
  if (newConfig.general.concurrency !== oldConfig.general.concurrency) {
    queue.setConcurrency(newConfig.general.concurrency);
    logger.info(`Concurrency updated: ${oldConfig.general.concurrency} → ${newConfig.general.concurrency}`);
  }

  // Update logger level
  if (newConfig.general.logLevel !== oldConfig.general.logLevel) {
    setGlobalLogLevel(newConfig.general.logLevel);
    logger.info(`Log level updated: ${oldConfig.general.logLevel} → ${newConfig.general.logLevel}`);
  }
}

/**
 * Creates dashboard API routes.
 * If apiKey is provided, all /api/* routes require `Authorization: Bearer <key>`.
 * SSE endpoints (/api/events, /api/jobs/:id/logs/stream) cannot set headers in the
 * browser EventSource API, so they accept a short-lived session token via ?token=<token>.
 * Obtain a session token from POST /api/auth with the Bearer key.
 */
export function createDashboardRoutes(store: JobStore, queue: JobQueue, configWatcher?: ConfigWatcher, apiKey?: string): Hono {
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
    api.use("/api/projects", bearerAuth);
    api.use("/api/projects/*", bearerAuth);
    api.use("/api/version", bearerAuth);
    api.use("/api/update", bearerAuth);

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

  const getErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : "Unknown error";

  const projectRoot = process.cwd();
  const configPath = `${projectRoot}/config.yml`;

  // Update configuration
  api.put("/api/config", async (c) => {
    try {
      const body = await c.req.json();

      // Zod 스키마 검증
      const parseResult = UpdateConfigRequestSchema.safeParse(body);
      if (!parseResult.success) {
        return c.json({
          error: "Invalid request body",
          details: parseResult.error
        }, 400);
      }

      // Update configuration file
      // Filter out undefined values to match Partial<AQConfig> type expectation
      const cleanedData = Object.fromEntries(
        Object.entries(parseResult.data).map(([key, value]) => [
          key,
          typeof value === 'object' && value !== null
            ? Object.fromEntries(Object.entries(value).filter(([_, v]) => v !== undefined))
            : value
        ]).filter(([_, v]) => v !== undefined)
      ) as Partial<AQConfig>;

      updateConfigSection(process.cwd(), cleanedData);

      // Apply runtime changes if configWatcher is available
      if (configWatcher) {
        try {
          // Load updated config for runtime application
          const newConfig = loadConfig(projectRoot);

          // Apply runtime changes immediately (force update)
          if (body.general?.concurrency !== undefined) {
            queue.setConcurrency(newConfig.general.concurrency);
          }
          if (body.general?.logLevel !== undefined) {
            setGlobalLogLevel(newConfig.general.logLevel);
          }

          // Broadcast config change to SSE clients
          broadcastToAllClients('configChanged', {
            changes: body,
            timestamp: new Date().toISOString()
          });
        } catch (runtimeError: unknown) {
          // Log runtime application error but don't fail the request
          const logger = getLogger();
          const errMsg = runtimeError instanceof Error ? runtimeError.message : "Unknown error";
          logger.warn(`Failed to apply runtime config changes: ${errMsg}`);
        }
      }

      return c.json({ success: true, message: "Configuration updated successfully" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const isValidationError = message.includes("validation") || message.includes("Invalid") || message.includes("not found");
      const status = isValidationError ? 400 : 500;
      const prefix = isValidationError ? "Configuration validation failed" : "Failed to update configuration";
      return c.json({ error: `${prefix}: ${message}` }, status);
    }
  });

  // Add project to configuration
  api.post("/api/projects", async (c) => {
    try {
      const body = await c.req.json();

      // Zod 스키마 검증
      const parseResult = CreateProjectRequestSchema.safeParse(body);
      if (!parseResult.success) {
        return c.json({
          error: "Invalid request body",
          details: parseResult.error
        }, 400);
      }

      const { repo, path, baseBranch, mode } = parseResult.data;

      const project: ProjectConfig = {
        repo: repo.trim(),
        path: path.trim(),
        baseBranch: baseBranch?.trim() || undefined,
        mode,
      };

      try {
        const currentConfig = loadConfig(projectRoot);
        if (currentConfig.projects?.find(p => p.repo === project.repo)) {
          return c.json({ error: `Project "${project.repo}" already exists` }, 409);
        }
      } catch (error: unknown) {
        // Config doesn't exist yet, proceed
      }

      addProjectToConfig(configPath, project);

      try {
        validateConfig(loadConfig(projectRoot));
      } catch (error: unknown) {
        return c.json({ error: `Configuration validation failed: ${getErrorMessage(error)}` }, 400);
      }

      return c.json({
        message: "Project added successfully",
        project
      }, 201);
    } catch (error: unknown) {
      return c.json({ error: `Failed to add project: ${getErrorMessage(error)}` }, 500);
    }
  });

  // Remove project from configuration
  api.delete("/api/projects/:repo", (c) => {
    try {
      const repo = decodeURIComponent(c.req.param("repo"));

      if (!repo || repo.trim() === "") {
        return c.json({ error: "repo parameter is required" }, 400);
      }

      try {
        const currentConfig = loadConfig(projectRoot);
        if (!currentConfig.projects?.find(p => p.repo === repo)) {
          return c.json({ error: `Project "${repo}" not found` }, 404);
        }
      } catch (error: unknown) {
        return c.json({ error: `Failed to load configuration: ${getErrorMessage(error)}` }, 500);
      }

      removeProjectFromConfig(configPath, repo);

      try {
        validateConfig(loadConfig(projectRoot));
      } catch (error: unknown) {
        return c.json({ error: `Configuration validation failed: ${getErrorMessage(error)}` }, 400);
      }

      return c.json({
        message: "Project removed successfully",
        repo
      });
    } catch (error: unknown) {
      return c.json({ error: `Failed to remove project: ${getErrorMessage(error)}` }, 500);
    }
  });

  // Update project in configuration
  api.put("/api/projects/:repo", async (c) => {
    try {
      const repo = decodeURIComponent(c.req.param("repo"));

      if (!repo || repo.trim() === "") {
        return c.json({ error: "repo parameter is required" }, 400);
      }

      const body = await c.req.json();

      if (!body || typeof body !== "object") {
        return c.json({ error: "Invalid request body" }, 400);
      }

      // Validate that project exists
      try {
        const currentConfig = loadConfig(projectRoot);
        if (!currentConfig.projects?.find(p => p.repo === repo)) {
          return c.json({ error: `Project "${repo}" not found` }, 404);
        }
      } catch (error: unknown) {
        return c.json({ error: `Failed to load configuration: ${getErrorMessage(error)}` }, 500);
      }

      // Extract valid update fields
      const { path, baseBranch, mode } = body;
      const updates: Partial<Pick<ProjectConfig, 'path' | 'baseBranch' | 'mode'>> = {};

      if (path !== undefined) {
        if (typeof path !== "string" || path.trim() === "") {
          return c.json({ error: "path must be a non-empty string" }, 400);
        }
        updates.path = path.trim();
      }

      if (baseBranch !== undefined) {
        if (typeof baseBranch !== "string") {
          return c.json({ error: "baseBranch must be a string" }, 400);
        }
        updates.baseBranch = baseBranch.trim() || undefined;
      }

      if (mode !== undefined) {
        if (mode !== "code" && mode !== "content" && mode !== null) {
          return c.json({ error: "mode must be 'code', 'content', or null" }, 400);
        }
        updates.mode = mode || undefined;
      }

      // Check if any fields to update
      if (Object.keys(updates).length === 0) {
        return c.json({ error: "No valid fields to update" }, 400);
      }

      updateProjectInConfig(configPath, repo, updates);

      try {
        validateConfig(loadConfig(projectRoot));
      } catch (error: unknown) {
        return c.json({ error: `Configuration validation failed: ${getErrorMessage(error)}` }, 400);
      }

      return c.json({
        message: "Project updated successfully",
        repo,
        updates
      });
    } catch (error: unknown) {
      return c.json({ error: `Failed to update project: ${getErrorMessage(error)}` }, 500);
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

  // Helper to read current version from package.json
  const getCurrentVersion = (): string => {
    const packageJsonPath = resolve(process.cwd(), "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    return packageJson.version;
  };

  // Get version information (current version + update check)
  api.get("/api/version", async (c) => {
    try {
      const currentVersion = getCurrentVersion();
      const config = loadConfig(process.cwd());
      const selfUpdater = new SelfUpdater(config.git, { cwd: process.cwd() });

      try {
        const updateInfo = await selfUpdater.checkForUpdates();
        return c.json({
          currentVersion,
          currentHash: updateInfo.currentHash.substring(0, 8),
          remoteHash: updateInfo.remoteHash.substring(0, 8),
          hasUpdates: updateInfo.hasUpdates,
          packageLockChanged: updateInfo.packageLockChanged,
        });
      } catch (updateError) {
        getLogger().warn(`업데이트 확인 실패: ${getErrorMessage(updateError)}`);
        return c.json({
          currentVersion,
          currentHash: "unknown",
          remoteHash: "unknown",
          hasUpdates: false,
          packageLockChanged: false,
          error: "업데이트 확인에 실패했습니다",
        });
      }
    } catch (error: unknown) {
      return c.json({ error: `버전 정보 조회 실패: ${getErrorMessage(error)}` }, 500);
    }
  });

  // Perform self-update
  api.post("/api/update", async (c) => {
    try {
      const runningJobs = store.list().filter(job => job.status === "running" || job.status === "queued");
      if (runningJobs.length > 0) {
        return c.json({
          error: "진행 중인 작업이 있어 업데이트를 수행할 수 없습니다",
          runningJobs: runningJobs.map(job => ({ id: job.id, issueNumber: job.issueNumber, repo: job.repo, status: job.status })),
        }, 409);
      }

      const config = loadConfig(process.cwd());
      const selfUpdater = new SelfUpdater(config.git, { cwd: process.cwd() });
      getLogger().info("사용자 요청으로 업데이트 시작");

      const result = await selfUpdater.performSelfUpdate();
      if (result.updated) {
        broadcastToAllClients('updateCompleted', {
          updated: result.updated,
          needsRestart: result.needsRestart,
          timestamp: new Date().toISOString()
        });
      }

      return c.json({
        message: result.updated ? "업데이트가 완료되었습니다" : "이미 최신 버전입니다",
        updated: result.updated,
        needsRestart: result.needsRestart,
      });
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      getLogger().error(`업데이트 실패: ${message}`);
      broadcastToAllClients('updateFailed', {
        error: message,
        timestamp: new Date().toISOString()
      });
      return c.json({ error: `업데이트 실패: ${message}` }, 500);
    }
  });

  return api;
}
