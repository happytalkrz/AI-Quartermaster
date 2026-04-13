import { runShell } from "../../utils/cli-runner.js";
import { getLogger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/error-utils.js";
import {
  parseTscOutput,
  parseEslintOutput,
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
 * tsc와 eslint를 실행하여 현재 에러 상태를 BaselineErrors로 반환.
 * 캡처 실패 시 빈 baseline을 반환하여 파이프라인을 중단시키지 않는다.
 */
export async function captureErrorBaseline(
  cwd: string,
  commands: { typecheck: string; lint: string }
): Promise<BaselineErrors> {
  const [tscResult, eslintResult] = await Promise.all([
    runShell(commands.typecheck, { cwd, timeout: BASELINE_TIMEOUT_MS }).catch((err: unknown) => {
      logger.warn(`baseline: tsc 실행 실패 — ${getErrorMessage(err)}`);
      return null;
    }),
    runShell(commands.lint, { cwd, timeout: BASELINE_TIMEOUT_MS }).catch((err: unknown) => {
      logger.warn(`baseline: eslint 실행 실패 — ${getErrorMessage(err)}`);
      return null;
    }),
  ]);

  const baseline = emptyBaseline();

  if (tscResult !== null) {
    try {
      baseline.tsc = parseTscOutput(tscResult.stdout + tscResult.stderr);
    } catch (err: unknown) {
      logger.warn(`baseline: tsc 출력 파싱 실패 — ${getErrorMessage(err)}`);
    }
  }

  if (eslintResult !== null) {
    try {
      baseline.eslint = parseEslintOutput(eslintResult.stdout + eslintResult.stderr);
    } catch (err: unknown) {
      logger.warn(`baseline: eslint 출력 파싱 실패 — ${getErrorMessage(err)}`);
    }
  }

  return baseline;
}

/**
 * 프롬프트 삽입용 한 줄 요약을 반환.
 * 예: 'tsc 에러 3개, eslint 에러 12개 존재'
 */
export function formatBaselineSummary(baseline: BaselineErrors): string {
  return `tsc 에러 ${baseline.tsc.totalErrors}개, eslint 에러 ${baseline.eslint.totalErrors}개 존재`;
}
