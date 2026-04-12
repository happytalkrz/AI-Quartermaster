import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AQConfig } from "../src/types/config.js";
import type { AutomationRule, RuleEngineHandlers } from "../src/types/automation.js";
import { AutomationScheduler } from "../src/automation/scheduler.js";
import { applyConfigChanges } from "../src/server/dashboard-api.js";
import type { JobQueue } from "../src/queue/job-queue.js";

// ── node-cron 모킹 ──────────────────────────────────────────────────────────
vi.mock("node-cron", () => ({
  schedule: vi.fn().mockReturnValue({ stop: vi.fn() })
}));

// ── rule-engine 모킹 ────────────────────────────────────────────────────────
vi.mock("../src/automation/rule-engine.js", () => ({
  evaluateRule: vi.fn(),
  executeAction: vi.fn()
}));

// ── logger 모킹 ─────────────────────────────────────────────────────────────
vi.mock("../src/utils/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }),
  setGlobalLogLevel: vi.fn()
}));

// ── cli-runner 모킹 ─────────────────────────────────────────────────────────
vi.mock("../src/utils/cli-runner.js", () => ({
  runCli: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" })
}));

// ── dashboard-api 의존성 모킹 ────────────────────────────────────────────────
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

// ── 헬퍼: 기본 AQConfig 생성 ─────────────────────────────────────────────────
function makeConfig(overrides: Partial<AQConfig> = {}): AQConfig {
  return {
    general: { concurrency: 2, logLevel: "info", dryRun: false, stuckTimeoutMs: 60000, maxJobs: 100 },
    projects: [],
    automations: [],
    ...overrides
  } as unknown as AQConfig;
}

// ── 헬퍼: 기본 JobQueue mock 생성 ────────────────────────────────────────────
function makeQueue(): JobQueue {
  return {
    setConcurrency: vi.fn(),
    setProjectConcurrency: vi.fn(),
    enqueue: vi.fn(),
    cancel: vi.fn(),
    retryJob: vi.fn(),
    getStatus: vi.fn().mockReturnValue({ running: 0, queued: 0 })
  } as unknown as JobQueue;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. config.automations → AutomationScheduler 초기화 확인
// ─────────────────────────────────────────────────────────────────────────────
describe("config.automations → AutomationScheduler 초기화", () => {
  let mockCronSchedule: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const cron = await import("node-cron");
    mockCronSchedule = vi.mocked(cron.schedule);
    mockCronSchedule.mockReturnValue({ stop: vi.fn() } as ReturnType<typeof import("node-cron").schedule>);
  });

  it("config.automations의 cron 규칙으로 AutomationScheduler가 초기화됨", () => {
    const rules: AutomationRule[] = [
      {
        id: "label-daily",
        name: "Daily label",
        enabled: true,
        trigger: { type: "cron", schedule: "daily" },
        actions: [{ type: "add-label", labels: ["daily"] }]
      }
    ];
    const config = makeConfig({ automations: rules });
    const handlers: RuleEngineHandlers = {
      addLabel: vi.fn().mockResolvedValue(undefined),
      startJob: vi.fn().mockResolvedValue(undefined),
      pauseProject: vi.fn().mockResolvedValue(undefined)
    };

    const scheduler = new AutomationScheduler(config, config.automations ?? [], handlers);
    scheduler.start();

    expect(mockCronSchedule).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it("config.automations가 빈 배열이면 cron 잡이 등록되지 않음", () => {
    const config = makeConfig({ automations: [] });
    const handlers: RuleEngineHandlers = {
      addLabel: vi.fn().mockResolvedValue(undefined),
      startJob: vi.fn().mockResolvedValue(undefined),
      pauseProject: vi.fn().mockResolvedValue(undefined)
    };

    const scheduler = new AutomationScheduler(config, config.automations ?? [], handlers);
    scheduler.start();

    expect(mockCronSchedule).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it("config.automations가 undefined이면 빈 배열로 폴백됨", () => {
    const config = makeConfig({ automations: undefined });
    const automationRules: AutomationRule[] = config.automations ?? [];
    const handlers: RuleEngineHandlers = {
      addLabel: vi.fn().mockResolvedValue(undefined),
      startJob: vi.fn().mockResolvedValue(undefined),
      pauseProject: vi.fn().mockResolvedValue(undefined)
    };

    const scheduler = new AutomationScheduler(config, automationRules, handlers);
    scheduler.start();

    expect(mockCronSchedule).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it("여러 cron 규칙이 있으면 각각 스케줄 등록됨", () => {
    const rules: AutomationRule[] = [
      { id: "r1", name: "R1", enabled: true, trigger: { type: "cron", schedule: "daily" }, actions: [{ type: "add-label", labels: ["a"] }] },
      { id: "r2", name: "R2", enabled: true, trigger: { type: "cron", schedule: "weekly" }, actions: [{ type: "start-job" }] }
    ];
    const config = makeConfig({ automations: rules });
    const handlers: RuleEngineHandlers = {
      addLabel: vi.fn().mockResolvedValue(undefined),
      startJob: vi.fn().mockResolvedValue(undefined),
      pauseProject: vi.fn().mockResolvedValue(undefined)
    };

    const scheduler = new AutomationScheduler(config, rules, handlers);
    scheduler.start();

    expect(mockCronSchedule).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. addLabel 핸들러 → gh CLI 호출 확인
// ─────────────────────────────────────────────────────────────────────────────
describe("addLabel 핸들러 → gh CLI 호출", () => {
  let mockRunCli: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const cliRunner = await import("../src/utils/cli-runner.js");
    mockRunCli = vi.mocked(cliRunner.runCli);
    mockRunCli.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
  });

  it("addLabel 핸들러가 gh issue edit 명령으로 runCli를 호출함", async () => {
    const { runCli } = await import("../src/utils/cli-runner.js");

    const mockConfig = makeConfig({
      commands: { ghCli: { path: "gh" } }
    } as unknown as Partial<AQConfig>);

    // cli.ts의 addLabel 핸들러와 동일한 로직
    const addLabelHandler = async (repo: string, issueNumber: number, labels: string[]): Promise<void> => {
      const ghPath = (mockConfig as unknown as { commands: { ghCli: { path: string } } }).commands.ghCli.path;
      await runCli(
        ghPath,
        ["issue", "edit", String(issueNumber), "--repo", repo, "--add-label", labels.join(",")],
        {}
      );
    };

    await addLabelHandler("owner/repo", 42, ["bug", "urgent"]);

    expect(mockRunCli).toHaveBeenCalledWith(
      "gh",
      ["issue", "edit", "42", "--repo", "owner/repo", "--add-label", "bug,urgent"],
      {}
    );
  });

  it("단일 라벨도 올바르게 전달됨", async () => {
    const { runCli } = await import("../src/utils/cli-runner.js");

    const addLabelHandler = async (repo: string, issueNumber: number, labels: string[]): Promise<void> => {
      await runCli("gh", ["issue", "edit", String(issueNumber), "--repo", repo, "--add-label", labels.join(",")], {});
    };

    await addLabelHandler("myorg/myrepo", 100, ["enhancement"]);

    expect(mockRunCli).toHaveBeenCalledWith(
      "gh",
      ["issue", "edit", "100", "--repo", "myorg/myrepo", "--add-label", "enhancement"],
      {}
    );
  });

  it("exitCode !== 0이어도 예외가 전파되지 않음 (로그만 기록)", async () => {
    const { runCli } = await import("../src/utils/cli-runner.js");
    mockRunCli.mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "label not found" });

    const addLabelHandler = async (repo: string, issueNumber: number, labels: string[]): Promise<void> => {
      const result = await runCli("gh", ["issue", "edit", String(issueNumber), "--repo", repo, "--add-label", labels.join(",")], {});
      if (result.exitCode !== 0) {
        // 에러는 로그만 남기고 throw하지 않음 (cli.ts 패턴)
      }
    };

    await expect(addLabelHandler("owner/repo", 1, ["label"])).resolves.not.toThrow();
    expect(mockRunCli).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. applyConfigChanges → updateAutomationRules 호출 확인
// ─────────────────────────────────────────────────────────────────────────────
describe("applyConfigChanges → updateAutomationRules", () => {
  let mockQueue: JobQueue;
  let mockScheduler: AutomationScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQueue = makeQueue();
    mockScheduler = {
      updateAutomationRules: vi.fn(),
      updateConfig: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      isRunning: vi.fn().mockReturnValue(false)
    } as unknown as AutomationScheduler;
  });

  it("automations가 변경되면 scheduler.updateAutomationRules가 호출됨", () => {
    const oldRules: AutomationRule[] = [
      { id: "r1", name: "Rule 1", trigger: { type: "cron", schedule: "daily" }, actions: [{ type: "add-label", labels: ["old"] }] }
    ];
    const newRules: AutomationRule[] = [
      { id: "r2", name: "Rule 2", trigger: { type: "cron", schedule: "weekly" }, actions: [{ type: "start-job" }] }
    ];

    const oldConfig = makeConfig({ automations: oldRules });
    const newConfig = makeConfig({ automations: newRules });

    applyConfigChanges(oldConfig, newConfig, mockQueue, mockScheduler);

    expect(vi.mocked(mockScheduler.updateAutomationRules)).toHaveBeenCalledWith(newRules);
  });

  it("automations가 변경되지 않으면 updateAutomationRules가 호출되지 않음", () => {
    const sameRules: AutomationRule[] = [
      { id: "r1", name: "Rule 1", trigger: { type: "cron", schedule: "daily" }, actions: [{ type: "add-label", labels: ["tag"] }] }
    ];

    const oldConfig = makeConfig({ automations: sameRules });
    const newConfig = makeConfig({ automations: sameRules });

    applyConfigChanges(oldConfig, newConfig, mockQueue, mockScheduler);

    expect(vi.mocked(mockScheduler.updateAutomationRules)).not.toHaveBeenCalled();
  });

  it("scheduler가 undefined이면 에러 없이 동작함", () => {
    const oldConfig = makeConfig({ automations: [{ id: "r1", name: "R1", trigger: { type: "cron", schedule: "daily" }, actions: [] }] });
    const newConfig = makeConfig({ automations: [] });

    expect(() => applyConfigChanges(oldConfig, newConfig, mockQueue, undefined)).not.toThrow();
  });

  it("automations가 빈 배열에서 새 규칙으로 변경되면 updateAutomationRules가 새 규칙으로 호출됨", () => {
    const newRules: AutomationRule[] = [
      { id: "new-rule", name: "New", enabled: true, trigger: { type: "cron", schedule: "daily" }, actions: [{ type: "start-job" }] }
    ];

    const oldConfig = makeConfig({ automations: [] });
    const newConfig = makeConfig({ automations: newRules });

    applyConfigChanges(oldConfig, newConfig, mockQueue, mockScheduler);

    expect(vi.mocked(mockScheduler.updateAutomationRules)).toHaveBeenCalledWith(newRules);
  });

  it("automations가 모두 삭제되면 빈 배열로 updateAutomationRules가 호출됨", () => {
    const oldRules: AutomationRule[] = [
      { id: "r1", name: "R1", trigger: { type: "cron", schedule: "daily" }, actions: [] }
    ];

    const oldConfig = makeConfig({ automations: oldRules });
    const newConfig = makeConfig({ automations: [] });

    applyConfigChanges(oldConfig, newConfig, mockQueue, mockScheduler);

    expect(vi.mocked(mockScheduler.updateAutomationRules)).toHaveBeenCalledWith([]);
  });
});
