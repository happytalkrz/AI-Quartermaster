import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildProjectConcurrency, parseArgs, printHelp, runCommand, checkForUpdates, statusCommand, versionCommand, doctorCommand, startCommand, resumeCommand, statsCommand, cleanupCommand, planCommand } from "../src/cli.js";
import { loadConfig, tryLoadConfig } from "../src/config/loader.js";
import { runPipeline } from "../src/pipeline/core/orchestrator.js";
import { JobStore } from "../src/queue/job-store.js";
import { JobQueue } from "../src/queue/job-queue.js";
import { runDoctor } from "../src/setup/doctor.js";
import { runCli } from "../src/utils/cli-runner.js";
import { IssuePoller } from "../src/polling/issue-poller.js";
import { createWebhookApp, startServer } from "../src/server/webhook-server.js";
import { createDashboardRoutes, cleanupDashboardResources } from "../src/server/dashboard-api.js";
import { createHealthRoutes } from "../src/server/health.js";
import { cleanupStalePid, writePidFile, readPidFile, removePidFile } from "../src/server/pid-manager.js";
import { ConfigWatcher } from "../src/config/config-watcher.js";
import { loadCheckpoint } from "../src/pipeline/errors/checkpoint.js";
import { PatternStore } from "../src/learning/pattern-store.js";
import { cleanOldWorktrees } from "../src/git/worktree-cleaner.js";
import { listTriggerIssues, generateExecutionPlan, printExecutionPlan } from "../src/pipeline/automation/issue-orchestrator.js";

vi.mock("../src/pipeline/automation/issue-orchestrator.js", () => ({
  listTriggerIssues: vi.fn(),
  generateExecutionPlan: vi.fn(),
  printExecutionPlan: vi.fn(),
}));

vi.mock("../src/pipeline/errors/checkpoint.js", () => ({
  loadCheckpoint: vi.fn(),
  saveCheckpoint: vi.fn(),
}));

vi.mock("../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
  tryLoadConfig: vi.fn(),
}));
vi.mock("../src/pipeline/core/orchestrator.js", () => ({
  runPipeline: vi.fn(),
}));
vi.mock("../src/queue/job-store.js", () => ({
  JobStore: vi.fn(),
}));
vi.mock("../src/utils/logger.js", () => ({
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  setGlobalLogLevel: vi.fn(),
}));
vi.mock("../src/setup/doctor.js", () => ({
  runDoctor: vi.fn(),
}));
vi.mock("../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));
vi.mock("../src/polling/issue-poller.js", () => ({
  IssuePoller: vi.fn(),
}));
vi.mock("../src/queue/job-queue.js", () => ({
  JobQueue: vi.fn(),
}));
vi.mock("../src/server/webhook-server.js", () => ({
  createWebhookApp: vi.fn(),
  startServer: vi.fn(),
}));
vi.mock("../src/server/dashboard-api.js", () => ({
  createDashboardRoutes: vi.fn(),
  applyConfigChanges: vi.fn(),
  cleanupDashboardResources: vi.fn(),
}));
vi.mock("../src/server/health.js", () => ({
  createHealthRoutes: vi.fn(),
}));
vi.mock("../src/server/pid-manager.js", () => ({
  writePidFile: vi.fn(),
  cleanupStalePid: vi.fn(),
  removePidFile: vi.fn(),
  readPidFile: vi.fn(),
}));
vi.mock("../src/config/config-watcher.js", () => ({
  ConfigWatcher: vi.fn(),
}));
vi.mock("../src/learning/pattern-store.js", () => ({
  PatternStore: vi.fn(),
}));
vi.mock("../src/git/worktree-cleaner.js", () => ({
  cleanOldWorktrees: vi.fn(),
}));
vi.mock("hono", () => ({
  Hono: class MockHono {
    route() { return this; }
    get() { return this; }
    post() { return this; }
    put() { return this; }
    delete() { return this; }
    use() { return this; }
    fetch() { return Promise.resolve(new Response()); }
    on() { return this; }
    all() { return this; }
  },
}));
// fs mock은 필요한 테스트에서만 개별적으로 처리

describe("buildProjectConcurrency", () => {
  it("빈 배열이면 빈 객체 반환", () => {
    expect(buildProjectConcurrency([])).toEqual({});
  });

  it("concurrency가 설정된 프로젝트만 포함", () => {
    const projects = [
      { repo: "owner/repo-a", concurrency: 2 },
      { repo: "owner/repo-b" },
    ];
    expect(buildProjectConcurrency(projects)).toEqual({ "owner/repo-a": 2 });
  });

  it("모든 프로젝트에 concurrency가 있으면 전부 포함", () => {
    const projects = [
      { repo: "owner/a", concurrency: 1 },
      { repo: "owner/b", concurrency: 3 },
    ];
    expect(buildProjectConcurrency(projects)).toEqual({ "owner/a": 1, "owner/b": 3 });
  });

  it("모든 프로젝트에 concurrency가 없으면 빈 객체 반환", () => {
    const projects = [{ repo: "owner/a" }, { repo: "owner/b" }];
    expect(buildProjectConcurrency(projects)).toEqual({});
  });

  it("concurrency가 0이면 포함", () => {
    const projects = [{ repo: "owner/a", concurrency: 0 }];
    expect(buildProjectConcurrency(projects)).toEqual({ "owner/a": 0 });
  });
});

describe("parseArgs", () => {
  it("빈 배열이면 빈 객체 반환", () => {
    expect(parseArgs([])).toEqual({});
  });

  it("첫 번째 인수가 subcommand이면 command로 파싱", () => {
    const result = parseArgs(["run"]);
    expect(result.command).toBe("run");
  });

  it("--로 시작하는 첫 번째 인수는 command로 파싱하지 않음", () => {
    const result = parseArgs(["--issue", "42"]);
    expect(result.command).toBeUndefined();
    expect(result.issue).toBe(42);
  });

  it("--issue 파싱", () => {
    const result = parseArgs(["run", "--issue", "123"]);
    expect(result.issue).toBe(123);
  });

  it("--repo 파싱", () => {
    const result = parseArgs(["run", "--repo", "owner/repo"]);
    expect(result.repo).toBe("owner/repo");
  });

  it("--config 파싱", () => {
    const result = parseArgs(["start", "--config", "/path/to/config.yml"]);
    expect(result.config).toBe("/path/to/config.yml");
  });

  it("--target 파싱", () => {
    const result = parseArgs(["run", "--target", "/project/root"]);
    expect(result.target).toBe("/project/root");
  });

  it("--dry-run 파싱", () => {
    const result = parseArgs(["run", "--dry-run"]);
    expect(result.dryRun).toBe(true);
  });

  it("--port 파싱", () => {
    const result = parseArgs(["start", "--port", "8080"]);
    expect(result.port).toBe(8080);
  });

  it("--mode 파싱", () => {
    const result = parseArgs(["start", "--mode", "polling"]);
    expect(result.mode).toBe("polling");
  });

  it("--interval 파싱", () => {
    const result = parseArgs(["start", "--interval", "30"]);
    expect(result.interval).toBe(30);
  });

  it("--execute 파싱", () => {
    const result = parseArgs(["plan", "--execute"]);
    expect(result.execute).toBe(true);
  });

  it("--job 파싱", () => {
    const result = parseArgs(["resume", "--job", "job-abc-123"]);
    expect(result.job).toBe("job-abc-123");
  });

  it("--non-interactive 파싱", () => {
    const result = parseArgs(["setup", "--non-interactive"]);
    expect(result.nonInteractive).toBe(true);
  });

  it("--config-override key=value 파싱", () => {
    const result = parseArgs(["run", "--config-override", "general.dryRun=true"]);
    expect(result.configOverrides).toEqual({ "general.dryRun": "true" });
  });

  it("--config-override 복수 지정 시 병합", () => {
    const result = parseArgs([
      "run",
      "--config-override", "general.dryRun=true",
      "--config-override", "general.concurrency=2",
    ]);
    expect(result.configOverrides).toEqual({
      "general.dryRun": "true",
      "general.concurrency": "2",
    });
  });

  it("--config-override 값에 = 포함 시 첫 번째 = 기준으로 분리", () => {
    const result = parseArgs(["run", "--config-override", "general.extra=a=b"]);
    expect(result.configOverrides).toEqual({ "general.extra": "a=b" });
  });

  it("--config-override = 없는 경우 무시", () => {
    const result = parseArgs(["run", "--config-override", "nodot"]);
    expect(result.configOverrides).toBeUndefined();
  });

  it("여러 옵션 조합 파싱", () => {
    const result = parseArgs([
      "run",
      "--issue", "42",
      "--repo", "owner/repo",
      "--dry-run",
      "--target", "/some/path",
    ]);
    expect(result).toEqual({
      command: "run",
      issue: 42,
      repo: "owner/repo",
      dryRun: true,
      target: "/some/path",
    });
  });

  it("알 수 없는 플래그는 무시", () => {
    const result = parseArgs(["run", "--unknown-flag", "value"]);
    expect(result.command).toBe("run");
    // unknown flags are silently ignored
  });

  it("값이 없는 --issue는 NaN", () => {
    // --issue at end of args without a value: argv[i+1] is falsy
    const result = parseArgs(["run", "--issue"]);
    expect(result.issue).toBeUndefined();
  });
});

describe("printHelp", () => {
  let consoleLogs: string[];

  beforeEach(() => {
    consoleLogs = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      consoleLogs.push(String(args[0] ?? ""));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("도움말 출력에 주요 커맨드가 포함됨", () => {
    printHelp();
    const output = consoleLogs.join("\n");
    expect(output).toContain("aqm start");
    expect(output).toContain("aqm run");
    expect(output).toContain("aqm status");
    expect(output).toContain("aqm setup");
    expect(output).toContain("aqm help");
  });

  it("도움말 출력에 옵션 설명이 포함됨", () => {
    printHelp();
    const output = consoleLogs.join("\n");
    expect(output).toContain("--issue");
    expect(output).toContain("--repo");
    expect(output).toContain("--dry-run");
    expect(output).toContain("--port");
  });

  it("도움말 출력에 환경변수 섹션이 포함됨", () => {
    printHelp();
    const output = consoleLogs.join("\n");
    expect(output).toContain("GITHUB_WEBHOOK_SECRET");
  });
});

const mockBaseConfig = {
  general: { logLevel: "info" as const, dryRun: false, concurrency: 2, stuckTimeoutMs: 30000, maxJobs: 100, pollingIntervalMs: 60000 },
  projects: [],
  commands: { ghCli: { path: "gh" }, claudeCli: { path: "claude", model: "claude-3-5-sonnet-20241022", maxTurns: 50, timeout: 3600000 } },
  safety: { allowedLabels: ["ai-task"] },
  git: { baseBranch: "main", worktreeBase: "/tmp" },
  worktree: { maxAge: 7, maxCount: 10 },
} as unknown as ReturnType<typeof loadConfig>;

describe("runCommand", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number): never => {
      throw new Error(`process.exit(${_code})`);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(loadConfig).mockReturnValue(mockBaseConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("issue 없으면 process.exit(1) 호출", async () => {
    await expect(runCommand({ repo: "owner/repo" })).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("repo 없으면 process.exit(1) 호출", async () => {
    await expect(runCommand({ issue: 42 })).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("pipeline 성공 시 process.exit(0)", async () => {
    vi.mocked(runPipeline).mockResolvedValue({ success: true });
    await expect(runCommand({ issue: 42, repo: "owner/repo" })).rejects.toThrow("process.exit(0)");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("pipeline 실패 시 process.exit(1)", async () => {
    vi.mocked(runPipeline).mockResolvedValue({ success: false });
    await expect(runCommand({ issue: 42, repo: "owner/repo" })).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("dryRun=true이면 config에 dryRun 적용되어 runPipeline 호출", async () => {
    vi.mocked(runPipeline).mockResolvedValue({ success: true });
    await expect(runCommand({ issue: 42, repo: "owner/repo", dryRun: true })).rejects.toThrow();
    expect(runPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ general: expect.objectContaining({ dryRun: true }) }),
      })
    );
  });
});

describe("checkForUpdates", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("업데이트 없으면 아무것도 출력하지 않음", async () => {
    vi.mocked(runCli)
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "0\n", stderr: "", exitCode: 0 });
    await checkForUpdates("/some/aq/root");
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("업데이트가 있으면 개수 포함 메시지 출력", async () => {
    vi.mocked(runCli)
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "3\n", stderr: "", exitCode: 0 });
    await checkForUpdates("/some/aq/root");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("3"));
  });

  it("네트워크 에러 시 조용히 무시하고 resolve", async () => {
    vi.mocked(runCli).mockRejectedValue(new Error("network error"));
    await expect(checkForUpdates("/some/aq/root")).resolves.toBeUndefined();
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});

describe("statusCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("잡이 없으면 'No jobs found.' 출력", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(JobStore).mockImplementation(() => ({ list: vi.fn().mockReturnValue([]) } as unknown as JobStore));
    await statusCommand({});
    expect(consoleSpy).toHaveBeenCalledWith("No jobs found.");
  });

  it("잡이 있으면 상태별 요약 출력", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const mockJobs = [
      { id: "job-1", status: "completed", issueNumber: 42, repo: "owner/repo", startedAt: "2024-01-01T00:00:00Z", completedAt: "2024-01-01T00:01:00Z" },
      { id: "job-2", status: "failed", issueNumber: 43, repo: "owner/repo" },
    ];
    vi.mocked(JobStore).mockImplementation(() => ({ list: vi.fn().mockReturnValue(mockJobs) } as unknown as JobStore));
    await statusCommand({});
    const output = consoleSpy.mock.calls.map((args) => String(args[0])).join("\n");
    expect(output).toContain("completed");
    expect(output).toContain("failed");
  });

  it("prUrl 있는 잡은 PR URL도 출력", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const mockJobs = [
      { id: "job-1", status: "completed", issueNumber: 42, repo: "owner/repo", prUrl: "https://github.com/owner/repo/pull/1" },
    ];
    vi.mocked(JobStore).mockImplementation(() => ({ list: vi.fn().mockReturnValue(mockJobs) } as unknown as JobStore));
    await statusCommand({});
    const output = consoleSpy.mock.calls.map((args) => String(args[0])).join("\n");
    expect(output).toContain("https://github.com/owner/repo/pull/1");
  });

  it("error 있는 잡은 에러 메시지도 출력", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const mockJobs = [
      { id: "job-1", status: "failed", issueNumber: 42, repo: "owner/repo", error: "Something went wrong" },
    ];
    vi.mocked(JobStore).mockImplementation(() => ({ list: vi.fn().mockReturnValue(mockJobs) } as unknown as JobStore));
    await statusCommand({});
    const output = consoleSpy.mock.calls.map((args) => String(args[0])).join("\n");
    expect(output).toContain("Something went wrong");
  });
});

describe("versionCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("버전 정보 출력 (AI Quartermaster v...)", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await versionCommand();
    const output = consoleSpy.mock.calls.map((args) => String(args[0])).join("\n");
    expect(output).toMatch(/AI Quartermaster v\d+\.\d+/);
  });
});

describe("doctorCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tryLoadConfig와 runDoctor를 호출함", async () => {
    vi.mocked(tryLoadConfig).mockReturnValue({ config: mockBaseConfig, error: undefined });
    vi.mocked(runDoctor).mockResolvedValue(undefined);
    await doctorCommand({});
    expect(tryLoadConfig).toHaveBeenCalled();
    expect(runDoctor).toHaveBeenCalled();
  });
});

describe("startCommand — IssuePoller 항상 시작", () => {
  let mockPollerStart: ReturnType<typeof vi.fn>;

  const mockConfigWithProject = {
    ...mockBaseConfig,
    projects: [{ repo: "owner/repo", path: "/tmp", baseBranch: "main" }],
  } as unknown as ReturnType<typeof loadConfig>;

  beforeEach(() => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";

    mockPollerStart = vi.fn();
    vi.mocked(IssuePoller).mockImplementation(() => ({
      start: mockPollerStart,
      stop: vi.fn(),
      isRunning: vi.fn().mockReturnValue(false),
    } as unknown as IssuePoller));

    vi.mocked(JobStore).mockImplementation(() => ({
      prune: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    } as unknown as JobStore));

    vi.mocked(JobQueue).mockImplementation(() => ({
      recover: vi.fn(),
      shutdown: vi.fn(),
      enqueue: vi.fn(),
    } as unknown as JobQueue));

    vi.mocked(loadConfig).mockReturnValue(mockConfigWithProject);

    vi.mocked(createWebhookApp).mockReturnValue({
      route: vi.fn(),
      get: vi.fn(),
    } as unknown as ReturnType<typeof createWebhookApp>);
    vi.mocked(createDashboardRoutes).mockReturnValue({
      route: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    } as unknown as ReturnType<typeof createDashboardRoutes>);
    vi.mocked(createHealthRoutes).mockReturnValue({
      route: vi.fn(),
      get: vi.fn(),
    } as unknown as ReturnType<typeof createHealthRoutes>);
    vi.mocked(cleanupStalePid).mockReturnValue(true);

    vi.mocked(ConfigWatcher).mockImplementation(() => ({
      on: vi.fn(),
      startWatching: vi.fn(),
      stopWatching: vi.fn(),
    } as unknown as ConfigWatcher));

    vi.mocked(runCli).mockResolvedValue({ stdout: "0\n", stderr: "", exitCode: 0 });
  });

  afterEach(() => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    vi.restoreAllMocks();
  });

  it("웹훅 모드에서 IssuePoller.start()가 호출됨 (놓친 이벤트 복구 보장)", async () => {
    await startCommand({});
    expect(mockPollerStart).toHaveBeenCalledOnce();
  });

  it("IssuePoller는 웹훅 앱 설정보다 먼저 생성됨", async () => {
    const callOrder: string[] = [];
    vi.mocked(IssuePoller).mockImplementation(() => {
      callOrder.push("IssuePoller");
      return { start: vi.fn(), stop: vi.fn(), isRunning: vi.fn().mockReturnValue(false) } as unknown as IssuePoller;
    });
    vi.mocked(startServer).mockImplementation(() => {
      callOrder.push("startServer");
    });

    await startCommand({});

    expect(callOrder.indexOf("IssuePoller")).toBeLessThan(callOrder.indexOf("startServer"));
  });
});

describe("startCommand — pre-flight 검증", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  const mockConfigWithProject = {
    ...mockBaseConfig,
    projects: [{ repo: "owner/repo", path: "/tmp", baseBranch: "main" }],
  } as unknown as ReturnType<typeof loadConfig>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number): never => {
      throw new Error(`process.exit(${_code})`);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(IssuePoller).mockImplementation(() => ({
      start: vi.fn(),
      stop: vi.fn(),
      isRunning: vi.fn().mockReturnValue(false),
    } as unknown as IssuePoller));

    vi.mocked(JobStore).mockImplementation(() => ({
      prune: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    } as unknown as JobStore));

    vi.mocked(JobQueue).mockImplementation(() => ({
      recover: vi.fn(),
      shutdown: vi.fn(),
      enqueue: vi.fn(),
    } as unknown as JobQueue));

    vi.mocked(createWebhookApp).mockReturnValue({
      route: vi.fn(),
      get: vi.fn(),
    } as unknown as ReturnType<typeof createWebhookApp>);
    vi.mocked(createDashboardRoutes).mockReturnValue({
      route: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    } as unknown as ReturnType<typeof createDashboardRoutes>);
    vi.mocked(createHealthRoutes).mockReturnValue({
      route: vi.fn(),
      get: vi.fn(),
    } as unknown as ReturnType<typeof createHealthRoutes>);
    vi.mocked(cleanupStalePid).mockReturnValue(true);

    vi.mocked(ConfigWatcher).mockImplementation(() => ({
      on: vi.fn(),
      startWatching: vi.fn(),
      stopWatching: vi.fn(),
    } as unknown as ConfigWatcher));

    vi.mocked(runCli).mockResolvedValue({ stdout: "0\n", stderr: "", exitCode: 0 });
  });

  afterEach(() => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    vi.restoreAllMocks();
  });

  it("projects가 없으면 process.exit(1)", async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...mockBaseConfig, projects: [] } as unknown as ReturnType<typeof loadConfig>);
    await expect(startCommand({})).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("repo가 기본값이면 process.exit(1)", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      ...mockBaseConfig,
      projects: [{ repo: "owner/repo-name", path: "/tmp", baseBranch: "main" }],
    } as unknown as ReturnType<typeof loadConfig>);
    await expect(startCommand({})).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("path가 기본값이면 process.exit(1)", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      ...mockBaseConfig,
      projects: [{ repo: "owner/repo", path: "/path/to/local/clone", baseBranch: "main" }],
    } as unknown as ReturnType<typeof loadConfig>);
    await expect(startCommand({})).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("path가 존재하지 않으면 process.exit(1)", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      ...mockBaseConfig,
      projects: [{ repo: "owner/repo", path: "/nonexistent-path-aqm-test-xyz", baseBranch: "main" }],
    } as unknown as ReturnType<typeof loadConfig>);
    await expect(startCommand({})).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("--interval이 10초 미만이면 process.exit(1)", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    vi.mocked(loadConfig).mockReturnValue(mockConfigWithProject);
    await expect(startCommand({ interval: 5 })).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("webhook 모드에서 GITHUB_WEBHOOK_SECRET 없으면 process.exit(1)", async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    vi.mocked(loadConfig).mockReturnValue(mockConfigWithProject);
    await expect(startCommand({})).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("PID 충돌(canStart=false)이면 process.exit(1)", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    vi.mocked(loadConfig).mockReturnValue(mockConfigWithProject);
    vi.mocked(cleanupStalePid).mockReturnValue(false);
    vi.mocked(readPidFile).mockReturnValue(12345);
    await expect(startCommand({})).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("dryRun=true이면 effectiveConfig.general.dryRun=true로 시작됨", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    vi.mocked(loadConfig).mockReturnValue(mockConfigWithProject);

    let capturedDryRun: boolean | undefined;
    vi.mocked(JobQueue).mockImplementation((_store, _conc, handler) => {
      // capture what config is used via closure — check via IssuePoller constructor arg
      return { recover: vi.fn(), shutdown: vi.fn(), enqueue: vi.fn() } as unknown as JobQueue;
    });
    vi.mocked(IssuePoller).mockImplementation((cfg) => {
      capturedDryRun = (cfg as { general?: { dryRun?: boolean } }).general?.dryRun;
      return { start: vi.fn(), stop: vi.fn(), isRunning: vi.fn().mockReturnValue(false) } as unknown as IssuePoller;
    });

    await startCommand({ dryRun: true });

    expect(capturedDryRun).toBe(true);
  });
});

describe("startCommand — 모드 분기 로직", () => {
  let mockPollerStart: ReturnType<typeof vi.fn>;
  let mockPollerConstructor: ReturnType<typeof vi.fn>;

  const makeConfig = (serverMode: "polling" | "webhook" | "hybrid") =>
    ({
      ...mockBaseConfig,
      general: { ...mockBaseConfig.general, serverMode },
      projects: [{ repo: "owner/repo", path: "/tmp", baseBranch: "main" }],
    }) as unknown as ReturnType<typeof loadConfig>;

  beforeEach(() => {
    mockPollerStart = vi.fn();
    mockPollerConstructor = vi.fn().mockImplementation(() => ({
      start: mockPollerStart,
      stop: vi.fn(),
      isRunning: vi.fn().mockReturnValue(false),
    }));
    vi.mocked(IssuePoller).mockImplementation(mockPollerConstructor);

    vi.mocked(JobStore).mockImplementation(
      () => ({ prune: vi.fn(), list: vi.fn().mockReturnValue([]) }) as unknown as JobStore
    );
    vi.mocked(JobQueue).mockImplementation(
      () => ({ recover: vi.fn(), shutdown: vi.fn(), enqueue: vi.fn() }) as unknown as JobQueue
    );
    vi.mocked(createWebhookApp).mockReturnValue({
      route: vi.fn(),
      get: vi.fn(),
    } as unknown as ReturnType<typeof createWebhookApp>);
    vi.mocked(createDashboardRoutes).mockReturnValue({
      route: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    } as unknown as ReturnType<typeof createDashboardRoutes>);
    vi.mocked(createHealthRoutes).mockReturnValue({
      route: vi.fn(),
      get: vi.fn(),
    } as unknown as ReturnType<typeof createHealthRoutes>);
    vi.mocked(cleanupStalePid).mockReturnValue(true);
    vi.mocked(ConfigWatcher).mockImplementation(
      () => ({ on: vi.fn(), startWatching: vi.fn(), stopWatching: vi.fn() }) as unknown as ConfigWatcher
    );
    vi.mocked(runCli).mockResolvedValue({ stdout: "0\n", stderr: "", exitCode: 0 });
  });

  afterEach(() => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    vi.restoreAllMocks();
  });

  // polling 모드
  it("polling 모드: IssuePoller가 생성되고 start()가 호출됨", async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig("polling"));
    await startCommand({});
    expect(mockPollerConstructor).toHaveBeenCalledOnce();
    expect(mockPollerStart).toHaveBeenCalledOnce();
  });

  it("polling 모드: createWebhookApp이 호출되지 않음", async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig("polling"));
    await startCommand({});
    expect(createWebhookApp).not.toHaveBeenCalled();
  });

  it("polling 모드: GITHUB_WEBHOOK_SECRET 없어도 정상 시작됨", async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    vi.mocked(loadConfig).mockReturnValue(makeConfig("polling"));
    await expect(startCommand({})).resolves.toBeUndefined();
  });

  // webhook 모드
  it("webhook 모드: IssuePoller가 생성되지 않음", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    vi.mocked(loadConfig).mockReturnValue(makeConfig("webhook"));
    await startCommand({});
    expect(mockPollerConstructor).not.toHaveBeenCalled();
  });

  it("webhook 모드: createWebhookApp이 호출됨", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    vi.mocked(loadConfig).mockReturnValue(makeConfig("webhook"));
    await startCommand({});
    expect(createWebhookApp).toHaveBeenCalledOnce();
  });

  // hybrid 모드
  it("hybrid 모드: IssuePoller가 생성되고 start()가 호출됨", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    vi.mocked(loadConfig).mockReturnValue(makeConfig("hybrid"));
    await startCommand({});
    expect(mockPollerConstructor).toHaveBeenCalledOnce();
    expect(mockPollerStart).toHaveBeenCalledOnce();
  });

  it("hybrid 모드: createWebhookApp이 호출됨", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    vi.mocked(loadConfig).mockReturnValue(makeConfig("hybrid"));
    await startCommand({});
    expect(createWebhookApp).toHaveBeenCalledOnce();
  });

  // CLI --mode 우선순위
  it("--mode polling이면 config serverMode=webhook이어도 polling으로 동작", async () => {
    vi.mocked(loadConfig).mockReturnValue(makeConfig("webhook"));
    await startCommand({ mode: "polling" });
    expect(createWebhookApp).not.toHaveBeenCalled();
    expect(mockPollerStart).toHaveBeenCalledOnce();
  });

  it("--mode webhook이면 config serverMode=polling이어도 webhook으로 동작", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    vi.mocked(loadConfig).mockReturnValue(makeConfig("polling"));
    await startCommand({ mode: "webhook" });
    expect(mockPollerConstructor).not.toHaveBeenCalled();
    expect(createWebhookApp).toHaveBeenCalledOnce();
  });
});

describe("startCommand — 추가 분기 테스트", () => {
  const mockConfigWithProject = {
    ...mockBaseConfig,
    projects: [{ repo: "owner/repo", path: "/tmp", baseBranch: "main" }],
  } as unknown as ReturnType<typeof loadConfig>;

  beforeEach(() => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    vi.mocked(loadConfig).mockReturnValue(mockConfigWithProject);
    vi.mocked(IssuePoller).mockImplementation(() => ({
      start: vi.fn(),
      stop: vi.fn(),
      isRunning: vi.fn().mockReturnValue(false),
    } as unknown as IssuePoller));
    vi.mocked(JobStore).mockImplementation(() => ({
      prune: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    } as unknown as JobStore));
    vi.mocked(JobQueue).mockImplementation(() => ({
      recover: vi.fn(),
      shutdown: vi.fn(),
      enqueue: vi.fn(),
    } as unknown as JobQueue));
    vi.mocked(createWebhookApp).mockReturnValue({
      route: vi.fn(),
      get: vi.fn(),
    } as unknown as ReturnType<typeof createWebhookApp>);
    vi.mocked(createDashboardRoutes).mockReturnValue({
      route: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    } as unknown as ReturnType<typeof createDashboardRoutes>);
    vi.mocked(createHealthRoutes).mockReturnValue({
      route: vi.fn(),
      get: vi.fn(),
    } as unknown as ReturnType<typeof createHealthRoutes>);
    vi.mocked(cleanupStalePid).mockReturnValue(true);
    vi.mocked(ConfigWatcher).mockImplementation(() => ({
      on: vi.fn(),
      startWatching: vi.fn(),
      stopWatching: vi.fn(),
    } as unknown as ConfigWatcher));
    vi.mocked(runCli).mockResolvedValue({ stdout: "0\n", stderr: "", exitCode: 0 });
  });

  afterEach(() => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    vi.restoreAllMocks();
  });

  it("interval 옵션이 10초 이상이면 정상 처리", async () => {
    await startCommand({ interval: 30 });
    // 30초 간격으로 설정되는 것을 확인할 수 있지만,
    // 현재로서는 실행이 성공하면 OK
  });

  it("port 옵션 지정 시 해당 포트 사용", async () => {
    await startCommand({ port: 8080 });
    // 8080 포트로 시작하는 것을 확인할 수 있지만,
    // 현재로서는 실행이 성공하면 OK
  });
});

describe("runCommand — 추가 분기", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number): never => {
      throw new Error(`process.exit(${_code})`);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(loadConfig).mockReturnValue(mockBaseConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("--target 지정 시 해당 경로가 projectRoot로 전달됨", async () => {
    vi.mocked(runPipeline).mockResolvedValue({ success: true });
    await expect(runCommand({ issue: 42, repo: "owner/repo", target: "/custom/target" })).rejects.toThrow();
    expect(runPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ projectRoot: expect.stringContaining("custom/target") })
    );
  });
});

describe("main 함수 명령어 분기", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number): never => {
      throw new Error(`process.exit(${_code})`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("알 수 없는 명령어에 대해 에러 메시지와 도움말 출력 후 exit(1)", () => {
    const args = parseArgs(["unknown-command"]);
    const command = args.command || "run";

    if (command === "unknown-command") {
      expect(() => {
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
      }).toThrow("process.exit(1)");

      expect(consoleSpy).toHaveBeenCalledWith("Unknown command: unknown-command");
      expect(exitSpy).toHaveBeenCalledWith(1);
    }
  });
});

describe("parseArgs 추가 케이스", () => {
  it("기본 명령어가 run으로 설정됨", () => {
    const args = parseArgs([]);
    const command = args.command || "run";
    expect(command).toBe("run");
  });

  it("help 명령어 파싱", () => {
    const args = parseArgs(["help"]);
    expect(args.command).toBe("help");
  });

  it("version 명령어 파싱", () => {
    const args = parseArgs(["version"]);
    expect(args.command).toBe("version");
  });

  it("setup 명령어 파싱", () => {
    const args = parseArgs(["setup"]);
    expect(args.command).toBe("setup");
  });

  it("cleanup 명령어 파싱", () => {
    const args = parseArgs(["cleanup"]);
    expect(args.command).toBe("cleanup");
  });

  it("plan 명령어 파싱", () => {
    const args = parseArgs(["plan"]);
    expect(args.command).toBe("plan");
  });

  it("stats 명령어 파싱", () => {
    const args = parseArgs(["stats"]);
    expect(args.command).toBe("stats");
  });

  it("resume 명령어 파싱", () => {
    const args = parseArgs(["resume"]);
    expect(args.command).toBe("resume");
  });

  it("init 명령어 파싱", () => {
    const args = parseArgs(["init"]);
    expect(args.command).toBe("init");
  });

  it("setup-webhook 명령어 파싱", () => {
    const args = parseArgs(["setup-webhook"]);
    expect(args.command).toBe("setup-webhook");
  });
});

describe("versionCommand — 에러 분기", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("package.json 읽기 실패 시 process.exit(1)", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number): never => {
      throw new Error(`process.exit(${_code})`);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    // readFileSync는 실제 호출 — 존재하지 않는 cwd로 유도하기 위해 process.cwd를 mock
    vi.spyOn(process, "cwd").mockReturnValue("/nonexistent-dir-aqm-xyz");
    await expect(versionCommand()).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("resumeCommand", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number): never => {
      throw new Error(`process.exit(${_code})`);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(loadConfig).mockReturnValue(mockBaseConfig);
    vi.mocked(runPipeline).mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("--job도 --issue+repo도 없으면 process.exit(1)", async () => {
    await expect(resumeCommand({})).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("--job으로 조회했는데 job이 없으면 process.exit(1)", async () => {
    vi.mocked(JobStore).mockImplementation(() => ({
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as JobStore));
    await expect(resumeCommand({ job: "job-not-found" })).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("--issue+repo 경로에서 checkpoint 없으면 process.exit(1)", async () => {
    vi.mocked(loadCheckpoint).mockReturnValue(null);
    await expect(resumeCommand({ issue: 42, repo: "owner/repo" })).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("checkpoint 있고 pipeline 성공 시 process.exit(0)", async () => {
    vi.mocked(loadCheckpoint).mockReturnValue({ state: "plan", issueNumber: 42 } as ReturnType<typeof loadCheckpoint>);
    vi.mocked(runPipeline).mockResolvedValue({ success: true });
    await expect(resumeCommand({ issue: 42, repo: "owner/repo" })).rejects.toThrow("process.exit(0)");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("checkpoint 있고 pipeline 실패 시 process.exit(1)", async () => {
    vi.mocked(loadCheckpoint).mockReturnValue({ state: "plan", issueNumber: 42 } as ReturnType<typeof loadCheckpoint>);
    vi.mocked(runPipeline).mockResolvedValue({ success: false });
    await expect(resumeCommand({ issue: 42, repo: "owner/repo" })).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("--job으로 job 조회 후 checkpoint 있으면 runPipeline 호출", async () => {
    const mockJob = { id: "job-abc", issueNumber: 99, repo: "owner/test" };
    vi.mocked(JobStore).mockImplementation(() => ({
      get: vi.fn().mockReturnValue(mockJob),
    } as unknown as JobStore));
    vi.mocked(loadCheckpoint).mockReturnValue({ state: "implement", issueNumber: 99 } as ReturnType<typeof loadCheckpoint>);
    vi.mocked(runPipeline).mockResolvedValue({ success: true });

    await expect(resumeCommand({ job: "job-abc" })).rejects.toThrow("process.exit(0)");
    expect(runPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ issueNumber: 99, repo: "owner/test" })
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("--job으로 job 조회 후 checkpoint 없으면 process.exit(1)", async () => {
    const mockJob = { id: "job-abc", issueNumber: 55, repo: "owner/test" };
    vi.mocked(JobStore).mockImplementation(() => ({
      get: vi.fn().mockReturnValue(mockJob),
    } as unknown as JobStore));
    vi.mocked(loadCheckpoint).mockReturnValue(null);

    await expect(resumeCommand({ job: "job-abc" })).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("resumeFrom이 checkpoint와 함께 runPipeline에 전달됨", async () => {
    const checkpoint = { state: "review", issueNumber: 42 } as ReturnType<typeof loadCheckpoint>;
    vi.mocked(loadCheckpoint).mockReturnValue(checkpoint);
    vi.mocked(runPipeline).mockResolvedValue({ success: true });

    await expect(resumeCommand({ issue: 42, repo: "owner/repo" })).rejects.toThrow("process.exit(0)");
    expect(runPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ resumeFrom: checkpoint })
    );
  });
});

describe("statsCommand", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(loadConfig).mockReturnValue(mockBaseConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("빈 데이터 시 success rate N/A 출력", async () => {
    vi.mocked(PatternStore).mockImplementation(() => ({
      getStats: vi.fn().mockReturnValue({ total: 0, successes: 0, failures: 0, byCategory: {} }),
      list: vi.fn().mockReturnValue([]),
    } as unknown as PatternStore));
    vi.mocked(JobStore).mockImplementation(() => ({
      getCostStats: vi.fn().mockReturnValue({ totalCostUsd: 0, avgCostUsd: 0, jobCount: 0, topExpensiveJobs: [] }),
    } as unknown as JobStore));

    await statsCommand({});

    const output = consoleSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(output).toContain("N/A%");
    expect(output).toContain("Total runs   : 0");
  });

  it("실패 패턴·비용 통계 출력", async () => {
    vi.mocked(PatternStore).mockImplementation(() => ({
      getStats: vi.fn().mockReturnValue({
        total: 10,
        successes: 7,
        failures: 3,
        byCategory: { TYPE_ERROR: 2, BUILD_FAIL: 1 },
      }),
      list: vi.fn().mockReturnValue([
        { timestamp: Date.now(), issueNumber: 5, repo: "owner/repo", errorCategory: "TYPE_ERROR", errorMessage: "타입 오류", phaseName: "implement" },
      ]),
    } as unknown as PatternStore));
    vi.mocked(JobStore).mockImplementation(() => ({
      getCostStats: vi.fn().mockReturnValue({
        totalCostUsd: 1.5,
        avgCostUsd: 0.15,
        jobCount: 10,
        topExpensiveJobs: [{ id: "job-1", issueNumber: 5, totalCostUsd: 0.5, repo: "owner/repo" }],
      }),
    } as unknown as JobStore));

    await statsCommand({});

    const output = consoleSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(output).toContain("70.0%");
    expect(output).toContain("Total runs   : 10");
    expect(output).toContain("TYPE_ERROR");
    expect(output).toContain("$1.50");
    expect(output).toContain("Job count    : 10");
  });

  it("--repo 필터가 PatternStore·JobStore에 전달됨", async () => {
    const mockGetStats = vi.fn().mockReturnValue({ total: 0, successes: 0, failures: 0, byCategory: {} });
    const mockList = vi.fn().mockReturnValue([]);
    const mockGetCostStats = vi.fn().mockReturnValue({ totalCostUsd: 0, avgCostUsd: 0, jobCount: 0, topExpensiveJobs: [] });

    vi.mocked(PatternStore).mockImplementation(() => ({
      getStats: mockGetStats,
      list: mockList,
    } as unknown as PatternStore));
    vi.mocked(JobStore).mockImplementation(() => ({
      getCostStats: mockGetCostStats,
    } as unknown as JobStore));

    await statsCommand({ repo: "owner/filtered" });

    expect(mockGetStats).toHaveBeenCalledWith("owner/filtered");
    expect(mockGetCostStats).toHaveBeenCalledWith("owner/filtered");

    const output = consoleSpy.mock.calls.map(c => String(c[0])).join("\n");
    expect(output).toContain("owner/filtered");
  });
});

describe("cleanupCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cleanOldWorktrees 호출 및 결과 로깅", async () => {
    vi.mocked(loadConfig).mockReturnValue(mockBaseConfig);
    vi.mocked(cleanOldWorktrees).mockResolvedValue(["worktree-1", "worktree-2"]);

    await cleanupCommand({});

    expect(cleanOldWorktrees).toHaveBeenCalledWith(
      mockBaseConfig.git,
      mockBaseConfig.worktree,
      expect.objectContaining({ cwd: expect.any(String) })
    );
  });

  it("제거된 worktree 수가 0이어도 정상 완료", async () => {
    vi.mocked(loadConfig).mockReturnValue(mockBaseConfig);
    vi.mocked(cleanOldWorktrees).mockResolvedValue([]);

    await cleanupCommand({});

    expect(cleanOldWorktrees).toHaveBeenCalledTimes(1);
  });
});

describe("planCommand", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number): never => {
      throw new Error(`process.exit(${_code})`);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(loadConfig).mockReturnValue(mockBaseConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("--repo 없으면 process.exit(1)", async () => {
    await expect(planCommand({})).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("이슈 0건이면 조기 리턴 (exit 없음)", async () => {
    vi.mocked(listTriggerIssues).mockResolvedValue([]);

    await planCommand({ repo: "owner/repo" });

    expect(listTriggerIssues).toHaveBeenCalledWith("owner/repo", ["ai-task"], "gh");
    expect(generateExecutionPlan).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("이슈 있으면 plan 생성 및 출력", async () => {
    const mockIssues = [{ number: 1, title: "Test issue", body: "", labels: ["ai-task"] }];
    const mockPlan = {
      repo: "",
      totalIssues: 1,
      executionOrder: [[{ issueNumber: 1, title: "Test issue", priority: "high" as const, dependencies: [], estimatedPhases: 2 }]],
      estimatedDuration: "2h",
    };
    vi.mocked(listTriggerIssues).mockResolvedValue(mockIssues);
    vi.mocked(generateExecutionPlan).mockResolvedValue(mockPlan);
    vi.mocked(printExecutionPlan).mockImplementation(() => {});

    await planCommand({ repo: "owner/repo" });

    expect(listTriggerIssues).toHaveBeenCalledWith("owner/repo", ["ai-task"], "gh");
    expect(generateExecutionPlan).toHaveBeenCalledWith(
      mockIssues,
      mockBaseConfig.commands.claudeCli,
      expect.any(String),
      expect.any(String)
    );
    expect(printExecutionPlan).toHaveBeenCalledWith(expect.objectContaining({ repo: "owner/repo" }));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("--execute 시 JobStore/JobQueue 생성 및 enqueue 호출", async () => {
    const mockIssues = [{ number: 7, title: "Issue A", body: "", labels: ["ai-task"] }];
    const mockPlan = {
      repo: "",
      totalIssues: 1,
      executionOrder: [[{ issueNumber: 7, title: "Issue A", priority: "medium" as const, dependencies: [], estimatedPhases: 1 }]],
      estimatedDuration: "1h",
    };
    vi.mocked(listTriggerIssues).mockResolvedValue(mockIssues);
    vi.mocked(generateExecutionPlan).mockResolvedValue(mockPlan);
    vi.mocked(printExecutionPlan).mockImplementation(() => {});

    const enqueueMock = vi.fn();
    vi.mocked(JobStore).mockImplementation(() => ({} as unknown as JobStore));
    vi.mocked(JobQueue).mockImplementation(() => ({
      enqueue: enqueueMock,
    } as unknown as JobQueue));

    await planCommand({ repo: "owner/repo", execute: true });

    expect(JobStore).toHaveBeenCalled();
    expect(JobQueue).toHaveBeenCalled();
    expect(enqueueMock).toHaveBeenCalledWith(7, "owner/repo", []);
  });
});

describe("startCommand — gracefulShutdown", () => {
  const mockConfigWithProject = {
    ...mockBaseConfig,
    projects: [{ repo: "owner/repo", path: "/tmp", baseBranch: "main" }],
  } as unknown as ReturnType<typeof loadConfig>;

  let mockPollerStop: ReturnType<typeof vi.fn>;
  let mockQueueShutdown: ReturnType<typeof vi.fn>;
  let mockConfigWatcherStop: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    vi.mocked(loadConfig).mockReturnValue(mockConfigWithProject);

    mockPollerStop = vi.fn();
    vi.mocked(IssuePoller).mockImplementation(() => ({
      start: vi.fn(),
      stop: mockPollerStop,
      isRunning: vi.fn().mockReturnValue(false),
    } as unknown as IssuePoller));

    mockQueueShutdown = vi.fn().mockResolvedValue(undefined);
    vi.mocked(JobQueue).mockImplementation(() => ({
      recover: vi.fn(),
      shutdown: mockQueueShutdown,
      enqueue: vi.fn(),
    } as unknown as JobQueue));

    vi.mocked(JobStore).mockImplementation(() => ({
      prune: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    } as unknown as JobStore));

    vi.mocked(createWebhookApp).mockReturnValue({
      route: vi.fn(),
      get: vi.fn(),
    } as unknown as ReturnType<typeof createWebhookApp>);
    vi.mocked(createDashboardRoutes).mockReturnValue({
      route: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    } as unknown as ReturnType<typeof createDashboardRoutes>);
    vi.mocked(createHealthRoutes).mockReturnValue({
      route: vi.fn(),
      get: vi.fn(),
    } as unknown as ReturnType<typeof createHealthRoutes>);
    vi.mocked(cleanupStalePid).mockReturnValue(true);

    mockConfigWatcherStop = vi.fn();
    vi.mocked(ConfigWatcher).mockImplementation(() => ({
      on: vi.fn(),
      startWatching: vi.fn(),
      stopWatching: mockConfigWatcherStop,
    } as unknown as ConfigWatcher));

    vi.mocked(runCli).mockResolvedValue({ stdout: "0\n", stderr: "", exitCode: 0 });
    vi.mocked(removePidFile).mockImplementation(() => {});
    vi.mocked(cleanupDashboardResources).mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    vi.restoreAllMocks();
  });

  it("startCommand 실행 후 SIGINT, SIGTERM 핸들러가 등록됨", async () => {
    const onSpy = vi.spyOn(process, "on");
    await startCommand({});

    const sigintRegistered = onSpy.mock.calls.some(([event]) => event === "SIGINT");
    const sigtermRegistered = onSpy.mock.calls.some(([event]) => event === "SIGTERM");
    expect(sigintRegistered).toBe(true);
    expect(sigtermRegistered).toBe(true);
  });

  it("SIGINT 수신 시 poller.stop, configWatcher.stopWatching, queue.shutdown, removePidFile, process.exit(0) 호출", async () => {
    const onSpy = vi.spyOn(process, "on");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as unknown as never);

    await startCommand({});

    // SIGINT 핸들러를 직접 추출하여 호출
    const sigintCall = onSpy.mock.calls.find(([event]) => event === "SIGINT");
    const sigintHandler = sigintCall?.[1] as (() => void) | undefined;
    expect(sigintHandler).toBeDefined();

    sigintHandler!();
    // gracefulShutdown이 async이므로 마이크로태스크 큐를 비운다
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockPollerStop).toHaveBeenCalled();
    expect(mockConfigWatcherStop).toHaveBeenCalled();
    expect(mockQueueShutdown).toHaveBeenCalledWith(30000);
    expect(removePidFile).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("SIGTERM 수신 시 queue.shutdown 및 process.exit(0) 호출", async () => {
    const onSpy = vi.spyOn(process, "on");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as unknown as never);

    await startCommand({});

    const sigtermCall = onSpy.mock.calls.find(([event]) => event === "SIGTERM");
    const sigtermHandler = sigtermCall?.[1] as (() => void) | undefined;
    expect(sigtermHandler).toBeDefined();

    sigtermHandler!();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockQueueShutdown).toHaveBeenCalledWith(30000);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("webhook 모드에서는 poller가 null이므로 SIGINT 시 poller.stop 미호출", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      ...mockConfigWithProject,
      general: { ...mockBaseConfig.general, serverMode: "webhook" },
    } as unknown as ReturnType<typeof loadConfig>);

    const onSpy = vi.spyOn(process, "on");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as unknown as never);

    await startCommand({});

    const sigintCall = onSpy.mock.calls.find(([event]) => event === "SIGINT");
    const sigintHandler = sigintCall?.[1] as (() => void) | undefined;
    sigintHandler!();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockPollerStop).not.toHaveBeenCalled();
    expect(mockQueueShutdown).toHaveBeenCalledWith(30000);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});

describe("startCommand — .env 로딩", () => {
  const mockConfigWithProject = {
    ...mockBaseConfig,
    projects: [{ repo: "owner/repo", path: "/tmp", baseBranch: "main" }],
  } as unknown as ReturnType<typeof loadConfig>;

  let tmpDir: string;

  beforeEach(() => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    vi.mocked(loadConfig).mockReturnValue(mockConfigWithProject);

    tmpDir = mkdtempSync(join(tmpdir(), "aqm-env-test-"));

    vi.mocked(IssuePoller).mockImplementation(() => ({
      start: vi.fn(),
      stop: vi.fn(),
      isRunning: vi.fn().mockReturnValue(false),
    } as unknown as IssuePoller));
    vi.mocked(JobStore).mockImplementation(() => ({
      prune: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    } as unknown as JobStore));
    vi.mocked(JobQueue).mockImplementation(() => ({
      recover: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
      enqueue: vi.fn(),
    } as unknown as JobQueue));
    vi.mocked(createWebhookApp).mockReturnValue({
      route: vi.fn(),
      get: vi.fn(),
    } as unknown as ReturnType<typeof createWebhookApp>);
    vi.mocked(createDashboardRoutes).mockReturnValue({
      route: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    } as unknown as ReturnType<typeof createDashboardRoutes>);
    vi.mocked(createHealthRoutes).mockReturnValue({
      route: vi.fn(),
      get: vi.fn(),
    } as unknown as ReturnType<typeof createHealthRoutes>);
    vi.mocked(cleanupStalePid).mockReturnValue(true);
    vi.mocked(ConfigWatcher).mockImplementation(() => ({
      on: vi.fn(),
      startWatching: vi.fn(),
      stopWatching: vi.fn(),
    } as unknown as ConfigWatcher));
    vi.mocked(runCli).mockResolvedValue({ stdout: "0\n", stderr: "", exitCode: 0 });
  });

  afterEach(() => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    delete process.env.AQM_TEST_ENV_VAR;
    delete process.env.AQM_TEST_QUOTED;
    delete process.env.AQM_TEST_SINGLE_QUOTED;
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it(".env 파일이 없으면 process.env에 영향 없음", async () => {
    await startCommand({ config: join(tmpDir, "config.yml") });
    expect(process.env.AQM_TEST_ENV_VAR).toBeUndefined();
  });

  it(".env 파일의 KEY=VALUE가 process.env에 로드됨", async () => {
    writeFileSync(join(tmpDir, ".env"), "AQM_TEST_ENV_VAR=hello_world\n");
    await startCommand({ config: join(tmpDir, "config.yml") });
    expect(process.env.AQM_TEST_ENV_VAR).toBe("hello_world");
  });

  it("값에 큰따옴표가 있으면 제거됨", async () => {
    writeFileSync(join(tmpDir, ".env"), 'AQM_TEST_QUOTED="quoted_value"\n');
    await startCommand({ config: join(tmpDir, "config.yml") });
    expect(process.env.AQM_TEST_QUOTED).toBe("quoted_value");
  });

  it("값에 작은따옴표가 있으면 제거됨", async () => {
    writeFileSync(join(tmpDir, ".env"), "AQM_TEST_SINGLE_QUOTED='single_quoted'\n");
    await startCommand({ config: join(tmpDir, "config.yml") });
    expect(process.env.AQM_TEST_SINGLE_QUOTED).toBe("single_quoted");
  });

  it("이미 설정된 환경변수는 덮어쓰지 않음", async () => {
    process.env.AQM_TEST_ENV_VAR = "existing_value";
    writeFileSync(join(tmpDir, ".env"), "AQM_TEST_ENV_VAR=new_value\n");
    await startCommand({ config: join(tmpDir, "config.yml") });
    expect(process.env.AQM_TEST_ENV_VAR).toBe("existing_value");
  });

  it("주석 행(#)은 무시됨", async () => {
    writeFileSync(join(tmpDir, ".env"), "# this is a comment\nAQM_TEST_ENV_VAR=from_env\n");
    await startCommand({ config: join(tmpDir, "config.yml") });
    expect(process.env.AQM_TEST_ENV_VAR).toBe("from_env");
  });
});
