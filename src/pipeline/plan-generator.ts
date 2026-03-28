import { resolve } from "path";
import { renderTemplate, loadTemplate } from "../prompt/template-renderer.js";
import { runClaude, extractJson } from "../claude/claude-runner.js";
import { configForTask } from "../claude/model-router.js";
import type { ClaudeCliConfig } from "../types/config.js";
import type { GitHubIssue } from "../github/issue-fetcher.js";
import type { Plan } from "../types/pipeline.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger();

export interface PlanGeneratorContext {
  issue: GitHubIssue;
  repo: { owner: string; name: string };
  branch: { base: string; work: string };
  repoStructure: string;
  claudeConfig: ClaudeCliConfig;
  promptsDir: string;
  cwd: string;
  modeHint?: string;
  maxPhases?: number;
  sensitivePaths?: string;
}

export async function generatePlan(ctx: PlanGeneratorContext): Promise<Plan> {
  const templatePath = resolve(ctx.promptsDir, "plan-generation.md");
  const template = loadTemplate(templatePath);

  const sanitizedBody = `<USER_INPUT>\n${ctx.issue.body}\n</USER_INPUT>`;

  const rendered = renderTemplate(template, {
    issue: {
      number: String(ctx.issue.number),
      title: ctx.issue.title,
      body: sanitizedBody,
      labels: ctx.issue.labels,
    },
    repo: {
      owner: ctx.repo.owner,
      name: ctx.repo.name,
      structure: ctx.repoStructure,
    },
    branch: ctx.branch,
    config: {
      maxPhases: String(ctx.maxPhases ?? 10),
      sensitivePaths: ctx.sensitivePaths ?? "",
    },
  });

  let finalPrompt = rendered;
  if (ctx.modeHint) {
    finalPrompt += `\n\n## 추가 지시\n\n${ctx.modeHint}`;
  }

  const planSchema = JSON.stringify({
    type: "object",
    properties: {
      mode: { type: "string", enum: ["code", "content"], description: "code: 코딩/구현 작업, content: 문서/블로그/설정 등 비코딩 작업" },
      issueNumber: { type: "number" },
      title: { type: "string" },
      problemDefinition: { type: "string" },
      requirements: { type: "array", items: { type: "string" } },
      affectedFiles: { type: "array", items: { type: "string" } },
      risks: { type: "array", items: { type: "string" } },
      phases: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "number" },
            name: { type: "string" },
            description: { type: "string" },
            targetFiles: { type: "array", items: { type: "string" } },
            commitStrategy: { type: "string" },
            verificationCriteria: { type: "array", items: { type: "string" } },
          },
          required: ["name", "description"],
        },
      },
      verificationPoints: { type: "array", items: { type: "string" } },
      stopConditions: { type: "array", items: { type: "string" } },
    },
    required: ["mode", "issueNumber", "title", "problemDefinition", "phases"],
  });

  const maxRetries = 2;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    logger.info(`Sending plan generation prompt (${finalPrompt.length} chars)${attempt > 1 ? ` [retry ${attempt}/${maxRetries}]` : ""}`);

    const result = await runClaude({
      prompt: finalPrompt,
      cwd: ctx.cwd,
      config: configForTask(ctx.claudeConfig, "plan"),
      jsonSchema: planSchema,
    });

    if (!result.success) {
      if (attempt < maxRetries) {
        logger.warn(`Plan generation Claude call failed (attempt ${attempt}), retrying...`);
        continue;
      }
      throw new Error(`Plan generation failed after ${maxRetries} attempts: ${result.output.slice(0, 200)}`);
    }

    try {
      const plan = extractJson<Plan>(result.output);
      validatePlan(plan);
      return plan;
    } catch (parseError) {
      if (attempt < maxRetries) {
        logger.warn(`Plan JSON parsing failed (attempt ${attempt}), retrying... Output preview: ${result.output.slice(0, 100)}`);
        continue;
      }
      throw new Error(`Plan generation failed: JSON 파싱 실패 (${maxRetries}회 시도). Claude 응답: ${result.output.slice(0, 300)}`);
    }
  }

  throw new Error("Plan generation failed: unexpected exit");
}

function validatePlan(plan: Plan): void {
  if (!plan.phases || plan.phases.length === 0) {
    throw new Error("Plan must have at least one phase");
  }
  if (!plan.problemDefinition) {
    throw new Error("Plan must have a problem definition");
  }
  if (!plan.requirements || plan.requirements.length === 0) {
    throw new Error("Plan must have requirements");
  }
  // Ensure phases have indices and required array fields
  plan.phases.forEach((phase, i) => {
    phase.index = i;
    phase.targetFiles = phase.targetFiles ?? [];
    phase.verificationCriteria = phase.verificationCriteria ?? [];
  });
}
