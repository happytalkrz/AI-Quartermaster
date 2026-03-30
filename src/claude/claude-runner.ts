import { spawn, ChildProcess } from "child_process";
import type { ClaudeCliConfig } from "../types/config.js";

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

export interface ClaudeRunResult {
  success: boolean;
  output: string;
  costUsd?: number;
  durationMs: number;
}

export interface ClaudeRunOptions {
  prompt: string;
  cwd?: string;
  config: ClaudeCliConfig;
  systemPrompt?: string;
  jsonSchema?: string;  // JSON Schema string to force structured output
  onStderr?: (line: string) => void;  // callback for each stderr line (e.g. HEARTBEAT parsing)
  enableAgents?: boolean;  // Enable agent functionality with --allow-agents flag
}

export async function runClaude(options: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const { prompt, cwd, config, systemPrompt } = options;

  // When jsonSchema is set, use direct -p arg with --max-turns 1 (no file editing needed)
  // Otherwise use stdin pipe for long prompts
  const useStdin = !options.jsonSchema;

  const args: string[] = [
    "-p", useStdin ? "-" : prompt,
    "--model", config.model,
    "--max-turns", options.jsonSchema ? "5" : String(config.maxTurns),
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
  if (options.enableAgents) {
    args.push("--allow-agents");
  }

  const startTime = Date.now();

  const result = await new Promise<{ stdout: string; stderr: string; exitCode: number; costUsd?: number }>((resolve) => {
    const child = spawn(config.path, args, {
      cwd,
      env: process.env,
      stdio: [useStdin ? "pipe" : "ignore", "pipe", "pipe"],
    });

    if (child.pid !== undefined) {
      activeProcesses.set(child.pid, { process: child, lastActivity: Date.now() });
    }

    let stderr = "";
    let streamBuffer = "";
    let finalResult: { output: string; costUsd?: number; isError: boolean } | undefined;

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
                isError: true,
              };
            } else if (event.structured_output) {
              finalResult = {
                output: JSON.stringify(event.structured_output),
                costUsd: event.total_cost_usd,
                isError: event.is_error === true,
              };
            } else {
              finalResult = {
                output: event.result ?? "",
                costUsd: event.total_cost_usd,
                isError: event.is_error === true,
              };
            }
          }
        } catch {
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
      if (finalResult) {
        resolve({
          stdout: finalResult.output,
          stderr: finalResult.isError ? finalResult.output : "",
          exitCode: finalResult.isError ? 1 : 0,
          costUsd: finalResult.costUsd,
        });
      } else {
        resolve({ stdout: streamBuffer, stderr, exitCode: code ?? 1 });
      }
    });

    child.on("error", (err) => {
      cleanup();
      resolve({ stdout: streamBuffer, stderr: err.message, exitCode: 1 });
    });

    // Write prompt to stdin if needed
    if (useStdin && child.stdin) {
      child.stdin.write(prompt);
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

  if (result.exitCode !== 0) {
    return {
      success: false,
      output: result.stderr || result.stdout,
      costUsd: result.costUsd,
      durationMs,
    };
  }

  return {
    success: true,
    output: result.stdout,
    costUsd: result.costUsd,
    durationMs,
  };
}

export function extractJson<T = unknown>(text: string): T {
  // 1. Try the entire text as JSON
  try {
    return JSON.parse(text) as T;
  } catch {
    // continue
  }

  // 2. Look for ```json ... ``` blocks
  const codeBlockMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim()) as T;
    } catch {
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
