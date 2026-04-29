import { Hono, type Context } from "hono";
import { SessionManager } from "./auth/session.js";
import { LoginRateLimiter } from "./auth/rate-limiter.js";
import type { JobStore, Job } from "../queue/job-store.js";
import type { JobQueue } from "../queue/job-queue.js";
import { loadConfig } from "../config/loader.js";
import type { AQConfig, DashboardAuthConfig, QuotaStatus } from "../types/config.js";
import type { ConfigWatcher } from "../config/config-watcher.js";
import type { AutomationScheduler } from "../automation/scheduler.js";
import { setGlobalLogLevel, getLogger } from "../utils/logger.js";
import { formatZodError } from "../types/api.js";
import type { PatternStore } from "../learning/pattern-store.js";
import { statusToNotificationType } from "../types/pipeline.js";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { ZodError } from "zod";
import { SSEManager } from "./sse-manager.js";
import { registerNotificationsRoutes } from "./routes/notifications.js";
import { registerVersionRoutes } from "./routes/version.js";
import { registerProjectsRoutes } from "./routes/projects.js";
import { registerJobsRoutes } from "./routes/jobs.js";
import { registerStatsRoutes } from "./routes/stats.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerSetupRoutes } from "./routes/setup.js";
import { registerDoctorRoutes } from "./routes/doctor.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerSkipEventsRoutes } from "./routes/skip-events.js";
import { registerNewIssueRoute } from "./routes/new-issue.js";
import { registerSSERoutes } from "./routes/sse.js";
import { setupAuth } from "./routes/auth.js";

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

/**
 * Creates dashboard API routes.
 * If apiKey is provided, all /api/* routes require `Authorization: Bearer <key>`.
 * SSE endpoints (/api/events, /api/jobs/:id/logs/stream) cannot set headers in the
 * browser EventSource API, so they accept a short-lived session token via ?token=<token>.
 * Obtain a session token from POST /api/auth with the Bearer key.
 */
/**
 * createDashboardRoutes 옵션 (Plan C #C12).
 *
 * 이전: 9개 positional 파라미터 (#808 사고처럼 위치 충돌 위험). cli.ts 1곳에서만 호출.
 * 이후: 단일 객체 — 누락 시 컴파일 에러로 잡히고, 새 필드 추가 시 기존 호출 깨지지 않는다.
 */
export interface DashboardRoutesOptions {
  store: JobStore;
  queue: JobQueue;
  /**
   * AQM 설치 루트(=AQM_HOME 또는 ~/.ai-quartermaster) — 라우트 핸들러가 데이터/로그 경로 조립에 사용.
   * 미지정 시 process.cwd() (테스트 호환). 프로덕션 진입(cli.ts)에서는 항상 명시 전달.
   */
  aqRoot?: string;
  configWatcher?: ConfigWatcher;
  patternStore?: PatternStore;
  /** 설정 시 Bearer 인증 활성화. 미설정 시 hostname + readOnly에 따라 무인증 모드. */
  apiKey?: string;
  /** 서버 바인드 호스트 — 무인증+비-로컬 바인드 시 보안 경고 출력에 사용. */
  hostname?: string;
  dashboardAuth?: DashboardAuthConfig;
  /** insecure 환경에서 mutation 차단용 플래그. */
  readOnly?: boolean;
}

export function createDashboardRoutes(opts: DashboardRoutesOptions): Hono {
  const { store, queue, configWatcher, apiKey, hostname, dashboardAuth, readOnly, patternStore, aqRoot } = opts;
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

  // Auth + readOnly guard: 도메인 라우트 분할 (Plan C #C9 12단계)
  setupAuth(api, {
    apiKey,
    hostname,
    readOnly: !!readOnly,
    sessionManager,
    loginRateLimiter,
  });

  const configPath = `${rootDir}/config.yml`;

  // Config: 도메인 라우트 분할 (Plan C #C9)
  registerConfigRoutes(api, { queue, sseManager, configWatcher, rootDir });

  // Projects: 도메인 라우트 분할 (Plan C #C9)
  registerProjectsRoutes(api, { queue, configWatcher, rootDir, configPath });

  // Jobs CRUD + cancel/priority/retry: 도메인 라우트 분할 (Plan C #C9)
  // (logs/stream은 SSE이므로 별도 처리)
  registerJobsRoutes(api, { store, queue, sseManager });

  // Skip events: 도메인 라우트 분할 (Plan C #C9)
  registerSkipEventsRoutes(api, { store, readOnly: !!readOnly });

  // Stats + metrics: 도메인 라우트 분할 (Plan C #C9)
  registerStatsRoutes(api, { store, patternStore });

  // SSE: 도메인 라우트 분할 (Plan C #C9)
  registerSSERoutes(api, { store, queue, sseManager });

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

  // Health: 도메인 라우트 분할 (Plan C #C9) — repositories + projects/health + health
  registerHealthRoutes(api, { store, configWatcher, rootDir });

  // Setup wizard: 도메인 라우트 분할 (Plan C #C9)
  registerSetupRoutes(api, { rootDir });

  // New issue: 도메인 라우트 분할 (Plan C #C9)
  registerNewIssueRoute(api, { rootDir });

  // Doctor: 도메인 라우트 분할 (Plan C #C9)
  registerDoctorRoutes(api);

  // Notifications: 도메인 라우트 분할 (Plan C #C9)
  registerNotificationsRoutes(api, { store, sseManager, readOnly: !!readOnly });

  return api;
}
