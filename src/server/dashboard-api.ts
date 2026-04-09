import { Hono, type Context, type Next } from "hono";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { resolve, normalize } from "path";
import type { JobStore, Job } from "../queue/job-store.js";
import type { JobQueue } from "../queue/job-queue.js";
import { loadConfig, updateConfigSection, addProjectToConfig, removeProjectFromConfig, updateProjectInConfig } from "../config/loader.js";
import { validateConfig } from "../config/validator.js";
import { maskSensitiveConfig } from "../utils/config-masker.js";
import type { ProjectConfig, AQConfig } from "../types/config.js";
import type { ConfigWatcher } from "../config/config-watcher.js";
import { setGlobalLogLevel, getLogger } from "../utils/logger.js";
import { CreateProjectRequestSchema, UpdateConfigRequestSchema, GetJobsQuerySchema, GetStatsQuerySchema, GetCostsQuerySchema, type HealthCheckResponse } from "../types/api.js";
import { getJobStats, getCostStats, getProjectSummary } from "../store/queries.js";
import { SelfUpdater } from "../update/self-updater.js";
import { isPathSafe } from "../utils/slug.js";
import { runCli } from "../utils/cli-runner.js";
import { getErrorMessage } from "../utils/error-utils.js";
import { existsSync, statSync } from "fs";

// In-memory session token store: token → expiry timestamp
const sessionTokens = new Map<string, number>();
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

// SSE client management
interface SSEClient {
  id: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  connectedAt: number;
  lastHeartbeat: number;
}


const sseClients = new Map<string, SSEClient>();
const encoder = new TextEncoder();

// Periodic cleanup intervals
let tokenCleanupInterval: ReturnType<typeof setInterval> | undefined;
let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

// Cleanup constants
const TOKEN_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 seconds
const CLIENT_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

function removeStaleClients(): void {
  const now = Date.now();
  const clientsToRemove: string[] = [];

  for (const [clientId, client] of sseClients) {
    if (now - client.lastHeartbeat > CLIENT_TIMEOUT_MS) {
      clientsToRemove.push(clientId);
    }
  }

  for (const clientId of clientsToRemove) {
    try {
      const client = sseClients.get(clientId);
      client?.controller.close();
    } catch {
      // Ignore errors when closing already closed streams
    }
    sseClients.delete(clientId);
  }
}

function broadcastToAllClients(event: string, data: unknown): void {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const now = Date.now();
  const clientsToRemove: string[] = [];

  for (const [clientId, client] of sseClients) {
    if (now - client.lastHeartbeat > CLIENT_TIMEOUT_MS) {
      clientsToRemove.push(clientId);
      continue;
    }

    try {
      client.controller.enqueue(encoder.encode(message));
      client.lastHeartbeat = now;
    } catch {
      clientsToRemove.push(clientId);
    }
  }

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

function sendHeartbeat(): void {
  const heartbeatMessage = `event: heartbeat\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`;
  const clientsToRemove: string[] = [];

  for (const [clientId, client] of sseClients) {
    try {
      client.controller.enqueue(encoder.encode(heartbeatMessage));
    } catch {
      clientsToRemove.push(clientId);
    }
  }

  for (const clientId of clientsToRemove) {
    sseClients.delete(clientId);
  }
}

function startPeriodicCleanup(): void {
  // Stop existing intervals if any
  stopPeriodicCleanup();

  // Start token cleanup interval
  tokenCleanupInterval = setInterval(() => {
    pruneExpiredTokens();
  }, TOKEN_CLEANUP_INTERVAL_MS);

  // Start heartbeat interval
  heartbeatInterval = setInterval(() => {
    sendHeartbeat();
    removeStaleClients();
  }, HEARTBEAT_INTERVAL_MS);
}

export function stopPeriodicCleanup(): void {
  if (tokenCleanupInterval) {
    clearInterval(tokenCleanupInterval);
    tokenCleanupInterval = undefined;
  }
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = undefined;
  }
}

/**
 * Clean up all active SSE clients by closing their connections.
 */
export function cleanupAllSSEClients(): void {
  for (const [, client] of sseClients) {
    try {
      client.controller.close();
    } catch {
      // Ignore errors when closing already closed streams
    }
  }
  sseClients.clear();
}

/**
 * Comprehensive cleanup function for dashboard resources.
 * Should be called when the server is shutting down.
 */
export function cleanupDashboardResources(): void {
  stopPeriodicCleanup();
  cleanupAllSSEClients();
  sessionTokens.clear();
}

function isValidSessionToken(token: string): boolean {
  pruneExpiredTokens();
  const expiry = sessionTokens.get(token);
  return expiry !== undefined && Date.now() <= expiry;
}

/**
 * Validates and normalizes path parameters to prevent path traversal attacks.
 */
function validateAndNormalizePath(path: string, paramName: string): string {
  if (!path || typeof path !== 'string') {
    throw new Error(`${paramName} is required and must be a string`);
  }

  const trimmedPath = path.trim();

  // Check for path safety BEFORE normalization to catch patterns that normalize() might clean up
  if (!isPathSafe(trimmedPath)) {
    throw new Error(`${paramName} contains unsafe characters or path traversal patterns`);
  }

  // Normalize path after safety check
  const normalizedPath = normalize(trimmedPath);

  return normalizedPath;
}

/**
 * Health check helper functions
 */
async function checkGitRemoteAccess(projectPath: string, gitPath: string): Promise<{ status: "ok" | "error"; message?: string }> {
  try {
    const result = await runCli(gitPath, ["ls-remote", "--heads", "origin"], { cwd: projectPath, timeout: 10000 });
    if (result.exitCode !== 0) {
      return {
        status: "error",
        message: `Git remote not accessible: ${result.stderr || "Cannot connect to remote"}`
      };
    }
    return { status: "ok" };
  } catch (error: unknown) {
    return {
      status: "error",
      message: `Git remote check failed: ${getErrorMessage(error)}`
    };
  }
}

async function checkLocalPath(projectPath: string): Promise<{ status: "ok" | "error"; message?: string }> {
  try {
    if (!existsSync(projectPath)) {
      return { status: "error", message: "Project path does not exist" };
    }

    const stats = statSync(projectPath);
    if (!stats.isDirectory()) {
      return { status: "error", message: "Project path is not a directory" };
    }

    return { status: "ok" };
  } catch (error: unknown) {
    return {
      status: "error",
      message: `Local path check failed: ${getErrorMessage(error)}`
    };
  }
}

async function checkDiskSpace(projectPath: string): Promise<{ status: "ok" | "warning" | "error"; message?: string; freeBytes?: number }> {
  try {
    const result = await runCli("df", ["-B1", projectPath], { timeout: 5000 });
    if (result.exitCode !== 0) {
      return { status: "warning", message: "Could not check disk space" };
    }

    const lines = result.stdout.trim().split('\n');
    if (lines.length < 2) {
      return { status: "warning", message: "Could not parse disk space output" };
    }

    const parts = lines[1].split(/\s+/);
    const available = parseInt(parts[3] || "0", 10);

    if (available === 0) {
      return { status: "error", message: "No free disk space", freeBytes: available };
    } else if (available < 1024 * 1024 * 1024) { // Less than 1GB
      return { status: "warning", message: "Low disk space (< 1GB)", freeBytes: available };
    }

    return { status: "ok", freeBytes: available };
  } catch (error: unknown) {
    return {
      status: "warning",
      message: `Disk space check failed: ${getErrorMessage(error)}`
    };
  }
}

async function checkDependencies(projectPath: string): Promise<{ status: "ok" | "warning" | "error"; message?: string }> {
  try {
    // Check if package.json exists
    const packageJsonPath = resolve(projectPath, "package.json");
    if (!existsSync(packageJsonPath)) {
      return { status: "warning", message: "No package.json found" };
    }

    // Check if node_modules exists
    const nodeModulesPath = resolve(projectPath, "node_modules");
    if (!existsSync(nodeModulesPath)) {
      return { status: "warning", message: "Dependencies not installed (no node_modules)" };
    }

    return { status: "ok" };
  } catch (error: unknown) {
    return {
      status: "error",
      message: `Dependencies check failed: ${getErrorMessage(error)}`
    };
  }
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

  // Update per-project concurrency limits
  const oldProjects = new Map((oldConfig.projects ?? []).map(p => [p.repo, p.concurrency ?? null]));
  const newProjects = new Map((newConfig.projects ?? []).map(p => [p.repo, p.concurrency ?? null]));

  for (const [repo, newLimit] of newProjects) {
    const oldLimit = oldProjects.get(repo) ?? null;
    if (newLimit !== oldLimit) {
      queue.setProjectConcurrency(repo, newLimit);
      logger.info(`Project concurrency updated for ${repo}: ${oldLimit ?? "unlimited"} → ${newLimit ?? "unlimited"}`);
    }
  }

  // Remove limits for projects that were removed from config
  for (const [repo] of oldProjects) {
    if (!newProjects.has(repo)) {
      queue.setProjectConcurrency(repo, null);
      logger.info(`Project concurrency limit removed for ${repo} (project removed from config)`);
    }
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
    api.use("/api/stats/costs", bearerAuth);
    api.use("/api/config", bearerAuth);
    api.use("/api/projects", bearerAuth);
    api.use("/api/projects/*", bearerAuth);
    api.use("/api/version", bearerAuth);
    api.use("/api/update", bearerAuth);
    api.use("/api/health", bearerAuth);

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
            ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined))
            : value
        ]).filter(([, v]) => v !== undefined)
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

  // Get projects list
  api.get("/api/projects", (c) => {
    try {
      const projectRoot = process.cwd();
      const config = loadConfig(projectRoot);

      if (!config.projects || config.projects.length === 0) {
        return c.json({ projects: [] });
      }

      return c.json({ projects: config.projects });
    } catch (error: unknown) {
      const logger = getLogger();
      logger.error(`Failed to load projects: ${getErrorMessage(error)}`);
      return c.json({ error: "Failed to load projects" }, 500);
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

      // Validate and normalize path
      let normalizedPath: string;
      try {
        normalizedPath = validateAndNormalizePath(path, "path");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Invalid path";
        return c.json({ error: message }, 400);
      }

      const project: ProjectConfig = {
        repo: repo.trim(),
        path: normalizedPath,
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
        try {
          updates.path = validateAndNormalizePath(path, "path");
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Invalid path";
          return c.json({ error: message }, 400);
        }
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
    try {
      // Parse query parameters using Zod schema
      const queryParamsForValidation = {
        project: c.req.query("project"),
        status: c.req.query("status"),
        limit: c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : undefined,
        offset: c.req.query("offset") ? parseInt(c.req.query("offset")!, 10) : undefined,
      };
      const includeArchived = c.req.query("include") === "archived";

      // Validate query parameters (excluding the legacy 'include' parameter)
      const parseResult = GetJobsQuerySchema.safeParse(queryParamsForValidation);
      if (!parseResult.success) {
        return c.json({
          error: "Invalid query parameters",
          details: parseResult.error
        }, 400);
      }

      const { project, status, limit, offset } = parseResult.data;

      // Get base job list
      let jobs = includeArchived ? store.list() : store.list().filter(j => j.status !== "archived");

      // Apply project filter
      if (project) {
        jobs = jobs.filter(j => j.repo === project);
      }

      // Apply status filter
      if (status) {
        jobs = jobs.filter(j => {
          // Map internal status to API status
          switch (status) {
            case "pending":
              return j.status === "queued";
            case "running":
              return j.status === "running";
            case "completed":
              return j.status === "success";
            case "failed":
              return j.status === "failure" || j.status === "cancelled";
            default:
              return false;
          }
        });
      }

      // Apply pagination
      const totalJobs = jobs.length;
      if (offset !== undefined) {
        jobs = jobs.slice(offset);
      }
      if (limit !== undefined) {
        jobs = jobs.slice(0, limit);
      }

      const queueStatus = queue.getStatus();
      return c.json({
        jobs,
        queue: queueStatus,
        pagination: {
          total: totalJobs,
          offset: offset ?? 0,
          limit: limit ?? totalJobs,
          hasMore: (offset ?? 0) + (limit ?? totalJobs) < totalJobs
        }
      });
    } catch (error: unknown) {
      return c.json({ error: `Failed to fetch jobs: ${getErrorMessage(error)}` }, 500);
    }
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
    try {
      const queryParams = {
        project: c.req.query("project"),
        timeRange: c.req.query("timeRange") || "7d",
      };

      const parseResult = GetStatsQuerySchema.safeParse(queryParams);
      if (!parseResult.success) {
        return c.json({
          error: "Invalid query parameters",
          details: parseResult.error
        }, 400);
      }

      const stats = getJobStats(store.getAqDb(), parseResult.data);
      return c.json(stats);
    } catch (error: unknown) {
      return c.json({ error: `Failed to fetch stats: ${getErrorMessage(error)}` }, 500);
    }
  });

  // Cost stats
  api.get("/api/stats/costs", (c) => {
    try {
      const queryParams = {
        project: c.req.query("project"),
        timeRange: c.req.query("timeRange") || "30d",
        groupBy: c.req.query("groupBy") || "project",
      };

      const parseResult = GetCostsQuerySchema.safeParse(queryParams);
      if (!parseResult.success) {
        return c.json({
          error: "Invalid query parameters",
          details: parseResult.error
        }, 400);
      }

      const costs = getCostStats(store.getAqDb(), parseResult.data);
      return c.json(costs);
    } catch (error: unknown) {
      return c.json({ error: `Failed to fetch cost stats: ${getErrorMessage(error)}` }, 500);
    }
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
  api.get("/api/events", (_c) => {
    const clientId = randomUUID();
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const stream = new ReadableStream({
      start(controller) {
        // Register client with timestamps
        const now = Date.now();
        sseClients.set(clientId, {
          id: clientId,
          controller,
          connectedAt: now,
          lastHeartbeat: now
        });

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

  // Start periodic cleanup when dashboard routes are created
  startPeriodicCleanup();

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

  // Repositories API - project-level aggregated information with health and stats
  api.get("/api/repositories", async (c) => {
    try {
      const config = loadConfig(process.cwd());
      const projects = config.projects ?? [];

      if (projects.length === 0) {
        return c.json({
          repositories: [],
          summary: { total: 0, healthy: 0, warning: 0, error: 0, totalJobs: 0, checkedAt: new Date().toISOString() },
        });
      }

      const gitPath = config.git?.gitPath ?? "git";

      // Get health checks for all projects in parallel
      const healthResults = await Promise.all(
        projects.map(async (projectConfig) => {
          const projectPath = resolve(process.cwd(), projectConfig.path);
          const [gitRemoteCheck, localPathCheck, diskSpaceCheck, dependenciesCheck] = await Promise.all([
            checkGitRemoteAccess(projectPath, gitPath),
            checkLocalPath(projectPath),
            checkDiskSpace(projectPath),
            checkDependencies(projectPath),
          ]);

          let overallStatus: "healthy" | "warning" | "error" = "healthy";
          if (gitRemoteCheck.status === "error" || localPathCheck.status === "error") {
            overallStatus = "error";
          } else if (
            diskSpaceCheck.status === "warning" || diskSpaceCheck.status === "error" ||
            dependenciesCheck.status === "warning" || dependenciesCheck.status === "error"
          ) {
            overallStatus = "warning";
          }

          return {
            repository: projectConfig.repo,
            name: projectConfig.repo,
            path: projectConfig.path,
            status: overallStatus,
            health: {
              gitRemoteAccess: gitRemoteCheck,
              localPath: localPathCheck,
              diskSpace: diskSpaceCheck,
              dependencies: dependenciesCheck,
            },
            lastChecked: new Date().toISOString(),
          };
        })
      );

      // Get project statistics
      const projectStats = getProjectSummary(store.getAqDb());
      const statsMap = new Map(projectStats.map(s => [s.repo, s]));

      // Combine health results with statistics
      const repositories = healthResults.map(result => {
        const stats = statsMap.get(result.repository) ?? {
          repo: result.repository,
          total: 0,
          successCount: 0,
          failureCount: 0,
          totalCostUsd: 0,
          successRate: 0,
          lastActivity: null,
        };

        return {
          ...result,
          stats: {
            totalJobs: stats.total,
            successJobs: stats.successCount,
            failedJobs: stats.failureCount,
            successRate: stats.successRate,
            totalCostUsd: stats.totalCostUsd,
            lastActivity: stats.lastActivity,
          },
        };
      });

      const summary = {
        total: repositories.length,
        healthy: repositories.filter(r => r.status === "healthy").length,
        warning: repositories.filter(r => r.status === "warning").length,
        error: repositories.filter(r => r.status === "error").length,
        totalJobs: repositories.reduce((sum, r) => sum + r.stats.totalJobs, 0),
        checkedAt: new Date().toISOString(),
      };

      return c.json({ repositories, summary });
    } catch (error: unknown) {
      const logger = getLogger();
      logger.error(`Failed to fetch repositories: ${getErrorMessage(error)}`);
      return c.json({ error: "Failed to fetch repositories" }, 500);
    }
  });

  // Projects health check endpoint — all configured projects
  api.get("/api/projects/health", async (c) => {
    try {
      const config = loadConfig(process.cwd());
      const projects = config.projects ?? [];

      if (projects.length === 0) {
        return c.json({
          projects: [],
          summary: { total: 0, healthy: 0, warning: 0, error: 0, checkedAt: new Date().toISOString() },
        });
      }

      const gitPath = config.git?.gitPath ?? "git";

      const healthResults = await Promise.all(
        projects.map(async (projectConfig) => {
          const projectPath = resolve(process.cwd(), projectConfig.path);
          const [gitRemoteCheck, localPathCheck, diskSpaceCheck, dependenciesCheck] = await Promise.all([
            checkGitRemoteAccess(projectPath, gitPath),
            checkLocalPath(projectPath),
            checkDiskSpace(projectPath),
            checkDependencies(projectPath),
          ]);

          let overallStatus: "healthy" | "warning" | "error" = "healthy";
          if (gitRemoteCheck.status === "error" || localPathCheck.status === "error") {
            overallStatus = "error";
          } else if (
            diskSpaceCheck.status === "warning" || diskSpaceCheck.status === "error" ||
            dependenciesCheck.status === "warning" || dependenciesCheck.status === "error"
          ) {
            overallStatus = "warning";
          }

          return {
            project: projectConfig.repo,
            status: overallStatus,
            checks: {
              gitRemoteAccess: gitRemoteCheck,
              localPath: localPathCheck,
              diskSpace: diskSpaceCheck,
              dependencies: dependenciesCheck,
            },
            lastChecked: new Date().toISOString(),
          };
        })
      );

      const projectStats = getProjectSummary(store.getAqDb());
      const statsMap = new Map(projectStats.map(s => [s.repo, s]));

      const projectsWithStats = healthResults.map(result => ({
        ...result,
        stats: statsMap.get(result.project) ?? null,
      }));

      const summary = {
        total: projectsWithStats.length,
        healthy: projectsWithStats.filter(p => p.status === "healthy").length,
        warning: projectsWithStats.filter(p => p.status === "warning").length,
        error: projectsWithStats.filter(p => p.status === "error").length,
        checkedAt: new Date().toISOString(),
      };

      return c.json({ projects: projectsWithStats, summary });
    } catch (error: unknown) {
      return c.json({ error: `Projects health check failed: ${getErrorMessage(error)}` }, 500);
    }
  });

  // Health check endpoint
  api.get("/api/health", async (c) => {
    try {
      const projectParam = c.req.query("project");
      if (!projectParam) {
        return c.json({ error: "project parameter is required" }, 400);
      }

      const project = decodeURIComponent(projectParam);

      // Load configuration to get project path and git settings
      const config = loadConfig(process.cwd());
      const projectConfig = config.projects?.find(p => p.repo === project);

      if (!projectConfig) {
        return c.json({ error: `Project "${project}" not found in configuration` }, 404);
      }

      const projectPath = resolve(process.cwd(), projectConfig.path);
      const gitPath = config.git?.gitPath || "git";

      // Run health checks in parallel
      const [gitRemoteCheck, localPathCheck, diskSpaceCheck, dependenciesCheck] = await Promise.all([
        checkGitRemoteAccess(projectPath, gitPath),
        checkLocalPath(projectPath),
        checkDiskSpace(projectPath),
        checkDependencies(projectPath)
      ]);

      // Determine overall status
      let overallStatus: "healthy" | "warning" | "error" = "healthy";

      if (gitRemoteCheck.status === "error" || localPathCheck.status === "error") {
        overallStatus = "error";
      } else if (diskSpaceCheck.status === "warning" || diskSpaceCheck.status === "error" ||
                 dependenciesCheck.status === "warning" || dependenciesCheck.status === "error") {
        overallStatus = "warning";
      }

      const healthResponse: HealthCheckResponse = {
        project,
        status: overallStatus,
        checks: {
          gitRemoteAccess: gitRemoteCheck,
          localPath: localPathCheck,
          diskSpace: diskSpaceCheck,
          dependencies: dependenciesCheck,
        },
        lastChecked: new Date().toISOString(),
      };

      return c.json(healthResponse);
    } catch (error: unknown) {
      return c.json({ error: `Health check failed: ${getErrorMessage(error)}` }, 500);
    }
  });

  return api;
}
