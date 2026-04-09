/**
 * Parses tsc and vitest output to identify per-file success/failure.
 */

export interface TscParseResult {
  /** Per-file error messages */
  errorsByFile: Record<string, string[]>;
  totalErrors: number;
  hasErrors: boolean;
}

export interface VitestParseResult {
  failedFiles: string[];
  passedFiles: string[];
  failedTests: string[];
  totalFiles: number;
  hasFailures: boolean;
}

// Matches: src/foo.ts(10,5): error TS2345: message
const TSC_ERROR_LINE_RE = /^(.+\.tsx?)\(\d+,\d+\):\s+error\s+(TS\d+:.+)$/;

export function parseTscOutput(output: string): TscParseResult {
  const errorsByFile: Record<string, string[]> = {};
  let totalErrors = 0;

  for (const raw of output.split("\n")) {
    const line = raw.trim();
    const match = line.match(TSC_ERROR_LINE_RE);
    if (!match) continue;
    const file = match[1];
    const msg = match[2];
    if (!errorsByFile[file]) errorsByFile[file] = [];
    errorsByFile[file].push(msg);
    totalErrors++;
  }

  return { errorsByFile, totalErrors, hasErrors: totalErrors > 0 };
}

// File-level FAIL/PASS — match before the `>` test separator to distinguish files
// Examples:
//   " × tests/foo.test.ts (3 tests | 1 failed) 200ms"
//   " ✓ tests/foo.test.ts (5 tests) 100ms"
//   " FAIL  tests/foo.test.ts"
//   " PASS  tests/foo.test.ts"
const VITEST_FAIL_FILE_RE = /^\s*(?:FAIL|[×✗])\s+([\w./@-][\w./@/-]*\.test\.[jt]sx?)(?:\s|$)/;
const VITEST_PASS_FILE_RE = /^\s*(?:PASS|[✓✅])\s+([\w./@-][\w./@/-]*\.test\.[jt]sx?)(?:\s|$)/;

// Individual failing test inside a describe block — starts with indented ×/✗ and contains no file extension
// Example: "     × should return error on failure"
const VITEST_FAIL_TEST_RE = /^\s{2,}[×✗]\s+(.+)$/;

export function parseVitestOutput(output: string): VitestParseResult {
  const failedFiles = new Set<string>();
  const passedFiles = new Set<string>();
  const failedTests: string[] = [];

  for (const line of output.split("\n")) {
    const failFile = line.match(VITEST_FAIL_FILE_RE);
    if (failFile) {
      failedFiles.add(failFile[1]);
      continue;
    }

    const passFile = line.match(VITEST_PASS_FILE_RE);
    if (passFile) {
      passedFiles.add(passFile[1]);
      continue;
    }

    const failTest = line.match(VITEST_FAIL_TEST_RE);
    if (failTest) {
      failedTests.push(failTest[1].trim());
    }
  }

  return {
    failedFiles: [...failedFiles],
    passedFiles: [...passedFiles],
    failedTests,
    totalFiles: failedFiles.size + passedFiles.size,
    hasFailures: failedFiles.size > 0,
  };
}
