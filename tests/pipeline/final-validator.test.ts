import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
  runShell: vi.fn(),
}));

vi.mock("../../src/git/commit-helper.js", () => ({
  autoCommitIfDirty: vi.fn().mockResolvedValue(undefined),
}));

import { runFinalValidation } from "../../src/pipeline/final-validator.js";
import { runShell } from "../../src/utils/cli-runner.js";
import { autoCommitIfDirty } from "../../src/git/commit-helper.js";

const mockRunShell = vi.mocked(runShell);
const mockAutoCommitIfDirty = vi.mocked(autoCommitIfDirty);

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
    const result = await runFinalValidation(commands, { cwd: "/tmp" }, "thorough");
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
      { cwd: "/tmp" },
      "thorough"
    );
    expect(result.checks).toHaveLength(2); // only test and lint
  });

  it("should retry lint with autofix when lint fails initially", async () => {
    mockRunShell
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", exitCode: 0 }) // test
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", exitCode: 0 }) // typecheck
      .mockResolvedValueOnce({ stdout: "lint error", stderr: "style issue", exitCode: 1 }) // lint fail
      .mockResolvedValueOnce({ stdout: "fixed", stderr: "", exitCode: 0 }) // autofix
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", exitCode: 0 }) // lint recheck pass
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", exitCode: 0 }); // build
    mockAutoCommitIfDirty.mockResolvedValue("abc123");

    const result = await runFinalValidation(commands, { cwd: "/tmp" }, "thorough");

    expect(result.success).toBe(true);
    expect(mockRunShell).toHaveBeenCalledWith("npm run lint --fix", expect.any(Object));
    expect(mockAutoCommitIfDirty).toHaveBeenCalledWith("git", "/tmp", "style: lint autofix");
    expect(result.checks.find(c => c.name === "lint")?.passed).toBe(true);
  });

  it("should fail when lint autofix doesn't resolve the issue", async () => {
    mockRunShell
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", exitCode: 0 }) // test
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", exitCode: 0 }) // typecheck
      .mockResolvedValueOnce({ stdout: "lint error", stderr: "unfixable issue", exitCode: 1 }) // lint fail
      .mockResolvedValueOnce({ stdout: "attempted fix", stderr: "", exitCode: 0 }) // autofix
      .mockResolvedValueOnce({ stdout: "still failing", stderr: "persistent issue", exitCode: 1 }) // lint recheck fail
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", exitCode: 0 }); // build
    mockAutoCommitIfDirty.mockResolvedValue(undefined);

    const result = await runFinalValidation(commands, { cwd: "/tmp" }, "thorough");

    expect(result.success).toBe(false);
    expect(result.checks.find(c => c.name === "lint")?.passed).toBe(false);
    expect(result.checks.find(c => c.name === "lint")?.output).toContain("still failing");
  });

  it("should handle partial failures correctly", async () => {
    mockRunShell
      .mockResolvedValueOnce({ stdout: "FAIL", stderr: "test error", exitCode: 1 }) // test fail
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", exitCode: 0 }) // typecheck pass
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", exitCode: 0 }) // lint pass
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", exitCode: 0 }); // build pass

    const result = await runFinalValidation(commands, { cwd: "/tmp" }, "thorough");

    expect(result.success).toBe(false);
    expect(result.checks).toHaveLength(4);
    expect(result.checks[0].passed).toBe(false); // test failed
    expect(result.checks[1].passed).toBe(true); // typecheck passed
    expect(result.checks[2].passed).toBe(true); // lint passed
    expect(result.checks[3].passed).toBe(true); // build passed
  });

  it("should handle multiple failures", async () => {
    mockRunShell
      .mockResolvedValueOnce({ stdout: "FAIL", stderr: "test error", exitCode: 1 }) // test fail
      .mockResolvedValueOnce({ stdout: "Type error", stderr: "TS2345", exitCode: 1 }) // typecheck fail
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", exitCode: 0 }) // lint pass
      .mockResolvedValueOnce({ stdout: "Build failed", stderr: "compilation error", exitCode: 1 }); // build fail

    const result = await runFinalValidation(commands, { cwd: "/tmp" }, "thorough");

    expect(result.success).toBe(false);
    expect(result.checks.filter(c => !c.passed)).toHaveLength(3);
    expect(result.checks[0].output).toContain("FAIL");
    expect(result.checks[1].output).toContain("Type error");
    expect(result.checks[3].output).toContain("Build failed");
  });

  it("should run test and typecheck in parallel", async () => {
    const startTime = Date.now();
    let testCallTime = 0;
    let typecheckCallTime = 0;

    mockRunShell
      .mockImplementationOnce(() => {
        testCallTime = Date.now() - startTime;
        return Promise.resolve({ stdout: "ok", stderr: "", exitCode: 0 });
      })
      .mockImplementationOnce(() => {
        typecheckCallTime = Date.now() - startTime;
        return Promise.resolve({ stdout: "ok", stderr: "", exitCode: 0 });
      })
      .mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

    await runFinalValidation(commands, { cwd: "/tmp" });

    // Both should be called almost simultaneously (within 50ms)
    expect(Math.abs(testCallTime - typecheckCallTime)).toBeLessThan(50);
    expect(mockRunShell).toHaveBeenNthCalledWith(1, "npm test", expect.any(Object));
    expect(mockRunShell).toHaveBeenNthCalledWith(2, "npx tsc --noEmit", expect.any(Object));
  });

  it("should capture error output correctly", async () => {
    const testStdout = "Test output line 1";
    const testStderr = "Error: test failed";
    mockRunShell
      .mockResolvedValueOnce({ stdout: testStdout, stderr: testStderr, exitCode: 1 })
      .mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

    const result = await runFinalValidation(commands, { cwd: "/tmp" }, "thorough");

    expect(result.checks[0].output).toBe(`${testStdout}\n${testStderr}`);
    expect(result.checks[0].passed).toBe(false);
  });

  it("should use custom git path when provided", async () => {
    mockRunShell
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", exitCode: 0 }) // test
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", exitCode: 0 }) // typecheck
      .mockResolvedValueOnce({ stdout: "lint error", stderr: "", exitCode: 1 }) // lint fail
      .mockResolvedValueOnce({ stdout: "fixed", stderr: "", exitCode: 0 }) // autofix
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", exitCode: 0 }) // lint recheck
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", exitCode: 0 }); // build
    mockAutoCommitIfDirty.mockResolvedValue("def456");

    await runFinalValidation(commands, { cwd: "/tmp" }, "thorough", "/custom/git");

    expect(mockAutoCommitIfDirty).toHaveBeenCalledWith("/custom/git", "/tmp", "style: lint autofix");
  });

  it("should handle build failures", async () => {
    mockRunShell
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", exitCode: 0 }) // test
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", exitCode: 0 }) // typecheck
      .mockResolvedValueOnce({ stdout: "ok", stderr: "", exitCode: 0 }) // lint
      .mockResolvedValueOnce({ stdout: "Build output", stderr: "Build failed", exitCode: 1 }); // build fail

    const result = await runFinalValidation(commands, { cwd: "/tmp" }, "thorough");

    expect(result.success).toBe(false);
    expect(result.checks.find(c => c.name === "build")?.passed).toBe(false);
    expect(result.checks.find(c => c.name === "build")?.output).toContain("Build output");
  });

  it("should not call autoCommitIfDirty when lint passes initially", async () => {
    mockRunShell.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

    await runFinalValidation(commands, { cwd: "/tmp" });

    expect(mockAutoCommitIfDirty).not.toHaveBeenCalled();
  });
});
