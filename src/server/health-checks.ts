import { resolve } from "path";
import { existsSync, statSync } from "fs";
import { runCli } from "../utils/cli-runner.js";
import { getErrorMessage } from "../utils/error-utils.js";
import { sanitizeErrorMessage } from "../utils/error-sanitizer.js";

/**
 * 프로젝트 헬스 체크 헬퍼 (Plan C #C9 — 9단계 분할 사전 작업).
 *
 * 이전: dashboard-api.ts 138-227 (4 헬퍼, ~95줄)에 인라인. /api/repositories,
 *      /api/projects/health, /api/health 세 곳에서 중복 사용됐다.
 * 이후: 본 모듈이 단일 진입점이 되어 라우트 파일 분할이 가능해진다.
 */

export async function checkGitRemoteAccess(
  projectPath: string,
  gitPath: string
): Promise<{ status: "ok" | "error"; message?: string }> {
  try {
    const result = await runCli(gitPath, ["ls-remote", "--heads", "origin"], { cwd: projectPath, timeout: 10000 });
    if (result.exitCode !== 0) {
      return {
        status: "error",
        message: `Git remote not accessible: ${result.stderr || "Cannot connect to remote"}`,
      };
    }
    return { status: "ok" };
  } catch (error: unknown) {
    return {
      status: "error",
      message: `Git remote check failed: ${sanitizeErrorMessage(getErrorMessage(error))}`,
    };
  }
}

export async function checkLocalPath(
  projectPath: string
): Promise<{ status: "ok" | "error"; message?: string }> {
  try {
    if (!existsSync(projectPath)) {
      return { status: "error", message: "Project path does not exist" };
    }

    const stats = statSync(projectPath);
    if (!stats.isDirectory()) {
      return { status: "error", message: "Project path is not a directory" };
    }

    return { status: "ok" };
  } catch (error: unknown) {
    return {
      status: "error",
      message: `Local path check failed: ${sanitizeErrorMessage(getErrorMessage(error))}`,
    };
  }
}

export async function checkDiskSpace(
  projectPath: string
): Promise<{ status: "ok" | "warning" | "error"; message?: string; freeBytes?: number }> {
  try {
    const result = await runCli("df", ["-B1", projectPath], { timeout: 5000 });
    if (result.exitCode !== 0) {
      return { status: "warning", message: "Could not check disk space" };
    }

    const lines = result.stdout.trim().split("\n");
    if (lines.length < 2) {
      return { status: "warning", message: "Could not parse disk space output" };
    }

    const parts = lines[1].split(/\s+/);
    const available = parseInt(parts[3] || "0", 10);

    if (available === 0) {
      return { status: "error", message: "No free disk space", freeBytes: available };
    } else if (available < 1024 * 1024 * 1024) {
      return { status: "warning", message: "Low disk space (< 1GB)", freeBytes: available };
    }

    return { status: "ok", freeBytes: available };
  } catch (error: unknown) {
    return {
      status: "warning",
      message: `Disk space check failed: ${sanitizeErrorMessage(getErrorMessage(error))}`,
    };
  }
}

export async function checkDependencies(
  projectPath: string
): Promise<{ status: "ok" | "warning" | "error"; message?: string }> {
  try {
    const packageJsonPath = resolve(projectPath, "package.json");
    if (!existsSync(packageJsonPath)) {
      return { status: "warning", message: "No package.json found" };
    }

    const nodeModulesPath = resolve(projectPath, "node_modules");
    if (!existsSync(nodeModulesPath)) {
      return { status: "warning", message: "Dependencies not installed (no node_modules)" };
    }

    return { status: "ok" };
  } catch (error: unknown) {
    return {
      status: "error",
      message: `Dependencies check failed: ${sanitizeErrorMessage(getErrorMessage(error))}`,
    };
  }
}
