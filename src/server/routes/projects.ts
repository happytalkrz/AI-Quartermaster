import type { Hono } from "hono";
import { normalize } from "path";
import { zValidator } from "@hono/zod-validator";
import type { JobQueue } from "../../queue/job-queue.js";
import type { ConfigWatcher } from "../../config/config-watcher.js";
import type { ProjectConfig } from "../../types/config.js";
import { safeError, type DashboardContext } from "../route-context.js";
import {
  loadConfig,
  addProjectToConfig,
  removeProjectFromConfig,
  updateProjectInConfig,
} from "../../config/loader.js";
import { validateConfig } from "../../config/validator.js";
import { CreateProjectRequestSchema, UpdateProjectRequestSchema } from "../../types/api.js";
import { zodValidationHook } from "../dashboard-api.js";
import { detectProjectCommands, detectBaseBranch } from "../../config/project-detector.js";
import { isPathSafe } from "../../utils/slug.js";
import { getLogger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/error-utils.js";
import { sanitizeErrorMessage } from "../../utils/error-sanitizer.js";

export interface ProjectsRouteContext {
  queue: JobQueue;
  configWatcher?: ConfigWatcher;
  rootDir: string;
  configPath: string;
}

/**
 * /api/projects/* 라우트 등록 (Plan C #C9 — 3단계).
 *
 * 이전: dashboard-api.ts 624-867 (7 routes, ~245줄).
 * 이후: 본 파일이 캡슐화. validateAndNormalizePath 헬퍼는 projects 전용이므로 함께 이동.
 *
 * 비포함: /api/projects/health (1446-) — 인라인 health-check 헬퍼 의존성으로 별도 단계.
 */
function validateAndNormalizePath(path: string, paramName: string): string {
  if (!path || typeof path !== "string") {
    throw new Error(`${paramName} is required and must be a string`);
  }

  const trimmedPath = path.trim();
  if (!isPathSafe(trimmedPath)) {
    throw new Error(`${paramName} contains unsafe characters or path traversal patterns`);
  }
  return normalize(trimmedPath);
}

export function registerProjectsRoutes(api: Hono, ctx: ProjectsRouteContext): void {
  const { queue, configWatcher, rootDir, configPath } = ctx;

  // List projects
  api.get("/api/projects", (c) => {
    try {
      const config = configWatcher?.current() ?? loadConfig(rootDir);

      if (!config.projects || config.projects.length === 0) {
        return c.json({ projects: [] });
      }

      const projects = config.projects.map((project) => ({
        ...project,
        errorState: queue.getProjectStatus(project.repo),
      }));

      return c.json({ projects });
    } catch (error: unknown) {
      getLogger().error(`Failed to load projects: ${getErrorMessage(error)}`);
      return c.json({ error: "Failed to load projects" }, 500);
    }
  });

  // Add project
  api.post(
    "/api/projects",
    zValidator("json", CreateProjectRequestSchema, zodValidationHook),
    async (c) => {
      try {
        const { repo, path, baseBranch, mode, commands } = c.req.valid("json");

        let normalizedPath: string;
        try {
          normalizedPath = validateAndNormalizePath(path, "path");
        } catch (error: unknown) {
          return c.json({ error: sanitizeErrorMessage(getErrorMessage(error)) }, 400);
        }

        const detection = detectProjectCommands(normalizedPath);
        const resolvedBaseBranch = baseBranch?.trim() || (await detectBaseBranch(normalizedPath));

        const project: ProjectConfig = {
          repo: repo.trim(),
          path: normalizedPath,
          baseBranch: resolvedBaseBranch,
          mode,
          commands: commands ?? detection.commands,
        };

        try {
          const currentConfig = configWatcher?.current() ?? loadConfig(rootDir);
          if (currentConfig.projects?.find((p) => p.repo === project.repo)) {
            return c.json({ error: `Project "${project.repo}" already exists` }, 409);
          }
        } catch {
          // Config doesn't exist yet, proceed
        }

        addProjectToConfig(configPath, project);
        configWatcher?.refresh();

        try {
          validateConfig(configWatcher?.current() ?? loadConfig(rootDir));
        } catch (error: unknown) {
          return safeError(c, error, "Configuration validation failed", 400);
        }

        return c.json(
          {
            message: "Project added successfully",
            project,
            detectedLanguage: detection.language,
          },
          201
        );
      } catch (error: unknown) {
        return safeError(c, error, "Failed to add project");
      }
    }
  );

  // Remove project
  api.delete("/api/projects/:repo", (c) => {
    try {
      const repo = decodeURIComponent(c.req.param("repo"));

      if (!repo || repo.trim() === "") {
        return c.json({ error: "repo parameter is required" }, 400);
      }

      try {
        const currentConfig = configWatcher?.current() ?? loadConfig(rootDir);
        if (!currentConfig.projects?.find((p) => p.repo === repo)) {
          return c.json({ error: `Project "${repo}" not found` }, 404);
        }
      } catch (error: unknown) {
        return safeError(c, error, "Failed to load configuration");
      }

      removeProjectFromConfig(configPath, repo);
      configWatcher?.refresh();

      try {
        validateConfig(configWatcher?.current() ?? loadConfig(rootDir));
      } catch (error: unknown) {
        return safeError(c, error, "Configuration validation failed", 400);
      }

      return c.json({ message: "Project removed successfully", repo });
    } catch (error: unknown) {
      return safeError(c, error, "Failed to remove project");
    }
  });

  // Update project
  api.put(
    "/api/projects/:repo",
    zValidator("json", UpdateProjectRequestSchema, zodValidationHook),
    async (c) => {
      try {
        const repo = decodeURIComponent(c.req.param("repo") ?? "");

        if (!repo || repo.trim() === "") {
          return c.json({ error: "repo parameter is required" }, 400);
        }

        try {
          const currentConfig = configWatcher?.current() ?? loadConfig(rootDir);
          if (!currentConfig.projects?.find((p) => p.repo === repo)) {
            return c.json({ error: `Project "${repo}" not found` }, 404);
          }
        } catch (error: unknown) {
          return safeError(c, error, "Failed to load configuration");
        }

        const { path, baseBranch, mode, commands } = c.req.valid("json");
        const updates: Partial<Pick<ProjectConfig, "path" | "baseBranch" | "mode" | "commands">> = {};

        if (path !== undefined) {
          try {
            updates.path = validateAndNormalizePath(path, "path");
          } catch (error: unknown) {
            return c.json({ error: sanitizeErrorMessage(getErrorMessage(error)) }, 400);
          }
        }

        if (baseBranch !== undefined) {
          updates.baseBranch = baseBranch?.trim() || undefined;
        }

        if (mode !== undefined) {
          updates.mode = mode ?? undefined;
        }

        if (commands !== undefined) {
          updates.commands = commands;
        }

        if (Object.keys(updates).length === 0) {
          return c.json({ error: "No valid fields to update" }, 400);
        }

        updateProjectInConfig(configPath, repo, updates);
        configWatcher?.refresh();

        try {
          validateConfig(configWatcher?.current() ?? loadConfig(rootDir));
        } catch (error: unknown) {
          return safeError(c, error, "Configuration validation failed", 400);
        }

        return c.json({ message: "Project updated successfully", repo, updates });
      } catch (error: unknown) {
        return safeError(c, error, "Failed to update project");
      }
    }
  );

  // Get project error state
  api.get("/api/projects/:repo/error-state", (c) => {
    try {
      const repo = decodeURIComponent(c.req.param("repo"));

      if (!repo || repo.trim() === "") {
        return c.json({ error: "repo parameter is required" }, 400);
      }

      const errorState = queue.getProjectStatus(repo);
      return c.json({ repo, errorState });
    } catch (error: unknown) {
      return safeError(c, error, "Failed to get error state");
    }
  });

  // Manually pause a project
  api.post("/api/projects/:repo/pause", async (c) => {
    try {
      const repo = decodeURIComponent(c.req.param("repo"));

      if (!repo || repo.trim() === "") {
        return c.json({ error: "repo parameter is required" }, 400);
      }

      let durationMs: number | undefined;
      try {
        const body = (await c.req.json()) as Record<string, unknown>;
        if (body.durationMs !== undefined) {
          if (typeof body.durationMs !== "number" || body.durationMs <= 0) {
            return c.json({ error: "durationMs must be a positive number" }, 400);
          }
          durationMs = body.durationMs;
        }
      } catch (err: unknown) {
        getLogger().debug(`Optional body parse failed — using default: ${getErrorMessage(err)}`);
      }

      const effectiveDuration = durationMs ?? 30 * 60 * 1000; // 30 minutes
      queue.pauseProject(repo, effectiveDuration);

      return c.json({
        message: `Project "${repo}" paused for ${Math.round(effectiveDuration / 1000)}s`,
        repo,
        pausedUntil: Date.now() + effectiveDuration,
      });
    } catch (error: unknown) {
      return safeError(c, error, "Failed to pause project");
    }
  });

  // Manually resume a paused project
  api.post("/api/projects/:repo/resume", (c) => {
    try {
      const repo = decodeURIComponent(c.req.param("repo"));

      if (!repo || repo.trim() === "") {
        return c.json({ error: "repo parameter is required" }, 400);
      }

      queue.resumeProject(repo);
      return c.json({ message: `Project "${repo}" resumed`, repo });
    } catch (error: unknown) {
      return safeError(c, error, "Failed to resume project");
    }
  });
}

/** Re-export for convenience when callers already build a DashboardContext. */
export type { DashboardContext };
