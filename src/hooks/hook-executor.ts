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
    // Shell injection 방지: 변수 값을 환경변수로 분리하고 명령에는 참조만 삽입
    const { command: substitutedCommand, env: hookEnv } = this.substituteVariables(hook.command);
    const timeout = hook.timeout || this.defaultTimeout;

    logger.debug(`Executing hook: ${substitutedCommand}`);

    try {
      const { stdout, stderr } = await execAsync(substitutedCommand, {
        timeout,
        encoding: "utf8",
        env: { ...process.env, ...hookEnv },
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

  /**
   * {{varName}} 패턴을 환경변수 참조로 대체하고, 실제 값은 환경변수로 분리한다.
   * 이를 통해 변수 값에 포함된 셸 메타문자(; | & $ ` 등)가 셸에 의해 해석되지 않는다.
   * 예: {{issue_title}} → "$HOOK_ISSUE_TITLE" (env: HOOK_ISSUE_TITLE=<actual value>)
   */
  private substituteVariables(command: string): { command: string; env: Record<string, string> } {
    let substituted = command;
    const hookEnv: Record<string, string> = {};

    for (const [key, value] of Object.entries(this.variables)) {
      const envVarName = this.toEnvVarName(key);
      const pattern = new RegExp(`\\{\\{${this.escapeRegExp(key)}\\}\\}`, 'g');
      substituted = substituted.replace(pattern, `"$${envVarName}"`);
      hookEnv[envVarName] = value;
    }

    return { command: substituted, env: hookEnv };
  }

  /** 변수 키를 안전한 환경변수 이름으로 변환: foo.bar → HOOK_FOO_BAR */
  private toEnvVarName(key: string): string {
    return "HOOK_" + key.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}