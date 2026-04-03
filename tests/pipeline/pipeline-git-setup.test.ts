import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies
vi.mock("../../src/git/branch-manager.js", () => ({
  syncBaseBranch: vi.fn(),
  createWorkBranch: vi.fn(),
}));
vi.mock("../../src/git/worktree-manager.js", () => ({
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
}));
vi.mock("../../src/pipeline/dependency-installer.js", () => ({
  installDependencies: vi.fn(),
}));
vi.mock("../../src/safety/rollback-manager.js", () => ({
  createCheckpoint: vi.fn(),
}));
vi.mock("../../src/utils/slug.js", () => ({
  createSlugWithFallback: vi.fn(),
}));
vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));
vi.mock("../../src/git/repo-lock.js", () => ({
  withRepoLock: vi.fn((_repo: string, fn: () => Promise<void>) => fn()),
}));
vi.mock("../../src/config/skill-loader.js", () => ({
  loadSkills: vi.fn(),
  formatSkillsForPrompt: vi.fn(),
}));
vi.mock("../../src/utils/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));
vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

import { setupGitEnvironment, prepareWorkEnvironment } from "../../src/pipeline/pipeline-git-setup.js";
import { syncBaseBranch, createWorkBranch } from "../../src/git/branch-manager.js";
import { createWorktree, removeWorktree } from "../../src/git/worktree-manager.js";
import { installDependencies } from "../../src/pipeline/dependency-installer.js";
import { createCheckpoint } from "../../src/safety/rollback-manager.js";
import { createSlugWithFallback } from "../../src/utils/slug.js";
import { runCli } from "../../src/utils/cli-runner.js";
import { withRepoLock } from "../../src/git/repo-lock.js";
import { loadSkills, formatSkillsForPrompt } from "../../src/config/skill-loader.js";
import { readFileSync, existsSync } from "fs";

const mockSyncBaseBranch = vi.mocked(syncBaseBranch);
const mockCreateWorkBranch = vi.mocked(createWorkBranch);
const mockCreateWorktree = vi.mocked(createWorktree);
const mockRemoveWorktree = vi.mocked(removeWorktree);
const mockInstallDependencies = vi.mocked(installDependencies);
const mockCreateCheckpoint = vi.mocked(createCheckpoint);
const mockCreateSlugWithFallback = vi.mocked(createSlugWithFallback);
const mockRunCli = vi.mocked(runCli);
const mockWithRepoLock = vi.mocked(withRepoLock);
const mockLoadSkills = vi.mocked(loadSkills);
const mockFormatSkillsForPrompt = vi.mocked(formatSkillsForPrompt);
const mockReadFileSync = vi.mocked(readFileSync);
const mockExistsSync = vi.mocked(existsSync);

const defaultGitConfig = {
  defaultBaseBranch: "master",
  branchTemplate: "ax/{issueNumber}-{slug}",
  commitMessageTemplate: "[#{issueNumber}] {phase}: {summary}",
  remoteAlias: "origin",
  allowedRepos: ["test/repo"],
  gitPath: "git",
  fetchDepth: 0,
  signCommits: false,
};

const defaultWorktreeConfig = {
  rootPath: "/tmp/worktrees",
  cleanupOnSuccess: true,
  cleanupOnFailure: false,
  maxAge: "7d",
  dirTemplate: "{issueNumber}-{slug}",
};

const mockJobLogger = {
  setStep: vi.fn(),
  log: vi.fn(),
};

describe("setupGitEnvironment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithRepoLock.mockImplementation((_repo: string, fn: () => Promise<void>) => fn());
  });

  it("should set up git environment successfully", async () => {
    mockCreateWorkBranch.mockResolvedValue({
      baseBranch: "master",
      workBranch: "ax/42-fix-bug",
    });
    mockCreateSlugWithFallback.mockReturnValue("fix-bug");
    mockCreateWorktree.mockResolvedValue({
      path: "/tmp/worktrees/42-fix-bug",
      branch: "ax/42-fix-bug",
    });

    const result = await setupGitEnvironment({
      issueNumber: 42,
      issueTitle: "Fix bug",
      repo: "test/repo",
      projectRoot: "/project",
      gitConfig: defaultGitConfig,
      worktreeConfig: defaultWorktreeConfig,
      state: "VALIDATED",
      isRetry: false,
      jl: mockJobLogger,
    });

    expect(result.branchName).toBe("ax/42-fix-bug");
    expect(result.worktreePath).toBe("/tmp/worktrees/42-fix-bug");
    expect(result.state).toBe("WORKTREE_CREATED");
    expect(mockWithRepoLock).toHaveBeenCalledWith("test/repo", expect.any(Function));
    expect(mockSyncBaseBranch).toHaveBeenCalledWith(defaultGitConfig, { cwd: "/project" });
    expect(mockCreateWorkBranch).toHaveBeenCalledWith(defaultGitConfig, 42, "Fix bug", { cwd: "/project" });
    expect(mockCreateWorktree).toHaveBeenCalledWith(
      defaultGitConfig,
      defaultWorktreeConfig,
      "ax/42-fix-bug",
      42,
      "fix-bug",
      { cwd: "/project" }
    );
  });

  it("should skip base sync if already past that state", async () => {
    mockCreateSlugWithFallback.mockReturnValue("fix-bug");
    mockCreateWorktree.mockResolvedValue({
      path: "/tmp/worktrees/42-fix-bug",
      branch: "ax/42-fix-bug",
    });

    await setupGitEnvironment({
      issueNumber: 42,
      issueTitle: "Fix bug",
      repo: "test/repo",
      projectRoot: "/project",
      gitConfig: defaultGitConfig,
      worktreeConfig: defaultWorktreeConfig,
      state: "BRANCH_CREATED", // Past BASE_SYNCED
      isRetry: false,
    });

    expect(mockSyncBaseBranch).not.toHaveBeenCalled();
    expect(mockCreateWorkBranch).not.toHaveBeenCalled(); // Also past BRANCH_CREATED
  });

  it("should clean up existing worktree on retry", async () => {
    mockExistsSync.mockReturnValue(true);
    mockSyncBaseBranch.mockResolvedValue(undefined);
    mockCreateWorkBranch.mockResolvedValue({
      baseBranch: "master",
      workBranch: "ax/42-fix-bug",
    });
    mockCreateSlugWithFallback.mockReturnValue("fix-bug");
    mockCreateWorktree.mockResolvedValue({
      path: "/tmp/worktrees/42-fix-bug",
      branch: "ax/42-fix-bug",
    });
    mockRemoveWorktree.mockResolvedValue(undefined);

    const result = await setupGitEnvironment({
      issueNumber: 42,
      issueTitle: "Fix bug",
      repo: "test/repo",
      projectRoot: "/project",
      gitConfig: defaultGitConfig,
      worktreeConfig: defaultWorktreeConfig,
      state: "VALIDATED", // Start from earlier state for retry
      isRetry: true,
      jl: mockJobLogger,
    });

    expect(mockJobLogger.log).toHaveBeenCalledWith("재시도 작업 - 기존 worktree 정리 시도 중...");
    expect(result.state).toBe("WORKTREE_CREATED");
  });

  it("should handle worktree cleanup failure gracefully on retry", async () => {
    mockExistsSync.mockReturnValue(true);
    mockSyncBaseBranch.mockResolvedValue(undefined);
    mockCreateWorkBranch.mockResolvedValue({
      baseBranch: "master",
      workBranch: "ax/42-fix-bug",
    });
    mockCreateSlugWithFallback.mockReturnValue("fix-bug");
    mockCreateWorktree.mockResolvedValue({
      path: "/tmp/worktrees/42-fix-bug",
      branch: "ax/42-fix-bug",
    });
    mockRemoveWorktree.mockRejectedValue(new Error("cleanup failed"));
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    const result = await setupGitEnvironment({
      issueNumber: 42,
      issueTitle: "Fix bug",
      repo: "test/repo",
      projectRoot: "/project",
      gitConfig: defaultGitConfig,
      worktreeConfig: defaultWorktreeConfig,
      state: "VALIDATED", // Start from earlier state
      isRetry: true,
      jl: mockJobLogger,
    });

    expect(mockRemoveWorktree).toHaveBeenCalled();
    expect(mockRunCli).toHaveBeenCalledWith("git", ["worktree", "prune"], { cwd: "/project" });
    expect(mockJobLogger.log).toHaveBeenCalledWith(
      "워크트리 정리 실패했지만 계속 진행 (branch-manager에서 완전 정리 예정)"
    );
    expect(result.state).toBe("WORKTREE_CREATED");
  });

  it("should throw if missing branch name or worktree path", async () => {
    mockCreateWorkBranch.mockResolvedValue({
      baseBranch: "master",
      workBranch: "",
    });

    await expect(setupGitEnvironment({
      issueNumber: 42,
      issueTitle: "Fix bug",
      repo: "test/repo",
      projectRoot: "/project",
      gitConfig: defaultGitConfig,
      worktreeConfig: defaultWorktreeConfig,
      state: "VALIDATED",
      isRetry: false,
    })).rejects.toThrow("Failed to set up Git environment");
  });

  it("should verify worktree exists when resuming", async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(setupGitEnvironment({
      issueNumber: 42,
      issueTitle: "Fix bug",
      repo: "test/repo",
      projectRoot: "/project",
      gitConfig: defaultGitConfig,
      worktreeConfig: defaultWorktreeConfig,
      state: "WORKTREE_CREATED",
      isRetry: false,
    })).rejects.toThrow("Resume failed: worktree path no longer exists");
  });
});

describe("prepareWorkEnvironment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should prepare work environment successfully", async () => {
    const mockProject = {
      commands: {
        preInstall: ["npm install"],
        claudeMdPath: "CLAUDE.md",
        skillsPath: "skills",
      },
    };

    mockCreateCheckpoint.mockResolvedValue("abc123def456");
    mockInstallDependencies.mockResolvedValue(undefined);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("# Project conventions\n");
    mockLoadSkills.mockReturnValue([
      { name: "Test Skill", category: "dev", description: "Test", content: "skill content" }
    ]);
    mockFormatSkillsForPrompt.mockReturnValue("## dev\n### Test Skill\nTest\nskill content");
    mockRunCli.mockResolvedValue({
      stdout: "src/index.ts\nsrc/utils.ts\n",
      stderr: "",
      exitCode: 0,
    });

    const result = await prepareWorkEnvironment({
      projectRoot: "/project",
      worktreePath: "/tmp/worktree",
      gitConfig: defaultGitConfig,
      project: mockProject,
      rollbackStrategy: "checkpoint",
      jl: mockJobLogger,
    });

    expect(result.rollbackHash).toBe("abc123def456");
    expect(result.projectConventions).toBe("# Project conventions\n");
    expect(result.skillsContext).toBe("## dev\n### Test Skill\nTest\nskill content");
    expect(result.repoStructure).toBe("src/index.ts\nsrc/utils.ts");

    expect(mockCreateCheckpoint).toHaveBeenCalledWith({
      cwd: "/tmp/worktree",
      gitPath: "git",
    });
    expect(mockInstallDependencies).toHaveBeenCalledWith(["npm install"], {
      cwd: "/tmp/worktree",
    });
    expect(mockRunCli).toHaveBeenCalledWith(
      "git",
      ["ls-tree", "-r", "--name-only", "HEAD"],
      { cwd: "/tmp/worktree" }
    );
  });

  it("should skip rollback checkpoint when strategy is none", async () => {
    const mockProject = {
      commands: {
        preInstall: null,
        claudeMdPath: null,
        skillsPath: null,
      },
    };

    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    const result = await prepareWorkEnvironment({
      projectRoot: "/project",
      worktreePath: "/tmp/worktree",
      gitConfig: defaultGitConfig,
      project: mockProject,
      rollbackStrategy: "none",
    });

    expect(result.rollbackHash).toBeUndefined();
    expect(mockCreateCheckpoint).not.toHaveBeenCalled();
  });

  it("should handle checkpoint creation failure gracefully", async () => {
    const mockProject = {
      commands: {
        preInstall: null,
        claudeMdPath: null,
        skillsPath: null,
      },
    };

    mockCreateCheckpoint.mockRejectedValue(new Error("checkpoint failed"));
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    const result = await prepareWorkEnvironment({
      projectRoot: "/project",
      worktreePath: "/tmp/worktree",
      gitConfig: defaultGitConfig,
      project: mockProject,
      rollbackStrategy: "checkpoint",
    });

    expect(result.rollbackHash).toBeUndefined();
    expect(mockCreateCheckpoint).toHaveBeenCalled();
  });

  it("should skip dependency installation when preInstall is null", async () => {
    const mockProject = {
      commands: {
        preInstall: null,
        claudeMdPath: null,
        skillsPath: null,
      },
    };

    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    await prepareWorkEnvironment({
      projectRoot: "/project",
      worktreePath: "/tmp/worktree",
      gitConfig: defaultGitConfig,
      project: mockProject,
      rollbackStrategy: "none",
    });

    expect(mockInstallDependencies).not.toHaveBeenCalled();
  });

  it("should load CLAUDE.md from worktree first, then project root", async () => {
    const mockProject = {
      commands: {
        preInstall: null,
        claudeMdPath: "CLAUDE.md",
        skillsPath: null,
      },
    };

    // First call (worktree) returns true, second call (project root) not called
    mockExistsSync.mockReturnValueOnce(true);
    mockReadFileSync.mockReturnValue("worktree conventions");
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    const result = await prepareWorkEnvironment({
      projectRoot: "/project",
      worktreePath: "/tmp/worktree",
      gitConfig: defaultGitConfig,
      project: mockProject,
      rollbackStrategy: "none",
    });

    expect(result.projectConventions).toBe("worktree conventions");
    expect(mockExistsSync).toHaveBeenCalledWith("/tmp/worktree/CLAUDE.md");
    expect(mockReadFileSync).toHaveBeenCalledWith("/tmp/worktree/CLAUDE.md", "utf-8");
  });

  it("should fallback to project root when worktree CLAUDE.md doesn't exist", async () => {
    const mockProject = {
      commands: {
        preInstall: null,
        claudeMdPath: "CLAUDE.md",
        skillsPath: null,
      },
    };

    // First call (worktree) returns false, second call (project root) returns true
    mockExistsSync.mockReturnValueOnce(false).mockReturnValueOnce(true);
    mockReadFileSync.mockReturnValue("project root conventions");
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    const result = await prepareWorkEnvironment({
      projectRoot: "/project",
      worktreePath: "/tmp/worktree",
      gitConfig: defaultGitConfig,
      project: mockProject,
      rollbackStrategy: "none",
    });

    expect(result.projectConventions).toBe("project root conventions");
    expect(mockExistsSync).toHaveBeenCalledWith("/tmp/worktree/CLAUDE.md");
    expect(mockExistsSync).toHaveBeenCalledWith("/project/CLAUDE.md");
    expect(mockReadFileSync).toHaveBeenCalledWith("/project/CLAUDE.md", "utf-8");
  });

  it("should handle missing CLAUDE.md gracefully", async () => {
    const mockProject = {
      commands: {
        preInstall: null,
        claudeMdPath: "CLAUDE.md",
        skillsPath: null,
      },
    };

    mockExistsSync.mockReturnValue(false);
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    const result = await prepareWorkEnvironment({
      projectRoot: "/project",
      worktreePath: "/tmp/worktree",
      gitConfig: defaultGitConfig,
      project: mockProject,
      rollbackStrategy: "none",
    });

    expect(result.projectConventions).toBe("");
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("should load skills when skillsPath is provided", async () => {
    const mockProject = {
      commands: {
        preInstall: null,
        claudeMdPath: null,
        skillsPath: "skills",
      },
    };

    const mockSkills = [
      { name: "Skill 1", category: "dev", description: "Description 1", content: "Content 1" },
      { name: "Skill 2", category: "ops", description: "Description 2", content: "Content 2" },
    ];

    mockLoadSkills.mockReturnValue(mockSkills);
    mockFormatSkillsForPrompt.mockReturnValue("formatted skills");
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    const result = await prepareWorkEnvironment({
      projectRoot: "/project",
      worktreePath: "/tmp/worktree",
      gitConfig: defaultGitConfig,
      project: mockProject,
      rollbackStrategy: "none",
    });

    expect(result.skillsContext).toBe("formatted skills");
    expect(mockLoadSkills).toHaveBeenCalledWith("/project/skills");
    expect(mockFormatSkillsForPrompt).toHaveBeenCalledWith(mockSkills);
  });

  it("should handle empty skills gracefully", async () => {
    const mockProject = {
      commands: {
        preInstall: null,
        claudeMdPath: null,
        skillsPath: "skills",
      },
    };

    mockLoadSkills.mockReturnValue([]);
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    const result = await prepareWorkEnvironment({
      projectRoot: "/project",
      worktreePath: "/tmp/worktree",
      gitConfig: defaultGitConfig,
      project: mockProject,
      rollbackStrategy: "none",
    });

    expect(result.skillsContext).toBe("");
    expect(mockFormatSkillsForPrompt).not.toHaveBeenCalled();
  });

  it("should limit repo structure output to 200 lines", async () => {
    const mockProject = {
      commands: {
        preInstall: null,
        claudeMdPath: null,
        skillsPath: null,
      },
    };

    // Create output with more than 200 lines
    const manyFiles = Array.from({ length: 300 }, (_, i) => `src/file${i}.ts`).join("\n");
    mockRunCli.mockResolvedValue({ stdout: manyFiles, stderr: "", exitCode: 0 });

    const result = await prepareWorkEnvironment({
      projectRoot: "/project",
      worktreePath: "/tmp/worktree",
      gitConfig: defaultGitConfig,
      project: mockProject,
      rollbackStrategy: "none",
    });

    const lines = result.repoStructure.split("\n");
    expect(lines.length).toBe(200);
    expect(result.repoStructure).toContain("src/file0.ts");
    expect(result.repoStructure).toContain("src/file199.ts");
    expect(result.repoStructure).not.toContain("src/file200.ts");
  });
});