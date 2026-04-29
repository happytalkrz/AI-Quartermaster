import type { Hono } from "hono";
import { resolve } from "path";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { safeError } from "../route-context.js";
import { zodValidationHook } from "../dashboard-api.js";
import { loadTemplate, renderTemplate } from "../../prompt/template-renderer.js";
import { runCli } from "../../utils/cli-runner.js";
import { getLogger } from "../../utils/logger.js";
import { sanitizeErrorMessage } from "../../utils/error-sanitizer.js";

export interface NewIssueRouteContext {
  rootDir: string;
}

const NewIssueRequestSchema = z.object({
  category: z.enum(["bug", "feature", "refactor", "docs"]),
  title: z.string().min(1),
  repo: z.string().min(1),
  what: z.string().min(1),
  where: z.string().default(""),
  how: z.string().default(""),
  files: z.string().default(""),
});

/**
 * POST /api/new-issue 라우트 등록 (Plan C #C9 — 10단계).
 *
 * 이전: dashboard-api.ts 621-652. 카테고리별 템플릿(prompts/issue-templates/*.md)을
 *      렌더링한 뒤 `gh issue create`로 GitHub 이슈를 생성한다.
 */
export function registerNewIssueRoute(api: Hono, ctx: NewIssueRouteContext): void {
  const { rootDir } = ctx;

  api.post("/api/new-issue", zValidator("json", NewIssueRequestSchema, zodValidationHook), async (c) => {
    const logger = getLogger();
    try {
      const { category, title, repo, what, where, how, files } = c.req.valid("json");

      const templatesDir = resolve(rootDir, "prompts/issue-templates");
      const templatePath = resolve(templatesDir, `${category}.md`);
      const template = loadTemplate(templatePath, templatesDir);
      const body = renderTemplate(template, { what, where, how, files });

      const result = await runCli("gh", [
        "issue", "create",
        "--repo", repo,
        "--title", title,
        "--body", body,
        "--label", "aqm-by",
      ]);

      if (result.exitCode !== 0) {
        return c.json({ error: `Failed to create issue: ${sanitizeErrorMessage(result.stderr)}` }, 500);
      }

      const url = result.stdout.trim();
      const numberMatch = url.match(/\/issues\/(\d+)$/);
      const number = numberMatch ? parseInt(numberMatch[1], 10) : undefined;

      logger.info(`New issue created: ${url}`);
      return c.json({ url, number });
    } catch (error: unknown) {
      return safeError(c, error, "Failed to create issue");
    }
  });
}
