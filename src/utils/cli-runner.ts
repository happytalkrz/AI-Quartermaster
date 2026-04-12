import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { RateLimitTracker, withRateLimit } from "./rate-limiter.js";
import { RetryConfig } from "../types/config.js";
import { getLogger } from "./logger.js";

const execFileAsync = promisify(execFile);
const logger = getLogger();

// GitHub API rate limit 트래커 (싱글톤)
const githubRateLimiter = new RateLimitTracker();

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

/**
 * sh -c로 명령 문자열을 실행한다.
 * 보안 감사 결과: 현재 모든 호출처(final-validator, phase-executor, phase-retry,
 * dependency-installer, simplify-runner)는 프로젝트 설정(config)에서 온 명령만 전달하며
 * GitHub 이슈 본문·제목 등 외부 사용자 입력이 이 함수로 흘러오지 않음을 확인.
 * 주의: 외부 입력을 command에 포함하면 셸 주입이 발생하므로 절대 금지.
 */
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

/**
 * GitHub CLI 실행 (rate limiting + 재시도 포함)
 */
export async function runGhCommand(
  ghPath: string,
  args: string[],
  options: CliRunOptions = {},
  retryConfig?: RetryConfig
): Promise<CliRunResult> {
  const finalRetryConfig: RetryConfig = retryConfig ?? {
    maxRetries: 3,
    initialDelayMs: 2000,
    maxDelayMs: 30000,
    jitterFactor: 0.1,
  };

  return withRateLimit(
    async () => {
      // gh CLI에 --include-headers 옵션 추가하여 HTTP 헤더 포함
      const enhancedArgs = shouldIncludeHeaders(args) ? [...args, "--include-headers"] : args;

      const result = await runCli(ghPath, enhancedArgs, options);

      // rate limit 헤더 파싱 및 업데이트
      if (result.exitCode === 0 || result.exitCode === 429) {
        parseRateLimitHeaders(result);
      }

      // 429 응답 처리
      if (result.exitCode === 429 || isRateLimitError(result)) {
        const error = new Error("GitHub API rate limit exceeded");
        (error as Error & { status: number }).status = 429;
        throw error;
      }

      return result;
    },
    githubRateLimiter,
    finalRetryConfig,
    `gh ${args[0] || "command"}`
  );
}

/**
 * gh API 호출에 --include-headers가 필요한지 판단
 */
function shouldIncludeHeaders(args: string[]): boolean {
  // gh api 명령어에만 --include-headers 추가
  return args[0] === "api" && !args.includes("--include-headers");
}

/**
 * GitHub API 응답에서 rate limit 헤더 파싱
 */
function parseRateLimitHeaders(result: CliRunResult): void {
  const fullOutput = result.stdout + result.stderr;
  const lines = fullOutput.split(/\r?\n/);

  const headers: Record<string, string> = {};
  let inHeaderSection = false;

  for (const line of lines) {
    if (line.startsWith("HTTP/")) {
      inHeaderSection = true;
      continue;
    }
    if (inHeaderSection && line === "") break; // End of headers
    if (inHeaderSection) {
      const colonIdx = line.indexOf(":");
      if (colonIdx !== -1) {
        const key = line.slice(0, colonIdx).toLowerCase();
        const value = line.slice(colonIdx + 1).trim();
        headers[key] = value;
      }
    }
  }

  if (Object.keys(headers).length > 0) {
    logger.debug(`Parsed GitHub headers: ${Object.keys(headers).join(", ")}`);
    githubRateLimiter.updateFromHeaders(headers);
  }
}

/**
 * Rate limit 관련 에러인지 판단
 */
function isRateLimitError(result: CliRunResult): boolean {
  const output = (result.stdout + result.stderr).toLowerCase();
  return output.includes("rate limit") ||
         output.includes("too many requests") ||
         output.includes("api rate limit exceeded");
}
