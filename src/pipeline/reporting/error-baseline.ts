import { runShell } from "../../utils/cli-runner.js";
import { getLogger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/error-utils.js";
import {
  parseTscOutput,
  parseEslintOutput,
  parseVitestOutput,
  type BaselineErrors,
} from "./verification-parser.js";

const logger = getLogger();

const BASELINE_TIMEOUT_MS = 60_000;

function emptyBaseline(): BaselineErrors {
  return {
    tsc: { errorsByFile: {}, totalErrors: 0, hasErrors: false },
    eslint: { errorsByFile: {}, warningsByFile: {}, totalErrors: 0, totalWarnings: 0, hasErrors: false },
  };
}

/**
 * tsc, eslint, build, test를 실행하여 현재 에러 상태를 BaselineErrors로 반환.
 * 캡처 실패 시 빈 baseline을 반환하지 않고, captureWarnings에 실패 정보를 기록한다.
 */
export async function captureErrorBaseline(
  cwd: string,
  commands: { typecheck: string; lint: string; build?: string; test?: string }
): Promise<BaselineErrors> {
  const captureWarnings: string[] = [];

  const [tscResult, eslintResult, buildResult, testResult] = await Promise.all([
    runShell(commands.typecheck, { cwd, timeout: BASELINE_TIMEOUT_MS }).catch((err: unknown) => {
      const msg = `baseline: tsc 실행 실패 — ${getErrorMessage(err)}`;
      logger.warn(msg);
      captureWarnings.push(msg);
      return null;
    }),
    runShell(commands.lint, { cwd, timeout: BASELINE_TIMEOUT_MS }).catch((err: unknown) => {
      const msg = `baseline: eslint 실행 실패 — ${getErrorMessage(err)}`;
      logger.warn(msg);
      captureWarnings.push(msg);
      return null;
    }),
    commands.build
      ? runShell(commands.build, { cwd, timeout: BASELINE_TIMEOUT_MS }).catch((err: unknown) => {
          const msg = `baseline: build 실행 실패 — ${getErrorMessage(err)}`;
          logger.warn(msg);
          captureWarnings.push(msg);
          return null;
        })
      : Promise.resolve(null),
    commands.test
      ? runShell(commands.test, { cwd, timeout: BASELINE_TIMEOUT_MS }).catch((err: unknown) => {
          const msg = `baseline: test 실행 실패 — ${getErrorMessage(err)}`;
          logger.warn(msg);
          captureWarnings.push(msg);
          return null;
        })
      : Promise.resolve(null),
  ]);

  const baseline = emptyBaseline();

  if (tscResult !== null) {
    try {
      baseline.tsc = parseTscOutput(tscResult.stdout + tscResult.stderr);
    } catch (err: unknown) {
      const msg = `baseline: tsc 출력 파싱 실패 — ${getErrorMessage(err)}`;
      logger.warn(msg);
      captureWarnings.push(msg);
    }
  }

  if (eslintResult !== null) {
    try {
      baseline.eslint = parseEslintOutput(eslintResult.stdout + eslintResult.stderr);
    } catch (err: unknown) {
      const msg = `baseline: eslint 출력 파싱 실패 — ${getErrorMessage(err)}`;
      logger.warn(msg);
      captureWarnings.push(msg);
    }
  }

  if (buildResult !== null) {
    baseline.build = {
      exitCode: 0,
      hasErrors: false,
      output: buildResult.stdout + buildResult.stderr,
    };
  }

  if (testResult !== null) {
    try {
      baseline.test = parseVitestOutput(testResult.stdout + testResult.stderr);
    } catch (err: unknown) {
      const msg = `baseline: test 출력 파싱 실패 — ${getErrorMessage(err)}`;
      logger.warn(msg);
      captureWarnings.push(msg);
    }
  }

  if (captureWarnings.length > 0) {
    baseline.captureWarnings = captureWarnings;
  }

  return baseline;
}

/**
 * 프롬프트 삽입용 한 줄 요약을 반환.
 * 예: 'tsc 에러 3개, eslint 에러 12개 존재'
 */
export function formatBaselineSummary(baseline: BaselineErrors): string {
  const parts: string[] = [
    `tsc 에러 ${baseline.tsc.totalErrors}개`,
    `eslint 에러 ${baseline.eslint.totalErrors}개`,
  ];
  if (baseline.build !== undefined) {
    parts.push(`build ${baseline.build.hasErrors ? "실패" : "성공"}`);
  }
  if (baseline.test !== undefined) {
    parts.push(`test 실패 파일 ${baseline.test.failedFiles.length}개`);
  }
  if (baseline.captureWarnings && baseline.captureWarnings.length > 0) {
    parts.push(`캡처 경고 ${baseline.captureWarnings.length}개`);
  }
  return parts.join(", ") + " 존재";
}
