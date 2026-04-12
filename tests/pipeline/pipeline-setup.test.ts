import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies
vi.mock("../../src/github/issue-fetcher.js", () => ({
  fetchIssue: vi.fn(),
}));
vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));
vi.mock("../../src/safety/safety-checker.js", () => ({
  validateIssue: vi.fn(),
}));
vi.mock("../../src/pipeline/errors/checkpoint.js", () => ({
  saveCheckpoint: vi.fn(),
  removeCheckpoint: vi.fn(),
}));
vi.mock("../../src/config/project-resolver.js", () => ({
  resolveProject: vi.fn(),
}));
vi.mock("../../src/config/mode-presets.js", () => ({
  detectModeFromLabels: vi.fn(),
  detectExecutionModeFromLabels: vi.fn(),
}));
vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("../../src/pipeline/reporting/progress-tracker.js", () => ({
  PROGRESS_ISSUE_VALIDATED: 25,
  PROGRESS_DONE: 100,
}));

import {
  resolveResolvedProject,
  checkDuplicatePR,
  fetchAndValidateIssue,
  type ProjectSetupResult,
  type DuplicatePRCheckResult,
  type IssueSetupResult,
} from "../../src/pipeline/setup/pipeline-setup.js";
import { fetchIssue } from "../../src/github/issue-fetcher.js";
import { runCli } from "../../src/utils/cli-runner.js";
import { validateIssue } from "../../src/safety/safety-checker.js";
import { saveCheckpoint, removeCheckpoint } from "../../src/pipeline/errors/checkpoint.js";
import { resolveProject } from "../../src/config/project-resolver.js";
import { detectModeFromLabels, detectExecutionModeFromLabels } from "../../src/config/mode-presets.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { AQConfig } from "../../src/types/config.js";
import type { ResolvedProject } from "../../src/config/project-resolver.js";
import type { PipelineTimer } from "../../src/safety/timeout-manager.js";

const mockFetchIssue = vi.mocked(fetchIssue);
const mockRunCli = vi.mocked(runCli);
const mockValidateIssue = vi.mocked(validateIssue);
const mockSaveCheckpoint = vi.mocked(saveCheckpoint);
const mockRemoveCheckpoint = vi.mocked(removeCheckpoint);
const mockResolveProject = vi.mocked(resolveProject);
const mockDetectModeFromLabels = vi.mocked(detectModeFromLabels);
const mockDetectExecutionModeFromLabels = vi.mocked(detectExecutionModeFromLabels);

function makeConfig(): AQConfig {
  const config = structuredClone(DEFAULT_CONFIG);
  config.general.projectName = "test";
  config.general.targetRoot = "/tmp/project";
  config.git.allowedRepos = ["test/repo"];
  return config;
}

function makeResolvedProject(): ResolvedProject {
  return {
    path: "/tmp/project",
    baseBranch: "main",
    branchTemplate: "aq/{issue-number}-{slug}",
    mode: "code",
    commands: {
      claudeCli: { path: "claude", model: "test", maxTurns: 1, timeout: 5000, additionalArgs: [] },
      test: "npm test",
      lint: "npm run lint",
      ghCli: { path: "gh", timeout: 10000 },
    },
    safety: {
      maxPhases: 10,
      maxRetries: 2,
      sensitivePaths: [".env"],
      allowedLabels: [],
      blockedLabels: [],
      allowedPaths: [],
      blockedPaths: [],
      maxFilesChanged: 50,
      maxLinesChanged: 1000,
    },
    pr: {
      draft: true,
      targetBranch: "main",
      titleTemplate: "[#{issue-number}] {issue-title}",
      enableAutoMerge: false,
    },
  };
}

function makeIssue() {
  return {
    number: 42,
    title: "Fix bug",
    body: "Fix it",
    labels: ["bug"],
  };
}

function makeMockTimer(): PipelineTimer {
  return {
    assertNotExpired: vi.fn(),
    getTimeoutConfig: vi.fn().mockReturnValue({ timeoutMs: 300000 }),
    getRemainingTime: vi.fn().mockReturnValue(300000),
    isExpired: vi.fn().mockReturnValue(false),
  };
}

describe("resolveResolvedProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProject.mockReturnValue(makeResolvedProject());
  });

  it("should resolve project config and return setup result", () => {
    const config = makeConfig();
    const result = resolveResolvedProject("test/repo", config);

    expect(mockResolveProject).toHaveBeenCalledWith("test/repo", config);
    expect(result).toEqual({
      projectRoot: "/tmp/project",
      promptsDir: "/tmp/project/prompts",
      gitConfig: {
        ...config.git,
        defaultBaseBranch: "main",
        branchTemplate: "aq/{issue-number}-{slug}",
      },
    });
  });

  it("should use inputProjectRoot when provided", () => {
    const config = makeConfig();
    const result = resolveResolvedProject("test/repo", config, "/custom/path");

    expect(result.projectRoot).toBe("/custom/path");
    expect(result.promptsDir).toBe("/custom/path/prompts");
  });

  it("should use resumeProjectRoot when provided and no inputProjectRoot", () => {
    const config = makeConfig();
    const result = resolveResolvedProject("test/repo", config, undefined, "/resume/path");

    expect(result.projectRoot).toBe("/resume/path");
    expect(result.promptsDir).toBe("/resume/path/prompts");
  });

  it("should use aqRoot when provided", () => {
    const config = makeConfig();
    const result = resolveResolvedProject("test/repo", config, undefined, undefined, "/aq/root");

    expect(result.promptsDir).toBe("/aq/root/prompts");
  });

  it("should prioritize inputProjectRoot over resumeProjectRoot", () => {
    const config = makeConfig();
    const result = resolveResolvedProject("test/repo", config, "/input/path", "/resume/path");

    expect(result.projectRoot).toBe("/input/path");
  });
});

describe("checkDuplicatePR", () => {
  const project = makeResolvedProject();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return no duplicate when no PRs exist", async () => {
    mockRunCli.mockResolvedValue({
      exitCode: 0,
      stdout: "[]",
      stderr: "",
    });

    const result = await checkDuplicatePR("test/repo", 42, project, false);

    expect(result.hasDuplicatePR).toBe(false);
    expect(mockRunCli).toHaveBeenCalledWith(
      "gh",
      ["pr", "list", "--repo", "test/repo", "--search", "#42 in:title", "--json", "number,url", "--limit", "1"],
      { timeout: 10000 }
    );
  });

  it("should return duplicate when PR exists", async () => {
    const mockJobLogger = {
      log: vi.fn(),
      setProgress: vi.fn(),
      setStep: vi.fn(),
    };

    mockRunCli.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify([{ number: 123, url: "https://github.com/test/repo/pull/123" }]),
      stderr: "",
    });

    const result = await checkDuplicatePR("test/repo", 42, project, false, mockJobLogger, "/tmp/data");

    expect(result.hasDuplicatePR).toBe(true);
    if (result.hasDuplicatePR) {
      expect(result.prUrl).toBe("https://github.com/test/repo/pull/123");
    }
    expect(mockJobLogger.log).toHaveBeenCalledWith("이슈에 이미 PR이 존재합니다: https://github.com/test/repo/pull/123");
    expect(mockJobLogger.setProgress).toHaveBeenCalledWith(100);
    expect(mockJobLogger.setStep).toHaveBeenCalledWith("완료 (기존 PR)");
    expect(mockRemoveCheckpoint).toHaveBeenCalledWith("/tmp/data", 42);
  });

  it("should skip check when isRetry is true", async () => {
    const result = await checkDuplicatePR("test/repo", 42, project, true);

    expect(result.hasDuplicatePR).toBe(false);
    expect(mockRunCli).not.toHaveBeenCalled();
  });

  it("should handle CLI errors gracefully", async () => {
    mockRunCli.mockRejectedValue(new Error("gh CLI failed"));

    const result = await checkDuplicatePR("test/repo", 42, project, false);

    expect(result.hasDuplicatePR).toBe(false);
  });

  it("should handle non-zero exit codes gracefully", async () => {
    mockRunCli.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "API error",
    });

    const result = await checkDuplicatePR("test/repo", 42, project, false);

    expect(result.hasDuplicatePR).toBe(false);
  });
});

describe("fetchAndValidateIssue", () => {
  const project = makeResolvedProject();
  const timer = makeMockTimer();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchIssue.mockResolvedValue(makeIssue());
    mockDetectModeFromLabels.mockReturnValue("code");
    mockDetectExecutionModeFromLabels.mockReturnValue("standard");
    mockValidateIssue.mockImplementation(() => {});
  });

  it("should fetch and validate issue when state is RECEIVED", async () => {
    const mockJobLogger = {
      log: vi.fn(),
      setProgress: vi.fn(),
      setStep: vi.fn(),
    };

    const result = await fetchAndValidateIssue(
      "test/repo",
      42,
      project,
      "RECEIVED",
      timer,
      mockJobLogger,
      undefined,
      {
        projectRoot: "/tmp/project",
        worktreePath: "/tmp/wt",
        branchName: "aq/42-fix-bug",
        dataDir: "/tmp/data",
      }
    );

    expect(mockFetchIssue).toHaveBeenCalledWith("test/repo", 42, {
      ghPath: "gh",
      timeout: 10000,
    });
    expect(mockValidateIssue).toHaveBeenCalledWith(makeIssue(), project.safety, undefined);
    expect(mockDetectModeFromLabels).toHaveBeenCalledWith(["bug"], "code");
    expect(mockDetectExecutionModeFromLabels).toHaveBeenCalledWith(["bug"], "standard");
    expect(mockSaveCheckpoint).toHaveBeenCalled();
    expect(result.issue).toEqual(makeIssue());
    expect(result.mode).toBe("code");
    expect(result.executionMode).toBe("standard");
    expect(mockJobLogger.setStep).toHaveBeenCalledWith("이슈 정보 가져오는 중...");
    expect(mockJobLogger.log).toHaveBeenCalledWith("이슈: Fix bug");
    expect(mockJobLogger.setProgress).toHaveBeenCalledWith(25);
  });

  it("should skip fetch when state is past VALIDATED", async () => {
    const result = await fetchAndValidateIssue(
      "test/repo",
      42,
      project,
      "BASE_SYNCED", // Past VALIDATED
      timer
    );

    // Should still fetch for later stages but skip validation steps
    expect(mockFetchIssue).toHaveBeenCalled();
    expect(mockValidateIssue).not.toHaveBeenCalled();
    expect(mockSaveCheckpoint).not.toHaveBeenCalled();
    expect(result.issue).toEqual(makeIssue());
  });

  it("should use resumeMode when provided", async () => {
    const result = await fetchAndValidateIssue(
      "test/repo",
      42,
      project,
      "RECEIVED",
      timer,
      undefined,
      "test" // resumeMode
    );

    expect(result.mode).toBe("test");
    expect(mockDetectModeFromLabels).not.toHaveBeenCalled();
  });

  it("should create checkpoint function that saves with overrides", async () => {
    const setupContext = {
      projectRoot: "/tmp/project",
      worktreePath: "/tmp/wt",
      branchName: "aq/42-fix-bug",
      dataDir: "/tmp/data",
    };

    const result = await fetchAndValidateIssue(
      "test/repo",
      42,
      project,
      "RECEIVED",
      timer,
      undefined,
      undefined,
      setupContext
    );

    // Test the checkpoint function
    result.checkpoint({ state: "PLAN_GENERATED" });

    expect(mockSaveCheckpoint).toHaveBeenCalledWith("/tmp/data", 42, expect.objectContaining({
      state: "PLAN_GENERATED",
      issueNumber: 42,
      repo: "test/repo",
      projectRoot: "/tmp/project",
      worktreePath: "/tmp/wt",
      branchName: "aq/42-fix-bug",
      mode: "code",
    }));
  });

  it("should handle checkpoint function without setupContext", async () => {
    const result = await fetchAndValidateIssue(
      "test/repo",
      42,
      project,
      "RECEIVED",
      timer
    );

    // Should not throw when setupContext is undefined
    expect(() => result.checkpoint()).not.toThrow();
  });

  it("should assert timer not expired during fetch", async () => {
    await fetchAndValidateIssue(
      "test/repo",
      42,
      project,
      "RECEIVED",
      timer
    );

    expect(timer.assertNotExpired).toHaveBeenCalledWith("issue-fetch");
  });

  it("should detect mode from issue labels with fallback to project mode", async () => {
    const issueWithLabels = {
      ...makeIssue(),
      labels: ["enhancement", "review"],
    };
    const projectWithMode = {
      ...project,
      mode: "review" as const,
    };

    mockFetchIssue.mockResolvedValue(issueWithLabels);
    mockDetectModeFromLabels.mockReturnValue("enhancement");

    const result = await fetchAndValidateIssue(
      "test/repo",
      42,
      projectWithMode,
      "RECEIVED",
      timer
    );

    expect(mockDetectModeFromLabels).toHaveBeenCalledWith(["enhancement", "review"], "review");
    expect(result.mode).toBe("enhancement");
  });

  it("should handle undefined project mode", async () => {
    const projectWithoutMode = {
      ...project,
      mode: undefined,
    };

    const result = await fetchAndValidateIssue(
      "test/repo",
      42,
      projectWithoutMode,
      "RECEIVED",
      timer
    );

    expect(mockDetectModeFromLabels).toHaveBeenCalledWith(["bug"], "code");
    expect(result.mode).toBe("code");
  });
});