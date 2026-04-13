/**
 * metrics API 테스트
 * GET /api/metrics/throughput, GET /api/metrics/success-rate
 *
 * 테스트 전략:
 *  - 쿼리 함수 직접 호출 (in-memory SQLite AQDatabase)
 *  - HTTP 400 검증은 inline Hono app 사용
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { AQDatabase } from "../../src/store/database.js";
import type { DatabaseJob } from "../../src/store/database.js";
import { getThroughputTimeSeries, getSuccessRate } from "../../src/store/queries.js";
import { GetMetricsQuerySchema, formatZodError } from "../../src/types/api.js";

vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  setGlobalLogLevel: vi.fn(),
}));

vi.mock("../../src/config/project-resolver.js", () => ({
  AQM_HOME: "/tmp",
}));

// ── 헬퍼 ────────────────────────────────────────────────────────────────────

function makeJob(id: string, overrides: Partial<DatabaseJob> = {}): DatabaseJob {
  return {
    id,
    issueNumber: 1,
    repo: "test/repo",
    status: "success",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** N일 전 자정(UTC) ISO 문자열 */
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

/** ISO 문자열에서 YYYY-MM-DD 추출 */
function toDate(iso: string): string {
  return iso.slice(0, 10);
}

// ── 테스트 ───────────────────────────────────────────────────────────────────

describe("metrics API", () => {
  let db: AQDatabase;

  beforeEach(() => {
    db = new AQDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  // ── throughput ────────────────────────────────────────────────────────────

  describe("throughput", () => {
    it("빈 DB 시 빈 series 반환", () => {
      const result = getThroughputTimeSeries(db, { window: "7d" });

      expect(result.window).toBe("7d");
      expect(result.project).toBeNull();
      expect(result.series).toEqual([]);
    });

    it("여러 날짜의 잡 삽입 후 일별 카운트 검증", () => {
      const day2 = daysAgo(2);
      const day1 = daysAgo(1);

      // day2에 잡 2개, day1에 잡 1개
      db.createJob(makeJob("j1", { issueNumber: 1, createdAt: day2 }));
      db.createJob(makeJob("j2", { issueNumber: 2, createdAt: day2 }));
      db.createJob(makeJob("j3", { issueNumber: 3, createdAt: day1 }));

      const result = getThroughputTimeSeries(db, { window: "7d" });

      expect(result.series).toHaveLength(2);

      const entryDay2 = result.series.find(s => s.date === toDate(day2));
      const entryDay1 = result.series.find(s => s.date === toDate(day1));
      expect(entryDay2?.count).toBe(2);
      expect(entryDay1?.count).toBe(1);
    });

    it("window=7d 범위 밖 잡은 제외", () => {
      const inside = daysAgo(3);  // 7d 이내
      const outside = daysAgo(10); // 7d 초과

      db.createJob(makeJob("j-in", { issueNumber: 1, createdAt: inside }));
      db.createJob(makeJob("j-out", { issueNumber: 2, createdAt: outside }));

      const result = getThroughputTimeSeries(db, { window: "7d" });

      expect(result.series).toHaveLength(1);
      expect(result.series[0].date).toBe(toDate(inside));
      expect(result.series[0].count).toBe(1);
    });

    it("project 필터 동작", () => {
      const today = daysAgo(1);
      db.createJob(makeJob("j-a", { repo: "org/project-a", issueNumber: 1, createdAt: today }));
      db.createJob(makeJob("j-b", { repo: "org/project-b", issueNumber: 1, createdAt: today }));

      const result = getThroughputTimeSeries(db, { window: "7d", project: "org/project-a" });

      const totalCount = result.series.reduce((sum, s) => sum + s.count, 0);
      expect(totalCount).toBe(1);
      expect(result.project).toBe("org/project-a");
    });
  });

  // ── success-rate ──────────────────────────────────────────────────────────

  describe("success-rate", () => {
    it("단순 성공/실패 비율", () => {
      const t = daysAgo(1);
      db.createJob(makeJob("j-s", { issueNumber: 1, status: "success", createdAt: t }));
      db.createJob(makeJob("j-f", { issueNumber: 2, status: "failure", createdAt: t }));

      const result = getSuccessRate(db, { window: "7d" });

      expect(result.total).toBe(2);
      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(1);
      expect(result.retrySuccessCount).toBe(0);
      expect(result.successRate).toBe(50);
      expect(result.failureRate).toBe(50);
      expect(result.retrySuccessRate).toBe(0);
    });

    it("동일 이슈 재시도 후 성공 → retrySuccessCount=1, failureCount=0", () => {
      // 같은 issue_number, 같은 repo
      // 먼저 실패 잡, 이후 성공 잡
      const t1 = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2시간 전
      const t2 = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1시간 전

      db.createJob(makeJob("j-fail", { issueNumber: 1, status: "failure", createdAt: t1 }));
      db.createJob(makeJob("j-success", { issueNumber: 1, status: "success", createdAt: t2 }));

      const result = getSuccessRate(db, { window: "7d" });

      // 최신 잡(j-success)만 집계 대상. 이전 failure가 존재하므로 retrySuccess
      expect(result.total).toBe(1);
      expect(result.retrySuccessCount).toBe(1);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(0);
    });

    it("동일 이슈 최신 잡이 failure면 failure로 카운트", () => {
      const t1 = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2시간 전
      const t2 = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1시간 전

      db.createJob(makeJob("j-success", { issueNumber: 1, status: "success", createdAt: t1 }));
      db.createJob(makeJob("j-fail", { issueNumber: 1, status: "failure", createdAt: t2 }));

      const result = getSuccessRate(db, { window: "7d" });

      // 최신 잡(j-fail)이 failure → failure로 카운트
      expect(result.total).toBe(1);
      expect(result.failureCount).toBe(1);
      expect(result.successCount).toBe(0);
      expect(result.retrySuccessCount).toBe(0);
    });
  });

  // ── 파라미터 검증 ─────────────────────────────────────────────────────────

  describe("window 파라미터 검증", () => {
    it("잘못된 window 파라미터 시 400 반환", async () => {
      // GetMetricsQuerySchema 검증 로직을 inline Hono app으로 테스트
      const app = new Hono();
      app.get("/api/metrics/throughput", (c) => {
        const queryParams = {
          window: c.req.query("window"),
          project: c.req.query("project"),
        };
        const parseResult = GetMetricsQuerySchema.safeParse(queryParams);
        if (!parseResult.success) {
          return c.json(
            { error: "Invalid query parameters", details: formatZodError(parseResult.error) },
            400,
          );
        }
        return c.json({ ok: true });
      });

      const res = await app.request("/api/metrics/throughput?window=invalid");

      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("Invalid query parameters");
    });
  });
});
