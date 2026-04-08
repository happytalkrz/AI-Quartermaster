import { runGhCommand, runCli } from "../utils/cli-runner.js";
import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";
import { retryWithClaudeFix, type RetryWithFixOptions } from "./retry-with-fix.js";
import { commentOnIssue } from "../github/pr-creator.js";
import { loadTemplate, renderTemplate } from "../prompt/template-renderer.js";
import { resolve } from "path";
import type { GhCliConfig, ClaudeCliConfig } from "../types/config.js";

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
    // 1. PR의 head SHA 가져오기
    const prResult = await runGhCommand(
      ghConfig.path,
      ["pr", "view", String(prNumber), "--repo", repo, "--json", "headRefOid", "--jq", ".headRefOid"],
      {},
      ghConfig.retry
    );

    if (prResult.exitCode !== 0 || !prResult.stdout.trim()) {
      logger.warn(`Failed to get PR head SHA: ${prResult.stderr}`);
      return {
        overall: "pending",
        checks: [],
        failedChecks: [],
        pendingChecks: [],
        lastCheckedAt: new Date().toISOString(),
      };
    }

    const headSha = prResult.stdout.trim();

    // 2. 해당 커밋의 check-runs 가져오기 (gh api)
    const result = await runGhCommand(
      ghConfig.path,
      ["api", `repos/${repo}/commits/${headSha}/check-runs`],
      {},
      ghConfig.retry
    );

    if (result.exitCode !== 0) {
      logger.warn(`Failed to get check runs: ${result.stderr}`);
      return {
        overall: "pending",
        checks: [],
        failedChecks: [],
        pendingChecks: [],
        lastCheckedAt: new Date().toISOString(),
      };
    }

    // JSON 파싱
    const apiResponse = JSON.parse(result.stdout.trim());
    const checksData = apiResponse.check_runs || [];
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

  // CI 시작 대기: PR 생성 직후에는 CI가 아직 트리거 안 됐을 수 있음
  // 최소 1회는 interval 대기 후 체크
  logger.info(`Waiting ${intervalMs}ms for CI to start...`);
  await new Promise(resolve => setTimeout(resolve, intervalMs));

  let consecutiveResults = 0; // 같은 결과 연속 횟수

  // eslint-disable-next-line no-constant-condition
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

    // checks가 0개면 CI가 아직 시작 안 된 것 → 5분까지 대기, 이후 skip
    if (status.checks.length === 0) {
      if (elapsed >= 300000) {
        logger.warn(`No CI checks found after 5 minutes for PR #${prNumber} — skipping CI check (Draft PR or no CI configured)`);
        return {
          overall: "success",
          checks: [],
          failedChecks: [],
          pendingChecks: [],
          lastCheckedAt: new Date().toISOString(),
        };
      }
      logger.info(`No CI checks found yet for PR #${prNumber}, waiting...`);
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      continue;
    }

    // 완료 조건 확인 — 연속 2회 같은 결과여야 확정 (1회만으로는 이전 커밋 결과일 수 있음)
    if (status.overall === "success" || status.overall === "failure") {
      consecutiveResults++;
      if (consecutiveResults >= 2) {
        logger.info(`CI polling completed: ${status.overall} (confirmed ${consecutiveResults} times)`);
        return status;
      }
      logger.info(`CI result: ${status.overall} (${consecutiveResults}/2 confirmations), waiting...`);
    } else {
      consecutiveResults = 0;
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
    detailsUrl: String(data.details_url || data.detailsUrl || ""),
    startedAt: String(data.started_at || data.startedAt || new Date().toISOString()),
    completedAt: (data.completed_at || data.completedAt) ? String(data.completed_at || data.completedAt) : null,
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

/**
 * CI 자동 수정 옵션
 */
export interface CiAutoFixOptions {
  /** PR 번호 */
  prNumber: number;
  /** 저장소 이름 (owner/repo) */
  repo: string;
  /** 이슈 번호 (코멘트용) */
  issueNumber: number;
  /** 작업 디렉토리 */
  cwd: string;
  /** 프롬프트 디렉토리 */
  promptsDir: string;
  /** Git 실행 경로 */
  gitPath: string;
  /** GitHub CLI 설정 */
  ghConfig: GhCliConfig;
  /** Claude CLI 설정 */
  claudeConfig: ClaudeCliConfig;
  /** 최대 수정 시도 횟수 (기본값: 3) */
  maxFixAttempts?: number;
  /** 드라이 런 모드 */
  dryRun?: boolean;
}

/**
 * CI 자동 수정 결과
 */
export interface CiAutoFixResult {
  /** 최종 성공 여부 */
  success: boolean;
  /** 수정 시도 횟수 */
  attempts: number;
  /** 최종 CI 상태 */
  finalCiStatus: CiStatusSummary;
  /** 실패한 경우 에러 메시지 */
  error?: string;
}

/**
 * CI 실패 시 자동 수정 루프를 실행합니다.
 *
 * 작동 방식:
 * 1. CI 상태를 확인하여 실패 여부 판단
 * 2. 실패한 경우 로그를 분석하고 Claude를 통해 수정
 * 3. 수정 사항을 커밋하고 push
 * 4. 다시 CI 폴링하여 성공 여부 확인
 * 5. 최대 3회까지 반복, 이슈에 진행 상황 코멘트
 */
export async function autoFixCiFailures(
  options: CiAutoFixOptions
): Promise<CiAutoFixResult> {
  const maxAttempts = options.maxFixAttempts || 3;
  const logger = getLogger();

  logger.info(`[CI_AUTO_FIX] Starting CI auto-fix for PR #${options.prNumber}, max attempts: ${maxAttempts}`);

  // 이슈에 시작 알림 코멘트 추가
  await commentOnIssue(
    options.issueNumber,
    options.repo,
    `🔧 **CI 자동 수정 시작**\n\nPR #${options.prNumber}에서 CI 실패가 감지되어 자동 수정을 시작합니다.\n최대 ${maxAttempts}회 시도합니다.`,
    { ghPath: options.ghConfig.path, dryRun: options.dryRun }
  );

  const retryOptions: RetryWithFixOptions<CiStatusSummary> = {
    checkFn: async () => {
      // CI 상태 확인
      const ciStatus = await checkPrCiStatus(options.prNumber, options.repo, options.ghConfig);
      const success = ciStatus.overall === "success";
      logger.debug(`[CI_AUTO_FIX] Current CI status: ${ciStatus.overall}`);
      return { success, result: ciStatus };
    },

    buildFixPromptFn: (ciStatus: CiStatusSummary) => {
      return buildCiFixPromptSync(ciStatus, options);
    },

    revalidateFn: async () => {
      // push 후 CI 재확인 (짧은 폴링)
      logger.info(`[CI_AUTO_FIX] Waiting for CI to start after push...`);
      await sleep(30000); // 30초 대기

      const pollingConfig = {
        intervalMs: 60000, // 1분 간격
        maxDurationMs: 600000, // 10분 최대
        failOnTimeout: false
      };

      const ciStatus = await pollCiStatus(
        options.prNumber,
        options.repo,
        options.ghConfig,
        pollingConfig,
        (status) => {
          logger.debug(`[CI_AUTO_FIX] Polling CI status: ${status.overall}, failed: ${status.failedChecks.length}, pending: ${status.pendingChecks.length}`);
        }
      );

      const success = ciStatus.overall === "success";
      logger.info(`[CI_AUTO_FIX] Revalidation result: ${ciStatus.overall}`);
      return { success, result: ciStatus };
    },

    maxRetries: maxAttempts,
    claudeConfig: options.claudeConfig,
    cwd: options.cwd,
    gitPath: options.gitPath,
    commitMessageTemplate: `[#${options.issueNumber}] CI fix attempt {attempt}`,

    onAttempt: async (attempt: number, maxRetries: number, description: string) => {
      logger.info(`[CI_AUTO_FIX] Fix attempt ${attempt}/${maxRetries}: ${description}`);
      await commentOnIssue(
        options.issueNumber,
        options.repo,
        `🔄 **수정 시도 ${attempt}/${maxRetries}**\n\n${description}`,
        { ghPath: options.ghConfig.path, dryRun: options.dryRun }
      );
    },

    onSuccess: async (attempt: number, result: CiStatusSummary) => {
      logger.info(`[CI_AUTO_FIX] CI fixed successfully after ${attempt} attempts`);
      await commentOnIssue(
        options.issueNumber,
        options.repo,
        `✅ **CI 자동 수정 성공!**\n\n${attempt}회 시도 후 모든 CI 체크가 통과되었습니다.\n\n- 성공한 체크: ${result.checks.filter(c => c.status === "success").length}개\n- 전체 체크: ${result.checks.length}개`,
        { ghPath: options.ghConfig.path, dryRun: options.dryRun }
      );
    },

    onFailure: async (maxRetries: number, finalResult: CiStatusSummary) => {
      logger.error(`[CI_AUTO_FIX] Failed to fix CI after ${maxRetries} attempts`);

      const failedChecks = finalResult.failedChecks.map(c => `- ${c.name}: ${c.conclusion}`).join('\n');
      await commentOnIssue(
        options.issueNumber,
        options.repo,
        `❌ **CI 자동 수정 실패**\n\n${maxRetries}회 시도 후에도 CI를 수정할 수 없었습니다.\n수동으로 확인이 필요합니다.\n\n**실패한 체크들:**\n${failedChecks}`,
        { ghPath: options.ghConfig.path, dryRun: options.dryRun }
      );
    }
  };

  // push 후 원격 브랜치 업데이트를 위한 커스텀 동작 추가
  const originalCheckFn = retryOptions.checkFn;
  const originalRevalidateFn = retryOptions.revalidateFn;

  // checkFn을 수정하여 push 수행
  retryOptions.revalidateFn = async () => {
    // 수정 후 변경사항을 push
    try {
      logger.info(`[CI_AUTO_FIX] Pushing changes to remote...`);
      const pushResult = await runCli(
        options.gitPath,
        ["push", "origin", "HEAD"],
        { cwd: options.cwd }
      );

      if (pushResult.exitCode !== 0) {
        logger.warn(`[CI_AUTO_FIX] Failed to push: ${pushResult.stderr}`);
        // push 실패해도 계속 진행 (로컬에서만 테스트하는 경우)
      } else {
        logger.info(`[CI_AUTO_FIX] Successfully pushed changes`);
      }
    } catch (err: unknown) {
      logger.warn(`[CI_AUTO_FIX] Push error: ${getErrorMessage(err)}`);
    }

    // 원본 revalidateFn 실행
    return originalRevalidateFn();
  };

  const result = await retryWithClaudeFix(retryOptions);

  return {
    success: result.success,
    attempts: result.attempts,
    finalCiStatus: result.result,
    error: result.error
  };
}

/**
 * CI 실패 로그를 분석하여 Claude용 수정 프롬프트를 생성합니다. (동기 버전)
 */
function buildCiFixPromptSync(
  ciStatus: CiStatusSummary,
  options: CiAutoFixOptions
): string {
  const logger = getLogger();

  try {
    // CI 수정 프롬프트 템플릿 로드
    const templatePath = resolve(options.promptsDir, "ci-fix.md");
    let template: string;

    try {
      template = loadTemplate(templatePath);
    } catch (err: unknown) {
      logger.warn(`[CI_AUTO_FIX] CI fix template not found at ${templatePath}, using fallback`);
      template = getFallbackCiFixTemplate();
    }

    // 실패한 체크들의 요약 정보
    const failedChecksSummary = ciStatus.failedChecks.map(check =>
      `${check.name} (${check.conclusion || check.status})`
    ).join(', ');

    // 기본 템플릿 렌더링 (로그는 Claude가 자체 조회하도록)
    const prompt = renderTemplate(template, {
      pr: {
        number: String(options.prNumber),
        repo: options.repo
      },
      ci: {
        overall: ciStatus.overall,
        failedChecksCount: String(ciStatus.failedChecks.length),
        totalChecksCount: String(ciStatus.checks.length),
        lastCheckedAt: ciStatus.lastCheckedAt
      },
      failedChecksSummary,
      failedChecks: ciStatus.failedChecks.map(check =>
        `- ${check.name}: ${check.conclusion || check.status} (${check.detailsUrl})`
      ).join('\n') as string
    });

    return prompt;

  } catch (err: unknown) {
    logger.error(`[CI_AUTO_FIX] Error building fix prompt: ${getErrorMessage(err)}`);

    // 최소한의 fallback 프롬프트
    const errorSummary = ciStatus.failedChecks.map(c => `- ${c.name}: ${c.conclusion}`).join('\n');
    return `CI가 실패했습니다. 다음 체크들을 수정하세요:\n\n${errorSummary}\n\n각 실패한 체크를 분석하고 코드를 수정한 후 git commit을 실행하세요.`;
  }
}

/**
 * CI 실패 로그를 분석하여 Claude용 수정 프롬프트를 생성합니다. (비동기 버전)
 */
async function buildCiFixPrompt(
  ciStatus: CiStatusSummary,
  options: CiAutoFixOptions
): Promise<string> {
  const logger = getLogger();

  try {
    // 실패한 CI 로그 가져오기
    const ciLogs = await getCiFailureLogs(
      options.prNumber,
      options.repo,
      options.ghConfig
    );

    // CI 수정 프롬프트 템플릿 로드
    const templatePath = resolve(options.promptsDir, "ci-fix.md");
    let template: string;

    try {
      template = loadTemplate(templatePath);
    } catch (err: unknown) {
      logger.warn(`[CI_AUTO_FIX] CI fix template not found at ${templatePath}, using fallback`);
      template = getFallbackCiFixTemplate();
    }

    // 로그 정보를 텍스트로 변환
    const logsText = ciLogs.map(log => {
      const jobsText = log.failedJobLogs.map(job =>
        `#### ${job.jobName}\n${job.logContent}${job.error ? `\nError: ${job.error}` : ''}`
      ).join('\n\n');

      return `### ${log.workflowName} (ID: ${log.runId})\n${log.parseError || jobsText}`;
    }).join('\n\n');

    // 템플릿 렌더링
    const prompt = renderTemplate(template, {
      pr: {
        number: String(options.prNumber),
        repo: options.repo
      },
      ci: {
        overall: ciStatus.overall,
        failedChecksCount: String(ciStatus.failedChecks.length),
        totalChecksCount: String(ciStatus.checks.length),
        lastCheckedAt: ciStatus.lastCheckedAt
      },
      failedChecks: ciStatus.failedChecks.map(check =>
        `- ${check.name}: ${check.conclusion || check.status} (${check.detailsUrl})`
      ).join('\n') as string,
      logs: logsText
    });

    return prompt;

  } catch (err: unknown) {
    logger.error(`[CI_AUTO_FIX] Error building fix prompt: ${getErrorMessage(err)}`);

    // 최소한의 fallback 프롬프트
    const errorSummary = ciStatus.failedChecks.map(c => `- ${c.name}: ${c.conclusion}`).join('\n');
    return `CI가 실패했습니다. 다음 체크들을 수정하세요:\n\n${errorSummary}\n\n각 실패한 체크를 분석하고 코드를 수정한 후 git commit을 실행하세요.`;
  }
}

/**
 * CI 수정 프롬프트 템플릿 (fallback)
 */
function getFallbackCiFixTemplate(): string {
  return `# CI 실패 자동 수정

CI에서 실패가 감지되었습니다. 로그를 분석하고 문제를 수정하세요.

## PR 정보

- **PR**: #{{pr.number}} in {{pr.repo}}
- **CI 상태**: {{ci.overall}}
- **실패한 체크**: {{ci.failedChecksCount}}/{{ci.totalChecksCount}}
- **마지막 확인**: {{ci.lastCheckedAt}}

## 실패한 체크들

{{#each failedChecks}}
### {{name}}
- **상태**: {{status}}
- **결론**: {{conclusion}}
- **완료 시간**: {{completedAt}}
- **세부 정보**: {{detailsUrl}}

{{/each}}

## 로그 분석

{{#each logs}}
### {{workflowName}} (Run ID: {{runId}})

{{#if parseError}}
**로그 파싱 에러**: {{parseError}}
{{else}}
{{#each failedJobs}}
#### 실패한 잡: {{jobName}}

\`\`\`
{{logContent}}
\`\`\`

{{#if error}}
**에러**: {{error}}
{{/if}}

{{/each}}
{{/if}}

{{/each}}

---

## 수정 지침

1. **로그를 주의 깊게 분석**하여 실패 원인을 파악하세요.
2. **테스트 실패**: 테스트 코드나 구현 코드를 수정하세요.
3. **빌드 실패**: 타입 에러, import 에러, 설정 파일 문제를 확인하세요.
4. **린트 실패**: 코드 스타일이나 품질 규칙을 준수하도록 수정하세요.
5. **보안 검사 실패**: 취약점을 수정하거나 안전한 대안을 사용하세요.

## 수정 후 작업

수정 완료 후 반드시 **git add + git commit**을 실행하세요.
커밋 메시지는 간결하고 명확하게 작성하세요.

예시: \`ci: fix TypeScript errors in user service\`
`;
}