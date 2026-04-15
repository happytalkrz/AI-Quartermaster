/**
 * 알림 기능 테스트
 * - AQDatabase 알림 CRUD 단위 테스트 (createNotification, listNotifications, markAsRead, markAllAsRead)
 * - Notification API 엔드포인트 통합 테스트 (GET/POST 정상·에러 케이스)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── 모킹 (API 통합 테스트용) ─────────────────────────────────────────────────

vi.mock("../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
  updateConfigSection: vi.fn(),
  addProjectToConfig: vi.fn(),
  removeProjectFromConfig: vi.fn(),
  updateProjectInConfig: vi.fn(),
}));

vi.mock("../src/utils/config-masker.js", () => ({
  maskSensitiveConfig: vi.fn(),
}));

vi.mock("../src/config/validator.js", () => ({
  validateConfig: vi.fn(),
}));

vi.mock("../src/update/self-updater.js", () => ({
  SelfUpdater: vi.fn(),
}));

vi.mock("../src/utils/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  setGlobalLogLevel: vi.fn(),
}));

vi.mock("../src/store/queries.js", () => ({
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
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(),
    existsSync: vi.fn(),
    statSync: vi.fn(),
  };
});

vi.mock("../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

vi.mock("node-cron", () => ({
  schedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
}));

vi.mock("../src/automation/rule-engine.js", () => ({
  evaluateRule: vi.fn(),
  executeAction: vi.fn(),
}));

// ── DB 단위 테스트 ────────────────────────────────────────────────────────────

import { AQDatabase } from "../src/store/database.js";
import type { DatabaseJob, DatabaseNotification } from "../src/store/database.js";

function makeJob(id: string): DatabaseJob {
  return {
    id,
    issueNumber: 1,
    repo: "owner/repo",
    status: "queued",
    createdAt: new Date().toISOString(),
  };
}

function makeNotification(
  jobId: string,
  overrides: Partial<Omit<DatabaseNotification, "id">> = {}
): Omit<DatabaseNotification, "id"> {
  return {
    jobId,
    type: "job_success",
    title: "Job Succeeded",
    message: "Job completed successfully",
    isRead: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("AQDatabase — Notification CRUD", () => {
  let db: AQDatabase;

  beforeEach(() => {
    db = new AQDatabase(":memory:");
    db.createJob(makeJob("job-1"));
    db.createJob(makeJob("job-2"));
  });

  afterEach(() => {
    db.close();
  });

  describe("createNotification", () => {
    it("알림을 생성하고 양수 ID를 반환한다", () => {
      const id = db.createNotification(makeNotification("job-1"));
      expect(id).toBeGreaterThan(0);
    });

    it("여러 알림을 순차적으로 생성하면 ID가 증가한다", () => {
      const id1 = db.createNotification(makeNotification("job-1"));
      const id2 = db.createNotification(makeNotification("job-1", { type: "job_failure" }));
      expect(id2).toBeGreaterThan(id1);
    });

    it("repo와 issueNumber 필드를 저장한다", () => {
      const id = db.createNotification(
        makeNotification("job-1", { repo: "owner/repo", issueNumber: 42 })
      );
      const list = db.listNotifications();
      const found = list.find(n => n.id === id);
      expect(found?.repo).toBe("owner/repo");
      expect(found?.issueNumber).toBe(42);
    });

    it("isRead=true로 생성하면 읽은 상태로 저장된다", () => {
      const id = db.createNotification(makeNotification("job-1", { isRead: true }));
      const list = db.listNotifications();
      expect(list.find(n => n.id === id)?.isRead).toBe(true);
    });
  });

  describe("listNotifications", () => {
    beforeEach(() => {
      db.createNotification(makeNotification("job-1", { isRead: false, type: "job_queued" }));
      db.createNotification(makeNotification("job-1", { isRead: true, type: "job_success" }));
      db.createNotification(makeNotification("job-2", { isRead: false, type: "job_failure" }));
    });

    it("필터 없이 전체 알림 목록을 반환한다", () => {
      const list = db.listNotifications();
      expect(list).toHaveLength(3);
    });

    it("isRead=false 필터로 미읽은 알림만 반환한다", () => {
      const list = db.listNotifications({ isRead: false });
      expect(list).toHaveLength(2);
      expect(list.every(n => !n.isRead)).toBe(true);
    });

    it("isRead=true 필터로 읽은 알림만 반환한다", () => {
      const list = db.listNotifications({ isRead: true });
      expect(list).toHaveLength(1);
      expect(list[0].isRead).toBe(true);
    });

    it("limit으로 결과 수를 제한한다", () => {
      const list = db.listNotifications({ limit: 2 });
      expect(list).toHaveLength(2);
    });

    it("limit=1, offset=1로 두 번째 알림을 반환한다", () => {
      const all = db.listNotifications();
      const paged = db.listNotifications({ limit: 1, offset: 1 });
      expect(paged).toHaveLength(1);
      expect(paged[0].id).toBe(all[1].id);
    });

    it("created_at DESC 순으로 정렬된다", () => {
      const list = db.listNotifications();
      for (let i = 0; i < list.length - 1; i++) {
        expect(list[i].createdAt >= list[i + 1].createdAt).toBe(true);
      }
    });

    it("알림이 없을 때 빈 배열을 반환한다", () => {
      const emptyDb = new AQDatabase(":memory:");
      expect(emptyDb.listNotifications()).toEqual([]);
      emptyDb.close();
    });
  });

  describe("markNotificationRead (markAsRead)", () => {
    it("존재하는 알림을 읽음 처리하고 true를 반환한다", () => {
      const id = db.createNotification(makeNotification("job-1"));
      const result = db.markNotificationRead(id);
      expect(result).toBe(true);
      const list = db.listNotifications();
      expect(list.find(n => n.id === id)?.isRead).toBe(true);
    });

    it("존재하지 않는 ID에 대해 false를 반환한다", () => {
      const result = db.markNotificationRead(99999);
      expect(result).toBe(false);
    });

    it("이미 읽은 알림에 재호출해도 true를 반환한다", () => {
      const id = db.createNotification(makeNotification("job-1", { isRead: true }));
      const result = db.markNotificationRead(id);
      expect(result).toBe(true);
    });

    it("특정 알림만 읽음 처리하고 다른 알림은 변경되지 않는다", () => {
      const id1 = db.createNotification(makeNotification("job-1"));
      const id2 = db.createNotification(makeNotification("job-2"));
      db.markNotificationRead(id1);
      const list = db.listNotifications();
      expect(list.find(n => n.id === id1)?.isRead).toBe(true);
      expect(list.find(n => n.id === id2)?.isRead).toBe(false);
    });
  });

  describe("markAllNotificationsRead (markAllAsRead)", () => {
    it("모든 미읽은 알림을 읽음 처리하고 변경 수를 반환한다", () => {
      db.createNotification(makeNotification("job-1", { isRead: false }));
      db.createNotification(makeNotification("job-1", { isRead: false }));
      db.createNotification(makeNotification("job-2", { isRead: true }));

      const count = db.markAllNotificationsRead();
      expect(count).toBe(2);
      expect(db.countUnreadNotifications()).toBe(0);
    });

    it("미읽은 알림이 없으면 0을 반환한다", () => {
      db.createNotification(makeNotification("job-1", { isRead: true }));
      const count = db.markAllNotificationsRead();
      expect(count).toBe(0);
    });

    it("전체 읽음 처리 후 모든 알림의 isRead가 true다", () => {
      db.createNotification(makeNotification("job-1", { isRead: false }));
      db.createNotification(makeNotification("job-2", { isRead: false }));
      db.markAllNotificationsRead();
      const list = db.listNotifications();
      expect(list.every(n => n.isRead)).toBe(true);
    });
  });

  describe("countUnreadNotifications / countNotifications", () => {
    it("미읽은 알림 수를 정확히 반환한다", () => {
      db.createNotification(makeNotification("job-1", { isRead: false }));
      db.createNotification(makeNotification("job-1", { isRead: false }));
      db.createNotification(makeNotification("job-2", { isRead: true }));
      expect(db.countUnreadNotifications()).toBe(2);
    });

    it("알림이 없으면 0을 반환한다", () => {
      expect(db.countUnreadNotifications()).toBe(0);
    });

    it("전체 알림 수를 반환한다", () => {
      db.createNotification(makeNotification("job-1"));
      db.createNotification(makeNotification("job-2"));
      expect(db.countNotifications()).toBe(2);
    });

    it("isRead=false 필터로 미읽은 수를 카운트한다", () => {
      db.createNotification(makeNotification("job-1", { isRead: false }));
      db.createNotification(makeNotification("job-2", { isRead: true }));
      expect(db.countNotifications({ isRead: false })).toBe(1);
    });

    it("isRead=true 필터로 읽은 수를 카운트한다", () => {
      db.createNotification(makeNotification("job-1", { isRead: false }));
      db.createNotification(makeNotification("job-2", { isRead: true }));
      expect(db.countNotifications({ isRead: true })).toBe(1);
    });
  });
});

// ── API 통합 테스트 ───────────────────────────────────────────────────────────

import { Hono } from "hono";
import { EventEmitter } from "events";
import { createDashboardRoutes } from "../src/server/dashboard-api.js";
import type { JobStore } from "../src/queue/job-store.js";
import type { JobQueue } from "../src/queue/job-queue.js";

interface MockAqDb {
  countUnreadNotifications: ReturnType<typeof vi.fn>;
  listNotifications: ReturnType<typeof vi.fn>;
  countNotifications: ReturnType<typeof vi.fn>;
  markAllNotificationsRead: ReturnType<typeof vi.fn>;
  markNotificationRead: ReturnType<typeof vi.fn>;
}

function makeMockAqDb(): MockAqDb {
  return {
    countUnreadNotifications: vi.fn().mockReturnValue(3),
    listNotifications: vi.fn().mockReturnValue([]),
    countNotifications: vi.fn().mockReturnValue(0),
    markAllNotificationsRead: vi.fn().mockReturnValue(3),
    markNotificationRead: vi.fn().mockReturnValue(true),
  };
}

function makeApp(mockAqDb: MockAqDb): Hono {
  const globalEmitter = new EventEmitter();
  const mockJobStore: JobStore = {
    list: vi.fn().mockReturnValue([]),
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    on: globalEmitter.on.bind(globalEmitter),
    emit: globalEmitter.emit.bind(globalEmitter),
    getAqDb: vi.fn().mockReturnValue(mockAqDb),
  } as unknown as JobStore;

  const mockJobQueue: JobQueue = {
    getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
    cancel: vi.fn(),
    retryJob: vi.fn(),
    setConcurrency: vi.fn(),
    setProjectConcurrency: vi.fn(),
  } as unknown as JobQueue;

  return createDashboardRoutes(mockJobStore, mockJobQueue);
}

describe("Notification API 엔드포인트", () => {
  let app: Hono;
  let mockAqDb: MockAqDb;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAqDb = makeMockAqDb();
    app = makeApp(mockAqDb);
  });

  describe("GET /api/notifications/unread-count", () => {
    it("미읽은 알림 수를 반환한다", async () => {
      mockAqDb.countUnreadNotifications.mockReturnValue(5);
      const res = await app.request("/api/notifications/unread-count");
      expect(res.status).toBe(200);
      const body = await res.json() as { unreadCount: number };
      expect(body.unreadCount).toBe(5);
    });

    it("알림이 없으면 0을 반환한다", async () => {
      mockAqDb.countUnreadNotifications.mockReturnValue(0);
      const res = await app.request("/api/notifications/unread-count");
      expect(res.status).toBe(200);
      const body = await res.json() as { unreadCount: number };
      expect(body.unreadCount).toBe(0);
    });
  });

  describe("GET /api/notifications", () => {
    it("알림 목록과 페이지네이션 정보를 반환한다", async () => {
      const mockNotifications = [
        {
          id: 1, jobId: "j1", type: "job_success", title: "Success",
          message: "Done", isRead: false, createdAt: "2024-01-01T00:00:00.000Z",
        },
      ];
      mockAqDb.listNotifications.mockReturnValue(mockNotifications);
      mockAqDb.countNotifications.mockReturnValue(1);
      mockAqDb.countUnreadNotifications.mockReturnValue(1);

      const res = await app.request("/api/notifications");
      expect(res.status).toBe(200);
      const body = await res.json() as {
        notifications: unknown[];
        total: number;
        unreadCount: number;
        pagination: { total: number; offset: number; hasMore: boolean };
      };
      expect(body.notifications).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(body.unreadCount).toBe(1);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.hasMore).toBe(false);
    });

    it("isRead=false 쿼리로 미읽은 필터가 전달된다", async () => {
      const res = await app.request("/api/notifications?isRead=false");
      expect(res.status).toBe(200);
      expect(mockAqDb.listNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ isRead: false })
      );
    });

    it("isRead=true 쿼리로 읽은 필터가 전달된다", async () => {
      const res = await app.request("/api/notifications?isRead=true");
      expect(res.status).toBe(200);
      expect(mockAqDb.listNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ isRead: true })
      );
    });

    it("isRead 파라미터 없이 전체 목록을 요청한다", async () => {
      const res = await app.request("/api/notifications");
      expect(res.status).toBe(200);
      const call = mockAqDb.listNotifications.mock.calls[0][0] as { isRead?: boolean };
      expect(call?.isRead).toBeUndefined();
    });

    it("limit/offset 쿼리 파라미터를 DB 호출에 전달한다", async () => {
      mockAqDb.countNotifications.mockReturnValue(20);
      const res = await app.request("/api/notifications?limit=5&offset=10");
      expect(res.status).toBe(200);
      expect(mockAqDb.listNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 5, offset: 10 })
      );
    });

    it("hasMore가 올바르게 계산된다", async () => {
      mockAqDb.listNotifications.mockReturnValue([{ id: 1 }, { id: 2 }]);
      mockAqDb.countNotifications.mockReturnValue(5);
      mockAqDb.countUnreadNotifications.mockReturnValue(2);

      const res = await app.request("/api/notifications?limit=2&offset=0");
      expect(res.status).toBe(200);
      const body = await res.json() as { pagination: { hasMore: boolean } };
      expect(body.pagination.hasMore).toBe(true);
    });

    it("음수 limit에 400을 반환한다", async () => {
      const res = await app.request("/api/notifications?limit=-1");
      expect(res.status).toBe(400);
    });

    it("0 limit에 400을 반환한다", async () => {
      const res = await app.request("/api/notifications?limit=0");
      expect(res.status).toBe(400);
    });

    it("잘못된 isRead 값에 400을 반환한다", async () => {
      const res = await app.request("/api/notifications?isRead=maybe");
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/notifications/read-all", () => {
    it("모든 알림을 읽음 처리하고 count와 status를 반환한다", async () => {
      mockAqDb.markAllNotificationsRead.mockReturnValue(4);
      const res = await app.request("/api/notifications/read-all", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json() as { status: string; count: number };
      expect(body.status).toBe("ok");
      expect(body.count).toBe(4);
      expect(mockAqDb.markAllNotificationsRead).toHaveBeenCalledOnce();
    });

    it("미읽은 알림이 없어도 정상 응답한다", async () => {
      mockAqDb.markAllNotificationsRead.mockReturnValue(0);
      const res = await app.request("/api/notifications/read-all", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json() as { status: string; count: number };
      expect(body.status).toBe("ok");
      expect(body.count).toBe(0);
    });
  });

  describe("POST /api/notifications/:id/read", () => {
    it("특정 알림을 읽음 처리하고 id를 반환한다", async () => {
      mockAqDb.markNotificationRead.mockReturnValue(true);
      const res = await app.request("/api/notifications/1/read", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json() as { status: string; id: number };
      expect(body.status).toBe("ok");
      expect(body.id).toBe(1);
      expect(mockAqDb.markNotificationRead).toHaveBeenCalledWith(1);
    });

    it("숫자가 아닌 ID에 400을 반환한다", async () => {
      const res = await app.request("/api/notifications/abc/read", { method: "POST" });
      expect(res.status).toBe(400);
    });

    it("0 ID에 400을 반환한다", async () => {
      const res = await app.request("/api/notifications/0/read", { method: "POST" });
      expect(res.status).toBe(400);
    });

    it("음수 ID에 400을 반환한다", async () => {
      const res = await app.request("/api/notifications/-1/read", { method: "POST" });
      expect(res.status).toBe(400);
    });

    it("존재하지 않는 알림 ID에 404를 반환한다", async () => {
      mockAqDb.markNotificationRead.mockReturnValue(false);
      const res = await app.request("/api/notifications/9999/read", { method: "POST" });
      expect(res.status).toBe(404);
    });
  });
});
