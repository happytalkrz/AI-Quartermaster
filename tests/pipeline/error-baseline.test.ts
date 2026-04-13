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

describe("captureErrorBaseline — build and test commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const COMMANDS_FULL = {
    typecheck: "npx tsc --noEmit",
    lint: "npx eslint src/",
    build: "npm run build",
    test: "npx vitest run",
  };

  it("captures build result when build command succeeds", async () => {
    mockRunShell
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // typecheck
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // lint
      .mockResolvedValueOnce({ stdout: "Build successful", stderr: "", exitCode: 0 }) // build
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // test

    const baseline = await captureErrorBaseline(CWD, COMMANDS_FULL);

    expect(baseline.build).toBeDefined();
    expect(baseline.build!.hasErrors).toBe(false);
    expect(baseline.build!.output).toBe("Build successful");
  });

  it("sets build captureWarning when build command throws", async () => {
    mockRunShell
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // typecheck
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // lint
      .mockRejectedValueOnce(new Error("build tool missing")) // build
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // test

    const baseline = await captureErrorBaseline(CWD, COMMANDS_FULL);

    expect(baseline.build).toBeUndefined();
    expect(baseline.captureWarnings).toBeDefined();
    expect(baseline.captureWarnings).toHaveLength(1);
    expect(baseline.captureWarnings![0]).toContain("baseline: build 실행 실패");
    expect(baseline.captureWarnings![0]).toContain("build tool missing");
  });

  it("captures test result when test command succeeds", async () => {
    const vitestOutput = " PASS  tests/foo.test.ts\n PASS  tests/bar.test.ts";
    mockRunShell
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // typecheck
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // lint
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // build
      .mockResolvedValueOnce({ stdout: vitestOutput, stderr: "", exitCode: 0 }); // test

    const baseline = await captureErrorBaseline(CWD, COMMANDS_FULL);

    expect(baseline.test).toBeDefined();
    expect(baseline.test!.hasFailures).toBe(false);
    expect(baseline.test!.passedFiles).toHaveLength(2);
  });

  it("sets test captureWarning when test command throws", async () => {
    mockRunShell
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // typecheck
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // lint
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // build
      .mockRejectedValueOnce(new Error("test runner crashed")); // test

    const baseline = await captureErrorBaseline(CWD, COMMANDS_FULL);

    expect(baseline.test).toBeUndefined();
    expect(baseline.captureWarnings).toBeDefined();
    expect(baseline.captureWarnings).toHaveLength(1);
    expect(baseline.captureWarnings![0]).toContain("baseline: test 실행 실패");
    expect(baseline.captureWarnings![0]).toContain("test runner crashed");
  });

  it("accumulates captureWarnings when multiple commands fail", async () => {
    mockRunShell
      .mockRejectedValueOnce(new Error("tsc not found")) // typecheck
      .mockRejectedValueOnce(new Error("eslint not found")) // lint
      .mockRejectedValueOnce(new Error("build tool missing")) // build
      .mockRejectedValueOnce(new Error("vitest not found")); // test

    const baseline = await captureErrorBaseline(CWD, COMMANDS_FULL);

    expect(baseline.captureWarnings).toBeDefined();
    expect(baseline.captureWarnings!.length).toBe(4);
    expect(baseline.captureWarnings![0]).toContain("baseline: tsc 실행 실패");
    expect(baseline.captureWarnings![1]).toContain("baseline: eslint 실행 실패");
    expect(baseline.captureWarnings![2]).toContain("baseline: build 실행 실패");
    expect(baseline.captureWarnings![3]).toContain("baseline: test 실행 실패");
  });

  it("does not set captureWarnings when all commands succeed", async () => {
    mockRunShell
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // typecheck
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // lint
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // build
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // test

    const baseline = await captureErrorBaseline(CWD, COMMANDS_FULL);

    expect(baseline.captureWarnings).toBeUndefined();
  });

  it("skips build and test runShell calls when not provided in commands", async () => {
    mockRunShell
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // typecheck
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // lint

    const baseline = await captureErrorBaseline(CWD, COMMANDS);

    expect(mockRunShell).toHaveBeenCalledTimes(2);
    expect(baseline.build).toBeUndefined();
    expect(baseline.test).toBeUndefined();
  });

  it("captures failed test files from vitest output", async () => {
    const vitestOutput = [
      " × tests/unit/foo.test.ts (2 tests | 1 failed) 300ms",
      " ✓ tests/unit/bar.test.ts (3 tests) 100ms",
    ].join("\n");
    mockRunShell
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // typecheck
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // lint
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // build
      .mockResolvedValueOnce({ stdout: vitestOutput, stderr: "", exitCode: 1 }); // test

    const baseline = await captureErrorBaseline(CWD, COMMANDS_FULL);

    expect(baseline.test).toBeDefined();
    expect(baseline.test!.hasFailures).toBe(true);
    expect(baseline.test!.failedFiles).toHaveLength(1);
    expect(baseline.test!.passedFiles).toHaveLength(1);
  });
});

describe("captureErrorBaseline — captureWarnings on tsc/eslint failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets captureWarnings when typecheck command throws", async () => {
    mockRunShell
      .mockRejectedValueOnce(new Error("tsc command failed")) // typecheck
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // lint

    const baseline = await captureErrorBaseline(CWD, COMMANDS);

    expect(baseline.captureWarnings).toBeDefined();
    expect(baseline.captureWarnings).toHaveLength(1);
    expect(baseline.captureWarnings![0]).toContain("baseline: tsc 실행 실패");
  });

  it("sets captureWarnings when lint command throws", async () => {
    mockRunShell
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // typecheck
      .mockRejectedValueOnce(new Error("eslint command failed")); // lint

    const baseline = await captureErrorBaseline(CWD, COMMANDS);

    expect(baseline.captureWarnings).toBeDefined();
    expect(baseline.captureWarnings).toHaveLength(1);
    expect(baseline.captureWarnings![0]).toContain("baseline: eslint 실행 실패");
  });

  it("does not set captureWarnings when both tsc and eslint succeed", async () => {
    mockRunShell
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }) // typecheck
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // lint

    const baseline = await captureErrorBaseline(CWD, COMMANDS);

    expect(baseline.captureWarnings).toBeUndefined();
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

  it("includes build success in summary when build is present", () => {
    const baseline: BaselineErrors = {
      tsc: { errorsByFile: {}, totalErrors: 0, hasErrors: false },
      eslint: { errorsByFile: {}, warningsByFile: {}, totalErrors: 0, totalWarnings: 0, hasErrors: false },
      build: { exitCode: 0, hasErrors: false, output: "Build successful" },
    };
    expect(formatBaselineSummary(baseline)).toBe(
      "tsc 에러 0개, eslint 에러 0개, build 성공 존재"
    );
  });

  it("includes build failure in summary when build has errors", () => {
    const baseline: BaselineErrors = {
      tsc: { errorsByFile: {}, totalErrors: 0, hasErrors: false },
      eslint: { errorsByFile: {}, warningsByFile: {}, totalErrors: 0, totalWarnings: 0, hasErrors: false },
      build: { exitCode: 1, hasErrors: true, output: "Build failed" },
    };
    expect(formatBaselineSummary(baseline)).toBe(
      "tsc 에러 0개, eslint 에러 0개, build 실패 존재"
    );
  });

  it("includes test failed files count in summary when test is present", () => {
    const baseline: BaselineErrors = {
      tsc: { errorsByFile: {}, totalErrors: 0, hasErrors: false },
      eslint: { errorsByFile: {}, warningsByFile: {}, totalErrors: 0, totalWarnings: 0, hasErrors: false },
      test: {
        failedFiles: ["tests/a.test.ts", "tests/b.test.ts"],
        passedFiles: [],
        failedTests: [],
        totalFiles: 2,
        hasFailures: true,
      },
    };
    expect(formatBaselineSummary(baseline)).toBe(
      "tsc 에러 0개, eslint 에러 0개, test 실패 파일 2개 존재"
    );
  });

  it("includes captureWarnings count in summary when warnings are present", () => {
    const baseline: BaselineErrors = {
      tsc: { errorsByFile: {}, totalErrors: 0, hasErrors: false },
      eslint: { errorsByFile: {}, warningsByFile: {}, totalErrors: 0, totalWarnings: 0, hasErrors: false },
      captureWarnings: ["baseline: tsc 실행 실패 — err1", "baseline: build 실행 실패 — err2"],
    };
    expect(formatBaselineSummary(baseline)).toBe(
      "tsc 에러 0개, eslint 에러 0개, 캡처 경고 2개 존재"
    );
  });

  it("includes all fields in summary when all are present", () => {
    const baseline: BaselineErrors = {
      tsc: { errorsByFile: {}, totalErrors: 1, hasErrors: true },
      eslint: { errorsByFile: {}, warningsByFile: {}, totalErrors: 2, totalWarnings: 0, hasErrors: true },
      build: { exitCode: 1, hasErrors: true, output: "failed" },
      test: {
        failedFiles: ["tests/x.test.ts"],
        passedFiles: [],
        failedTests: [],
        totalFiles: 1,
        hasFailures: true,
      },
      captureWarnings: ["baseline: 경고 1개"],
    };
    expect(formatBaselineSummary(baseline)).toBe(
      "tsc 에러 1개, eslint 에러 2개, build 실패, test 실패 파일 1개, 캡처 경고 1개 존재"
    );
  });

  it("omits captureWarnings from summary when array is empty", () => {
    const baseline: BaselineErrors = {
      tsc: { errorsByFile: {}, totalErrors: 0, hasErrors: false },
      eslint: { errorsByFile: {}, warningsByFile: {}, totalErrors: 0, totalWarnings: 0, hasErrors: false },
      captureWarnings: [],
    };
    expect(formatBaselineSummary(baseline)).toBe(
      "tsc 에러 0개, eslint 에러 0개 존재"
    );
  });
});
