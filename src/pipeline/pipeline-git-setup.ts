import { resolve } from "path";
import { readFileSync, existsSync } from "fs";
import { syncBaseBranch, createWorkBranch } from "../git/branch-manager.js";
import { createWorktree, removeWorktree } from "../git/worktree-manager.js";
import { installDependencies } from "./dependency-installer.js";
import { createCheckpoint } from "../safety/rollback-manager.js";
import { createSlugWithFallback } from "../utils/slug.js";
import { runCli } from "../utils/cli-runner.js";
import { withRepoLock } from "../git/repo-lock.js";
import { loadSkills, formatSkillsForPrompt } from "../config/skill-loader.js";
import { getLogger } from "../utils/logger.js";
import type { GitConfig, WorktreeConfig } from "../types/config.js";
import type { PipelineState } from "../types/pipeline.js";
import type { JobLogger } from "../queue/job-logger.js";
import type { ResolvedProject } from "../config/project-resolver.js";

const logger = getLogger();

export interface GitSetupInput {
  issueNumber: number;
  issueTitle: string;
  repo: string;
  projectRoot: string;
  gitConfig: GitConfig;
  worktreeConfig: WorktreeConfig;
  state: PipelineState;
  isRetry: boolean;
  jl?: JobLogger;
}

export interface GitSetupResult {
  branchName: string;
  worktreePath: string;
  state: PipelineState;
}

export interface EnvironmentPrepInput {
  projectRoot: string;
  worktreePath: string;
  gitConfig: GitConfig;
  project: ResolvedProject;
  rollbackStrategy: string;
  jl?: JobLogger;
}

export interface EnvironmentPrepResult {
  rollbackHash?: string;
  projectConventions: string;
  skillsContext: string;
  repoStructure: string;
}

/**
 * Utility function to check if current state is past the given target state
 */
function isPastState(current: PipelineState, target: PipelineState): boolean {
  const states = [
    "RECEIVED", "VALIDATED", "BASE_SYNCED", "BRANCH_CREATED", "WORKTREE_CREATED",
    "PLAN_GENERATED", "PHASE_IN_PROGRESS", "PHASE_FAILED", "REVIEWING",
    "SIMPLIFYING", "FINAL_VALIDATING", "DRAFT_PR_CREATED", "DONE", "FAILED"
  ];

  const currentIndex = states.indexOf(current);
  const targetIndex = states.indexOf(target);

  return currentIndex > targetIndex;
}

/**
 * Sets up Git environment: syncs base branch, creates work branch, and creates worktree.
 * Handles retry scenarios with worktree cleanup.
 */
export async function setupGitEnvironment(input: GitSetupInput): Promise<GitSetupResult> {
  let { state } = input;
  let branchName: string | undefined;
  let worktreePath: string | undefined;

  // If we're past WORKTREE_CREATED, skip all setup
  if (isPastState(state, "WORKTREE_CREATED")) {
    logger.info(`[SKIP] Git environment setup (already past WORKTREE_CREATED)`);
    return {
      branchName: undefined,
      worktreePath: undefined,
      state,
    };
  }

  // Serialize git operations per-repo to prevent concurrent branch/worktree conflicts
  await withRepoLock(input.repo, async () => {
    // === VALIDATED → BASE_SYNCED ===
    if (isPastState(state, "BASE_SYNCED")) {
      logger.info(`[SKIP] VALIDATED → BASE_SYNCED (already done)`);
    } else {
      await syncBaseBranch(input.gitConfig, { cwd: input.projectRoot });
      state = "BASE_SYNCED";
      logger.info(`[BASE_SYNCED] Base branch synced`);
      input.jl?.setStep("브랜치 생성 중...");
    }

    // === BASE_SYNCED → BRANCH_CREATED ===
    if (isPastState(state, "BRANCH_CREATED")) {
      logger.info(`[SKIP] BASE_SYNCED → BRANCH_CREATED (already done)`);
    } else {
      const branchInfo = await createWorkBranch(
        input.gitConfig,
        input.issueNumber,
        input.issueTitle,
        { cwd: input.projectRoot }
      );
      branchName = branchInfo.workBranch;
      state = "BRANCH_CREATED";
      logger.info(`[BRANCH_CREATED] Branch: ${branchName}`);
      input.jl?.log(`브랜치: ${branchName}`);
    }

    // === BRANCH_CREATED → WORKTREE_CREATED ===
    if (isPastState(state, "WORKTREE_CREATED")) {
      logger.info(`[SKIP] BRANCH_CREATED → WORKTREE_CREATED (already done)`);
    } else {
      // For retry jobs, clean up existing worktree to remove dirty state from previous failed attempts
      if (input.isRetry) {
        const slug = createSlugWithFallback(input.issueTitle);
        const expectedPath = resolve(input.worktreeConfig.rootPath, `${input.issueNumber}-${slug}`);

        if (existsSync(expectedPath)) {
          input.jl?.log("재시도 작업 - 기존 worktree 정리 시도 중...");

          try {
            await removeWorktree(input.gitConfig, expectedPath, { cwd: input.projectRoot, force: true });
            logger.info(`[RETRY] Removed worktree: ${expectedPath}`);
            input.jl?.log("재시도 작업 - 기존 worktree 정리 완료");
          } catch (e) {
            logger.warn(`[RETRY] Primary cleanup failed: ${e}`);
            try {
              await runCli(input.gitConfig.gitPath, ["worktree", "prune"], { cwd: input.projectRoot });
              logger.info(`[RETRY] Pruned stale entries`);
            } catch (pruneError) {
              logger.warn(`[RETRY] Prune failed: ${pruneError}`);
            }
            logger.warn(`[RETRY] Cleanup failed; continuing (branch-manager handles full cleanup)`);
            input.jl?.log("워크트리 정리 실패했지만 계속 진행 (branch-manager에서 완전 정리 예정)");
          }
        }
      }

      const slug = createSlugWithFallback(input.issueTitle);
      const worktreeInfo = await createWorktree(
        input.gitConfig,
        input.worktreeConfig,
        branchName!,
        input.issueNumber,
        slug,
        { cwd: input.projectRoot }
      );
      worktreePath = worktreeInfo.path;
      state = "WORKTREE_CREATED";
      logger.info(`[WORKTREE_CREATED] Worktree: ${worktreePath}`);
    }
  });

  if (!branchName || !worktreePath) {
    throw new Error("Failed to set up Git environment: missing branch name or worktree path");
  }

  return {
    branchName,
    worktreePath,
    state,
  };
}

/**
 * Prepares work environment: creates rollback checkpoint, installs dependencies,
 * loads CLAUDE.md and skills, and gets repo structure.
 */
export async function prepareWorkEnvironment(input: EnvironmentPrepInput): Promise<EnvironmentPrepResult> {
  let rollbackHash: string | undefined;

  // === Create rollback checkpoint (before any phase commits) ===
  if (input.rollbackStrategy !== "none") {
    try {
      const hash = await createCheckpoint({ cwd: input.worktreePath, gitPath: input.gitConfig.gitPath });
      rollbackHash = hash;
      logger.info(`Rollback checkpoint set: ${hash.slice(0, 8)}`);
    } catch (e) {
      logger.warn(`Failed to create rollback checkpoint: ${e}`);
    }
  }

  // === Install dependencies in worktree ===
  if (input.project.commands.preInstall) {
    input.jl?.setStep("의존성 설치 중...");
    await installDependencies(input.project.commands.preInstall, { cwd: input.worktreePath });
  }

  // === Read CLAUDE.md for project conventions ===
  let projectConventions = "";
  const claudeMdPath = input.project.commands.claudeMdPath;
  if (claudeMdPath) {
    // Check worktree first (committed CLAUDE.md), then project root
    const worktreeMd = resolve(input.worktreePath, claudeMdPath);
    const rootMd = resolve(input.projectRoot, claudeMdPath);
    if (existsSync(worktreeMd)) {
      projectConventions = readFileSync(worktreeMd, "utf-8");
      logger.info(`CLAUDE.md loaded from worktree`);
    } else if (existsSync(rootMd)) {
      projectConventions = readFileSync(rootMd, "utf-8");
      logger.info(`CLAUDE.md loaded from project root`);
    } else {
      logger.debug(`No CLAUDE.md found at ${claudeMdPath}`);
    }
  }

  // === Load skills for prompt injection ===
  let skillsContext = "";
  const skillsPath = input.project.commands.skillsPath;
  if (skillsPath) {
    // Use original project root (not worktree) for skills
    const resolvedSkillsPath = resolve(input.projectRoot, skillsPath);
    const skills = loadSkills(resolvedSkillsPath);
    if (skills.length > 0) {
      skillsContext = formatSkillsForPrompt(skills);
      logger.info(`Loaded ${skills.length} skills from ${resolvedSkillsPath}`);
    } else {
      logger.debug(`No skills found at ${resolvedSkillsPath}`);
    }
  }

  // === Get repo structure for plan generation (tracked files only) ===
  const structureResult = await runCli(
    input.gitConfig.gitPath,
    ["ls-tree", "-r", "--name-only", "HEAD"],
    { cwd: input.worktreePath }
  );
  // Limit output so prompt stays manageable
  const repoStructure = structureResult.stdout.split("\n").slice(0, 200).join("\n");

  return {
    rollbackHash,
    projectConventions,
    skillsContext,
    repoStructure,
  };
}