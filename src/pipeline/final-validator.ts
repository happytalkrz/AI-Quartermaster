import { runCli } from "../utils/cli-runner.js";
import { getLogger } from "../utils/logger.js";
import type { CommandsConfig } from "../types/config.js";

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
  const result = await runCli("sh", ["-c", command], { cwd: options.cwd, timeout });
  return {
    name,
    passed: result.exitCode === 0,
    output: result.exitCode !== 0 ? `${result.stdout}\n${result.stderr}`.trim() : undefined,
  };
}

export async function runFinalValidation(
  commands: CommandsConfig,
  options: { cwd: string },
  gitPath?: string
): Promise<ValidationResult> {
  const git = gitPath ?? "git";
  logger.info("Running final validation...");
  const checks: ValidationCheck[] = [];

  // Run test and typecheck in parallel
  const [testCheck, typecheckCheck] = await Promise.all([
    commands.test ? runCheck("test", commands.test, options, 300000) : null,
    commands.typecheck ? runCheck("typecheck", commands.typecheck, options, 60000) : null,
  ]);
  if (testCheck) checks.push(testCheck);
  if (typecheckCheck) checks.push(typecheckCheck);

  // Run lint sequentially (has autofix retry)
  if (commands.lint) {
    let lintResult = await runCli("sh", ["-c", commands.lint], { cwd: options.cwd, timeout: 60000 });
    if (lintResult.exitCode !== 0) {
      // Try autofix
      logger.info("  Lint failed, attempting autofix...");
      await runCli("sh", ["-c", `${commands.lint} --fix`], { cwd: options.cwd, timeout: 60000 });
      // Commit fixes if any
      const status = await runCli(git, ["status", "--porcelain"], { cwd: options.cwd });
      if (status.stdout.trim()) {
        await runCli(git, ["add", "-A"], { cwd: options.cwd });
        await runCli(git, ["commit", "-m", "style: lint autofix"], { cwd: options.cwd });
      }
      // Re-check
      lintResult = await runCli("sh", ["-c", commands.lint], { cwd: options.cwd, timeout: 60000 });
    }
    checks.push({
      name: "lint",
      passed: lintResult.exitCode === 0,
      output: lintResult.exitCode !== 0 ? `${lintResult.stdout}\n${lintResult.stderr}`.trim() : undefined,
    });
  }

  // Run build sequentially
  if (commands.build) {
    const buildResult = await runCli("sh", ["-c", commands.build], { cwd: options.cwd, timeout: 120000 });
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
