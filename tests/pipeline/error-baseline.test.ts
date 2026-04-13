import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/cli-runner.js", () => ({
  runShell: vi.fn(),
}));
vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import {
  captureErrorBaseline,
  formatBaselineSummary,
} from "../../src/pipeline/reporting/error-baseline.js";
import { runShell } from "../../src/utils/cli-runner.js";
import type { BaselineErrors } from "../../src/pipeline/reporting/verification-parser.js";

const mockRunShell = vi.mocked(runShell);

const COMMANDS = { typecheck: "npx tsc --noEmit", lint: "npx eslint src/" };
const CWD = "/tmp/project";

describe("captureErrorBaseline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed baseline when both commands succeed", async () => {
    const tscOutput =
      "src/foo.ts(10,5): error TS2345: Argument of type 'string' is not assignable.";
    mockRunShell
      .mockResolvedValueOnce({ stdout: tscOutput, stderr: "", exitCode: 1 }) // typecheck
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // lint

    const baseline = await captureErrorBaseline(CWD, COMMANDS);

    expect(baseline.tsc.hasErrors).toBe(true);
    expect(baseline.tsc.totalErrors).toBe(1);
    expect(baseline.tsc.errorsByFile["src/foo.ts"]).toHaveLength(1);
    expect(baseline.eslint.hasErrors).toBe(false);
    expect(baseline.eslint.totalErrors).toBe(0);
  });

  it("returns empty tsc baseline when typecheck command throws", async () => {
    mockRunShell
      .mockRejectedValueOnce(new Error("tsc command failed")) // typecheck
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // lint

    const baseline = await captureErrorBaseline(CWD, COMMANDS);

    expect(baseline.tsc.hasErrors).toBe(false);
    expect(baseline.tsc.totalErrors).toBe(0);
    expect(baseline.eslint.hasErrors).toBe(false);
  });

  it("returns empty eslint baseline when lint command throws", async () => {
    const tscOutput =
      "src/bar.ts(5,1): error TS1005: ';' expected.";
    mockRunShell
      .mockResolvedValueOnce({ stdout: tscOutput, stderr: "", exitCode: 1 }) // typecheck
      .mockRejectedValueOnce(new Error("eslint command failed")); // lint

    const baseline = await captureErrorBaseline(CWD, COMMANDS);

    expect(baseline.tsc.hasErrors).toBe(true);
    expect(baseline.tsc.totalErrors).toBe(1);
    expect(baseline.eslint.hasErrors).toBe(false);
    expect(baseline.eslint.totalErrors).toBe(0);
  });

  it("returns empty baseline when both commands throw", async () => {
    mockRunShell
      .mockRejectedValueOnce(new Error("tsc not found"))
      .mockRejectedValueOnce(new Error("eslint not found"));

    const baseline = await captureErrorBaseline(CWD, COMMANDS);

    expect(baseline.tsc.hasErrors).toBe(false);
    expect(baseline.tsc.totalErrors).toBe(0);
    expect(baseline.eslint.hasErrors).toBe(false);
    expect(baseline.eslint.totalErrors).toBe(0);
  });

  it("returns empty baseline when commands return clean output", async () => {
    mockRunShell
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const baseline = await captureErrorBaseline(CWD, COMMANDS);

    expect(baseline.tsc.hasErrors).toBe(false);
    expect(baseline.eslint.hasErrors).toBe(false);
  });

  it("calls runShell with provided commands and cwd", async () => {
    mockRunShell
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    await captureErrorBaseline(CWD, COMMANDS);

    expect(mockRunShell).toHaveBeenCalledTimes(2);
    expect(mockRunShell).toHaveBeenCalledWith(
      COMMANDS.typecheck,
      expect.objectContaining({ cwd: CWD })
    );
    expect(mockRunShell).toHaveBeenCalledWith(
      COMMANDS.lint,
      expect.objectContaining({ cwd: CWD })
    );
  });
});

describe("formatBaselineSummary", () => {
  it("returns correct summary with error counts", () => {
    const baseline: BaselineErrors = {
      tsc: {
        errorsByFile: {},
        totalErrors: 3,
        hasErrors: true,
      },
      eslint: {
        errorsByFile: {},
        warningsByFile: {},
        totalErrors: 12,
        totalWarnings: 5,
        hasErrors: true,
      },
    };
    expect(formatBaselineSummary(baseline)).toBe(
      "tsc 에러 3개, eslint 에러 12개 존재"
    );
  });

  it("returns correct summary when both counts are zero", () => {
    const baseline: BaselineErrors = {
      tsc: { errorsByFile: {}, totalErrors: 0, hasErrors: false },
      eslint: {
        errorsByFile: {},
        warningsByFile: {},
        totalErrors: 0,
        totalWarnings: 0,
        hasErrors: false,
      },
    };
    expect(formatBaselineSummary(baseline)).toBe(
      "tsc 에러 0개, eslint 에러 0개 존재"
    );
  });
});
