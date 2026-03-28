import { runShell } from "../utils/cli-runner.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger();

/**
 * Installs project dependencies in the given directory.
 */
export async function installDependencies(
  preInstallCommand: string,
  options: { cwd: string; timeout?: number }
): Promise<void> {
  if (!preInstallCommand) {
    logger.info("No preInstall command configured, skipping dependency installation");
    return;
  }

  logger.info(`Installing dependencies: ${preInstallCommand}`);

  const result = await runShell(preInstallCommand, {
    cwd: options.cwd,
    timeout: options.timeout ?? 120000,
  });

  if (result.exitCode !== 0) {
    throw new Error(`Dependency installation failed:\n${result.stderr}\n${result.stdout}`);
  }

  logger.info("Dependencies installed successfully");
}
