import { resolve } from "path";
import { fetchIssue } from "../github/issue-fetcher.js";
import { runCli } from "../utils/cli-runner.js";
import { validateIssue } from "../safety/safety-checker.js";
import { saveCheckpoint, removeCheckpoint } from "./checkpoint.js";
import { resolveProject, type ResolvedProject } from "../config/project-resolver.js";
import { detectModeFromLabels } from "../config/mode-presets.js";
import { getLogger } from "../utils/logger.js";
import { PROGRESS_ISSUE_VALIDATED, PROGRESS_DONE } from "./progress-tracker.js";
import type { AQConfig } from "../types/config.js";
import type { PipelineCheckpoint } from "./checkpoint.js";
import type { JobLogger } from "../queue/job-logger.js";
import type { PipelineTimer } from "../safety/timeout-manager.js";

const logger = getLogger();

export interface ProjectSetupResult {
  projectRoot: string;
  promptsDir: string;
  gitConfig: import("../types/config.js").GitConfig;
}

export interface DuplicatePRCheckResult {
  hasDuplicatePR: boolean;
  prUrl?: string;
}

export interface IssueSetupResult {
  issue: Awaited<ReturnType<typeof fetchIssue>>;
  mode: import("../types/config.js").PipelineMode;
  checkpoint: (overrides?: Partial<PipelineCheckpoint>) => void;
}

/**
 * 프로젝트 설정 해석 및 gitConfig/promptsDir 반환
 * orchestrator.ts 110-121줄에서 추출
 */
export function resolveResolvedProject(
  repo: string,
  config: AQConfig,
  inputProjectRoot?: string,
  resumeProjectRoot?: string,
  aqRoot?: string
): ProjectSetupResult {
  // Resolve per-project config (merges project overrides with global defaults)
  const project = resolveProject(repo, config);
  // Allow explicit --target override, otherwise use resolved project path
  const projectRoot = inputProjectRoot ?? resumeProjectRoot ?? project.path;
  const promptsDir = resolve(aqRoot ?? projectRoot, "prompts");

  // Build a git config that reflects per-project branch settings
  const gitConfig = {
    ...config.git,
    defaultBaseBranch: project.baseBranch,
    branchTemplate: project.branchTemplate,
  };

  return { projectRoot, promptsDir, gitConfig };
}

/**
 * gh CLI로 중복 PR 확인하여 early return 여부 판단
 * orchestrator.ts 128-151줄에서 추출
 */
export async function checkDuplicatePR(
  repo: string,
  issueNumber: number,
  project: ResolvedProject,
  isRetry: boolean,
  jl?: JobLogger,
  dataDir?: string
): Promise<DuplicatePRCheckResult> {
  // Check if a PR already exists for this issue (prevents duplicate work)
  // Skip this check for retry jobs to allow re-execution of failed jobs
  if (!isRetry) {
    try {
      const prCheckResult = await runCli(
        project.commands.ghCli.path,
        ["pr", "list", "--repo", repo, "--search", `#${issueNumber} in:title`, "--json", "number,url", "--limit", "1"],
        { timeout: 10000 }
      );
      if (prCheckResult.exitCode === 0) {
        const prs = JSON.parse(prCheckResult.stdout);
        if (prs.length > 0) {
          logger.info(`[SKIP] Issue #${issueNumber} already has PR: ${prs[0].url} — marking as complete`);
          jl?.log(`이슈에 이미 PR이 존재합니다: ${prs[0].url}`);
          jl?.setProgress(PROGRESS_DONE);
          jl?.setStep("완료 (기존 PR)");
          if (dataDir) {
            removeCheckpoint(dataDir, issueNumber);
          }
          return { hasDuplicatePR: true, prUrl: prs[0].url };
        }
      }
    } catch {
      // non-fatal: continue pipeline if PR check fails
    }
  }

  return { hasDuplicatePR: false };
}

/**
 * 이슈 fetch, 안전성 검증, 체크포인트 저장, 모드 결정까지 수행
 * orchestrator.ts 153-198줄에서 추출
 */
export async function fetchAndValidateIssue(
  repo: string,
  issueNumber: number,
  project: ResolvedProject,
  state: import("../types/pipeline.js").PipelineState,
  timer: PipelineTimer,
  jl?: JobLogger,
  resumeMode?: import("../types/config.js").PipelineMode,
  setupContext?: {
    projectRoot: string;
    worktreePath?: string;
    branchName?: string;
    dataDir: string;
  }
): Promise<IssueSetupResult> {
  const isPastState = (current: import("../types/pipeline.js").PipelineState, target: import("../types/pipeline.js").PipelineState): boolean => {
    const states = ["RECEIVED", "VALIDATED", "BASE_SYNCED", "BRANCH_CREATED", "WORKTREE_CREATED", "PLAN_GENERATED", "PHASE_IN_PROGRESS", "PHASE_FAILED", "REVIEWING", "SIMPLIFYING", "FINAL_VALIDATING", "DRAFT_PR_CREATED", "DONE", "FAILED"];
    const currentIndex = states.indexOf(current);
    const targetIndex = states.indexOf(target);
    return currentIndex > targetIndex;
  };

  // === RECEIVED → VALIDATED ===
  let issue: Awaited<ReturnType<typeof fetchIssue>>;
  if (isPastState(state, "VALIDATED")) {
    logger.info(`[SKIP] RECEIVED → VALIDATED (already done)`);
    // Still need to fetch issue for later stages
    issue = await fetchIssue(repo, issueNumber, {
      ghPath: project.commands.ghCli.path,
      timeout: project.commands.ghCli.timeout,
    });
  } else {
    logger.info(`[RECEIVED] Issue #${issueNumber} from ${repo}`);
    jl?.setStep("이슈 정보 가져오는 중...");

    timer.assertNotExpired("issue-fetch");
    issue = await fetchIssue(repo, issueNumber, {
      ghPath: project.commands.ghCli.path,
      timeout: project.commands.ghCli.timeout,
    });
    logger.info(`[VALIDATED] Issue: ${issue.title}`);
    jl?.log(`이슈: ${issue.title}`);
    state = "VALIDATED";
    jl?.setProgress(PROGRESS_ISSUE_VALIDATED);

    // === Safety: validate issue labels ===
    validateIssue(issue, project.safety);

    if (setupContext) {
      saveCheckpoint(setupContext.dataDir, issueNumber, {
        issueNumber, repo, state, projectRoot: setupContext.projectRoot,
        worktreePath: setupContext.worktreePath, branchName: setupContext.branchName,
        phaseResults: [], mode: "code", savedAt: new Date().toISOString(),
      });
    }
  }

  // Determine initial pipeline mode: issue label > project config > default
  const mode = resumeMode || detectModeFromLabels(issue.labels, project.mode ?? "code");
  logger.info(`Pipeline mode (초기): ${mode}`);
  jl?.log(`모드: ${mode}`);

  const checkpoint = (overrides?: Partial<PipelineCheckpoint>) => {
    if (setupContext) {
      saveCheckpoint(setupContext.dataDir, issueNumber, {
        issueNumber, repo, state, projectRoot: setupContext.projectRoot,
        worktreePath: setupContext.worktreePath, branchName: setupContext.branchName,
        phaseResults: [],
        mode, savedAt: new Date().toISOString(),
        ...overrides,
      });
    }
  };

  return { issue, mode, checkpoint };
}