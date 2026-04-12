import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies
vi.mock("../../src/github/pr-creator.js", () => ({
  createDraftPR: vi.fn(),
  enableAutoMerge: vi.fn(),
  closeIssue: vi.fn(),
  addIssueComment: vi.fn(),
}));
vi.mock("../../src/queue/dependency-resolver.js", () => ({
  parseDependencies: vi.fn(),
  checkDependencyPRsMerged: vi.fn(),
}));
vi.mock("../../src/git/branch-manager.js", () => ({
  pushBranch: vi.fn(),
  checkConflicts: vi.fn(),
  attemptRebase: vi.fn(),
}));
vi.mock("../../src/git/worktree-manager.js", () => ({
  removeWorktree: vi.fn(),
}));
vi.mock("../../src/pipeline/reporting/result-reporter.js", () => ({
  formatResult: vi.fn(),
  printResult: vi.fn(),
}));
vi.mock("../../src/safety/safety-checker.js", () => ({
  validateBeforePush: vi.fn(),
}));
vi.mock("../../src/safety/rollback-manager.js", () => ({
  rollbackToCheckpoint: vi.fn(),
}));
vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));
vi.mock("../../src/utils/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  })),
}));
vi.mock("../../src/pipeline/errors/checkpoint.js", () => ({
  removeCheckpoint: vi.fn(),
}));
vi.mock("../../src/learning/pattern-store.js", () => ({
  PatternStore: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
  })),
}));
vi.mock("../../src/pipeline/reporting/progress-tracker.js", () => ({
  PROGRESS_PR_CREATED: 90,
  PROGRESS_DONE: 100,
}));
vi.mock("fs", () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));
vi.mock("path", () => ({
  resolve: vi.fn((a: string, b: string) => `${a}/${b}`),
}));

import { pushAndCreatePR, cleanupOnSuccess, handlePipelineFailure } from "../../src/pipeline/phases/pipeline-publish.js";
import { createDraftPR, enableAutoMerge, closeIssue, addIssueComment } from "../../src/github/pr-creator.js";
import { parseDependencies, checkDependencyPRsMerged } from "../../src/queue/dependency-resolver.js";
import { pushBranch, checkConflicts, attemptRebase } from "../../src/git/branch-manager.js";
import { removeWorktree } from "../../src/git/worktree-manager.js";
import { validateBeforePush } from "../../src/safety/safety-checker.js";
import { rollbackToCheckpoint } from "../../src/safety/rollback-manager.js";
import { runCli } from "../../src/utils/cli-runner.js";
import { formatResult, printResult } from "../../src/pipeline/reporting/result-reporter.js";
import { removeCheckpoint } from "../../src/pipeline/errors/checkpoint.js";
import { PatternStore } from "../../src/learning/pattern-store.js";
import type { PublishPhaseContext, CleanupContext, FailureHandlerContext } from "../../src/types/pipeline.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";

const mockCreateDraftPR = vi.mocked(createDraftPR);
const mockEnableAutoMerge = vi.mocked(enableAutoMerge);
const mockCloseIssue = vi.mocked(closeIssue);
const mockAddIssueComment = vi.mocked(addIssueComment);
const mockParseDependencies = vi.mocked(parseDependencies);
const mockCheckDependencyPRsMerged = vi.mocked(checkDependencyPRsMerged);
const mockPushBranch = vi.mocked(pushBranch);
const mockCheckConflicts = vi.mocked(checkConflicts);
const mockAttemptRebase = vi.mocked(attemptRebase);
const mockRemoveWorktree = vi.mocked(removeWorktree);
const mockValidateBeforePush = vi.mocked(validateBeforePush);
const mockRollbackToCheckpoint = vi.mocked(rollbackToCheckpoint);
const mockRunCli = vi.mocked(runCli);
const mockFormatResult = vi.mocked(formatResult);
const mockPrintResult = vi.mocked(printResult);
const mockRemoveCheckpoint = vi.mocked(removeCheckpoint);
const mockPatternStore = vi.mocked(PatternStore);

function makePublishContext(): PublishPhaseContext {
  return {
    issueNumber: 42,
    repo: "test/repo",
    issue: { number: 42, title: "Fix bug", body: "", labels: [] },
    plan: {
      issueNumber: 42,
      title: "Fix bug",
      problemDefinition: "Bug exists",
      requirements: ["Fix it"],
      affectedFiles: ["src/test.ts"],
      risks: [],
      phases: [{
        index: 0,
        name: "Fix",
        description: "Fix it",
        targetFiles: ["src/test.ts"],
        commitStrategy: "atomic",
        verificationCriteria: ["tests pass"],
        dependsOn: []
      }],
      verificationPoints: [],
      stopConditions: [],
    },
    phaseResults: [{
      phaseIndex: 0,
      phaseName: "Fix",
      success: true,
      commitHash: "abc123",
      durationMs: 1000
    }],
    branchName: "ax/42-fix-bug",
    baseBranch: "main",
    worktreePath: "/tmp/wt/42-fix-bug",
    gitConfig: {
      gitPath: "git",
      remoteAlias: "origin",
    },
    projectConfig: {
      safety: {},
      pr: {
        draft: true,
        autoMerge: true,
        mergeMethod: "squash" as const,
      },
      commands: {
        ghCli: { path: "gh" },
      },
    },
    promptsDir: "/tmp/prompts",
    dryRun: false,
    jl: {
      setStep: vi.fn(),
      setProgress: vi.fn(),
      log: vi.fn(),
    },
  };
}

function makeCleanupContext(): CleanupContext {
  return {
    worktreePath: "/tmp/wt/42-fix-bug",
    gitConfig: { gitPath: "git" },
    projectRoot: "/tmp/project",
    cleanupOnSuccess: true,
    issueNumber: 42,
    repo: "test/repo",
    plan: {} as any,
    phaseResults: [],
    startTime: Date.now(),
    prUrl: "https://github.com/test/repo/pull/1",
    config: DEFAULT_CONFIG,
    aqRoot: "/tmp/aq",
    dataDir: "/tmp/data",
  };
}

function makeFailureContext(): FailureHandlerContext {
  return {
    error: new Error("Test failure"),
    state: "PHASE_FAILED",
    worktreePath: "/tmp/wt/42-fix-bug",
    branchName: "ax/42-fix-bug",
    rollbackHash: "abc123",
    rollbackStrategy: "checkpoint",
    gitConfig: { gitPath: "git" },
    projectRoot: "/tmp/project",
    cleanupOnFailure: true,
    jl: {
      log: vi.fn(),
      setStep: vi.fn(),
    },
  };
}

describe("pushAndCreatePR", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateBeforePush.mockResolvedValue(undefined);
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    mockCheckConflicts.mockResolvedValue({ hasConflicts: false, conflictFiles: [] });
    mockAttemptRebase.mockResolvedValue({ success: true });
    mockPushBranch.mockResolvedValue(undefined);
    mockCreateDraftPR.mockResolvedValue({ url: "https://github.com/test/repo/pull/1", number: 1 });
    mockEnableAutoMerge.mockResolvedValue(true);
    mockCloseIssue.mockResolvedValue(true);
    mockAddIssueComment.mockResolvedValue(true);
    mockParseDependencies.mockReturnValue([]);
    mockCheckDependencyPRsMerged.mockResolvedValue({ merged: true, unmerged: [], notFound: [] });
  });

  it("should successfully push and create PR", async () => {
    const context = makePublishContext();

    const result = await pushAndCreatePR(context);

    expect(result.success).toBe(true);
    expect(result.prUrl).toBe("https://github.com/test/repo/pull/1");
    expect(mockValidateBeforePush).toHaveBeenCalledWith({
      safetyConfig: context.projectConfig.safety,
      gitConfig: context.gitConfig,
      cwd: "/tmp/wt/42-fix-bug",
      baseBranch: "main",
    });
    expect(mockPushBranch).toHaveBeenCalledWith(
      context.gitConfig,
      "ax/42-fix-bug",
      { cwd: "/tmp/wt/42-fix-bug" }
    );
    expect(mockCreateDraftPR).toHaveBeenCalledWith(
      context.projectConfig.pr,
      context.projectConfig.commands.ghCli,
      expect.objectContaining({
        issueNumber: 42,
        issueTitle: "Fix bug",
        repo: "test/repo",
        branchName: "ax/42-fix-bug",
        baseBranch: "main",
      }),
      expect.objectContaining({ cwd: "/tmp/wt/42-fix-bug", dryRun: false })
    );
    expect(mockEnableAutoMerge).toHaveBeenCalledWith(
      1,
      "test/repo",
      "squash",
      { ghPath: "gh", dryRun: false, isDraft: true, deleteBranch: false }
    );
    expect(mockCloseIssue).toHaveBeenCalledWith(42, "test/repo", { ghPath: "gh", dryRun: false });
  });

  it("should handle safety validation failure", async () => {
    const context = makePublishContext();
    mockValidateBeforePush.mockRejectedValue(new Error("Safety violation"));

    const result = await pushAndCreatePR(context);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Safety violation");
    expect(mockPushBranch).not.toHaveBeenCalled();
  });

  it("should handle conflicts and attempt rebase", async () => {
    const context = makePublishContext();
    mockCheckConflicts.mockResolvedValue({
      hasConflicts: true,
      conflictFiles: ["src/conflict.ts"],
    });
    mockAttemptRebase.mockResolvedValue({ success: true });

    const result = await pushAndCreatePR(context);

    expect(result.success).toBe(true);
    expect(mockCheckConflicts).toHaveBeenCalledWith(
      context.gitConfig,
      "main",
      { cwd: "/tmp/wt/42-fix-bug" }
    );
    expect(mockAttemptRebase).toHaveBeenCalledWith(
      context.gitConfig,
      "main",
      { cwd: "/tmp/wt/42-fix-bug" }
    );
    expect(context.jl?.log).toHaveBeenCalledWith("충돌 감지됨, rebase 시도 중...");
    expect(context.jl?.log).toHaveBeenCalledWith("Rebase 성공");
  });

  it("should continue when rebase fails", async () => {
    const context = makePublishContext();
    mockCheckConflicts.mockResolvedValue({
      hasConflicts: true,
      conflictFiles: ["src/conflict.ts"],
    });
    mockAttemptRebase.mockResolvedValue({ success: false });

    const result = await pushAndCreatePR(context);

    expect(result.success).toBe(true); // Should continue despite rebase failure
    expect(context.jl?.log).toHaveBeenCalledWith("Rebase 실패 (충돌 있음): src/conflict.ts");
  });

  it("should add issue comment when rebase fails", async () => {
    const context = makePublishContext();
    mockCheckConflicts.mockResolvedValue({
      hasConflicts: true,
      conflictFiles: ["src/conflict.ts", "src/another.ts"],
    });
    mockAttemptRebase.mockResolvedValue({ success: false });

    const result = await pushAndCreatePR(context);

    expect(result.success).toBe(true);
    expect(mockAddIssueComment).toHaveBeenCalledWith(
      42,
      "test/repo",
      expect.stringContaining("## 🔄 자동 Rebase 실패"),
      { ghPath: "gh", dryRun: false }
    );
    expect(mockAddIssueComment).toHaveBeenCalledWith(
      42,
      "test/repo",
      expect.stringContaining("- `src/conflict.ts`"),
      { ghPath: "gh", dryRun: false }
    );
    expect(context.jl?.log).toHaveBeenCalledWith("충돌 알림 코멘트 추가됨");
  });

  it("should continue when issue comment fails", async () => {
    const context = makePublishContext();
    mockCheckConflicts.mockResolvedValue({
      hasConflicts: true,
      conflictFiles: ["src/conflict.ts"],
    });
    mockAttemptRebase.mockResolvedValue({ success: false });
    mockAddIssueComment.mockRejectedValue(new Error("Comment failed"));

    const result = await pushAndCreatePR(context);

    expect(result.success).toBe(true);
    expect(context.jl?.log).toHaveBeenCalledWith("이슈 코멘트 실패 (경고만, 계속 진행)");
  });

  it("should skip auto-merge when disabled", async () => {
    const context = makePublishContext();
    context.projectConfig.pr.autoMerge = false;

    await pushAndCreatePR(context);

    expect(mockEnableAutoMerge).not.toHaveBeenCalled();
  });

  it("should continue when auto-merge fails", async () => {
    const context = makePublishContext();
    mockEnableAutoMerge.mockResolvedValue(false);

    const result = await pushAndCreatePR(context);

    expect(result.success).toBe(true);
    expect(context.jl?.log).toHaveBeenCalledWith("Auto-merge 활성화 실패 (경고만, 계속 진행)");
  });

  it("should continue when issue close fails", async () => {
    const context = makePublishContext();
    mockCloseIssue.mockRejectedValue(new Error("Issue close failed"));

    const result = await pushAndCreatePR(context);

    expect(result.success).toBe(true);
    expect(context.jl?.log).toHaveBeenCalledWith("이슈 닫기 실패 (경고만, 계속 진행)");
  });

  it("should skip push in dry run mode", async () => {
    const context = makePublishContext();
    context.dryRun = true;

    await pushAndCreatePR(context);

    expect(mockPushBranch).not.toHaveBeenCalled();
    expect(mockCreateDraftPR).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({ dryRun: true })
    );
  });

  it("should enable auto-merge when no dependencies exist", async () => {
    const context = makePublishContext();
    context.issue.body = "This is a regular issue with no dependencies";
    mockParseDependencies.mockReturnValue([]);

    const result = await pushAndCreatePR(context);

    expect(result.success).toBe(true);
    expect(mockParseDependencies).toHaveBeenCalledWith("This is a regular issue with no dependencies");
    expect(mockCheckDependencyPRsMerged).not.toHaveBeenCalled();
    expect(mockEnableAutoMerge).toHaveBeenCalledWith(
      1,
      "test/repo",
      "squash",
      { ghPath: "gh", dryRun: false, isDraft: true, deleteBranch: false }
    );
  });

  it("should enable auto-merge when all dependency PRs are merged", async () => {
    const context = makePublishContext();
    context.issue.body = "depends: #11, #12";
    mockParseDependencies.mockReturnValue([11, 12]);
    mockCheckDependencyPRsMerged.mockResolvedValue({ merged: true, unmerged: [], notFound: [] });

    const result = await pushAndCreatePR(context);

    expect(result.success).toBe(true);
    expect(mockParseDependencies).toHaveBeenCalledWith("depends: #11, #12");
    expect(mockCheckDependencyPRsMerged).toHaveBeenCalledWith([11, 12], "test/repo", "gh");
    expect(mockEnableAutoMerge).toHaveBeenCalledWith(
      1,
      "test/repo",
      "squash",
      { ghPath: "gh", dryRun: false, isDraft: true, deleteBranch: false }
    );
    expect(context.jl?.log).toHaveBeenCalledWith("Auto-merge 활성화 (squash, 의존성 확인 완료)");
  });

  it("should skip auto-merge when dependency PRs are not merged", async () => {
    const context = makePublishContext();
    context.issue.body = "depends: #11, #12";
    mockParseDependencies.mockReturnValue([11, 12]);
    mockCheckDependencyPRsMerged.mockResolvedValue({
      merged: false,
      unmerged: [11],
      notFound: [12]
    });

    const result = await pushAndCreatePR(context);

    expect(result.success).toBe(true);
    expect(mockCheckDependencyPRsMerged).toHaveBeenCalledWith([11, 12], "test/repo", "gh");
    expect(mockEnableAutoMerge).not.toHaveBeenCalled();
    expect(mockAddIssueComment).toHaveBeenCalledWith(
      42,
      "test/repo",
      expect.stringContaining("⏳ Auto-merge 대기 중"),
      { ghPath: "gh", dryRun: false }
    );
    expect(mockAddIssueComment).toHaveBeenCalledWith(
      42,
      "test/repo",
      expect.stringContaining("- #11"),
      { ghPath: "gh", dryRun: false }
    );
    expect(mockAddIssueComment).toHaveBeenCalledWith(
      42,
      "test/repo",
      expect.stringContaining("- #12 (PR을 찾을 수 없음)"),
      { ghPath: "gh", dryRun: false }
    );
    expect(context.jl?.log).toHaveBeenCalledWith("의존성 PR 미머지로 auto-merge 스킵, 코멘트 추가됨");
  });

  it("should enable auto-merge as fallback when dependency check fails", async () => {
    const context = makePublishContext();
    context.issue.body = "depends: #11";
    mockParseDependencies.mockReturnValue([11]);
    mockCheckDependencyPRsMerged.mockRejectedValue(new Error("API Error"));

    const result = await pushAndCreatePR(context);

    expect(result.success).toBe(true);
    expect(mockCheckDependencyPRsMerged).toHaveBeenCalledWith([11], "test/repo", "gh");
    expect(mockEnableAutoMerge).toHaveBeenCalledWith(
      1,
      "test/repo",
      "squash",
      { ghPath: "gh", dryRun: false, isDraft: true, deleteBranch: false }
    );
    expect(context.jl?.log).toHaveBeenCalledWith("의존성 확인 실패, auto-merge 계속 진행");
  });

  it("should continue when dependency comment fails", async () => {
    const context = makePublishContext();
    context.issue.body = "depends: #11";
    mockParseDependencies.mockReturnValue([11]);
    mockCheckDependencyPRsMerged.mockResolvedValue({
      merged: false,
      unmerged: [11],
      notFound: []
    });
    mockAddIssueComment.mockRejectedValue(new Error("Comment failed"));

    const result = await pushAndCreatePR(context);

    expect(result.success).toBe(true);
    expect(context.jl?.log).toHaveBeenCalledWith("의존성 코멘트 추가 실패 (경고만, 계속 진행)");
  });
});

describe("cleanupOnSuccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRemoveWorktree.mockResolvedValue(undefined);
    mockFormatResult.mockReturnValue({} as any);
    mockPrintResult.mockReturnValue(undefined);
    mockRemoveCheckpoint.mockReturnValue(undefined);
  });

  it("should cleanup worktree when cleanupOnSuccess is true", async () => {
    const context = makeCleanupContext();

    await cleanupOnSuccess(context);

    expect(mockRemoveWorktree).toHaveBeenCalledWith(
      { gitPath: "git" },
      "/tmp/wt/42-fix-bug",
      { cwd: "/tmp/project" }
    );
    expect(mockFormatResult).toHaveBeenCalledWith(
      42,
      "test/repo",
      context.plan,
      context.phaseResults,
      context.startTime,
      "https://github.com/test/repo/pull/1"
    );
    expect(mockPrintResult).toHaveBeenCalledWith(mockFormatResult.mock.results[0].value);
    expect(mockRemoveCheckpoint).toHaveBeenCalledWith("/tmp/data", 42);
  });

  it("should skip worktree cleanup when cleanupOnSuccess is false", async () => {
    const context = makeCleanupContext();
    context.cleanupOnSuccess = false;

    await cleanupOnSuccess(context);

    expect(mockRemoveWorktree).not.toHaveBeenCalled();
  });

  it("should continue when worktree cleanup fails", async () => {
    const context = makeCleanupContext();
    mockRemoveWorktree.mockRejectedValue(new Error("Cleanup failed"));

    await cleanupOnSuccess(context);

    expect(mockRemoveWorktree).toHaveBeenCalled();
    expect(mockFormatResult).toHaveBeenCalled(); // Should continue
  });

  it("should record success pattern", async () => {
    const context = makeCleanupContext();
    const mockAddFn = vi.fn();
    mockPatternStore.mockImplementation(() => ({ add: mockAddFn }) as any);

    await cleanupOnSuccess(context);

    expect(mockPatternStore).toHaveBeenCalledWith("/tmp/data");
    expect(mockAddFn).toHaveBeenCalledWith({
      issueNumber: 42,
      repo: "test/repo",
      type: "success",
      tags: [],
    });
  });
});

describe("handlePipelineFailure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRollbackToCheckpoint.mockResolvedValue(undefined);
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    mockRemoveWorktree.mockResolvedValue(undefined);
  });

  it("should handle failure with rollback", async () => {
    const context = makeFailureContext();

    const result = await handlePipelineFailure(context);

    expect(result).toContain("Test failure");
    expect(result).toContain("Rolled back to abc123");
    expect(mockRollbackToCheckpoint).toHaveBeenCalledWith(
      "abc123",
      { cwd: "/tmp/wt/42-fix-bug", gitPath: "git" }
    );
    expect(context.jl?.log).toHaveBeenCalledWith("실패: Test failure");
    expect(context.jl?.setStep).toHaveBeenCalledWith("실패");
  });

  it("should skip rollback when strategy is none", async () => {
    const context = makeFailureContext();
    context.rollbackStrategy = "none";

    const result = await handlePipelineFailure(context);

    expect(result).toBe("Test failure");
    expect(mockRollbackToCheckpoint).not.toHaveBeenCalled();
  });

  it("should continue when rollback fails", async () => {
    const context = makeFailureContext();
    mockRollbackToCheckpoint.mockRejectedValue(new Error("Rollback failed"));

    const result = await handlePipelineFailure(context);

    expect(result).toBe("Test failure");
    expect(mockRollbackToCheckpoint).toHaveBeenCalled();
  });

  it("should cleanup worktree on failure when enabled", async () => {
    const context = makeFailureContext();

    await handlePipelineFailure(context);

    expect(mockRemoveWorktree).toHaveBeenCalledWith(
      { gitPath: "git" },
      "/tmp/wt/42-fix-bug",
      { cwd: "/tmp/project", force: true }
    );
  });

  it("should cleanup branch on failure when enabled", async () => {
    const context = makeFailureContext();

    await handlePipelineFailure(context);

    expect(mockRunCli).toHaveBeenCalledWith(
      "git",
      ["branch", "-D", "ax/42-fix-bug"],
      { cwd: "/tmp/project" }
    );
  });

  it("should skip cleanup when cleanupOnFailure is false", async () => {
    const context = makeFailureContext();
    context.cleanupOnFailure = false;

    await handlePipelineFailure(context);

    expect(mockRemoveWorktree).not.toHaveBeenCalled();
    expect(mockRunCli).not.toHaveBeenCalledWith(
      "git",
      ["branch", "-D", expect.any(String)],
      expect.any(Object)
    );
  });
});