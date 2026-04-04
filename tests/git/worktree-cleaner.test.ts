import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseDuration, cleanOldWorktrees } from "../../src/git/worktree-cleaner.js";
import type { GitConfig, WorktreeConfig } from "../../src/types/config.js";

// Mock dependencies
vi.mock("../../src/git/worktree-manager.js", () => ({
  listWorktrees: vi.fn(),
  removeWorktree: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
  })),
}));

vi.mock("fs", () => ({
  statSync: vi.fn(),
}));

const mockListWorktrees = vi.mocked(await import("../../src/git/worktree-manager.js")).listWorktrees;
const mockRemoveWorktree = vi.mocked(await import("../../src/git/worktree-manager.js")).removeWorktree;
const mockStatSync = vi.mocked(await import("fs")).statSync;

describe("parseDuration", () => {
  it("should parse days correctly", () => {
    expect(parseDuration("7d")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseDuration("1d")).toBe(24 * 60 * 60 * 1000);
    expect(parseDuration("30d")).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("should parse hours correctly", () => {
    expect(parseDuration("12h")).toBe(12 * 60 * 60 * 1000);
    expect(parseDuration("1h")).toBe(60 * 60 * 1000);
    expect(parseDuration("24h")).toBe(24 * 60 * 60 * 1000);
  });

  it("should parse minutes correctly", () => {
    expect(parseDuration("30m")).toBe(30 * 60 * 1000);
    expect(parseDuration("1m")).toBe(60 * 1000);
    expect(parseDuration("120m")).toBe(120 * 60 * 1000);
  });

  it("should throw error for invalid format", () => {
    expect(() => parseDuration("invalid")).toThrow("Invalid duration format: invalid");
    expect(() => parseDuration("7")).toThrow("Invalid duration format: 7");
    expect(() => parseDuration("7x")).toThrow("Invalid duration format: 7x");
    expect(() => parseDuration("")).toThrow("Invalid duration format: ");
  });

  it("should throw error for unknown unit", () => {
    expect(() => parseDuration("7s")).toThrow("Invalid duration format: 7s");
    expect(() => parseDuration("7w")).toThrow("Invalid duration format: 7w");
  });

  it("should handle zero values", () => {
    expect(parseDuration("0d")).toBe(0);
    expect(parseDuration("0h")).toBe(0);
    expect(parseDuration("0m")).toBe(0);
  });
});

describe("cleanOldWorktrees", () => {
  let gitConfig: GitConfig;
  let worktreeConfig: WorktreeConfig;
  let options: { cwd: string };

  beforeEach(() => {
    vi.clearAllMocks();

    gitConfig = {
      defaultBaseBranch: "main",
      branchTemplate: "aq/{{issueNumber}}-{{slug}}",
      commitMessageTemplate: "[#{{issueNumber}}] {{title}}",
      remoteAlias: "origin",
      allowedRepos: ["test/repo"],
      gitPath: "git",
      fetchDepth: 50,
      signCommits: false,
    };

    worktreeConfig = {
      rootPath: "/tmp/worktrees",
      cleanupOnSuccess: true,
      cleanupOnFailure: false,
      maxAge: "7d",
      dirTemplate: "{{issueNumber}}-{{slug}}",
    };

    options = { cwd: "/project/root" };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should remove old worktrees successfully", async () => {
    const now = Date.now();
    const oldTime = now - (8 * 24 * 60 * 60 * 1000); // 8 days ago

    mockListWorktrees.mockResolvedValue([
      { path: "/project/root", branch: "main" }, // main worktree - should be skipped
      { path: "/tmp/worktrees/123-old", branch: "aq/123-old" },
      { path: "/tmp/worktrees/124-new", branch: "aq/124-new" },
    ]);

    mockStatSync
      .mockReturnValueOnce({ mtimeMs: oldTime } as any) // old worktree
      .mockReturnValueOnce({ mtimeMs: now - 1000 } as any); // new worktree

    const removed = await cleanOldWorktrees(gitConfig, worktreeConfig, options);

    expect(removed).toEqual(["/tmp/worktrees/123-old"]);
    expect(mockRemoveWorktree).toHaveBeenCalledWith(
      gitConfig,
      "/tmp/worktrees/123-old",
      { cwd: options.cwd, force: true }
    );
    expect(mockRemoveWorktree).toHaveBeenCalledTimes(1);
  });

  it("should skip main worktree", async () => {
    mockListWorktrees.mockResolvedValue([
      { path: "/project/root", branch: "main" },
    ]);

    const removed = await cleanOldWorktrees(gitConfig, worktreeConfig, options);

    expect(removed).toEqual([]);
    expect(mockRemoveWorktree).not.toHaveBeenCalled();
  });

  it("should handle worktrees that cannot be stated", async () => {
    mockListWorktrees.mockResolvedValue([
      { path: "/tmp/worktrees/missing", branch: "aq/missing" },
    ]);

    mockStatSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const removed = await cleanOldWorktrees(gitConfig, worktreeConfig, options);

    expect(removed).toEqual([]);
    expect(mockRemoveWorktree).not.toHaveBeenCalled();
  });

  it("should not remove recent worktrees", async () => {
    const now = Date.now();
    const recentTime = now - (2 * 24 * 60 * 60 * 1000); // 2 days ago

    mockListWorktrees.mockResolvedValue([
      { path: "/tmp/worktrees/123-recent", branch: "aq/123-recent" },
    ]);

    mockStatSync.mockReturnValue({ mtimeMs: recentTime } as any);

    const removed = await cleanOldWorktrees(gitConfig, worktreeConfig, options);

    expect(removed).toEqual([]);
    expect(mockRemoveWorktree).not.toHaveBeenCalled();
  });

  it("should handle empty worktree list", async () => {
    mockListWorktrees.mockResolvedValue([]);

    const removed = await cleanOldWorktrees(gitConfig, worktreeConfig, options);

    expect(removed).toEqual([]);
    expect(mockRemoveWorktree).not.toHaveBeenCalled();
  });

  it("should handle different maxAge configurations", async () => {
    const now = Date.now();
    const oldTime = now - (2 * 60 * 60 * 1000); // 2 hours ago

    worktreeConfig.maxAge = "1h"; // 1 hour max age

    mockListWorktrees.mockResolvedValue([
      { path: "/tmp/worktrees/123-old", branch: "aq/123-old" },
    ]);

    mockStatSync.mockReturnValue({ mtimeMs: oldTime } as any);

    const removed = await cleanOldWorktrees(gitConfig, worktreeConfig, options);

    expect(removed).toEqual(["/tmp/worktrees/123-old"]);
    expect(mockRemoveWorktree).toHaveBeenCalledWith(
      gitConfig,
      "/tmp/worktrees/123-old",
      { cwd: options.cwd, force: true }
    );
  });

  it("should handle mixed old and new worktrees", async () => {
    const now = Date.now();
    const oldTime = now - (8 * 24 * 60 * 60 * 1000); // 8 days ago
    const newTime = now - (2 * 24 * 60 * 60 * 1000); // 2 days ago

    mockListWorktrees.mockResolvedValue([
      { path: "/project/root", branch: "main" },
      { path: "/tmp/worktrees/123-old", branch: "aq/123-old" },
      { path: "/tmp/worktrees/124-new", branch: "aq/124-new" },
      { path: "/tmp/worktrees/125-old", branch: "aq/125-old" },
    ]);

    mockStatSync
      .mockReturnValueOnce({ mtimeMs: oldTime } as any)  // 123-old
      .mockReturnValueOnce({ mtimeMs: newTime } as any)  // 124-new
      .mockReturnValueOnce({ mtimeMs: oldTime } as any); // 125-old

    const removed = await cleanOldWorktrees(gitConfig, worktreeConfig, options);

    expect(removed).toEqual(["/tmp/worktrees/123-old", "/tmp/worktrees/125-old"]);
    expect(mockRemoveWorktree).toHaveBeenCalledTimes(2);
  });
});