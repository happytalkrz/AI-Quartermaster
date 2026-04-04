import { exec } from "child_process";
import { promisify } from "util";
import type { HookDefinition } from "../types/hooks.js";
import { getLogger } from "../utils/logger.js";

const execAsync = promisify(exec);
const logger = getLogger();

export interface HookResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  duration: number;
  error?: string;
}

export class HookExecutor {
  private variables: Record<string, string>;
  private readonly defaultTimeout = 30000; // 30 seconds

  constructor(variables: Record<string, string> = {}) {
    this.variables = variables;
  }

  async executeHook(hook: HookDefinition): Promise<HookResult> {
    const startTime = Date.now();
    const substitutedCommand = this.substituteVariables(hook.command);
    const timeout = hook.timeout || this.defaultTimeout;

    logger.debug(`Executing hook: ${substitutedCommand}`);

    try {
      const { stdout, stderr } = await execAsync(substitutedCommand, {
        timeout,
        encoding: "utf8",
      });

      const duration = Date.now() - startTime;
      logger.debug(`Hook completed in ${duration}ms`);

      return {
        success: true,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: 0,
        duration,
      };
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };

      logger.error(`Hook failed: ${err.message}`);

      return {
        success: false,
        stdout: err.stdout || "",
        stderr: err.stderr || "",
        exitCode: typeof err.code === 'number' ? err.code : null,
        duration,
        error: err.message,
      };
    }
  }

  async executeHooks(hooks: HookDefinition[]): Promise<HookResult[]> {
    const results: HookResult[] = [];

    for (const hook of hooks) {
      const result = await this.executeHook(hook);
      results.push(result);
    }

    return results;
  }

  updateVariables(newVariables: Record<string, string>): void {
    this.variables = { ...this.variables, ...newVariables };
  }

  private substituteVariables(command: string): string {
    let substituted = command;

    // Replace {{variable}} patterns
    for (const [key, value] of Object.entries(this.variables)) {
      const pattern = new RegExp(`\\{\\{${this.escapeRegExp(key)}\\}\\}`, 'g');
      substituted = substituted.replace(pattern, value);
    }

    return substituted;
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}