import { resolve } from "path";
import { runCli } from "../../utils/cli-runner.js";
import { runClaude, extractJson } from "../../claude/claude-runner.js";
import { configForTask } from "../../claude/model-router.js";
import { loadTemplate, renderTemplate } from "../../prompt/template-renderer.js";
import type { ClaudeCliConfig } from "../../types/config.js";

export interface IssuePlan {
  issueNumber: number;
  title: string;
  priority: "high" | "medium" | "low";
  dependencies: number[];
  estimatedPhases: number;
  group?: string;
}

export interface ExecutionPlan {
  repo: string;
  totalIssues: number;
  executionOrder: IssuePlan[][];
  estimatedDuration: string;
}

interface RawIssue {
  number: number;
  title: string;
  body: string;
  labels: Array<{ name: string } | string>;
}

export interface FetchedIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

export async function listTriggerIssues(
  repo: string,
  labels: string[],
  ghPath: string
): Promise<FetchedIssue[]> {
  const labelArgs = labels.flatMap((l) => ["--label", l]);
  const result = await runCli(ghPath, [
    "issue",
    "list",
    "--repo",
    repo,
    ...labelArgs,
    "--state",
    "open",
    "--json",
    "number,title,body,labels",
    "--limit",
    "50",
  ]);

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to list issues for ${repo}: ${result.stderr || result.stdout}`
    );
  }

  let parsed: RawIssue[];
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Failed to parse gh issue list output: ${result.stdout}`);
  }

  return parsed.map((issue) => ({
    number: issue.number,
    title: issue.title,
    body: issue.body ?? "",
    labels: issue.labels.map((l) => (typeof l === "string" ? l : l.name)),
  }));
}

export async function generateExecutionPlan(
  issues: FetchedIssue[],
  claudeConfig: ClaudeCliConfig,
  cwd: string,
  aqRoot: string
): Promise<ExecutionPlan> {
  const promptTemplatePath = resolve(aqRoot, "prompts/issue-orchestration.md");
  const promptTemplate = loadTemplate(promptTemplatePath);

  const issuesSummary = issues
    .map(
      (issue) =>
        `- #${issue.number}: ${issue.title}\n  Body: ${issue.body.slice(0, 200)}${issue.body.length > 200 ? "..." : ""}\n  Labels: ${issue.labels.join(", ")}`
    )
    .join("\n\n");

  const prompt = renderTemplate(promptTemplate, { issues: issuesSummary });

  const claudeResult = await runClaude({
    prompt,
    cwd,
    config: configForTask(claudeConfig, "plan"),
  });

  if (!claudeResult.success) {
    throw new Error(`Claude failed to generate execution plan: ${claudeResult.output}`);
  }

  interface RawPlan {
    totalIssues: number;
    estimatedDuration: string;
    executionOrder: IssuePlan[][];
  }

  const rawPlan = extractJson<RawPlan>(claudeResult.output);

  return {
    repo: "",
    totalIssues: rawPlan.totalIssues,
    executionOrder: rawPlan.executionOrder,
    estimatedDuration: rawPlan.estimatedDuration,
  };
}

export function printExecutionPlan(plan: ExecutionPlan): void {
  console.log(`\n실행 계획 — ${plan.repo}`);
  console.log(`총 이슈: ${plan.totalIssues}  예상 기간: ${plan.estimatedDuration}\n`);

  const priorityIcon: Record<string, string> = {
    high: "🔴",
    medium: "🟡",
    low: "🟢",
  };

  plan.executionOrder.forEach((batch, batchIndex) => {
    console.log(`── 배치 ${batchIndex + 1} (${batch.length}개 병렬 실행 가능) ──`);
    const colNum = "이슈".padEnd(6);
    const colTitle = "제목".padEnd(40);
    const colPrio = "우선순위".padEnd(10);
    const colDeps = "의존성".padEnd(16);
    const colPhases = "단계";
    console.log(`  ${colNum} ${colTitle} ${colPrio} ${colDeps} ${colPhases}`);
    console.log(`  ${"─".repeat(85)}`);

    for (const issue of batch) {
      const num = `#${issue.issueNumber}`.padEnd(6);
      const title = issue.title.slice(0, 39).padEnd(40);
      const prio = `${priorityIcon[issue.priority] ?? ""} ${issue.priority}`.padEnd(10);
      const deps =
        issue.dependencies.length > 0
          ? issue.dependencies.map((d) => `#${d}`).join(", ").padEnd(16)
          : "-".padEnd(16);
      const phases = String(issue.estimatedPhases ?? "-");
      console.log(`  ${num} ${title} ${prio} ${deps} ${phases}`);
    }
    console.log();
  });
}
