import { resolve, isAbsolute } from "path";
import { homedir } from "os";
import type { AQConfig, CommandsConfig, ReviewConfig, PrConfig, SafetyConfig, PipelineMode } from "../types/config.js";
import { deepMerge } from "./loader.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger();

/** AQM 홈 디렉토리 (기본값: ~/.ai-quartermaster) */
export const AQM_HOME = process.env.AQM_HOME || resolve(homedir(), ".ai-quartermaster");

/**
 * 프로젝트 경로를 확장합니다.
 * - ~로 시작하면 홈 디렉토리로 치환
 * - 상대경로면 AQM_HOME 기준으로 resolve
 * - 절대경로면 그대로 반환
 */
export function expandProjectPath(path: string): string {
  if (path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }
  if (path === "~") {
    return homedir();
  }
  if (!isAbsolute(path)) {
    return resolve(AQM_HOME, path);
  }
  return path;
}

export interface ResolvedProject {
  repo: string;
  path: string;
  baseBranch: string;
  branchTemplate: string;
  mode?: PipelineMode;
  commands: CommandsConfig;
  review: ReviewConfig;
  pr: PrConfig;
  safety: SafetyConfig;
}

/**
 * Resolves a project config by repo name.
 * If the repo matches a project in config.projects, merges project-specific overrides.
 * Falls back to global config + general.targetRoot.
 */
export function resolveProject(repo: string, config: AQConfig): ResolvedProject {
  const project = config.projects?.find(p => p.repo === repo);

  if (project) {
    logger.info(`Resolved project config for ${repo}`);
    return {
      repo: project.repo,
      path: expandProjectPath(project.path),
      baseBranch: project.baseBranch ?? config.git.defaultBaseBranch,
      branchTemplate: project.branchTemplate ?? config.git.branchTemplate,
      mode: project.mode,
      commands: project.commands
        ? deepMerge(config.commands, project.commands) as CommandsConfig
        : config.commands,
      review: project.review
        ? deepMerge(config.review, project.review) as ReviewConfig
        : config.review,
      pr: project.pr
        ? deepMerge(config.pr, project.pr) as PrConfig
        : config.pr,
      safety: project.safety
        ? deepMerge(config.safety, project.safety) as SafetyConfig
        : config.safety,
    };
  }

  // Check if repo is in allowedRepos
  if (!config.git.allowedRepos.includes(repo)) {
    throw new Error(`Repository ${repo} is not configured. Add it to 'projects' or 'git.allowedRepos' in config.yml`);
  }

  // Fallback to global config
  const fallbackPath = config.general.targetRoot;
  if (!fallbackPath) {
    throw new Error(`No project path configured for ${repo}. Add it to 'projects' in config.yml or set 'general.targetRoot'`);
  }

  logger.info(`Using global config for ${repo} (path: ${fallbackPath})`);
  return {
    repo,
    path: expandProjectPath(fallbackPath),
    baseBranch: config.git.defaultBaseBranch,
    branchTemplate: config.git.branchTemplate,
    commands: config.commands,
    review: config.review,
    pr: config.pr,
    safety: config.safety,
  };
}

/**
 * Returns list of all configured repos (from both projects and allowedRepos).
 */
export function listConfiguredRepos(config: AQConfig): string[] {
  const repos = new Set<string>();
  if (config.projects) {
    for (const p of config.projects) {
      repos.add(p.repo);
    }
  }
  for (const r of config.git.allowedRepos) {
    repos.add(r);
  }
  return [...repos];
}
