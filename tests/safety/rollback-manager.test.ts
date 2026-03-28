import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
}));

import { createCheckpoint, rollbackToCheckpoint } from "../../src/safety/rollback-manager.js";
import { runCli } from "../../src/utils/cli-runner.js";

const mockRunCli = vi.mocked(runCli);

describe("createCheckpoint", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return current HEAD hash", async () => {
    mockRunCli.mockResolvedValue({ stdout: "abc123def456\n", stderr: "", exitCode: 0 });
    const hash = await createCheckpoint({ cwd: "/tmp" });
    expect(hash).toBe("abc123def456");
  });

  it("should throw on failure", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "error", exitCode: 1 });
    await expect(createCheckpoint({ cwd: "/tmp" })).rejects.toThrow("Rollback");
  });
});

describe("rollbackToCheckpoint", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should reset to given hash and clean", async () => {
    mockRunCli.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    await rollbackToCheckpoint("abc123", { cwd: "/tmp" });
    expect(mockRunCli).toHaveBeenCalledWith("git", ["reset", "--hard", "abc123"], { cwd: "/tmp" });
    expect(mockRunCli).toHaveBeenCalledWith("git", ["clean", "-fd"], { cwd: "/tmp" });
  });

  it("should throw RollbackError on failure", async () => {
    mockRunCli.mockResolvedValueOnce({ stdout: "", stderr: "error", exitCode: 1 });
    await expect(rollbackToCheckpoint("abc", { cwd: "/tmp" })).rejects.toThrow("Rollback");
  });
});
