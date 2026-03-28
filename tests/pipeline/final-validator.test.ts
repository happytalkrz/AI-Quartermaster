import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
  runShell: vi.fn(),
}));

vi.mock("../../src/git/commit-helper.js", () => ({
  autoCommitIfDirty: vi.fn().mockResolvedValue(undefined),
}));

import { runFinalValidation } from "../../src/pipeline/final-validator.js";
import { runCli, runShell } from "../../src/utils/cli-runner.js";

const mockRunCli = vi.mocked(runCli);
const mockRunShell = vi.mocked(runShell);

const commands = {
  claudeCli: { path: "claude", model: "test", maxTurns: 1, timeout: 1000, additionalArgs: [] },
  ghCli: { path: "gh", timeout: 30000 },
  test: "npm test",
  lint: "npm run lint",
  build: "npm run build",
  typecheck: "npx tsc --noEmit",
  preInstall: "npm ci",
  shellWhitelist: [],
};

describe("runFinalValidation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should pass when all checks pass", async () => {
    mockRunShell.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });
    const result = await runFinalValidation(commands, { cwd: "/tmp" });
    expect(result.success).toBe(true);
    expect(result.checks).toHaveLength(4); // test, lint, build, typecheck
    expect(result.checks.every(c => c.passed)).toBe(true);
  });

  it("should fail when test fails", async () => {
    mockRunShell
      .mockResolvedValueOnce({ stdout: "FAIL", stderr: "error", exitCode: 1 }) // test
      .mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 }); // rest pass
    const result = await runFinalValidation(commands, { cwd: "/tmp" });
    expect(result.success).toBe(false);
    expect(result.checks[0].name).toBe("test");
    expect(result.checks[0].passed).toBe(false);
  });

  it("should skip empty commands", async () => {
    mockRunShell.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });
    const result = await runFinalValidation(
      { ...commands, typecheck: "", build: "" },
      { cwd: "/tmp" }
    );
    expect(result.checks).toHaveLength(2); // only test and lint
  });
});
