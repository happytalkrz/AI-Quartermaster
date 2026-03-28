import { spawn } from "child_process";
import type { ClaudeCliConfig } from "../types/config.js";

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
    "--output-format", "json",
    "--permission-mode", "bypassPermissions",
    ...config.additionalArgs,
  ];

  if (systemPrompt) {
    args.push("--system-prompt", systemPrompt);
  }
  if (options.jsonSchema) {
    args.push("--json-schema", options.jsonSchema);
  }

  const startTime = Date.now();

  const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
    const child = spawn(config.path, args, {
      cwd,
      env: process.env,
      stdio: [useStdin ? "pipe" : "ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let killId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = undefined; }
      if (killId) { clearTimeout(killId); killId = undefined; }
    };

    child.on("close", (code) => {
      cleanup();
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    child.on("error", (err) => {
      cleanup();
      resolve({ stdout, stderr: err.message, exitCode: 1 });
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
      durationMs,
    };
  }

  // Parse Claude JSON output: { result: string, cost_usd: number, duration_ms: number, ... }
  let output = result.stdout;
  let costUsd: number | undefined;

  try {
    const parsed = JSON.parse(result.stdout) as {
      result?: string;
      structured_output?: unknown;
      cost_usd?: number;
      total_cost_usd?: number;
      subtype?: string;
      is_error?: boolean;
    };
    costUsd = parsed.cost_usd ?? parsed.total_cost_usd;

    // Check for max_turns or other non-result responses
    if (parsed.subtype === "error_max_turns" && !parsed.result && !parsed.structured_output) {
      return {
        success: false,
        output: "Claude max turns exceeded — increase commands.claudeCli.maxTurns in config",
        costUsd,
        durationMs,
      };
    }

    // structured_output from --json-schema takes priority
    if (parsed.structured_output) {
      output = JSON.stringify(parsed.structured_output);
    } else {
      output = parsed.result ?? result.stdout;
    }
  } catch {
    // stdout is not JSON - use it as-is
  }

  return {
    success: true,
    output,
    costUsd,
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
