/**
 * Parses tsc, vitest, and eslint output to identify per-file success/failure.
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

export interface BuildBaselineResult {
  exitCode: number;
  hasErrors: boolean;
  output: string;
}

/**
 * Baseline snapshot of tsc + eslint + build + test errors for diffing against new runs.
 * captureWarnings records any failures that occurred while capturing the baseline.
 */
export interface BaselineErrors {
  tsc: TscParseResult;
  eslint: EslintParseResult;
  build?: BuildBaselineResult;
  test?: VitestParseResult;
  captureWarnings?: string[];
}

/**
 * Filters errorsByFile to only include files matching targetFiles.
 * Matching logic mirrors scope-guard.ts checkFileScope(): exact match OR startsWith.
 */
export function filterErrorsByTargetFiles(
  errorsByFile: Record<string, string[]>,
  targetFiles: string[]
): Record<string, string[]> {
  if (targetFiles.length === 0) return errorsByFile;

  const filtered: Record<string, string[]> = {};
  for (const [file, errors] of Object.entries(errorsByFile)) {
    if (targetFiles.some((target) => file === target || file.startsWith(target))) {
      filtered[file] = errors;
    }
  }
  return filtered;
}

/**
 * Returns a TscParseResult containing only errors that are NOT in the baseline.
 * An error is considered pre-existing if the same message already exists for that file.
 */
export function diffTscErrors(
  baseline: TscParseResult,
  current: TscParseResult
): TscParseResult {
  const errorsByFile: Record<string, string[]> = {};
  let totalErrors = 0;

  for (const [file, errors] of Object.entries(current.errorsByFile)) {
    const baselineErrors = new Set(baseline.errorsByFile[file] ?? []);
    const newErrors = errors.filter((e) => !baselineErrors.has(e));
    if (newErrors.length > 0) {
      errorsByFile[file] = newErrors;
      totalErrors += newErrors.length;
    }
  }

  return { errorsByFile, totalErrors, hasErrors: totalErrors > 0 };
}

/**
 * Returns an EslintParseResult containing only errors/warnings that are NOT in the baseline.
 */
export function diffEslintErrors(
  baseline: EslintParseResult,
  current: EslintParseResult
): EslintParseResult {
  const errorsByFile: Record<string, string[]> = {};
  const warningsByFile: Record<string, string[]> = {};
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const [file, errors] of Object.entries(current.errorsByFile)) {
    const baselineErrors = new Set(baseline.errorsByFile[file] ?? []);
    const newErrors = errors.filter((e) => !baselineErrors.has(e));
    if (newErrors.length > 0) {
      errorsByFile[file] = newErrors;
      totalErrors += newErrors.length;
    }
  }

  for (const [file, warnings] of Object.entries(current.warningsByFile)) {
    const baselineWarnings = new Set(baseline.warningsByFile[file] ?? []);
    const newWarnings = warnings.filter((w) => !baselineWarnings.has(w));
    if (newWarnings.length > 0) {
      warningsByFile[file] = newWarnings;
      totalWarnings += newWarnings.length;
    }
  }

  return { errorsByFile, warningsByFile, totalErrors, totalWarnings, hasErrors: totalErrors > 0 };
}

export interface EslintParseResult {
  /** Per-file error messages */
  errorsByFile: Record<string, string[]>;
  /** Per-file warning messages */
  warningsByFile: Record<string, string[]>;
  totalErrors: number;
  totalWarnings: number;
  hasErrors: boolean;
}

// ESLint default formatter: file path line (absolute or relative, no leading spaces)
// Examples:
//   /home/user/project/src/foo.ts
//   src/foo.ts
const ESLINT_FILE_RE = /^((?:\/|\.{0,2}\/|[A-Za-z]:\\)?\S+\.[jt]sx?)$/;

// ESLint problem line: "  10:5  error  message  rule-name"
// Severity is "error" or "warning"
const ESLINT_PROBLEM_RE =
  /^\s+\d+:\d+\s+(error|warning)\s+(.+?)\s{2,}\S+\s*$/;

export function parseEslintOutput(output: string): EslintParseResult {
  const errorsByFile: Record<string, string[]> = {};
  const warningsByFile: Record<string, string[]> = {};
  let totalErrors = 0;
  let totalWarnings = 0;
  let currentFile: string | null = null;

  for (const raw of output.split("\n")) {
    const line = raw.trimEnd();

    const fileMatch = line.match(ESLINT_FILE_RE);
    if (fileMatch) {
      currentFile = fileMatch[1];
      continue;
    }

    if (!currentFile) continue;

    const problemMatch = line.match(ESLINT_PROBLEM_RE);
    if (!problemMatch) continue;

    const severity = problemMatch[1];
    const message = problemMatch[2].trim();

    if (severity === "error") {
      if (!errorsByFile[currentFile]) errorsByFile[currentFile] = [];
      errorsByFile[currentFile].push(message);
      totalErrors++;
    } else {
      if (!warningsByFile[currentFile]) warningsByFile[currentFile] = [];
      warningsByFile[currentFile].push(message);
      totalWarnings++;
    }
  }

  return { errorsByFile, warningsByFile, totalErrors, totalWarnings, hasErrors: totalErrors > 0 };
}
