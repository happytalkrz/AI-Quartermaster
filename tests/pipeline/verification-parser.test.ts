import { describe, it, expect } from "vitest";
import {
  parseTscOutput,
  parseVitestOutput,
  filterErrorsByTargetFiles,
  diffTscErrors,
  diffEslintErrors,
  parseEslintOutput,
} from "../../src/pipeline/reporting/verification-parser.js";

describe("parseTscOutput", () => {
  it("returns empty result for clean output", () => {
    const result = parseTscOutput("");
    expect(result.hasErrors).toBe(false);
    expect(result.totalErrors).toBe(0);
    expect(result.errorsByFile).toEqual({});
  });

  it("parses single file error", () => {
    const output = "src/foo.ts(10,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.";
    const result = parseTscOutput(output);
    expect(result.hasErrors).toBe(true);
    expect(result.totalErrors).toBe(1);
    expect(result.errorsByFile["src/foo.ts"]).toHaveLength(1);
    expect(result.errorsByFile["src/foo.ts"][0]).toContain("TS2345");
  });

  it("groups multiple errors from the same file", () => {
    const output = [
      "src/foo.ts(10,5): error TS2345: First error.",
      "src/foo.ts(20,3): error TS2304: Cannot find name 'bar'.",
    ].join("\n");
    const result = parseTscOutput(output);
    expect(result.totalErrors).toBe(2);
    expect(result.errorsByFile["src/foo.ts"]).toHaveLength(2);
  });

  it("separates errors from different files", () => {
    const output = [
      "src/foo.ts(10,5): error TS2345: Error in foo.",
      "src/bar.ts(5,1): error TS1005: ';' expected.",
    ].join("\n");
    const result = parseTscOutput(output);
    expect(result.totalErrors).toBe(2);
    expect(Object.keys(result.errorsByFile)).toHaveLength(2);
    expect(result.errorsByFile["src/foo.ts"]).toHaveLength(1);
    expect(result.errorsByFile["src/bar.ts"]).toHaveLength(1);
  });

  it("ignores non-error lines", () => {
    const output = [
      "src/foo.ts(10,5): error TS2345: Real error.",
      "Found 1 error.",
      "",
      "src/foo.ts(10,5): warning TS1234: Just a warning.",
    ].join("\n");
    const result = parseTscOutput(output);
    expect(result.totalErrors).toBe(1);
  });

  it("handles nested path separators", () => {
    const output = "src/pipeline/phase-executor.ts(39,3): error TS2345: Type mismatch.";
    const result = parseTscOutput(output);
    expect(result.errorsByFile["src/pipeline/phase-executor.ts"]).toHaveLength(1);
  });
});

describe("parseVitestOutput", () => {
  it("returns empty result for empty output", () => {
    const result = parseVitestOutput("");
    expect(result.hasFailures).toBe(false);
    expect(result.failedFiles).toHaveLength(0);
    expect(result.passedFiles).toHaveLength(0);
    expect(result.failedTests).toHaveLength(0);
    expect(result.totalFiles).toBe(0);
  });

  it("detects FAIL prefix for failed file", () => {
    const output = " FAIL  tests/pipeline/phase-executor.test.ts";
    const result = parseVitestOutput(output);
    expect(result.hasFailures).toBe(true);
    expect(result.failedFiles).toContain("tests/pipeline/phase-executor.test.ts");
  });

  it("detects × prefix for failed file", () => {
    const output = " × tests/pipeline/phase-executor.test.ts (3 tests | 1 failed) 200ms";
    const result = parseVitestOutput(output);
    expect(result.hasFailures).toBe(true);
    expect(result.failedFiles).toContain("tests/pipeline/phase-executor.test.ts");
  });

  it("detects ✗ prefix for failed file", () => {
    const output = " ✗ tests/pipeline/phase-executor.test.ts (3 tests | 1 failed) 200ms";
    const result = parseVitestOutput(output);
    expect(result.hasFailures).toBe(true);
    expect(result.failedFiles).toContain("tests/pipeline/phase-executor.test.ts");
  });

  it("detects PASS prefix for passed file", () => {
    const output = " PASS  tests/pipeline/orchestrator.test.ts";
    const result = parseVitestOutput(output);
    expect(result.hasFailures).toBe(false);
    expect(result.passedFiles).toContain("tests/pipeline/orchestrator.test.ts");
  });

  it("detects ✓ prefix for passed file", () => {
    const output = " ✓ tests/pipeline/orchestrator.test.ts (5 tests) 350ms";
    const result = parseVitestOutput(output);
    expect(result.passedFiles).toContain("tests/pipeline/orchestrator.test.ts");
  });

  it("detects ✅ prefix for passed file", () => {
    const output = " ✅ tests/pipeline/orchestrator.test.ts (5 tests) 350ms";
    const result = parseVitestOutput(output);
    expect(result.passedFiles).toContain("tests/pipeline/orchestrator.test.ts");
  });

  it("separates failed and passed files in mixed output", () => {
    const output = [
      " ✓ tests/pipeline/orchestrator.test.ts (5 tests) 100ms",
      " × tests/pipeline/phase-executor.test.ts (3 tests | 1 failed) 200ms",
      " ✓ tests/pipeline/error-classifier.test.ts (8 tests) 50ms",
    ].join("\n");
    const result = parseVitestOutput(output);
    expect(result.failedFiles).toHaveLength(1);
    expect(result.passedFiles).toHaveLength(2);
    expect(result.totalFiles).toBe(3);
    expect(result.hasFailures).toBe(true);
  });

  it("does not double-count the same file", () => {
    const output = [
      " FAIL  tests/pipeline/phase-executor.test.ts",
      " × tests/pipeline/phase-executor.test.ts (3 tests | 1 failed) 200ms",
    ].join("\n");
    const result = parseVitestOutput(output);
    expect(result.failedFiles).toHaveLength(1);
  });

  it("extracts individual failing test names", () => {
    const output = [
      " × tests/pipeline/phase-executor.test.ts (2 tests | 1 failed) 200ms",
      "     × should return error on failure",
    ].join("\n");
    const result = parseVitestOutput(output);
    expect(result.failedTests).toContain("should return error on failure");
  });

  it("returns hasFailures false when all files pass", () => {
    const output = [
      " ✓ tests/a.test.ts (3 tests) 100ms",
      " ✓ tests/b.test.ts (5 tests) 200ms",
    ].join("\n");
    const result = parseVitestOutput(output);
    expect(result.hasFailures).toBe(false);
    expect(result.totalFiles).toBe(2);
  });
});

describe("filterErrorsByTargetFiles", () => {
  it("returns all errors when targetFiles is empty", () => {
    const errorsByFile = {
      "src/foo.ts": ["TS2345: Type mismatch."],
      "src/bar.ts": ["TS2304: Cannot find name 'x'."],
    };
    const result = filterErrorsByTargetFiles(errorsByFile, []);
    expect(result).toEqual(errorsByFile);
  });

  it("returns only errors for exact-match target file", () => {
    const errorsByFile = {
      "src/foo.ts": ["TS2345: Type mismatch."],
      "src/bar.ts": ["TS2304: Cannot find name 'x'."],
    };
    const result = filterErrorsByTargetFiles(errorsByFile, ["src/foo.ts"]);
    expect(Object.keys(result)).toEqual(["src/foo.ts"]);
    expect(result["src/foo.ts"]).toHaveLength(1);
  });

  it("matches files by prefix (directory target)", () => {
    const errorsByFile = {
      "src/pipeline/phase-executor.ts": ["TS2345: Error A."],
      "src/utils/cli-runner.ts": ["TS2304: Error B."],
    };
    const result = filterErrorsByTargetFiles(errorsByFile, ["src/pipeline"]);
    expect(Object.keys(result)).toEqual(["src/pipeline/phase-executor.ts"]);
  });

  it("returns empty object when no files match targetFiles", () => {
    const errorsByFile = {
      "src/foo.ts": ["TS2345: Type mismatch."],
    };
    const result = filterErrorsByTargetFiles(errorsByFile, ["src/bar.ts"]);
    expect(result).toEqual({});
  });

  it("returns union when multiple targetFiles specified", () => {
    const errorsByFile = {
      "src/foo.ts": ["TS2345: Error A."],
      "src/bar.ts": ["TS2304: Error B."],
      "src/baz.ts": ["TS1005: Error C."],
    };
    const result = filterErrorsByTargetFiles(errorsByFile, ["src/foo.ts", "src/bar.ts"]);
    expect(Object.keys(result).sort()).toEqual(["src/bar.ts", "src/foo.ts"]);
  });
});

describe("diffTscErrors", () => {
  it("returns all current errors when baseline is empty", () => {
    const baseline = { errorsByFile: {}, totalErrors: 0, hasErrors: false };
    const current = {
      errorsByFile: { "src/foo.ts": ["TS2345: Type mismatch."] },
      totalErrors: 1,
      hasErrors: true,
    };
    const result = diffTscErrors(baseline, current);
    expect(result.hasErrors).toBe(true);
    expect(result.totalErrors).toBe(1);
    expect(result.errorsByFile["src/foo.ts"]).toEqual(["TS2345: Type mismatch."]);
  });

  it("returns empty result when all errors match baseline", () => {
    const errors = { "src/foo.ts": ["TS2345: Type mismatch."] };
    const baseline = { errorsByFile: errors, totalErrors: 1, hasErrors: true };
    const current = { errorsByFile: errors, totalErrors: 1, hasErrors: true };
    const result = diffTscErrors(baseline, current);
    expect(result.hasErrors).toBe(false);
    expect(result.totalErrors).toBe(0);
    expect(result.errorsByFile).toEqual({});
  });

  it("returns only new errors not present in baseline", () => {
    const baseline = {
      errorsByFile: { "src/foo.ts": ["TS2345: Old error."] },
      totalErrors: 1,
      hasErrors: true,
    };
    const current = {
      errorsByFile: {
        "src/foo.ts": ["TS2345: Old error.", "TS2304: New error."],
      },
      totalErrors: 2,
      hasErrors: true,
    };
    const result = diffTscErrors(baseline, current);
    expect(result.hasErrors).toBe(true);
    expect(result.totalErrors).toBe(1);
    expect(result.errorsByFile["src/foo.ts"]).toEqual(["TS2304: New error."]);
  });

  it("includes errors from files not in baseline", () => {
    const baseline = {
      errorsByFile: { "src/foo.ts": ["TS2345: Old error."] },
      totalErrors: 1,
      hasErrors: true,
    };
    const current = {
      errorsByFile: {
        "src/foo.ts": ["TS2345: Old error."],
        "src/bar.ts": ["TS2304: Brand new file error."],
      },
      totalErrors: 2,
      hasErrors: true,
    };
    const result = diffTscErrors(baseline, current);
    expect(result.hasErrors).toBe(true);
    expect(result.totalErrors).toBe(1);
    expect(result.errorsByFile["src/bar.ts"]).toEqual(["TS2304: Brand new file error."]);
    expect(result.errorsByFile["src/foo.ts"]).toBeUndefined();
  });

  it("returns empty result when current has no errors", () => {
    const baseline = {
      errorsByFile: { "src/foo.ts": ["TS2345: Old error."] },
      totalErrors: 1,
      hasErrors: true,
    };
    const current = { errorsByFile: {}, totalErrors: 0, hasErrors: false };
    const result = diffTscErrors(baseline, current);
    expect(result.hasErrors).toBe(false);
    expect(result.totalErrors).toBe(0);
  });
});

describe("diffEslintErrors", () => {
  it("returns all current errors and warnings when baseline is empty", () => {
    const emptyBaseline = {
      errorsByFile: {},
      warningsByFile: {},
      totalErrors: 0,
      totalWarnings: 0,
      hasErrors: false,
    };
    const current = {
      errorsByFile: { "src/foo.ts": ["no-unused-vars"] },
      warningsByFile: { "src/foo.ts": ["no-console"] },
      totalErrors: 1,
      totalWarnings: 1,
      hasErrors: true,
    };
    const result = diffEslintErrors(emptyBaseline, current);
    expect(result.hasErrors).toBe(true);
    expect(result.totalErrors).toBe(1);
    expect(result.totalWarnings).toBe(1);
    expect(result.errorsByFile["src/foo.ts"]).toEqual(["no-unused-vars"]);
    expect(result.warningsByFile["src/foo.ts"]).toEqual(["no-console"]);
  });

  it("filters out pre-existing errors and warnings", () => {
    const baseline = {
      errorsByFile: { "src/foo.ts": ["no-unused-vars"] },
      warningsByFile: { "src/foo.ts": ["no-console"] },
      totalErrors: 1,
      totalWarnings: 1,
      hasErrors: true,
    };
    const current = {
      errorsByFile: { "src/foo.ts": ["no-unused-vars"] },
      warningsByFile: { "src/foo.ts": ["no-console"] },
      totalErrors: 1,
      totalWarnings: 1,
      hasErrors: true,
    };
    const result = diffEslintErrors(baseline, current);
    expect(result.hasErrors).toBe(false);
    expect(result.totalErrors).toBe(0);
    expect(result.totalWarnings).toBe(0);
    expect(result.errorsByFile).toEqual({});
    expect(result.warningsByFile).toEqual({});
  });

  it("returns only new errors not in baseline, keeps pre-existing warnings filtered", () => {
    const baseline = {
      errorsByFile: { "src/foo.ts": ["no-unused-vars"] },
      warningsByFile: {},
      totalErrors: 1,
      totalWarnings: 0,
      hasErrors: true,
    };
    const current = {
      errorsByFile: {
        "src/foo.ts": ["no-unused-vars", "eqeqeq"],
      },
      warningsByFile: { "src/foo.ts": ["no-console"] },
      totalErrors: 2,
      totalWarnings: 1,
      hasErrors: true,
    };
    const result = diffEslintErrors(baseline, current);
    expect(result.hasErrors).toBe(true);
    expect(result.totalErrors).toBe(1);
    expect(result.totalWarnings).toBe(1);
    expect(result.errorsByFile["src/foo.ts"]).toEqual(["eqeqeq"]);
    expect(result.warningsByFile["src/foo.ts"]).toEqual(["no-console"]);
  });
});
