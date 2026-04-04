import { describe, it, expect, vi, beforeEach } from "vitest";
import { assertNotOnBaseBranch } from "../../src/safety/base-branch-guard.js";
import { SafetyViolationError } from "../../src/types/errors.js";
import { runCli } from "../../src/utils/cli-runner.js";

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

const mockRunCli = vi.mocked(runCli);

describe("assertNotOnBaseBranch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should pass when current branch is not the base branch", async () => {
    mockRunCli.mockResolvedValue({
      code: 0,
      stdout: "feature/new-feature\n",
      stderr: "",
    });

    await expect(
      assertNotOnBaseBranch("main", { cwd: "/test/repo" })
    ).resolves.not.toThrow();

    expect(mockRunCli).toHaveBeenCalledWith(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: "/test/repo" }
    );
  });

  it("should pass when current branch is not the base branch (custom git path)", async () => {
    mockRunCli.mockResolvedValue({
      code: 0,
      stdout: "develop\n",
      stderr: "",
    });

    await expect(
      assertNotOnBaseBranch("main", {
        cwd: "/test/repo",
        gitPath: "/usr/local/bin/git"
      })
    ).resolves.not.toThrow();

    expect(mockRunCli).toHaveBeenCalledWith(
      "/usr/local/bin/git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: "/test/repo" }
    );
  });

  it("should throw SafetyViolationError when current branch is the base branch", async () => {
    mockRunCli.mockResolvedValue({
      code: 0,
      stdout: "main\n",
      stderr: "",
    });

    await expect(
      assertNotOnBaseBranch("main", { cwd: "/test/repo" })
    ).rejects.toThrow(SafetyViolationError);

    try {
      await assertNotOnBaseBranch("main", { cwd: "/test/repo" });
    } catch (error: any) {
      expect(error.guard).toBe("BaseBranchGuard");
      expect(error.message).toContain('Currently on base branch "main"');
      expect(error.message).toContain("Direct work on base branch is forbidden");
    }
  });

  it("should throw SafetyViolationError for different base branch names", async () => {
    mockRunCli.mockResolvedValue({
      code: 0,
      stdout: "develop\n",
      stderr: "",
    });

    await expect(
      assertNotOnBaseBranch("develop", { cwd: "/test/repo" })
    ).rejects.toThrow(SafetyViolationError);

    try {
      await assertNotOnBaseBranch("develop", { cwd: "/test/repo" });
    } catch (error: any) {
      expect(error.guard).toBe("BaseBranchGuard");
      expect(error.message).toContain('Currently on base branch "develop"');
    }
  });

  it("should handle branch names with whitespace", async () => {
    mockRunCli.mockResolvedValue({
      code: 0,
      stdout: "  main  \n",
      stderr: "",
    });

    await expect(
      assertNotOnBaseBranch("main", { cwd: "/test/repo" })
    ).rejects.toThrow(SafetyViolationError);
  });

  it("should pass when branches have similar names but are different", async () => {
    mockRunCli.mockResolvedValue({
      code: 0,
      stdout: "main-feature\n",
      stderr: "",
    });

    await expect(
      assertNotOnBaseBranch("main", { cwd: "/test/repo" })
    ).resolves.not.toThrow();
  });

  it("should propagate git command failures", async () => {
    mockRunCli.mockRejectedValue(new Error("Git command failed"));

    await expect(
      assertNotOnBaseBranch("main", { cwd: "/test/repo" })
    ).rejects.toThrow("Git command failed");
  });
});