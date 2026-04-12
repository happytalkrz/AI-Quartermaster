import { spawn, ChildProcess } from "child_process";
import type { ClaudeCliConfig } from "../types/config.js";
import { withRetry } from "../utils/rate-limiter.js";
import { classifyError } from "../pipeline/error-classifier.js";
import { calculateCostFromUsage } from "./token-pricing.js";

const activeProcesses: Map<number, { process: ChildProcess; lastActivity: number }> = new Map();

export function isClaudeProcessAlive(): boolean {
  return activeProcesses.size > 0;
}

/** Returns ms since last stderr output from any Claude process, or -1 if no process */
export function getLastActivityMs(): number {
  if (activeProcesses.size === 0) return -1;
  let latest = 0;
  for (const entry of activeProcesses.values()) {
    if (entry.lastActivity > latest) latest = entry.lastActivity;
  }
  return Date.now() - latest;
}

export function getActiveProcessPids(): number[] {
  return Array.from(activeProcesses.keys());
}

import type { UsageInfo } from "../types/pipeline.js";

export interface ClaudeRunResult {
  success: boolean;
  output: string;
  costUsd?: number;
  durationMs: number;
  usage?: UsageInfo;
}

export interface ClaudeRunOptions {
  prompt: string;
  cwd?: string;
  config: ClaudeCliConfig;
  systemPrompt?: string;
  jsonSchema?: string;  // JSON Schema string to force structured output
  onStderr?: (line: string) => void;  // callback for each stderr line (e.g. HEARTBEAT parsing)
  maxTurns?: number;  // Override maxTurns for this specific run
  enableAgents?: boolean;  // enable Agent tools for specialized task delegation
  disallowedTools?: string[];  // Tools to block (e.g. ["Read", "Glob", "Grep", "Bash"])
}

/** Claude CLI spawn에 전달할 환경변수 화이트리스트. 민감 정보(GITHUB_TOKEN 등) 노출 방지. */
function buildClaudeEnv(): NodeJS.ProcessEnv {
  const ALLOWED_KEYS = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "NODE_ENV",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "ANTHROPIC_API_KEY",
    "CLAUDE_API_KEY",
  ];

  const env: NodeJS.ProcessEnv = {};
  for (const key of ALLOWED_KEYS) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  return env;
}

async function _runClaudeInternal(options: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const { prompt, cwd, config, systemPrompt, maxTurns, enableAgents } = options;

  // When jsonSchema is set, use direct -p arg with --max-turns 1 (no file editing needed)
  // Otherwise use stdin pipe for long prompts
  const useStdin = !options.jsonSchema;

  // Determine maxTurns: options.maxTurns overrides default logic
  const effectiveMaxTurns = maxTurns ?? (options.jsonSchema ? 50 : config.maxTurns);

  // Add agent context if enableAgents is true
  const agentPrefix = enableAgents ? `You have access to specialized agents via the Agent tool that can help with various tasks. Consider using agents for complex work like multi-file changes, analysis, debugging, or planning. Available agent types include executor, planner, debugger, architect, and others.

` : '';
  const effectivePrompt = agentPrefix + prompt;

  const args: string[] = [
    "-p", useStdin ? "-" : effectivePrompt,
    "--model", config.model,
    "--max-turns", String(effectiveMaxTurns),
    "--output-format", "stream-json", "--verbose",
    "--permission-mode", "bypassPermissions",
    ...config.additionalArgs,
  ];

  if (systemPrompt) {
    args.push("--system-prompt", systemPrompt);
  }
  if (options.jsonSchema) {
    args.push("--json-schema", options.jsonSchema);
  }
  if (options.disallowedTools && options.disallowedTools.length > 0) {
    args.push("--disallowedTools", options.disallowedTools.join(","));
  }

  const startTime = Date.now();

  const result = await new Promise<{ stdout: string; stderr: string; exitCode: number; costUsd?: number; usage?: UsageInfo }>((resolve, reject) => {
    const child = spawn(config.path, args, {
      cwd,
      env: buildClaudeEnv(),
      stdio: [useStdin ? "pipe" : "ignore", "pipe", "pipe"],
    });

    if (child.pid !== undefined) {
      activeProcesses.set(child.pid, { process: child, lastActivity: Date.now() });
    }

    let stderr = "";
    let streamBuffer = "";
    let finalResult: { output: string; costUsd?: number; usage?: UsageInfo; isError: boolean } | undefined;
    let detectedRetryableError: string | undefined;

    child.stdout?.on("data", (data: Buffer) => {
      streamBuffer += data.toString();
      if (child.pid !== undefined) {
        const entry = activeProcesses.get(child.pid);
        if (entry) entry.lastActivity = Date.now();
      }

      // Process complete lines
      let newlineIdx;
      while ((newlineIdx = streamBuffer.indexOf("\n")) !== -1) {
        const line = streamBuffer.slice(0, newlineIdx).trim();
        streamBuffer = streamBuffer.slice(newlineIdx + 1);
        if (!line) continue;

        try {
          const event = JSON.parse(line) as {
            type?: string;
            subtype?: string;
            message?: { content?: Array<{ type: string; text?: string }> };
            result?: string;
            total_cost_usd?: number;
            usage?: {
              input_tokens: number;
              output_tokens: number;
              cache_creation_input_tokens?: number;
              cache_read_input_tokens?: number;
            };
            is_error?: boolean;
            structured_output?: unknown;
          };

          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text" && block.text) {
                options.onStderr?.(block.text);
              }
            }
          }

          if (event.type === "result") {
            if (event.subtype === "error_max_turns") {
              finalResult = {
                output: "Claude max turns exceeded — increase commands.claudeCli.maxTurns in config",
                costUsd: event.total_cost_usd,
                usage: event.usage,
                isError: true,
              };
            } else if (event.structured_output) {
              finalResult = {
                output: JSON.stringify(event.structured_output),
                costUsd: event.total_cost_usd,
                usage: event.usage,
                isError: event.is_error === true,
              };
            } else {
              finalResult = {
                output: event.result ?? "",
                costUsd: event.total_cost_usd,
                usage: event.usage,
                isError: event.is_error === true,
              };
            }
          }
        } catch (_err: unknown) {
          // Not valid JSON line, skip
        }
      }
    });
    child.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      if (child.pid !== undefined) {
        const entry = activeProcesses.get(child.pid);
        if (entry) entry.lastActivity = Date.now();
      }

      if (!detectedRetryableError) {
        const errorCategory = classifyError(chunk);
        if (errorCategory === "RATE_LIMIT" || errorCategory === "PROMPT_TOO_LONG") {
          detectedRetryableError = chunk;
        }
      }
    });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let killId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = undefined; }
      if (killId) { clearTimeout(killId); killId = undefined; }
      if (child.pid !== undefined) {
        activeProcesses.delete(child.pid);
      }
    };

    child.on("close", (code) => {
      cleanup();

      // 재시도 가능한 에러가 감지되었다면 reject
      if (detectedRetryableError) {
        const error = new Error(detectedRetryableError.trim());
        (error as Error & { retryable: boolean }).retryable = true;
        return reject(error);
      }

      if (finalResult) {
        resolve({
          stdout: finalResult.output,
          stderr: finalResult.isError ? finalResult.output : "",
          exitCode: finalResult.isError ? 1 : 0,
          costUsd: finalResult.costUsd,
          usage: finalResult.usage,
        });
      } else {
        resolve({ stdout: streamBuffer, stderr, exitCode: code ?? 1 });
      }
    });

    child.on("error", (err) => {
      cleanup();

      // 에러 타입 분류하여 재시도 가능 여부 판단
      const errorCategory = classifyError(err.message);
      if (errorCategory === "RATE_LIMIT" || errorCategory === "PROMPT_TOO_LONG") {
        const error = new Error(err.message);
        (error as Error & { retryable: boolean }).retryable = true;
        return reject(error);
      }

      resolve({ stdout: streamBuffer, stderr: err.message, exitCode: 1 });
    });

    // Write prompt to stdin if needed
    if (useStdin && child.stdin) {
      child.stdin.write(effectivePrompt);
      child.stdin.end();
    }

    // Timeout
    if (config.timeout > 0) {
      timeoutId = setTimeout(() => {
        child.kill("SIGTERM");
        killId = setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 10000);
      }, config.timeout);
    }
  });

  const durationMs = Date.now() - startTime;

  // Calculate fallback cost if needed
  const getFallbackCost = (costUsd?: number, usage?: UsageInfo): number | undefined => {
    // Use existing cost if valid
    if (costUsd && costUsd > 0) {
      return costUsd;
    }

    // Calculate fallback cost from usage if available
    if (usage && (usage.input_tokens > 0 || usage.output_tokens > 0)) {
      return calculateCostFromUsage(usage, config.model);
    }

    return costUsd; // Return original value (0 or undefined)
  };

  if (result.exitCode !== 0) {
    return {
      success: false,
      output: result.stderr || result.stdout,
      costUsd: getFallbackCost(result.costUsd, result.usage),
      usage: result.usage,
      durationMs,
    };
  }

  return {
    success: true,
    output: result.stdout,
    costUsd: getFallbackCost(result.costUsd, result.usage),
    usage: result.usage,
    durationMs,
  };
}

export async function runClaude(options: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const retryConfig = options.config.retry;

  if (!retryConfig) {
    // retry 설정이 없으면 기존 로직 사용
    return _runClaudeInternal(options);
  }

  return withRetry(
    () => _runClaudeInternal(options),
    retryConfig,
    "Claude CLI"
  );
}

export function extractJson<T = unknown>(text: string): T {
  // 1. Try the entire text as JSON
  try {
    return JSON.parse(text) as T;
  } catch (_err: unknown) {
    // continue
  }

  // 2. Look for ```json ... ``` blocks
  const codeBlockMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim()) as T;
    } catch (_err: unknown) {
      // continue
    }
  }

  // 3. Look for { ... } by finding the first { and matching closing }
  const firstBrace = text.indexOf("{");
  if (firstBrace !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = firstBrace; i < text.length; i++) {
      const ch = text[i];

      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\" && inString) {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(firstBrace, i + 1);
          try {
            return JSON.parse(candidate) as T;
          } catch {
            // continue searching
          }
        }
      }
    }
  }

  throw new Error("No valid JSON found in text");
}
