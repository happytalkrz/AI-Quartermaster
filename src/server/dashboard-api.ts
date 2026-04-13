import { Hono, type Context, type Next } from "hono";
import { randomUUID, timingSafeEqual } from "crypto";
import { readFileSync } from "fs";
import { resolve, normalize, basename } from "path";
import type { JobStore, Job, ListJobsOptions } from "../queue/job-store.js";
import type { JobQueue } from "../queue/job-queue.js";
import { loadConfig, updateConfigSection, addProjectToConfig, removeProjectFromConfig, updateProjectInConfig } from "../config/loader.js";
import { validateConfig } from "../config/validator.js";
import { maskSensitiveConfig } from "../utils/config-masker.js";
import type { ProjectConfig, AQConfig } from "../types/config.js";
import type { ConfigWatcher } from "../config/config-watcher.js";
import type { AutomationScheduler } from "../automation/scheduler.js";
import { setGlobalLogLevel, getLogger } from "../utils/logger.js";
import { CreateProjectRequestSchema, UpdateConfigRequestSchema, GetJobsQuerySchema, GetStatsQuerySchema, GetCostsQuerySchema, GetProjectStatsQuerySchema, GetSkipEventsQuerySchema, UpdateJobPriorityRequestSchema, UpdateProjectRequestSchema, formatZodError, type HealthCheckResponse } from "../types/api.js";
import { getJobStats, getCostStats, getProjectSummary, getProjectStatsWithTimeRange } from "../store/queries.js";
import { SelfUpdater } from "../update/self-updater.js";
import { isPathSafe } from "../utils/slug.js";
import { runCli } from "../utils/cli-runner.js";
import { getErrorMessage } from "../utils/error-utils.js";
import { sanitizeErrorMessage } from "../utils/error-sanitizer.js";
import { existsSync, statSync } from "fs";
import { detectProjectCommands, detectBaseBranch } from "../config/project-detector.js";

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
const MAX_SSE_CLIENTS = 50; // Maximum concurrent SSE connections

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

export function getSSEClientCount(): number {
  return sseClients.size;
}

function evictOldestClients(targetCount: number): void {
  if (sseClients.size <= targetCount) return;

  // Sort by connectedAt ascending (oldest first)
  const sorted = [...sseClients.entries()].sort(([, a], [, b]) => a.connectedAt - b.connectedAt);
  const toEvict = sorted.slice(0, sseClients.size - targetCount);

  for (const [clientId, client] of toEvict) {
    try {
      client.controller.close();
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
      message: `Git remote check failed: ${sanitizeErrorMessage(getErrorMessage(error))}`
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
      message: `Local path check failed: ${sanitizeErrorMessage(getErrorMessage(error))}`
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
      message: `Disk space check failed: ${sanitizeErrorMessage(getErrorMessage(error))}`
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
      message: `Dependencies check failed: ${sanitizeErrorMessage(getErrorMessage(error))}`
    };
  }
}

/**
 * Applies runtime configuration changes to system components.
 */
export function applyConfigChanges(oldConfig: AQConfig, newConfig: AQConfig, queue: JobQueue, scheduler?: AutomationScheduler): void {
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

  // Update automation rules in scheduler
  if (scheduler !== undefined) {
    const oldAutomations = oldConfig.automations ?? [];
    const newAutomations = newConfig.automations ?? [];
    if (JSON.stringify(oldAutomations) !== JSON.stringify(newAutomations)) {
      scheduler.updateAutomationRules(newAutomations);
      logger.info(`Automation rules updated: ${oldAutomations.length} → ${newAutomations.length} rules`);
    }
  }
}

const SSE_INITIAL_JOB_LIMIT = 20;

/**
 * Returns jobs for SSE initial state:
 * - Excludes archived jobs
 * - Always includes running/queued jobs (regardless of position)
 * - Fills remaining slots with recent non-active jobs (up to SSE_INITIAL_JOB_LIMIT total)
 */
function getInitialJobs(store: JobStore): Job[] {
  // DB 레벨에서 active job 조회
  const active = store.list({ statuses: ["running", "queued"] });
  const remaining = Math.max(0, SSE_INITIAL_JOB_LIMIT - active.length);
  // 나머지 슬롯은 최근 non-active, non-archived job으로 채움
  const rest = remaining > 0
    ? store.list({ statuses: ["success", "failure", "cancelled"], limit: remaining })
    : [];
  return [...active, ...rest];
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
      const expected = Buffer.from(`Bearer ${apiKey}`);
      const actual = Buffer.from(auth ?? "");
      if (!auth || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
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
      const expected = Buffer.from(`Bearer ${apiKey}`);
      const actual = Buffer.from(auth ?? "");
      if (!auth || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      await next();
    };

    api.use("/api/jobs", bearerAuth);
    api.use("/api/jobs/*", bearerAuth);
    api.use("/api/stats", bearerAuth);
    api.use("/api/stats/costs", bearerAuth);
    api.use("/api/stats/projects", bearerAuth);
    api.use("/api/config", bearerAuth);
    api.use("/api/projects", bearerAuth);
    api.use("/api/projects/*", bearerAuth);
    api.use("/api/version", bearerAuth);
    api.use("/api/update", bearerAuth);
    api.use("/api/health", bearerAuth);
    api.use("/api/skip-events", bearerAuth);
    api.use("/api/skip-events/*", bearerAuth);

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
  } else {
    // apiKey 미설정: 로컬 환경에서는 모든 API 허용
    getLogger().info(
      "Dashboard API key is not configured. All endpoints are accessible without authentication."
    );
  }

  // Get configuration (masked for security)
  api.get("/api/config", (c) => {
    try {
      const projectRoot = process.cwd();
      const config = loadConfig(projectRoot);
      const maskedConfig = maskSensitiveConfig(config);
      return c.json({ config: maskedConfig });
    } catch (error: unknown) {
      return c.json({ error: `Failed to load configuration: ${sanitizeErrorMessage(getErrorMessage(error))}` }, 500);
    }
  });

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
          details: formatZodError(parseResult.error)
        }, 400);
      }

      // Update configuration file
      // Filter out undefined values and complex sections (projects, hooks)
      // that should not be updated via this endpoint
      const { projects, hooks, ...safeData } = parseResult.data as Record<string, unknown>;
      const cleanedData = Object.fromEntries(
        Object.entries(safeData).map(([key, value]) => [
          key,
          typeof value === 'object' && value !== null
            ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined))
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
          logger.warn(`Failed to apply runtime config changes: ${getErrorMessage(runtimeError)}`);
        }
      }

      return c.json({ success: true, message: "Configuration updated successfully" });
    } catch (error: unknown) {
      const rawMessage = getErrorMessage(error);
      const isValidationError = rawMessage.includes("validation") || rawMessage.includes("Invalid") || rawMessage.includes("not found");
      const status = isValidationError ? 400 : 500;
      const prefix = isValidationError ? "Configuration validation failed" : "Failed to update configuration";
      return c.json({ error: `${prefix}: ${sanitizeErrorMessage(rawMessage)}` }, status);
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

      const projects = config.projects.map(project => ({
        ...project,
        errorState: queue.getProjectStatus(project.repo),
      }));

      return c.json({ projects });
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
          details: formatZodError(parseResult.error)
        }, 400);
      }

      const { repo, path, baseBranch, mode, commands } = parseResult.data;

      // Validate and normalize path
      let normalizedPath: string;
      try {
        normalizedPath = validateAndNormalizePath(path, "path");
      } catch (error: unknown) {
        return c.json({ error: sanitizeErrorMessage(getErrorMessage(error)) }, 400);
      }

      // Auto-detect commands and baseBranch if not explicitly provided
      const detection = detectProjectCommands(normalizedPath);
      const resolvedBaseBranch = baseBranch?.trim() || await detectBaseBranch(normalizedPath);

      const project: ProjectConfig = {
        repo: repo.trim(),
        path: normalizedPath,
        baseBranch: resolvedBaseBranch,
        mode,
        commands: commands ?? detection.commands,
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
        return c.json({ error: `Configuration validation failed: ${sanitizeErrorMessage(getErrorMessage(error))}` }, 400);
      }

      return c.json({
        message: "Project added successfully",
        project,
        detectedLanguage: detection.language,
      }, 201);
    } catch (error: unknown) {
      return c.json({ error: `Failed to add project: ${sanitizeErrorMessage(getErrorMessage(error))}` }, 500);
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
        return c.json({ error: `Failed to load configuration: ${sanitizeErrorMessage(getErrorMessage(error))}` }, 500);
      }

      removeProjectFromConfig(configPath, repo);

      try {
        validateConfig(loadConfig(projectRoot));
      } catch (error: unknown) {
        return c.json({ error: `Configuration validation failed: ${sanitizeErrorMessage(getErrorMessage(error))}` }, 400);
      }

      return c.json({
        message: "Project removed successfully",
        repo
      });
    } catch (error: unknown) {
      return c.json({ error: `Failed to remove project: ${sanitizeErrorMessage(getErrorMessage(error))}` }, 500);
    }
  });

  // Update project in configuration
  api.put("/api/projects/:repo", async (c) => {
    try {
      const repo = decodeURIComponent(c.req.param("repo"));

      if (!repo || repo.trim() === "") {
        return c.json({ error: "repo parameter is required" }, 400);
      }

      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }

      const parseResult = UpdateProjectRequestSchema.safeParse(body);
      if (!parseResult.success) {
        return c.json({
          error: "Invalid request body",
          details: formatZodError(parseResult.error)
        }, 400);
      }

      // Validate that project exists
      try {
        const currentConfig = loadConfig(projectRoot);
        if (!currentConfig.projects?.find(p => p.repo === repo)) {
          return c.json({ error: `Project "${repo}" not found` }, 404);
        }
      } catch (error: unknown) {
        return c.json({ error: `Failed to load configuration: ${sanitizeErrorMessage(getErrorMessage(error))}` }, 500);
      }

      const { path, baseBranch, mode, commands } = parseResult.data;
      const updates: Partial<Pick<ProjectConfig, 'path' | 'baseBranch' | 'mode' | 'commands'>> = {};

      if (path !== undefined) {
        try {
          updates.path = validateAndNormalizePath(path, "path");
        } catch (error: unknown) {
          return c.json({ error: sanitizeErrorMessage(getErrorMessage(error)) }, 400);
        }
      }

      if (baseBranch !== undefined) {
        updates.baseBranch = baseBranch?.trim() || undefined;
      }

      if (mode !== undefined) {
        updates.mode = mode ?? undefined;
      }

      if (commands !== undefined) {
        updates.commands = commands;
      }

      // Check if any fields to update
      if (Object.keys(updates).length === 0) {
        return c.json({ error: "No valid fields to update" }, 400);
      }

      updateProjectInConfig(configPath, repo, updates);

      try {
        validateConfig(loadConfig(projectRoot));
      } catch (error: unknown) {
        return c.json({ error: `Configuration validation failed: ${sanitizeErrorMessage(getErrorMessage(error))}` }, 400);
      }

      return c.json({
        message: "Project updated successfully",
        repo,
        updates
      });
    } catch (error: unknown) {
      return c.json({ error: `Failed to update project: ${sanitizeErrorMessage(getErrorMessage(error))}` }, 500);
    }
  });

  // Get project error state
  api.get("/api/projects/:repo/error-state", (c) => {
    try {
      const repo = decodeURIComponent(c.req.param("repo"));

      if (!repo || repo.trim() === "") {
        return c.json({ error: "repo parameter is required" }, 400);
      }

      const errorState = queue.getProjectStatus(repo);
      return c.json({ repo, errorState });
    } catch (error: unknown) {
      return c.json({ error: `Failed to get error state: ${sanitizeErrorMessage(getErrorMessage(error))}` }, 500);
    }
  });

  // Manually pause a project
  api.post("/api/projects/:repo/pause", async (c) => {
    try {
      const repo = decodeURIComponent(c.req.param("repo"));

      if (!repo || repo.trim() === "") {
        return c.json({ error: "repo parameter is required" }, 400);
      }

      let durationMs: number | undefined;
      try {
        const body = await c.req.json() as Record<string, unknown>;
        if (body.durationMs !== undefined) {
          if (typeof body.durationMs !== "number" || body.durationMs <= 0) {
            return c.json({ error: "durationMs must be a positive number" }, 400);
          }
          durationMs = body.durationMs;
        }
      } catch {
        // No body or invalid JSON — use default
      }

      // Default: 30 minutes
      const effectiveDuration = durationMs ?? 30 * 60 * 1000;
      queue.pauseProject(repo, effectiveDuration);

      return c.json({
        message: `Project "${repo}" paused for ${Math.round(effectiveDuration / 1000)}s`,
        repo,
        pausedUntil: Date.now() + effectiveDuration,
      });
    } catch (error: unknown) {
      return c.json({ error: `Failed to pause project: ${sanitizeErrorMessage(getErrorMessage(error))}` }, 500);
    }
  });

  // Manually resume a paused project
  api.post("/api/projects/:repo/resume", (c) => {
    try {
      const repo = decodeURIComponent(c.req.param("repo"));

      if (!repo || repo.trim() === "") {
        return c.json({ error: "repo parameter is required" }, 400);
      }

      queue.resumeProject(repo);
      return c.json({ message: `Project "${repo}" resumed`, repo });
    } catch (error: unknown) {
      return c.json({ error: `Failed to resume project: ${sanitizeErrorMessage(getErrorMessage(error))}` }, 500);
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
          details: formatZodError(parseResult.error)
        }, 400);
      }

      const { project, status, limit, offset } = parseResult.data;

      // DB 레벨 필터 옵션 구성
      const baseOptions: ListJobsOptions = {};
      if (!includeArchived) baseOptions.excludeStatus = "archived";
      if (project) baseOptions.repo = project;

      // API status → 내부 JobStatus 매핑
      if (status === "pending") {
        baseOptions.status = "queued";
      } else if (status === "running") {
        baseOptions.status = "running";
      } else if (status === "completed") {
        baseOptions.status = "success";
      } else if (status === "failed") {
        baseOptions.statuses = ["failure", "cancelled"];
      }

      // DB 레벨에서 총 개수 조회 (페이지네이션 없이)
      const totalJobs = store.list(baseOptions).length;

      // DB 레벨에서 페이지네이션 적용하여 결과 조회
      const jobs = store.list({ ...baseOptions, limit, offset });

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
      return c.json({ error: `Failed to fetch jobs: ${sanitizeErrorMessage(getErrorMessage(error))}` }, 500);
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

  // Update job priority
  api.put("/api/jobs/:id/priority", async (c) => {
    const id = c.req.param("id");
    const job = store.get(id);
    if (!job) return c.json({ error: "Job not found" }, 404);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parseResult = UpdateJobPriorityRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json({ error: "Invalid request body", details: formatZodError(parseResult.error) }, 400);
    }

    const { priority } = parseResult.data;
    const updatedJob = store.update(id, { priority });
    if (!updatedJob) return c.json({ error: "Failed to update priority" }, 500);

    broadcastToAllClients("job-updated", updatedJob);
    return c.json(updatedJob);
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

  // Skip events stats (reasonCode별 집계)
  api.get("/api/skip-events/stats", (c) => {
    try {
      const repo = c.req.query("repo");
      const allEvents = store.listSkipEvents(repo ? { repo } : undefined);

      const reasonCodeCounts: Record<string, number> = {};
      for (const event of allEvents) {
        reasonCodeCounts[event.reasonCode] = (reasonCodeCounts[event.reasonCode] ?? 0) + 1;
      }

      const stats = Object.entries(reasonCodeCounts)
        .map(([reasonCode, count]) => ({ reasonCode, count }))
        .sort((a, b) => b.count - a.count);

      return c.json({ total: allEvents.length, stats });
    } catch (error: unknown) {
      return c.json({ error: `Failed to fetch skip event stats: ${sanitizeErrorMessage(getErrorMessage(error))}` }, 500);
    }
  });

  // List skip events
  api.get("/api/skip-events", (c) => {
    try {
      const queryParams = {
        repo: c.req.query("repo"),
        limit: c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : undefined,
        offset: c.req.query("offset") ? parseInt(c.req.query("offset")!, 10) : undefined,
      };

      const parseResult = GetSkipEventsQuerySchema.safeParse(queryParams);
      if (!parseResult.success) {
        return c.json({
          error: "Invalid query parameters",
          details: formatZodError(parseResult.error)
        }, 400);
      }

      const { repo, limit, offset } = parseResult.data;
      const allEvents = store.listSkipEvents(repo ? { repo } : undefined);
      const total = allEvents.length;
      const start = offset ?? 0;
      const end = limit !== undefined ? start + limit : total;
      const events = allEvents.slice(start, end);

      return c.json({
        events,
        pagination: {
          total,
          offset: start,
          limit: limit ?? total,
          hasMore: end < total,
        }
      });
    } catch (error: unknown) {
      return c.json({ error: `Failed to fetch skip events: ${sanitizeErrorMessage(getErrorMessage(error))}` }, 500);
    }
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
          details: formatZodError(parseResult.error)
        }, 400);
      }

      const stats = getJobStats(store.getAqDb(), parseResult.data);
      return c.json(stats);
    } catch (error: unknown) {
      return c.json({ error: `Failed to fetch stats: ${sanitizeErrorMessage(getErrorMessage(error))}` }, 500);
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
          details: formatZodError(parseResult.error)
        }, 400);
      }

      const costs = getCostStats(store.getAqDb(), parseResult.data);
      return c.json(costs);
    } catch (error: unknown) {
      return c.json({ error: `Failed to fetch cost stats: ${sanitizeErrorMessage(getErrorMessage(error))}` }, 500);
    }
  });

  // Project stats (success rate + cost per project)
  api.get("/api/stats/projects", (c) => {
    try {
      const queryParams = {
        timeRange: c.req.query("timeRange") || "7d",
      };

      const parseResult = GetProjectStatsQuerySchema.safeParse(queryParams);
      if (!parseResult.success) {
        return c.json({
          error: "Invalid query parameters",
          details: parseResult.error
        }, 400);
      }

      const stats = getProjectStatsWithTimeRange(store.getAqDb(), parseResult.data);
      return c.json(stats);
    } catch (error: unknown) {
      return c.json({ error: `Failed to fetch project stats: ${sanitizeErrorMessage(getErrorMessage(error))}` }, 500);
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
        // Enforce connection limit — evict oldest clients before registering new one
        if (sseClients.size >= MAX_SSE_CLIENTS) {
          evictOldestClients(MAX_SSE_CLIENTS - 1);
        }

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
            const status = queue.getStatus();
            const data = JSON.stringify({ jobs: getInitialJobs(store), queue: status });
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
      } catch (updateError: unknown) {
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
      return c.json({ error: `버전 정보 조회 실패: ${sanitizeErrorMessage(getErrorMessage(error))}` }, 500);
    }
  });

  // Claude profile
  api.get("/api/claude-profile", async (c) => {
    const configDir = process.env.CLAUDE_CONFIG_DIR || "";
    const profile = configDir ? basename(configDir).replace(/^\.claude-?/, "") || "default" : "default";
    const config = loadConfig(projectRoot);
    const models = config.commands.claudeCli.models;

    let cliVersion = "unknown";
    try {
      const result = await runCli(config.commands.claudeCli.path, ["--version"], { timeout: 5000 });
      if (result.exitCode === 0) cliVersion = result.stdout.trim();
    } catch { /* ignore */ }

    return c.json({
      profile,
      configDir,
      cliVersion,
      model: config.commands.claudeCli.model,
      models: {
        plan: models?.plan,
        phase: models?.phase,
        review: models?.review,
        fallback: models?.fallback,
      },
      maxTurns: config.commands.claudeCli.maxTurns,
      timeout: config.commands.claudeCli.timeout,
    });
  });

  // Perform self-update
  api.post("/api/update", async (c) => {
    try {
      const activeJobs = store.list().filter(job => job.status === "running" || job.status === "queued");
      if (activeJobs.length > 0) {
        getLogger().info(`업데이트 전 진행 중인 잡 ${activeJobs.length}개 취소 중`);
        for (const job of activeJobs) {
          queue.cancel(job.id);
          getLogger().info(`잡 취소: ${job.id} (이슈 #${job.issueNumber}, 상태: ${job.status})`);
        }
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
      const rawMessage = getErrorMessage(error);
      getLogger().error(`업데이트 실패: ${rawMessage}`);
      const message = sanitizeErrorMessage(rawMessage);
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
          const [gitRemoteCheck, localPathCheck, diskSpaceCheck, dependenciesCheck, worktreeCount] = await Promise.all([
            checkGitRemoteAccess(projectPath, gitPath),
            checkLocalPath(projectPath),
            checkDiskSpace(projectPath),
            checkDependencies(projectPath),
            runCli(gitPath, ["worktree", "list", "--porcelain"], { cwd: projectPath }).then(result =>
              result.exitCode === 0 ? result.stdout.trim().split('\n').filter(line => line.startsWith('worktree ')).length : 0
            ).catch(() => 0), // Fall back to 0 if git worktree fails
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
            worktreeCount,
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
      return c.json({ error: `Projects health check failed: ${sanitizeErrorMessage(getErrorMessage(error))}` }, 500);
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
      return c.json({ error: `Health check failed: ${sanitizeErrorMessage(getErrorMessage(error))}` }, 500);
    }
  });

  return api;
}
