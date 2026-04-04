import { runGhCommand } from "../utils/cli-runner.js";
import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";
import type { GhCliConfig, RetryConfig } from "../types/config.js";

const logger = getLogger();

/**
 * CI 체크 상태
 */
export type CiStatus = "pending" | "success" | "failure" | "error" | "neutral" | "cancelled" | "skipped";

/**
 * CI 체크 결과
 */
export interface CiCheck {
  /** 체크 이름 (예: "ci", "tests", "build") */
  name: string;
  /** 체크 상태 */
  status: CiStatus;
  /** 체크 결론 (완료된 경우) */
  conclusion: CiStatus | null;
  /** 체크 URL (상세 로그 링크) */
  detailsUrl: string;
  /** 체크 시작 시간 */
  startedAt: string;
  /** 체크 완료 시간 */
  completedAt: string | null;
}

/**
 * CI 전체 상태 요약
 */
export interface CiStatusSummary {
  /** 전체 상태 */
  overall: "pending" | "success" | "failure";
  /** 개별 체크들 */
  checks: CiCheck[];
  /** 실패한 체크들 */
  failedChecks: CiCheck[];
  /** 진행 중인 체크들 */
  pendingChecks: CiCheck[];
  /** 마지막 확인 시간 */
  lastCheckedAt: string;
}

/**
 * CI 로그 파싱 결과
 */
export interface CiLogResult {
  /** 워크플로우 런 ID */
  runId: string;
  /** 워크플로우 이름 */
  workflowName: string;
  /** 실패한 잡들의 로그 */
  failedJobLogs: Array<{
    jobName: string;
    logContent: string;
    error?: string;
  }>;
  /** 파싱 에러 */
  parseError?: string;
}

/**
 * CI 폴링 설정
 */
export interface CiPollingConfig {
  /** 폴링 간격 (ms) */
  intervalMs: number;
  /** 최대 폴링 시간 (ms) */
  maxDurationMs: number;
  /** 타임아웃 시 실패로 처리할지 여부 */
  failOnTimeout: boolean;
}

/**
 * PR의 CI 상태를 확인합니다.
 */
export async function checkPrCiStatus(
  prNumber: number,
  repo: string,
  ghConfig: GhCliConfig
): Promise<CiStatusSummary> {
  logger.debug(`Checking CI status for PR #${prNumber} in ${repo}`);

  try {
    // gh pr checks 명령어로 CI 상태 가져오기
    const result = await runGhCommand(
      ghConfig.path,
      ["pr", "checks", String(prNumber), "--repo", repo, "--json"],
      {},
      ghConfig.retry
    );

    if (result.exitCode !== 0) {
      logger.warn(`Failed to get PR checks: ${result.stderr}`);
      return {
        overall: "failure",
        checks: [],
        failedChecks: [],
        pendingChecks: [],
        lastCheckedAt: new Date().toISOString(),
      };
    }

    // JSON 파싱
    const checksData = JSON.parse(result.stdout.trim());
    const checks: CiCheck[] = checksData.map((check: unknown) => parseCheckData(check));

    // 상태 분석
    const failedChecks = checks.filter(c =>
      c.conclusion === "failure" || c.conclusion === "error" || c.status === "failure"
    );
    const pendingChecks = checks.filter(c =>
      c.status === "pending" || (c.status === "success" && c.conclusion === null)
    );

    let overall: "pending" | "success" | "failure";
    if (failedChecks.length > 0) {
      overall = "failure";
    } else if (pendingChecks.length > 0) {
      overall = "pending";
    } else {
      overall = "success";
    }

    const summary: CiStatusSummary = {
      overall,
      checks,
      failedChecks,
      pendingChecks,
      lastCheckedAt: new Date().toISOString(),
    };

    logger.debug(`CI status: ${overall}, ${checks.length} checks, ${failedChecks.length} failed, ${pendingChecks.length} pending`);
    return summary;

  } catch (err: unknown) {
    logger.error(`Error checking CI status: ${getErrorMessage(err)}`);
    return {
      overall: "failure",
      checks: [],
      failedChecks: [],
      pendingChecks: [],
      lastCheckedAt: new Date().toISOString(),
    };
  }
}

/**
 * CI 상태를 주기적으로 폴링합니다.
 */
export async function pollCiStatus(
  prNumber: number,
  repo: string,
  ghConfig: GhCliConfig,
  pollingConfig: CiPollingConfig,
  onStatusUpdate?: (status: CiStatusSummary) => void
): Promise<CiStatusSummary> {
  const startTime = Date.now();
  const { intervalMs, maxDurationMs, failOnTimeout } = pollingConfig;

  logger.info(`Starting CI polling for PR #${prNumber} (max duration: ${maxDurationMs}ms, interval: ${intervalMs}ms)`);

  while (true) {
    const elapsed = Date.now() - startTime;

    // 타임아웃 체크
    if (elapsed >= maxDurationMs) {
      logger.warn(`CI polling timeout after ${elapsed}ms`);
      if (failOnTimeout) {
        return {
          overall: "failure",
          checks: [],
          failedChecks: [],
          pendingChecks: [],
          lastCheckedAt: new Date().toISOString(),
        };
      }
      break;
    }

    // CI 상태 확인
    const status = await checkPrCiStatus(prNumber, repo, ghConfig);

    // 상태 업데이트 콜백
    if (onStatusUpdate) {
      onStatusUpdate(status);
    }

    // 완료 조건 확인
    if (status.overall === "success" || status.overall === "failure") {
      logger.info(`CI polling completed: ${status.overall}`);
      return status;
    }

    // 다음 폴링까지 대기
    logger.debug(`CI still pending, waiting ${intervalMs}ms...`);
    await sleep(intervalMs);
  }

  // 타임아웃으로 인한 종료 - 마지막 상태 반환
  const finalStatus = await checkPrCiStatus(prNumber, repo, ghConfig);
  logger.warn(`CI polling ended due to timeout, final status: ${finalStatus.overall}`);
  return finalStatus;
}

/**
 * 실패한 CI 로그를 가져와서 파싱합니다.
 */
export async function getCiFailureLogs(
  prNumber: number,
  repo: string,
  ghConfig: GhCliConfig
): Promise<CiLogResult[]> {
  logger.debug(`Getting CI failure logs for PR #${prNumber} in ${repo}`);

  try {
    // 먼저 PR과 연관된 워크플로우 런들을 가져오기
    const runsResult = await runGhCommand(
      ghConfig.path,
      ["run", "list", "--repo", repo, "--json", "databaseId,name,status,conclusion,workflowName"],
      {},
      ghConfig.retry
    );

    if (runsResult.exitCode !== 0) {
      logger.warn(`Failed to get workflow runs: ${runsResult.stderr}`);
      return [];
    }

    const runs = JSON.parse(runsResult.stdout.trim());
    const failedRuns = runs.filter((run: {
      status: string;
      conclusion: string;
      databaseId: string;
      name: string;
      workflowName: string;
    }) => run.conclusion === "failure" || run.conclusion === "error");

    if (failedRuns.length === 0) {
      logger.debug("No failed workflow runs found");
      return [];
    }

    // 각 실패한 런의 로그 가져오기
    const logResults: CiLogResult[] = [];

    for (const run of failedRuns.slice(0, 3)) { // 최대 3개까지만 처리
      try {
        const logResult = await getWorkflowRunLogs(run.databaseId, run.workflowName, repo, ghConfig);
        if (logResult) {
          logResults.push(logResult);
        }
      } catch (err: unknown) {
        logger.warn(`Failed to get logs for run ${run.databaseId}: ${getErrorMessage(err)}`);
      }
    }

    return logResults;

  } catch (err: unknown) {
    logger.error(`Error getting CI failure logs: ${getErrorMessage(err)}`);
    return [];
  }
}

/**
 * 특정 워크플로우 런의 로그를 가져옵니다.
 */
async function getWorkflowRunLogs(
  runId: string,
  workflowName: string,
  repo: string,
  ghConfig: GhCliConfig
): Promise<CiLogResult | null> {
  try {
    // gh run view --log-failed 명령어로 실패한 잡의 로그 가져오기
    const logResult = await runGhCommand(
      ghConfig.path,
      ["run", "view", runId, "--repo", repo, "--log-failed"],
      {},
      ghConfig.retry
    );

    if (logResult.exitCode !== 0) {
      logger.warn(`Failed to get logs for run ${runId}: ${logResult.stderr}`);
      return null;
    }

    // 로그 내용 파싱
    const logContent = logResult.stdout;
    const failedJobLogs = parseFailedJobLogs(logContent);

    return {
      runId,
      workflowName,
      failedJobLogs,
    };

  } catch (err: unknown) {
    return {
      runId,
      workflowName,
      failedJobLogs: [],
      parseError: getErrorMessage(err),
    };
  }
}

/**
 * gh pr checks JSON 데이터를 CiCheck 객체로 파싱합니다.
 */
function parseCheckData(checkData: unknown): CiCheck {
  const data = checkData as Record<string, unknown>;

  return {
    name: String(data.name || "unknown"),
    status: (data.status as CiStatus) || "error",
    conclusion: (data.conclusion as CiStatus) || null,
    detailsUrl: String(data.detailsUrl || ""),
    startedAt: String(data.startedAt || new Date().toISOString()),
    completedAt: data.completedAt ? String(data.completedAt) : null,
  };
}

/**
 * 실패한 잡 로그를 파싱합니다.
 */
function parseFailedJobLogs(logContent: string): Array<{ jobName: string; logContent: string; error?: string }> {
  const jobLogs: Array<{ jobName: string; logContent: string; error?: string }> = [];

  // GitHub Actions 로그 형식 파싱 (간단한 버전)
  const lines = logContent.split("\n");
  let currentJob = "";
  let currentLog = "";

  for (const line of lines) {
    // 잡 시작 패턴 감지
    const jobMatch = line.match(/^##\[group\](.+)$/);
    if (jobMatch) {
      // 이전 잡이 있으면 저장
      if (currentJob && currentLog.trim()) {
        jobLogs.push({
          jobName: currentJob,
          logContent: currentLog.trim(),
        });
      }
      currentJob = jobMatch[1].trim();
      currentLog = "";
      continue;
    }

    // 에러 패턴 감지
    if (line.includes("ERROR") || line.includes("FAILED") || line.includes("Error:")) {
      currentLog += line + "\n";
    }
  }

  // 마지막 잡 저장
  if (currentJob && currentLog.trim()) {
    jobLogs.push({
      jobName: currentJob,
      logContent: currentLog.trim(),
    });
  }

  // 로그가 없으면 전체 내용을 하나의 잡으로 처리
  if (jobLogs.length === 0 && logContent.trim()) {
    jobLogs.push({
      jobName: "unknown",
      logContent: logContent.trim(),
    });
  }

  return jobLogs;
}

/**
 * 지정된 시간만큼 대기합니다.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}