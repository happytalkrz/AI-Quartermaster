import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildProjectConcurrency, parseArgs, printHelp, runCommand, checkForUpdates, statusCommand, versionCommand, doctorCommand, startCommand } from "../src/cli.js";
import { loadConfig, tryLoadConfig } from "../src/config/loader.js";
import { runPipeline } from "../src/pipeline/orchestrator.js";
import { JobStore } from "../src/queue/job-store.js";
import { JobQueue } from "../src/queue/job-queue.js";
import { runDoctor } from "../src/setup/doctor.js";
import { runCli } from "../src/utils/cli-runner.js";
import { IssuePoller } from "../src/polling/issue-poller.js";
import { createWebhookApp, startServer } from "../src/server/webhook-server.js";
import { createDashboardRoutes } from "../src/server/dashboard-api.js";
import { createHealthRoutes } from "../src/server/health.js";
import { cleanupStalePid, writePidFile } from "../src/server/pid-manager.js";
import { ConfigWatcher } from "../src/config/config-watcher.js";

vi.mock("../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
  tryLoadConfig: vi.fn(),
}));
vi.mock("../src/pipeline/orchestrator.js", () => ({
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
    vi.mocked(createDashboardRoutes).mockReturnValue({} as unknown as ReturnType<typeof createDashboardRoutes>);
    vi.mocked(createHealthRoutes).mockReturnValue({} as unknown as ReturnType<typeof createHealthRoutes>);
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
