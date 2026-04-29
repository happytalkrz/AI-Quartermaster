import { Hono, type Context, type Next } from "hono";
import { randomUUID, timingSafeEqual } from "crypto";
import { SessionManager } from "./auth/session.js";
import { LoginRateLimiter } from "./auth/rate-limiter.js";
import { resolve, join } from "path";
import type { JobStore, Job } from "../queue/job-store.js";
import type { JobQueue } from "../queue/job-queue.js";
import { loadConfig } from "../config/loader.js";
import type { AQConfig, DashboardAuthConfig, QuotaStatus } from "../types/config.js";
import type { ConfigWatcher } from "../config/config-watcher.js";
import type { AutomationScheduler } from "../automation/scheduler.js";
import { setGlobalLogLevel, getLogger } from "../utils/logger.js";
import { GetSkipEventsQuerySchema, formatZodError, type HealthCheckResponse } from "../types/api.js";
import { getProjectSummary } from "../store/queries.js";
import type { PatternStore } from "../learning/pattern-store.js";
import { runCli } from "../utils/cli-runner.js";
import { getErrorMessage } from "../utils/error-utils.js";
import { sanitizeErrorMessage } from "../utils/error-sanitizer.js";
import { statusToNotificationType } from "../types/pipeline.js";
import { existsSync, statSync } from "fs";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { ZodError } from "zod";
import { loadTemplate, renderTemplate } from "../prompt/template-renderer.js";
import { SSEManager } from "./sse-manager.js";
import { registerNotificationsRoutes } from "./routes/notifications.js";
import { registerVersionRoutes } from "./routes/version.js";
import { registerProjectsRoutes } from "./routes/projects.js";
import { registerJobsRoutes } from "./routes/jobs.js";
import { registerStatsRoutes } from "./routes/stats.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerSetupRoutes } from "./routes/setup.js";
import { registerDoctorRoutes } from "./routes/doctor.js";

// Session manager: in-memory token store with TTL and periodic pruning
const sessionManager = new SessionManager();

// Rate limiter for POST /api/auth (initialized when createDashboardRoutes is called)
let loginRateLimiter: LoginRateLimiter | undefined;

// Claude quota status — set by daemon startup, refreshed on demand
let currentQuotaStatus: QuotaStatus | null = null;

export function setQuotaStatus(status: QuotaStatus): void {
  currentQuotaStatus = status;
}

export function getQuotaStatus(): QuotaStatus | null {
  return currentQuotaStatus;
}

// SSE 클라이언트 풀과 heartbeat 루프는 SSEManager로 캡슐화 (Plan C #C5).
// dashboard-api는 단일 인스턴스를 보유하고, 외부 export는 위임 함수로 유지한다.
const sseManager = new SSEManager({
  maxClients: 50,
  heartbeatMs: 30_000,
  clientTimeoutMs: 120_000,
});

// Token cleanup interval (sessionManager TTL 가지치기). SSE heartbeat과는 독립.
let tokenCleanupInterval: ReturnType<typeof setInterval> | undefined;
const TOKEN_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function getSSEClientCount(): number {
  return sseManager.clientCount;
}

function broadcastToAllClients(event: string, data: unknown): void {
  sseManager.broadcast(event, data);
}

function startPeriodicCleanup(): void {
  // Stop existing intervals if any
  stopPeriodicCleanup();

  // Token cleanup은 SSE와 독립적으로 운영.
  tokenCleanupInterval = setInterval(() => {
    sessionManager.pruneExpired();
  }, TOKEN_CLEANUP_INTERVAL_MS);

  sseManager.startHeartbeat();
}

export function stopPeriodicCleanup(): void {
  if (tokenCleanupInterval) {
    clearInterval(tokenCleanupInterval);
    tokenCleanupInterval = undefined;
  }
  sseManager.stopHeartbeat();
}

/**
 * Clean up all active SSE clients by closing their connections.
 */
export function cleanupAllSSEClients(): void {
  sseManager.cleanupAll();
}

/**
 * Comprehensive cleanup function for dashboard resources.
 * Should be called when the server is shutting down.
 */
export function cleanupDashboardResources(): void {
  stopPeriodicCleanup();
  cleanupAllSSEClients();
  sessionManager.revokeAll();
  loginRateLimiter?.destroy();
}

function isValidSessionToken(token: string): boolean {
  return sessionManager.validate(token);
}

/**
 * Common validation hook for zValidator middleware.
 * Returns a 400 response with formatted error details when validation fails.
 */
export function zodValidationHook(
  result: { success: true } | { success: false; error: ZodError },
  c: Context
): Response | void {
  if (!result.success) {
    return c.json(
      {
        error: "Invalid request body",
        details: formatZodError(result.error),
      },
      400
    );
  }
}

export { zValidator };

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

const NewIssueRequestSchema = z.object({
  category: z.enum(["bug", "feature", "refactor", "docs"]),
  title: z.string().min(1),
  repo: z.string().min(1),
  what: z.string().min(1),
  where: z.string().default(""),
  how: z.string().default(""),
  files: z.string().default(""),
});

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
export function createDashboardRoutes(store: JobStore, queue: JobQueue, configWatcher?: ConfigWatcher, apiKey?: string, hostname?: string, dashboardAuth?: DashboardAuthConfig, readOnly?: boolean, patternStore?: PatternStore, aqRoot?: string): Hono {
  const rootDir = aqRoot ?? process.cwd();
  const api = new Hono();

  // Initialize rate limiter from config (or defaults)
  const rateLimitCfg = dashboardAuth?.rateLimit ?? {
    maxAttempts: 5,
    windowMs: 900_000,
    blockDurationMs: 900_000,
  };
  loginRateLimiter = new LoginRateLimiter({
    maxAttempts: rateLimitCfg.maxAttempts,
    windowMs: rateLimitCfg.windowMs,
    onExceeded: (ip) => {
      broadcastToAllClients('rateLimitExceeded', { ip, timestamp: Date.now() });
    },
  });

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

  store.on('jobUpdated', (updatedJob: Job, previousJob: Job) => {
    if (previousJob?.status !== updatedJob.status) {
      const notifType = statusToNotificationType(updatedJob.status);
      if (notifType) {
        broadcastToAllClients('notificationCreated', {
          jobId: updatedJob.id,
          type: notifType,
          repo: updatedJob.repo,
          issueNumber: updatedJob.issueNumber,
          timestamp: Date.now(),
        });
      }
    }
  });

  if (apiKey) {
    // POST /api/auth — exchange Bearer key for a short-lived session token
    api.post("/api/auth", (c) => {
      const ip =
        c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
        (c.env as Record<string, unknown> | undefined)?.["remoteAddress"] as string | undefined ??
        "unknown";

      const rateLimitCheck = loginRateLimiter?.checkAndRecord(ip);
      if (rateLimitCheck && !rateLimitCheck.allowed) {
        const retryAfterSec = Math.ceil((rateLimitCheck.retryAfterMs ?? 900_000) / 1000);
        getLogger().warn(`[Auth] Rate limit exceeded for IP ${ip}`);
        return c.json(
          { error: "Too Many Requests" },
          429,
          { "Retry-After": String(retryAfterSec) }
        );
      }

      const auth = c.req.header("Authorization");
      const expected = Buffer.from(`Bearer ${apiKey}`);
      const actual = Buffer.from(auth ?? "");
      if (!auth || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      loginRateLimiter?.reset(ip);
      const { token, expiresIn } = sessionManager.createToken();
      return c.json({ token, expiresIn });
    });

    // Auth middleware for regular (non-SSE) API endpoints — Bearer header only
    // Deny-by-default: all /api/* routes require auth except public and SSE paths
    const bearerAuth = async (c: Context, next: Next) => {
      const path = c.req.path;
      // Public routes — no auth required
      if (path === "/api/auth") {
        await next();
        return;
      }
      // SSE routes — handled by sseTokenAuth or healSseKeyAuth below
      if (
        path === "/api/events" ||
        /^\/api\/jobs\/[^/]+\/logs\/stream$/.test(path) ||
        /^\/api\/doctor\/heal\/[^/]+\/stream$/.test(path)
      ) {
        await next();
        return;
      }
      const auth = c.req.header("Authorization");
      const expected = Buffer.from(`Bearer ${apiKey}`);
      const actual = Buffer.from(auth ?? "");
      if (!auth || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      await next();
    };

    api.use("/api/*", bearerAuth);

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

    // Doctor heal SSE uses raw API key via ?key= query param (EventSource cannot set headers)
    const healSseKeyAuth = async (c: Context, next: Next) => {
      const key = c.req.query("key");
      if (!key) return c.json({ error: "Unauthorized" }, 401);
      const expected = Buffer.from(apiKey);
      const actual = Buffer.from(key);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      await next();
    };
    api.use("/api/doctor/heal/:id/stream", healSseKeyAuth);
  } else {
    // apiKey 미설정: 바인드 호스트에 따라 로그 레벨 분기
    const isLocalBind = !hostname || hostname === "127.0.0.1" || hostname === "localhost";
    if (readOnly) {
      // readOnly 모드: write 엔드포인트에 403 반환
      const readOnlyGuard = async (c: Context, next: Next) => {
        if (c.req.method !== "GET" && c.req.method !== "HEAD") {
          return c.json({ error: "Forbidden: dashboard is in read-only mode" }, 403);
        }
        await next();
      };
      api.use("/api/config", readOnlyGuard);
      api.use("/api/projects", readOnlyGuard);
      api.use("/api/projects/*", readOnlyGuard);
      api.use("/api/jobs/*", readOnlyGuard);
      api.use("/api/update", readOnlyGuard);
      api.use("/api/new-issue", readOnlyGuard);
      getLogger().info(
        "Dashboard is running in read-only mode. Write endpoints are disabled." +
        (!isLocalBind ? " Non-local bind is permitted in read-only mode." : "")
      );
    } else if (isLocalBind) {
      getLogger().info(
        "Dashboard API key is not configured. All endpoints are accessible without authentication."
      );
    } else {
      getLogger().warn(
        "Dashboard API key is not configured. All endpoints are accessible without authentication. " +
        "Non-local bind without API key is a security risk."
      );
    }
  }

  const configPath = `${rootDir}/config.yml`;

  // Config: 도메인 라우트 분할 (Plan C #C9)
  registerConfigRoutes(api, { queue, sseManager, configWatcher, rootDir });

  // Projects: 도메인 라우트 분할 (Plan C #C9)
  registerProjectsRoutes(api, { queue, configWatcher, rootDir, configPath });

  // Jobs CRUD + cancel/priority/retry: 도메인 라우트 분할 (Plan C #C9)
  // (logs/stream은 SSE이므로 별도 처리)
  registerJobsRoutes(api, { store, queue, sseManager });

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

  // List skip events (flat 또는 issueNumber+repo+reasonCode 그룹)
  api.get("/api/skip-events", (c) => {
    try {
      const groupParam = c.req.query("group");
      const queryParams = {
        repo: c.req.query("repo"),
        limit: c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : undefined,
        offset: c.req.query("offset") ? parseInt(c.req.query("offset")!, 10) : undefined,
        group: groupParam === "true" ? true : groupParam === "false" ? false : undefined,
      };

      const parseResult = GetSkipEventsQuerySchema.safeParse(queryParams);
      if (!parseResult.success) {
        return c.json({
          error: "Invalid query parameters",
          details: formatZodError(parseResult.error)
        }, 400);
      }

      const { repo, limit, offset, group } = parseResult.data;

      // 그룹 뷰: 동일 이슈+reasonCode 중복 축약 (기본 대시보드 뷰)
      if (group) {
        const { groups, totalGroups } = store.listSkipEventsGrouped({ repo, limit, offset });
        const start = offset ?? 0;
        const end = limit !== undefined ? start + groups.length : totalGroups;
        return c.json({
          groups,
          pagination: {
            total: totalGroups,
            offset: start,
            limit: limit ?? totalGroups,
            hasMore: end < totalGroups,
          }
        });
      }

      // Flat 뷰 (기존 API 호환)
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

  // 특정 그룹(issueNumber+repo+reasonCode) 전체 삭제
  api.delete("/api/skip-events/group", async (c) => {
    if (readOnly) {
      return c.json({ error: "Read-only mode" }, 403);
    }
    try {
      const body = await c.req.json<{ issueNumber?: unknown; repo?: unknown; reasonCode?: unknown }>();
      const issueNumber = typeof body.issueNumber === "number" ? body.issueNumber : Number(body.issueNumber);
      const repoVal = typeof body.repo === "string" ? body.repo : "";
      const reasonCode = typeof body.reasonCode === "string" ? body.reasonCode : "";
      if (!Number.isInteger(issueNumber) || issueNumber <= 0 || !repoVal || !reasonCode) {
        return c.json({ error: "issueNumber, repo, reasonCode 필수" }, 400);
      }
      const deleted = store.deleteSkipEventsByGroup(issueNumber, repoVal, reasonCode);
      return c.json({ deleted });
    } catch (error: unknown) {
      return c.json({ error: `Failed to delete skip event group: ${sanitizeErrorMessage(getErrorMessage(error))}` }, 500);
    }
  });

  // Stats + metrics: 도메인 라우트 분할 (Plan C #C9)
  registerStatsRoutes(api, { store, patternStore });

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

  // SSE endpoint for real-time updates
  api.get("/api/events", (_c) => {
    const clientId = randomUUID();
    const encoder = new TextEncoder();
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const stream = new ReadableStream({
      start(controller) {
        sseManager.addClient(controller, clientId);

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
          sseManager.removeClient(clientId);
        }, 300000);
      },
      cancel() {
        clearInterval(intervalId);
        sseManager.removeClient(clientId);
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

  // Version/update/claude-profile: 도메인 라우트 분할 (Plan C #C9)
  registerVersionRoutes(api, {
    store,
    queue,
    sseManager,
    configWatcher,
    rootDir,
    getQuotaStatus: () => currentQuotaStatus,
    setQuotaStatus: (s) => { currentQuotaStatus = s; },
  });

  // Repositories API - project-level aggregated information with health and stats
  api.get("/api/repositories", async (c) => {
    try {
      const config = configWatcher?.current() ?? loadConfig(rootDir);
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
          const projectPath = resolve(rootDir, projectConfig.path);
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
      const config = configWatcher?.current() ?? loadConfig(rootDir);
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
          const projectPath = resolve(rootDir, projectConfig.path);
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

  // Setup wizard: 도메인 라우트 분할 (Plan C #C9)
  registerSetupRoutes(api, { rootDir });

  // Health check endpoint
  api.get("/api/health", async (c) => {
    try {
      const projectParam = c.req.query("project");
      if (!projectParam) {
        return c.json({ error: "project parameter is required" }, 400);
      }

      const project = decodeURIComponent(projectParam);

      // Load configuration to get project path and git settings
      const config = configWatcher?.current() ?? loadConfig(rootDir);
      const projectConfig = config.projects?.find(p => p.repo === project);

      if (!projectConfig) {
        return c.json({ error: `Project "${project}" not found in configuration` }, 404);
      }

      const projectPath = resolve(rootDir, projectConfig.path);
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

  // Create a new GitHub issue from dashboard
  api.post("/api/new-issue", zValidator('json', NewIssueRequestSchema, zodValidationHook), async (c) => {
    const logger = getLogger();
    try {
      const { category, title, repo, what, where, how, files } = c.req.valid('json');

      const templatesDir = resolve(rootDir, "prompts/issue-templates");
      const templatePath = resolve(templatesDir, `${category}.md`);
      const template = loadTemplate(templatePath, templatesDir);
      const body = renderTemplate(template, { what, where, how, files });

      const result = await runCli("gh", [
        "issue", "create",
        "--repo", repo,
        "--title", title,
        "--body", body,
        "--label", "aqm-by",
      ]);

      if (result.exitCode !== 0) {
        return c.json({ error: `Failed to create issue: ${sanitizeErrorMessage(result.stderr)}` }, 500);
      }

      const url = result.stdout.trim();
      const numberMatch = url.match(/\/issues\/(\d+)$/);
      const number = numberMatch ? parseInt(numberMatch[1], 10) : undefined;

      logger.info(`New issue created: ${url}`);
      return c.json({ url, number });
    } catch (error: unknown) {
      return c.json({ error: `Failed to create issue: ${sanitizeErrorMessage(getErrorMessage(error))}` }, 500);
    }
  });

  // Doctor: 도메인 라우트 분할 (Plan C #C9)
  registerDoctorRoutes(api);

  // Notifications: 도메인 라우트 분할 (Plan C #C9)
  registerNotificationsRoutes(api, { store, sseManager, readOnly: !!readOnly });

  return api;
}
