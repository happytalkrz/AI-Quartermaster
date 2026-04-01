import { resolve } from "path";
import { renderTemplate, loadTemplate } from "../prompt/template-renderer.js";
import type { TemplateVariables } from "../prompt/template-renderer.js";
import { runClaude, extractJson } from "../claude/claude-runner.js";
import type { ClaudeCliConfig } from "../types/config.js";
import type { AnalystResult, AnalystFinding } from "../types/review.js";

export interface AnalystContext {
  promptsDir: string;
  claudeConfig: ClaudeCliConfig;
  cwd: string;
  variables: TemplateVariables;
}

const EMPTY_COVERAGE = { implemented: [], missing: [], excess: [] };

function createAnalystResult(
  verdict: "COMPLETE" | "INCOMPLETE" | "MISALIGNED",
  durationMs: number,
  findings: AnalystFinding[] = [],
  summary: string = "",
  coverage = EMPTY_COVERAGE
): AnalystResult {
  return { verdict, findings, summary, coverage, durationMs };
}

function extractVerdictFromText(text: string): "COMPLETE" | "INCOMPLETE" | "MISALIGNED" {
  const lower = text.toLowerCase();
  if (lower.includes('"complete"') || lower.includes("verdict: complete")) return "COMPLETE";
  if (lower.includes('"misaligned"') || lower.includes("verdict: misaligned")) return "MISALIGNED";
  return "INCOMPLETE";
}

export async function runAnalyst(ctx: AnalystContext): Promise<AnalystResult> {
  const startTime = Date.now();
  const durationMs = () => Date.now() - startTime;

  const templatePath = resolve(ctx.promptsDir, "analyst-requirements.md");
  const template = loadTemplate(templatePath);
  const rendered = renderTemplate(template, ctx.variables);

  const result = await runClaude({
    prompt: rendered,
    cwd: ctx.cwd,
    config: ctx.claudeConfig,
    enableAgents: false,
  });

  if (!result.success) {
    return createAnalystResult(
      "INCOMPLETE",
      durationMs(),
      [{
        type: "mismatch",
        requirement: "Claude analysis execution",
        severity: "error",
        message: `Claude invocation failed: ${result.output}`
      }],
      "Analysis failed due to Claude error"
    );
  }

  try {
    const parsed = extractJson<{
      verdict: "COMPLETE" | "INCOMPLETE" | "MISALIGNED";
      findings?: AnalystFinding[];
      summary?: string;
      coverage?: {
        implemented: string[];
        missing: string[];
        excess: string[];
      };
    }>(result.output);

    return createAnalystResult(
      parsed.verdict || "INCOMPLETE",
      durationMs(),
      parsed.findings || [],
      parsed.summary || "",
      parsed.coverage || EMPTY_COVERAGE
    );
  } catch {
    return createAnalystResult(
      extractVerdictFromText(result.output),
      durationMs(),
      [],
      result.output.slice(0, 500)
    );
  }
}