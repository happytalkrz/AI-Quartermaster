import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  loadCheckpoint: vi.fn(),
  removeCheckpoint: vi.fn(),
  removeWorktree: vi.fn(),
  deleteRemoteBranch: vi.fn(),
}));

vi.mock("../../src/pipeline/errors/checkpoint.js", () => ({
  loadCheckpoint: mocks.loadCheckpoint,
  removeCheckpoint: mocks.removeCheckpoint,
}));

vi.mock("../../src/git/worktree-manager.js", () => ({
  removeWorktree: mocks.removeWorktree,
}));

vi.mock("../../src/git/branch-manager.js", () => ({
  deleteRemoteBranch: mocks.deleteRemoteBranch,
}));

import { JobCleanupService } from "../../src/queue/job-cleanup.js";
import type { ConfigProvider } from "../../src/config/config-provider.js";
import type { AQConfig } from "../../src/types/config.js";

function makeProvider(): ConfigProvider {
  return {
    current: () => ({ git: { gitPath: "git" } } as unknown as AQConfig),
    refresh: () => {},
  };
}

describe("JobCleanupService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("worktree와 branch 정리를 모두 await한 후 반환한다 (race 차단)", async () => {
    let worktreeResolved = false;
    let branchResolved = false;

    mocks.loadCheckpoint.mockReturnValue({
      worktreePath: "/tmp/worktree",
      branchName: "feat/test",
    });
    mocks.removeWorktree.mockImplementation(
      () =>
        new Promise<void>(r => {
          setTimeout(() => {
            worktreeResolved = true;
            r();
          }, 10);
        })
    );
    mocks.deleteRemoteBranch.mockImplementation(
      () =>
        new Promise<void>(r => {
          setTimeout(() => {
            branchResolved = true;
            r();
          }, 5);
        })
    );

    const service = new JobCleanupService("/aq/root", makeProvider());
    await service.cleanupFailedJobArtifacts(42);

    expect(worktreeResolved).toBe(true);
    expect(branchResolved).toBe(true);
    expect(mocks.removeCheckpoint).toHaveBeenCalledWith(expect.stringContaining("data"), 42);
  });

  it("worktree 제거 실패해도 branch/checkpoint 제거는 진행", async () => {
    mocks.loadCheckpoint.mockReturnValue({
      worktreePath: "/tmp/worktree",
      branchName: "feat/test",
    });
    mocks.removeWorktree.mockRejectedValue(new Error("worktree gone"));
    mocks.deleteRemoteBranch.mockResolvedValue(undefined);

    const service = new JobCleanupService("/aq/root", makeProvider());
    await expect(service.cleanupFailedJobArtifacts(42)).resolves.toBeUndefined();

    expect(mocks.deleteRemoteBranch).toHaveBeenCalled();
    expect(mocks.removeCheckpoint).toHaveBeenCalled();
  });

  it("checkpoint 로드 실패해도 removeCheckpoint는 시도", async () => {
    mocks.loadCheckpoint.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const service = new JobCleanupService("/aq/root", makeProvider());
    await service.cleanupFailedJobArtifacts(7);

    expect(mocks.removeWorktree).not.toHaveBeenCalled();
    expect(mocks.deleteRemoteBranch).not.toHaveBeenCalled();
    expect(mocks.removeCheckpoint).toHaveBeenCalledWith(expect.stringContaining("data"), 7);
  });

  it("checkpoint가 없으면 worktree/branch 정리도 스킵", async () => {
    mocks.loadCheckpoint.mockReturnValue(null);

    const service = new JobCleanupService("/aq/root", makeProvider());
    await service.cleanupFailedJobArtifacts(99);

    expect(mocks.removeWorktree).not.toHaveBeenCalled();
    expect(mocks.deleteRemoteBranch).not.toHaveBeenCalled();
    expect(mocks.removeCheckpoint).toHaveBeenCalled();
  });
});
