/**
 * Dashboard API automation 관련 테스트
 *
 * 다루는 범위:
 *  - PUT /api/config: automations가 더 이상 명시적으로 필터아웃되지 않음 (Phase 3 fix)
 *  - applyConfigChanges: automations 변경 시 scheduler.updateAutomationRules 호출
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { EventEmitter } from "events";
import { createDashboardRoutes, applyConfigChanges } from "../src/server/dashboard-api.js";
import type { JobStore } from "../src/queue/job-store.js";
import type { JobQueue } from "../src/queue/job-queue.js";
import type { AQConfig } from "../src/types/config.js";
import type { AutomationRule } from "../src/types/automation.js";
import { AutomationScheduler } from "../src/automation/scheduler.js";

// ── 공통 모킹 ────────────────────────────────────────────────────────────────
vi.mock("../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
  updateConfigSection: vi.fn(),
  addProjectToConfig: vi.fn(),
  removeProjectFromConfig: vi.fn(),
  updateProjectInConfig: vi.fn()
}));

vi.mock("../src/utils/config-masker.js", () => ({
  maskSensitiveConfig: vi.fn()
}));

vi.mock("../src/config/validator.js", () => ({
  validateConfig: vi.fn()
}));

vi.mock("../src/update/self-updater.js", () => ({
  SelfUpdater: vi.fn()
}));

vi.mock("../src/utils/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }),
  setGlobalLogLevel: vi.fn()
}));

vi.mock("../src/store/queries.js", () => ({
  getJobStats: vi.fn().mockReturnValue({
    total: 0, successCount: 0, failureCount: 0, runningCount: 0,
    queuedCount: 0, cancelledCount: 0, avgDurationMs: 0, successRate: 0,
    project: null, timeRange: "7d"
  }),
  getCostStats: vi.fn().mockReturnValue({
    project: null, timeRange: "30d", groupBy: "project",
    summary: { totalCostUsd: 0, jobCount: 0, avgCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCacheCreationTokens: 0, totalCacheReadTokens: 0 },
    breakdown: []
  }),
  getProjectSummary: vi.fn().mockReturnValue([])
}));

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn()
}));

vi.mock("../src/utils/cli-runner.js", () => ({
  runCli: vi.fn()
}));

vi.mock("node-cron", () => ({
  schedule: vi.fn().mockReturnValue({ stop: vi.fn() })
}));

vi.mock("../src/automation/rule-engine.js", () => ({
  evaluateRule: vi.fn(),
  executeAction: vi.fn()
}));

// ── Mock 인스턴스 ──────────────────────────────────────────────────────────────
const mockUpdateConfigSection = vi.mocked(
  (await import("../src/config/loader.js")).updateConfigSection
);

const globalEmitter = new EventEmitter();
const mockJobStore: JobStore = {
  list: vi.fn().mockReturnValue([]),
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  on: globalEmitter.on.bind(globalEmitter),
  emit: globalEmitter.emit.bind(globalEmitter),
  getAqDb: vi.fn().mockReturnValue({})
} as unknown as JobStore;

const mockJobQueue: JobQueue = {
  getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 }),
  cancel: vi.fn(),
  retryJob: vi.fn(),
  setConcurrency: vi.fn(),
  setProjectConcurrency: vi.fn()
} as unknown as JobQueue;

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────
function makeConfig(overrides: Partial<AQConfig> = {}): AQConfig {
  return {
    general: { concurrency: 2, logLevel: "info", dryRun: false, stuckTimeoutMs: 60000, maxJobs: 100 },
    projects: [],
    automations: [],
    ...overrides
  } as unknown as AQConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/config automations 저장 확인
// ─────────────────────────────────────────────────────────────────────────────
describe("PUT /api/config — automations 저장 확인", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createDashboardRoutes(mockJobStore, mockJobQueue);
  });

  it("valid config 업데이트 시 updateConfigSection이 호출됨", async () => {
    mockUpdateConfigSection.mockReturnValue(undefined);

    const response = await app.request("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ general: { logLevel: "debug" } })
    });

    expect(response.status).toBe(200);
    expect(mockUpdateConfigSection).toHaveBeenCalledWith(
      process.cwd(),
      expect.objectContaining({ general: expect.objectContaining({ logLevel: "debug" }) })
    );
  });

  it("automations 필드가 body에 포함돼도 400 에러가 발생하지 않음", async () => {
    // Phase 3 fix: automations는 더 이상 명시적으로 필터아웃되지 않음
    // Zod schema에 없으므로 strip되지만, 요청 자체는 성공해야 함
    mockUpdateConfigSection.mockReturnValue(undefined);

    const automationRules: AutomationRule[] = [
      { id: "r1", name: "R1", enabled: true, trigger: { type: "cron", schedule: "daily" }, actions: [{ type: "add-label", labels: ["auto"] }] }
    ];

    const response = await app.request("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        general: { logLevel: "info" },
        automations: automationRules
      })
    });

    // automations가 Zod에서 strip되더라도 요청 자체는 성공
    expect(response.status).toBe(200);
    const result = await response.json() as { success: boolean; message: string };
    expect(result.success).toBe(true);
  });

  it("automations만 포함된 body도 에러 없이 처리됨 (Zod strip)", async () => {
    mockUpdateConfigSection.mockReturnValue(undefined);

    const response = await app.request("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        automations: [{ id: "r1", name: "R1", trigger: { type: "cron", schedule: "daily" }, actions: [] }]
      })
    });

    // automations는 Zod에서 strip되므로 빈 객체로 처리되어 성공
    expect(response.status).toBe(200);
  });

  it("general과 함께 automations 전송 시 general 설정은 저장됨", async () => {
    mockUpdateConfigSection.mockReturnValue(undefined);

    const response = await app.request("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        general: { concurrency: 5 },
        automations: [{ id: "r1", name: "R1", trigger: { type: "cron", schedule: "daily" }, actions: [] }]
      })
    });

    expect(response.status).toBe(200);
    // general.concurrency는 저장되어야 함
    expect(mockUpdateConfigSection).toHaveBeenCalledWith(
      process.cwd(),
      expect.objectContaining({ general: expect.objectContaining({ concurrency: 5 }) })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyConfigChanges — automation rules 업데이트
// ─────────────────────────────────────────────────────────────────────────────
describe("applyConfigChanges — automation rules 업데이트", () => {
  let mockScheduler: AutomationScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockScheduler = {
      updateAutomationRules: vi.fn(),
      updateConfig: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      isRunning: vi.fn().mockReturnValue(false)
    } as unknown as AutomationScheduler;
  });

  it("automation rules 변경 시 updateAutomationRules가 새 규칙으로 호출됨", () => {
    const oldRules: AutomationRule[] = [
      { id: "r1", name: "Old rule", trigger: { type: "cron", schedule: "daily" }, actions: [{ type: "add-label", labels: ["old"] }] }
    ];
    const newRules: AutomationRule[] = [
      { id: "r2", name: "New rule", trigger: { type: "cron", schedule: "weekly" }, actions: [{ type: "start-job" }] }
    ];

    const oldConfig = makeConfig({ automations: oldRules });
    const newConfig = makeConfig({ automations: newRules });

    applyConfigChanges(oldConfig, newConfig, mockJobQueue, mockScheduler);

    expect(vi.mocked(mockScheduler.updateAutomationRules)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(mockScheduler.updateAutomationRules)).toHaveBeenCalledWith(newRules);
  });

  it("automation rules가 동일하면 updateAutomationRules가 호출되지 않음", () => {
    const sameRules: AutomationRule[] = [
      { id: "r1", name: "Same rule", trigger: { type: "cron", schedule: "daily" }, actions: [{ type: "add-label", labels: ["tag"] }] }
    ];

    // 동일 참조를 사용하여 같은 내용임을 보장
    const oldConfig = makeConfig({ automations: JSON.parse(JSON.stringify(sameRules)) as AutomationRule[] });
    const newConfig = makeConfig({ automations: JSON.parse(JSON.stringify(sameRules)) as AutomationRule[] });

    applyConfigChanges(oldConfig, newConfig, mockJobQueue, mockScheduler);

    expect(vi.mocked(mockScheduler.updateAutomationRules)).not.toHaveBeenCalled();
  });

  it("hot-reload 시나리오: configChanged 이벤트 → updateAutomationRules 호출", () => {
    const initialRules: AutomationRule[] = [
      { id: "r1", name: "Initial", trigger: { type: "cron", schedule: "daily" }, actions: [{ type: "add-label", labels: ["v1"] }] }
    ];
    const updatedRules: AutomationRule[] = [
      { id: "r1", name: "Initial", trigger: { type: "cron", schedule: "daily" }, actions: [{ type: "add-label", labels: ["v1", "v2"] }] }
    ];

    // cli.ts의 configChanged 이벤트 핸들러와 동일한 패턴
    const effectiveConfig = makeConfig({ automations: initialRules });
    const newEffectiveConfig = makeConfig({ automations: updatedRules });

    applyConfigChanges(effectiveConfig, newEffectiveConfig, mockJobQueue, mockScheduler);

    // scheduler.updateAutomationRules가 업데이트된 규칙으로 호출됨
    expect(vi.mocked(mockScheduler.updateAutomationRules)).toHaveBeenCalledWith(updatedRules);
  });
});
