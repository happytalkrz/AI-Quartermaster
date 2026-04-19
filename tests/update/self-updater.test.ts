import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  getLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { SelfUpdater, type UpdateInfo } from "../../src/update/self-updater.js";
import { runCli } from "../../src/utils/cli-runner.js";

const mockRunCli = vi.mocked(runCli);

const defaultGitConfig = {
  defaultBaseBranch: "main",
  branchTemplate: "ax/{issueNumber}-{slug}",
  commitMessageTemplate: "[#{issueNumber}] {phase}: {summary}",
  remoteAlias: "origin",
  allowedRepos: ["test/repo"],
  gitPath: "git",
  fetchDepth: 0,
  signCommits: false,
};

const defaultOptions = {
  cwd: "/test/project",
};

describe("SelfUpdater", () => {
  let selfUpdater: SelfUpdater;

  beforeEach(() => {
    vi.clearAllMocks();
    selfUpdater = new SelfUpdater(defaultGitConfig, defaultOptions);
  });

  describe("checkForUpdates", () => {
    it("should detect no updates when hashes match", async () => {
      const sameHash = "abc123def456";
      mockRunCli
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git fetch
        .mockResolvedValueOnce({ stdout: `${sameHash}\n`, stderr: "", exitCode: 0 }) // current HEAD
        .mockResolvedValueOnce({ stdout: `${sameHash}\n`, stderr: "", exitCode: 0 }); // remote HEAD

      const result = await selfUpdater.checkForUpdates();

      expect(result).toEqual({
        hasUpdates: false,
        currentHash: sameHash,
        remoteHash: sameHash,
        packageLockChanged: false,
      });

      expect(mockRunCli).toHaveBeenCalledWith("git", ["fetch", "origin", "main"], { cwd: "/test/project" });
      expect(mockRunCli).toHaveBeenCalledWith("git", ["rev-parse", "HEAD"], { cwd: "/test/project" });
      expect(mockRunCli).toHaveBeenCalledWith("git", ["rev-parse", "origin/main"], { cwd: "/test/project" });
    });

    it("should detect updates when hashes differ and check package-lock changes", async () => {
      const currentHash = "abc123def456";
      const remoteHash = "def456ghi789";

      mockRunCli
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git fetch
        .mockResolvedValueOnce({ stdout: `${currentHash}\n`, stderr: "", exitCode: 0 }) // current HEAD
        .mockResolvedValueOnce({ stdout: `${remoteHash}\n`, stderr: "", exitCode: 0 }) // remote HEAD
        .mockResolvedValueOnce({ stdout: "package-lock.json\n", stderr: "", exitCode: 0 }); // diff package-lock

      const result = await selfUpdater.checkForUpdates();

      expect(result).toEqual({
        hasUpdates: true,
        currentHash,
        remoteHash,
        packageLockChanged: true,
      });

      expect(mockRunCli).toHaveBeenCalledWith(
        "git",
        ["diff", "--name-only", currentHash, remoteHash, "--", "package-lock.json"],
        { cwd: "/test/project" }
      );
    });

    it("should handle package-lock unchanged when updates exist", async () => {
      const currentHash = "abc123def456";
      const remoteHash = "def456ghi789";

      mockRunCli
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git fetch
        .mockResolvedValueOnce({ stdout: `${currentHash}\n`, stderr: "", exitCode: 0 }) // current HEAD
        .mockResolvedValueOnce({ stdout: `${remoteHash}\n`, stderr: "", exitCode: 0 }) // remote HEAD
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // diff package-lock (no output)

      const result = await selfUpdater.checkForUpdates();

      expect(result.packageLockChanged).toBe(false);
    });

    it("should throw error when git fetch fails", async () => {
      mockRunCli.mockResolvedValueOnce({ stdout: "", stderr: "network error", exitCode: 1 });

      await expect(selfUpdater.checkForUpdates()).rejects.toThrow("git fetch 실패: network error");
    });

    it("should throw error when current HEAD check fails", async () => {
      mockRunCli
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git fetch
        .mockResolvedValueOnce({ stdout: "", stderr: "not a git repo", exitCode: 1 }); // current HEAD

      await expect(selfUpdater.checkForUpdates()).rejects.toThrow("현재 커밋 해시 조회 실패: not a git repo");
    });

    it("should throw error when remote HEAD check fails", async () => {
      mockRunCli
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git fetch
        .mockResolvedValueOnce({ stdout: "abc123\n", stderr: "", exitCode: 0 }) // current HEAD
        .mockResolvedValueOnce({ stdout: "", stderr: "remote not found", exitCode: 1 }); // remote HEAD

      await expect(selfUpdater.checkForUpdates()).rejects.toThrow("원격 커밋 해시 조회 실패: remote not found");
    });

    it("should handle package-lock diff failure gracefully", async () => {
      const currentHash = "abc123def456";
      const remoteHash = "def456ghi789";

      mockRunCli
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git fetch
        .mockResolvedValueOnce({ stdout: `${currentHash}\n`, stderr: "", exitCode: 0 }) // current HEAD
        .mockResolvedValueOnce({ stdout: `${remoteHash}\n`, stderr: "", exitCode: 0 }) // remote HEAD
        .mockResolvedValueOnce({ stdout: "", stderr: "diff failed", exitCode: 1 }); // diff package-lock

      const result = await selfUpdater.checkForUpdates();

      expect(result.packageLockChanged).toBe(false);
    });
  });

  describe("pullUpdates", () => {
    it("should execute git pull successfully", async () => {
      mockRunCli.mockResolvedValueOnce({ stdout: "Already up to date.\n", stderr: "", exitCode: 0 });

      await selfUpdater.pullUpdates();

      expect(mockRunCli).toHaveBeenCalledWith("git", ["pull", "origin", "main"], { cwd: "/test/project" });
    });

    it("should throw error when git pull fails with generic error", async () => {
      mockRunCli.mockResolvedValueOnce({ stdout: "", stderr: "some generic error", exitCode: 1 });

      await expect(selfUpdater.pullUpdates()).rejects.toThrow("git pull 실패: some generic error");
    });

    it("should throw merge conflict error when CONFLICT keyword in stderr", async () => {
      mockRunCli.mockResolvedValueOnce({
        stdout: "",
        stderr: "CONFLICT (content): Merge conflict in src/foo.ts",
        exitCode: 1,
      });

      await expect(selfUpdater.pullUpdates()).rejects.toThrow("머지 충돌 발생");
    });

    it("should throw network error when host resolution fails", async () => {
      mockRunCli.mockResolvedValueOnce({
        stdout: "",
        stderr: "fatal: Could not resolve host: github.com",
        exitCode: 128,
      });

      await expect(selfUpdater.pullUpdates()).rejects.toThrow("네트워크 오류 (호스트 연결 실패)");
    });

    it("should throw when HEAD does not match remoteHash after pull", async () => {
      const remoteHash = "def456ghi789";
      const unexpectedHead = "zzz999yyy888";

      mockRunCli
        .mockResolvedValueOnce({ stdout: "Updated\n", stderr: "", exitCode: 0 }) // git pull
        .mockResolvedValueOnce({ stdout: `${unexpectedHead}\n`, stderr: "", exitCode: 0 }); // git rev-parse HEAD

      await expect(selfUpdater.pullUpdates(remoteHash)).rejects.toThrow(
        "git pull 성공했으나 HEAD가 원격과 동기화되지 않음"
      );
    });
  });

  describe("shouldRunNpmCi", () => {
    it("should return true when updates exist and package-lock changed", () => {
      const updateInfo: UpdateInfo = {
        hasUpdates: true,
        currentHash: "abc123",
        remoteHash: "def456",
        packageLockChanged: true,
      };

      expect(selfUpdater.shouldRunNpmCi(updateInfo)).toBe(true);
    });

    it("should return false when no updates exist", () => {
      const updateInfo: UpdateInfo = {
        hasUpdates: false,
        currentHash: "abc123",
        remoteHash: "abc123",
        packageLockChanged: false,
      };

      expect(selfUpdater.shouldRunNpmCi(updateInfo)).toBe(false);
    });

    it("should return false when updates exist but package-lock unchanged", () => {
      const updateInfo: UpdateInfo = {
        hasUpdates: true,
        currentHash: "abc123",
        remoteHash: "def456",
        packageLockChanged: false,
      };

      expect(selfUpdater.shouldRunNpmCi(updateInfo)).toBe(false);
    });
  });

  describe("runNpmCi", () => {
    it("should execute npm ci successfully", async () => {
      mockRunCli.mockResolvedValueOnce({ stdout: "added 150 packages\n", stderr: "", exitCode: 0 });

      await selfUpdater.runNpmCi();

      expect(mockRunCli).toHaveBeenCalledWith("npm", ["ci"], {
        cwd: "/test/project",
        timeout: 300000,
      });
    });

    it("should throw error when npm ci fails", async () => {
      mockRunCli.mockResolvedValueOnce({ stdout: "", stderr: "package-lock.json not found", exitCode: 1 });

      await expect(selfUpdater.runNpmCi()).rejects.toThrow("npm ci 실패: package-lock.json not found");
    });
  });

  describe("performSelfUpdate", () => {
    it("should return updated: false when no updates are available", async () => {
      const sameHash = "abc123def456";
      mockRunCli
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git fetch
        .mockResolvedValueOnce({ stdout: `${sameHash}\n`, stderr: "", exitCode: 0 }) // current HEAD
        .mockResolvedValueOnce({ stdout: `${sameHash}\n`, stderr: "", exitCode: 0 }); // remote HEAD

      const result = await selfUpdater.performSelfUpdate();

      expect(result).toEqual({ updated: false, needsRestart: false });
    });

    it("should perform full update when updates are available with package-lock changes", async () => {
      const currentHash = "abc123def456";
      const remoteHash = "def456ghi789";

      mockRunCli
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git fetch
        .mockResolvedValueOnce({ stdout: `${currentHash}\n`, stderr: "", exitCode: 0 }) // current HEAD
        .mockResolvedValueOnce({ stdout: `${remoteHash}\n`, stderr: "", exitCode: 0 }) // remote HEAD
        .mockResolvedValueOnce({ stdout: "package-lock.json\n", stderr: "", exitCode: 0 }) // diff package-lock
        .mockResolvedValueOnce({ stdout: "Updated\n", stderr: "", exitCode: 0 }) // git pull
        .mockResolvedValueOnce({ stdout: `${remoteHash}\n`, stderr: "", exitCode: 0 }) // git rev-parse HEAD (post-pull)
        .mockResolvedValueOnce({ stdout: "added 150 packages\n", stderr: "", exitCode: 0 }) // npm ci
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // npm run build

      const result = await selfUpdater.performSelfUpdate();

      expect(result).toEqual({ updated: true, needsRestart: true });
      expect(mockRunCli).toHaveBeenCalledWith("git", ["pull", "origin", "main"], { cwd: "/test/project" });
      expect(mockRunCli).toHaveBeenCalledWith("npm", ["ci"], { cwd: "/test/project", timeout: 300000 });
      expect(mockRunCli).toHaveBeenCalledWith("npm", ["run", "build"], { cwd: "/test/project", timeout: 120000 });
    });

    it("should skip npm ci when package-lock is unchanged", async () => {
      const currentHash = "abc123def456";
      const remoteHash = "def456ghi789";

      mockRunCli
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git fetch
        .mockResolvedValueOnce({ stdout: `${currentHash}\n`, stderr: "", exitCode: 0 }) // current HEAD
        .mockResolvedValueOnce({ stdout: `${remoteHash}\n`, stderr: "", exitCode: 0 }) // remote HEAD
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // diff package-lock (no changes)
        .mockResolvedValueOnce({ stdout: "Updated\n", stderr: "", exitCode: 0 }) // git pull
        .mockResolvedValueOnce({ stdout: `${remoteHash}\n`, stderr: "", exitCode: 0 }) // git rev-parse HEAD (post-pull)
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // npm run build

      const result = await selfUpdater.performSelfUpdate();

      expect(result).toEqual({ updated: true, needsRestart: true });
      expect(mockRunCli).not.toHaveBeenCalledWith("npm", ["ci"], expect.any(Object));
      expect(mockRunCli).toHaveBeenCalledWith("npm", ["run", "build"], { cwd: "/test/project", timeout: 120000 });
    });

    it("should propagate error when git pull fails", async () => {
      const currentHash = "abc123def456";
      const remoteHash = "def456ghi789";

      mockRunCli
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git fetch
        .mockResolvedValueOnce({ stdout: `${currentHash}\n`, stderr: "", exitCode: 0 }) // current HEAD
        .mockResolvedValueOnce({ stdout: `${remoteHash}\n`, stderr: "", exitCode: 0 }) // remote HEAD
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // diff package-lock
        .mockResolvedValueOnce({ stdout: "", stderr: "merge conflict", exitCode: 1 }); // git pull

      await expect(selfUpdater.performSelfUpdate()).rejects.toThrow("git pull 실패: merge conflict");
    });

    it("should throw conflict error with context when CONFLICT keyword in stderr", async () => {
      const currentHash = "abc123def456";
      const remoteHash = "def456ghi789";

      mockRunCli
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git fetch
        .mockResolvedValueOnce({ stdout: `${currentHash}\n`, stderr: "", exitCode: 0 }) // current HEAD
        .mockResolvedValueOnce({ stdout: `${remoteHash}\n`, stderr: "", exitCode: 0 }) // remote HEAD
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // diff package-lock
        .mockResolvedValueOnce({ stdout: "", stderr: "CONFLICT (content): Merge conflict in src/foo.ts", exitCode: 1 }); // git pull

      await expect(selfUpdater.performSelfUpdate()).rejects.toThrow("머지 충돌 발생");
    });

    it("should throw network error with context when host resolution fails", async () => {
      const currentHash = "abc123def456";
      const remoteHash = "def456ghi789";

      mockRunCli
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git fetch
        .mockResolvedValueOnce({ stdout: `${currentHash}\n`, stderr: "", exitCode: 0 }) // current HEAD
        .mockResolvedValueOnce({ stdout: `${remoteHash}\n`, stderr: "", exitCode: 0 }) // remote HEAD
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // diff package-lock
        .mockResolvedValueOnce({ stdout: "", stderr: "fatal: Could not resolve host: github.com", exitCode: 1 }); // git pull

      await expect(selfUpdater.performSelfUpdate()).rejects.toThrow("네트워크 오류 (호스트 연결 실패)");
    });

    it("should throw auth error with context when authentication fails", async () => {
      const currentHash = "abc123def456";
      const remoteHash = "def456ghi789";

      mockRunCli
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git fetch
        .mockResolvedValueOnce({ stdout: `${currentHash}\n`, stderr: "", exitCode: 0 }) // current HEAD
        .mockResolvedValueOnce({ stdout: `${remoteHash}\n`, stderr: "", exitCode: 0 }) // remote HEAD
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // diff package-lock
        .mockResolvedValueOnce({ stdout: "", stderr: "fatal: Authentication failed for 'https://github.com/repo'", exitCode: 1 }); // git pull

      await expect(selfUpdater.performSelfUpdate()).rejects.toThrow("인증 실패");
    });

    it("should throw when HEAD does not match remoteHash after pull", async () => {
      const currentHash = "abc123def456";
      const remoteHash = "def456ghi789";
      const unexpectedHead = "zzz999yyy888";

      mockRunCli
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git fetch
        .mockResolvedValueOnce({ stdout: `${currentHash}\n`, stderr: "", exitCode: 0 }) // current HEAD
        .mockResolvedValueOnce({ stdout: `${remoteHash}\n`, stderr: "", exitCode: 0 }) // remote HEAD
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // diff package-lock
        .mockResolvedValueOnce({ stdout: "Updated\n", stderr: "", exitCode: 0 }) // git pull
        .mockResolvedValueOnce({ stdout: `${unexpectedHead}\n`, stderr: "", exitCode: 0 }); // git rev-parse HEAD (post-pull)

      await expect(selfUpdater.performSelfUpdate()).rejects.toThrow(
        "git pull 성공했으나 HEAD가 원격과 동기화되지 않음"
      );
    });

    it("should propagate error when npm ci fails", async () => {
      const currentHash = "abc123def456";
      const remoteHash = "def456ghi789";

      mockRunCli
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // git fetch
        .mockResolvedValueOnce({ stdout: `${currentHash}\n`, stderr: "", exitCode: 0 }) // current HEAD
        .mockResolvedValueOnce({ stdout: `${remoteHash}\n`, stderr: "", exitCode: 0 }) // remote HEAD
        .mockResolvedValueOnce({ stdout: "package-lock.json\n", stderr: "", exitCode: 0 }) // diff package-lock
        .mockResolvedValueOnce({ stdout: "Updated\n", stderr: "", exitCode: 0 }) // git pull
        .mockResolvedValueOnce({ stdout: `${remoteHash}\n`, stderr: "", exitCode: 0 }) // git rev-parse HEAD (post-pull)
        .mockResolvedValueOnce({ stdout: "", stderr: "install failed", exitCode: 1 }); // npm ci

      await expect(selfUpdater.performSelfUpdate()).rejects.toThrow("npm ci 실패: install failed");
    });
  });
});