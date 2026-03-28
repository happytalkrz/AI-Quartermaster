import { resolve } from "path";
import { renderTemplate, loadTemplate } from "../prompt/template-renderer.js";
import type { TemplateVariables } from "../prompt/template-renderer.js";
import { runClaude } from "../claude/claude-runner.js";
import { runCli } from "../utils/cli-runner.js";
import { parseNumstat } from "../git/diff-collector.js";
import { getLogger } from "../utils/logger.js";
import type { ClaudeCliConfig } from "../types/config.js";
import type { SimplifyResult } from "../types/review.js";

const logger = getLogger();

export interface SimplifyContext {
  promptTemplate: string;
  promptsDir: string;
  claudeConfig: ClaudeCliConfig;
  cwd: string;
  testCommand: string;
  variables: TemplateVariables;
}

export async function runSimplify(ctx: SimplifyContext): Promise<SimplifyResult> {
  logger.info("Running code simplification...");

  // Run Claude to simplify
  const templatePath = resolve(ctx.promptsDir, ctx.promptTemplate);
  const template = loadTemplate(templatePath);
  const rendered = renderTemplate(template, ctx.variables);

  const result = await runClaude({
    prompt: rendered,
    cwd: ctx.cwd,
    config: ctx.claudeConfig,
  });

  if (!result.success) {
    logger.warn("Simplification Claude call failed, skipping");
    return {
      applied: false,
      linesRemoved: 0,
      linesAdded: 0,
      filesModified: [],
      testsPassed: true,
      rolledBack: false,
      summary: "Claude invocation failed",
    };
  }

  // Check what changed
  const diffResult = await runCli("git", ["diff", "--numstat", "HEAD"], { cwd: ctx.cwd });
  const hasChanges = diffResult.stdout.trim().length > 0;

  if (!hasChanges) {
    logger.info("No simplification changes made");
    return {
      applied: false,
      linesRemoved: 0,
      linesAdded: 0,
      filesModified: [],
      testsPassed: true,
      rolledBack: false,
      summary: "No changes needed",
    };
  }

  // Run tests to verify simplification didn't break anything
  const testResult = await runCli("sh", ["-c", ctx.testCommand], { cwd: ctx.cwd, timeout: 120000 });

  if (testResult.exitCode !== 0) {
    logger.warn("Tests failed after simplification, rolling back");
    await runCli("git", ["checkout", "."], { cwd: ctx.cwd });
    await runCli("git", ["clean", "-fd"], { cwd: ctx.cwd });
    return {
      applied: false,
      linesRemoved: 0,
      linesAdded: 0,
      filesModified: [],
      testsPassed: false,
      rolledBack: true,
      summary: "Simplification rolled back due to test failure",
    };
  }

  // Parse diff stats
  const { insertions: linesAdded, deletions: linesRemoved, files: filesModified } = parseNumstat(diffResult.stdout);

  // Commit simplification
  await runCli("git", ["add", "-A"], { cwd: ctx.cwd });
  await runCli("git", ["commit", "-m", "refactor: code simplification"], { cwd: ctx.cwd });

  logger.info(`Simplification applied: +${linesAdded} -${linesRemoved} in ${filesModified.length} files`);

  return {
    applied: true,
    linesRemoved,
    linesAdded,
    filesModified,
    testsPassed: true,
    rolledBack: false,
    summary: `Simplified ${filesModified.length} files (+${linesAdded} -${linesRemoved})`,
  };
}
