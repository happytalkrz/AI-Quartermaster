import { describe, it, expect } from "vitest";
import { mapStepToCategory, checkJobStuck } from "../../src/queue/stuck-detector.js";
import type { ClaudeStatus } from "../../src/queue/stuck-detector.js";
import type { JobBase } from "../../src/types/pipeline.js";
import type { StuckThresholdConfig } from "../../src/types/config.js";

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLDS: StuckThresholdConfig = {
  defaultMs: 600_000,        // 10분
  planGenerationMs: 600_000, // 10분
  implementationMs: 900_000, // 15분
  reviewMs: 600_000,         // 10분
  verificationMs: 1_200_000, // 20분
  publishMs: 300_000,        // 5분
  activityThresholdMs: 300_000, // 5분
};

function makeJob(overrides: Partial<JobBase> = {}): JobBase {
  return {
    id: "test-job-1",
    issueNumber: 1,
    repo: "test/repo",
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

function msAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

const ALIVE_RECENT: ClaudeStatus = { processAlive: true, lastActivityMs: 60_000 };   // 1분 전 활동
const ALIVE_STALE: ClaudeStatus = { processAlive: true, lastActivityMs: 400_000 };   // 6.7분 전 (>5분)
const ALIVE_NO_DATA: ClaudeStatus = { processAlive: true, lastActivityMs: -1 };       // 활동 데이터 없음
const DEAD: ClaudeStatus = { processAlive: false, lastActivityMs: -1 };

// ────────────────────────────────────────────────────────────
// mapStepToCategory
// ────────────────────────────────────────────────────────────

describe("mapStepToCategory", () => {
  it("undefined → default", () => {
    expect(mapStepToCategory(undefined)).toBe("default");
  });

  it("빈 문자열 → default", () => {
    expect(mapStepToCategory("")).toBe("default");
  });

  it("'plan' 포함 → planGeneration", () => {
    expect(mapStepToCategory("plan generation")).toBe("planGeneration");
    expect(mapStepToCategory("PLAN")).toBe("planGeneration");
    expect(mapStepToCategory("generating plan for issue")).toBe("planGeneration");
  });

  it("'phase' 포함 → implementation", () => {
    expect(mapStepToCategory("phase 1")).toBe("implementation");
    expect(mapStepToCategory("Phase 2: implementation")).toBe("implementation");
  });

  it("'implementation' 포함 → implementation", () => {
    expect(mapStepToCategory("implementation")).toBe("implementation");
    expect(mapStepToCategory("Running implementation")).toBe("implementation");
  });

  it("'review' 포함 → review", () => {
    expect(mapStepToCategory("code review")).toBe("review");
    expect(mapStepToCategory("REVIEW")).toBe("review");
  });

  it("'simplify' 포함 → review", () => {
    expect(mapStepToCategory("simplify code")).toBe("review");
  });

  it("'validation' 포함 → verification", () => {
    expect(mapStepToCategory("final validation")).toBe("verification");
  });

  it("'tsc' 포함 → verification", () => {
    expect(mapStepToCategory("running tsc check")).toBe("verification");
    expect(mapStepToCategory("TSC")).toBe("verification");
  });

  it("'vitest' 포함 → verification", () => {
    expect(mapStepToCategory("running vitest")).toBe("verification");
  });

  it("'push' 포함 → publish", () => {
    expect(mapStepToCategory("git push")).toBe("publish");
    expect(mapStepToCategory("PUSH")).toBe("publish");
  });

  it("'pr' 포함 → publish", () => {
    expect(mapStepToCategory("creating pr")).toBe("publish");
    expect(mapStepToCategory("PR creation")).toBe("publish");
  });

  it("'publish' 포함 → publish", () => {
    expect(mapStepToCategory("publish release")).toBe("publish");
  });

  it("알 수 없는 키워드 → default", () => {
    expect(mapStepToCategory("unknown step xyz")).toBe("default");
    expect(mapStepToCategory("fetching issue")).toBe("default");
  });
});

// ────────────────────────────────────────────────────────────
// checkJobStuck — phase별 threshold
// ────────────────────────────────────────────────────────────

describe("checkJobStuck — phase별 threshold 적용", () => {
  describe("implementation phase (임계값 15분)", () => {
    it("10분 경과 → not stuck (임계값 이내)", () => {
      const job = makeJob({
        currentStep: "phase 1",
        lastUpdatedAt: msAgo(10 * 60_000),
      });
      const result = checkJobStuck(job, DEFAULT_THRESHOLDS, DEAD);
      expect(result.isStuck).toBe(false);
      expect(result.category).toBe("implementation");
      expect(result.thresholdMs).toBe(900_000);
    });

    it("15분 이상 경과 + Claude 무응답 → stuck", () => {
      const job = makeJob({
        currentStep: "phase 2: implementation",
        lastUpdatedAt: msAgo(16 * 60_000),
      });
      const result = checkJobStuck(job, DEFAULT_THRESHOLDS, ALIVE_STALE);
      expect(result.isStuck).toBe(true);
      expect(result.category).toBe("implementation");
    });
  });

  describe("verification phase (임계값 20분)", () => {
    it("15분 경과 → not stuck (임계값 이내)", () => {
      const job = makeJob({
        currentStep: "running tsc",
        lastUpdatedAt: msAgo(15 * 60_000),
      });
      const result = checkJobStuck(job, DEFAULT_THRESHOLDS, DEAD);
      expect(result.isStuck).toBe(false);
      expect(result.category).toBe("verification");
      expect(result.thresholdMs).toBe(1_200_000);
    });

    it("20분 이상 경과 + Claude 무응답 → stuck", () => {
      const job = makeJob({
        currentStep: "running vitest",
        lastUpdatedAt: msAgo(21 * 60_000),
      });
      const result = checkJobStuck(job, DEFAULT_THRESHOLDS, ALIVE_STALE);
      expect(result.isStuck).toBe(true);
      expect(result.category).toBe("verification");
    });
  });

  describe("publish phase (임계값 5분)", () => {
    it("3분 경과 → not stuck (임계값 이내)", () => {
      const job = makeJob({
        currentStep: "git push",
        lastUpdatedAt: msAgo(3 * 60_000),
      });
      const result = checkJobStuck(job, DEFAULT_THRESHOLDS, DEAD);
      expect(result.isStuck).toBe(false);
      expect(result.category).toBe("publish");
      expect(result.thresholdMs).toBe(300_000);
    });

    it("5분 이상 경과 + Claude 무응답 → stuck", () => {
      const job = makeJob({
        currentStep: "creating pr",
        lastUpdatedAt: msAgo(6 * 60_000),
      });
      const result = checkJobStuck(job, DEFAULT_THRESHOLDS, ALIVE_STALE);
      expect(result.isStuck).toBe(true);
      expect(result.category).toBe("publish");
    });
  });
});

// ────────────────────────────────────────────────────────────
// checkJobStuck — currentStep undefined → defaultMs fallback
// ────────────────────────────────────────────────────────────

describe("checkJobStuck — currentStep undefined → defaultMs fallback", () => {
  it("currentStep 없으면 defaultMs(10분) 적용", () => {
    const job = makeJob({
      currentStep: undefined,
      lastUpdatedAt: msAgo(8 * 60_000), // 8분: defaultMs(10분) 이내
    });
    const result = checkJobStuck(job, DEFAULT_THRESHOLDS, DEAD);
    expect(result.isStuck).toBe(false);
    expect(result.category).toBe("default");
    expect(result.thresholdMs).toBe(600_000);
  });

  it("currentStep 없고 defaultMs 초과 + Claude 무응답 → stuck", () => {
    const job = makeJob({
      currentStep: undefined,
      lastUpdatedAt: msAgo(25 * 60_000), // 25분: 2x(10분) 초과
    });
    const result = checkJobStuck(job, DEFAULT_THRESHOLDS, DEAD);
    expect(result.isStuck).toBe(true);
    expect(result.category).toBe("default");
  });
});

// ────────────────────────────────────────────────────────────
// checkJobStuck — Claude 프로세스 상태 기반 판단
// ────────────────────────────────────────────────────────────

describe("checkJobStuck — Claude 프로세스 + 활동 기반 판단", () => {
  it("Claude 살아있고 최근 활동 있음 → not stuck (임계값 초과해도)", () => {
    const job = makeJob({
      currentStep: "phase 1",
      lastUpdatedAt: msAgo(20 * 60_000), // 15분 임계값 초과
    });
    // ALIVE_RECENT: lastActivityMs = 60_000 (< activityThresholdMs 300_000)
    const result = checkJobStuck(job, DEFAULT_THRESHOLDS, ALIVE_RECENT);
    expect(result.isStuck).toBe(false);
    expect(result.reason).toMatch(/Claude 활동 중/);
  });

  it("Claude 살아있고 활동 없음(stale) → stuck", () => {
    const job = makeJob({
      currentStep: "phase 1",
      lastUpdatedAt: msAgo(20 * 60_000), // 15분 임계값 초과
    });
    // ALIVE_STALE: lastActivityMs = 400_000 (>= activityThresholdMs 300_000)
    const result = checkJobStuck(job, DEFAULT_THRESHOLDS, ALIVE_STALE);
    expect(result.isStuck).toBe(true);
  });

  it("Claude 살아있고 활동 데이터 없음(-1) → stuck", () => {
    const job = makeJob({
      currentStep: "phase 1",
      lastUpdatedAt: msAgo(20 * 60_000),
    });
    // ALIVE_NO_DATA: lastActivityMs = -1
    const result = checkJobStuck(job, DEFAULT_THRESHOLDS, ALIVE_NO_DATA);
    expect(result.isStuck).toBe(true);
  });

  it("Claude 프로세스 없음 + 임계값 초과이나 2x 이내 → not stuck (파이프라인 단계)", () => {
    // publish 임계값 5분, 2x = 10분
    const job = makeJob({
      currentStep: "creating pr",
      lastUpdatedAt: msAgo(7 * 60_000), // 5분 초과, 10분 이내
    });
    const result = checkJobStuck(job, DEFAULT_THRESHOLDS, DEAD);
    expect(result.isStuck).toBe(false);
    expect(result.reason).toMatch(/파이프라인 단계/);
  });

  it("Claude 프로세스 없음 + 2x 임계값 초과 → stuck", () => {
    // publish 임계값 5분, 2x = 10분
    const job = makeJob({
      currentStep: "creating pr",
      lastUpdatedAt: msAgo(11 * 60_000), // 10분 초과
    });
    const result = checkJobStuck(job, DEFAULT_THRESHOLDS, DEAD);
    expect(result.isStuck).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// checkJobStuck — activityThresholdMs 설정값 반영
// ────────────────────────────────────────────────────────────

describe("checkJobStuck — activityThresholdMs 설정값 반영", () => {
  it("activityThresholdMs를 1분으로 줄이면 1분 활동도 stale로 판단", () => {
    const strictThresholds: StuckThresholdConfig = {
      ...DEFAULT_THRESHOLDS,
      activityThresholdMs: 30_000, // 30초
    };
    const job = makeJob({
      currentStep: "phase 1",
      lastUpdatedAt: msAgo(20 * 60_000), // threshold 초과
    });
    // lastActivityMs = 60_000 (1분) > activityThresholdMs(30초) → stuck
    const result = checkJobStuck(job, strictThresholds, ALIVE_RECENT);
    expect(result.isStuck).toBe(true);
  });

  it("activityThresholdMs를 10분으로 늘리면 5분 활동도 recent로 판단", () => {
    const lenientThresholds: StuckThresholdConfig = {
      ...DEFAULT_THRESHOLDS,
      activityThresholdMs: 600_000, // 10분
    };
    const job = makeJob({
      currentStep: "phase 1",
      lastUpdatedAt: msAgo(20 * 60_000),
    });
    // ALIVE_STALE: lastActivityMs = 400_000 (< activityThresholdMs 600_000) → not stuck
    const result = checkJobStuck(job, lenientThresholds, ALIVE_STALE);
    expect(result.isStuck).toBe(false);
    expect(result.reason).toMatch(/Claude 활동 중/);
  });
});

// ────────────────────────────────────────────────────────────
// checkJobStuck — StuckCheckResult 구조 확인
// ────────────────────────────────────────────────────────────

describe("checkJobStuck — 반환값 구조", () => {
  it("isStuck=false 시 elapsedMs, thresholdMs, category, reason 반환", () => {
    const job = makeJob({
      currentStep: "phase 1",
      lastUpdatedAt: msAgo(5 * 60_000),
    });
    const result = checkJobStuck(job, DEFAULT_THRESHOLDS, DEAD);
    expect(result).toMatchObject({
      isStuck: false,
      category: "implementation",
      thresholdMs: 900_000,
    });
    expect(typeof result.elapsedMs).toBe("number");
    expect(typeof result.reason).toBe("string");
  });

  it("isStuck=true 시 reason에 시간 정보 포함", () => {
    const job = makeJob({
      currentStep: "creating pr",
      lastUpdatedAt: msAgo(11 * 60_000),
    });
    const result = checkJobStuck(job, DEFAULT_THRESHOLDS, DEAD);
    expect(result.isStuck).toBe(true);
    expect(result.reason.length).toBeGreaterThan(0);
  });
});
