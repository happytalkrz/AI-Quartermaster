import { resolve } from "path";
import { renderTemplate, loadTemplate } from "../prompt/template-renderer.js";
import type { TemplateVariables } from "../prompt/template-renderer.js";
import { runClaude, extractJson } from "../claude/claude-runner.js";
import { getLogger } from "../utils/logger.js";
import type { ClaudeCliConfig } from "../types/config.js";
import type { ReviewVerdict, ReviewFinding, ReviewResult } from "../types/review.js";

const logger = getLogger();

export interface ReviewRunnerContext {
  roundName: string;
  promptTemplate: string;  // filename in prompts dir
  promptsDir: string;
  claudeConfig: ClaudeCliConfig;
  cwd: string;
  variables: TemplateVariables;  // template variables
}

export async function runReviewRound(ctx: ReviewRunnerContext): Promise<ReviewResult> {
  const startTime = Date.now();

  const templatePath = resolve(ctx.promptsDir, ctx.promptTemplate);
  const template = loadTemplate(templatePath);
  const rendered = renderTemplate(template, ctx.variables);

  const result = await runClaude({
    prompt: rendered,
    cwd: ctx.cwd,
    config: ctx.claudeConfig,
    enableAgents: true,
  });

  if (!result.success) {
    return {
      roundName: ctx.roundName,
      verdict: "FAIL",
      findings: [{ severity: "error", message: `Claude invocation failed: ${result.output}` }],
      summary: "Review failed due to Claude error",
      durationMs: Date.now() - startTime,
    };
  }

  try {
    const parsed = extractJson<{
      verdict: ReviewVerdict;
      findings?: ReviewFinding[];
      summary?: string;
    }>(result.output);

    return {
      roundName: ctx.roundName,
      verdict: parsed.verdict || "FAIL",
      findings: parsed.findings || [],
      summary: parsed.summary || "",
      durationMs: Date.now() - startTime,
    };
  } catch {
    // If Claude output isn't parseable JSON, try to determine verdict from text
    const output = result.output.toLowerCase();
    const verdict: ReviewVerdict = output.includes('"pass"') || output.includes("verdict: pass") ? "PASS" : "FAIL";
    return {
      roundName: ctx.roundName,
      verdict,
      findings: [],
      summary: result.output.slice(0, 500),
      durationMs: Date.now() - startTime,
    };
  }
}
