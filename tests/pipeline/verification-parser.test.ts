import { describe, it, expect } from "vitest";
import { parseTscOutput, parseVitestOutput } from "../../src/pipeline/verification-parser.js";

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
