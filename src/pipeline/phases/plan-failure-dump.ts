import { mkdirSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";
import { getLogger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/error-utils.js";

const logger = getLogger();

/**
 * Plan 생성 실패(JSON 파싱 미스매치) 진단 인프라 (#800-1).
 *
 * 배경: #791/#792/#795/#796 등 4건 연속 동일한 "JSON 파싱 실패" 패턴이 관찰됐다.
 *      재현/패턴 분석을 위해 본 모듈은 매 실패마다 raw 응답 + 메타데이터를 디스크에 적재한다.
 *
 * 산출물:
 *  - `$AQM_HOME/logs/plan-fail-{issueNumber}-{timestamp}.txt` — Claude raw 응답 (replay용)
 *  - `$AQM_HOME/logs/plan-fail-{issueNumber}-{timestamp}.json` — 메타데이터(JSON)
 *  - `$AQM_HOME/logs/plan-failures-index.jsonl` — 모든 실패의 한 줄 요약 (시계열 분석)
 *
 * 비목표: 복구 자체는 #800-2(파서 강건화)/#800-3(프롬프트)/#800-4(차등 retry)에서 처리.
 */

export interface PlanFailureCharStats {
  backticks: number;
  arrowRight: number;
  curlyQuotes: number;
  controlChars: number;
  nonAscii: number;
}

export interface PlanFailureRecord {
  issueNumber: number;
  attempt: number;
  errorCategory: string;
  errorMessage: string;
  responseLength: number;
  rawDumpFile: string;
  charStats: PlanFailureCharStats;
  timestamp: string;
}

/** 실패 응답에 자주 등장하는 문제 문자 카운트. 패턴 분류용. */
export function computeCharStats(text: string): PlanFailureCharStats {
  let backticks = 0;
  let arrowRight = 0;
  let curlyQuotes = 0;
  let controlChars = 0;
  let nonAscii = 0;

  for (const ch of text) {
    const code = ch.codePointAt(0)!;

    if (ch === "`") backticks++;
    else if (ch === "→") arrowRight++;
    else if (ch === "“" || ch === "”" || ch === "‘" || ch === "’") curlyQuotes++;

    if (code < 32 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      controlChars++;
    }
    if (code > 127) {
      nonAscii++;
    }
  }

  return { backticks, arrowRight, curlyQuotes, controlChars, nonAscii };
}

export interface DumpPlanFailureOpts {
  aqmHome: string;
  issueNumber: number;
  attempt: number;
  errorCategory: string;
  errorMessage: string;
  rawResponse: string;
  /** 시계 주입 (테스트용). 미지정 시 현재 시각. */
  now?: Date;
}

/**
 * Plan 실패 응답을 디스크에 저장하고 인덱스 라인을 추가한다.
 * 실패가 발생해도 호출부의 흐름을 깨지 않도록 모든 IO 에러는 swallow + warn.
 *
 * @returns 작성된 PlanFailureRecord, 또는 저장 실패 시 undefined.
 */
export function dumpPlanFailure(opts: DumpPlanFailureOpts): PlanFailureRecord | undefined {
  const { aqmHome, issueNumber, attempt, errorCategory, errorMessage, rawResponse } = opts;
  const now = opts.now ?? new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const logsDir = join(aqmHome, "logs");

  try {
    mkdirSync(logsDir, { recursive: true });

    const rawDumpFile = join(logsDir, `plan-fail-${issueNumber}-${timestamp}.txt`);
    const metaDumpFile = join(logsDir, `plan-fail-${issueNumber}-${timestamp}.json`);
    const indexFile = join(logsDir, "plan-failures-index.jsonl");

    const charStats = computeCharStats(rawResponse);
    const record: PlanFailureRecord = {
      issueNumber,
      attempt,
      errorCategory,
      errorMessage,
      responseLength: rawResponse.length,
      rawDumpFile,
      charStats,
      timestamp: now.toISOString(),
    };

    writeFileSync(rawDumpFile, rawResponse, "utf-8");
    writeFileSync(metaDumpFile, JSON.stringify(record, null, 2), "utf-8");
    appendFileSync(indexFile, JSON.stringify(record) + "\n", "utf-8");

    logger.warn(
      `[plan-fail-dump] issue=#${issueNumber} attempt=${attempt} ` +
      `bytes=${rawResponse.length} backticks=${charStats.backticks} arrows=${charStats.arrowRight} ` +
      `→ ${rawDumpFile}`
    );

    return record;
  } catch (err: unknown) {
    logger.warn(`Failed to dump plan failure: ${getErrorMessage(err)}`);
    return undefined;
  }
}
