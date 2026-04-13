import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { EventEmitter } from "events";
import { createDashboardRoutes } from "../../src/server/dashboard-api.js";
import type { JobStore } from "../../src/queue/job-store.js";
import type { JobQueue } from "../../src/queue/job-queue.js";

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

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

vi.mock("../../src/config/project-detector.js", () => ({
  detectProjectCommands: vi.fn(),
  detectBaseBranch: vi.fn(),
}));

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock("../../src/store/queries.js", () => ({
  getJobStats: vi.fn(),
  getCostStats: vi.fn(),
  getProjectSummary: vi.fn(),
  getProjectStatsWithTimeRange: vi.fn(),
  getFailureReasons: vi.fn(),
}));

const mockGetFailureReasons = vi.mocked(await import("../../src/store/queries.js")).getFailureReasons;

const globalEmitter = new EventEmitter();
const mockJobStore: JobStore = {
  list: vi.fn().mockReturnValue([]),
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  on: globalEmitter.on.bind(globalEmitter),
  emit: globalEmitter.emit.bind(globalEmitter),
  getAqDb: vi.fn().mockReturnValue({}),
} as any;

const mockJobQueue: JobQueue = {
  getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
  cancel: vi.fn(),
  retryJob: vi.fn(),
} as any;

describe("Dashboard API - GET /api/metrics/failure-reasons", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("카테고리별 집계", () => {
    beforeEach(() => {
      app = createDashboardRoutes(mockJobStore, mockJobQueue);
    });

    it("실패 잡이 있을 때 카테고리별 집계 결과를 반환한다", async () => {
      mockGetFailureReasons.mockReturnValue({
        reasons: [
          { category: "TIMEOUT", count: 5, percentage: 50.0, recentErrors: ["timeout error"] },
          { category: "BUILD_FAILURE", count: 3, percentage: 30.0, recentErrors: ["build failed"] },
          { category: "UNKNOWN", count: 2, percentage: 20.0, recentErrors: ["unknown error"] },
        ],
        total: 10,
        window: "7d",
        project: null,
        recurringPatterns: [],
      });

      const response = await app.request("/api/metrics/failure-reasons");

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.reasons).toHaveLength(3);
      expect(result.reasons[0].category).toBe("TIMEOUT");
      expect(result.reasons[0].count).toBe(5);
      expect(result.reasons[0].percentage).toBe(50.0);
      expect(result.total).toBe(10);
      expect(result.window).toBe("7d");
      expect(result.project).toBeNull();
    });

    it("top 파라미터로 상위 N개만 반환한다", async () => {
      mockGetFailureReasons.mockReturnValue({
        reasons: [
          { category: "TIMEOUT", count: 5, percentage: 71.43, recentErrors: [] },
          { category: "BUILD_FAILURE", count: 2, percentage: 28.57, recentErrors: [] },
        ],
        total: 7,
        window: "7d",
        project: null,
        recurringPatterns: [],
      });

      const response = await app.request("/api/metrics/failure-reasons?top=2");

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.reasons).toHaveLength(2);
      expect(mockGetFailureReasons).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ top: 2 }),
        undefined,
      );
    });

    it("window 파라미터로 시간 필터링을 한다", async () => {
      mockGetFailureReasons.mockReturnValue({
        reasons: [{ category: "TIMEOUT", count: 1, percentage: 100.0, recentErrors: [] }],
        total: 1,
        window: "24h",
        project: null,
        recurringPatterns: [],
      });

      const response = await app.request("/api/metrics/failure-reasons?window=24h");

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.window).toBe("24h");
      expect(mockGetFailureReasons).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ window: "24h" }),
        undefined,
      );
    });

    it("project 파라미터로 프로젝트 필터링을 한다", async () => {
      mockGetFailureReasons.mockReturnValue({
        reasons: [{ category: "TIMEOUT", count: 3, percentage: 100.0, recentErrors: [] }],
        total: 3,
        window: "7d",
        project: "my-repo",
        recurringPatterns: [],
      });

      const response = await app.request("/api/metrics/failure-reasons?project=my-repo");

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.project).toBe("my-repo");
      expect(mockGetFailureReasons).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ project: "my-repo" }),
        undefined,
      );
    });

    it("실패 잡이 없을 때 빈 배열을 반환한다", async () => {
      mockGetFailureReasons.mockReturnValue({
        reasons: [],
        total: 0,
        window: "7d",
        project: null,
        recurringPatterns: [],
      });

      const response = await app.request("/api/metrics/failure-reasons");

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.reasons).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe("PatternStore 연동", () => {
    it("PatternStore 연동 시 recurringPatterns를 포함한다", async () => {
      const mockPatternStore = {
        add: vi.fn(),
        list: vi.fn(),
        getFailurePatterns: vi.fn(),
        getStats: vi.fn().mockReturnValue({
          total: 5,
          successes: 2,
          failures: 3,
          byCategory: { TIMEOUT: 2, BUILD_FAILURE: 1 },
        }),
        formatForPrompt: vi.fn(),
      } as any;

      app = createDashboardRoutes(mockJobStore, mockJobQueue, undefined, undefined, undefined, undefined, undefined, mockPatternStore);

      mockGetFailureReasons.mockReturnValue({
        reasons: [{ category: "TIMEOUT", count: 5, percentage: 100.0, recentErrors: [] }],
        total: 5,
        window: "7d",
        project: null,
        recurringPatterns: ["TIMEOUT"],
      });

      const response = await app.request("/api/metrics/failure-reasons");

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.recurringPatterns).toContain("TIMEOUT");
      expect(mockGetFailureReasons).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        mockPatternStore,
      );
    });
  });

  describe("유효하지 않은 파라미터", () => {
    beforeEach(() => {
      app = createDashboardRoutes(mockJobStore, mockJobQueue);
    });

    it("잘못된 window 값에 400을 반환한다", async () => {
      const response = await app.request("/api/metrics/failure-reasons?window=invalid");

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBe("Invalid query parameters");
    });

    it("top이 범위를 초과하면 400을 반환한다", async () => {
      const response = await app.request("/api/metrics/failure-reasons?top=100");

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBe("Invalid query parameters");
    });

    it("top이 0 이하이면 400을 반환한다", async () => {
      const response = await app.request("/api/metrics/failure-reasons?top=0");

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error).toBe("Invalid query parameters");
    });
  });

  describe("에러 핸들링", () => {
    beforeEach(() => {
      app = createDashboardRoutes(mockJobStore, mockJobQueue);
    });

    it("getFailureReasons가 예외를 던지면 500을 반환한다", async () => {
      mockGetFailureReasons.mockImplementation(() => {
        throw new Error("DB connection failed");
      });

      const response = await app.request("/api/metrics/failure-reasons");

      expect(response.status).toBe(500);
      const result = await response.json();
      expect(result.error).toMatch(/Failed to fetch failure reasons/);
    });
  });
});
