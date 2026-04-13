import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import {
  createDashboardRoutes,
  stopPeriodicCleanup,
} from "../../src/server/dashboard-api.js";
import type { JobStore } from "../../src/queue/job-store.js";
import type { JobQueue } from "../../src/queue/job-queue.js";

// Mock 설정
vi.mock("../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
  updateConfigSection: vi.fn(),
  addProjectToConfig: vi.fn(),
  removeProjectFromConfig: vi.fn(),
  updateProjectInConfig: vi.fn(),
}));

vi.mock("../../src/utils/config-masker.js", () => ({
  maskSensitiveConfig: vi.fn(),
}));

vi.mock("../../src/config/validator.js", () => ({
  validateConfig: vi.fn(),
}));

vi.mock("../../src/update/self-updater.js", () => ({
  SelfUpdater: vi.fn(),
}));

vi.mock("../../src/store/queries.js", () => ({
  getJobStats: vi.fn().mockReturnValue({
    total: 0, successCount: 0, failureCount: 0, runningCount: 0,
    queuedCount: 0, cancelledCount: 0, avgDurationMs: 0, successRate: 0,
    project: null, timeRange: "7d",
  }),
  getCostStats: vi.fn().mockReturnValue({
    project: null, timeRange: "30d", groupBy: "project",
    summary: { totalCostUsd: 0, jobCount: 0, avgCostUsd: 0,
      totalInputTokens: 0, totalOutputTokens: 0,
      totalCacheCreationTokens: 0, totalCacheReadTokens: 0 },
    breakdown: [],
  }),
  getProjectSummary: vi.fn().mockReturnValue([]),
}));

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  statSync: vi.fn(),
}));

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

// 테스트용 store/queue mock 생성
function createMockStore(): JobStore {
  const emitter = new EventEmitter();
  return {
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    emit: emitter.emit.bind(emitter),
    getJob: vi.fn().mockReturnValue(undefined),
    getJobs: vi.fn().mockReturnValue([]),
    createJob: vi.fn(),
    updateJob: vi.fn(),
    deleteJob: vi.fn(),
    getStats: vi.fn().mockReturnValue({}),
  } as unknown as JobStore;
}

function createMockQueue(): JobQueue {
  return {
    enqueue: vi.fn(),
    cancel: vi.fn(),
    getStatus: vi.fn(),
    retry: vi.fn(),
  } as unknown as JobQueue;
}

async function request(
  app: ReturnType<typeof createDashboardRoutes>,
  method: string,
  path: string,
  headers: Record<string, string> = {}
): Promise<Response> {
  const req = new Request(`http://localhost${path}`, {
    method,
    headers,
  });
  return app.fetch(req);
}

describe("Dashboard Auth — apiKey 미설정 시 쓰기 API 차단", () => {
  let store: JobStore;
  let queue: JobQueue;

  beforeEach(() => {
    store = createMockStore();
    queue = createMockQueue();
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopPeriodicCleanup();
  });

  it("apiKey 미설정 시 job cancel(POST)은 허용된다", async () => {
    const app = createDashboardRoutes(store, queue);
    const res = await request(app, "POST", "/api/jobs/job-123/cancel");
    // readOnlyGuard 제거 — apiKey 없이도 모든 API 허용
    expect(res.status).not.toBe(403);
  });

  it("apiKey 미설정 시 job retry(POST)은 허용된다", async () => {
    const app = createDashboardRoutes(store, queue);
    const res = await request(app, "POST", "/api/jobs/job-123/retry");
    expect(res.status).not.toBe(403);
  });

  it("apiKey 미설정 시 job delete(DELETE)은 허용된다", async () => {
    const app = createDashboardRoutes(store, queue);
    const res = await request(app, "DELETE", "/api/jobs/job-123");
    expect(res.status).not.toBe(403);
  });

  it("apiKey 미설정 시 project 관리(DELETE)는 허용된다", async () => {
    const app = createDashboardRoutes(store, queue);
    const res = await request(app, "DELETE", "/api/projects/owner-repo");
    // projects 관리는 apiKey 없이도 허용 (403이 아님)
    expect(res.status).not.toBe(403);
  });

  it("apiKey 미설정 시 GET 읽기 요청은 허용된다", async () => {
    const app = createDashboardRoutes(store, queue);
    const res = await request(app, "GET", "/api/jobs");
    // 403이 아님 (읽기는 허용)
    expect(res.status).not.toBe(403);
  });
});

describe("Dashboard Auth — readOnly 모드", () => {
  let store: JobStore;
  let queue: JobQueue;

  beforeEach(() => {
    store = createMockStore();
    queue = createMockQueue();
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopPeriodicCleanup();
  });

  // (1) readOnly=true 시 write 엔드포인트 403 확인
  it("readOnly=true 시 POST /api/jobs/:id/cancel은 403을 반환한다", async () => {
    const app = createDashboardRoutes(store, queue, undefined, undefined, undefined, undefined, true);
    const res = await request(app, "POST", "/api/jobs/job-123/cancel");
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("read-only");
  });

  it("readOnly=true 시 POST /api/jobs/:id/retry는 403을 반환한다", async () => {
    const app = createDashboardRoutes(store, queue, undefined, undefined, undefined, undefined, true);
    const res = await request(app, "POST", "/api/jobs/job-123/retry");
    expect(res.status).toBe(403);
  });

  it("readOnly=true 시 DELETE /api/jobs/:id는 403을 반환한다", async () => {
    const app = createDashboardRoutes(store, queue, undefined, undefined, undefined, undefined, true);
    const res = await request(app, "DELETE", "/api/jobs/job-123");
    expect(res.status).toBe(403);
  });

  it("readOnly=true 시 DELETE /api/projects/:id는 403을 반환한다", async () => {
    const app = createDashboardRoutes(store, queue, undefined, undefined, undefined, undefined, true);
    const res = await request(app, "DELETE", "/api/projects/owner-repo");
    expect(res.status).toBe(403);
  });

  it("readOnly=true 시 POST /api/projects는 403을 반환한다", async () => {
    const app = createDashboardRoutes(store, queue, undefined, undefined, undefined, undefined, true);
    const res = await request(app, "POST", "/api/projects");
    expect(res.status).toBe(403);
  });

  it("readOnly=true 시 PUT /api/config는 403을 반환한다", async () => {
    const app = createDashboardRoutes(store, queue, undefined, undefined, undefined, undefined, true);
    const res = await request(app, "PUT", "/api/config");
    expect(res.status).toBe(403);
  });

  it("readOnly=true 시 POST /api/update는 403을 반환한다", async () => {
    const app = createDashboardRoutes(store, queue, undefined, undefined, undefined, undefined, true);
    const res = await request(app, "POST", "/api/update");
    expect(res.status).toBe(403);
  });

  // (2) readOnly=true 시 GET 엔드포인트는 허용 (200 확인)
  it("readOnly=true 시 GET /api/jobs는 허용된다", async () => {
    const app = createDashboardRoutes(store, queue, undefined, undefined, undefined, undefined, true);
    const res = await request(app, "GET", "/api/jobs");
    expect(res.status).not.toBe(403);
  });

  it("readOnly=true 시 GET /api/stats는 허용된다", async () => {
    const app = createDashboardRoutes(store, queue, undefined, undefined, undefined, undefined, true);
    const res = await request(app, "GET", "/api/stats");
    expect(res.status).not.toBe(403);
  });

  it("readOnly=true 시 GET /api/config는 허용된다", async () => {
    const app = createDashboardRoutes(store, queue, undefined, undefined, undefined, undefined, true);
    const res = await request(app, "GET", "/api/config");
    expect(res.status).not.toBe(403);
  });

  // (3) readOnly=false(기본) 시 기존 동작 유지 — write 엔드포인트가 403이 아님
  it("readOnly=false(기본) 시 POST /api/jobs/:id/cancel은 차단되지 않는다", async () => {
    const app = createDashboardRoutes(store, queue);
    const res = await request(app, "POST", "/api/jobs/job-123/cancel");
    expect(res.status).not.toBe(403);
  });

  it("readOnly=false(기본) 시 DELETE /api/jobs/:id는 차단되지 않는다", async () => {
    const app = createDashboardRoutes(store, queue);
    const res = await request(app, "DELETE", "/api/jobs/job-123");
    expect(res.status).not.toBe(403);
  });

  it("readOnly=false(기본) 시 DELETE /api/projects/:id는 차단되지 않는다", async () => {
    const app = createDashboardRoutes(store, queue);
    const res = await request(app, "DELETE", "/api/projects/owner-repo");
    expect(res.status).not.toBe(403);
  });
});

describe("Dashboard Auth — apiKey 설정 시 인증 강제", () => {
  const API_KEY = "test-secret-key-12345";
  let store: JobStore;
  let queue: JobQueue;

  beforeEach(() => {
    store = createMockStore();
    queue = createMockQueue();
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopPeriodicCleanup();
  });

  it("apiKey 설정 시 Authorization 헤더 없으면 /api/jobs는 401을 반환한다", async () => {
    const app = createDashboardRoutes(store, queue, undefined, API_KEY);
    const res = await request(app, "GET", "/api/jobs");
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("Unauthorized");
  });

  it("잘못된 API 키로 요청 시 401을 반환한다", async () => {
    const app = createDashboardRoutes(store, queue, undefined, API_KEY);
    const res = await request(app, "GET", "/api/jobs", {
      Authorization: "Bearer wrong-key",
    });
    expect(res.status).toBe(401);
  });

  it("올바른 Bearer 토큰으로 요청 시 통과한다", async () => {
    const app = createDashboardRoutes(store, queue, undefined, API_KEY);
    const res = await request(app, "GET", "/api/jobs", {
      Authorization: `Bearer ${API_KEY}`,
    });
    // 인증 통과 (404나 200 등, 401이 아님)
    expect(res.status).not.toBe(401);
  });

  it("Bearer 접두어 없이 키만 보내면 401을 반환한다", async () => {
    const app = createDashboardRoutes(store, queue, undefined, API_KEY);
    const res = await request(app, "GET", "/api/jobs", {
      Authorization: API_KEY,
    });
    expect(res.status).toBe(401);
  });

  it("POST /api/auth에서 올바른 키로 세션 토큰을 발급받는다", async () => {
    const app = createDashboardRoutes(store, queue, undefined, API_KEY);
    const res = await request(app, "POST", "/api/auth", {
      Authorization: `Bearer ${API_KEY}`,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { token: string; expiresIn: number };
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);
    expect(body.expiresIn).toBeGreaterThan(0);
  });

  it("POST /api/auth에서 잘못된 키는 401을 반환한다", async () => {
    const app = createDashboardRoutes(store, queue, undefined, API_KEY);
    const res = await request(app, "POST", "/api/auth", {
      Authorization: "Bearer bad-key",
    });
    expect(res.status).toBe(401);
  });

  it("apiKey 설정 시 /api/stats도 인증 필요하다", async () => {
    const app = createDashboardRoutes(store, queue, undefined, API_KEY);
    const res = await request(app, "GET", "/api/stats");
    expect(res.status).toBe(401);
  });

  it("apiKey 설정 시 /api/config도 인증 필요하다", async () => {
    const app = createDashboardRoutes(store, queue, undefined, API_KEY);
    const res = await request(app, "GET", "/api/config");
    expect(res.status).toBe(401);
  });

  it("타이밍 어택 방어: 잘못된 키도 일정 시간 내 응답한다", async () => {
    const app = createDashboardRoutes(store, queue, undefined, API_KEY);
    const start = Date.now();
    await request(app, "GET", "/api/jobs", {
      Authorization: "Bearer x",
    });
    const elapsed = Date.now() - start;
    // 타이밍 어택 방어 (timingSafeEqual 사용)로 인해 즉각 응답
    // 단순히 응답이 왔음을 확인 (무한 대기 없음)
    expect(elapsed).toBeLessThan(5000);
  });
});
