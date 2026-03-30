import { execFile, spawn } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface CliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CliRunOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
  stdin?: string;
}

export async function runShell(command: string, options: CliRunOptions = {}): Promise<CliRunResult> {
  return runCli("sh", ["-c", command], options);
}

export async function runCli(
  command: string,
  args: string[],
  options: CliRunOptions = {}
): Promise<CliRunResult> {
  // Use spawn when stdin is needed (execFile doesn't support stdin)
  if (options.stdin !== undefined) {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
      child.on("close", (code) => {
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });
      child.on("error", (err) => {
        resolve({ stdout, stderr: err.message, exitCode: 1 });
      });
      child.stdin?.write(options.stdin);
      child.stdin?.end();
      if (options.timeout) {
        setTimeout(() => { child.kill(); }, options.timeout);
      }
    });
  }

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd,
      timeout: options.timeout,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    });
    return {
      stdout: stdout ?? "",
      stderr: stderr ?? "",
      exitCode: 0,
    };
  } catch (err: unknown) {
    const error = err as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    return {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      exitCode: typeof error.code === "number" ? error.code : 1,
    };
  }
}
