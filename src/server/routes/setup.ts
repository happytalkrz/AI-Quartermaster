import type { Hono } from "hono";
import { resolve, join } from "path";
import { homedir } from "os";
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "fs";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { safeError } from "../route-context.js";
import { zodValidationHook } from "../dashboard-api.js";

export interface SetupRouteContext {
  rootDir: string;
}

const SetupPreviewBodySchema = z.object({
  repo: z.string().min(1),
  repoPath: z.string().min(1),
  baseBranch: z.string().optional(),
  mode: z.string().optional(),
  token: z.string().optional(),
});

const SetupLabelsBodySchema = z.object({
  repo: z.string().min(1),
  token: z.string().min(1),
  labels: z.array(z.string().min(1)).default(["aqm-by"]),
});

const GH_HEADERS_BASE = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "AI-Quartermaster",
} as const;

function generateSetupYaml(repo: string, repoPath: string, baseBranch?: string, mode?: string): string {
  const projectLines = [
    `  - repo: "${repo}"`,
    `    path: "${repoPath}"`,
  ];
  if (baseBranch) projectLines.push(`    baseBranch: "${baseBranch}"`);
  if (mode) projectLines.push(`    mode: "${mode}"`);
  return `# AI Quartermaster 설정 파일\n# 전체 옵션은 docs/config-schema.md 참조\n\nprojects:\n${projectLines.join("\n")}\n`;
}

function computeYamlDiff(
  existingYaml: string | null,
  newYaml: string
): { added: string[]; removed: string[]; unchanged: string[] } {
  const newLines = newYaml.split("\n").filter((l) => l.trim());
  if (!existingYaml) {
    return { added: newLines, removed: [], unchanged: [] };
  }
  const existingLines = existingYaml.split("\n").filter((l) => l.trim());
  const existingSet = new Set(existingLines);
  const newSet = new Set(newLines);
  return {
    added: newLines.filter((l) => !existingSet.has(l)),
    removed: existingLines.filter((l) => !newSet.has(l)),
    unchanged: newLines.filter((l) => existingSet.has(l)),
  };
}

/**
 * /api/setup/* 라우트 등록 (Plan C #C9 — 7단계).
 *
 * 이전: dashboard-api.ts 927-1095 (5 routes, ~170줄) + 인라인 스키마/헬퍼.
 * 셋업 위자드 흐름: validate-token → repos 목록 → labels 자동 생성 → preview → apply.
 */
export function registerSetupRoutes(api: Hono, ctx: SetupRouteContext): void {
  const { rootDir } = ctx;

  // Validate GitHub personal access token
  api.get("/api/setup/validate-token", async (c) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Authorization header with Bearer token is required" }, 400);
    }

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
      return c.json({ error: "Token must not be empty" }, 400);
    }

    try {
      const response = await fetch("https://api.github.com/user", {
        headers: { ...GH_HEADERS_BASE, Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        if (response.status === 401) {
          return c.json({ error: "Invalid GitHub token" }, 401);
        }
        return c.json({ error: `GitHub API error: ${response.status}` }, 502);
      }

      const data = (await response.json()) as Record<string, unknown>;
      const username = typeof data.login === "string" ? data.login : null;
      const avatarUrl = typeof data.avatar_url === "string" ? data.avatar_url : null;
      const publicRepos = typeof data.public_repos === "number" ? data.public_repos : null;

      return c.json({ username, avatar_url: avatarUrl, public_repos: publicRepos });
    } catch (error: unknown) {
      return safeError(c, error, "Token validation failed");
    }
  });

  // Fetch authenticated user's GitHub repos
  api.get("/api/setup/repos", async (c) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Authorization header with Bearer token is required" }, 400);
    }
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
      return c.json({ error: "Token must not be empty" }, 400);
    }

    try {
      const response = await fetch(
        "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator",
        { headers: { ...GH_HEADERS_BASE, Authorization: `Bearer ${token}` } }
      );

      if (!response.ok) {
        if (response.status === 401) {
          return c.json({ error: "Invalid GitHub token" }, 401);
        }
        return c.json({ error: `GitHub API error: ${response.status}` }, 502);
      }

      const data = (await response.json()) as Array<Record<string, unknown>>;
      const repos = data
        .filter((r) => typeof r.full_name === "string")
        .map((r) => ({
          full_name: r.full_name as string,
          private: Boolean(r.private),
          description: typeof r.description === "string" ? r.description : null,
        }));
      return c.json({ repos });
    } catch (error: unknown) {
      return safeError(c, error, "Failed to fetch repos");
    }
  });

  // Auto-create AQM labels in the target repository
  api.post(
    "/api/setup/labels",
    zValidator("json", SetupLabelsBodySchema, zodValidationHook),
    async (c) => {
      const { repo, token, labels } = c.req.valid("json");

      const ghHeaders: Record<string, string> = {
        ...GH_HEADERS_BASE,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };

      const results: Array<{ label: string; status: "created" | "skipped" | "failed" }> = [];

      for (const label of labels) {
        try {
          const checkResp = await fetch(
            `https://api.github.com/repos/${repo}/labels/${encodeURIComponent(label)}`,
            { headers: ghHeaders }
          );

          if (checkResp.status === 200) {
            results.push({ label, status: "skipped" });
            continue;
          }

          if (checkResp.status !== 404) {
            results.push({ label, status: "failed" });
            continue;
          }

          // Label doesn't exist — create it
          const createResp = await fetch(`https://api.github.com/repos/${repo}/labels`, {
            method: "POST",
            headers: ghHeaders,
            body: JSON.stringify({ name: label, color: "0075ca", description: "AI Quartermaster task" }),
          });
          results.push({ label, status: createResp.ok ? "created" : "failed" });
        } catch {
          results.push({ label, status: "failed" });
        }
      }

      return c.json({ results });
    }
  );

  // Preview YAML diff before applying
  api.post(
    "/api/setup/preview",
    zValidator("json", SetupPreviewBodySchema, zodValidationHook),
    async (c) => {
      try {
        const { repo, repoPath, baseBranch, mode } = c.req.valid("json");
        const configPath = resolve(rootDir, "config.yml");
        const newYaml = generateSetupYaml(repo, repoPath, baseBranch, mode);
        const existingYaml = existsSync(configPath) ? readFileSync(configPath, "utf-8") : null;
        const diff = computeYamlDiff(existingYaml, newYaml);
        return c.json({ yaml: newYaml, existingYaml, diff });
      } catch (error: unknown) {
        return safeError(c, error, "Preview failed");
      }
    }
  );

  // Apply config.yml with backup
  api.post(
    "/api/setup/apply",
    zValidator("json", SetupPreviewBodySchema, zodValidationHook),
    async (c) => {
      try {
        const { repo, repoPath, baseBranch, mode, token } = c.req.valid("json");
        const configPath = resolve(rootDir, "config.yml");
        let backupPath: string | null = null;
        if (existsSync(configPath)) {
          // 타임스탬프 접미사로 이전 백업 보존 (여러 번 apply 해도 직전 상태로 롤백 가능)
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          backupPath = `${configPath}.bak.${timestamp}`;
          copyFileSync(configPath, backupPath);
        }
        const newYaml = generateSetupYaml(repo, repoPath, baseBranch, mode);
        writeFileSync(configPath, newYaml, "utf-8");
        if (token) {
          const credentialsDir = join(homedir(), ".aqm");
          mkdirSync(credentialsDir, { recursive: true });
          writeFileSync(join(credentialsDir, "credentials"), `GITHUB_TOKEN=${token}\n`, { mode: 0o600 });
        }
        return c.json({ success: true, configPath, backupPath });
      } catch (error: unknown) {
        return safeError(c, error, "Apply failed");
      }
    }
  );
}
