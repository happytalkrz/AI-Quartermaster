import type { Hono } from "hono";
import { resolve } from "path";
import type { JobStore } from "../../queue/job-store.js";
import type { ConfigWatcher } from "../../config/config-watcher.js";
import type { HealthCheckResponse } from "../../types/api.js";
import { safeError } from "../route-context.js";
import { loadConfig } from "../../config/loader.js";
import { getProjectSummary } from "../../store/queries.js";
import { runCli } from "../../utils/cli-runner.js";
import { getLogger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/error-utils.js";
import {
  checkGitRemoteAccess,
  checkLocalPath,
  checkDiskSpace,
  checkDependencies,
} from "../health-checks.js";

export interface HealthRouteContext {
  store: JobStore;
  configWatcher?: ConfigWatcher;
  rootDir: string;
}

/**
 * 프로젝트 헬스 체크 결과 — repositories/projects-health/health 세 라우트가 공통으로 사용.
 */
type CheckResults = {
  gitRemoteCheck: Awaited<ReturnType<typeof checkGitRemoteAccess>>;
  localPathCheck: Awaited<ReturnType<typeof checkLocalPath>>;
  diskSpaceCheck: Awaited<ReturnType<typeof checkDiskSpace>>;
  dependenciesCheck: Awaited<ReturnType<typeof checkDependencies>>;
};

function deriveOverallStatus(c: CheckResults): "healthy" | "warning" | "error" {
  if (c.gitRemoteCheck.status === "error" || c.localPathCheck.status === "error") {
    return "error";
  }
  if (
    c.diskSpaceCheck.status === "warning" ||
    c.diskSpaceCheck.status === "error" ||
    c.dependenciesCheck.status === "warning" ||
    c.dependenciesCheck.status === "error"
  ) {
    return "warning";
  }
  return "healthy";
}

async function runProjectChecks(projectPath: string, gitPath: string): Promise<CheckResults> {
  const [gitRemoteCheck, localPathCheck, diskSpaceCheck, dependenciesCheck] = await Promise.all([
    checkGitRemoteAccess(projectPath, gitPath),
    checkLocalPath(projectPath),
    checkDiskSpace(projectPath),
    checkDependencies(projectPath),
  ]);
  return { gitRemoteCheck, localPathCheck, diskSpaceCheck, dependenciesCheck };
}

/**
 * /api/repositories, /api/projects/health, /api/health 라우트 등록 (Plan C #C9 — 9단계).
 *
 * 이전: dashboard-api.ts 711-940 (3 routes, ~230줄). 4개 검사 헬퍼는 인라인.
 * 이후: 헬퍼는 src/server/health-checks.ts로 추출, 라우트는 본 파일로 응집.
 *      runProjectChecks/deriveOverallStatus 헬퍼로 3개 라우트의 중복도 정리.
 */
export function registerHealthRoutes(api: Hono, ctx: HealthRouteContext): void {
  const { store, configWatcher, rootDir } = ctx;

  // Repositories — project-level aggregated info with health + stats
  api.get("/api/repositories", async (c) => {
    try {
      const config = configWatcher?.current() ?? loadConfig(rootDir);
      const projects = config.projects ?? [];

      if (projects.length === 0) {
        return c.json({
          repositories: [],
          summary: { total: 0, healthy: 0, warning: 0, error: 0, totalJobs: 0, checkedAt: new Date().toISOString() },
        });
      }

      const gitPath = config.git?.gitPath ?? "git";

      const healthResults = await Promise.all(
        projects.map(async (projectConfig) => {
          const projectPath = resolve(rootDir, projectConfig.path);
          const checks = await runProjectChecks(projectPath, gitPath);
          const worktreeCount = await runCli(gitPath, ["worktree", "list", "--porcelain"], { cwd: projectPath })
            .then((result) =>
              result.exitCode === 0
                ? result.stdout.trim().split("\n").filter((line) => line.startsWith("worktree ")).length
                : 0
            )
            .catch(() => 0);

          return {
            repository: projectConfig.repo,
            name: projectConfig.repo,
            path: projectConfig.path,
            status: deriveOverallStatus(checks),
            worktreeCount,
            health: {
              gitRemoteAccess: checks.gitRemoteCheck,
              localPath: checks.localPathCheck,
              diskSpace: checks.diskSpaceCheck,
              dependencies: checks.dependenciesCheck,
            },
            lastChecked: new Date().toISOString(),
          };
        })
      );

      const projectStats = getProjectSummary(store.getAqDb());
      const statsMap = new Map(projectStats.map((s) => [s.repo, s]));

      const repositories = healthResults.map((result) => {
        const stats = statsMap.get(result.repository) ?? {
          repo: result.repository,
          total: 0,
          successCount: 0,
          failureCount: 0,
          totalCostUsd: 0,
          successRate: 0,
          lastActivity: null,
        };

        return {
          ...result,
          stats: {
            totalJobs: stats.total,
            successJobs: stats.successCount,
            failedJobs: stats.failureCount,
            successRate: stats.successRate,
            totalCostUsd: stats.totalCostUsd,
            lastActivity: stats.lastActivity,
          },
        };
      });

      const summary = {
        total: repositories.length,
        healthy: repositories.filter((r) => r.status === "healthy").length,
        warning: repositories.filter((r) => r.status === "warning").length,
        error: repositories.filter((r) => r.status === "error").length,
        totalJobs: repositories.reduce((sum, r) => sum + r.stats.totalJobs, 0),
        checkedAt: new Date().toISOString(),
      };

      return c.json({ repositories, summary });
    } catch (error: unknown) {
      getLogger().error(`Failed to fetch repositories: ${getErrorMessage(error)}`);
      return c.json({ error: "Failed to fetch repositories" }, 500);
    }
  });

  // Projects health — all configured projects
  api.get("/api/projects/health", async (c) => {
    try {
      const config = configWatcher?.current() ?? loadConfig(rootDir);
      const projects = config.projects ?? [];

      if (projects.length === 0) {
        return c.json({
          projects: [],
          summary: { total: 0, healthy: 0, warning: 0, error: 0, checkedAt: new Date().toISOString() },
        });
      }

      const gitPath = config.git?.gitPath ?? "git";

      const healthResults = await Promise.all(
        projects.map(async (projectConfig) => {
          const projectPath = resolve(rootDir, projectConfig.path);
          const checks = await runProjectChecks(projectPath, gitPath);

          return {
            project: projectConfig.repo,
            status: deriveOverallStatus(checks),
            checks: {
              gitRemoteAccess: checks.gitRemoteCheck,
              localPath: checks.localPathCheck,
              diskSpace: checks.diskSpaceCheck,
              dependencies: checks.dependenciesCheck,
            },
            lastChecked: new Date().toISOString(),
          };
        })
      );

      const projectStats = getProjectSummary(store.getAqDb());
      const statsMap = new Map(projectStats.map((s) => [s.repo, s]));

      const projectsWithStats = healthResults.map((result) => ({
        ...result,
        stats: statsMap.get(result.project) ?? null,
      }));

      const summary = {
        total: projectsWithStats.length,
        healthy: projectsWithStats.filter((p) => p.status === "healthy").length,
        warning: projectsWithStats.filter((p) => p.status === "warning").length,
        error: projectsWithStats.filter((p) => p.status === "error").length,
        checkedAt: new Date().toISOString(),
      };

      return c.json({ projects: projectsWithStats, summary });
    } catch (error: unknown) {
      return safeError(c, error, "Projects health check failed");
    }
  });

  // Single project health (with ?project= query param)
  api.get("/api/health", async (c) => {
    try {
      const projectParam = c.req.query("project");
      if (!projectParam) {
        return c.json({ error: "project parameter is required" }, 400);
      }

      const project = decodeURIComponent(projectParam);
      const config = configWatcher?.current() ?? loadConfig(rootDir);
      const projectConfig = config.projects?.find((p) => p.repo === project);

      if (!projectConfig) {
        return c.json({ error: `Project "${project}" not found in configuration` }, 404);
      }

      const projectPath = resolve(rootDir, projectConfig.path);
      const gitPath = config.git?.gitPath || "git";

      const checks = await runProjectChecks(projectPath, gitPath);

      const healthResponse: HealthCheckResponse = {
        project,
        status: deriveOverallStatus(checks),
        checks: {
          gitRemoteAccess: checks.gitRemoteCheck,
          localPath: checks.localPathCheck,
          diskSpace: checks.diskSpaceCheck,
          dependencies: checks.dependenciesCheck,
        },
        lastChecked: new Date().toISOString(),
      };

      return c.json(healthResponse);
    } catch (error: unknown) {
      return safeError(c, error, "Health check failed");
    }
  });
}
