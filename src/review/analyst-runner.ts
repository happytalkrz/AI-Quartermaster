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

export async function runAnalyst(ctx: AnalystContext): Promise<AnalystResult> {
  const startTime = Date.now();

  const templatePath = resolve(ctx.promptsDir, "analyst-requirements.md");
  const template = loadTemplate(templatePath);
  const rendered = renderTemplate(template, ctx.variables);

  const result = await runClaude({
    prompt: rendered,
    cwd: ctx.cwd,
    config: ctx.claudeConfig,
    enableAgents: false, // 직접 분석, 에이전트 위임 없음
  });

  if (!result.success) {
    return {
      verdict: "INCOMPLETE",
      findings: [{
        type: "mismatch",
        requirement: "Claude analysis execution",
        severity: "error",
        message: `Claude invocation failed: ${result.output}`
      }],
      summary: "Analysis failed due to Claude error",
      coverage: { implemented: [], missing: [], excess: [] },
      durationMs: Date.now() - startTime,
    };
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

    return {
      verdict: parsed.verdict || "INCOMPLETE",
      findings: parsed.findings || [],
      summary: parsed.summary || "",
      coverage: parsed.coverage || { implemented: [], missing: [], excess: [] },
      durationMs: Date.now() - startTime,
    };
  } catch {
    // JSON 파싱 실패 시 텍스트에서 판정 추출 시도
    const output = result.output.toLowerCase();
    let verdict: "COMPLETE" | "INCOMPLETE" | "MISALIGNED" = "INCOMPLETE";

    if (output.includes('"complete"') || output.includes("verdict: complete")) {
      verdict = "COMPLETE";
    } else if (output.includes('"misaligned"') || output.includes("verdict: misaligned")) {
      verdict = "MISALIGNED";
    }

    return {
      verdict,
      findings: [],
      summary: result.output.slice(0, 500),
      coverage: { implemented: [], missing: [], excess: [] },
      durationMs: Date.now() - startTime,
    };
  }
}