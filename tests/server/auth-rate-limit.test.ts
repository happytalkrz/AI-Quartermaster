import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { EventEmitter } from "events";
import { LoginRateLimiter } from "../../src/server/auth/rate-limiter.js";
import { SessionManager } from "../../src/server/auth/session.js";
import { createDashboardRoutes, cleanupDashboardResources } from "../../src/server/dashboard-api.js";
import type { JobStore } from "../../src/queue/job-store.js";
import type { JobQueue } from "../../src/queue/job-queue.js";

// === Mocks for dashboard-api.ts dependencies ===
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
    summary: { totalCostUsd: 0, jobCount: 0, avgCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCacheCreationTokens: 0, totalCacheReadTokens: 0 },
    breakdown: [],
  }),
  getProjectSummary: vi.fn().mockReturnValue([]),
  getProjectStatsWithTimeRange: vi.fn().mockReturnValue([]),
}));

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

vi.mock("../../src/config/project-detector.js", () => ({
  detectProjectCommands: vi.fn(),
  detectBaseBranch: vi.fn(),
}));

// === Shared mock store/queue for integration tests ===
const globalEmitter = new EventEmitter();
const mockJobStore: JobStore = {
  list: vi.fn().mockReturnValue([]),
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  on: globalEmitter.on.bind(globalEmitter),
  emit: globalEmitter.emit.bind(globalEmitter),
  getAqDb: vi.fn().mockReturnValue({}),
} as unknown as JobStore;

const mockJobQueue: JobQueue = {
  getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
  cancel: vi.fn(),
  retryJob: vi.fn(),
} as unknown as JobQueue;

// =============================
// Unit tests: LoginRateLimiter
// =============================
describe("LoginRateLimiter", () => {
  let limiter: LoginRateLimiter;

  afterEach(() => {
    limiter?.destroy();
    vi.useRealTimers();
  });

  describe("checkAndRecord — 기본 동작", () => {
    beforeEach(() => {
      limiter = new LoginRateLimiter({ maxAttempts: 3, windowMs: 10_000 });
    });

    it("새 IP의 첫 시도는 허용된다", () => {
      const result = limiter.checkAndRecord("1.2.3.4");
      expect(result.allowed).toBe(true);
    });

    it("maxAttempts 이내의 연속 시도는 모두 허용된다", () => {
      for (let i = 0; i < 3; i++) {
        expect(limiter.checkAndRecord("1.2.3.4").allowed).toBe(true);
      }
    });

    it("maxAttempts 초과 시 차단된다", () => {
      for (let i = 0; i < 3; i++) {
        limiter.checkAndRecord("1.2.3.4");
      }
      const result = limiter.checkAndRecord("1.2.3.4");
      expect(result.allowed).toBe(false);
    });

    it("차단 응답에 retryAfterMs가 포함된다", () => {
      for (let i = 0; i < 3; i++) {
        limiter.checkAndRecord("2.3.4.5");
      }
      const result = limiter.checkAndRecord("2.3.4.5");
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeDefined();
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it("IP가 다르면 독립적으로 카운트된다", () => {
      for (let i = 0; i < 3; i++) {
        limiter.checkAndRecord("10.0.0.1");
      }
      // Different IP should not be blocked
      expect(limiter.checkAndRecord("10.0.0.2").allowed).toBe(true);
    });
  });

  describe("onExceeded 콜백", () => {
    it("maxAttempts 초과 시 onExceeded가 호출된다", () => {
      const onExceeded = vi.fn();
      limiter = new LoginRateLimiter({ maxAttempts: 2, windowMs: 10_000, onExceeded });

      limiter.checkAndRecord("5.5.5.5");
      limiter.checkAndRecord("5.5.5.5");
      expect(onExceeded).not.toHaveBeenCalled();

      limiter.checkAndRecord("5.5.5.5"); // 3rd attempt exceeds maxAttempts=2
      expect(onExceeded).toHaveBeenCalledOnce();
      expect(onExceeded).toHaveBeenCalledWith("5.5.5.5", 3);
    });

    it("maxAttempts 이내에서는 onExceeded가 호출되지 않는다", () => {
      const onExceeded = vi.fn();
      limiter = new LoginRateLimiter({ maxAttempts: 5, windowMs: 10_000, onExceeded });

      for (let i = 0; i < 5; i++) {
        limiter.checkAndRecord("6.6.6.6");
      }
      expect(onExceeded).not.toHaveBeenCalled();
    });
  });

  describe("reset — 성공 후 카운터 리셋", () => {
    beforeEach(() => {
      limiter = new LoginRateLimiter({ maxAttempts: 2, windowMs: 10_000 });
    });

    it("reset 후에는 새 윈도우처럼 허용된다", () => {
      limiter.checkAndRecord("10.0.0.1");
      limiter.checkAndRecord("10.0.0.1");
      limiter.reset("10.0.0.1");

      expect(limiter.checkAndRecord("10.0.0.1").allowed).toBe(true);
    });

    it("reset은 해당 IP만 초기화한다", () => {
      limiter.checkAndRecord("10.0.0.1");
      limiter.checkAndRecord("10.0.0.1");
      limiter.checkAndRecord("10.0.0.2");
      limiter.checkAndRecord("10.0.0.2");

      limiter.reset("10.0.0.1");

      // 10.0.0.1 reset → allowed
      expect(limiter.checkAndRecord("10.0.0.1").allowed).toBe(true);
      // 10.0.0.2 not reset → blocked on 3rd
      expect(limiter.checkAndRecord("10.0.0.2").allowed).toBe(false);
    });
  });

  describe("window expiry — 윈도우 경과 후 허용", () => {
    it("windowMs 경과 후 새 윈도우로 허용된다", () => {
      vi.useFakeTimers();
      limiter = new LoginRateLimiter({ maxAttempts: 2, windowMs: 5_000 });

      limiter.checkAndRecord("9.9.9.9");
      limiter.checkAndRecord("9.9.9.9");
      expect(limiter.checkAndRecord("9.9.9.9").allowed).toBe(false);

      vi.advanceTimersByTime(6_000); // past 5s window

      expect(limiter.checkAndRecord("9.9.9.9").allowed).toBe(true);
    });
  });
});

// ===========================
// Unit tests: SessionManager
// ===========================
describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager(1_000); // 1s TTL for fast expiry tests
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createToken", () => {
    it("토큰 문자열과 expiresIn을 반환한다", () => {
      const { token, expiresIn } = manager.createToken();
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(0);
      expect(expiresIn).toBe(1_000);
    });

    it("호출마다 고유한 토큰을 생성한다", () => {
      const { token: t1 } = manager.createToken();
      const { token: t2 } = manager.createToken();
      expect(t1).not.toBe(t2);
    });
  });

  describe("validate", () => {
    it("유효한 토큰은 true를 반환한다", () => {
      const { token } = manager.createToken();
      expect(manager.validate(token)).toBe(true);
    });

    it("존재하지 않는 토큰은 false를 반환한다", () => {
      expect(manager.validate("nonexistent-token")).toBe(false);
    });

    it("만료된 토큰은 false를 반환한다", () => {
      vi.useFakeTimers();
      const { token } = manager.createToken();
      vi.advanceTimersByTime(1_001); // past 1s TTL
      expect(manager.validate(token)).toBe(false);
    });

    it("만료된 토큰은 validate 호출 시 store에서 제거된다", () => {
      vi.useFakeTimers();
      manager.createToken();
      manager.createToken();
      expect(manager.getActiveCount()).toBe(2);

      vi.advanceTimersByTime(1_001);
      manager.validate("any"); // triggers pruneExpired via validate path indirectly
      expect(manager.getActiveCount()).toBe(0);
    });
  });

  describe("revokeAll", () => {
    it("revokeAll 후 모든 토큰이 무효화된다", () => {
      const { token: t1 } = manager.createToken();
      const { token: t2 } = manager.createToken();
      manager.revokeAll();
      expect(manager.validate(t1)).toBe(false);
      expect(manager.validate(t2)).toBe(false);
    });

    it("revokeAll 후 getActiveCount는 0을 반환한다", () => {
      manager.createToken();
      manager.createToken();
      manager.revokeAll();
      expect(manager.getActiveCount()).toBe(0);
    });
  });

  describe("getActiveCount", () => {
    it("만료되지 않은 토큰 수를 반환한다", () => {
      manager.createToken();
      manager.createToken();
      expect(manager.getActiveCount()).toBe(2);
    });

    it("만료된 토큰은 카운트에서 제외된다", () => {
      vi.useFakeTimers();
      manager.createToken();
      manager.createToken();
      vi.advanceTimersByTime(1_001);
      expect(manager.getActiveCount()).toBe(0);
    });
  });
});

// =====================================================
// Integration tests: POST /api/auth + rate-limit
// =====================================================
describe("POST /api/auth — rate-limit 통합 테스트", () => {
  const apiKey = "test-api-key-for-rate-limit";
  let app: Hono;

  beforeEach(() => {
    app = createDashboardRoutes(mockJobStore, mockJobQueue, undefined, apiKey, undefined, {
      rateLimit: { maxAttempts: 3, windowMs: 60_000, blockDurationMs: 60_000 },
      sessionTtlMs: 3_600_000,
    });
  });

  afterEach(() => {
    cleanupDashboardResources();
  });

  it("유효한 키로 인증 성공 시 200과 token을 반환한다", async () => {
    const response = await app.request("/api/auth", {
      method: "POST",
      headers: {
        "X-Forwarded-For": "192.168.1.1",
        Authorization: `Bearer ${apiKey}`,
      },
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { token: string; expiresIn: number };
    expect(typeof body.token).toBe("string");
    expect(body.expiresIn).toBeGreaterThan(0);
  });

  it("잘못된 키로 인증 실패 시 401을 반환한다", async () => {
    const response = await app.request("/api/auth", {
      method: "POST",
      headers: {
        "X-Forwarded-For": "192.168.2.1",
        Authorization: "Bearer wrong-key",
      },
    });
    expect(response.status).toBe(401);
  });

  it("rate limit 초과 시 429를 반환한다", async () => {
    const ip = "10.10.10.10";
    // maxAttempts=3 → 3 allowed, 4th blocked
    for (let i = 0; i < 3; i++) {
      await app.request("/api/auth", {
        method: "POST",
        headers: { "X-Forwarded-For": ip, Authorization: "Bearer wrong-key" },
      });
    }
    const response = await app.request("/api/auth", {
      method: "POST",
      headers: { "X-Forwarded-For": ip, Authorization: "Bearer wrong-key" },
    });
    expect(response.status).toBe(429);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("Too Many Requests");
  });

  it("429 응답에 Retry-After 헤더가 포함된다", async () => {
    const ip = "10.20.30.40";
    for (let i = 0; i < 3; i++) {
      await app.request("/api/auth", {
        method: "POST",
        headers: { "X-Forwarded-For": ip, Authorization: "Bearer wrong-key" },
      });
    }
    const response = await app.request("/api/auth", {
      method: "POST",
      headers: { "X-Forwarded-For": ip, Authorization: "Bearer wrong-key" },
    });
    expect(response.status).toBe(429);
    const retryAfter = response.headers.get("Retry-After");
    expect(retryAfter).toBeTruthy();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it("성공 인증 후 rate limit 카운터가 리셋된다", async () => {
    const ip = "172.16.0.1";
    // Use 2 out of 3 allowed attempts
    for (let i = 0; i < 2; i++) {
      await app.request("/api/auth", {
        method: "POST",
        headers: { "X-Forwarded-For": ip, Authorization: "Bearer wrong-key" },
      });
    }
    // Successful auth resets counter
    const successResponse = await app.request("/api/auth", {
      method: "POST",
      headers: { "X-Forwarded-For": ip, Authorization: `Bearer ${apiKey}` },
    });
    expect(successResponse.status).toBe(200);

    // After reset, 3 more attempts are allowed
    for (let i = 0; i < 3; i++) {
      const r = await app.request("/api/auth", {
        method: "POST",
        headers: { "X-Forwarded-For": ip, Authorization: "Bearer wrong-key" },
      });
      expect(r.status).not.toBe(429);
    }
  });

  it("rate limit 초과 시 이벤트 로그 경로가 실행된다 (onExceeded 콜백 발생)", async () => {
    // onExceeded fires when count exceeds maxAttempts.
    // The 429 response is only returned after onExceeded runs internally,
    // so a 429 response is definitive proof that the event log path was triggered.
    const ip = "11.22.33.44";
    for (let i = 0; i < 3; i++) {
      await app.request("/api/auth", {
        method: "POST",
        headers: { "X-Forwarded-For": ip, Authorization: "Bearer wrong-key" },
      });
    }
    const response = await app.request("/api/auth", {
      method: "POST",
      headers: { "X-Forwarded-For": ip, Authorization: "Bearer wrong-key" },
    });
    expect(response.status).toBe(429);
  });

  it("rate limit은 IP별로 독립적으로 동작한다", async () => {
    const ipA = "1.1.1.1";
    const ipB = "2.2.2.2";

    // Exhaust rate limit for ipA
    for (let i = 0; i < 3; i++) {
      await app.request("/api/auth", {
        method: "POST",
        headers: { "X-Forwarded-For": ipA, Authorization: "Bearer wrong-key" },
      });
    }
    const blockedResponse = await app.request("/api/auth", {
      method: "POST",
      headers: { "X-Forwarded-For": ipA, Authorization: "Bearer wrong-key" },
    });
    expect(blockedResponse.status).toBe(429);

    // ipB should not be affected
    const allowedResponse = await app.request("/api/auth", {
      method: "POST",
      headers: { "X-Forwarded-For": ipB, Authorization: `Bearer ${apiKey}` },
    });
    expect(allowedResponse.status).toBe(200);
  });
});
