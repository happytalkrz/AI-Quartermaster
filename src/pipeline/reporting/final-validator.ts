import { runShell } from "../../utils/cli-runner.js";
import { getLogger } from "../../utils/logger.js";
import type { CommandsConfig, ExecutionMode } from "../../types/config.js";
import { autoCommitIfDirty } from "../../git/commit-helper.js";

const logger = getLogger();

export interface ValidationResult {
  success: boolean;
  checks: ValidationCheck[];
}

export interface ValidationCheck {
  name: string;
  passed: boolean;
  output?: string;
}

async function runCheck(name: string, command: string, options: { cwd: string }, timeout = 300000): Promise<ValidationCheck> {
  const result = await runShell(command, { cwd: options.cwd, timeout });
  return {
    name,
    passed: result.exitCode === 0,
    output: result.exitCode !== 0 ? `${result.stdout}\n${result.stderr}`.trim() : undefined,
  };
}

export async function runFinalValidation(
  commands: CommandsConfig,
  options: { cwd: string },
  executionMode: ExecutionMode = "standard",
  gitPath?: string
): Promise<ValidationResult> {
  const git = gitPath ?? "git";
  logger.info(`Running final validation (${executionMode} mode)...`);
  const checks: ValidationCheck[] = [];

  const isComprehensive = executionMode === "standard" || executionMode === "thorough";

  // Run test and typecheck in parallel if needed
  const parallelChecks = await Promise.all([
    isComprehensive && commands.test ? runCheck("test", commands.test, options, 300000) : null,
    isComprehensive && commands.typecheck ? runCheck("typecheck", commands.typecheck, options, 60000) : null,
  ]);

  if (parallelChecks[0]) checks.push(parallelChecks[0]);
  if (parallelChecks[1]) checks.push(parallelChecks[1]);

  // Run lint sequentially (has autofix retry) only for thorough mode
  if (executionMode === "thorough" && commands.lint) {
    let lintResult = await runShell(commands.lint, { cwd: options.cwd, timeout: 60000 });
    if (lintResult.exitCode !== 0) {
      // Try autofix
      logger.info("  Lint failed, attempting autofix...");
      await runShell(`${commands.lint} --fix`, { cwd: options.cwd, timeout: 60000 });
      // Commit fixes if any
      await autoCommitIfDirty(git, options.cwd, "style: lint autofix");
      // Re-check
      lintResult = await runShell(commands.lint, { cwd: options.cwd, timeout: 60000 });
    }
    checks.push({
      name: "lint",
      passed: lintResult.exitCode === 0,
      output: lintResult.exitCode !== 0 ? `${lintResult.stdout}\n${lintResult.stderr}`.trim() : undefined,
    });
  }

  // Run build sequentially - all modes include build
  if (commands.build) {
    const buildResult = await runShell(commands.build, { cwd: options.cwd, timeout: 120000 });
    checks.push({
      name: "build",
      passed: buildResult.exitCode === 0,
      output: buildResult.exitCode !== 0 ? `${buildResult.stdout}\n${buildResult.stderr}`.trim() : undefined,
    });
  }

  const success = checks.every(c => c.passed);

  for (const check of checks) {
    const status = check.passed ? "PASS" : "FAIL";
    logger.info(`  ${status} ${check.name}`);
  }

  return { success, checks };
}
